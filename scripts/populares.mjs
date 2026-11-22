/* ===================================
   FROZEN PROJECT: lo más popular de hoy, de la semana y del mes
   Lo corre GitHub todos los días (.github/workflows/populares.yml), gratis. Es liviano:
   no usa modelos ni otras comunidades, solo la actividad diaria que AniList guarda de
   cada obra (gente que la agrega a su lista o avanza capítulos) y cuántos la tienen.
   1. Lee el catálogo (obras.json).
   2. Pide a AniList, de a varias obras por consulta, sus últimos 31 días de actividad.
   3. Por tipo (manga, manhwa, manhua) ordena las obras por su actividad de hoy, de los
      últimos 7 días y de los últimos 30, y guarda las primeras en datos/populares.json
      junto con cuántos lectores nuevos sumaron en ese tiempo.
   Para probarlo en tu PC: node scripts/populares.mjs   (Node 18 o más nuevo; no necesita npm)
=================================== */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ANILIST = 'https://graphql.anilist.co';
const AGENTE = 'FrozenProject/1.0 (+https://frozen-project.vercel.app)';
const PAUSA = 2200;              // AniList hoy permite unas 30 consultas por minuto
const OBRAS_POR_CONSULTA = 10;   // 10 obras × 31 días: una consulta liviana para AniList
const DIAS = 31;
const PRIMERAS = 5;              // se guardan las 5 primeras de cada tipo (Inicio muestra 2)
const DIA = 86400;
export const TIPOS = ['manga', 'manhwa', 'manhua'];
export const PERIODOS = { hoy: 1, semana: 7, mes: 30 };

const CONSULTA = `query ($ids: [Int], $p: Int) {
    Page(page: $p, perPage: ${OBRAS_POR_CONSULTA}) { pageInfo { hasNextPage }
        media(id_in: $ids, type: MANGA) { id popularity
            trends(sort: DATE_DESC, perPage: ${DIAS}) { nodes { date trending popularity } } } } }`;

const dormir = ms => new Promise(r => setTimeout(r, ms));

