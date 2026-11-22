/* ===================================
   FROZEN PROJECT: medir qué tan rápido escribe Gemma los resúmenes (prueba a mano)
   Lo corre .github/workflows/medir-gemma.yml (Actions > "Medir Gemma" > Run workflow), gratis.
   Toma obras con muchas reseñas, baja de AniList sus 8 reseñas más útiles y le pide a Gemma
   el resumen de dos formas, para comparar cuánto tarda y cómo queda:
   - antes: los primeros 500 caracteres de cada reseña (como se hacía hasta noviembre de 2026)
   - clave: las frases clave de cada reseña, como lo hace hoy scripts/resumenes.mjs
   Opciones: --obras N (cuántas, 3 si no se dice) y --etiqueta texto (para la tabla).
   Primera medición (22-nov-2026, 6 obras): con las frases clave Gemma lee un 28 % menos y cada
   resumen sale un 28 % más rápido, igual de concreto; más hilos o dos a la vez en la misma
   máquina lo hacen más lento.
   El registro de las tareas es público: no muestra el texto de las reseñas, solo tiempos y resúmenes.
=================================== */
import { readFile, appendFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { construirPedido, revisarResumen, resenasParaResumen, MODELO_RESUMEN, RESENAS_EN_RESUMEN } from '../../scripts/resumenes.mjs';
import { textoParaResumen } from '../../scripts/analisis.mjs';
import { crearClasificador } from '../../scripts/tono.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OLLAMA = 'http://127.0.0.1:11434';
const ANILIST = 'https://graphql.anilist.co';
const opcion = (nombre, siNo) => { const i = process.argv.indexOf(nombre); return i >= 0 ? process.argv[i + 1] : siNo; };
const OBRAS = Number(opcion('--obras', 3)) || 3;
const ETIQUETA = opcion('--etiqueta', 'Gemma');
const dormir = ms => new Promise(r => setTimeout(r, ms));
const s = x => Math.round(x * 10) / 10;

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
    console.log(`Máquina: ${cpus().length} núcleos (${cpus()[0] && cpus()[0].model}), ${Math.round(totalmem() / 2 ** 30)} GB. Prueba: ${ETIQUETA}.`);
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

    const clasificador = await crearClasificador({ carpeta: join(RAIZ, '.modelos'), registro: console.log });
    const pedidos = [];
    for (const { o, c } of elegidas){
        const resenas = await resenasDe(o.ids.anilist);
        const base = { titulo: o.titulo, tipo: o.tipo, datos: { n: c.resenas.n, positivas: c.resenas.positivas, negativas: c.resenas.negativas, mixtas: c.resenas.mixtas, elogian: c.resenas.elogian, critican: c.resenas.critican } };
        const antes = resenas.map(r => ({ nota: r.score, resumen: textoParaResumen(r.summary, 200), texto: textoParaResumen(r.body, 500) }));
        pedidos.push({ titulo: o.titulo, hoy: c.resumen.texto, variantes: {
            antes: construirPedido({ ...base, resenas: antes }),
            clave: construirPedido({ ...base, resenas: await resenasParaResumen(resenas, clasificador) })
        } });
    }

    // Calentar con algo distinto: la primera consulta carga el modelo en memoria (no cuenta)
    const calentar = await pedir({ sistema: 'Responde en JSON.', usuario: 'Escribe {"resumen": "hola"}' });
    console.log(`Modelo cargado (primera consulta: ${s(calentar.total)} s).\n`);

    const medidas = {};
    for (const p of pedidos){
        console.log(`${p.titulo}\n  hoy en la página: ${p.hoy}`);
        for (const [nombre, pedido] of Object.entries(p.variantes)){
            const m = await pedir(pedido);
            (medidas[nombre] = medidas[nombre] || []).push(m);
            console.log(linea(nombre, m));
            console.log(`  ${''.padEnd(12)} ${m.texto}`);
        }
        console.log('');
    }

    const tabla = ['| Forma | Caracteres | Tokens leídos | Lectura (tokens/s) | Escritura (tokens/s) | Segundos por resumen | Pasan la revisión |', '|---|---|---|---|---|---|---|'];
    console.log(`PROMEDIOS (${ETIQUETA})`);
    for (const [nombre, lista] of Object.entries(medidas)){
        const prom = f => lista.reduce((a, m) => a + f(m), 0) / lista.length;
        const fila = [nombre, Math.round(prom(m => m.caracteres)), Math.round(prom(m => m.entrada)), s(prom(m => m.entrada / (m.tEntrada || 1))),
            s(prom(m => m.salida / (m.tSalida || 1))), s(prom(m => m.total)), `${lista.filter(m => m.pasa).length}/${lista.length}`];
        console.log(`  ${fila.join(' · ')}`);
        tabla.push(`| ${fila.join(' | ')} |`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### ${ETIQUETA}\n\n${tabla.join('\n')}\n\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href){
    principal().catch(error => { console.error('Error:', error.message); process.exit(1); });
}
