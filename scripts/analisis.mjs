/* ===================================
   FROZEN PROJECT: cálculos de "Lo que opina la comunidad"
   Funciones puras: reciben datos y devuelven resultados, sin usar internet.
   Las usa scripts/comunidad.mjs, que es quien trae los datos de cada fuente.
=================================== */

import { ETIQUETAS, CATEGORIAS_OCULTAS, ETIQUETAS_OCULTAS } from './etiquetas.mjs';

export const METODO = '1.2';

// Ninguna comunidad cuenta más de 10.000 votos: así AniList (la más grande)
// no tapa a Kitsu o MangaUpdates solo por tener más usuarios.
export const TOPE_VOTOS = 10000;

// Una comunidad con menos de 100 votos casi no pesa en el promedio, y tampoco
// se usa para decidir si las comunidades coinciden (pocos votos = mucho azar).
export const MIN_VOTOS_COMPARAR = 100;

// Peso del "promedio del catálogo" en el promedio bayesiano: una obra con pocos
// votos se acerca a ese promedio hasta que junte más opiniones.
export const PESO_PREVIO = 50;

// Mínimo de reseñas para decir qué temas se elogian o critican
export const MIN_RESENAS_TEMAS = 8;

export const redondear = (n, decimales = 0) => {
    const f = 10 ** decimales;
    return Math.round(n * f) / f;
};

/* ---------- Puntaje combinado ----------
   fuentes: { anilist: { puntaje: 0-100, votos }, kitsu: {...}, ... } */
export function combinarPuntajes(fuentes, mediaCatalogo){
    const validas = Object.values(fuentes || {})
        .filter(f => f && Number.isFinite(f.puntaje) && Number.isFinite(f.votos) && f.votos > 0);
    if (!validas.length) return null;

    let suma = PESO_PREVIO * mediaCatalogo;
    let pesos = PESO_PREVIO;
    let votos = 0;
    for (const f of validas){
        const peso = Math.min(f.votos, TOPE_VOTOS);
        suma += peso * f.puntaje;
        pesos += peso;
        votos += f.votos;
    }
    const comparables = validas.filter(f => f.votos >= MIN_VOTOS_COMPARAR);
    const puntajes = (comparables.length ? comparables : validas).map(f => f.puntaje);
    const diferencia = Math.max(...puntajes) - Math.min(...puntajes);

    // Confianza: muchos votos y comunidades que coinciden
    let confianza = 'baja';
    if (comparables.length >= 2 && votos >= 5000 && diferencia <= 8) confianza = 'alta';
    else if (votos >= 1000 && diferencia <= 15) confianza = 'media';

    return {
        valor: redondear(suma / pesos, 1),
        votos,
        confianza,
        diferencia: redondear(diferencia, 1),
        comunidades: validas.length
    };
}

/* ---------- Reparto de votos (AniList agrupa los votos en 10, 20, ..., 100) ---------- */
export function analizarDistribucion(scoreDistribution){
    const d = (scoreDistribution || []).filter(b => b && b.amount > 0 && b.score > 0);
    const n = d.reduce((a, b) => a + b.amount, 0);
    if (n < 50) return null;

    const media = d.reduce((a, b) => a + b.score * b.amount, 0) / n;
    const desviacion = Math.sqrt(d.reduce((a, b) => a + b.amount * (b.score - media) ** 2, 0) / n);
    const parte = condicion => d.filter(condicion).reduce((a, b) => a + b.amount, 0) / n;
    const gusta = parte(b => b.score >= 70);
    const noGusta = parte(b => b.score <= 40);
    const barras = Array.from({ length: 10 }, (_, i) => {
        const cubeta = d.find(b => b.score === (i + 1) * 10);
        return redondear(100 * (cubeta ? cubeta.amount : 0) / n, 1);
    });

    // Calibrado con las 40 obras del catálogo (desviaciones entre 12,5 y 19)
    let division = 'coinciden';
    if (desviacion > 17.5 || noGusta >= 0.06) division = 'divididas';
    else if (desviacion > 15) division = 'variadas';

    return {
        votos: n,
        gusta: redondear(gusta, 3),
        noGusta: redondear(noGusta, 3),
        desviacion: redondear(desviacion, 1),
        division,
        barras
    };
}

