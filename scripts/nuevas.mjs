/* ===================================
   FROZEN PROJECT: obras nuevas que entran solas al catálogo
   Lo corre la tarea de la comunidad (.github/workflows/comunidad.yml) de lunes a viernes,
   antes de armar el catálogo. Cada día agrega a catalogo.json hasta 20 obras de AniList:
   - hasta 10 que están en tendencia o son estrenos (empezaron hace menos de un año);
   - hasta 10 de las más populares de siempre que todavía faltan.
   Si de un lado no alcanzan, se completa con el otro y con obras prometedoras (empezaron hace
   menos de dos años y tienen muy buen puntaje).
   Reglas: nunca obras para adultos (+18); solo manga, manhwa y manhua (no novelas, ni guías,
   antologías o ediciones a color de una que ya está); que ya hayan empezado a publicarse;
   2.500 lectores o más en AniList; puntaje de 70/100 o más (75 para las prometedoras; las
   tendencias y estrenos que todavía no tienen puntaje pueden entrar).
   No vuelven: las de "excluidas" en catalogo.json y las que entraron solas y después quitaste
   (quedan anotadas en datos/agregadas.json).
   Después, catalogo.mjs les pone nombre y portada, y comunidad.mjs las revisa ese mismo día.
   Para ver cuáles entrarían sin cambiar nada: node scripts/nuevas.mjs --simular
=================================== */
import { appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crearCliente, leerJSON, escribirJSON, dormir } from './comunidad.mjs';
import { escribirCatalogo } from './catalogo.mjs';
import { normalizarTitulo } from './analisis.mjs';
import { diaHabil } from './niveles.mjs';

export const POR_DIA = 20;
export const POR_GRUPO = 10;                  // 10 en tendencia o estrenos y 10 populares
export const MIN_LECTORES = 2500;
export const MIN_PUNTAJE = 70;
export const MIN_PUNTAJE_PROMETEDORA = 75;
const PAISES = new Set(['JP', 'KR', 'CN', 'TW', 'HK']);     // manga, manhwa y manhua
const FORMATOS = new Set(['MANGA', 'ONE_SHOT']);              // sin novelas
// Guías, antologías, pilotos y ediciones a color: comparten nombre con la obra, pero no son la obra
const EXTRAS = /\b(anthology|fanbook|guidebook|guide book|artbook|art book|databook|data book|doujinshi|pilot|one ?shot|colou?red|full colou?r)\b/;
const ANILIST = 'https://graphql.anilist.co';
const PAGINAS = { tendencia: 3, estrenos: 2, populares: 20, prometedoras: 2 };

const CONSULTA = `query ($p: Int, $orden: [MediaSort], $desde: FuzzyDateInt, $minimo: Int) {
    Page(page: $p, perPage: 50) { pageInfo { hasNextPage }
        media(type: MANGA, isAdult: false, format_in: [MANGA, ONE_SHOT], status_not: NOT_YET_RELEASED,
              sort: $orden, startDate_greater: $desde, popularity_greater: $minimo) {
            id isAdult format status countryOfOrigin popularity meanScore trending
            title { romaji english } startDate { year month day } } } }`;

// Fecha de AniList ("FuzzyDateInt", como 20251123) de hace tantos días
export const fechaAniList = (fecha, diasAtras) => {
    const d = new Date(Date.parse(fecha + 'T00:00:00Z') - diasAtras * 86400000);
    return Number(d.toISOString().slice(0, 10).replace(/-/g, ''));
};
const inicioDe = m => m.startDate && m.startDate.year ? m.startDate.year * 10000 + (m.startDate.month || 1) * 100 + (m.startDate.day || 1) : 0;

/* ¿Puede entrar? Devuelve null si sí, o el motivo por el que no.
   contexto: { enCatalogo: Set de números de AniList, bloqueadas: Set, titulos: Set de títulos normalizados } */
export function motivoParaNo(m, origen, { enCatalogo, bloqueadas, titulos }){
    if (!m || m.isAdult) return 'para adultos';
    if (!FORMATOS.has(m.format)) return 'no es manga, manhwa ni manhua';
    if (!PAISES.has(m.countryOfOrigin)) return 'de otro país';
    if (m.status === 'NOT_YET_RELEASED') return 'todavía no sale';
    if (!(m.popularity >= MIN_LECTORES)) return 'pocos lectores';
    if (Number.isFinite(m.meanScore)){
        if (m.meanScore < (origen === 'prometedora' ? MIN_PUNTAJE_PROMETEDORA : MIN_PUNTAJE)) return 'puntaje bajo';
    } else if (origen !== 'tendencia' && origen !== 'estreno') return 'sin puntaje';
    if (enCatalogo.has(m.id)) return 'ya está';
    if (bloqueadas.has(m.id)) return 'excluida';
    const nombres = [m.title && m.title.romaji, m.title && m.title.english].filter(Boolean).map(normalizarTitulo);
    if (nombres.some(t => EXTRAS.test(t))) return 'es un extra';
    if (nombres.some(t => t && titulos.has(t))) return 'otra edición de una que ya está';
    return null;
}

