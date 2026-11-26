/* ===================================
   FROZEN PROJECT: "Lo que opina la comunidad"
   Lo corre GitHub de lunes a viernes (.github/workflows/comunidad.yml), gratis.
   Cada día renueva por completo solo las obras que les toca (ver niveles.mjs: las que siguen
   saliendo, una vez por semana; las terminadas, una vez cada 4 semanas; las nuevas, apenas
   llegan) y, para todas, lo liviano de AniList (puntaje, reparto de votos y popularidad).
   Para renovarlas todas de una vez: TODAS=si node scripts/comunidad.mjs
   1. Lee el catálogo (obras.json).
   2. Trae puntajes y votos de AniList, Kitsu y MangaUpdates (y MyAnimeList si hay
      una clave en el secreto MAL_CLIENT_ID); de AniList, además, el reparto de votos,
      las reseñas, las etiquetas votadas, las recomendaciones y la actividad diaria.
   3. Calcula el puntaje combinado, qué tanto coincide la gente, qué elogian o critican
      las reseñas (con el modelo de sentimiento de tono.mjs) y cómo cambió en la última
      semana (ver analisis.mjs).
   4. Guarda datos/comunidad.json (lo lee la página), datos/ids.json y datos/historial.json.
   No guarda texto de reseñas ni nombres de usuario: solo números y temas.
   Para probarlo en tu PC: node scripts/comunidad.mjs   (necesita Node 18 o más nuevo;
   para usar el modelo, antes: npm ci --prefix scripts --ignore-scripts)
=================================== */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    METODO, combinarPuntajes, analizarDistribucion, analizarResenas, calcularTendencia, coincidencia, elegirSerie,
    normalizarTitulo, redondear, capitulosDeMangaUpdates, frasesConTemas, tonosConPalabras, evaluarTono, sumarEvaluaciones, aciertoEquilibrado,
    analizarActividad, prepararEtiquetas, prepararRecomendaciones, capitulosPlausibles, juntarCapitulos, fuentesConPuntaje
} from './analisis.mjs';
import { crearClasificador } from './tono.mjs';
import { necesitaResumen, VERSION_RESUMEN, MIN_RESENAS_RESUMEN } from './resumenes.mjs';
import { elegirDelDia } from './niveles.mjs';

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
// Versión de la forma de emparejar obras con MangaUpdates. Al subirla, todas las obras
// se vuelven a buscar una vez con la regla nueva (la 2 evita antologías y extras).
const EMPAREJADOR = 2;
// El acierto del modelo de tono se calcula con lo guardado de cada obra; con menos obras
// medidas que esto (los primeros días de los niveles), se mantiene el de la vez anterior
const MIN_OBRAS_ACIERTO = 50;

export const dormir = ms => new Promise(r => setTimeout(r, ms));
const hoy = fecha => fecha.toISOString().slice(0, 10);
const diasEntre = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
// El lunes de la semana de una fecha ('AAAA-MM-DD')
export const lunesDe = fecha => {
    const t = Date.parse(fecha.slice(0, 10) + 'T00:00:00Z');
    return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
};

export async function leerJSON(ruta, siNoExiste){
    try { return JSON.parse(await readFile(ruta, 'utf8')); }
    catch (error){ if (error.code === 'ENOENT') return siNoExiste; throw error; }
}

export async function escribirJSON(ruta, datos){
    await mkdir(dirname(ruta), { recursive: true });
    await writeFile(ruta, JSON.stringify(datos, null, 2) + '\n');
}