/* ---------- Reseñas ----------
   Límite inferior de Wilson: qué tan alta es, como mínimo, la proporción de
   reseñas positivas con 95 % de confianza. Con pocas reseñas da un número prudente. */
export function wilson(positivas, total, z = 1.96){
    if (!total) return 0;
    const p = positivas / total;
    const denominador = 1 + z * z / total;
    const centro = p + z * z / (2 * total);
    const margen = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total);
    return (centro - margen) / denominador;
}

// Temas que se buscan en las reseñas (inglés, que es el idioma de casi todas, y español)
export const TEMAS = {
    arte: ['art', 'artwork', 'art style', 'artstyle', 'drawing', 'drawings', 'illustration', 'illustrations', 'visuals', 'paneling', 'panelling', 'arte', 'dibujo', 'dibujos', 'ilustración', 'ilustraciones', 'trazo'],
    historia: ['story', 'plot', 'storyline', 'narrative', 'storytelling', 'writing', 'historia', 'trama', 'argumento', 'guion', 'guión'],
    personajes: ['character', 'characters', 'protagonist', 'protagonists', 'mc', 'main character', 'cast', 'villain', 'villains', 'antagonist', 'character development', 'personaje', 'personajes', 'protagonista', 'villano', 'villanos'],
    ritmo: ['pacing', 'pace', 'paced', 'rushed', 'filler', 'ritmo', 'apresurado', 'apresurada', 'relleno'],
    final: ['ending', 'endings', 'finale', 'conclusion', 'last chapter', 'final arc', 'desenlace'],
    accion: ['action', 'fight', 'fights', 'fighting', 'fight scenes', 'battle', 'battles', 'combat', 'acción', 'pelea', 'peleas', 'batalla', 'batallas', 'combate'],
    mundo: ['worldbuilding', 'world-building', 'world building', 'setting', 'lore', 'power system', 'magic system', 'ambientación', 'sistema de poder'],
    romance: ['romance', 'romantic', 'relationship', 'relationships', 'chemistry', 'love story', 'relación', 'pareja'],
    humor: ['comedy', 'humor', 'humour', 'funny', 'jokes', 'gags', 'comedia', 'gracioso', 'chistes'],
    emocion: ['emotional', 'emotions', 'heartbreaking', 'tearjerker', 'emotivo', 'emotiva', 'conmovedor', 'conmovedora']
};

const POSITIVAS = ['good', 'great', 'amazing', 'awesome', 'excellent', 'fantastic', 'incredible', 'beautiful', 'gorgeous',
    'stunning', 'masterpiece', 'brilliant', 'perfect', 'love', 'loved', 'loving', 'enjoy', 'enjoyed', 'enjoyable', 'fun',
    'interesting', 'compelling', 'engaging', 'gripping', 'solid', 'strong', 'impressive', 'satisfying', 'memorable', 'unique',
    'creative', 'clever', 'epic', 'peak', 'best', 'favorite', 'favourite', 'wonderful', 'hilarious', 'charming', 'likable',
    'likeable', 'lovable', 'detailed', 'polished', 'deep', 'refreshing', 'nice', 'cool', 'outstanding', 'superb', 'phenomenal',
    'captivating', 'well written', 'well-written', 'well done', 'well-done', 'well paced', 'well-paced', 'top notch', 'top-notch',
    'bueno', 'buena', 'buenísimo', 'buenísima', 'excelente', 'increíble', 'hermoso', 'hermosa', 'precioso', 'preciosa',
    'obra maestra', 'brillante', 'perfecto', 'perfecta', 'encanta', 'encantó', 'disfruté', 'divertido', 'divertida',
    'interesante', 'atrapante', 'adictivo', 'adictiva', 'sólido', 'sólida', 'impresionante', 'bien escrito', 'bien escrita',
    'satisfactorio', 'memorable', 'único', 'única', 'creativo', 'creativa', 'épico', 'épica', 'mejor', 'favorito', 'favorita',
    'maravilloso', 'maravillosa', 'genial', 'entretenido', 'entretenida'];

