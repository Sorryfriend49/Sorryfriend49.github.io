/* ===================================
   FROZEN PROJECT: el orden de lectura y el anime de cada obra
   Lo usa catalogo.mjs (de lunes a viernes y cuando cambia el catálogo). De AniList trae:
   - El orden de lectura: la cadena de precuelas y secuelas, seguida de una en una aunque salga
     del catálogo (JoJo tiene 9 partes), y aparte sus historias paralelas y spin-offs. Solo
     manga, manhwa y manhua (también one-shots): ni novelas, ni antologías, ni obras para adultos.
   - El anime: sus adaptaciones (series, películas, OVA y especiales, también los donghua chinos)
     y dónde verlas oficialmente. Van primero los servicios que llegan a Latinoamérica y España;
     los demás (Hulu, Bilibili…) solo se nombran si no está en ninguno de esos.
   Son consultas aparte de las del catálogo: si AniList falla aquí, cada obra conserva lo que
   tenía y el catálogo se actualiza igual (ver catalogo.mjs).
   Con datos reales (24-11-2026): de 231 obras, 42 tienen precuelas o secuelas, 72 historias
   paralelas o spin-offs y 146 anime (136 ya estrenado). Seguir las sagas pidió 61 obras más,
   en 5 consultas; en total son unas 18 consultas más por día (menos de un minuto).
=================================== */
import { TIPO_POR_PAIS } from './analisis.mjs';

const ANILIST = 'https://graphql.anilist.co';
const POR_PAGINA = 50;
const MAX_PASOS = 15;               // como mucho 15 precuelas y 15 secuelas seguidas
export const MAX_RELACIONADAS = 4;  // historias paralelas y spin-offs en la ficha (las más leídas)
export const MAX_ANIME = 5;         // adaptaciones en la ficha (las más vistas)

const LEGIBLES = ['MANGA', 'ONE_SHOT'];
// Lo que la obra es para la que estás viendo (las precuelas y secuelas que no siguen la cadena, también)
const RELACIONES = { PARENT: 'historia principal', PREQUEL: 'precuela', SEQUEL: 'secuela', SIDE_STORY: 'historia paralela', SPIN_OFF: 'spin-off' };
const ORDEN_RELACIONES = { 'historia principal': 0, precuela: 1, secuela: 1, 'historia paralela': 2, 'spin-off': 3 };
const ANTOLOGIA = /antholog/i;      // las hacen otros autores: no son parte de la historia

// El anime puede ser la adaptación, la obra original (Evangelion) o adaptar la misma novela (Heaven Official's Blessing)
const RELACIONES_ANIME = ['ADAPTATION', 'SOURCE', 'ALTERNATIVE'];
const FORMATOS_ANIME = { TV: 'serie', TV_SHORT: 'serie corta', ONA: 'serie', MOVIE: 'película', OVA: 'OVA', SPECIAL: 'especial' };
const ESTADOS_ANIME = { RELEASING: 'en emisión', NOT_YET_RELEASED: 'por estrenar', HIATUS: 'en pausa' };
const ESTRENADO = ['FINISHED', 'RELEASING', 'HIATUS'];
// Servicios que llegan a Latinoamérica y España (lo que tiene cada uno cambia según el país)
export const SERVICIOS = {
    'Crunchyroll': 'Crunchyroll', 'Netflix': 'Netflix', 'Amazon Prime Video': 'Prime Video', 'Prime Video': 'Prime Video',
    'Disney Plus': 'Disney+', 'Max': 'HBO Max', 'HBO Max': 'HBO Max', 'HIDIVE': 'HIDIVE'
};
const ORDEN_SERVICIOS = ['Crunchyroll', 'Netflix', 'Prime Video', 'Disney+', 'HBO Max', 'HIDIVE'];
const CERRADOS = ['Star+'];         // se unió a Disney+ en 2024: sus enlaces ya no sirven

const NODO = `id type format status isAdult popularity countryOfOrigin title { romaji english } startDate { year month } coverImage { medium }`;
const CONSULTA_RELACIONES = `query ($ids: [Int]) { Page(page: 1, perPage: ${POR_PAGINA}) {
    media(id_in: $ids, type: MANGA) { id startDate { year } relations { edges { relationType(version: 2) node { ${NODO} } } } } } }`;
const CONSULTA_ANIME = `query ($ids: [Int]) { Page(page: 1, perPage: ${POR_PAGINA}) {
    media(id_in: $ids, type: ANIME) { id episodes externalLinks { site type url isDisabled } } } }`;