// Pide JSON respetando la pausa de cada sitio; reintenta si el sitio está ocupado (429) o falla (5xx)
export function crearCliente({ fetch, esperar, registro }){
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
            if (!respuesta.ok){
                let detalle = '';
                try { detalle = (await respuesta.text()).replace(/\s+/g, ' ').trim().slice(0, 160); } catch { detalle = ''; }
                throw Object.assign(new Error(`${sitio} respondió ${respuesta.status}${detalle ? ': ' + detalle : ''}`), { status: respuesta.status });
            }
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

/* Reseñas (las más útiles primero) y, en la misma consulta de la primera página, las etiquetas
   votadas, las recomendaciones "si te gustó…" y la actividad diaria de la obra */
const CONSULTA_DETALLES = `query ($id: Int, $p: Int, $detalles: Boolean!) {
    Media(id: $id) @include(if: $detalles) {
        tags { name rank category isMediaSpoiler isGeneralSpoiler }
        recommendations(sort: RATING_DESC, perPage: 12) { nodes { rating mediaRecommendation {
            id type format countryOfOrigin isAdult title { romaji english } coverImage { medium } } } }
        trends(sort: DATE_DESC, perPage: 10) { nodes { date trending popularity inProgress } }
    }
    Page(page: $p, perPage: 25) { pageInfo { hasNextPage }
        reviews(mediaId: $id, sort: RATING_DESC) { id summary score rating ratingAmount body } } }`;

async function traerDetalles(pedir, id){
    const resenas = [];
    let media = null;
    for (let p = 1; resenas.length < RESENAS_POR_OBRA; p++){
        const data = await graphql(pedir, CONSULTA_DETALLES, { id, p, detalles: p === 1 });
        if (p === 1) media = data.Media || null;
        resenas.push(...data.Page.reviews);
        if (!data.Page.pageInfo.hasNextPage) break;
    }
    return { resenas: resenas.slice(0, RESENAS_POR_OBRA), media };
}

/* ---------- Kitsu (se encuentra con el ID de AniList o el de MyAnimeList) ---------- */
// Kitsu no calcula el promedio hasta juntar suficientes votos: llega null (antes se leía como 0)
export function datosKitsu(manga){
    if (!manga || !manga.attributes) return null;
    const votos = Object.values(manga.attributes.ratingFrequencies || {}).reduce((a, b) => a + Number(b || 0), 0);
    const promedio = manga.attributes.averageRating;
    const puntaje = promedio === null || promedio === undefined || promedio === '' ? NaN : Number(promedio);
    if (!votos || !Number.isFinite(puntaje) || puntaje <= 0) return null;
    return { puntaje: redondear(puntaje, 1), votos };
}

// Capítulos y tomos según Kitsu (suele tenerlos de las obras en pausa o terminadas, como Vagabond)
export function capitulosKitsu(manga){
    const a = (manga && manga.attributes) || {};
    return capitulosPlausibles({ ultimo: a.chapterCount, tomos: a.volumeCount });
}

async function traerKitsu(pedir, obra, guardado){
    const encabezados = { headers: { Accept: 'application/vnd.api+json' } };
    if (guardado && guardado.kitsu){
        const r = await pedir(`${KITSU}/manga/${guardado.kitsu}`, encabezados);
        return { id: guardado.kitsu, datos: datosKitsu(r.data), capitulos: capitulosKitsu(r.data) };
    }
    const intentos = [['anilist/manga', obra.ids.anilist], ['myanimelist/manga', obra.ids.mal]].filter(([, id]) => id);
    for (const [sitio, id] of intentos){
        const r = await pedir(`${KITSU}/mappings?filter[externalSite]=${sitio}&filter[externalId]=${id}&include=item`, encabezados);
        const manga = (r.included || []).find(i => i.type === 'manga');
        if (manga) return { id: manga.id, datos: datosKitsu(manga), capitulos: capitulosKitsu(manga) };
    }
    return { id: null, datos: null };
}

/* ---------- MangaUpdates (no tiene el ID de AniList: se busca por título, año y tipo) ---------- */
// La serie fijada a mano en catalogo.json ("mangaupdates"): su número, o el código de su dirección
// (en https://www.mangaupdates.com/series/lzjwjkf/... es "lzjwjkf", que es ese número en base 36)
export function mangaUpdatesManual(obra){
    const valor = obra && obra.mangaupdates;
    if (typeof valor === 'number' && Number.isSafeInteger(valor) && valor > 0) return valor;
    if (typeof valor !== 'string') return null;
    const texto = valor.trim().toLowerCase();
    if (/^\d+$/.test(texto)) return Number(texto);
    if (/^[0-9a-z]{1,12}$/.test(texto)){
        const numero = parseInt(texto, 36);
        return Number.isSafeInteger(numero) ? numero : null;
    }
    return null;
}

function datosMangaUpdates(serie){
    const puntaje = Number(serie && serie.bayesian_rating);
    const votos = Number(serie && serie.rating_votes);
    if (!Number.isFinite(puntaje) || !votos) return null;
    return { puntaje: redondear(puntaje * 10, 1), votos };
}

async function traerMangaUpdates(pedir, obra, guardado, fecha){
    if (guardado && guardado.mangaupdates){
        const serie = await pedir(`${MANGAUPDATES}/series/${guardado.mangaupdates}`);
        return { id: guardado.mangaupdates, titulo: serie.title || guardado.mangaupdatesTitulo, datos: datosMangaUpdates(serie),
            capitulos: capitulosDeMangaUpdates(serie), buscado: guardado.buscado };
    }
    if (guardado && guardado.buscado && diasEntre(guardado.buscado, fecha) < DIAS_PARA_REBUSCAR){
        return { id: null, datos: null, buscado: guardado.buscado };   // ya se buscó hace poco y no estaba
    }
    // Se busca con el título en inglés, el principal, el romaji y hasta 3 sinónimos (p. ej. "19 Days"),
    // se juntan los resultados y se elige el mejor; se para antes si aparece el mismo título principal.
    const vistos = new Set();
    const titulos = [obra.titulos && obra.titulos.ingles, obra.titulo, obra.titulos && obra.titulos.romaji, ...(obra.sinonimos || []).slice(0, 3)]
        .filter(t => t && !vistos.has(normalizarTitulo(t)) && vistos.add(normalizarTitulo(t)));
    const resultados = [];
    for (const titulo of titulos){
        const r = await pedir(`${MANGAUPDATES}/series/search`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ search: titulo, perpage: 10 })
        });
        resultados.push(...(r.results || []));
        const mejor = elegirSerie(obra, resultados);
        if (mejor && coincidencia(obra, mejor) === 3) break;
    }
    const serie = elegirSerie(obra, resultados);
    if (serie){
        // La búsqueda no trae el estado ni el último capítulo: se piden los detalles de la serie elegida
        let detalles = null;
        try { detalles = await pedir(`${MANGAUPDATES}/series/${serie.series_id}`); } catch { detalles = null; }
        return { id: serie.series_id, titulo: serie.title, nueva: true, votos: serie.rating_votes, anio: serie.year,
            datos: datosMangaUpdates(detalles || serie), capitulos: capitulosDeMangaUpdates(detalles || serie), buscado: fecha };
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

/* Acierto del modelo de tono en todo el catálogo: suma lo que acertó en cada obra la última vez
   que se renovó. Los primeros días de los niveles (pocas obras medidas) se mantiene el de antes. */
export function aciertoTotal(resultado, tonoAnterior, metodo){
    let medidas = 0;
    const total = { positivas: { aciertos: 0, total: 0 }, negativas: { aciertos: 0, total: 0 } };
    for (const r of Object.values(resultado)){
        const e = r && r.evaluacion;
        if (!Array.isArray(e) || e.length !== 4 || !e.every(Number.isFinite)) continue;
        medidas++;
        total.positivas.aciertos += e[0]; total.positivas.total += e[1];
        total.negativas.aciertos += e[2]; total.negativas.total += e[3];
    }
    if (medidas < MIN_OBRAS_ACIERTO && tonoAnterior && tonoAnterior.metodo === metodo && Number.isFinite(tonoAnterior.acierto)){
        return { metodo, acierto: tonoAnterior.acierto };
    }
    return { metodo, acierto: aciertoEquilibrado(total) };
}

/* ---------- Programa principal ---------- */
export async function ejecutar({
    raiz,
    fetch = globalThis.fetch,
    ahora = new Date(),
    esperar = dormir,
    registro = console.log,
    claveMAL = (process.env.MAL_CLIENT_ID || '').trim(),
    clasificador = null,           // tono de las frases; si no se pasa, se carga el modelo (tono.mjs)
    todas = /^(si|sí|true|1)$/i.test((process.env.TODAS || '').trim())   // renovar todas, no solo las del día
} = {}){
    const fecha = hoy(ahora);
    const pedir = crearCliente({ fetch, esperar, registro });
    const ruta = nombre => join(raiz, nombre);
    if (!clasificador) clasificador = await crearClasificador({ carpeta: ruta('.modelos'), registro });
    let evaluacionModelo = { positivas: { aciertos: 0, total: 0 }, negativas: { aciertos: 0, total: 0 } };
    let evaluacionPalabras = evaluacionModelo;
    const sinTraducir = new Set();
    const pendientes = [];          // obras que necesitan un resumen nuevo (los escribe resumenes.mjs)

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

    // Las obras que hoy se renuevan por completo (las demás: solo lo liviano de AniList)
    const eleccion = elegirDelDia(obras, anterior, fecha, {
        todas,
        faltaResumen: previo => necesitaResumen(previo.resenas, previo.resumen && previo.resumen.version === VERSION_RESUMEN ? previo.resumen : null, fecha)
    });
    // También hoy, aunque no les toque: las que tienen algo por corregir (una MangaUpdates fijada a
    // mano en catalogo.json distinta de la guardada, o un número de capítulos imposible)
    const porCorregir = obras.filter(o => {
        const id = String(o.ids.anilist);
        if (eleccion.ids.has(id)) return false;
        const guardado = ids.obras[id] || {};
        const previo = (anterior.obras || {})[id];
        const fijada = mangaUpdatesManual(o);
        const manual = Boolean(fijada) && String(guardado.mangaupdates) !== String(fijada);
        const capitulos = previo && previo.capitulos;
        const imposibles = Boolean(capitulos && capitulos.ultimo && !(capitulosPlausibles(capitulos) || {}).ultimo);
        return manual || imposibles;
    });
    porCorregir.forEach(o => eleccion.ids.add(String(o.ids.anilist)));
    if (porCorregir.length) registro(`Además se renuevan ${porCorregir.length} para corregir sus datos: ${porCorregir.map(o => o.titulo).join(', ')}.`);
    const respaldo = typeof anterior.generado === 'string' ? anterior.generado.slice(0, 10) : null;
    const { nueva, atrasada, delDia, sinResumen } = eleccion.motivos;
    registro(todas
        ? `Hoy se renuevan todas las obras (${eleccion.ids.size}).`
        : `Hoy se renuevan por completo ${eleccion.ids.size} obras: ${delDia} del día, ${nueva} nuevas, ${atrasada} atrasadas y ${sinResumen} sin resumen` +
          `${eleccion.quedan ? ` (${eleccion.quedan} quedan para mañana)` : ''}. Las demás, solo lo de AniList.`);

    // Una fuente queda con la fecha de hoy si aportó datos frescos a alguna obra
    const fuentesUsadas = { anilist: true, kitsu: false, mangaupdates: false, myanimelist: false };
    const resultado = {};
    // MyAnimeList: si rechaza la clave en las primeras obras (400, 401 o 403), no se insiste con las demás
    let malActivo = Boolean(claveMAL);
    let malRespondio = false;
    let malRechazos = 0;

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

        // Hoy no le toca: lo de AniList al día y lo demás como quedó la última vez
        if (!eleccion.ids.has(id)){
            const otras = Object.fromEntries(Object.entries(fuentesConPuntaje(previo.fuentes)).filter(([nombre]) => nombre !== 'anilist'));
            const fuentesHoy = fuentes.anilist ? { anilist: fuentes.anilist, ...otras } : fuentesConPuntaje(previo.fuentes);
            resultado[id] = {
                ...previo,
                puntaje: combinarPuntajes(fuentesHoy, mediaCatalogo),
                fuentes: fuentesHoy,
                capitulos: capitulosPlausibles(previo.capitulos),
                distribucion: distribucion || previo.distribucion || null,
                popularidad: m.popularity || previo.popularidad || null,
                favoritos: m.favourites || previo.favoritos || null,
                revisada: 'revisada' in previo ? previo.revisada : (Object.keys(previo).length ? respaldo : null)
            };
            continue;
        }

        // Cada fuente extra es opcional: si falla, se usa su último dato
        const intentar = async (nombre, tarea) => {
            try {
                const datos = await tarea();
                fuentesUsadas[nombre] = true;
                return datos;
            } catch (error){
                registro(`  ${obra.titulo}: ${nombre} falló (${error.message}); se usa el dato anterior`);
                return undefined;
            }
        };

        const kitsu = await intentar('kitsu', () => traerKitsu(pedir, obra, guardado));
        if (kitsu){
            if (kitsu.id) guardado.kitsu = kitsu.id;
            if (kitsu.datos) fuentes.kitsu = kitsu.datos;
        } else if (previo.fuentes && previo.fuentes.kitsu && previo.fuentes.kitsu.puntaje > 0) fuentes.kitsu = previo.fuentes.kitsu;

        // MangaUpdates fijada a mano en catalogo.json (cuando la búsqueda elige otra versión de la obra):
        // se usa esa, y lo que se guardó de la anterior no se reusa
        const manual = mangaUpdatesManual(obra);
        const cambioManual = Boolean(manual) && String(guardado.mangaupdates) !== String(manual);
        if (manual){
            if (cambioManual) delete guardado.mangaupdatesTitulo;
            guardado.mangaupdates = manual;
            guardado.emparejador = EMPAREJADOR;
        }
        // Si la obra se emparejó con una regla vieja, se vuelve a buscar (y su dato anterior no se reusa)
        const emparejadaAlDia = (guardado.emparejador || 1) >= EMPAREJADOR && !cambioManual;
        if ((guardado.emparejador || 1) < EMPAREJADOR){ delete guardado.mangaupdates; delete guardado.mangaupdatesTitulo; delete guardado.buscado; }
        const mu = await intentar('mangaupdates', () => traerMangaUpdates(pedir, obra, guardado, fecha));
        // Capítulos y tomos publicados hasta ahora (AniList no los da mientras la obra sigue saliendo):
        // los de MangaUpdates y, si los tiene, los de Kitsu (el mayor número creíble)
        let capitulos = (emparejadaAlDia && capitulosPlausibles(previo.capitulos)) || null;
        if (mu) capitulos = mu.capitulos || (mu.id ? capitulos : null);
        capitulos = juntarCapitulos(capitulos, kitsu && kitsu.capitulos);
        if (mu){
            if (mu.id){ guardado.mangaupdates = mu.id; guardado.mangaupdatesTitulo = mu.titulo; }
            guardado.buscado = mu.buscado;
            guardado.emparejador = EMPAREJADOR;
            if (mu.datos) fuentes.mangaupdates = mu.datos;
            if (mu.nueva) registro(`  ${obra.titulo} → MangaUpdates: "${mu.titulo}" (${mu.anio || 'sin año'}, ${mu.votos || 0} votos)`);
            else if (!mu.id && mu.buscado === fecha) registro(`  ${obra.titulo} → no está en MangaUpdates`);
        } else if (emparejadaAlDia && previo.fuentes && previo.fuentes.mangaupdates && previo.fuentes.mangaupdates.puntaje > 0) fuentes.mangaupdates = previo.fuentes.mangaupdates;

        if (malActivo){
            try {
                const mal = await traerMAL(pedir, obra, claveMAL);
                if (mal){
                    fuentes.myanimelist = mal;
                    fuentesUsadas.myanimelist = true;
                    malRespondio = true;
                }
            } catch (error){
                if (!malRespondio && [400, 401, 403].includes(error.status) && ++malRechazos >= 3){
                    malActivo = false;
                    registro(`MyAnimeList rechazó la clave (${error.message}). Revisa el secreto MAL_CLIENT_ID ` +
                        `(tiene ${claveMAL.length} caracteres; una clave de MyAnimeList tiene 32). Esta vez se sigue sin MyAnimeList.`);
                } else {
                    registro(`  ${obra.titulo}: myanimelist falló (${error.message}); se usa el dato anterior`);
                }
                if (previo.fuentes && previo.fuentes.myanimelist) fuentes.myanimelist = previo.fuentes.myanimelist;
            }
        } else if (claveMAL && previo.fuentes && previo.fuentes.myanimelist){
            fuentes.myanimelist = previo.fuentes.myanimelist;
        }

        // Reseñas, etiquetas, recomendaciones y actividad (si fallan, se conserva lo anterior)
        let resenas = previo.resenas || { n: 0 };
        let etiquetas = previo.etiquetas || [];
        let recomendaciones = previo.recomendaciones || [];
        let actividad = previo.actividad || null;
        let resumen = previo.resumen && previo.resumen.version === VERSION_RESUMEN ? previo.resumen : null;
        // Cuántas reseñas positivas y negativas acertó el modelo de tono en esta obra (se guarda para el acierto total)
        let evaluacion = previo.evaluacion || null;
        try {
            const detalles = await traerDetalles(pedir, obra.ids.anilist);
            const frases = frasesConTemas(detalles.resenas);
            const textos = frases.map(f => f.texto);
            const tonosPalabras = tonosConPalabras(frases);
            let tonos = tonosPalabras;
            if (clasificador.nombre !== 'palabras'){
                try { tonos = await clasificador.tonos(textos); }
                catch (error){ registro(`  ${obra.titulo}: el modelo falló (${error.message}); se usan palabras clave`); }
            }
            resenas = analizarResenas(detalles.resenas, frases, tonos);
            const evaluada = evaluarTono(detalles.resenas, frases, tonos);
            evaluacion = [evaluada.positivas.aciertos, evaluada.positivas.total, evaluada.negativas.aciertos, evaluada.negativas.total];
            evaluacionModelo = sumarEvaluaciones(evaluacionModelo, evaluada);
            evaluacionPalabras = sumarEvaluaciones(evaluacionPalabras, evaluarTono(detalles.resenas, frases, tonosPalabras));

            if (detalles.media){
                const e = prepararEtiquetas(detalles.media.tags);
                etiquetas = e.etiquetas;
                e.sinTraducir.forEach(t => sinTraducir.add(t));
                recomendaciones = prepararRecomendaciones(detalles.media.recommendations && detalles.media.recommendations.nodes);
                actividad = analizarActividad(detalles.media.trends && detalles.media.trends.nodes);
            }

            // Resumen: si hace falta uno nuevo, queda anotada (resumenes.mjs baja sus reseñas y lo escribe)
            if (necesitaResumen(resenas, resumen, fecha)) pendientes.push({ id: obra.ids.anilist, titulo: obra.titulo, tipo: obra.tipo });
        } catch (error){
            registro(`  ${obra.titulo}: reseñas y detalles fallaron (${error.message}); se usa el dato anterior`);
        }

        ids.obras[id] = guardado;
        resultado[id] = {
            puntaje: combinarPuntajes(fuentes, mediaCatalogo),
            fuentes,
            distribucion,
            resenas,
            popularidad: m.popularity || null,
            favoritos: m.favourites || null,
            etiquetas,
            recomendaciones,
            actividad,
            resumen: (resenas.n || 0) >= MIN_RESENAS_RESUMEN ? resumen : null,
            capitulos,
            evaluacion,
            revisada: fecha
        };
        const p = resultado[id].puntaje;
        registro(`  ${obra.titulo}: ${p ? (p.valor / 10).toFixed(1) : '?'} (${Object.keys(fuentes).join(', ')}), ${resenas.n || 0} reseñas`);
    }

    // 2. Tendencia: con el registro diario de AniList (lectores de hace 7 días); si no lo hay,
    //    contra la medición propia de hace 5 días o más
    const semanas = (historial.semanas || []).filter(s => s && s.fecha && s.obras);
    const referencia = [...semanas].reverse().find(s => diasEntre(s.fecha, fecha) >= 5);
    for (const [id, r] of Object.entries(resultado)){
        // La actividad diaria solo está al día en las que se renovaron hoy
        if (r.revisada === fecha && r.actividad && Number.isFinite(r.actividad.lectores)){
            r.tendencia = { lectores: r.actividad.lectores, puntaje: null, dias: r.actividad.dias };
            continue;
        }
        const antes = referencia && referencia.obras[id];
        r.tendencia = antes
            ? calcularTendencia({ popularidad: r.popularidad, puntaje: r.puntaje && r.puntaje.valor }, { popularidad: antes[0], puntaje: antes[1] }, diasEntre(referencia.fecha, fecha))
            : (r.revisada === fecha ? null : (r.tendencia || null));
    }

    // Qué tan seguido el tono de las frases coincide con el puntaje de cada reseña
    const porcentaje = e => {
        const a = aciertoEquilibrado(e);
        return a === null ? 'sin datos' : `${Math.round(a * 100)} % (positivas ${e.positivas.aciertos}/${e.positivas.total}, negativas ${e.negativas.aciertos}/${e.negativas.total})`;
    };
    registro(`Tono de las reseñas de hoy con ${clasificador.nombre === 'modelo' ? 'el modelo' : 'palabras clave'}: acierta ${porcentaje(evaluacionModelo)}.`);
    if (clasificador.nombre === 'modelo') registro(`Con palabras clave habría acertado ${porcentaje(evaluacionPalabras)}.`);
    if (sinTraducir.size) registro(`Etiquetas sin traducir (agrégalas en scripts/etiquetas.mjs): ${[...sinTraducir].join(', ')}`);

    // 3. Historial: una medición por semana, de lunes a domingo (como la tarea corre de lunes a
    //    viernes, cada día reemplaza la de esa semana y la semana queda con la del viernes)
    const foto = { fecha, obras: Object.fromEntries(Object.entries(resultado).map(([id, r]) => [id, [r.popularidad, r.puntaje ? r.puntaje.valor : null]])) };
    const ultima = semanas[semanas.length - 1];
    if (ultima && lunesDe(ultima.fecha) === lunesDe(fecha)) semanas[semanas.length - 1] = foto;
    else semanas.push(foto);

    const conDatos = nombre => Object.values(resultado).some(r => r.fuentes && r.fuentes[nombre]);
    const fechasFuentes = Object.fromEntries(Object.entries(fuentesUsadas).map(([nombre, usada]) =>
        [nombre, !conDatos(nombre) ? null : (usada ? fecha : ((anterior.fuentes || {})[nombre] || null))]));
    if (!claveMAL) fechasFuentes.myanimelist = null;

    await escribirJSON(ruta('datos/comunidad.json'), {
        esquema: 1,
        metodo: METODO,
        generado: ahora.toISOString(),
        fuentes: fechasFuentes,
        mediaCatalogo: redondear(mediaCatalogo, 1),
        tono: aciertoTotal(resultado, anterior.tono, clasificador.nombre),
        obras: resultado
    });
    await escribirJSON(ruta('datos/ids.json'), ids);
    await escribirJSON(ruta('datos/historial.json'), { semanas: semanas.slice(-SEMANAS_DE_HISTORIAL) });
    // Qué obras necesitan resumen: archivo temporal que nunca se sube (ver .gitignore y resumenes.mjs)
    const carpetaTemporal = ruta('.tmp');
    await rm(carpetaTemporal, { recursive: true, force: true });
    if (pendientes.length) await escribirJSON(join(carpetaTemporal, 'pendientes.json'), pendientes);
    registro(`Resúmenes por escribir: ${pendientes.length}.`);
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