const NEGATIVAS = ['bad', 'terrible', 'awful', 'horrible', 'boring', 'bored', 'dull', 'weak', 'poor', 'poorly', 'worst', 'hate',
    'hated', 'annoying', 'rushed', 'dragged', 'drags', 'repetitive', 'generic', 'cliche', 'cliché', 'cliched', 'predictable',
    'forgettable', 'mediocre', 'messy', 'confusing', 'disappointing', 'disappointed', 'disappointment', 'flat', 'bland', 'lazy',
    'cringe', 'cringey', 'cringy', 'pointless', 'unnecessary', 'ruined', 'overrated', 'shallow', 'inconsistent', 'garbage',
    'meh', 'lackluster', 'lacklustre', 'underwhelming', 'tedious', 'stale', 'too slow', 'slow paced', 'slow-paced', 'nonsense',
    'malo', 'mala', 'terrible', 'horrible', 'aburrido', 'aburrida', 'aburre', 'débil', 'pobre', 'peor', 'odio', 'odié',
    'molesto', 'molesta', 'apresurado', 'apresurada', 'repetitivo', 'repetitiva', 'genérico', 'genérica', 'predecible',
    'mediocre', 'confuso', 'confusa', 'decepcionante', 'decepción', 'plano', 'plana', 'flojo', 'floja', 'sobrevalorado',
    'sobrevalorada', 'superficial', 'inconsistente', 'basura', 'muy lento', 'muy lenta'];

const NEGACIONES = new Set(['not', 'no', 'never', 'hardly', 'barely', 'isnt', 'wasnt', 'doesnt', 'dont', 'didnt', 'arent',
    'werent', 'cant', 'couldnt', 'wont', 'nothing', 'without', 'nunca', 'ni', 'nada', 'tampoco', 'sin']);

const escapar = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Límites de palabra que funcionan con acentos (\b de JavaScript no los entiende)
const patron = palabras => new RegExp(`(?<![\\p{L}\\p{N}])(?:${palabras.map(escapar).sort((a, b) => b.length - a.length).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
const PATRONES_TEMAS = Object.entries(TEMAS).map(([tema, palabras]) => [tema, patron(palabras)]);
const PATRON_POSITIVAS = patron(POSITIVAS);
const PATRON_NEGATIVAS = patron(NEGATIVAS);

// Quita el formato de AniList: imágenes, videos, enlaces, HTML, marcas de spoiler y markdown
export function limpiarTexto(texto){
    return String(texto || '')
        .replace(/(?:img|image|youtube|webm)\d*%?\s*\([^)]*\)/gi, ' ')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/~!|!~|~~~|__|\*\*|[#>*_~`]/g, ' ')
        .replace(/&[a-z]+;/gi, ' ')
        .replace(/[ \t]+/g, ' ');
}

// Texto de una reseña para resumirla: sin lo marcado como spoiler (~! ... !~), sin formato,
// recortado en una palabra completa
export function textoParaResumen(texto, maximo = 500){
    const limpio = limpiarTexto(String(texto || '').replace(/~![\s\S]*?!~/g, ' '))
        .replace(/\s+/g, ' ').trim();
    if (limpio.length <= maximo) return limpio;
    const corte = limpio.slice(0, maximo);
    return corte.slice(0, Math.max(corte.lastIndexOf(' '), maximo * 0.8)).trim() + '…';
}

