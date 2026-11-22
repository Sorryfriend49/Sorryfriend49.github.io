/* ===================================
   FROZEN PROJECT: qué obras se actualizan por completo cada día (de lunes a viernes)
   Lo usa scripts/comunidad.mjs. La opinión completa de una obra (puntajes de las cuatro
   comunidades, reseñas, etiquetas, recomendaciones y su resumen) se renueva por niveles,
   para que la tarea siga liviana aunque el catálogo crezca:
   - Las que siguen saliendo (en publicación o por salir): una vez por semana, cada una
     siempre el mismo día hábil (1 de cada 5).
   - Las terminadas, canceladas o en pausa: una vez cada 4 semanas (1 de cada 20 días hábiles).
   - Apenas se pueda: las nuevas, las atrasadas (si una tarea falló, o si cambió su estado)
     y las que se quedaron sin resumen.
   Lo liviano de AniList (puntaje, reparto de votos y popularidad) se renueva todos los días
   para todas. Así, con 2000 obras serían unas 230 completas por día en vez de 2000 un lunes.
=================================== */
export const CICLO_EN_PUBLICACION = 5;      // días hábiles entre dos revisiones: una semana
export const CICLO_TERMINADAS = 20;         // cuatro semanas
export const ATRASO_EN_PUBLICACION = 8;     // días de calendario sin revisar: se adelanta
export const ATRASO_TERMINADAS = 31;
export const TOPE_POR_DIA = 300;            // obras completas por día como máximo (unos 30 minutos)
export const TOPE_SIN_RESUMEN = 15;         // de ellas, cuántas solo porque les falta el resumen

const DIA = 86400000;
const INICIO = Date.UTC(2026, 0, 5) / DIA;   // lunes 5 de enero de 2026: el día hábil 0
const SIGUEN_SALIENDO = new Set(['en-publicacion', 'proximamente']);

export const siguenSaliendo = obra => Boolean(obra) && SIGUEN_SALIENDO.has(obra.estado);
export const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DIA);

// Número de día hábil (de lunes a viernes) contado desde el 5 de enero de 2026; null el fin de semana
export function diaHabil(fecha){
    const dias = Math.round(Date.parse(fecha.slice(0, 10) + 'T00:00:00Z') / DIA) - INICIO;
    const semana = Math.floor(dias / 7), resto = dias - semana * 7;
    return resto >= 5 ? null : semana * 5 + resto;
}

// Grupo fijo de una obra (de 0 a n - 1): sale de su número de AniList, así no cambia cuando
// se agregan o quitan otras obras
export function grupo(idAniList, n){
    let h = 2166136261;
    for (const letra of String(idAniList)){ h ^= letra.charCodeAt(0); h = Math.imul(h, 16777619); }
    h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
    return (h >>> 0) % n;
}

// Qué día hábil (0 = lunes) le toca a una obra en su ciclo, para mostrarlo en los registros
export const turno = (obra) => grupo(obra.ids.anilist, siguenSaliendo(obra) ? CICLO_EN_PUBLICACION : CICLO_TERMINADAS);

/* Elige las obras que hoy se actualizan por completo.
   obras: el catálogo (cada una con ids.anilist y estado); anterior: datos/comunidad.json de la
   vez pasada; fecha: 'AAAA-MM-DD' (en hora UTC).
   faltaResumen(previo): si a esa obra le falta un resumen (lo decide resumenes.mjs).
   Devuelve { ids: Set con los números de AniList (en texto), motivos: cuántas por cada motivo,
   quedan: cuántas no entraron por el tope (entran los días siguientes, como atrasadas) }. */
export function elegirDelDia(obras, anterior, fecha, {
    todas = false, tope = TOPE_POR_DIA, topeSinResumen = TOPE_SIN_RESUMEN, faltaResumen = () => false
} = {}){
    const previas = (anterior && anterior.obras) || {};
    // Los datos de antes de los niveles no traen su fecha de revisión: cuentan como del día en que se generaron
    const respaldo = anterior && typeof anterior.generado === 'string' ? anterior.generado.slice(0, 10) : null;
    const hoy = diaHabil(fecha);
    const grupos = { nueva: [], atrasada: [], delDia: [], sinResumen: [] };

    for (const obra of obras){
        if (!obra || !obra.ids || !obra.ids.anilist) continue;
        const id = String(obra.ids.anilist);
        const previo = previas[id];
        if (todas){ grupos.delDia.push({ id, dias: 0 }); continue; }
        const revisada = !previo ? null : ('revisada' in previo ? previo.revisada : respaldo);
        if (!revisada){ grupos.nueva.push({ id, dias: Infinity }); continue; }
        const dias = diasEntre(revisada, fecha);
        if (dias <= 0) continue;                     // ya se revisó hoy (si la tarea corre dos veces)
        const sigue = siguenSaliendo(obra);
        const ciclo = sigue ? CICLO_EN_PUBLICACION : CICLO_TERMINADAS;
        // (Si se renovó hace poco por otro motivo, por ejemplo por ser nueva, igual se renueva en su
        // día: cuesta unos segundos y así cada obra vuelve enseguida a su turno fijo.)
        if (dias >= (sigue ? ATRASO_EN_PUBLICACION : ATRASO_TERMINADAS)) grupos.atrasada.push({ id, dias });
        else if (hoy !== null && hoy % ciclo === grupo(id, ciclo)) grupos.delDia.push({ id, dias });
        else if (faltaResumen(previo)) grupos.sinResumen.push({ id, dias });
    }

    // Primero las nuevas y las atrasadas (las más viejas primero), después las del día y al final
    // las que solo necesitan su resumen (con su propio tope, para que Gemma no se pase de tiempo)
    grupos.atrasada.sort((a, b) => b.dias - a.dias);
    grupos.sinResumen.sort((a, b) => b.dias - a.dias);
    const ids = new Set();
    const motivos = { nueva: 0, atrasada: 0, delDia: 0, sinResumen: 0 };
    let quedan = 0;
    for (const motivo of ['nueva', 'atrasada', 'delDia', 'sinResumen']){
        let usadas = 0;
        for (const { id } of grupos[motivo]){
            const lleno = !todas && (ids.size >= tope || (motivo === 'sinResumen' && usadas >= topeSinResumen));
            if (lleno){ if (motivo !== 'sinResumen') quedan++; continue; }
            ids.add(id);
            usadas++;
        }
        motivos[motivo] = usadas;
    }
    return { ids, motivos, quedan };
}
