/* ===================================
   FROZEN PROJECT: medir qué tan rápido escribe Gemma los resúmenes (prueba a mano)
   Lo corre .github/workflows/medir-gemma.yml (Actions > "Medir Gemma" > Run workflow), gratis.
   Toma 6 obras con muchas reseñas, baja de AniList sus 8 reseñas más útiles y le pide a Gemma
   el resumen de varias formas, para comparar cuánto tarda y cómo queda:
   - actual: los primeros 500 caracteres de cada reseña (como hoy)
   - cortas: los primeros 300 caracteres
   - clave: solo las frases que opinan de un tema (arte, historia, ritmo…) y que el modelo de
     sentimiento (BERT) marca como elogio o crítica, hasta unos 320 caracteres por reseña
   - hilos: la actual, usando todos los núcleos de la máquina
   - dos a la vez: la actual, dos obras al mismo tiempo
   Con --fa: solo la actual en 3 obras (para comparar con el servidor con flash attention).
   El registro de las tareas es público: no muestra el texto de las reseñas, solo tiempos y resúmenes.
=================================== */
import { readFile, appendFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { construirPedido, revisarResumen, MODELO_RESUMEN, RESENAS_EN_RESUMEN } from '../../scripts/resumenes.mjs';
import { textoParaResumen, limpiarTexto, oraciones, temasEn } from '../../scripts/analisis.mjs';
import { crearClasificador } from '../../scripts/tono.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OLLAMA = 'http://127.0.0.1:11434';
const ANILIST = 'https://graphql.anilist.co';
const SOLO_FA = process.argv.includes('--fa');
const OBRAS = SOLO_FA ? 3 : 6;
const dormir = ms => new Promise(r => setTimeout(r, ms));
const s = x => Math.round(x * 10) / 10;

/* ---------- Las frases clave de una reseña (la idea a probar) ----------
   Frases sin spoilers que hablan de algún tema; de ellas, las que el modelo marca como elogio o
   crítica, en su orden, prefiriendo temas distintos, hasta "maximo" caracteres. Si no hay
   ninguna, los primeros 250 caracteres de la reseña. */
export function candidatasDe(body){
    const limpio = limpiarTexto(String(body || '').replace(/~![\s\S]*?!~/g, ' '));
    return oraciones(limpio)
        .map(t => t.replace(/\s+/g, ' ').trim())
        .filter(t => t.length >= 25 && t.length <= 280)
        .map((texto, orden) => ({ texto, orden, temas: temasEn(texto) }))
        .filter(f => f.temas.length);
}
export function elegirClave(candidatas, tonos, body, maximo = 320){
    const opinan = candidatas.map((f, k) => ({ ...f, tono: tonos[k] || 0 })).filter(f => f.tono !== 0);
    const elegidas = new Set();
    const vistos = new Set();
    let largo = 0;
    const cabe = f => largo + f.texto.length + 2 <= maximo;
    const tomar = f => { elegidas.add(f); f.temas.forEach(t => vistos.add(t)); largo += f.texto.length + 2; };
    for (const f of opinan) if (f.temas.some(t => !vistos.has(t)) && cabe(f)) tomar(f);         // una por tema
    for (const f of opinan) if (!elegidas.has(f) && elegidas.size < 4 && cabe(f)) tomar(f);      // y las que quepan
    if (!elegidas.size) return textoParaResumen(body, 250);
    return [...elegidas].sort((a, b) => a.orden - b.orden).map(f => f.texto).join('. ') + '.';
}

/* ---------- AniList ---------- */
const CONSULTA = `query ($id: Int) { Page(page: 1, perPage: 25) { reviews(mediaId: $id, sort: RATING_DESC) { score summary body } } }`;
async function resenasDe(id){
    for (let intento = 1; intento <= 4; intento++){
        const r = await fetch(ANILIST, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ query: CONSULTA, variables: { id } }) });
        if (r.status === 429 || r.status >= 500){ await dormir(15000 * intento); continue; }
        const d = await r.json();
        if (d.errors) throw new Error(d.errors.map(e => e.message).join('; '));
        await dormir(2200);
        return d.data.Page.reviews.filter(x => x && Number.isFinite(x.score)).slice(0, RESENAS_EN_RESUMEN);
    }
    throw new Error('AniList no respondió');
}

