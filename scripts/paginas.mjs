/* ===================================
   FROZEN PROJECT: una página propia por obra y el mapa del sitio
   El catálogo es una sola página (index.html) y cada ficha se abre encima, con la dirección
   #catalogo?obra=<id>. Eso no alcanza para compartir ni para Google: WhatsApp, Discord y los
   buscadores leen la página sin correr su JavaScript, así que siempre ven la portada general.
   Este programa escribe, a partir de lo que ya baja la página (datos/lista.json y datos/fichas/):
   - obra/<id>/index.html: la ficha de cada obra como página propia. Al compartirla salen su
     portada, su título y una descripción, y Google la puede encontrar. Se ve como la ficha del
     catálogo, pero sin los números que cambian cada día (lectores, votos y tendencia): así una
     página solo cambia cuando cambia algo de la obra. «Guardar en mi biblioteca» abre su
     ficha en el catálogo.
   - sitemap.xml: la página principal, las legales y todas las obras, con la fecha en que
     cambió cada una (para Google).
   Las páginas de las obras que salen del catálogo se borran.
   Los nombres de géneros, estados, temas y grupos de «Dónde leer» son los mismos de
   catalogo.js: si cambias uno allá, cámbialo aquí también.
   Lo corre scripts/lista.mjs al terminar (la tarea de la comunidad, de lunes a viernes).
   Para probarlo en tu PC: node scripts/paginas.mjs
=================================== */
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const OFICIAL = 'https://frozen-project.vercel.app';
export const CARPETA_PAGINAS = 'obra';
const CARPETA_FICHAS = 'datos/fichas';
// Las direcciones de las obras: solo minúsculas, números y guiones (así son todas)
export const ID_VALIDO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Páginas fijas del mapa del sitio (las de las obras se agregan solas)
const FIJAS = ['/', '/privacidad.html', '/terminos.html'];

// ---------- Lo mismo que catalogo.js ----------
export const GENEROS = {
    'accion': 'Acción', 'aventura': 'Aventura', 'ciencia-ficcion': 'Ciencia ficción',
    'comedia': 'Comedia', 'chicas-magicas': 'Chicas mágicas', 'deportes': 'Deportes',
    'drama': 'Drama', 'fantasia': 'Fantasía', 'mecha': 'Mecha', 'misterio': 'Misterio',
    'musica': 'Música', 'psicologico': 'Psicológico', 'recuentos-de-la-vida': 'Recuentos de la vida',
    'romance': 'Romance', 'sobrenatural': 'Sobrenatural', 'suspenso': 'Suspenso', 'terror': 'Terror'
};
export const TIPOS = { manga: 'Manga', manhwa: 'Manhwa', manhua: 'Manhua' };
export const ESTADOS = {
    'terminado': 'Terminada', 'en-publicacion': 'En publicación', 'pausado': 'En pausa',
    'cancelado': 'Cancelada', 'proximamente': 'Por estrenar'
};
export const IDIOMAS = { es: 'español', en: 'inglés', ja: 'japonés', ko: 'coreano', zh: 'chino' };
const GRUPOS_LECTURA = [
    { titulo: 'En español', cumple: e => e.tipo === 'leer' && e.idioma === 'es', conIdioma: false },
    { titulo: 'En inglés', cumple: e => e.tipo === 'leer' && e.idioma === 'en', conIdioma: false },
    { titulo: 'Tomos impresos y digitales', cumple: e => e.tipo === 'tomos', conIdioma: true },
    { titulo: 'En su idioma original', cumple: e => e.tipo === 'original', conIdioma: true }
];
export const IDIOMA_ORIGINAL = { manga: 'ja', manhwa: 'ko', manhua: 'zh' };
export const NOMBRES_FUENTES = { anilist: 'AniList', kitsu: 'Kitsu', mangaupdates: 'MangaUpdates', myanimelist: 'MyAnimeList' };
export const NOMBRES_TEMAS = {
    arte: 'el arte', historia: 'la historia', personajes: 'los personajes', ritmo: 'el ritmo', final: 'el final',
    accion: 'la acción', mundo: 'el mundo y su sistema', romance: 'el romance', humor: 'el humor', emocion: 'lo emotivo'
};
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const COMUNIDADES = ['anilist', 'myanimelist', 'kitsu', 'mangaupdates'];
const ICONO_ESTRELLA = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/></svg>';
const ICONO_JOYA = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M6.5 3.5h11l4 5.5L12 21 2.5 9z"/><path d="M2.5 9h19M9 3.5L12 9l3-5.5M12 9v12" fill="none" stroke="rgba(3,10,19,.55)" stroke-width="1.2"/></svg>';
const ICONO_COMPARTIR = '<svg class="chip-icono" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="18" cy="5.5" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="6" cy="12" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="18.5" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