/* Elige las de hoy. listas: { tendencia, estrenos, populares, prometedoras } (como las da AniList);
   desdeEstreno: FuzzyDateInt desde el que una obra cuenta como estreno.
   Devuelve [{ m, origen }] en el orden en que entran. */
export function elegirNuevas(listas, contexto, { cupo = POR_DIA, porGrupo = POR_GRUPO, desdeEstreno = 0 } = {}){
    const elegidas = [];
    const usadas = new Set();
    const tomar = (candidatas, cuantas) => {
        let n = 0;
        for (const { m, origen } of candidatas){
            if (n >= cuantas || elegidas.length >= cupo) break;
            if (!m || usadas.has(m.id) || motivoParaNo(m, origen, contexto)) continue;
            usadas.add(m.id);
            elegidas.push({ m, origen });
            n++;
        }
    };
    // 1. En tendencia o estrenos: primero las que más se mueven ahora
    const vistas = new Set();
    const grupo1 = [...(listas.tendencia || []), ...(listas.estrenos || [])]
        .filter(m => m && !vistas.has(m.id) && vistas.add(m.id))
        .sort((a, b) => (b.trending || 0) - (a.trending || 0) || (b.popularity || 0) - (a.popularity || 0))
        .map(m => ({ m, origen: inicioDe(m) > desdeEstreno ? 'estreno' : 'tendencia' }));
    // 2. Las más populares de siempre que faltan
    const grupo2 = [...(listas.populares || [])].sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).map(m => ({ m, origen: 'popular' }));
    // 3. Prometedoras: recientes y con muy buen puntaje
    const grupo3 = [...(listas.prometedoras || [])].sort((a, b) => (b.meanScore || 0) - (a.meanScore || 0) || (b.popularity || 0) - (a.popularity || 0))
        .map(m => ({ m, origen: 'prometedora' }));

    tomar(grupo1, porGrupo);
    tomar(grupo2, porGrupo);
    // Si de un lado no alcanzaron: más tendencias, después prometedoras y al final más populares
    tomar(grupo1, cupo);
    tomar(grupo3, cupo);
    tomar(grupo2, cupo);
    return elegidas;
}

// Una lista de AniList, página por página (para "populares" se detiene apenas hay suficientes)
async function traerLista(pedir, variables, paginas, { basta = null } = {}){
    const lista = [];
    for (let p = 1; p <= paginas; p++){
        const r = await pedir(ANILIST, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: CONSULTA, variables: { ...variables, p } }) });
        if (r.errors && r.errors.length) throw new Error('AniList: ' + r.errors.map(e => e.message).join('; '));
        lista.push(...(r.data.Page.media || []));
        if (!r.data.Page.pageInfo.hasNextPage || (basta && basta(lista))) break;
    }
    return lista;
}

