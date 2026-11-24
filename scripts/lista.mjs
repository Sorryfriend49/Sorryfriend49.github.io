/* ===================================
   FROZEN PROJECT: la lista liviana del catálogo y una ficha por obra
   La página no baja obras.json ni datos/comunidad.json (con miles de obras serían muchos
   megas). Este programa arma, a partir de ellos:
   - datos/lista.json: lo que necesitan el catálogo, el buscador, los filtros, Inicio y la
     biblioteca (nombres, portada, tipo, géneros, fecha, puntaje, lectores, etiquetas…), una
     obra por línea. Es lo único que baja la página al abrir.
   - datos/fichas/<id>.json: lo demás, que se baja recién al abrir la ficha de esa obra
     (quién la creó, dónde leer, el orden de lectura, el anime, la opinión completa de la
     comunidad, el resumen y las recomendaciones).
   Una ficha solo se vuelve a escribir cuando cambia algo de verdad (por ejemplo, cuando la
   obra se renueva por completo), no por los números de AniList que cambian cada día: esos
   van en la lista. Así el repositorio no se llena de cambios.
   Lo corre la tarea de la comunidad (.github/workflows/comunidad.yml) después de los datos
   y después de los resúmenes. Para probarlo en tu PC: node scripts/lista.mjs
=================================== */
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CARPETA_FICHAS = 'datos/fichas';
const PORTADAS = 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/medium/';
// Lo que cambia cada día en todas las obras (lo liviano de AniList): no basta para reescribir una ficha
const CAMBIAN_CADA_DIA = ['fuentes', 'distribucion'];

const leer = async (ruta, siNoExiste) => {
    try { return JSON.parse(await readFile(ruta, 'utf8')); }
    catch (error){ if (error.code === 'ENOENT') return siNoExiste; throw error; }
};
const sinVacios = objeto => Object.fromEntries(Object.entries(objeto).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && !v.length)));

/* «Más de …» en la ficha: las otras obras del catálogo de las mismas personas (por su nombre),
   las más leídas primero y como mucho 8 por persona. Si dos autores comparten las mismas obras
   (el que escribe y el que dibuja), van juntos: «Más de Carnby Kim y Yeong-Chan Hwang».
   Devuelve una función: obra -> [{ autores: [nombres], obras: [ids] }] */
export const MAX_DEL_AUTOR = 8;
const nombreClave = nombre => String(nombre || '').normalize('NFKC').trim().toLowerCase();
export function indiceDeAutores(catalogo, porAniList = {}){
    const obrasDe = new Map();      // nombre en minúsculas -> [{ id, lectores }]
    for (const o of (catalogo && catalogo.obras) || []){
        if (!o || !o.id || !Array.isArray(o.autores)) continue;
        const c = porAniList[String(o.ids && o.ids.anilist)] || null;
        const lectores = (c && c.popularidad) || (o.comunidad && o.comunidad.anilist && o.comunidad.anilist.popularidad) || 0;
        for (const a of o.autores){
            const clave = nombreClave(a && a.nombre);
            if (!clave) continue;
            if (!obrasDe.has(clave)) obrasDe.set(clave, []);
            if (!obrasDe.get(clave).some(x => x.id === o.id)) obrasDe.get(clave).push({ id: o.id, lectores });
        }
    }
    return o => {
        const grupos = new Map();   // las mismas obras -> los autores que las comparten
        for (const a of (o && Array.isArray(o.autores)) ? o.autores : []){
            const otras = (obrasDe.get(nombreClave(a && a.nombre)) || [])
                .filter(x => x.id !== o.id)
                .sort((x, y) => y.lectores - x.lectores || x.id.localeCompare(y.id))
                .slice(0, MAX_DEL_AUTOR)
                .map(x => x.id);
            if (!otras.length) continue;
            const clave = otras.join(',');
            if (!grupos.has(clave)) grupos.set(clave, { autores: [], obras: otras });
            grupos.get(clave).autores.push(a.nombre);
        }
        return [...grupos.values()];
    };
}

/* «Para ti» (Inicio): las otras obras del catálogo relacionadas con una, por su número de AniList.
   h: de la misma historia (orden de lectura e historias relacionadas), a: de los mismos autores,
   r: las que recomiendan los lectores de AniList, en su orden. La página junta estas pistas con tu
   biblioteca, en tu navegador, para recomendarte obras. Devuelve null si no hay ninguna. */
