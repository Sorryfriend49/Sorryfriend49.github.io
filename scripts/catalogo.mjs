/* ===================================
   FROZEN PROJECT: arma obras.json a partir de catalogo.json
   catalogo.json es la lista de obras (sus números de AniList). De lunes a viernes la tarea de
   GitHub corre este programa: trae de AniList títulos, géneros, fechas, capítulos, portadas
   y los lugares oficiales para leer, y escribe obras.json, que es lo que lee la página.
   Para agregar una obra basta con sumar su número de AniList a catalogo.json (además, cada
   día hábil entran solas hasta 20: ver nuevas.mjs). Cada obra nueva queda con "agregada",
   el día en que llegó.
   Si AniList no responde, obras.json se queda como estaba.
   Para probarlo en tu PC: node scripts/catalogo.mjs
=================================== */
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crearCliente, leerJSON, escribirJSON, dormir } from './comunidad.mjs';
import { slug } from './analisis.mjs';

const ANILIST = 'https://graphql.anilist.co';
const POR_PAGINA = 50;

const GENEROS = {
    'Action': 'accion', 'Adventure': 'aventura', 'Comedy': 'comedia', 'Drama': 'drama', 'Fantasy': 'fantasia',
    'Horror': 'terror', 'Mahou Shoujo': 'chicas-magicas', 'Mecha': 'mecha', 'Music': 'musica', 'Mystery': 'misterio',
    'Psychological': 'psicologico', 'Romance': 'romance', 'Sci-Fi': 'ciencia-ficcion', 'Slice of Life': 'recuentos-de-la-vida',
    'Sports': 'deportes', 'Supernatural': 'sobrenatural', 'Thriller': 'suspenso'
};
const ESTADOS = { FINISHED: 'terminado', RELEASING: 'en-publicacion', HIATUS: 'pausado', CANCELLED: 'cancelado', NOT_YET_RELEASED: 'proximamente' };
const TIPO_POR_PAIS = { JP: 'manga', KR: 'manhwa', CN: 'manhua', TW: 'manhua', HK: 'manhua' };
const IDIOMAS = { Spanish: 'es', English: 'en', Japanese: 'ja', Korean: 'ko', Chinese: 'zh' };
const IDIOMA_ORIGINAL = { manga: 'ja', manhwa: 'ko', manhua: 'zh' };

// Editoriales oficiales (sus páginas venden los tomos impresos o digitales)
export const EDITORIALES = {
    'ivrea.com.ar': 'Ivrea Argentina', 'ivrea.es': 'Ivrea España', 'normaeditorial.com': 'Norma Editorial',
    'milkywayediciones.com': 'Milky Way Ediciones', 'planetadelibros.com': 'Planeta Cómic', 'planetacomic.com': 'Planeta Cómic',
    'eccediciones.com': 'ECC Ediciones', 'panini.com.mx': 'Panini México', 'panini.es': 'Panini España',
    'paninicomics.es': 'Panini España', 'panini.com.ar': 'Panini Argentina', 'kamite.com.mx': 'Kamite',
    'distritomanga.com.mx': 'Distrito Manga', 'ovnipress.net': 'Ovni Press', 'arechimanga.com': 'Arechi Manga',
    'kodansha.us': 'Kodansha USA', 'yenpress.com': 'Yen Press', 'sevenseasentertainment.com': 'Seven Seas',
    'squareenixmangaandbooks.square-enix-games.com': 'Square Enix Manga', 'darkhorse.com': 'Dark Horse',
    'shogakukanasia.com': 'Shogakukan Asia', 'viz.com': 'VIZ', 'inklore.com': 'Inklore', 'ize-press.com': 'Ize Press'
};

const CONSULTA = `query ($ids: [Int], $p: Int) { Page(page: $p, perPage: ${POR_PAGINA}) { pageInfo { hasNextPage }
    media(id_in: $ids, type: MANGA) { id idMal isAdult countryOfOrigin status chapters volumes genres synonyms
        title { romaji english native } startDate { year month day } endDate { year month day }
        coverImage { large color } meanScore popularity
        externalLinks { site type language url isDisabled notes } } } }`;

