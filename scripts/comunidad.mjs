/* ===================================
   FROZEN PROJECT: "Lo que opina la comunidad"
   Lo corre GitHub cada lunes (.github/workflows/comunidad.yml), gratis.
   1. Lee el catálogo (obras.json).
   2. Trae puntajes y votos de AniList, Kitsu y MangaUpdates (y MyAnimeList si hay
      una clave en el secreto MAL_CLIENT_ID), el reparto de votos y las reseñas de AniList.
   3. Calcula el puntaje combinado, qué tanto coincide la gente, qué elogian o critican
      las reseñas y cómo cambió frente a la semana anterior (ver analisis.mjs).
   4. Guarda datos/comunidad.json (lo lee la página), datos/ids.json y datos/historial.json.
   No guarda texto de reseñas ni nombres de usuario: solo números y temas.
   Para probarlo en tu PC: node scripts/comunidad.mjs   (necesita Node 18 o más nuevo)
=================================== */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    METODO, combinarPuntajes, analizarDistribucion, analizarResenas, calcularTendencia, elegirSerie, redondear
} from './analisis.mjs';

const AGENTE = 'FrozenProject/1.0 (+https://sorryfriend49.github.io)';
const ANILIST = 'https://graphql.anilist.co';
const KITSU = 'https://kitsu.io/api/edge';
const MANGAUPDATES = 'https://api.mangaupdates.com/v1';
const MAL = 'https://api.myanimelist.net/v2';

// Tiempo mínimo entre consultas a cada sitio (AniList hoy permite 30 por minuto)
const PAUSA = { 'graphql.anilist.co': 2200, 'kitsu.io': 400, 'api.mangaupdates.com': 1100, 'api.myanimelist.net': 700 };
const RESENAS_POR_OBRA = 50;            // las más útiles según los lectores de AniList
const DIAS_PARA_REBUSCAR = 30;          // si una obra no apareció en MangaUpdates, se vuelve a buscar al mes
const SEMANAS_DE_HISTORIAL = 12;

const dormir = ms => new Promise(r => setTimeout(r, ms));
const hoy = fecha => fecha.toISOString().slice(0, 10);
const diasEntre = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

async function leerJSON(ruta, siNoExiste){
    try { return JSON.parse(await readFile(ruta, 'utf8')); }
    catch (error){ if (error.code === 'ENOENT') return siNoExiste; throw error; }
}

async function escribirJSON(ruta, datos){
    await mkdir(dirname(ruta), { recursive: true });
    await writeFile(ruta, JSON.stringify(datos, null, 2) + '\n');
}

// Pide JSON respetando la pausa de cada sitio; reintenta si el sitio está ocupado (429) o falla (5xx)
function crearCliente({ fetch, esperar, registro }){
    const ultimaVez = new Map();
    return async function pedir(url, opciones = {}, intentos = 4){
        const sitio = new URL(url).host;
        for (let intento = 1; intento <= intentos; intento++){
            const falta = (ultimaVez.get(sitio) || 0) + (PAUSA[sitio] || 500) - Date.now();
            if (falta > 0) await esperar(falta);
            ultimaVez.set(sitio, Date.now());
            let respuesta;
            try {
                respuesta = await fetch(url, {
                    ...opciones,
                    headers: { 'User-Agent': AGENTE, Accept: 'application/json', ...(opciones.headers || {}) },
                    signal: AbortSignal.timeout(30000)
                });
            } catch (error){
                if (intento === intentos) throw error;
                await esperar(2000 * intento);
                continue;
            }
            if (respuesta.status === 429 || respuesta.status >= 500){
                const segundos = Number(respuesta.headers.get('retry-after')) || 10 * intento;
                if (intento === intentos) throw new Error(`${sitio} respondió ${respuesta.status}`);
                registro(`  ${sitio} respondió ${respuesta.status}; espero ${segundos} s`);
                await esperar(segundos * 1000);
                continue;
            }
            if (!respuesta.ok) throw Object.assign(new Error(`${sitio} respondió ${respuesta.status}`), { status: respuesta.status });
            return respuesta.json();
        }
    };
}

