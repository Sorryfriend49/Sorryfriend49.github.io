/* ===================================
   FROZEN PROJECT: tono de las frases de las reseñas
   Usa un modelo de lenguaje gratuito que entiende español e inglés:
   nlptown/bert-base-multilingual-uncased-sentiment (licencia MIT), en su versión para
   JavaScript (Xenova/bert-base-multilingual-uncased-sentiment) con Transformers.js.
   Corre dentro de la tarea de GitHub, sin claves ni pagos; la primera vez descarga
   unos 170 MB y después GitHub los guarda en caché.
   Si no se puede cargar (sin instalar o sin internet), se usan las palabras clave.
=================================== */
import { tonoDe } from './analisis.mjs';

export const MODELO = 'Xenova/bert-base-multilingual-uncased-sentiment';
const LOTE = 32;                // frases por tanda
const MAX_CARACTERES = 400;     // las frases larguísimas se recortan

export const clasificadorPalabras = {
    nombre: 'palabras',
    async tonos(frases){ return frases.map(f => Math.sign(tonoDe(f))); }
};

/* El modelo da de 1 a 5 estrellas con su probabilidad. Promedio de 3,5 o más = elogio (+1);
   2,5 o menos = crítica (−1); en medio, neutro (0). */
export function tonoDeEstrellas(etiquetas){
    let suma = 0;
    let peso = 0;
    for (const { label, score } of etiquetas || []){
        const estrellas = parseInt(label, 10);
        if (!Number.isFinite(estrellas) || !Number.isFinite(score)) continue;
        suma += estrellas * score;
        peso += score;
    }
    if (!peso) return 0;
    const promedio = suma / peso;
    return promedio >= 3.5 ? 1 : promedio <= 2.5 ? -1 : 0;
}

// Envuelve cualquier función que clasifique un lote de frases (el modelo real o uno de prueba)
export function clasificadorConModelo(clasificar){
    return {
        nombre: 'modelo',
        async tonos(frases){
            const tonos = [];
            for (let i = 0; i < frases.length; i += LOTE){
                const lote = frases.slice(i, i + LOTE).map(f => String(f).slice(0, MAX_CARACTERES));
                const resultados = await clasificar(lote, { top_k: 5 });
                for (const r of resultados) tonos.push(tonoDeEstrellas(r));
            }
            return tonos;
        }
    };
}

export async function crearClasificador({ carpeta, registro = () => {} } = {}){
    try {
        const { pipeline, env } = await import('@huggingface/transformers');
        if (carpeta) env.cacheDir = carpeta;
        const inicio = Date.now();
        const clasificar = await pipeline('text-classification', MODELO, { dtype: 'q8' });
        registro(`Modelo de sentimiento listo (${MODELO}, ${Math.round((Date.now() - inicio) / 1000)} s).`);
        return clasificadorConModelo(clasificar);
    } catch (error){
        registro(`El modelo de sentimiento no cargó (${error.message}); se usan palabras clave.`);
        return clasificadorPalabras;
    }
}