export async function buscarNuevas({
    raiz,
    fetch = globalThis.fetch,
    ahora = new Date(),
    esperar = dormir,
    registro = console.log,
    simular = false,
    forzar = false                 // también el fin de semana (solo a mano)
} = {}){
    const fecha = ahora.toISOString().slice(0, 10);
    const ruta = nombre => join(raiz, nombre);
    if (!forzar && !simular && diaHabil(fecha) === null){
        registro('Hoy es fin de semana: las obras nuevas entran de lunes a viernes.');
        return [];
    }
    const lista = await leerJSON(ruta('catalogo.json'));
    const historial = await leerJSON(ruta('datos/agregadas.json'), { obras: {} });
    const catalogo = await leerJSON(ruta('obras.json'), { obras: [] });
    const vistas = new Set();
    const entradas = (lista.obras || []).filter(e => e && Number.isInteger(e.anilist) && !vistas.has(e.anilist) && vistas.add(e.anilist));
    const enCatalogo = new Set(entradas.map(e => e.anilist));
    // No vuelven: las excluidas a mano y las que entraron solas y ya no están (las quitaste)
    const bloqueadas = new Set([
        ...(lista.excluidas || []).map(x => Number(x && typeof x === 'object' ? x.anilist : x)).filter(Number.isInteger),
        ...Object.keys(historial.obras || {}).map(Number).filter(id => !enCatalogo.has(id))
    ]);
    const titulos = new Set((catalogo.obras || []).flatMap(o => [o.titulo, o.titulos && o.titulos.romaji, o.titulos && o.titulos.ingles])
        .filter(Boolean).map(normalizarTitulo));
    // Si la tarea corre dos veces el mismo día, no se pasa de 20
    const hoyYa = Object.values(historial.obras || {}).filter(x => x && x.fecha === fecha).length;
    const cupo = Math.max(0, POR_DIA - hoyYa);
    if (!cupo){
        registro(`Hoy ya entraron ${hoyYa} obras nuevas.`);
        return [];
    }

    const pedir = crearCliente({ fetch, esperar, registro });
    const contexto = { enCatalogo, bloqueadas, titulos };
    const hastaUnAnio = fechaAniList(fecha, 365);
    const elegiblesPopulares = l => l.filter(m => !motivoParaNo(m, 'popular', contexto)).length >= cupo;
    const listas = {
        tendencia: await traerLista(pedir, { orden: ['TRENDING_DESC'], minimo: MIN_LECTORES - 1 }, PAGINAS.tendencia),
        estrenos: await traerLista(pedir, { orden: ['TRENDING_DESC', 'POPULARITY_DESC'], desde: hastaUnAnio, minimo: MIN_LECTORES - 1 }, PAGINAS.estrenos),
        populares: await traerLista(pedir, { orden: ['POPULARITY_DESC'], minimo: MIN_LECTORES - 1 }, PAGINAS.populares, { basta: elegiblesPopulares }),
        prometedoras: await traerLista(pedir, { orden: ['SCORE_DESC'], desde: fechaAniList(fecha, 730), minimo: MIN_LECTORES - 1 }, PAGINAS.prometedoras)
    };
    const elegidas = elegirNuevas(listas, contexto, { cupo, desdeEstreno: hastaUnAnio });

    const nombre = m => (m.title && (m.title.english || m.title.romaji)) || String(m.id);
    const NOMBRES = { tendencia: 'en tendencia', estreno: 'estreno', popular: 'popular', prometedora: 'prometedora' };
    registro(`${simular ? 'Entrarían' : 'Entran'} ${elegidas.length} obras nuevas:`);
    elegidas.forEach(({ m, origen }) => registro(`  ${nombre(m)} (${m.countryOfOrigin}, ${NOMBRES[origen]}, ${m.popularity} lectores, ` +
        `${Number.isFinite(m.meanScore) ? m.meanScore + '/100' : 'sin puntaje'}) https://anilist.co/manga/${m.id}`));
    if (process.env.GITHUB_STEP_SUMMARY && elegidas.length){
        const filas = elegidas.map(({ m, origen }) => `| [${nombre(m).replace(/\|/g, '/')}](https://anilist.co/manga/${m.id}) | ${m.countryOfOrigin} | ${NOMBRES[origen]} | ${m.popularity} | ${Number.isFinite(m.meanScore) ? m.meanScore : '—'} |`);
        await appendFile(process.env.GITHUB_STEP_SUMMARY, `### ${simular ? 'Obras que entrarían hoy (simulación)' : 'Obras nuevas de hoy'}\n\n| Obra | País | Por qué | Lectores | Puntaje |\n|---|---|---|---|---|\n${filas.join('\n')}\n\n`);
    }
    if (simular || !elegidas.length) return elegidas;

    // Se agregan al final de catalogo.json; catalogo.mjs les pone nombre y portada
    for (const { m } of elegidas) entradas.push({ anilist: m.id, agregada: fecha });
    await escribirCatalogo(ruta('catalogo.json'), lista, entradas);
    for (const { m, origen } of elegidas) (historial.obras || (historial.obras = {}))[String(m.id)] = { fecha, origen, titulo: nombre(m) };
    await escribirJSON(ruta('datos/agregadas.json'), {
        _ayuda: 'Obras que entraron solas al catálogo (scripts/nuevas.mjs). Si quitas una de catalogo.json, no vuelve a entrar.',
        obras: historial.obras
    });
    return elegidas;
}

// node scripts/nuevas.mjs [--simular] [--forzar]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href){
    const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
    buscarNuevas({ raiz, simular: process.argv.includes('--simular'), forzar: process.argv.includes('--forzar') }).catch(error => {
        console.error('Error:', error.message);
        process.exit(1);
    });
}
