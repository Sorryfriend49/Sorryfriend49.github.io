/* ===================================
   FROZEN PROJECT: resúmenes de lo que dicen las reseñas
   Los escribe Gemma 4 (E4B), el modelo abierto de Google (licencia Apache 2.0), que corre
   gratis dentro de la tarea de GitHub con Ollama: sin clave ni cuenta, y las reseñas no
   salen de GitHub.
   1. scripts/comunidad.mjs deja en .tmp/pendientes.json las obras que necesitan resumen
      (5 reseñas o más, sin resumen o con reseñas nuevas) con el texto de sus reseñas más útiles,
      ya sin las partes marcadas como spoiler. Ese archivo nunca se sube al repositorio.
   2. Este programa le pide a Gemma un resumen de 2 o 3 oraciones por obra, lo revisa y lo
      guarda en datos/comunidad.json. Al terminar borra .tmp/.
   Para correrlo en tu PC: instala Ollama, ejecuta "ollama pull gemma4:e4b" y luego
   node scripts/comunidad.mjs && node scripts/resumenes.mjs
=================================== */
import { readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const VERSION_RESUMEN = 1;           // si cambian las instrucciones, se sube y se reescriben todos
export const MODELO_RESUMEN = 'gemma4:e4b';
export const NOMBRE_MODELO = 'Gemma 4';
export const MIN_RESENAS_RESUMEN = 5;       // con menos, el "resumen" sería la opinión de una o dos personas
export const RESENAS_EN_RESUMEN = 8;        // las más útiles según los lectores de AniList
export const CARACTERES_POR_RESENA = 500;
const RESENAS_NUEVAS_PARA_REHACER = 3;
const DIAS_PARA_REHACER = 84;               // 12 semanas
const LIMITE_MINUTOS = 40;                  // lo que no alcance queda para la semana siguiente
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

export async function escribirResumenes({
    raiz,
    fetch = globalThis.fetch,
    ahora = new Date(),
    registro = console.log,
    limiteMs = LIMITE_MINUTOS * 60 * 1000,
    modelo = MODELO_RESUMEN
} = {}){
    const carpetaTemporal = join(raiz, '.tmp');
    const pendientes = await leerJSON(join(carpetaTemporal, 'pendientes.json'), []);
    if (!pendientes.length){
        registro('No hay resúmenes por escribir.');
        return 0;
    }
    const rutaDatos = join(raiz, 'datos/comunidad.json');
    const datos = JSON.parse(await readFile(rutaDatos, 'utf8'));
    const inicio = Date.now();
    let hechos = 0;
    let vistos = 0;
    registro(`Resúmenes por escribir con ${NOMBRE_MODELO} (${modelo}): ${pendientes.length}.`);
    for (const obra of pendientes){
        if (Date.now() - inicio > limiteMs){
            registro(`Se acabó el tiempo: ${pendientes.length - vistos} quedan para la próxima ejecución.`);
            break;
        }
        vistos++;
        const destino = datos.obras && datos.obras[String(obra.id)];
        if (!destino) continue;
        const t0 = Date.now();
        try {
            const texto = revisarResumen(await pedirResumen(fetch, modelo, construirPedido(obra)));
            if (!texto){
                registro(`  ${obra.titulo}: el resumen no pasó la revisión; queda el anterior`);
                continue;
            }
            destino.resumen = { texto, resenas: obra.datos.n, modelo: NOMBRE_MODELO, version: VERSION_RESUMEN, fecha: hoy(ahora) };
            hechos++;
            registro(`  ${obra.titulo} (${Math.round((Date.now() - t0) / 1000)} s): ${texto}`);
            // Se guarda después de cada obra: si la tarea se corta, lo hecho no se pierde
            await writeFile(rutaDatos, JSON.stringify(datos, null, 2) + '\n');
        } catch (error){
            registro(`  ${obra.titulo}: no se pudo resumir (${error.message})`);
        }
    }
    await rm(carpetaTemporal, { recursive: true, force: true });
    registro(`Resúmenes escritos: ${hechos} de ${pendientes.length}.`);
    return hechos;
}

// node scripts/resumenes.mjs
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href){
    const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
    escribirResumenes({ raiz }).catch(error => {
        console.error('Error:', error.message);
        process.exit(1);
    });
}