/* ---------- AniList ---------- */
async function graphql(pedir, query, variables){
    const r = await pedir(ANILIST, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
    if (r.errors && r.errors.length) throw new Error('AniList: ' + r.errors.map(e => e.message).join('; '));
    return r.data;
}

async function traerAniList(pedir, ids){
    const query = `query ($ids: [Int], $p: Int) { Page(page: $p, perPage: 50) { pageInfo { hasNextPage }
        media(id_in: $ids, type: MANGA) { id meanScore averageScore popularity favourites
            stats { scoreDistribution { score amount } } } } }`;
    const porId = new Map();
    for (let p = 1; ; p++){
        const data = await graphql(pedir, query, { ids, p });
        for (const m of data.Page.media) porId.set(m.id, m);
        if (!data.Page.pageInfo.hasNextPage) break;
    }
    return porId;
}

async function traerResenas(pedir, id){
    const query = `query ($id: Int, $p: Int) { Page(page: $p, perPage: 25) { pageInfo { hasNextPage }
        reviews(mediaId: $id, sort: RATING_DESC) { score rating ratingAmount body } } }`;
    const resenas = [];
    for (let p = 1; resenas.length < RESENAS_POR_OBRA; p++){
        const data = await graphql(pedir, query, { id, p });
        resenas.push(...data.Page.reviews);
        if (!data.Page.pageInfo.hasNextPage) break;
    }
    return resenas.slice(0, RESENAS_POR_OBRA);
}

/* ---------- Kitsu (se encuentra con el ID de AniList o el de MyAnimeList) ---------- */
function datosKitsu(manga){
    if (!manga || !manga.attributes) return null;
    const votos = Object.values(manga.attributes.ratingFrequencies || {}).reduce((a, b) => a + Number(b || 0), 0);
    const puntaje = Number(manga.attributes.averageRating);
    if (!votos || !Number.isFinite(puntaje)) return null;
    return { puntaje: redondear(puntaje, 1), votos };
}

async function traerKitsu(pedir, obra, guardado){
    const encabezados = { headers: { Accept: 'application/vnd.api+json' } };
    if (guardado && guardado.kitsu){
        const r = await pedir(`${KITSU}/manga/${guardado.kitsu}`, encabezados);
        return { id: guardado.kitsu, datos: datosKitsu(r.data) };
    }
    const intentos = [['anilist/manga', obra.ids.anilist], ['myanimelist/manga', obra.ids.mal]].filter(([, id]) => id);
    for (const [sitio, id] of intentos){
        const r = await pedir(`${KITSU}/mappings?filter[externalSite]=${sitio}&filter[externalId]=${id}&include=item`, encabezados);
        const manga = (r.included || []).find(i => i.type === 'manga');
        if (manga) return { id: manga.id, datos: datosKitsu(manga) };
    }
    return { id: null, datos: null };
}

/* ---------- MangaUpdates (no tiene el ID de AniList: se busca por título, año y tipo) ---------- */
function datosMangaUpdates(serie){
    const puntaje = Number(serie && serie.bayesian_rating);
    const votos = Number(serie && serie.rating_votes);
    if (!Number.isFinite(puntaje) || !votos) return null;
    return { puntaje: redondear(puntaje * 10, 1), votos };
}

async function traerMangaUpdates(pedir, obra, guardado, fecha){
    if (guardado && guardado.mangaupdates){
        const serie = await pedir(`${MANGAUPDATES}/series/${guardado.mangaupdates}`);
        return { id: guardado.mangaupdates, datos: datosMangaUpdates(serie), buscado: guardado.buscado };
    }
    if (guardado && guardado.buscado && diasEntre(guardado.buscado, fecha) < DIAS_PARA_REBUSCAR){
        return { id: null, datos: null, buscado: guardado.buscado };   // ya se buscó hace poco y no estaba
    }
    const titulos = [...new Set([obra.titulos && obra.titulos.ingles, obra.titulo, obra.titulos && obra.titulos.romaji].filter(Boolean))];
    for (const titulo of titulos){
        const r = await pedir(`${MANGAUPDATES}/series/search`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ search: titulo, perpage: 10 })
        });
        const serie = elegirSerie(obra, r.results || []);
        if (serie) return { id: serie.series_id, datos: datosMangaUpdates(serie), buscado: fecha };
    }
    return { id: null, datos: null, buscado: fecha };
}