const tituloDe = n => String((n && n.title && (n.title.english || n.title.romaji)) || '').trim();
const legible = n => Boolean(n && n.type === 'MANGA' && LEGIBLES.includes(n.format) && !n.isAdult && tituloDe(n));
const masLeida = (a, b) => (b.popularity || 0) - (a.popularity || 0) || a.id - b.id;
const anioDe = n => (n && n.startDate && n.startDate.year) || null;
const fechaDe = n => (anioDe(n) || 9999) * 100 + ((n && n.startDate && n.startDate.month) || 0);
const conHttps = url => {
    try {
        const u = new URL(String(url).replace(/^http:\/\//i, 'https://'));
        return u.protocol === 'https:' ? u.href : null;
    } catch { return null; }
};

function vecinas(grafo, id, tipos){
    const m = grafo.get(id);
    const edges = (m && m.relations && Array.isArray(m.relations.edges)) ? m.relations.edges : [];
    return edges.filter(e => e && e.node && Number.isInteger(e.node.id) && tipos.includes(e.relationType));
}

// Una obra del orden de lectura o de las relacionadas, como la muestra la ficha
export function prepararNodo(n){
    const nodo = { anilist: n.id, titulo: tituloDe(n), tipo: TIPO_POR_PAIS[n.countryOfOrigin] || 'manga' };
    if (n.format === 'ONE_SHOT') nodo.formato = 'one-shot';
    if (anioDe(n)) nodo.anio = anioDe(n);
    if (n.coverImage && n.coverImage.medium) nodo.portada = n.coverImage.medium;
    return nodo;
}

/* El orden de lectura de una obra (su número de AniList). grafo: número -> { relations } de AniList.
   Sigue las precuelas hacia atrás y las secuelas hacia adelante; si hay varias, sigue la más leída
   (a Naruto le sigue Boruto) y las otras quedan entre las relacionadas. La obra misma va en su
   lugar solo con su número (la página ya la tiene). Devuelve null si no hay nada que mostrar. */
export function armarLectura(id, grafo){
    if (!grafo.has(id)) return null;
    const enCadena = new Set([id]);
    const seguir = tipo => {
        const cadena = [];
        for (let actual = id, paso = 0; paso < MAX_PASOS; paso++){
            const siguiente = vecinas(grafo, actual, [tipo]).map(e => e.node)
                .filter(n => legible(n) && !enCadena.has(n.id)).sort(masLeida)[0];
            if (!siguiente) break;
            cadena.push(siguiente);
            enCadena.add(siguiente.id);
            actual = siguiente.id;
        }
        return cadena;
    };
    const antes = seguir('PREQUEL').reverse();
    const despues = seguir('SEQUEL');
    const orden = antes.length || despues.length ? [...antes.map(prepararNodo), { anilist: id }, ...despues.map(prepararNodo)] : [];

    // Historias paralelas, spin-offs, la historia principal y las precuelas o secuelas que no siguen la cadena.
    // Una «historia principal» que salió después que la obra es un error de AniList (a One Piece, de 1997,
    // le marca como principal un one-shot de 2019; a Dorohedoro, Dai Dark): no se muestra.
    const anioPropio = anioDe(grafo.get(id));
    const vistas = new Set(enCadena);
    const candidatas = [];
    for (const e of vecinas(grafo, id, Object.keys(RELACIONES))){
        const n = e.node;
        if (!legible(n) || vistas.has(n.id) || ANTOLOGIA.test(tituloDe(n))) continue;
        if (e.relationType === 'PARENT' && anioPropio && anioDe(n) > anioPropio) continue;
        vistas.add(n.id);
        candidatas.push({ n, relacion: RELACIONES[e.relationType] });
    }
    // La historia principal siempre; después, las más leídas. Se muestran por tipo y por año.
    const principal = c => c.relacion === 'historia principal' ? 0 : 1;
    const elegidas = [...candidatas].sort((a, b) => principal(a) - principal(b) || masLeida(a.n, b.n)).slice(0, MAX_RELACIONADAS)
        .sort((a, b) => ORDEN_RELACIONES[a.relacion] - ORDEN_RELACIONES[b.relacion] || fechaDe(a.n) - fechaDe(b.n) || a.n.id - b.n.id);
    const relacionadas = elegidas.map(({ n, relacion }) => ({ ...prepararNodo(n), relacion }));

    if (!orden.length && !relacionadas.length) return null;
    const lectura = {};
    if (orden.length) lectura.orden = orden;
    if (relacionadas.length) lectura.relacionadas = relacionadas;
    if (candidatas.length > relacionadas.length) lectura.masRelacionadas = candidatas.length - relacionadas.length;
    return lectura;
}

// Las adaptaciones animadas de una obra, de la más vista a la menos (sin videos musicales ni canceladas)
export function candidatasDeAnime(id, grafo){
    const vistas = new Set();
    const candidatas = [];
    for (const e of vecinas(grafo, id, RELACIONES_ANIME)){
        const n = e.node;
        if (n.type !== 'ANIME' || n.isAdult || n.format === 'MUSIC' || n.status === 'CANCELLED' || vistas.has(n.id) || !tituloDe(n)) continue;
        vistas.add(n.id);
        candidatas.push(n);
    }
    return candidatas.sort(masLeida);
}

/* El anime de una obra: las adaptaciones más vistas (por fecha) y dónde verlas.
   detalles: número del anime -> { episodes, externalLinks } de AniList. Devuelve null si no tiene. */
export function armarAnime(id, grafo, detalles = new Map()){
    const candidatas = candidatasDeAnime(id, grafo);
    if (!candidatas.length) return null;
    const elegidas = candidatas.slice(0, MAX_ANIME).sort((a, b) => fechaDe(a) - fechaDe(b) || masLeida(a, b));
    const obras = elegidas.map(n => {
        const d = detalles.get(n.id) || {};
        const a = { anilist: n.id, titulo: tituloDe(n) };
        if (FORMATOS_ANIME[n.format]) a.formato = FORMATOS_ANIME[n.format];
        if (anioDe(n)) a.anio = anioDe(n);
        if (ESTRENADO.includes(n.status) && n.format !== 'MOVIE' && Number.isInteger(d.episodes) && d.episodes > 1) a.episodios = d.episodes;
        if (ESTADOS_ANIME[n.status]) a.estado = ESTADOS_ANIME[n.status];
        return a;
    });

    // Dónde verlo: los servicios en los que están las adaptaciones ya estrenadas (con el enlace de la primera)
    const servicios = new Map();
    const otros = new Set();
    for (const n of elegidas){
        if (!ESTRENADO.includes(n.status)) continue;
        const enEsta = new Set();
        for (const l of (detalles.get(n.id) || {}).externalLinks || []){
            if (!l || l.type !== 'STREAMING' || l.isDisabled || !l.site) continue;
            const url = conHttps(l.url);
            if (!url) continue;
            const sitio = SERVICIOS[l.site];
            if (!sitio){
                if (!CERRADOS.includes(l.site)) otros.add(String(l.site).trim());
                continue;
            }
            if (enEsta.has(sitio)) continue;       // el mismo servicio dos veces (subtitulado y doblado)
            enEsta.add(sitio);
            if (!servicios.has(sitio)) servicios.set(sitio, { sitio, url, veces: 0 });
            servicios.get(sitio).veces++;
        }
    }
    const ver = [...servicios.values()]
        .sort((a, b) => b.veces - a.veces || ORDEN_SERVICIOS.indexOf(a.sitio) - ORDEN_SERVICIOS.indexOf(b.sitio))
        .map(({ sitio, url }) => ({ sitio, url }));

    const anime = { obras };
    if (candidatas.some(n => ESTRENADO.includes(n.status))) anime.estrenado = true;    // filtro «Con anime»
    if (candidatas.length > obras.length) anime.mas = candidatas.length - obras.length;
    if (ver.length) anime.ver = ver;
    else if (otros.size) anime.otros = [...otros].sort((a, b) => a.localeCompare(b, 'en'));
    return anime;
}

// Las precuelas y secuelas que todavía no se consultaron (para seguir las cadenas)
export function porSeguir(grafo){
    const faltan = new Set();
    for (const id of grafo.keys()){
        for (const e of vecinas(grafo, id, ['PREQUEL', 'SEQUEL'])){
            if (legible(e.node) && !grafo.has(e.node.id)) faltan.add(e.node.id);
        }
    }
    return [...faltan];
}

async function porLotes(pedir, consulta, ids, guardar){
    for (let i = 0; i < ids.length; i += POR_PAGINA){
        const r = await pedir(ANILIST, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: consulta, variables: { ids: ids.slice(i, i + POR_PAGINA) } }) });
        if (r.errors && r.errors.length) throw new Error(r.errors.map(e => e.message).join('; '));
        for (const m of (r.data && r.data.Page && r.data.Page.media) || []) if (m && Number.isInteger(m.id)) guardar(m);
    }
}

