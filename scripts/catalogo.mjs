/* ===================================
   FROZEN PROJECT: arma obras.json a partir de catalogo.json
   catalogo.json es la lista de obras (sus números de AniList). De lunes a viernes la tarea de
   GitHub corre este programa: trae de AniList títulos, autores, géneros, fechas, capítulos,
   portadas, los lugares oficiales para leer, el orden de lectura y el anime (relaciones.mjs), y
   escribe obras.json (de ahí salen la lista y las fichas que lee la página, ver lista.mjs).
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
import { slug, TIPO_POR_PAIS } from './analisis.mjs';
import { traerRelaciones, armarLectura, armarAnime } from './relaciones.mjs';

const ANILIST = 'https://graphql.anilist.co';
const POR_PAGINA = 50;

const GENEROS = {
    'Action': 'accion', 'Adventure': 'aventura', 'Comedy': 'comedia', 'Drama': 'drama', 'Fantasy': 'fantasia',
    'Horror': 'terror', 'Mahou Shoujo': 'chicas-magicas', 'Mecha': 'mecha', 'Music': 'musica', 'Mystery': 'misterio',
    'Psychological': 'psicologico', 'Romance': 'romance', 'Sci-Fi': 'ciencia-ficcion', 'Slice of Life': 'recuentos-de-la-vida',
    'Sports': 'deportes', 'Supernatural': 'sobrenatural', 'Thriller': 'suspenso'
};
const ESTADOS = { FINISHED: 'terminado', RELEASING: 'en-publicacion', HIATUS: 'pausado', CANCELLED: 'cancelado', NOT_YET_RELEASED: 'proximamente' };
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
        coverImage { extraLarge large color } meanScore popularity
        staff(sort: [RELEVANCE, ROLE], perPage: 8) { edges { role node { name { full native } } } }
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
/* Quién la creó: la historia, el arte o las dos. Los demás trabajos (asistentes, traducción,
   rotulado, edición, color o diseño) no se nombran. Primero quien inventó la historia (la novela
   o la obra original), después quien la escribió y la dibujó; como mucho 4 personas. AniList manda
   hasta 8 nombres porque a veces el autor original viene después (Solo Leveling: Chugong es el 5.º). */
const ROLES = [
    [/^story\s*(&|and)\s*art/i, ['historia', 'arte']],
    [/^original\s*(creator|work)/i, ['creación original']],
    [/^original\s*story/i, ['historia original']],
    [/^story/i, ['historia']],
    [/^(art|illustration)/i, ['arte']]
];
const ORDEN_ROLES = { 'creación original': 0, 'historia original': 0, historia: 1, arte: 2 };
const OTROS_TRABAJOS = /assist|touch|letter|translat|edit|colou?r|design|supervis|cooperat|compos|cover/i;
export function prepararAutores(edges){
    const porNombre = new Map();
    for (const e of edges || []){
        const nombres = (e && e.node && e.node.name) || {};
        const nombre = String(nombres.full || nombres.native || '').trim();
        const rol = String((e && e.role) || '').trim();
        if (!nombre || OTROS_TRABAJOS.test(rol)) continue;
        const regla = ROLES.find(([re]) => re.test(rol));
        if (!regla) continue;
        const autor = porNombre.get(nombre) || { nombre, nativo: String(nombres.native || '').trim(), roles: [] };
        regla[1].forEach(r => { if (!autor.roles.includes(r)) autor.roles.push(r); });
        porNombre.set(nombre, autor);
    }
    const primero = a => Math.min(...a.roles.map(r => ORDEN_ROLES[r]));
    return [...porNombre.values()]
        .map((a, i) => ({ a, i }))
        .sort((x, y) => primero(x.a) - primero(y.a) || x.i - y.i)      // si empatan, el orden de AniList
        .slice(0, 4)
        .map(({ a }) => {
            // Quien escribió la novela y también la adaptó queda como «historia original» (no «historia y historia original»)
            let roles = a.roles.some(r => ORDEN_ROLES[r] === 0) ? a.roles.filter(r => r !== 'historia') : a.roles;
            if (roles.includes('historia') && roles.includes('arte')) roles = ['historia y arte', ...roles.filter(r => r !== 'historia' && r !== 'arte')];
            const autor = { nombre: a.nombre, rol: roles.join(' y ') };
            if (a.nativo && a.nativo !== a.nombre) autor.nativo = a.nativo;
            return autor;
        });
}

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
        autores: prepararAutores(m.staff && m.staff.edges),
        generos: [...new Set((m.genres || []).map(g => GENEROS[g]).filter(Boolean))],
        portada: m.coverImage && m.coverImage.large,
        color: (m.coverImage && m.coverImage.color) || null,
        ids: { anilist: m.id, mal: m.idMal || null },
        enlaces: prepararEnlaces(m.externalLinks, tipo),
        comunidad: { anilist: { puntaje: m.meanScore || null, popularidad: m.popularity || 0 } }
    };
    // Portada grande: la página la saca de la mediana (cambiando /cover/medium/ por /cover/large/), pero
    // algunas portadas viejas de AniList no tienen versión grande (Dr. Stone, Ajin…): su "extraLarge" es
    // la mediana. Entonces se guarda aparte, para que la ficha y la vista previa al compartir no queden
    // sin imagen. (Con "portadaGrande" en catalogo.json se puede fijar a mano.)
    const extraGrande = m.coverImage && m.coverImage.extraLarge;
    if (extraGrande && obra.portada && extraGrande !== obra.portada.replace('/cover/medium/', '/cover/large/')) obra.portadaGrande = extraGrande;
    if (entrada.portadaGrande) obra.portadaGrande = entrada.portadaGrande;
    // MangaUpdates fijada a mano, si la búsqueda automática elige otra versión de la obra (ver comunidad.mjs)
    if (entrada.mangaupdates) obra.mangaupdates = entrada.mangaupdates;
    if (entrada.agregada) obra.agregada = entrada.agregada;      // el día en que llegó al catálogo (Inicio: «Nuevas»)
    return obra;
}