/* ---------- MyAnimeList (opcional: necesita una clave gratis en el secreto MAL_CLIENT_ID) ---------- */
async function traerMAL(pedir, obra, clave){
    if (!clave || !obra.ids.mal) return null;
    const r = await pedir(`${MAL}/manga/${obra.ids.mal}?fields=mean,num_scoring_users`, { headers: { 'X-MAL-CLIENT-ID': clave } });
    if (!Number.isFinite(r.mean) || !r.num_scoring_users) return null;
    return { puntaje: redondear(r.mean * 10, 1), votos: r.num_scoring_users };
}

/* ---------- Programa principal ---------- */
export async function ejecutar({
    raiz,
    fetch = globalThis.fetch,
    ahora = new Date(),
    esperar = dormir,
    registro = console.log,
    claveMAL = process.env.MAL_CLIENT_ID || ''
} = {}){
    const fecha = hoy(ahora);
    const pedir = crearCliente({ fetch, esperar, registro });
    const ruta = nombre => join(raiz, nombre);

    const catalogo = await leerJSON(ruta('obras.json'));
    const obras = (catalogo.obras || []).filter(o => o.ids && o.ids.anilist);
    const ids = await leerJSON(ruta('datos/ids.json'), { obras: {} });
    const anterior = await leerJSON(ruta('datos/comunidad.json'), { obras: {}, fuentes: {} });
    const historial = await leerJSON(ruta('datos/historial.json'), { semanas: [] });
    registro(`Catálogo: ${obras.length} obras. Fecha: ${fecha}.`);

    // 1. AniList es la base: si falla, no se publica nada nuevo
    const anilist = await traerAniList(pedir, obras.map(o => o.ids.anilist));
    registro(`AniList: ${anilist.size} obras con puntaje y reparto de votos.`);

    // Promedio del catálogo, para el promedio bayesiano
    const medias = [...anilist.values()].map(m => m.meanScore).filter(Number.isFinite);
    const mediaCatalogo = medias.length ? medias.reduce((a, b) => a + b, 0) / medias.length : 75;

    const fuentesOk = { anilist: true, kitsu: true, mangaupdates: true, myanimelist: Boolean(claveMAL) };
    const resultado = {};

    for (const obra of obras){
        const id = String(obra.ids.anilist);
        const previo = (anterior.obras || {})[id] || {};
        const guardado = ids.obras[id] || {};
        const m = anilist.get(obra.ids.anilist);
        if (!m){
            registro(`  ${obra.titulo}: AniList no la devolvió; se conserva lo anterior`);
            if (anterior.obras && anterior.obras[id]) resultado[id] = anterior.obras[id];
            continue;
        }

        const fuentes = {};
        const distribucion = analizarDistribucion(m.stats && m.stats.scoreDistribution);
        if (Number.isFinite(m.meanScore) && distribucion) fuentes.anilist = { puntaje: m.meanScore, votos: distribucion.votos };

        // Cada fuente extra es opcional: si falla, se usa su último dato
        const intentar = async (nombre, tarea) => {
            try { return await tarea(); }
            catch (error){
                fuentesOk[nombre] = false;
                registro(`  ${obra.titulo}: ${nombre} falló (${error.message}); se usa el dato anterior`);
                return undefined;
            }
        };

        const kitsu = await intentar('kitsu', () => traerKitsu(pedir, obra, guardado));
        if (kitsu){
            if (kitsu.id) guardado.kitsu = kitsu.id;
            if (kitsu.datos) fuentes.kitsu = kitsu.datos;
        } else if (previo.fuentes && previo.fuentes.kitsu) fuentes.kitsu = previo.fuentes.kitsu;

        const mu = await intentar('mangaupdates', () => traerMangaUpdates(pedir, obra, guardado, fecha));
        if (mu){
            if (mu.id) guardado.mangaupdates = mu.id;
            guardado.buscado = mu.buscado;
            if (mu.datos) fuentes.mangaupdates = mu.datos;
        } else if (previo.fuentes && previo.fuentes.mangaupdates) fuentes.mangaupdates = previo.fuentes.mangaupdates;

        if (claveMAL){
            const mal = await intentar('myanimelist', () => traerMAL(pedir, obra, claveMAL));
            if (mal) fuentes.myanimelist = mal;
            else if (mal === undefined && previo.fuentes && previo.fuentes.myanimelist) fuentes.myanimelist = previo.fuentes.myanimelist;
        }

        let resenas = previo.resenas || { n: 0 };
        try { resenas = analizarResenas(await traerResenas(pedir, obra.ids.anilist)); }
        catch (error){ registro(`  ${obra.titulo}: reseñas fallaron (${error.message}); se usa el dato anterior`); }

        ids.obras[id] = guardado;
        resultado[id] = {
            puntaje: combinarPuntajes(fuentes, mediaCatalogo),
            fuentes,
            distribucion,
            resenas,
            popularidad: m.popularity || null,
            favoritos: m.favourites || null
        };
        const p = resultado[id].puntaje;
        registro(`  ${obra.titulo}: ${p ? (p.valor / 10).toFixed(1) : '?'} (${Object.keys(fuentes).join(', ')}), ${resenas.n || 0} reseñas`);
    }

    // 2. Tendencia frente a la medición de hace 5 días o más
    const semanas = (historial.semanas || []).filter(s => s && s.fecha && s.obras);
    const referencia = [...semanas].reverse().find(s => diasEntre(s.fecha, fecha) >= 5);
    for (const [id, r] of Object.entries(resultado)){
        const antes = referencia && referencia.obras[id];
        r.tendencia = antes
            ? calcularTendencia({ popularidad: r.popularidad, puntaje: r.puntaje && r.puntaje.valor }, { popularidad: antes[0], puntaje: antes[1] }, diasEntre(referencia.fecha, fecha))
            : null;
    }

    // 3. Historial: una medición por semana (si se corre dos veces la misma semana, se reemplaza)
    const foto = { fecha, obras: Object.fromEntries(Object.entries(resultado).map(([id, r]) => [id, [r.popularidad, r.puntaje ? r.puntaje.valor : null]])) };
    const ultima = semanas[semanas.length - 1];
    if (ultima && diasEntre(ultima.fecha, fecha) < 5) semanas[semanas.length - 1] = foto;
    else semanas.push(foto);

    const fechasFuentes = Object.fromEntries(Object.entries(fuentesOk).map(([nombre, bien]) =>
        [nombre, bien ? fecha : ((anterior.fuentes || {})[nombre] || null)]));
    if (!claveMAL) fechasFuentes.myanimelist = null;

    await escribirJSON(ruta('datos/comunidad.json'), {
        esquema: 1,
        metodo: METODO,
        generado: ahora.toISOString(),
        fuentes: fechasFuentes,
        mediaCatalogo: redondear(mediaCatalogo, 1),
        obras: resultado
    });
    await escribirJSON(ruta('datos/ids.json'), ids);
    await escribirJSON(ruta('datos/historial.json'), { semanas: semanas.slice(-SEMANAS_DE_HISTORIAL) });
    registro(`Listo: ${Object.keys(resultado).length} obras en datos/comunidad.json.`);
    return resultado;
}

// Si se ejecuta directamente (node scripts/comunidad.mjs), corre sobre el repositorio
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href){
    const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
    ejecutar({ raiz }).catch(error => {
        console.error('Error:', error.message);
        process.exit(1);
    });
}