const formatoNumero = new Intl.NumberFormat('es');
const formatoLectores = new Intl.NumberFormat('es', { notation: 'compact' });
const formatoPuntaje = new Intl.NumberFormat('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const formatoPorcentaje = new Intl.NumberFormat('es', { style: 'percent', maximumFractionDigits: 1 });
const textoPuntaje = p => formatoPuntaje.format(p / 10);
const portadaGrande = o => o.portadaGrande || o.portada.replace('/cover/medium/', '/cover/large/');
const op = o => o.op || {};
const puntaje = o => Number.isFinite(op(o).puntaje) ? op(o).puntaje : null;
export const enumerar = lista => lista.length <= 1 ? (lista[0] || '') : lista.slice(0, -1).join(', ') + ' y ' + lista[lista.length - 1];

export function textoFecha(iso){
    if (!iso) return '';
    const [a, m, d] = String(iso).split('-').map(Number);
    if (!m) return String(a);
    if (!d) return `${MESES[m - 1]} de ${a}`;
    return `${d} de ${MESES[m - 1]} de ${a}`;
}

// Frase bajo el reparto de votos (igual que en catalogo.js)
export const fraseReparto = d => {
    const base = `Al ${Math.round(d.gusta * 100)} % le gusta (le pone 7/10 o más)`;
    const noGusta = Math.round((d.noGusta || 0) * 100);
    if (d.division === 'divididas' && noGusta >= 6) return `${base}, pero un ${noGusta} % le pone 4 o menos: hay opiniones muy opuestas.`;
    if (d.division === 'divididas') return `${base}. Las notas están muy repartidas.`;
    if (d.division === 'variadas') return `${base}. Las opiniones varían un poco.`;
    return `${base}. La mayoría coincide.`;
};

// ---------- HTML seguro ----------
// html`…` escapa todo lo que se le mete, salvo lo que ya es HTML (otro html`…` o crudo()).
class Html {
    constructor(texto){ this.texto = texto; }
    toString(){ return this.texto; }
}
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapar = texto => String(texto).replace(/[&<>"']/g, c => ESCAPES[c]);
const crudo = texto => new Html(texto);
const aTexto = v => v instanceof Html ? v.texto
    : Array.isArray(v) ? v.map(aTexto).join('')
    : (v === null || v === undefined || v === false || v === '') ? '' : escapar(v);
export const html = (partes, ...valores) => new Html(partes.reduce((s, parte, i) => s + parte + (i < valores.length ? aTexto(valores[i]) : ''), ''));

// Solo direcciones web de verdad (nada de javascript: ni comillas sueltas)
const esWeb = u => typeof u === 'string' && /^https?:\/\/[^\s"'<>\\]+$/i.test(u);
const esHttps = u => esWeb(u) && /^https:/i.test(u);
const esColor = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
export const direccionObra = id => `/${CARPETA_PAGINAS}/${id}/`;
export const urlObra = id => OFICIAL + direccionObra(id);
const fichaEnCatalogo = id => `/#catalogo?obra=${encodeURIComponent(id)}`;
const afuera = html` target="_blank" rel="noopener noreferrer"`;
const enlaceAfuera = (texto, url) => html`<a href="${url}"${afuera}>${texto}</a>`;
const span = (clase, texto) => clase ? html`<span class="${clase}">${texto}</span>` : html`<span>${texto}</span>`;
const etiquetaTipo = tipo => html`<span class="tipo tipo-${tipo}">${TIPOS[tipo]}</span>`;
const placa = color => esColor(color) ? html` style="--color-placa:${color}55"` : '';

// ---------- Textos para compartir y para Google ----------
// "Manga de Kentarou Miura y Studio Gaga, en publicación desde 1989. Acción, aventura, drama y
// fantasía. Puntaje de la comunidad: 9,0/10. Dónde leerlo, su anime y qué leer después."
export function descripcion(o, f){
    const nombres = (f && Array.isArray(f.autores) ? f.autores : []).map(a => a && a.nombre).filter(Boolean);
    const de = nombres.length ? ` de ${nombres.length > 2 ? `${nombres[0]}, ${nombres[1]} y otros` : enumerar(nombres)}` : '';
    const inicio = String(o.inicio || '').slice(0, 4);
    const fin = String((f && f.fin) || '').slice(0, 4);
    const cuando = {
        'en-publicacion': inicio ? `, en publicación desde ${inicio}` : ', en publicación',
        'terminado': inicio ? (fin && fin !== inicio ? ` (${inicio}-${fin})` : ` (${inicio})`) : '',
        'cancelado': inicio ? ` (${inicio}), cancelado` : ', cancelado',
        'pausado': inicio ? ` (${inicio}), en pausa` : ', en pausa',
        'proximamente': ', por estrenar'
    }[o.estado] ?? (inicio ? ` (${inicio})` : '');
    const frases = [`${TIPOS[o.tipo]}${de}${cuando}.`];
    const generos = o.generos.map(g => GENEROS[g]).filter(Boolean).slice(0, 4);
    if (generos.length) frases.push(enumerar(generos.map((g, i) => i ? g.toLowerCase() : g)) + '.');
    const p = puntaje(o);
    if (p != null) frases.push(`Puntaje de la comunidad: ${textoPuntaje(p)}/10.`);
    const hay = [];
    if (f && Array.isArray(f.enlaces) && f.enlaces.length) hay.push('dónde leerlo');
    if (f && f.anime && Array.isArray(f.anime.obras) && f.anime.obras.length) hay.push('su anime');
    if (f && f.lectura && Array.isArray(f.lectura.orden) && f.lectura.orden.length >= 2) hay.push('el orden de lectura');
    if (f && f.comunidad && Array.isArray(f.comunidad.recomendaciones) && f.comunidad.recomendaciones.length) hay.push('qué leer después');
    if (hay.length){
        const texto = enumerar(hay);
        frases.push(texto[0].toUpperCase() + texto.slice(1) + '.');
    }
    return frases.join(' ');
}

// Datos para Google (schema.org): qué obra es, de quién, desde cuándo y dónde más está
export function datosEstructurados(o, f, texto){
    const t = o.titulos || {};
    const otros = [...new Set([t.romaji, t.ingles, t.nativo].filter(x => x && x.toLowerCase() !== o.titulo.toLowerCase()))];
    const autores = (f && Array.isArray(f.autores) ? f.autores : []).filter(a => a && a.nombre);
    const ids = o.ids || {};
    const mismos = [
        Number.isInteger(ids.anilist) ? `https://anilist.co/manga/${ids.anilist}` : null,
        Number.isInteger(ids.mal) ? `https://myanimelist.net/manga/${ids.mal}` : null
    ].filter(Boolean);
    const datos = {
        '@context': 'https://schema.org',
        '@type': 'ComicSeries',
        name: o.titulo,
        alternateName: otros.length ? otros : null,
        url: urlObra(o.id),
        image: portadaGrande(o),
        description: texto,
        genre: o.generos.map(g => GENEROS[g]).filter(Boolean),
        author: autores.map(a => ({ '@type': 'Person', name: a.nombre })),
        startDate: o.inicio || null,
        endDate: (f && f.fin) || null,
        inLanguage: IDIOMA_ORIGINAL[o.tipo],
        sameAs: mismos
    };
    const limpio = Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== null && !(Array.isArray(v) && !v.length)));
    // "<" escapado: el texto nunca puede cerrar la etiqueta <script>
    return JSON.stringify(limpio).replace(/</g, '\\u003c');
}

// ---------- Partes de la ficha (como en catalogo.js) ----------
function otrosTitulos(o){
    const igual = (a, b) => a.toLowerCase() === b.toLowerCase();
    const romaji = o.titulos && o.titulos.romaji;
    const nativo = o.titulos && o.titulos.nativo;
    const partes = [];
    if (romaji && !igual(romaji, o.titulo)) partes.push(html`${romaji}`);
    if (nativo && !igual(nativo, o.titulo) && !(romaji && igual(nativo, romaji))) partes.push(html`<span lang="${IDIOMA_ORIGINAL[o.tipo]}">${nativo}</span>`);
    return partes.length ? html`<p class="otros-titulos">${partes.map((p, i) => i ? html` / ${p}` : p)}</p>` : '';
}

// "Tatsuki Fujimoto", o con lo que hizo cada uno si son varios ("Chugong (historia original) y DUBU (arte)")
function textoAutores(autores){
    const solo = autores.length === 1 && autores[0].rol === 'historia y arte';
    return autores.map((a, i) => {
        const separador = i ? (i === autores.length - 1 ? ' y ' : ', ') : '';
        const nombre = a.nativo ? html`<span class="autor" title="${a.nativo}">${a.nombre}</span>` : html`<span class="autor">${a.nombre}</span>`;
        return html`${separador}${nombre}${!solo && a.rol ? html` <span class="autor-rol">(${a.rol})</span>` : ''}`;
    });
}

function datosDeLaObra(o, f, contexto){
    const filas = [];
    const fila = (termino, valor) => { if (valor !== null && valor !== undefined && valor !== '') filas.push(html`<dt>${termino}</dt><dd>${valor}</dd>`); };
    const autores = (f && Array.isArray(f.autores) ? f.autores : []).filter(a => a && a.nombre);
    if (autores.length) fila('Creado por', textoAutores(autores));
    fila('Salió', textoFecha(o.inicio));
    if (f && f.fin) fila('Terminó', textoFecha(f.fin));
    // Capítulos y tomos: los de AniList si ya terminó; si sigue saliendo, los publicados hasta ahora
    const c = (f && f.comunidad) || {};
    const publicados = c.publicados || {};
    const hastaAhora = o.estado === 'terminado' ? '' : ' hasta ahora';
    if (f){
        if (f.capitulos) fila('Capítulos', formatoNumero.format(f.capitulos));
        else if (publicados.ultimo) fila('Capítulos', formatoNumero.format(publicados.ultimo) + hastaAhora);
        if (f.tomos) fila('Tomos', formatoNumero.format(f.tomos));
        else if (publicados.tomos) fila('Tomos', formatoNumero.format(publicados.tomos) + hastaAhora);
    }
    fila('Géneros', o.generos.map(g => GENEROS[g]).filter(Boolean).join(', '));
    // Etiquetas votadas por los lectores: cada una lleva al catálogo filtrado por ella
    const etiquetas = (Array.isArray(c.etiquetas) ? c.etiquetas
        : (op(o).etiquetas || []).map(id => ({ id, ...(contexto.etiquetas.get(id) || { nombre: id }) })))
        .filter(e => e && e.id && e.nombre).slice(0, 8);
    if (etiquetas.length){
        fila('Etiquetas', html`<ul class="etiquetas-votadas">${etiquetas.map(e => html`<li><a href="/#catalogo?etiqueta=${encodeURIComponent(e.id)}">${e.en ? html`<span lang="en">${e.nombre}</span>` : html`<span>${e.nombre}</span>`}${Number.isFinite(e.voto) ? html`<span class="voto">${e.voto} %</span>` : ''}</a></li>`)}</ul>`);
    }
    return html`<dl>${filas}</dl>`;
}

/* Sellos (como en catalogo.js):
   - «Aclamada en las 4 comunidades»: AniList, MyAnimeList, Kitsu y MangaUpdates le ponen 8,3 o más
     (cada una con al menos 50 votos).
   - «Joya poco conocida»: puntaje combinado de 8,2 o más, con confianza media o alta, y entre el
     tercio menos leído del catálogo (por lectores de AniList). */
export function sellosDe(o, c, contexto){
    const sellos = [];
    const fuentes = c && c.fuentes;
    if (fuentes && COMUNIDADES.every(k => fuentes[k] && fuentes[k].puntaje >= 83 && fuentes[k].votos >= 50)){
        sellos.push({ clave: 'aclamada', icono: ICONO_ESTRELLA, texto: 'Aclamada en las 4 comunidades',
            ayuda: 'AniList, MyAnimeList, Kitsu y MangaUpdates le ponen 8,3 o más.' });
    }
    const p = puntaje(o);
    const confianza = op(o).confianza;
    if (p != null && p >= 82 && confianza && confianza !== 'baja' && contexto.puesto.get(o.id) > contexto.total * 2 / 3){
        sellos.push({ clave: 'joya', icono: ICONO_JOYA, texto: 'Joya poco conocida',
            ayuda: 'Muy bien valorada (8,2 o más) y entre el tercio menos leído del catálogo.' });
    }
    return sellos;
}

function opinion(o, f, contexto){
    const c = (f && f.comunidad) || null;
    const p = puntaje(o);
    const partes = [];

    // Puntaje: combinado de varias comunidades si ya está calculado; si no, el de AniList
    const deDonde = Array.isArray(op(o).fuentes) ? op(o).fuentes.map(x => NOMBRES_FUENTES[x]).filter(Boolean) : [];
    const explicacion = deDonde.length
        ? html`Combinado de ${enumerar(deDonde)}.${op(o).confianza ? html`<br>Confianza ${op(o).confianza}.` : ''}`
        : (p == null ? 'Todavía no tiene puntaje.' : 'Promedio de los lectores de AniList.');
    partes.push(html`<div class="comunidad">${p != null ? html`<span class="puntaje">${textoPuntaje(p)}<small>/10</small></span>` : ''}<p>${explicacion}</p></div>`);

    const sellos = sellosDe(o, c, contexto);
    if (sellos.length){
        partes.push(html`<ul class="sellos">${sellos.map(s => html`<li class="sello sello-${s.clave}" title="${s.ayuda}">${crudo(s.icono)}<span>${s.texto}</span><span class="solo-lectores">: ${s.ayuda}</span></li>`)}</ul>`);
    }

    // Resumen de lo que dicen las reseñas, escrito por IA (Gemma 4) en la tarea de GitHub
    if (c && c.resumen && c.resumen.texto){
        partes.push(html`<p class="resumen-ia">${c.resumen.texto}</p>`,
            html`<p class="nota-ia">Resumen hecho con IA (${c.resumen.modelo || 'Gemma 4'}, de Google) a partir de ${c.resumen.resenas} reseñas de AniList. Puede equivocarse.</p>`);
    }

    if (c){
        // Reparto de votos: cuántos le pusieron cada nota, del 1 al 10
        const d = c.distribucion;
        if (d && Array.isArray(d.barras) && d.barras.length){
            const barras = d.barras.map(b => Number.isFinite(b) ? b : 0);
            const maximo = Math.max(...barras, 1);
            const etiqueta = 'Votos en AniList, del 1 al 10: ' + barras.map((b, i) => `${i + 1}: ${formatoPorcentaje.format(b / 100)}`).join(', ');
            partes.push(html`<div class="reparto" role="img" aria-label="${etiqueta}">${barras.map((b, i) => html`<span class="${i >= 6 ? 'barra gusta' : 'barra'}" style="height:${Math.max(2, Math.round(100 * b / maximo))}%"></span>`)}</div>`,
                html`<div class="reparto-ejes" aria-hidden="true"><span>1</span><span>10</span></div>`);
            if (Number.isFinite(d.gusta)) partes.push(html`<p class="dato-opinion">${fraseReparto(d)}</p>`);
        }

        // Reseñas: cuántas son positivas y qué temas se elogian o critican
        const r = c.resenas || { n: 0 };
        if (!r.n){
            partes.push(html`<p class="dato-opinion">Todavía no tiene reseñas en AniList.</p>`);
        } else {
            const tipos = [[r.positivas, 'positiva', 'positivas'], [r.negativas, 'negativa', 'negativas'], [r.mixtas, 'mixta', 'mixtas']]
                .filter(([x]) => x > 0).map(([x, una, varias]) => `${x} ${x === 1 ? una : varias}`);
            partes.push(html`<p class="dato-opinion">${r.n === 1 ? 'Una reseña' : r.n + ' reseñas'} en AniList: ${enumerar(tipos)}.</p>`);
            if (Array.isArray(r.elogian) && r.elogian.length) partes.push(html`<p class="dato-opinion">Lo más elogiado: ${enumerar(r.elogian.map(t => NOMBRES_TEMAS[t] || t))}.</p>`);
            if (Array.isArray(r.critican) && r.critican.length) partes.push(html`<p class="dato-opinion">Lo más criticado: ${enumerar(r.critican.map(t => NOMBRES_TEMAS[t] || t))}.</p>`);
        }

        // Puntaje en cada comunidad (de la última vez que se renovó la obra)
        const fuentes = Object.entries(c.fuentes || {}).filter(([, x]) => x && Number.isFinite(x.puntaje));
        if (fuentes.length){
            partes.push(html`<ul class="por-fuente">${fuentes.map(([fuente, x]) => html`<li><span>${NOMBRES_FUENTES[fuente] || fuente}</span><strong>${textoPuntaje(x.puntaje)}</strong>${Number.isFinite(x.votos) ? html`<span class="votos">${formatoLectores.format(x.votos)} votos</span>` : ''}</li>`)}</ul>`);
        }

        // La fecha en que se renovó esta obra por completo
        if (c.revisada) partes.push(html`<p class="opinion-fecha">Actualizado el ${textoFecha(String(c.revisada).slice(0, 10))}. <a href="/#sobre">Cómo se calcula</a></p>`);
    }
    return html`<h2>Lo que opina la comunidad</h2><div class="opinion">${partes}</div>`;
}

// Dónde leer: solo lugares oficiales, agrupados por idioma
function dondeLeer(f){
    const enlaces = (f && Array.isArray(f.enlaces) ? f.enlaces : [])
        .filter(e => e && e.sitio && esWeb(e.url)).map(e => ({ ...e, tipo: e.tipo || 'leer' }));
    // El idioma original solo se muestra si no hay dónde leerla en español o en inglés
    const hayTraduccion = enlaces.some(e => e.tipo === 'leer');
    const grupos = GRUPOS_LECTURA.map(g => ({ ...g, enlaces: enlaces.filter(g.cumple) }))
        .filter(g => g.enlaces.length && !(hayTraduccion && g.titulo === 'En su idioma original'));
    const partes = [];
    if (grupos.length && grupos.every(g => g.titulo === 'En su idioma original')){
        partes.push(html`<p class="sin-enlaces">No encontramos una edición oficial en español ni en inglés.</p>`);
    }
    if (grupos.length){
        partes.push(grupos.map(g => html`<div class="grupo-lectura"><h3>${g.titulo}</h3><ul class="donde-leer">${g.enlaces.map(e =>
            html`<li><a href="${e.url}"${afuera}>${e.sitio}${g.conIdioma && IDIOMAS[e.idioma] ? html`<span class="idioma">(${IDIOMAS[e.idioma]})</span>` : ''}</a></li>`)}</ul></div>`));
    } else {
        partes.push(html`<p class="sin-enlaces">No encontramos dónde leerla oficialmente.</p>`);
    }
    return html`<h2>Dónde leer</h2><div>${partes}</div>`;
}

// Anime: sus adaptaciones (cada una lleva a su página de AniList) y dónde verlas
function anime(o, f){
    const a = (f && f.anime) || null;
    const animes = a && Array.isArray(a.obras) ? a.obras.filter(x => x && x.titulo && Number.isInteger(x.anilist)) : [];
    if (!animes.length) return '';
    const partes = [html`<h2>Anime</h2>`, html`<ul class="lista-anime">${animes.map(x => {
        const datos = [x.formato, x.anio, x.episodios && `${formatoNumero.format(x.episodios)} episodios`, x.estado].filter(Boolean);
        return html`<li>${enlaceAfuera(x.titulo, `https://anilist.co/anime/${x.anilist}`)}${datos.length ? html` <span class="anime-datos">${datos.join(' · ')}</span>` : ''}</li>`;
    })}</ul>`];
    if (a.mas > 0 && Number.isInteger(o.ids.anilist)) partes.push(html`<p class="nota-ficha">${enlaceAfuera(`y ${a.mas} más en AniList`, `https://anilist.co/manga/${o.ids.anilist}`)}</p>`);
    // Dónde verlo: solo si ya se estrenó alguna (las que están por estrenar no tienen dónde)
    const ver = Array.isArray(a.ver) ? a.ver.filter(s => s && s.sitio && esHttps(s.url)) : [];
    const otros = Array.isArray(a.otros) ? a.otros.filter(Boolean) : [];
    if (ver.length || otros.length || animes.some(x => x.estado !== 'por estrenar')){
        let contenido;
        if (ver.length){
            contenido = html`<ul class="donde-leer">${ver.map(s => html`<li>${enlaceAfuera(s.sitio, s.url)}</li>`)}</ul><p class="nota-ficha">Según AniList. Lo que tiene cada servicio cambia según el país.</p>`;
        } else if (otros.length){
            contenido = html`<p class="sin-enlaces">No lo encontramos en servicios que lleguen a Latinoamérica o España. AniList lo ubica en ${enumerar(otros)}.</p>`;
        } else {
            contenido = html`<p class="sin-enlaces">No encontramos dónde verlo oficialmente.</p>`;
        }
        partes.push(html`<div class="grupo-lectura"><h3>Dónde verlo</h3>${contenido}</div>`);
    }
    return html`${partes}`;
}

// Una obra en miniatura: las del catálogo llevan a su página; las demás, a AniList
function mini({ titulo, href, afueraDelCatalogo = false, portada, color, datos, aqui = false, paso = 0 }){
    const imagen = esWeb(portada) ? html`<img src="${portada}" alt="" width="230" height="345" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '';
    const contenido = html`<span class="mini-portada"${placa(color)}>${imagen}${paso ? html`<span class="paso">${paso}</span>` : ''}</span><span class="mini-texto"><span class="mini-titulo">${titulo}</span><span class="mini-datos">${datos}</span></span>`;
    if (aqui) return html`<li><div class="mini-obra aqui">${contenido}</div></li>`;
    return html`<li><a class="mini-obra" href="${href}"${afueraDelCatalogo ? afuera : ''}>${contenido}</a></li>`;
}

function miniRelacionada(n, contexto, { aqui = false, paso = 0, relacion = '' } = {}){
    const propia = contexto.porAniList.get(n.anilist);
    const anio = propia ? String(propia.inicio || '').slice(0, 4) : (n.anio ? String(n.anio) : '');
    const datos = [
        etiquetaTipo(propia ? propia.tipo : (TIPOS[n.tipo] ? n.tipo : 'manga')),
        anio ? span(null, anio) : '',
        n.formato === 'one-shot' ? span(null, 'one-shot') : '',
        relacion ? span(null, relacion) : '',
        aqui ? span('aqui-texto', 'Estás aquí') : (!propia ? span('fuera', 'en AniList') : '')
    ];
    return propia
        ? mini({ titulo: propia.titulo, href: direccionObra(propia.id), portada: propia.portada, color: propia.color, datos, aqui, paso })
        : mini({ titulo: n.titulo, href: `https://anilist.co/manga/${n.anilist}`, afueraDelCatalogo: true, portada: n.portada, datos, paso });
}

// Orden de lectura (precuelas y secuelas en orden) e historias relacionadas
function lectura(o, f, contexto){
    const l = (f && f.lectura) || null;
    const valida = n => n && Number.isInteger(n.anilist) && (contexto.porAniList.has(n.anilist) || n.titulo);
    const orden = l && Array.isArray(l.orden) ? l.orden.filter(valida) : [];
    const relacionadas = l && Array.isArray(l.relacionadas) ? l.relacionadas.filter(valida) : [];
    const partes = [];
    if (orden.length >= 2 && orden.some(n => n.anilist === o.ids.anilist)){
        partes.push(html`<h2>Orden de lectura</h2><ol class="recomendadas orden-lectura" role="list">${orden.map((n, i) => miniRelacionada(n, contexto, { aqui: n.anilist === o.ids.anilist, paso: i + 1 }))}</ol>`);
    }
    if (relacionadas.length){
        partes.push(html`<h2>Historias relacionadas</h2><ul class="recomendadas">${relacionadas.map(n => miniRelacionada(n, contexto, { relacion: n.relacion }))}</ul>`);
        if (l.masRelacionadas > 0 && Number.isInteger(o.ids.anilist)) partes.push(html`<p class="nota-ficha">${enlaceAfuera(`y ${l.masRelacionadas} más en AniList`, `https://anilist.co/manga/${o.ids.anilist}`)}</p>`);
    }
    return html`${partes}`;
}

// «Más de …»: otras obras del catálogo de las mismas personas
function masDelAutor(o, f, contexto){
    const grupos = f && Array.isArray(f.masDelAutor) ? f.masDelAutor : [];
    const partes = [];
    for (const g of grupos){
        const otras = (Array.isArray(g.obras) ? g.obras : []).map(id => contexto.porId.get(id)).filter(x => x && x.id !== o.id);
        const autores = (Array.isArray(g.autores) ? g.autores : []).filter(Boolean);
        if (!otras.length || !autores.length) continue;
        partes.push(html`<h2>Más de ${enumerar(autores)}</h2><ul class="recomendadas">${otras.map(x => mini({
            titulo: x.titulo, href: direccionObra(x.id), portada: x.portada, color: x.color,
            datos: [etiquetaTipo(x.tipo), x.inicio ? span(null, String(x.inicio).slice(0, 4)) : '']
        }))}</ul>`);
    }
    return html`${partes}`;
}

// Si te gustó, los lectores recomiendan (las del catálogo llevan a su página; las demás, a AniList)
function recomendadas(f, contexto){
    const recs = (f && f.comunidad && Array.isArray(f.comunidad.recomendaciones) ? f.comunidad.recomendaciones : [])
        .filter(r => r && Number.isInteger(r.anilist) && (contexto.porAniList.has(r.anilist) || r.titulo));
    if (!recs.length) return '';
    return html`<h2>Si te gustó, los lectores recomiendan</h2><ul class="recomendadas">${recs.map(r => {
        const propia = contexto.porAniList.get(r.anilist);
        const votos = span(null, `${formatoLectores.format(r.votos || 0)} votos`);
        return propia
            ? mini({ titulo: propia.titulo, href: direccionObra(propia.id), portada: propia.portada, color: propia.color, datos: [etiquetaTipo(propia.tipo), votos] })
            : mini({ titulo: r.titulo, href: `https://anilist.co/manga/${r.anilist}`, afueraDelCatalogo: true, portada: r.portada,
                datos: [etiquetaTipo(TIPOS[r.tipo] ? r.tipo : 'manga'), votos, span('fuera', 'en AniList')] });
    })}</ul>`;
}

// ---------- La página entera ----------
export function armarPagina(o, f, contexto){
    const url = urlObra(o.id);
    const texto = descripcion(o, f);
    const grande = portadaGrande(o);
    const tipo = TIPOS[o.tipo];
    const estado = ESTADOS[o.estado];
    const fondo = esColor(o.color) ? html` style="--color-obra:${o.color}38"` : '';
    const anilist = Number.isInteger(o.ids && o.ids.anilist) ? o.ids.anilist : null;
    // (al final se quitan las líneas que quedan vacías cuando una parte no aplica a esta obra)
    return `<!DOCTYPE html>