export function oraciones(texto){
    return texto.split(/[.!?¡¿;\n]+/).map(o => o.trim()).filter(o => o.length > 3);
}

// Tono de una oración: palabras positivas menos negativas; una negación cercana ("not good") invierte el sentido
export function tonoDe(oracion){
    const minus = oracion.toLowerCase();
    let tono = 0;
    const evaluar = (re, signo) => {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(minus))){
            const antes = minus.slice(0, m.index).replace(/[’']/g, '').split(/[^\p{L}]+/u).filter(Boolean).slice(-3);
            const negado = antes.some(p => NEGACIONES.has(p));
            tono += negado ? -signo : signo;
        }
    };
    evaluar(PATRON_POSITIVAS, 1);
    evaluar(PATRON_NEGATIVAS, -1);
    return tono;
}

export function temasEn(oracion){
    return PATRONES_TEMAS.filter(([, re]) => { re.lastIndex = 0; return re.test(oracion); }).map(([tema]) => tema);
}

const valida = r => r && Number.isFinite(r.score);

/* Frases de las reseñas que hablan de algún tema: { resena (posición en la lista), texto, temas }.
   Su tono lo pone el modelo de sentimiento (tono.mjs) o, si no está, las palabras clave. */
export function frasesConTemas(resenas){
    const frases = [];
    (resenas || []).forEach((r, i) => {
        if (!valida(r)) return;
        for (const texto of oraciones(limpiarTexto(r.body))){
            const temas = temasEn(texto);
            if (temas.length) frases.push({ resena: i, texto, temas });
        }
    });
    return frases;
}

export const tonosConPalabras = frases => frases.map(f => Math.sign(tonoDe(f.texto)));

// Suma de tonos de las frases de cada reseña, tema por tema: { posición: { tema: balance } }
function balancesPorResena(frases, tonos){
    const balances = new Map();
    frases.forEach((f, k) => {
        const b = balances.get(f.resena) || {};
        for (const t of f.temas) b[t] = (b[t] || 0) + Math.sign(tonos[k] || 0);
        balances.set(f.resena, b);
    });
    return balances;
}

/* resenas: [{ score: 0-100, rating: votos de "útil", ratingAmount: votos totales, body }]
   frases y tonos: opcionales (si faltan, se calculan con palabras clave).
   Devuelve cuántas son positivas y los temas que más se elogian o critican.
   No devuelve ni guarda el texto de las reseñas. */
export function analizarResenas(resenas, frases = frasesConTemas(resenas), tonos = tonosConPalabras(frases)){
    const lista = (resenas || []).map((r, i) => [r, i]).filter(([r]) => valida(r));
    const n = lista.length;
    if (!n) return { n: 0 };

    const balances = balancesPorResena(frases, tonos);
    let positivas = 0;
    let negativas = 0;
    const temas = {};
    for (const [r, i] of lista){
        if (r.score >= 70) positivas++;
        else if (r.score <= 50) negativas++;

        // Las reseñas que los lectores marcaron como útiles pesan más
        const peso = ((r.rating || 0) + 1) / ((r.ratingAmount || 0) + 2);
        // Cada reseña cuenta una vez por tema: si en total lo elogia o lo critica
        for (const [t, b] of Object.entries(balances.get(i) || {})){
            const a = temas[t] || (temas[t] = { resenas: 0, a_favor: 0, en_contra: 0, resenasAFavor: 0, resenasEnContra: 0 });
            a.resenas++;
            if (b > 0){ a.a_favor += peso; a.resenasAFavor++; }
            else if (b < 0){ a.en_contra += peso; a.resenasEnContra++; }
        }
    }

    // Con menos de 8 reseñas los temas salen poco confiables (calibrado con reseñas reales): no se publican.
    // Además, un tema solo se publica si varias reseñas lo elogian o lo critican, no una sola
    // (con datos reales, una reseña muy votada bastaba para marcar "lo emotivo" como criticado).
    const minimo = Math.max(3, Math.ceil(n * 0.2));
    const minimoAFavor = Math.max(3, Math.ceil(n * 0.15));
    const minimoEnContra = Math.max(2, Math.ceil(n * 0.1));
    const candidatos = n < MIN_RESENAS_TEMAS ? [] : Object.entries(temas)
        .filter(([, a]) => a.resenas >= minimo && a.a_favor + a.en_contra > 0)
        .sort((x, y) => y[1].resenas - x[1].resenas);
    const elogian = candidatos.filter(([, a]) => a.resenasAFavor >= minimoAFavor && a.a_favor / (a.a_favor + a.en_contra) >= 0.7).slice(0, 3).map(([t]) => t);
    const critican = candidatos.filter(([, a]) => a.resenasEnContra >= minimoEnContra && a.en_contra / (a.a_favor + a.en_contra) >= 0.4).slice(0, 3).map(([t]) => t);

    return {
        n,
        positivas,
        negativas,
        mixtas: n - positivas - negativas,
        wilson: redondear(wilson(positivas, positivas + negativas), 3),
        elogian,
        critican
    };
}