// catalogo.json con una obra por línea, para que sea fácil de editar a mano
export async function escribirCatalogo(ruta, lista, entradas){
    const campos = e => Object.fromEntries(['anilist', 'id', 'titulo', 'agregada', 'portadaGrande', 'mangaupdates'].filter(k => e[k] != null).map(k => [k, e[k]]));
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

    // 3. Orden de lectura y anime (ver relaciones.mjs). Van aparte: si AniList falla aquí, cada obra
    //    conserva lo que tenía y lo demás se actualiza igual.
    const conservar = o => {
        const previa = previas.get(o.ids.anilist);
        if (!previa) return;
        if (previa.lectura) o.lectura = previa.lectura;
        if (previa.anime) o.anime = previa.anime;
    };
    try {
        const { grafo, detalles } = await traerRelaciones(pedir, obras.map(o => o.ids.anilist), registro);
        for (const o of obras){
            const id = o.ids.anilist;
            if (!grafo.has(id)){ conservar(o); continue; }        // AniList no la devolvió
            const lectura = armarLectura(id, grafo);
            const anime = armarAnime(id, grafo, detalles);
            if (lectura) o.lectura = lectura; else delete o.lectura;
            if (anime) o.anime = anime; else delete o.anime;
        }
    } catch (error){
        registro(`AniList no respondió al pedir el orden de lectura y el anime (${error.message}); cada obra conserva lo que tenía.`);
        obras.forEach(conservar);
    }

    await escribirJSON(ruta('obras.json'), {
        esquema: 1,
        actualizado: ahora.toISOString().slice(0, 10),
        fuente: 'AniList (https://anilist.co): títulos, géneros, fechas, portadas, puntaje, popularidad, dónde leer, orden de lectura y anime. Este archivo se genera solo a partir de catalogo.json (scripts/catalogo.mjs): para agregar o quitar obras, edita catalogo.json.',
        obras
    });
    await escribirCatalogo(ruta('catalogo.json'), lista, entradas);
    const conEnlaces = obras.filter(o => o.enlaces.some(e => e.tipo !== 'original')).length;
    const conOrden = obras.filter(o => o.lectura && o.lectura.orden).length;
    const conAnime = obras.filter(o => o.anime && o.anime.estrenado).length;
    registro(`obras.json: ${obras.length} obras (${nuevas} nuevas); ${conEnlaces} con dónde leer en español o inglés, ${conOrden} con orden de lectura y ${conAnime} con anime.`);
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