<html lang="es">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <!-- Página de una obra: la arma scripts/paginas.mjs (no la edites a mano, se reescribe sola) -->
    <script>
        // En una dirección vieja de la página, pasa a la oficial
        if (['sorryfriend49.github.io', 'frozen-project-vert-mu.vercel.app'].indexOf(location.hostname) !== -1) {
            location.replace('${OFICIAL}' + location.pathname);
        }
    </script>
    ${html`<title>${o.titulo} (${tipo.toLowerCase()}): opiniones y dónde leer | Frozen Project</title>`}
    ${html`<meta name="description" content="${texto}">`}
    ${html`<link rel="canonical" href="${url}">`}
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <meta name="theme-color" content="#030a13">

    <!-- VISTA PREVIA AL COMPARTIR (WhatsApp, Discord, Telegram, Facebook, X): su portada y su título -->
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Frozen Project">
    ${html`<meta property="og:title" content="${o.titulo}">`}
    ${html`<meta property="og:description" content="${texto}">`}
    ${html`<meta property="og:url" content="${url}">`}
    <meta property="og:locale" content="es_CO">
    ${html`<meta property="og:image" content="${grande}">`}
    ${html`<meta property="og:image:alt" content="Portada de ${o.titulo}">`}
    <meta name="twitter:card" content="summary_large_image">
    <script type="application/ld+json">${datosEstructurados(o, f, texto)}</script>

    <link rel="preconnect" href="https://s4.anilist.co">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Poppins:wght@400;500;600&display=swap">
    ${html`<link rel="stylesheet" href="/${contexto.estilos}">`}
    <script src="/obra.js?v=1" defer></script>