/* ¿El tono de las frases coincide con el puntaje que puso quien escribió la reseña?
   Sirve para medir si el modelo acierta más que las palabras clave. Se mide aparte en las
   reseñas positivas (70 o más) y en las negativas (50 o menos), porque casi todas son positivas
   y un método que siempre dijera "positiva" parecería bueno sin serlo. */
export function evaluarTono(resenas, frases, tonos){
    const balances = balancesPorResena(frases, tonos);
    const resultado = { positivas: { aciertos: 0, total: 0 }, negativas: { aciertos: 0, total: 0 } };
    (resenas || []).forEach((r, i) => {
        if (!valida(r) || !balances.has(i)) return;
        const esperado = r.score >= 70 ? 1 : r.score <= 50 ? -1 : 0;
        if (!esperado) return;
        const suma = Object.values(balances.get(i)).reduce((a, b) => a + b, 0);
        const grupo = esperado > 0 ? resultado.positivas : resultado.negativas;
        grupo.total++;
        if (Math.sign(suma) === esperado) grupo.aciertos++;
    });
    return resultado;
}

export function sumarEvaluaciones(a, b){
    return {
        positivas: { aciertos: a.positivas.aciertos + b.positivas.aciertos, total: a.positivas.total + b.positivas.total },
        negativas: { aciertos: a.negativas.aciertos + b.negativas.aciertos, total: a.negativas.total + b.negativas.total }
    };
}

// Acierto equilibrado: el promedio entre lo que acierta en positivas y en negativas
export function aciertoEquilibrado(e){
    const p = e.positivas.total ? e.positivas.aciertos / e.positivas.total : null;
    const q = e.negativas.total ? e.negativas.aciertos / e.negativas.total : null;
    if (p === null || q === null) return null;
    return redondear((p + q) / 2, 3);
}

/* ---------- Tendencia: cambio frente a la medición de hace una semana o más ---------- */
export function calcularTendencia(actual, anterior, dias){
    if (!anterior || !Number.isFinite(dias) || dias < 5) return null;
    const lectores = anterior.popularidad > 0 && actual.popularidad > 0
        ? redondear((actual.popularidad - anterior.popularidad) / anterior.popularidad, 4)
        : null;
    const puntaje = Number.isFinite(actual.puntaje) && Number.isFinite(anterior.puntaje)
        ? redondear(actual.puntaje - anterior.puntaje, 1)
        : null;
    if (lectores === null && puntaje === null) return null;
    return { lectores, puntaje, dias };
}

/* ---------- Actividad diaria de AniList ----------
   AniList guarda, día por día, cuánta actividad tuvo cada obra (gente que la agrega o avanza
   capítulos), cuántos la tienen en su lista y cuántos la están leyendo.
   nodos: [{ date (segundos), trending, popularity, inProgress }] */