/* ---------- Ollama ---------- */
async function pedir(pedido, opciones = {}){
    const cuerpo = {
        model: MODELO_RESUMEN, stream: false,
        messages: [{ role: 'system', content: pedido.sistema }, { role: 'user', content: pedido.usuario }],
        format: { type: 'object', properties: { resumen: { type: 'string' } }, required: ['resumen'] },
        options: { temperature: 0.3, num_ctx: 4096, num_predict: 400, ...opciones },
        think: false, keep_alive: '60m'
    };
    const inicio = Date.now();
    const r = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(15 * 60 * 1000) });
    if (!r.ok) throw new Error(`Ollama respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const d = await r.json();
    let texto = (d.message && d.message.content) || '';
    try { texto = JSON.parse(texto).resumen; } catch { /* queda el texto tal cual */ }
    return {
        texto: String(texto || '').replace(/\s+/g, ' ').trim(),
        pasa: Boolean(revisarResumen(texto)),
        entrada: d.prompt_eval_count || 0, tEntrada: (d.prompt_eval_duration || 0) / 1e9,
        salida: d.eval_count || 0, tSalida: (d.eval_duration || 0) / 1e9,
        total: (Date.now() - inicio) / 1000,
        caracteres: pedido.sistema.length + pedido.usuario.length
    };
}

const linea = (nombre, m) => `  ${nombre.padEnd(12)} ${String(m.caracteres).padStart(5)} car. → ${String(m.entrada).padStart(4)} tokens en ${s(m.tEntrada)} s` +
    ` (${s(m.entrada / (m.tEntrada || 1))}/s) + ${m.salida} escritos en ${s(m.tSalida)} s (${s(m.salida / (m.tSalida || 1))}/s) = ${s(m.total)} s${m.pasa ? '' : ' · NO PASA LA REVISIÓN'}`;

async function principal(){
    console.log(`Máquina: ${cpus().length} núcleos (${cpus()[0] && cpus()[0].model}), ${Math.round(totalmem() / 2 ** 30)} GB.`);
    const comunidad = JSON.parse(await readFile(join(RAIZ, 'datos/comunidad.json'), 'utf8'));
    const catalogo = JSON.parse(await readFile(join(RAIZ, 'obras.json'), 'utf8')).obras;
    const candidatas = catalogo.map(o => ({ o, c: comunidad.obras[String(o.ids && o.ids.anilist)] }))
        .filter(({ c }) => c && c.resenas && c.resenas.n >= 12 && c.resumen && c.resumen.texto)
        .sort((a, b) => b.c.resenas.n - a.c.resenas.n);
    const elegidas = [];
    for (const tipo of ['manga', 'manhwa', 'manhua', 'manga', 'manhwa', 'manhua']){
        const x = candidatas.find(y => y.o.tipo === tipo && !elegidas.includes(y)) || candidatas.find(y => !elegidas.includes(y));
        if (x && elegidas.length < OBRAS) elegidas.push(x);
    }
    console.log(`Obras: ${elegidas.map(({ o }) => o.titulo).join(', ')}.`);

    const clasificador = SOLO_FA ? null : await crearClasificador({ carpeta: join(RAIZ, '.modelos'), registro: console.log });
    const pedidos = [];
    for (const { o, c } of elegidas){
        const resenas = await resenasDe(o.ids.anilist);
        const base = { titulo: o.titulo, tipo: o.tipo, datos: { n: c.resenas.n, positivas: c.resenas.positivas, negativas: c.resenas.negativas, mixtas: c.resenas.mixtas, elogian: c.resenas.elogian, critican: c.resenas.critican } };
        const con = texto => construirPedido({ ...base, resenas: resenas.map((r, i) => ({ nota: r.score, resumen: textoParaResumen(r.summary, 200), texto: texto(r, i) })) });
        const variantes = { actual: con(r => textoParaResumen(r.body, 500)) };
        if (clasificador){
            variantes.cortas = con(r => textoParaResumen(r.body, 300));
            const porResena = resenas.map(r => candidatasDe(r.body));
            const todas = porResena.flat();
            const tonos = todas.length ? await clasificador.tonos(todas.map(f => f.texto)) : [];
            let k = 0;
            const claves = porResena.map((lista, i) => { const t = tonos.slice(k, k + lista.length); k += lista.length; return elegirClave(lista, t, resenas[i].body); });
            variantes.clave = con((r, i) => claves[i]);
        }
        pedidos.push({ titulo: o.titulo, hoy: c.resumen.texto, variantes });
    }

    // Calentar: la primera consulta carga el modelo en memoria (no cuenta)
    const calentar = await pedir(pedidos[0].variantes.actual);
    console.log(`Modelo cargado (primera consulta: ${s(calentar.total)} s).\n`);

    const medidas = {};
    const sumar = (nombre, m) => (medidas[nombre] = medidas[nombre] || []).push(m);
    for (const p of pedidos){
        console.log(`${p.titulo}\n  hoy en la página: ${p.hoy}`);
        for (const [nombre, pedido] of Object.entries(p.variantes)){
            const m = await pedir(pedido);
            sumar(SOLO_FA ? 'actual + FA' : nombre, m);
            console.log(linea(SOLO_FA ? 'actual + FA' : nombre, m));
            console.log(`  ${''.padEnd(12)} ${m.texto}`);
        }
        console.log('');
    }
    if (!SOLO_FA){
        const nucleos = cpus().length;
        for (const p of pedidos.slice(0, 3)){
            const m = await pedir(p.variantes.actual, { num_thread: nucleos });
            sumar(`hilos ${nucleos}`, m);
            console.log(`${p.titulo}\n${linea(`hilos ${nucleos}`, m)}`);
        }
        // Dos a la vez (el servidor se abrió con OLLAMA_NUM_PARALLEL=2)
        for (let i = 0; i + 1 < Math.min(pedidos.length, 4); i += 2){
            const inicio = Date.now();
            const par = await Promise.all([pedir(pedidos[i].variantes.actual), pedir(pedidos[i + 1].variantes.actual)]);
            const pared = (Date.now() - inicio) / 1000;
            par.forEach(m => sumar('dos a la vez', { ...m, total: pared / 2 }));
            console.log(`${pedidos[i].titulo} + ${pedidos[i + 1].titulo}: las dos en ${s(pared)} s (${s(pared / 2)} s cada una)`);
            par.forEach(m => console.log(`  ${m.pasa ? '' : 'NO PASA · '}${m.texto}`));
        }
    }

    // Promedios
    const tabla = ['| Forma | Caracteres | Tokens leídos | Lectura (tokens/s) | Escritura (tokens/s) | Segundos por resumen | Pasan la revisión |', '|---|---|---|---|---|---|---|'];
    console.log('\nPROMEDIOS');
    for (const [nombre, lista] of Object.entries(medidas)){
        const prom = f => lista.reduce((a, m) => a + f(m), 0) / lista.length;
        const fila = [nombre, Math.round(prom(m => m.caracteres)), Math.round(prom(m => m.entrada)), s(prom(m => m.entrada / (m.tEntrada || 1))),
            s(prom(m => m.salida / (m.tSalida || 1))), s(prom(m => m.total)), `${lista.filter(m => m.pasa).length}/${lista.length}`];
        console.log(`  ${fila.join(' · ')}`);
        tabla.push(`| ${fila.join(' | ')} |`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### ${SOLO_FA ? 'Con flash attention' : 'Gemma: tiempos por forma'}\n\n${tabla.join('\n')}\n\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href){
    principal().catch(error => { console.error('Error:', error.message); process.exit(1); });
}