export function relacionadasDe(o, { enCatalogo, anilistDe, grupos = [], recomendaciones = [] }){
    const propio = o && o.ids && o.ids.anilist;
    const solo = ids => [...new Set(ids)].filter(id => Number.isInteger(id) && id !== propio && enCatalogo.has(id));
    const lectura = (o && o.lectura) || {};
    const rel = {
        h: solo([...(lectura.orden || []), ...(lectura.relacionadas || [])].map(n => n && n.anilist)),
        a: solo(grupos.flatMap(g => (g && g.obras) || []).map(id => anilistDe.get(id))),
        r: solo((recomendaciones || []).map(x => x && x.anilist))
    };
    const conAlgo = sinVacios(rel);
    return Object.keys(conAlgo).length ? conAlgo : null;
}

/* La lista y las fichas, sin tocar archivos.
   catalogo: obras.json; comunidad: datos/comunidad.json (puede faltar o no tener alguna obra). */
export function armarLista(catalogo, comunidad){
    const porAniList = (comunidad && comunidad.obras) || {};
    const etiquetas = {};
    const obras = [];
    const fichas = new Map();
    const masDelAutor = indiceDeAutores(catalogo, porAniList);
    const delCatalogo = ((catalogo && catalogo.obras) || []).filter(o => o && o.id && o.ids && Number.isInteger(o.ids.anilist));
    const enCatalogo = new Set(delCatalogo.map(o => o.ids.anilist));
    const anilistDe = new Map(delCatalogo.map(o => [o.id, o.ids.anilist]));
    for (const o of (catalogo && catalogo.obras) || []){
        if (!o || !o.id || !o.titulo) continue;
        const c = porAniList[String(o.ids && o.ids.anilist)] || null;
        const grupos = masDelAutor(o);
        const anilist = (o.comunidad && o.comunidad.anilist) || {};
        const deLaObra = (c && Array.isArray(c.etiquetas)) ? c.etiquetas : [];
        deLaObra.forEach(e => { if (e && e.id && !etiquetas[e.id]) etiquetas[e.id] = sinVacios({ nombre: e.nombre, en: e.en ? true : null }); });
        const actividad = (c && c.actividad) || {};
        // Lo que la página necesita sin abrir la ficha (los géneros van siempre, aunque estén vacíos)
        obras.push({ ...sinVacios({
            id: o.id,
            titulo: o.titulo,
            titulos: o.titulos ? sinVacios({ romaji: o.titulos.romaji, ingles: o.titulos.ingles, nativo: o.titulos.nativo }) : null,
            sinonimos: o.sinonimos,
            tipo: o.tipo,
            estado: o.estado,
            inicio: o.inicio,
            // Tiene dónde leerla o comprar los tomos en español (oficial): filtro «En español» del catálogo
            es: (o.enlaces || []).some(e => e && e.idioma === 'es' && (e.tipo === 'leer' || e.tipo === 'tomos')) ? 1 : null,
            // Tiene al menos un anime ya estrenado (ver relaciones.mjs): filtro «Con anime»
            anime: o.anime && o.anime.estrenado ? 1 : null,
            // Capítulos (filtro «Extensión»): los de AniList si ya terminó; si sigue saliendo, los
            // publicados hasta ahora según MangaUpdates (lo mismo que dice la ficha)
            cap: o.capitulos || (c && c.capitulos && c.capitulos.ultimo) || null,
            generos: o.generos,
            portada: typeof o.portada === 'string' && o.portada.startsWith(PORTADAS) ? o.portada.slice(PORTADAS.length) : o.portada,
            portadaGrande: o.portadaGrande,
            color: o.color,
            ids: o.ids,
            // Opinión en corto: puntaje combinado (y de qué comunidades), votos, confianza, lectores, actividad, tendencia y etiquetas
            op: sinVacios({
                puntaje: c && c.puntaje && Number.isFinite(c.puntaje.valor) ? c.puntaje.valor : (Number.isFinite(anilist.puntaje) ? anilist.puntaje : null),
                votos: c && c.puntaje ? c.puntaje.votos : null,
                confianza: c && c.puntaje ? c.puntaje.confianza : null,
                fuentes: c && c.puntaje ? Object.keys(c.fuentes || {}) : null,      // de qué comunidades sale el puntaje
                lectores: (c && c.popularidad) || anilist.popularidad || null,
                semana: Number.isFinite(actividad.semana) ? actividad.semana : null,
                leyendo: actividad.leyendo || null,
                tendencia: c && c.tendencia && Number.isFinite(c.tendencia.lectores) ? [c.tendencia.lectores, c.tendencia.dias || 7] : null,
                etiquetas: deLaObra.map(e => e.id).filter(Boolean)
            }),
            // Pistas para «Para ti» en Inicio (ver relacionadasDe)
            rel: relacionadasDe(o, { enCatalogo, anilistDe, grupos, recomendaciones: c && c.recomendaciones })
        }), generos: Array.isArray(o.generos) ? o.generos : [] });
        // Lo que se baja al abrir la ficha
        fichas.set(o.id, sinVacios({
            id: o.id,
            autores: o.autores,
            masDelAutor: grupos,
            fin: o.fin,
            capitulos: o.capitulos,
            tomos: o.tomos,
            enlaces: o.enlaces || [],
            // Orden de lectura (precuelas, secuelas y relacionadas) y anime, de relaciones.mjs
            lectura: o.lectura,
            anime: o.anime ? sinVacios({ obras: o.anime.obras, mas: o.anime.mas, ver: o.anime.ver, otros: o.anime.otros }) : null,
            comunidad: c ? sinVacios({
                fuentes: c.fuentes,
                distribucion: c.distribucion,
                resenas: c.resenas,
                resumen: c.resumen,
                etiquetas: deLaObra,
                recomendaciones: c.recomendaciones,
                publicados: c.capitulos,
                revisada: c.revisada
            }) : null
        }));
    }
    const lista = {
        esquema: 1,
        actualizado: (catalogo && catalogo.actualizado) || null,
        comunidad: comunidad ? sinVacios({ generado: comunidad.generado, fuentes: comunidad.fuentes, tono: comunidad.tono }) : null,
        portadas: PORTADAS,
        etiquetas,
        obras
    };
    return { lista, fichas };
}

