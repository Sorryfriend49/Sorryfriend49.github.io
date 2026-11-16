/* ===================================
   FROZEN PROJECT: cálculos de "Lo que opina la comunidad"
   Funciones puras: reciben datos y devuelven resultados, sin usar internet.
   Las usa scripts/comunidad.mjs, que es quien trae los datos de cada fuente.
=================================== */

export const METODO = '1.1';

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

/* resenas: [{ score: 0-100, rating: votos de "útil", ratingAmount: votos totales, body }]
   Devuelve cuántas son positivas y los temas que más se elogian o critican.
   No devuelve ni guarda el texto de las reseñas. */
export function analizarResenas(resenas){
    const lista = (resenas || []).filter(r => r && Number.isFinite(r.score));
    const n = lista.length;
    if (!n) return { n: 0 };

    let positivas = 0;
    let negativas = 0;
    const temas = {};
    for (const r of lista){
        if (r.score >= 70) positivas++;
        else if (r.score <= 50) negativas++;

        // Las reseñas que los lectores marcaron como útiles pesan más
        const peso = ((r.rating || 0) + 1) / ((r.ratingAmount || 0) + 2);
        const balance = {};
        for (const o of oraciones(limpiarTexto(r.body))){
            const encontrados = temasEn(o);
            if (!encontrados.length) continue;
            const tono = Math.sign(tonoDe(o));
            for (const t of encontrados) balance[t] = (balance[t] || 0) + tono;
        }
        // Cada reseña cuenta una vez por tema: si en total lo elogia o lo critica
        for (const [t, b] of Object.entries(balance)){
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

/* ---------- Encontrar la obra en MangaUpdates (que no tiene el ID de AniList) ---------- */
export function normalizarTitulo(titulo){
    return String(titulo || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
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