</head>

<body class="pagina-obra">
    ${html`<div class="fondo-obra" aria-hidden="true"${fondo}></div>`}

    <header>
        <p class="titulo-sitio"><a href="/" class="titulo-link">Frozen Project</a></p>
    </header>

    <nav aria-label="Principal">
        <ul class="nav-menu">
            <li><a class="nav-link" href="/#inicio">Inicio</a></li>
            <li><a class="nav-link" href="/#catalogo">Catálogo</a></li>
            <li><a class="nav-link" href="/#biblioteca">Mi biblioteca</a></li>
            <li><a class="nav-link" href="/#sobre">Sobre el sitio</a></li>
        </ul>
    </nav>

    <main>
        <article class="ficha-pagina" aria-labelledby="tituloObra">
            <div class="ficha-cuerpo">
                ${html`<div class="ficha-portada"${placa(o.color)}><img src="${o.portada}" srcset="${o.portada} 230w, ${grande} 460w" sizes="(max-width: 768px) 104px, 210px" alt="Portada de ${o.titulo}" width="230" height="345" fetchpriority="high" decoding="async" referrerpolicy="no-referrer"></div>`}
                <div class="ficha-cabecera">
                    ${html`<h1 id="tituloObra">${o.titulo}</h1>`}
                    ${otrosTitulos(o)}
                    ${html`<div class="etiquetas">${etiquetaTipo(o.tipo)}${estado ? span('etiqueta-estado', estado) : ''}</div>`}
                </div>
                <!-- Guardar abre su ficha en el catálogo. Compartir: en el celular abre su menú; en el PC copia el enlace (obra.js) -->
                <div class="ficha-acciones">
                    ${html`<a class="boton-principal" href="${fichaEnCatalogo(o.id)}">Guardar en mi biblioteca</a>`}
                    <button class="chip" id="compartir" type="button" hidden>${ICONO_COMPARTIR} Compartir</button>
                    <span class="aviso-compartir" id="avisoCompartir" role="status" aria-live="polite"></span>
                </div>
                <div class="ficha-detalles">
                    ${datosDeLaObra(o, f, contexto)}
                    ${opinion(o, f, contexto)}
                    ${dondeLeer(f)}
                    ${anime(o, f)}
                    ${lectura(o, f, contexto)}
                    ${masDelAutor(o, f, contexto)}
                    ${recomendadas(f, contexto)}
                    ${anilist ? html`<p class="ficha-fuente">Datos y portada de <a href="https://anilist.co/manga/${anilist}"${afuera}>esta obra en AniList</a>.</p>` : ''}
                </div>
            </div>
        </article>
    </main>