// lista.json con una obra por línea: liviano y fácil de comparar entre un día y otro
export function textoLista(lista){
    const { obras, ...resto } = lista;
    const cabeza = Object.entries(resto).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)},`);
    return ['{', ...cabeza, '"obras":[', obras.map(o => JSON.stringify(o)).join(',\n'), ']}', ''].join('\n');
}

// Una ficha cambió "de verdad" si cambia algo más que lo que AniList mueve cada día
export function cambioDeVerdad(nueva, vieja){
    if (!vieja) return true;
    const quitar = f => JSON.stringify({ ...f, comunidad: f.comunidad ? Object.fromEntries(Object.entries(f.comunidad).filter(([k]) => !CAMBIAN_CADA_DIA.includes(k))) : null });
    return quitar(nueva) !== quitar(vieja);
}

export async function escribirLista({ raiz, registro = console.log } = {}){
    const ruta = nombre => join(raiz, nombre);
    const catalogo = await leer(ruta('obras.json'), { obras: [] });
    const comunidad = await leer(ruta('datos/comunidad.json'), null);
    const { lista, fichas } = armarLista(catalogo, comunidad);

    await mkdir(ruta(CARPETA_FICHAS), { recursive: true });
    await writeFile(ruta('datos/lista.json'), textoLista(lista));

    let escritas = 0, iguales = 0, borradas = 0;
    for (const [id, ficha] of fichas){
        const archivo = ruta(`${CARPETA_FICHAS}/${id}.json`);
        const vieja = await leer(archivo, null).catch(() => null);
        if (!cambioDeVerdad(ficha, vieja)){ iguales++; continue; }
        await writeFile(archivo, JSON.stringify(ficha) + '\n');
        escritas++;
    }
    // Las fichas de obras que ya no están en el catálogo se borran
    for (const nombre of await readdir(ruta(CARPETA_FICHAS))){
        if (!nombre.endsWith('.json') || fichas.has(nombre.slice(0, -5))) continue;
        await rm(ruta(`${CARPETA_FICHAS}/${nombre}`), { force: true });
        borradas++;
    }
    registro(`Lista: ${lista.obras.length} obras. Fichas: ${escritas} escritas, ${iguales} sin cambios${borradas ? `, ${borradas} borradas` : ''}.`);
    return { lista, escritas, iguales, borradas };
}

// node scripts/lista.mjs
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href){
    const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
    escribirLista({ raiz }).catch(error => {
        console.error('Error:', error.message);
        process.exit(1);
    });
}