const fechaISO = f => {
    if (!f || !f.year) return null;
    const dos = n => String(n).padStart(2, '0');
    return [f.year, f.month && dos(f.month), f.month && f.day && dos(f.day)].filter(Boolean).join('-');
};

const dominio = url => { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };
const conHttps = url => String(url).replace(/^http:\/\//i, 'https://');

/* Lugares oficiales para leer: los que AniList marca como lectura en línea (en español, en inglés
   o en el idioma original de la obra) y las páginas de las editoriales que publican los tomos. */
export function prepararEnlaces(links, tipoObra){
    const vistos = new Set();
    const enlaces = [];
    for (const e of links || []){
        if (!e || e.isDisabled || !e.url) continue;
        const idioma = IDIOMAS[e.language];
        const sitioWeb = dominio(e.url);
        if (!idioma || !sitioWeb) continue;
        let tipo = null;
        let sitio = e.site;
        if (e.type === 'STREAMING'){
            if (/volume|tomo/i.test(e.notes || '')) tipo = ['es', 'en'].includes(idioma) ? 'tomos' : null;
            else if (['es', 'en'].includes(idioma)) tipo = 'leer';
            else if (idioma === IDIOMA_ORIGINAL[tipoObra]) tipo = 'original';
        } else if (e.type === 'INFO' && ['es', 'en'].includes(idioma)){
            const editorial = EDITORIALES[sitioWeb] || EDITORIALES[sitioWeb.split('.').slice(-2).join('.')];
            if (editorial){ tipo = 'tomos'; if (!sitio || sitio === 'Official Site') sitio = editorial; }
        }
        if (!tipo) continue;
        const url = conHttps(e.url);
        const clave = `${tipo}|${idioma}|${sitio}`;
        if (vistos.has(url) || vistos.has(clave)) continue;
        vistos.add(url);
        vistos.add(clave);
        enlaces.push({ sitio, url, idioma, tipo });
    }
    const orden = e => ({ leer: 0, tomos: 2, original: 4 }[e.tipo] + (e.idioma === 'es' ? 0 : 1));
    return enlaces.sort((a, b) => orden(a) - orden(b));
}

// Una obra de obras.json a partir de lo que devuelve AniList (y lo fijo de catalogo.json)
export function prepararObra(m, entrada){
    const tipo = TIPO_POR_PAIS[m.countryOfOrigin] || 'manga';
    const titulo = entrada.titulo || (m.title && (m.title.english || m.title.romaji)) || String(m.id);
    const titulos = { romaji: m.title.romaji || null, ingles: m.title.english || null, nativo: m.title.native || null };
    const propios = new Set([titulo, titulos.romaji, titulos.ingles, titulos.nativo].filter(Boolean).map(t => t.toLowerCase()));
    const sinonimos = [...new Set((m.synonyms || []).filter(s => s && !propios.has(s.toLowerCase())))].slice(0, 10);
    const obra = {
        id: entrada.id,
        titulo,
        titulos,
        sinonimos,
        tipo,
        estado: ESTADOS[m.status] || 'en-publicacion',
        inicio: fechaISO(m.startDate),
        fin: fechaISO(m.endDate),
        capitulos: m.chapters || null,
        tomos: m.volumes || null,
        generos: [...new Set((m.genres || []).map(g => GENEROS[g]).filter(Boolean))],
        portada: m.coverImage && m.coverImage.large,
        color: (m.coverImage && m.coverImage.color) || null,
        ids: { anilist: m.id, mal: m.idMal || null },
        enlaces: prepararEnlaces(m.externalLinks, tipo),
        comunidad: { anilist: { puntaje: m.meanScore || null, popularidad: m.popularity || 0 } }
    };
    if (entrada.portadaGrande) obra.portadaGrande = entrada.portadaGrande;
    if (entrada.agregada) obra.agregada = entrada.agregada;      // el día en que llegó al catálogo (Inicio: «Nuevas»)
    return obra;
}

// catalogo.json con una obra por línea, para que sea fácil de editar a mano
export async function escribirCatalogo(ruta, lista, entradas){
    const campos = e => Object.fromEntries(['anilist', 'id', 'titulo', 'agregada', 'portadaGrande'].filter(k => e[k] != null).map(k => [k, e[k]]));
    const otros = Object.entries(lista).filter(([k]) => k !== 'obras').map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
    const texto = ['{', ...otros, '  "obras": [', entradas.map(e => '    ' + JSON.stringify(campos(e))).join(',\n'), '  ]', '}', ''].join('\n');
    await writeFile(ruta, texto);
}

export async function armarCatalogo({
    raiz,
    fetch = globalThis.fetch,
    ahora = new Date(),
    esperar = dormir,
    registro = console.log
} = {}){
    const ruta = nombre => join(raiz, nombre);
    const lista = await leerJSON(ruta('catalogo.json'));
    const anterior = await leerJSON(ruta('obras.json'), { obras: [] });
    const vistas = new Set();
    const entradas = (lista.obras || []).filter(e => e && Number.isInteger(e.anilist) && !vistas.has(e.anilist) && vistas.add(e.anilist));
    registro(`Catálogo: ${entradas.length} obras en catalogo.json.`);

    // 1. AniList, de 50 en 50
    const pedir = crearCliente({ fetch, esperar, registro });
    const porId = new Map();
    try {
        const ids = entradas.map(e => e.anilist);
        for (let i = 0; i < ids.length; i += POR_PAGINA){
            const r = await pedir(ANILIST, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: CONSULTA, variables: { ids: ids.slice(i, i + POR_PAGINA), p: 1 } }) });
            if (r.errors && r.errors.length) throw new Error(r.errors.map(e => e.message).join('; '));
            for (const m of r.data.Page.media) porId.set(m.id, m);
        }
    } catch (error){
        registro(`AniList no respondió (${error.message}); obras.json se queda como estaba.`);
        return null;
    }

    // 2. Cada obra (las que AniList no devolvió se conservan como estaban)
    const usados = new Set(entradas.map(e => e.id).filter(Boolean));
    const previas = new Map((anterior.obras || []).map(o => [o.ids && o.ids.anilist, o]));
    const obras = [];
    let nuevas = 0;
    for (const entrada of entradas){
        const m = porId.get(entrada.anilist);
        if (!m){
            registro(`  ${entrada.titulo || entrada.anilist}: AniList no la devolvió; se conserva lo anterior`);
            if (previas.has(entrada.anilist)) obras.push(previas.get(entrada.anilist));
            continue;
        }
        if (m.isAdult){
            registro(`  ${entrada.anilist}: es para adultos; no entra al catálogo`);
            continue;
        }
        // Número y nombre fijos: los enlaces compartidos (#catalogo?obra=...) no cambian nunca
        if (!entrada.titulo) entrada.titulo = (m.title.english || m.title.romaji || String(m.id)).trim();
        if (!entrada.id){
            let base = slug(entrada.titulo) || `obra-${m.id}`;
            let id = base;
            for (let n = 2; usados.has(id); n++) id = `${base}-${n}`;
            entrada.id = id;
            usados.add(id);
            if (!entrada.agregada) entrada.agregada = ahora.toISOString().slice(0, 10);
            nuevas++;
            registro(`  Nueva: ${entrada.titulo} (${id})`);
        }
        obras.push(prepararObra(m, entrada));
    }

    await escribirJSON(ruta('obras.json'), {
        esquema: 1,
        actualizado: ahora.toISOString().slice(0, 10),
        fuente: 'AniList (https://anilist.co): títulos, géneros, fechas, portadas, puntaje, popularidad y dónde leer. Este archivo se genera solo a partir de catalogo.json (scripts/catalogo.mjs): para agregar o quitar obras, edita catalogo.json.',
        obras
    });
    await escribirCatalogo(ruta('catalogo.json'), lista, entradas);
    const conEnlaces = obras.filter(o => o.enlaces.some(e => e.tipo !== 'original')).length;
    registro(`obras.json: ${obras.length} obras (${nuevas} nuevas); ${conEnlaces} con dónde leer en español o inglés.`);
    return obras;
}

// node scripts/catalogo.mjs
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href){
    const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
    armarCatalogo({ raiz }).catch(error => {
        console.error('Error:', error.message);
        process.exit(1);
    });
}