const DIA = 86400;
export function analizarActividad(nodos){
    const dias = (nodos || []).filter(n => n && Number.isFinite(n.date)).sort((a, b) => b.date - a.date);
    if (!dias.length) return null;
    const ultimo = dias[0].date;
    const semana = dias.filter(n => n.date > ultimo - 7 * DIA)
        .reduce((a, n) => a + (Number.isFinite(n.trending) ? n.trending : 0), 0);
    const leyendo = (dias.find(n => Number.isFinite(n.inProgress) && n.inProgress > 0) || {}).inProgress || null;

    // Lectores: el último dato contra el de hace una semana (el más cercano a 7 días, entre 6 y 9)
    const conLectores = dias.filter(n => Number.isFinite(n.popularity) && n.popularity > 0);
    const hoy = conLectores[0];
    const distancia = n => Math.abs(hoy.date - n.date - 7 * DIA);
    const antes = hoy && conLectores
        .filter(n => hoy.date - n.date >= 6 * DIA && hoy.date - n.date <= 9 * DIA)
        .sort((a, b) => distancia(a) - distancia(b))[0];
    return {
        semana,
        leyendo,
        lectores: antes ? redondear((hoy.popularity - antes.popularity) / antes.popularity, 4) : null,
        dias: antes ? Math.round((hoy.date - antes.date) / DIA) : null
    };
}

/* ---------- Etiquetas votadas por los lectores de AniList ----------
   Solo las que no son spoiler, con 60 % de acuerdo o más; como mucho 10 por obra. */
export const MIN_VOTO_ETIQUETA = 60;
export const MAX_ETIQUETAS = 10;

export const slug = texto => String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function prepararEtiquetas(tags){
    const sinTraducir = [];
    const etiquetas = (tags || [])
        .filter(t => t && t.name && Number.isFinite(t.rank) && t.rank >= MIN_VOTO_ETIQUETA
            && !t.isMediaSpoiler && !t.isGeneralSpoiler
            && !CATEGORIAS_OCULTAS.has(t.category) && !ETIQUETAS_OCULTAS.has(t.name))
        .sort((a, b) => b.rank - a.rank)
        .slice(0, MAX_ETIQUETAS)
        .map(t => {
            const nombre = ETIQUETAS[t.name];
            if (nombre) return { id: slug(nombre), nombre, voto: t.rank };
            sinTraducir.push(t.name);
            return { id: slug(t.name), nombre: t.name, voto: t.rank, en: true };
        });
    return { etiquetas, sinTraducir };
}

/* ---------- Recomendaciones de los lectores de AniList ("si te gustó…") ----------
   nodos: [{ rating (votos a favor menos en contra), mediaRecommendation }].
   Solo manga, manhwa y manhua (no novelas ni obras para adultos), con 3 votos o más. */
export const MAX_RECOMENDACIONES = 6;
export const MIN_VOTOS_RECOMENDACION = 3;
const TIPO_POR_PAIS = { JP: 'manga', KR: 'manhwa', CN: 'manhua', TW: 'manhua', HK: 'manhua' };

export function prepararRecomendaciones(nodos){
    const vistas = new Set();
    return (nodos || [])
        .filter(n => n && n.mediaRecommendation && Number.isFinite(n.rating) && n.rating >= MIN_VOTOS_RECOMENDACION)
        .filter(({ mediaRecommendation: m }) => m.type === 'MANGA' && ['MANGA', 'ONE_SHOT'].includes(m.format)
            && !m.isAdult && !vistas.has(m.id) && vistas.add(m.id))
        .sort((a, b) => b.rating - a.rating)
        .slice(0, MAX_RECOMENDACIONES)
        .map(({ rating, mediaRecommendation: m }) => ({
            anilist: m.id,
            titulo: (m.title && (m.title.english || m.title.romaji)) || '',
            tipo: TIPO_POR_PAIS[m.countryOfOrigin] || 'manga',
            votos: rating,
            portada: (m.coverImage && m.coverImage.medium) || null
        }))
        .filter(r => r.titulo);
}