</body>

</html>
`.replace(/\n[ \t]+(?=\n)/g, '');
}

// ---------- Mapa del sitio ----------
export function leerMapa(texto){
    const fechas = new Map();
    for (const m of String(texto || '').matchAll(/<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]+)<\/lastmod>)?/g)) fechas.set(m[1].trim(), (m[2] || '').trim());
    return fechas;
}

export function armarMapa(entradas){
    const lineas = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
    for (const { loc, lastmod } of entradas){
        lineas.push('  <url>', `    <loc>${escapar(loc)}</loc>`);
        if (lastmod) lineas.push(`    <lastmod>${lastmod}</lastmod>`);
        lineas.push('  </url>');
    }
    return lineas.concat('</urlset>', '').join('\n');
}

// ---------- Leer los datos y escribir todo ----------
const leer = async (ruta, siNoExiste) => {
    try { return JSON.parse(await readFile(ruta, 'utf8')); }
    catch (error){ if (error.code === 'ENOENT') return siNoExiste; throw error; }
};
const leerTexto = async (ruta, siNoExiste = '') => {
    try { return await readFile(ruta, 'utf8'); }
    catch (error){ if (error.code === 'ENOENT') return siNoExiste; throw error; }
};

// Las obras de la lista como las usa la página: con la portada completa y solo las válidas
export function obrasDeLaLista(lista){
    const prefijo = typeof (lista && lista.portadas) === 'string' ? lista.portadas : '';
    return ((lista && lista.obras) || [])
        .map(o => (o && typeof o.portada === 'string' && !/^https?:\/\//.test(o.portada)) ? { ...o, portada: prefijo + o.portada } : o)
        .filter(o => o && o.id && o.titulo && esWeb(o.portada) && TIPOS[o.tipo] && Array.isArray(o.generos) && ID_VALIDO.test(o.id) && o.ids);
}

export function armarContexto(lista, obras, estilos = 'styles.css'){
    const lectores = o => op(o).lectores || 0;
    return {
        porId: new Map(obras.map(o => [o.id, o])),
        porAniList: new Map(obras.filter(o => o.ids && Number.isInteger(o.ids.anilist)).map(o => [o.ids.anilist, o])),
        etiquetas: new Map(Object.entries((lista && lista.etiquetas) || {}).map(([id, e]) => [id, { nombre: (e && e.nombre) || id, en: Boolean(e && e.en) }])),
        puesto: new Map([...obras].sort((a, b) => lectores(b) - lectores(a)).map((o, i) => [o.id, i + 1])),
        total: obras.length,
        estilos
    };
}

export async function escribirPaginas({ raiz, hoy = new Date().toISOString().slice(0, 10), registro = console.log } = {}){
    const ruta = nombre => join(raiz, nombre);
    const lista = await leer(ruta('datos/lista.json'), null);
    if (!lista) throw new Error('Falta datos/lista.json (corre antes scripts/lista.mjs)');
    const obras = obrasDeLaLista(lista);
    // La misma versión de los estilos que usa index.html, para que el navegador no use una vieja
    const indice = await leerTexto(ruta('index.html'));
    const version = (indice.match(/styles\.css\?v=(\d+)/) || [])[1];
    const contexto = armarContexto(lista, obras, version ? `styles.css?v=${version}` : 'styles.css');

    const antes = leerMapa(await leerTexto(ruta('sitemap.xml')));
    const fechas = new Map();
    let escritas = 0, iguales = 0, borradas = 0;
    await mkdir(ruta(CARPETA_PAGINAS), { recursive: true });
    for (const o of obras){
        const ficha = await leer(ruta(`${CARPETA_FICHAS}/${o.id}.json`), null).catch(() => null);
        const pagina = armarPagina(o, ficha, contexto);
        const archivo = ruta(`${CARPETA_PAGINAS}/${o.id}/index.html`);
        if (await leerTexto(archivo, null) === pagina){
            iguales++;
            fechas.set(o.id, antes.get(urlObra(o.id)) || hoy);
            continue;
        }
        await mkdir(ruta(`${CARPETA_PAGINAS}/${o.id}`), { recursive: true });
        await writeFile(archivo, pagina);
        fechas.set(o.id, hoy);
        escritas++;
    }
    // Las páginas de obras que ya no están en el catálogo se borran (solo carpetas de obras)
    for (const entrada of await readdir(ruta(CARPETA_PAGINAS), { withFileTypes: true })){
        if (!entrada.isDirectory() || !ID_VALIDO.test(entrada.name) || contexto.porId.has(entrada.name)) continue;
        await rm(ruta(`${CARPETA_PAGINAS}/${entrada.name}`), { recursive: true, force: true });
        borradas++;
    }

    // Mapa del sitio: la principal cambia con los datos; las legales conservan su fecha
    const fijas = FIJAS.map(camino => {
        const loc = OFICIAL + camino;
        let lastmod = antes.get(loc) || hoy;
        if (camino === '/' && lista.actualizado && lista.actualizado > lastmod) lastmod = lista.actualizado;
        return { loc, lastmod };
    });
    const mapa = armarMapa([...fijas, ...obras.map(o => ({ loc: urlObra(o.id), lastmod: fechas.get(o.id) }))]);
    if (await leerTexto(ruta('sitemap.xml')) !== mapa) await writeFile(ruta('sitemap.xml'), mapa);

    registro(`Páginas de obras: ${obras.length} (${escritas} escritas, ${iguales} sin cambios${borradas ? `, ${borradas} borradas` : ''}). Mapa del sitio: ${fijas.length + obras.length} direcciones.`);
    return { obras: obras.length, escritas, iguales, borradas };
}

// node scripts/paginas.mjs
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href){
    const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
    escribirPaginas({ raiz }).catch(error => {
        console.error('Error:', error.message);
        process.exit(1);
    });
}
