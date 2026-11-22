/* ===================================
   FROZEN PROJECT: resúmenes de lo que dicen las reseñas
   Los escribe Gemma 4 (E4B), el modelo abierto de Google (licencia Apache 2.0), que corre
   gratis dentro de la tarea de GitHub con Ollama: sin clave ni cuenta. Las reseñas se bajan
   de AniList en el momento, no salen de la máquina de GitHub y no se guardan en ningún lado.
   1. scripts/comunidad.mjs deja en .tmp/pendientes.json qué obras necesitan resumen (5 reseñas
      o más, sin resumen o con reseñas nuevas). Ese archivo nunca se sube al repositorio.
   2. Este programa baja las reseñas más útiles de cada una y, de cada reseña, se queda con sus
      frases clave: las que opinan de un tema (el arte, la historia, el ritmo…) y que el modelo de
      sentimiento (tono.mjs) marca como elogio o crítica, sin las partes marcadas como spoiler.
      Con eso Gemma lee un 30 % menos y escribe cada resumen más rápido (medido con
      .github/workflows/medir-gemma.yml). Le pide un resumen de 2 o 3 oraciones, lo revisa y
      lo guarda en datos/comunidad.json.
   En GitHub, si hay muchas, se reparten entre varias máquinas a la vez (ver comunidad.yml):
      --repartir          cuántas máquinas usar (lo lee la tarea; RESUMIR=id,id agrega otras)
      --parte K --de N    la máquina K (de N) escribe los suyos en .tmp/resumenes/parte-K.json
      --juntar            una última máquina los guarda todos en datos/comunidad.json
   Para correrlo en tu PC: instala Ollama, ejecuta "ollama pull gemma4:e4b" y luego
   node scripts/comunidad.mjs && node scripts/resumenes.mjs
=================================== */
import { readFile, writeFile, rm, mkdir, readdir, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { textoParaResumen, limpiarTexto, oraciones, temasEn } from './analisis.mjs';
import { crearClasificador, clasificadorPalabras } from './tono.mjs';

export const VERSION_RESUMEN = 1;           // si cambian las instrucciones, se sube y se reescriben todos
export const MODELO_RESUMEN = 'gemma4:e4b';
export const NOMBRE_MODELO = 'Gemma 4';
export const MIN_RESENAS_RESUMEN = 5;       // con menos, el "resumen" sería la opinión de una o dos personas
export const RESENAS_EN_RESUMEN = 8;        // las más útiles según los lectores de AniList
export const CARACTERES_CLAVE = 320;        // de cada reseña, sus frases clave hasta este largo
const RESENAS_NUEVAS_PARA_REHACER = 3;
const DIAS_PARA_REHACER = 84;               // 12 semanas
const LIMITE_MINUTOS = 40;                  // por máquina; lo que no alcance entra al día siguiente (ver niveles.mjs)
export const POR_MAQUINA = 15;              // resúmenes por máquina de GitHub (unos 13 minutos de Gemma)
export const MAX_MAQUINAS = 8;              // GitHub deja 20 tareas a la vez en cuentas gratis: queda margen
const OLLAMA = 'http://127.0.0.1:11434';

const NOMBRES_TEMAS = {
    arte: 'el arte', historia: 'la historia', personajes: 'los personajes', ritmo: 'el ritmo', final: 'el final',
    accion: 'la acción', mundo: 'el mundo y su sistema', romance: 'el romance', humor: 'el humor', emocion: 'lo emotivo'
};
const TIPOS = { manga: 'manga', manhwa: 'manhwa', manhua: 'manhua' };

const hoy = fecha => fecha.toISOString().slice(0, 10);
const diasEntre = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const enumerar = lista => lista.length <= 1 ? (lista[0] || '') : lista.slice(0, -1).join(', ') + ' y ' + lista[lista.length - 1];

// ¿Esta obra necesita un resumen nuevo?
export function necesitaResumen(resenas, resumen, fecha){
    const n = (resenas && resenas.n) || 0;
    if (n < MIN_RESENAS_RESUMEN) return false;
    if (!resumen || !resumen.texto || resumen.version !== VERSION_RESUMEN) return true;
    if (Math.abs(n - (resumen.resenas || 0)) >= RESENAS_NUEVAS_PARA_REHACER) return true;
    return !resumen.fecha || diasEntre(resumen.fecha, fecha) >= DIAS_PARA_REHACER;
}

const SISTEMA = `Eres el editor de Frozen Project, una página en español que recomienda manga, manhwa y manhua.
Vas a leer reseñas de lectores de AniList (casi siempre en inglés) sobre una obra y a escribir un resumen breve de lo que opinan.
Reglas:
- Escribe en español latinoamericano neutro: 2 o 3 oraciones, 60 palabras como máximo.
- Cuenta lo que opinan los lectores ("Los lectores destacan…", "A varios les molesta…"); no des tu propia opinión ni consejos.
- A quienes escribieron las reseñas llámalos "lectores", no "críticos".
- Si las opiniones están divididas, dilo.
- Varía cómo empiezas y no cierres con "En general…": la última oración debe decir algo concreto.
- No reveles nada de la trama que sea un spoiler: ni muertes, ni giros, ni cómo termina, ni identidades secretas.
- No copies frases de las reseñas ni menciones a quienes las escribieron.
- No inventes nada que no esté en las reseñas.
Responde solo con un JSON así: {"resumen": "..."}`;

// Lo que se le manda a Gemma para una obra
export function construirPedido(obra){
    const d = obra.datos || {};
    const temas = lista => enumerar((lista || []).map(t => NOMBRES_TEMAS[t] || t));
    let datos = `Datos: ${d.n} reseñas en AniList: ${d.positivas || 0} positivas, ${d.negativas || 0} negativas y ${d.mixtas || 0} mixtas.`;
    if (d.elogian && d.elogian.length) datos += ` Lo más elogiado: ${temas(d.elogian)}.`;
    if (d.critican && d.critican.length) datos += ` Lo más criticado: ${temas(d.critican)}.`;
    const lineas = [`Obra: ${obra.titulo} (${TIPOS[obra.tipo] || 'manga'}).`, datos, 'Reseñas, de la más útil a la menos útil:'];
    (obra.resenas || []).forEach((r, i) => {
        const resumenAutor = r.resumen ? ` Resumen de su autor: "${r.resumen}".` : '';
        lineas.push(`${i + 1}. Nota ${r.nota}/100.${resumenAutor} Texto: "${r.texto}"`);
    });
    return { sistema: SISTEMA, usuario: lineas.join('\n') };
}

// Revisa lo que escribió el modelo: largo razonable, en español y sin enlaces ni marcas de spoiler
export function revisarResumen(texto){
    if (typeof texto !== 'string') return null;
    let t = texto.replace(/\s+/g, ' ').trim().replace(/^["“«]+|["”»]+$/g, '').trim();
    if (t.length < 60 || t.length > 700) return null;
    if (/https?:|www\.|~!|!~|<\/?[a-z]/i.test(t)) return null;
    const palabrasEspanol = (` ${t.toLowerCase().replace(/[.,;:!?()]/g, ' ')} `
        .match(/ (?=(los|las|la|el|de|que|y|una|un|su|sus|es|se|por|con|para|lo|les|muy|pero) )/g) || []).length;
    if (palabrasEspanol < 5) return null;
    if (!/[.!?…]$/.test(t)) t += '.';
    return t;
}

// Le pide el resumen a Ollama (que sirve a Gemma en la propia tarea)
async function pedirResumen(fetch, modelo, { sistema, usuario }){
    const cuerpo = {
        model: modelo,
        stream: false,
        messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }],
        format: { type: 'object', properties: { resumen: { type: 'string' } }, required: ['resumen'] },
        options: { temperature: 0.3, num_ctx: 4096, num_predict: 400 },
        think: false,
        keep_alive: '30m'
    };
    const enviar = () => fetch(`${OLLAMA}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(10 * 60 * 1000)
    });
    let r = await enviar();
    if (r.status === 400){
        // Si esta versión del modelo no acepta la opción "think", se pide sin ella
        const error = await r.text();
        if (!/think/i.test(error)) throw new Error(`Ollama respondió 400: ${error.slice(0, 200)}`);
        delete cuerpo.think;
        r = await enviar();
    }
    if (!r.ok) throw new Error(`Ollama respondió ${r.status}`);
    const d = await r.json();
    const contenido = (d.message && d.message.content) || '';
    try { return JSON.parse(contenido).resumen; } catch { return contenido; }
}

async function leerJSON(ruta, siNoExiste){
    try { return JSON.parse(await readFile(ruta, 'utf8')); }
    catch (error){ if (error.code === 'ENOENT') return siNoExiste; throw error; }
}

/* ---------- Las reseñas, de AniList en el momento ---------- */
const ANILIST = 'https://graphql.anilist.co';
const AGENTE = 'FrozenProject/1.0 (+https://frozen-project.vercel.app)';
const PAUSA_ANILIST = 2200;                 // AniList hoy permite unas 30 consultas por minuto
const CONSULTA_RESENAS = `query ($id: Int) { Page(page: 1, perPage: 25) {
    reviews(mediaId: $id, sort: RATING_DESC) { score summary body } } }`;
const dormir = ms => new Promise(r => setTimeout(r, ms));

// Las reseñas más útiles de una obra (respeta la pausa de AniList y reintenta si está ocupado)
export function crearLectorResenas({ fetch = globalThis.fetch, esperar = dormir, registro = console.log } = {}){
    let ultima = 0;
    return async function resenasDe(id, intentos = 5){
        for (let intento = 1; intento <= intentos; intento++){
            const falta = ultima + PAUSA_ANILIST - Date.now();
            if (falta > 0) await esperar(falta);
            ultima = Date.now();
            let r;
            try {
                r = await fetch(ANILIST, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': AGENTE },
                    body: JSON.stringify({ query: CONSULTA_RESENAS, variables: { id: Number(id) } }),
                    signal: AbortSignal.timeout(30000)
                });
            } catch (error){
                if (intento === intentos) throw error;
                await esperar(3000 * intento);
                continue;
            }
            if (r.status === 429 || r.status >= 500){
                if (intento === intentos) throw new Error(`AniList respondió ${r.status}`);
                const segundos = Number(r.headers.get('retry-after')) || 15 * intento;
                registro(`  AniList respondió ${r.status}; espero ${segundos} s`);
                await esperar(segundos * 1000);
                continue;
            }
            const d = await r.json();
            if (!r.ok || (d.errors && d.errors.length)) throw new Error('AniList: ' + ((d.errors || []).map(e => e.message).join('; ') || r.status));
            return (d.data && d.data.Page && d.data.Page.reviews) || [];
        }
    };
}

/* ---------- Las frases clave de cada reseña ---------- */
// Frases sin spoilers (~! … !~) que hablan de algún tema; ni muy cortas ni muy largas
export function frasesCandidatas(body){
    const limpio = limpiarTexto(String(body || '').replace(/~![\s\S]*?!~/g, ' '));
    return oraciones(limpio)
        .map(t => t.replace(/\s+/g, ' ').trim())
        .filter(t => t.length >= 25 && t.length <= 280)
        .map((texto, orden) => ({ texto, orden, temas: temasEn(texto) }))
        .filter(f => f.temas.length);
}

/* De esas, las que elogian o critican (tonos: +1, 0 o −1 de cada una), primero una por tema
   y después las que quepan (hasta 4), en el orden de la reseña. Si no hay ninguna, el comienzo
   de la reseña. */
export function elegirFrases(candidatas, tonos, body, maximo = CARACTERES_CLAVE){
    const opinan = candidatas.map((f, k) => ({ ...f, tono: tonos[k] || 0 })).filter(f => f.tono !== 0);
    const elegidas = new Set();
    const vistos = new Set();
    let largo = 0;
    const cabe = f => largo + f.texto.length + 2 <= maximo;
    const tomar = f => { elegidas.add(f); f.temas.forEach(t => vistos.add(t)); largo += f.texto.length + 2; };
    for (const f of opinan) if (f.temas.some(t => !vistos.has(t)) && cabe(f)) tomar(f);
    for (const f of opinan) if (!elegidas.has(f) && elegidas.size < 4 && cabe(f)) tomar(f);
    if (!elegidas.size) return textoParaResumen(body, 250);
    return [...elegidas].sort((a, b) => a.orden - b.orden).map(f => f.texto).join('. ') + '.';
}

// De cada reseña, Gemma recibe su nota, el resumen de su autor y sus frases clave
export async function resenasParaResumen(resenas, clasificador = clasificadorPalabras){
    const lista = (resenas || []).filter(r => r && Number.isFinite(r.score)).slice(0, RESENAS_EN_RESUMEN);
    const porResena = lista.map(r => frasesCandidatas(r.body));
    const textos = porResena.flat().map(f => f.texto);
    let tonos = [];
    if (textos.length){
        try { tonos = await clasificador.tonos(textos); }
        catch { tonos = await clasificadorPalabras.tonos(textos); }   // si el modelo falla, palabras clave
    }
    let k = 0;
    return lista.map((r, i) => {
        const suyos = tonos.slice(k, k + porResena[i].length);
        k += porResena[i].length;
        return { nota: r.score, resumen: textoParaResumen(r.summary, 200), texto: elegirFrases(porResena[i], suyos, r.body) };
    });
}

// Lo que la obra ya tiene guardado de sus reseñas: cuántas, de qué tono y qué temas
const datosDe = r => ({ n: r.n, positivas: r.positivas, negativas: r.negativas, mixtas: r.mixtas, elogian: r.elogian, critican: r.critican });

/* Escribe los resúmenes de una lista de obras ({ id, titulo, tipo }) y devuelve [{ id, resumen }].
   alListo(id, resumen) se llama apenas sale cada uno, para guardarlo sin esperar al final. */
export async function resumir(pendientes, comunidad, {
    fetch = globalThis.fetch, resenasDe, ahora = new Date(), registro = console.log,
    limiteMs = LIMITE_MINUTOS * 60 * 1000, modelo = MODELO_RESUMEN, alListo = async () => {},
    clasificador = clasificadorPalabras
} = {}){
    const inicio = Date.now();
    const hechos = [];
    let vistos = 0;
    for (const obra of pendientes){
        if (Date.now() - inicio > limiteMs){
            registro(`Se acabó el tiempo: ${pendientes.length - vistos} quedan para mañana.`);
            break;
        }
        vistos++;
        const guardada = comunidad && comunidad.obras && comunidad.obras[String(obra.id)];
        if (!guardada || !guardada.resenas) continue;
        const t0 = Date.now();
        try {
            const resenas = await resenasParaResumen(await resenasDe(obra.id), clasificador);
            if (resenas.length < MIN_RESENAS_RESUMEN){
                registro(`  ${obra.titulo}: AniList dio pocas reseñas; queda para otro día`);
                continue;
            }
            const datos = datosDe(guardada.resenas);
            const texto = revisarResumen(await pedirResumen(fetch, modelo, construirPedido({ titulo: obra.titulo, tipo: obra.tipo, datos, resenas })));
            if (!texto){
                registro(`  ${obra.titulo}: el resumen no pasó la revisión; queda el anterior`);
                continue;
            }
            const resumen = { texto, resenas: datos.n, modelo: NOMBRE_MODELO, version: VERSION_RESUMEN, fecha: hoy(ahora) };
            hechos.push({ id: String(obra.id), resumen });
            registro(`  ${obra.titulo} (${Math.round((Date.now() - t0) / 1000)} s): ${texto}`);
            await alListo(String(obra.id), resumen);
        } catch (error){
            registro(`  ${obra.titulo}: no se pudo resumir (${error.message})`);
        }
    }
    return hechos;
}

// En tu PC (una sola máquina): las de .tmp/pendientes.json, guardadas en datos/comunidad.json
export async function escribirResumenes({
    raiz,
    fetch = globalThis.fetch,
    ahora = new Date(),
    registro = console.log,
    limiteMs = LIMITE_MINUTOS * 60 * 1000,
    modelo = MODELO_RESUMEN,
    resenasDe = crearLectorResenas({ fetch, registro }),
    clasificador = null
} = {}){
    const carpetaTemporal = join(raiz, '.tmp');
    const pendientes = await leerJSON(join(carpetaTemporal, 'pendientes.json'), []);
    if (!pendientes.length){
        registro('No hay resúmenes por escribir.');
        return 0;
    }
    const rutaDatos = join(raiz, 'datos/comunidad.json');
    const datos = JSON.parse(await readFile(rutaDatos, 'utf8'));
    registro(`Resúmenes por escribir con ${NOMBRE_MODELO} (${modelo}): ${pendientes.length}.`);
    if (!clasificador) clasificador = await crearClasificador({ carpeta: join(raiz, '.modelos'), registro });
    const hechos = await resumir(pendientes, datos, {
        fetch, resenasDe, ahora, registro, limiteMs, modelo, clasificador,
        // Se guarda después de cada obra: si la tarea se corta, lo hecho no se pierde
        alListo: async (id, resumen) => { datos.obras[id].resumen = resumen; await writeFile(rutaDatos, JSON.stringify(datos, null, 2) + '\n'); }
    });
    await rm(carpetaTemporal, { recursive: true, force: true });
    registro(`Resúmenes escritos: ${hechos.length} de ${pendientes.length}.`);
    return hechos.length;
}

/* ---------- Varias máquinas a la vez (en GitHub) ---------- */
// Cuántas máquinas usar: una cada POR_MAQUINA resúmenes, como mucho MAX_MAQUINAS
export function repartir(pendientes, { porMaquina = POR_MAQUINA, maximo = MAX_MAQUINAS } = {}){
    const ids = (pendientes || []).map(p => Number(p.id)).filter(Number.isFinite);
    const maquinas = ids.length ? Math.min(maximo, Math.ceil(ids.length / porMaquina)) : 0;
    return { ids, maquinas };
}

// Las de la máquina "parte" (de 0 a de − 1): una de cada "de", así todas reciben parecido
export const parteDe = (lista, parte, de) => (lista || []).filter((_, i) => i % de === parte);

// Una máquina: escribe los suyos en .tmp/resumenes/parte-K.json (lo entrega la tarea a la que junta)
export async function escribirParte({
    raiz, parte, de, ids,
    fetch = globalThis.fetch,
    ahora = new Date(),
    registro = console.log,
    limiteMs = LIMITE_MINUTOS * 60 * 1000,
    modelo = MODELO_RESUMEN,
    resenasDe = crearLectorResenas({ fetch, registro }),
    clasificador = null
}){
    if (!Number.isInteger(parte) || !Number.isInteger(de) || de < 1 || parte < 0 || parte >= de) throw new Error(`Parte ${parte} de ${de}: no tiene sentido`);
    const catalogo = (await leerJSON(join(raiz, 'obras.json'), { obras: [] })).obras || [];
    const porAniList = new Map(catalogo.filter(o => o && o.ids && o.ids.anilist).map(o => [String(o.ids.anilist), o]));
    const comunidad = await leerJSON(join(raiz, 'datos/comunidad.json'), { obras: {} });
    const mias = parteDe(ids, parte, de).map(id => porAniList.get(String(id))).filter(Boolean)
        .map(o => ({ id: o.ids.anilist, titulo: o.titulo, tipo: o.tipo }));
    registro(`Máquina ${parte + 1} de ${de}: ${mias.length} resúmenes con ${NOMBRE_MODELO} (${modelo}).`);
    const salida = join(raiz, '.tmp/resumenes', `parte-${parte}.json`);
    await mkdir(dirname(salida), { recursive: true });
    const guardados = [];
    if (!clasificador && mias.length) clasificador = await crearClasificador({ carpeta: join(raiz, '.modelos'), registro });
    const hechos = await resumir(mias, comunidad, {
        fetch, resenasDe, ahora, registro, limiteMs, modelo, clasificador: clasificador || clasificadorPalabras,
        alListo: async (id, resumen) => { guardados.push({ id, resumen }); await writeFile(salida, JSON.stringify(guardados, null, 2) + '\n'); }
    });
    registro(`Resúmenes escritos en esta máquina: ${hechos.length} de ${mias.length}.`);
    return hechos.length;
}

// La última: junta lo de todas las máquinas en datos/comunidad.json (revisa cada resumen otra vez)
export async function juntarResumenes({ raiz, registro = console.log } = {}){
    const carpeta = join(raiz, '.tmp/resumenes');
    let archivos = [];
    try { archivos = (await readdir(carpeta)).filter(f => /^parte-\d+\.json$/.test(f)); }
    catch (error){ if (error.code !== 'ENOENT') throw error; }
    const rutaDatos = join(raiz, 'datos/comunidad.json');
    const datos = JSON.parse(await readFile(rutaDatos, 'utf8'));
    let puestos = 0;
    for (const archivo of archivos){
        const lista = await leerJSON(join(carpeta, archivo), []);
        for (const item of Array.isArray(lista) ? lista : []){
            const destino = item && datos.obras && datos.obras[String(item.id)];
            const r = item && item.resumen;
            const texto = r && revisarResumen(r.texto);
            if (!destino || !texto || r.version !== VERSION_RESUMEN || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.fecha))) continue;
            destino.resumen = { texto, resenas: Number(r.resenas) || 0, modelo: NOMBRE_MODELO, version: VERSION_RESUMEN, fecha: r.fecha };
            puestos++;
        }
    }
    if (puestos) await writeFile(rutaDatos, JSON.stringify(datos, null, 2) + '\n');
    await rm(join(raiz, '.tmp'), { recursive: true, force: true });
    registro(`Resúmenes guardados: ${puestos} (de ${archivos.length} ${archivos.length === 1 ? 'máquina' : 'máquinas'}).`);
    return puestos;
}

// node scripts/resumenes.mjs [--repartir | --parte K --de N | --juntar]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href){
    const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
    const args = process.argv.slice(2);
    const numero = nombre => { const i = args.indexOf(nombre); return i >= 0 ? Number(args[i + 1]) : NaN; };
    let tarea;
    if (args.includes('--repartir')){
        tarea = async () => {
            // A mano (Run workflow) se pueden pedir otras: sus números de AniList en RESUMIR
            const pendientes = await leerJSON(join(raiz, '.tmp/pendientes.json'), []);
            const pedidas = String(process.env.RESUMIR || '').split(/[^0-9]+/).filter(Boolean).map(Number)
                .filter(id => !pendientes.some(p => Number(p.id) === id)).map(id => ({ id }));
            if (pedidas.length) console.log(`A pedido: ${pedidas.map(p => p.id).join(', ')}.`);
            const { ids, maquinas } = repartir([...pendientes, ...pedidas]);
            console.log(`Resúmenes por escribir: ${ids.length}${maquinas ? `; se reparten en ${maquinas} ${maquinas === 1 ? 'máquina' : 'máquinas'}` : ''}.`);
            const salida = [`hay=${maquinas ? 'si' : 'no'}`, `maquinas=${JSON.stringify([...Array(maquinas).keys()])}`, `ids=${JSON.stringify(ids)}`].join('\n') + '\n';
            if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, salida);
            else process.stdout.write(salida);
        };
    } else if (args.includes('--parte')){
        tarea = () => escribirParte({ raiz, parte: numero('--parte'), de: numero('--de'), ids: JSON.parse(process.env.PENDIENTES || '[]') });
    } else if (args.includes('--juntar')){
        tarea = () => juntarResumenes({ raiz });
    } else {
        tarea = () => escribirResumenes({ raiz });
    }
    tarea().catch(error => {
        console.error('Error:', error.message);
        process.exit(1);
    });
}