/* ---------- Encontrar la obra en MangaUpdates (que no tiene el ID de AniList) ---------- */
export function normalizarTitulo(titulo){
    return String(titulo || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Antologías, guías y extras comparten nombre con la obra, pero no son la obra
// (con datos reales, a "19 Days" le tocaba "19 Days Anthology", con 8 votos).
const EXTRAS = /\b(anthology|fanbook|guidebook|guide book|artbook|art book|databook|data book|side stor(?:y|ies)|spin ?off|doujinshi|pilot|one ?shot|colou?red|full colou?r)\b/;

const titulosDe = obra => new Set([obra.titulo, obra.titulos && obra.titulos.romaji, obra.titulos && obra.titulos.ingles, ...(obra.sinonimos || [])]
    .filter(Boolean).map(normalizarTitulo));

/* Qué tan bien coincide un resultado de MangaUpdates con la obra:
   3 = mismo título principal; 2 = mismo título con una aclaración, como "Sweet Home (KIM Carnby)";
   1 = coincide solo uno de sus otros nombres; 0 = no es la obra (otro año, otro tipo o un extra). */
export function coincidencia(obra, resultado){
    const registro = resultado.record || resultado;
    const nuestros = titulosDe(obra);
    const anio = obra.inicio ? Number(obra.inicio.slice(0, 4)) : null;
    const anioMU = Number(registro.year) || null;
    if (anio && anioMU && Math.abs(anioMU - anio) > 1) return 0;
    if (registro.type && registro.type.toLowerCase() !== obra.tipo) return 0;
    const titulo = normalizarTitulo(registro.title);
    const extra = titulo.match(EXTRAS);
    if (extra && ![...nuestros].some(t => t.includes(extra[1]))) return 0;
    if (nuestros.has(titulo)) return 3;
    if (nuestros.has(normalizarTitulo(String(registro.title || '').replace(/\s*\([^)]*\)\s*$/, '')))) return 2;
    if (resultado.hit_title && nuestros.has(normalizarTitulo(resultado.hit_title))) return 1;
    return 0;
}

// La mejor coincidencia; si empatan, la que tiene más votos (la obra principal, no una versión aparte)
export function elegirSerie(obra, resultados){
    let mejor = null;
    for (const r of resultados || []){
        const nivel = coincidencia(obra, r);
        if (!nivel) continue;
        const registro = r.record || r;
        const votos = Number(registro.rating_votes) || 0;
        if (!mejor || nivel > mejor.nivel || (nivel === mejor.nivel && votos > mejor.votos)) mejor = { registro, nivel, votos };
    }
    return mejor ? mejor.registro : null;
}

/* ---------- Capítulos y tomos publicados, según MangaUpdates ----------
   "latest_chapter" es el último capítulo que salió; algunos webtoons lo cuentan por temporada,
   así que también se leen los números de "N Chapters" y "N Volumes" de su estado
   (por ejemplo "652 Chapters (Ongoing)") y se usa el mayor. */
export function capitulosDeMangaUpdates(serie){
    if (!serie) return null;
    const estado = String(serie.status || '');
    const numeros = patron => [...estado.matchAll(patron)].map(m => Number(m[1])).filter(n => Number.isFinite(n) && n > 0 && n < 100000);
    const ultimo = Math.max(0, Number(serie.latest_chapter) || 0, ...numeros(/(\d+)\s+chapters?\b/gi));
    const tomos = Math.max(0, ...numeros(/(\d+)\s+volumes?\b/gi));
    if (!ultimo && !tomos) return null;
    return { ultimo: ultimo || null, tomos: tomos || null };
}