// Pide a AniList respetando la pausa; reintenta si está ocupado (429) o falla (5xx o la red)
export function crearPedido({ fetch = globalThis.fetch, esperar = dormir, registro = console.log } = {}){
    let ultima = 0;
    return async function pedir(variables, intentos = 5){
        for (let intento = 1; intento <= intentos; intento++){
            const falta = ultima + PAUSA - Date.now();
            if (falta > 0) await esperar(falta);
            ultima = Date.now();
            let r;
            try {
                r = await fetch(ANILIST, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': AGENTE },
                    body: JSON.stringify({ query: CONSULTA, variables }),
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
            const datos = await r.json();
            if (!r.ok || (datos.errors && datos.errors.length)){
                throw new Error('AniList: ' + ((datos.errors || []).map(e => e.message).join('; ') || r.status));
            }
            return datos.data;
        }
    };
}

/* Actividad y lectores nuevos de una obra en cada periodo.
   nodos: [{ date (segundos, un día UTC), trending, popularity }]; ref: el último día con datos de todo el catálogo.
   Los días sin actividad no aparecen en AniList: cuentan como 0. */
export function medir(nodos, ref, popularidadActual){
    const dias = (nodos || []).filter(n => n && Number.isFinite(n.date) && n.date <= ref).sort((a, b) => b.date - a.date);
    const conLectores = dias.filter(n => Number.isFinite(n.popularity) && n.popularity > 0);
    const resultado = {};
    for (const [periodo, largo] of Object.entries(PERIODOS)){
        const actividad = dias.filter(n => n.date > ref - largo * DIA)
            .reduce((suma, n) => suma + (Number.isFinite(n.trending) && n.trending > 0 ? n.trending : 0), 0);
        // Lectores nuevos: los de hoy contra los del día más cercano al inicio del periodo
        let nuevos = null;
        const ultimo = conLectores[0];
        if (ultimo){
            const objetivo = ultimo.date - largo * DIA;
            const margen = Math.max(1, Math.round(largo * 0.15)) * DIA;
            const antes = conLectores
                .filter(n => n.date < ultimo.date && Math.abs(n.date - objetivo) <= margen)
                .sort((a, b) => Math.abs(a.date - objetivo) - Math.abs(b.date - objetivo))[0];
            if (antes) nuevos = Math.max(0, ultimo.popularity - antes.popularity);
        }
        resultado[periodo] = { actividad, nuevos };
    }
    resultado.popularidad = Number.isFinite(popularidadActual) ? popularidadActual : (conLectores[0] ? conLectores[0].popularity : 0);
    return resultado;
}

// Las primeras de cada tipo en cada periodo: más actividad primero; empate, más lectores nuevos y más popular
export function ordenar(obras, medidas){
    const periodos = {};
    for (const periodo of Object.keys(PERIODOS)){
        periodos[periodo] = {};
        for (const tipo of TIPOS){
            periodos[periodo][tipo] = obras
                .filter(o => o.tipo === tipo && medidas.has(o.id) && medidas.get(o.id)[periodo].actividad > 0)
                .map(o => ({ o, m: medidas.get(o.id) }))
                .sort((a, b) => (b.m[periodo].actividad - a.m[periodo].actividad)
                    || ((b.m[periodo].nuevos || 0) - (a.m[periodo].nuevos || 0))
                    || (b.m.popularidad - a.m.popularidad))
                .slice(0, PRIMERAS)
                .map(({ o, m }) => ({ id: o.id, actividad: m[periodo].actividad, nuevos: m[periodo].nuevos }));
        }
    }
    return periodos;
}

export async function ejecutar({ raiz, pedir = crearPedido(), registro = console.log, ahora = new Date() } = {}){
    const ruta = p => join(raiz, p);
    const catalogo = JSON.parse(await readFile(ruta('obras.json'), 'utf8'));
    const obras = (catalogo.obras || []).filter(o => o && o.id && TIPOS.includes(o.tipo) && o.ids && o.ids.anilist);
    const porAniList = new Map(obras.map(o => [Number(o.ids.anilist), o]));
    const ids = [...porAniList.keys()];
    registro(`Actividad de ${ids.length} obras en AniList…`);

    const nodosDe = new Map();   // id del catálogo → { nodos, popularidad }
    for (let i = 0; i < ids.length; i += OBRAS_POR_CONSULTA){
        const lote = ids.slice(i, i + OBRAS_POR_CONSULTA);
        const data = await pedir({ ids: lote, p: 1 });
        for (const m of (data.Page && data.Page.media) || []){
            const o = porAniList.get(m.id);
            if (o) nodosDe.set(o.id, { nodos: (m.trends && m.trends.nodes) || [], popularidad: m.popularity });
        }
    }

    // El último día con datos (el "hoy" de AniList, en hora UTC)
    let ref = 0;
    nodosDe.forEach(({ nodos }) => nodos.forEach(n => { if (Number.isFinite(n.date) && n.date > ref) ref = n.date; }));
    if (!ref) throw new Error('AniList no devolvió actividad para ninguna obra.');

    const medidas = new Map();
    nodosDe.forEach((v, id) => medidas.set(id, medir(v.nodos, ref, v.popularidad)));
    const periodos = ordenar(obras, medidas);

    const salida = {
        actualizado: ahora.toISOString(),
        dia: new Date(ref * 1000).toISOString().slice(0, 10),
        metodo: 'Actividad diaria de AniList (gente que agrega la obra o avanza capítulos) en el último día, 7 días y 30 días.',
        periodos
    };
    await mkdir(ruta('datos'), { recursive: true });
    await writeFile(ruta('datos/populares.json'), JSON.stringify(salida, null, 2) + '\n');
    const resumen = Object.entries(periodos).map(([p, t]) => `${p}: ${TIPOS.map(x => t[x][0] ? t[x][0].id : '—').join(', ')}`).join(' | ');
    registro(`Listo (${salida.dia}). ${resumen}`);
    return salida;
}

// Si se ejecuta directamente (node scripts/populares.mjs), corre sobre el repositorio
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href){
    const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
    ejecutar({ raiz }).catch(error => {
        console.error('Error:', error.message);
        process.exit(1);
    });
}