/* Trae de AniList lo necesario para armarLectura y armarAnime: las relaciones de las obras (ids),
   las de sus precuelas y secuelas hasta el final de cada cadena, y los episodios y dónde ver las
   adaptaciones que van en la ficha. Si AniList falla, lanza el error (catalogo.mjs conserva lo anterior). */
export async function traerRelaciones(pedir, ids, registro = () => {}){
    const grafo = new Map();
    await porLotes(pedir, CONSULTA_RELACIONES, ids, m => grafo.set(m.id, m));
    const delCatalogo = grafo.size;
    for (let nivel = 0; nivel < MAX_PASOS; nivel++){
        const faltan = porSeguir(grafo);
        if (!faltan.length) break;
        await porLotes(pedir, CONSULTA_RELACIONES, faltan, m => grafo.set(m.id, m));
        for (const id of faltan) if (!grafo.has(id)) grafo.set(id, { id, relations: { edges: [] } });   // no se vuelve a pedir
    }
    const animes = [...new Set(ids.flatMap(id => candidatasDeAnime(id, grafo).slice(0, MAX_ANIME).map(n => n.id)))];
    const detalles = new Map();
    await porLotes(pedir, CONSULTA_ANIME, animes, m => detalles.set(m.id, m));
    registro(`Orden de lectura y anime: ${delCatalogo} obras, ${grafo.size - delCatalogo} más para seguir las sagas y ${detalles.size} animes.`);
    return { grafo, detalles };
}
