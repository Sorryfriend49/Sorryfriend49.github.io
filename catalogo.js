/* ===================================
   FROZEN PROJECT: catálogo de obras
   Lee datos/lista.json (la lista liviana del catálogo, ver scripts/lista.mjs), arma los
   filtros por tipo y género, ordena por popularidad, puntaje o fecha de salida, y abre la
   ficha de cada obra: lo que no viene en la lista (dónde leer, la opinión completa, el
   resumen y las recomendaciones) se baja al abrirla, de datos/fichas/<id>.json. Los filtros viven en la dirección de la página, por ejemplo
   #catalogo?q=frieren&tipo=manga&generos=accion,fantasia&orden=fecha-desc
   así un enlace compartido abre el catálogo tal como lo dejaste. El buscador (q)
   encuentra cada obra por cualquiera de sus nombres: en español, inglés, romaji,
   su idioma original o sus otros títulos, sin importar tildes ni mayúsculas.
   También pinta "Mi biblioteca" (#biblioteca?ver=leyendo) y los botones de la
   ficha para guardar cada obra con su etiqueta; los datos los guarda biblioteca.js.
=================================== */
(() => {
    const GENEROS = {
        'accion': 'Acción', 'aventura': 'Aventura', 'ciencia-ficcion': 'Ciencia ficción',
        'comedia': 'Comedia', 'chicas-magicas': 'Chicas mágicas', 'deportes': 'Deportes',
        'drama': 'Drama', 'fantasia': 'Fantasía', 'mecha': 'Mecha', 'misterio': 'Misterio',
        'musica': 'Música', 'psicologico': 'Psicológico', 'recuentos-de-la-vida': 'Recuentos de la vida',
        'romance': 'Romance', 'sobrenatural': 'Sobrenatural', 'suspenso': 'Suspenso', 'terror': 'Terror'
    };
    const TIPOS = { manga: 'Manga', manhwa: 'Manhwa', manhua: 'Manhua' };
    const ESTADOS = {
        'terminado': 'Terminada', 'en-publicacion': 'En publicación', 'pausado': 'En pausa',
        'cancelado': 'Cancelada', 'proximamente': 'Por estrenar'
    };
    const IDIOMAS = { es: 'español', en: 'inglés', ja: 'japonés', ko: 'coreano', zh: 'chino' };
    // Filtro «estado de la obra» del catálogo (?estado=…)
    const PUBLICACION = { 'en-publicacion': 'En publicación', 'terminado': 'Terminadas' };
    // Filtro «Salió» (?anio=…): desde ese año, o antes de 2000
    const ANIOS = { '': 'Cualquier año', '2024': 'Desde 2024', '2020': 'Desde 2020', '2015': 'Desde 2015', '2010': 'Desde 2010', '2000': 'Desde 2000', 'antes-2000': 'Antes de 2000' };
    // Dónde leer, por grupos: primero en español, luego en inglés, los tomos y al final el idioma original
    const GRUPOS_LECTURA = [
        { titulo: 'En español', cumple: e => e.tipo === 'leer' && e.idioma === 'es', conIdioma: false },
        { titulo: 'En inglés', cumple: e => e.tipo === 'leer' && e.idioma === 'en', conIdioma: false },
        { titulo: 'Tomos impresos y digitales', cumple: e => e.tipo === 'tomos', conIdioma: true },
        { titulo: 'En su idioma original', cumple: e => e.tipo === 'original', conIdioma: true }
    ];
    const IDIOMA_ORIGINAL = { manga: 'ja', manhwa: 'ko', manhua: 'zh' };
    const NOMBRES_FUENTES = { anilist: 'AniList', kitsu: 'Kitsu', mangaupdates: 'MangaUpdates', myanimelist: 'MyAnimeList' };
    const NOMBRES_TEMAS = {
        arte: 'el arte', historia: 'la historia', personajes: 'los personajes', ritmo: 'el ritmo', final: 'el final',
        accion: 'la acción', mundo: 'el mundo y su sistema', romance: 'el romance', humor: 'el humor', emocion: 'lo emotivo'
    };
    // Frase bajo el reparto de votos: cuántos la recomiendan y si las notas coinciden o chocan
    const fraseReparto = d => {
        const base = `Al ${Math.round(d.gusta * 100)} % le gusta (le pone 7/10 o más)`;
        const noGusta = Math.round((d.noGusta || 0) * 100);
        if (d.division === 'divididas' && noGusta >= 6) return `${base}, pero un ${noGusta} % le pone 4 o menos: hay opiniones muy opuestas.`;
        if (d.division === 'divididas') return `${base}. Las notas están muy repartidas.`;
        if (d.division === 'variadas') return `${base}. Las opiniones varían un poco.`;
        return `${base}. La mayoría coincide.`;
    };
    const enumerar = lista => lista.length <= 1 ? (lista[0] || '') : lista.slice(0, -1).join(', ') + ' y ' + lista[lista.length - 1];
    const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

    // Opinión de la comunidad (la arma de lunes a viernes la tarea de GitHub, scripts/comunidad.mjs).
    // En corto viene en la lista, en o.op: puntaje combinado, votos, confianza, lectores, actividad,
    // tendencia y etiquetas. Lo demás llega con la ficha de cada obra.
    let comunidad = null;          // cuándo se generó, de qué comunidades y qué tanto acierta el tono
    const op = o => o.op || {};
    // Números del día (datos/populares.json, dos veces al día): lectores, actividad de la semana,
    // cuántos la leen y cuánto cambiaron sus lectores. Mandan sobre los de la opinión de la comunidad,
    // que de cada obra se renueva por partes (de lunes a viernes).
    let diario = new Map();
    const delDia = o => diario.get(o.id) || null;
    const popularidad = o => {
        const d = delDia(o);
        if (d && d.lectores > 0) return d.lectores;
        return op(o).lectores || 0;
    };
    const puntaje = o => Number.isFinite(op(o).puntaje) ? op(o).puntaje : null;
    const claveFecha = o => o.inicio ? (o.inicio + '-00-00').slice(0, 10) : '0000-00-00';
    // Actividad de la semana en AniList (gente que la agrega o avanza capítulos) y cuántos la leen ahora
    const actividad = o => {
        const base = { semana: op(o).semana || 0, leyendo: op(o).leyendo || null };
        const d = delDia(o);
        return d ? { ...base, semana: d.semana || 0, leyendo: d.leyendo || base.leyendo || null } : base;
    };
    // Cuánto cambiaron sus lectores en una semana (0.01 = +1 %)
    const tendenciaDe = o => {
        const d = delDia(o);
        if (d && Number.isFinite(d.cambio)) return { lectores: d.cambio, dias: Number.isFinite(d.dias) ? d.dias : 7 };
        const t = op(o).tendencia;
        return Array.isArray(t) && Number.isFinite(t[0]) ? { lectores: t[0], dias: t[1] || 7 } : null;
    };
    // Si la tarea diaria lleva más de un día y medio sin correr (y la de la comunidad sí corrió), no se usa
    function leerDiario(datos, datosComunidad){
        const d = datos && datos.diario;
        if (!d || !Array.isArray(d.campos) || !d.obras) return new Map();
        const fecha = x => Date.parse(x) || 0;
        if (datosComunidad && fecha(datosComunidad.generado) - fecha(datos.actualizado) > 36 * 3600 * 1000) return new Map();
        const col = Object.fromEntries(d.campos.map((c, i) => [c, i]));
        const valor = (fila, campo) => (campo in col && Number.isFinite(fila[col[campo]])) ? fila[col[campo]] : null;
        return new Map(Object.entries(d.obras).filter(([, f]) => Array.isArray(f)).map(([id, f]) => [id, {
            lectores: valor(f, 'lectores'), semana: valor(f, 'semana'), leyendo: valor(f, 'leyendo'),
            cambio: valor(f, 'cambio'), dias: valor(f, 'dias')
        }]));
    }
    // Etiquetas de la obra (sus nombres vienen una sola vez, al principio de la lista)
    const etiquetasDe = o => (op(o).etiquetas || []).map(id => ({ id, ...(etiquetasConocidas.get(id) || { nombre: id }) }));

    const ORDENES = {
        'populares': (a, b) => popularidad(b) - popularidad(a),
        'valorados': (a, b) => (puntaje(b) || 0) - (puntaje(a) || 0) || popularidad(b) - popularidad(a),
        'tendencia': (a, b) => (actividad(b).semana || 0) - (actividad(a).semana || 0) || popularidad(b) - popularidad(a),
        'fecha-desc': (a, b) => claveFecha(b).localeCompare(claveFecha(a)) || popularidad(b) - popularidad(a),
        'fecha-asc': (a, b) => claveFecha(a).localeCompare(claveFecha(b)) || popularidad(b) - popularidad(a)
    };
    const ORDEN_INICIAL = 'populares';

    // ---------- Mi biblioteca ----------
    const Biblioteca = window.FrozenBiblioteca;
    const ETIQUETAS_BIB = { 'leyendo': 'Leyendo', 'por-leer': 'Por leer', 'leido': 'Leído', 'en-pausa': 'En pausa', 'abandonado': 'Abandonado' };
    // Lo que se puede ver en la biblioteca: todas, cada etiqueta o las favoritas
    const VISTAS_BIB = { 'todas': 'Todas', ...ETIQUETAS_BIB, 'favoritos': 'Favorito' };
    const fechaCambio = x => Date.parse(x.e.cambiada) || 0;
    const ORDENES_BIB = {
        'recientes': (a, b) => fechaCambio(b) - fechaCambio(a),
        'titulo': (a, b) => a.o.titulo.localeCompare(b.o.titulo, 'es'),
        'valorados': (a, b) => (puntaje(b.o) || 0) - (puntaje(a.o) || 0)
    };
    const VISTA_BIB_INICIAL = { ver: 'todas', orden: 'recientes' };
    const cumpleVista = (e, ver) => ver === 'todas' || (ver === 'favoritos' ? e.favorito : e.estado === ver);

    const formatoLectores = new Intl.NumberFormat('es', { notation: 'compact' });   // 337640 -> "338 mil"
    const formatoPuntaje = new Intl.NumberFormat('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const formatoNumero = new Intl.NumberFormat('es');   // 1198 -> "1198"; 10500 -> "10.500"

    const $ = id => document.getElementById(id);
    const rejilla = $('rejilla');
    const conteo = $('conteo');
    const filtros = $('filtros');
    const zonaGeneros = $('zonaGeneros');
    const listaOcultar = $('listaOcultar');
    const quitarGeneros = $('quitarGeneros');
    const botonGeneros = $('botonGeneros');
    const cuentaGeneros = $('cuentaGeneros');
    const selectOrden = $('orden');
    const inputBuscar = $('buscar');
    let esperaBusqueda = 0;
    const ficha = $('ficha');
    const enlaceMenuCatalogo = document.querySelector('.nav-link[data-seccion="catalogo"]');
    const enlaceMenuBiblioteca = document.querySelector('.nav-link[data-seccion="biblioteca"]');
    const botonExplorar = document.querySelector('.inicio-texto .boton-principal');
    const rejillaBib = $('rejillaBiblioteca');
    const filtroBib = $('filtroBiblioteca');
    const ordenBib = $('ordenBiblioteca');
    const botonesFicha = $('botonesBiblioteca');

    let obras = [];
    let porId = new Map();
    let porAniList = new Map();    // ID de AniList -> obra del catálogo (para las recomendaciones)
    let etiquetasConocidas = new Map();   // id -> { nombre, en }
    let puestoPopularidad = new Map();
    let datosListos = false;
    let estado = { tipo: '', generos: [], orden: ORDEN_INICIAL, etiqueta: '', q: '', publicacion: '', espanol: false, anio: '', sin: [] };
    let indiceBusqueda = new Map();   // id -> nombres de la obra, ya normalizados para buscar
    let coincidencias = null;         // id -> { nivel, nombre, principal } mientras hay una búsqueda
    let tarjetas = new Map();      // id -> { li, a, datos }
    let chips = new Map();         // género -> { boton, cuenta }
    let ordenPintado = '';         // ids en pantalla, para no mover tarjetas sin necesidad
    let fichaAbierta = null;
    let ignorarCierre = false;
    let origenFicha = null;        // elemento que abrió la ficha, para devolverle el foco
    let ultimaObra = null;         // obra de la última ficha abierta (por si no hay elemento de origen)
    let volviendo = false;         // la ficha se cerró con history.back() y el navegador aún no vuelve
    let cambioPendiente = null;    // filtro tocado justo en ese momento: se aplica al terminar de volver
    let cambioPendienteBib = null; // lo mismo para los filtros de la biblioteca
    let esperaVolver = 0;
    let vistaBib = { ...VISTA_BIB_INICIAL };
    let chipsBib = new Map();      // vista -> { boton, cuenta }
    let tarjetasBib = new Map();   // id -> { li, a, marca } (se reusan para no recargar portadas)
    let ordenPintadoBib = '';

    // ---------- Textos ----------
    function textoFecha(iso){
        if (!iso) return '';
        const [a, m, d] = iso.split('-').map(Number);
        if (!m) return String(a);
        if (!d) return `${MESES[m - 1]} de ${a}`;
        return `${d} de ${MESES[m - 1]} de ${a}`;
    }

    function textoFechaCorta(iso){
        if (!iso) return '';
        const [a, m] = iso.split('-').map(Number);
        return m ? `${MESES_CORTOS[m - 1]} ${a}` : String(a);
    }

    const textoLectores = n => `${formatoLectores.format(n)} lectores`;
    const textoPuntaje = p => formatoPuntaje.format(p / 10);
    const portadaGrande = o => o.portadaGrande || o.portada.replace('/cover/medium/', '/cover/large/');

    function crear(etiqueta, clase, texto){
        const el = document.createElement(etiqueta);
        if (clase) el.className = clase;
        if (texto != null) el.textContent = texto;
        return el;
    }

    function etiquetaTipo(tipo){
        return crear('span', 'tipo tipo-' + tipo, TIPOS[tipo]);
    }

    const ICONO_ESTRELLA = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/></svg>';

    const ICONO_CORAZON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.3C.9 8.4 2.9 4.5 6.6 4.5c2.2 0 3.7 1.2 5.4 3.2 1.7-2 3.2-3.2 5.4-3.2 3.7 0 5.7 3.9 4.2 7.2C19.5 16.4 12 21 12 21z"/></svg>';

    function datoPuntaje(o){
        const p = puntaje(o);
        if (p == null) return null;
        const span = crear('span', 'dato-puntaje');
        span.innerHTML = ICONO_ESTRELLA;
        span.append(crear('span', 'solo-lectores', 'Puntaje '), textoPuntaje(p));
        return span;
    }

    function imagenPortada(o, tamanos){
        const img = document.createElement('img');
        img.className = 'descongelar';
        img.alt = '';
        img.width = 230;
        img.height = 345;
        img.loading = 'lazy';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        img.sizes = tamanos;
        img.srcset = `${o.portada} 230w, ${portadaGrande(o)} 460w`;
        img.src = o.portada;
        const lista = () => img.classList.add('cargada');
        img.addEventListener('load', lista, { once: true });
        // Si la portada no carga, queda el color de la obra de fondo
        img.addEventListener('error', () => img.remove(), { once: true });
        return img;
    }

    function colorDePlaca(el, o){
        // El color principal de la portada, suave, mientras carga la imagen
        if (o.color) el.style.setProperty('--color-placa', o.color + '55');
    }

    // ---------- Buscar por nombre ----------
    // Sin tildes, mayúsculas ni signos: "Pokémon", "POKEMON" y "pokemon" son lo mismo.
    // Las letras de ancho completo (japonés) se pasan a las normales.
    const MAX_BUSQUEDA = 80;
    const normalizar = t => String(t || '').normalize('NFKC').normalize('NFD').replace(/\p{M}/gu, '')
        .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

    function construirIndiceBusqueda(){
        indiceBusqueda = new Map(obras.map(o => {
            const t = o.titulos || {};
            const vistos = new Set();
            const nombres = [o.titulo, t.ingles, t.romaji, t.nativo, ...(o.sinonimos || [])]
                .filter(Boolean)
                .map(texto => ({ texto, norm: normalizar(texto) }))
                .filter(n => n.norm && !vistos.has(n.norm) && vistos.add(n.norm));
            return [o.id, nombres];
        }));
    }

    // Qué tan bien coincide una obra con lo buscado (q ya normalizado). null si no coincide;
    // nivel 0: un nombre empieza así; 1: alguna palabra empieza así; 2: aparece en otra parte.
    // También encuentra lo escrito sin espacios ("chainsawman"). "nombre" es el nombre que mejor
    // coincidió y "principal" dice si el título que se ve en la tarjeta también coincide.
    function coincidencia(o, q){
        const palabras = q.split(' ');
        const junto = q.replace(/ /g, '');
        let mejor = null;
        let enTitulo = false;
        for (const n of indiceBusqueda.get(o.id) || []){
            let nivel = null;
            if (n.norm.startsWith(q)) nivel = 0;
            else if (palabras.every(p => n.norm.includes(p))) nivel = (' ' + n.norm).includes(' ' + palabras[0]) ? 1 : 2;
            else if (junto.length >= 3 && n.norm.replace(/ /g, '').includes(junto)) nivel = 2;
            if (nivel === null) continue;
            if (n.texto === o.titulo) enTitulo = true;
            if (!mejor || nivel < mejor.nivel) mejor = { nivel, nombre: n.texto };
        }
        if (mejor) mejor.principal = enTitulo;
        return mejor;
    }

    function calcularCoincidencias(){
        const q = normalizar(estado.q);
        coincidencias = q ? new Map(obras.map(o => [o.id, coincidencia(o, q)]).filter(([, c]) => c)) : null;
    }

    // ---------- Estado <-> dirección ----------
    function estadoDesdeParams(params){
        const tipo = Object.prototype.hasOwnProperty.call(TIPOS, params.get('tipo')) ? params.get('tipo') : '';
        const generos = [...new Set((params.get('generos') || '').split(',').filter(g => Object.prototype.hasOwnProperty.call(GENEROS, g)))];
        const orden = Object.prototype.hasOwnProperty.call(ORDENES, params.get('orden')) ? params.get('orden') : ORDEN_INICIAL;
        const etiqueta = etiquetasConocidas.has(params.get('etiqueta')) ? params.get('etiqueta') : '';
        const q = (params.get('q') || '').replace(/\s+/g, ' ').trim().slice(0, MAX_BUSQUEDA);
        const publicacion = Object.prototype.hasOwnProperty.call(PUBLICACION, params.get('estado')) ? params.get('estado') : '';
        const espanol = params.get('es') === '1';
        const anio = params.get('anio') && Object.prototype.hasOwnProperty.call(ANIOS, params.get('anio')) ? params.get('anio') : '';
        // Géneros que no quieres ver (si uno también está elegido, gana el elegido)
        const sin = [...new Set((params.get('sin') || '').split(',').filter(g => Object.prototype.hasOwnProperty.call(GENEROS, g) && !generos.includes(g)))];
        return { tipo, generos, orden, etiqueta, q, publicacion, espanol, anio, sin };
    }

    function hashCatalogo(e = estado, obra = null){
        const partes = [];
        if (e.q) partes.push('q=' + encodeURIComponent(e.q));
        if (e.tipo) partes.push('tipo=' + e.tipo);
        if (e.generos.length) partes.push('generos=' + e.generos.join(','));
        if (e.etiqueta) partes.push('etiqueta=' + e.etiqueta);
        if (e.publicacion) partes.push('estado=' + e.publicacion);
        if (e.espanol) partes.push('es=1');
        if (e.anio) partes.push('anio=' + e.anio);
        if (e.sin && e.sin.length) partes.push('sin=' + e.sin.join(','));
        if (e.orden !== ORDEN_INICIAL) partes.push('orden=' + e.orden);
        if (obra) partes.push('obra=' + encodeURIComponent(obra));
        return '#catalogo' + (partes.length ? '?' + partes.join('&') : '');
    }

    // Biblioteca: #biblioteca?ver=leyendo&orden=titulo (y &obra=... con la ficha abierta)
    function vistaDesdeParams(params){
        const ver = Object.prototype.hasOwnProperty.call(VISTAS_BIB, params.get('ver')) ? params.get('ver') : VISTA_BIB_INICIAL.ver;
        const orden = Object.prototype.hasOwnProperty.call(ORDENES_BIB, params.get('orden')) ? params.get('orden') : VISTA_BIB_INICIAL.orden;
        return { ver, orden };
    }

    function hashBiblioteca(v = vistaBib, obra = null){
        const partes = [];
        if (v.ver !== VISTA_BIB_INICIAL.ver) partes.push('ver=' + v.ver);
        if (v.orden !== VISTA_BIB_INICIAL.orden) partes.push('orden=' + v.orden);
        if (obra) partes.push('obra=' + encodeURIComponent(obra));
        return '#biblioteca' + (partes.length ? '?' + partes.join('&') : '');
    }

    // La ficha se abre encima del apartado en el que estás (catálogo o biblioteca)
    const enBiblioteca = () => Frozen.ruta().seccion === 'biblioteca';
    const hashObra = id => enBiblioteca() ? hashBiblioteca(vistaBib, id) : hashCatalogo(estado, id);
    const hashSinFicha = () => enBiblioteca() ? hashBiblioteca() : hashCatalogo();

    function cambiarVistaBib(cambios){
        if (volviendo){
            cambioPendienteBib = { ...(cambioPendienteBib || {}), ...cambios };
            return;
        }
        Frozen.navegar(hashBiblioteca({ ...vistaBib, ...cambios }), { reemplazar: true });
    }

    function cambiarEstado(cambios){
        // Si la ficha se está cerrando con Atrás, el cambio espera a que el navegador termine de volver
        if (volviendo){
            cambioPendiente = { ...(cambioPendiente || {}), ...cambios };
            return;
        }
        Frozen.navegar(hashCatalogo({ ...estado, ...cambios }), { reemplazar: true });
    }

    function volverAtras(){
        volviendo = true;
        clearTimeout(esperaVolver);
        esperaVolver = setTimeout(terminarDeVolver, 1000);   // por si el navegador no avisa
        history.back();
    }

    function terminarDeVolver(){
        if (!volviendo) return;
        volviendo = false;
        clearTimeout(esperaVolver);
        if (cambioPendiente){
            const cambios = cambioPendiente;
            cambioPendiente = null;
            cambiarEstado(cambios);
        }
        if (cambioPendienteBib){
            const cambios = cambioPendienteBib;
            cambioPendienteBib = null;
            cambiarVistaBib(cambios);
        }
    }

    // ---------- Filtrar y ordenar ----------
    const cumpleTipo = (o, tipo) => !tipo || o.tipo === tipo;
    const tieneGeneros = (o, generos) => generos.every(g => o.generos.includes(g));
    const tieneEtiqueta = (o, etiqueta) => !etiqueta || etiquetasDe(o).some(e => e.id === etiqueta);
    const cumplePublicacion = (o, publicacion) => !publicacion || o.estado === publicacion;
    const cumpleEspanol = (o, espanol) => !espanol || o.es === 1;      // edición o plataforma oficial en español
    const anioDe = o => o.inicio ? Number(o.inicio.slice(0, 4)) : null;
    const cumpleAnio = (o, anio) => {
        if (!anio) return true;
        const a = anioDe(o);
        if (!a) return false;
        return anio === 'antes-2000' ? a < 2000 : a >= Number(anio);
    };
    const sinGeneros = (o, sin) => !sin || !sin.length || !sin.some(g => o.generos.includes(g));
    const cumpleBusqueda = o => !coincidencias || coincidencias.has(o.id);
    // Todo lo elegido (sin = el filtro que no se cuenta, para saber cuántas quedarían si lo sumas)
    const cumpleFiltros = (o, sin = '') => cumpleBusqueda(o) && cumpleTipo(o, estado.tipo)
        && (sin === 'generos' || tieneGeneros(o, estado.generos)) && tieneEtiqueta(o, estado.etiqueta)
        && cumplePublicacion(o, estado.publicacion) && (sin === 'espanol' || cumpleEspanol(o, estado.espanol))
        && (sin === 'anio' || cumpleAnio(o, estado.anio)) && sinGeneros(o, estado.sin);
    // Con una búsqueda, primero las obras cuyo nombre empieza con lo escrito; después, el orden elegido
    const porRelevancia = (a, b) => coincidencias ? coincidencias.get(a.id).nivel - coincidencias.get(b.id).nivel : 0;

    function resultados(){
        return obras
            .filter(o => cumpleFiltros(o))
            .sort((a, b) => porRelevancia(a, b) || ORDENES[estado.orden](a, b) || a.titulo.localeCompare(b.titulo, 'es'));
    }

    // ---------- Construir una vez ----------
    function construirTarjetas(){
        tarjetas = new Map(obras.map(o => {
            const li = document.createElement('li');
            const a = crear('a', 'obra');
            a.dataset.obra = o.id;
            const portada = crear('div', 'obra-portada');
            colorDePlaca(portada, o);
            const marca = crear('span', 'marca-biblioteca');
            pintarMarca(marca, Biblioteca.obtener(o.id));
            portada.append(imagenPortada(o, '(max-width: 768px) 46vw, 190px'), etiquetaTipo(o.tipo), marca);
            const datos = crear('span', 'obra-datos');
            const alias = crear('span', 'obra-alias');
            alias.hidden = true;
            a.append(portada, crear('span', 'obra-titulo', o.titulo), alias, datos);
            li.append(a);
            return [o.id, { li, a, datos, marca, alias }];
        }));
    }

    // Marca sobre la portada si la obra está en tu biblioteca: su etiqueta y un corazón si es favorita
    function pintarMarca(marca, e){
        marca.replaceChildren();
        marca.hidden = !e;
        if (!e) return;
        marca.append(crear('span', 'solo-lectores', 'En tu biblioteca: '));
        if (e.favorito){
            const corazon = crear('span', 'marca-corazon');
            corazon.innerHTML = ICONO_CORAZON;
            corazon.append(crear('span', 'solo-lectores', e.estado ? 'favorita, ' : 'favorita'));
            marca.append(corazon);
        }
        if (e.estado) marca.append(ETIQUETAS_BIB[e.estado]);
        marca.classList.toggle('solo-corazon', !e.estado);
    }

    function construirChips(){
        const presentes = [...new Set(obras.flatMap(o => o.generos))]
            .filter(g => GENEROS[g])
            .sort((a, b) => GENEROS[a].localeCompare(GENEROS[b], 'es'));
        chips = new Map(presentes.map(g => {
            const boton = crear('button', 'chip');
            boton.type = 'button';
            boton.dataset.genero = g;
            boton.setAttribute('aria-pressed', 'false');
            const cuenta = crear('span', 'cuenta');
            boton.append(crear('span', null, GENEROS[g]), cuenta);
            return [g, { boton, cuenta }];
        }));
        zonaGeneros.replaceChildren(...[...chips.values()].map(c => c.boton), quitarGeneros);
        listaOcultar.replaceChildren(...presentes.map(g => {
            const etiqueta = crear('label', 'chip chip-ocultar');
            const casilla = document.createElement('input');
            casilla.type = 'checkbox';
            casilla.value = g;
            etiqueta.append(casilla, crear('span', null, GENEROS[g]));
            return etiqueta;
        }));
    }

    // ---------- Pintar ----------
    function pintarFiltros(){
        document.querySelectorAll('#filtroTipo input').forEach(i => { i.checked = i.value === estado.tipo; });
        selectOrden.value = estado.orden;

        // El buscador muestra lo buscado, salvo mientras escribes en él
        if (document.activeElement !== inputBuscar && inputBuscar.value !== estado.q) inputBuscar.value = estado.q;

        // Cada género dice cuántas obras quedarían si lo sumas a lo que ya elegiste
        const base = obras.filter(o => cumpleFiltros(o));
        chips.forEach(({ boton, cuenta }, g) => {
            const activo = estado.generos.includes(g);
            boton.setAttribute('aria-pressed', String(activo));
            if (activo){
                cuenta.replaceChildren();
                boton.disabled = false;
            } else {
                const n = base.filter(o => o.generos.includes(g)).length;
                cuenta.replaceChildren(crear('span', 'solo-lectores', ', '), String(n), crear('span', 'solo-lectores', n === 1 ? ' obra' : ' obras'));
                boton.disabled = n === 0;
            }
        });
        // Ocultar géneros: un género elegido no se puede ocultar a la vez (y uno oculto queda sin obras arriba)
        listaOcultar.querySelectorAll('input').forEach(i => {
            i.checked = estado.sin.includes(i.value);
            i.disabled = estado.generos.includes(i.value);
        });
        $('cuentaOcultos').textContent = estado.sin.length ? `(${estado.sin.length})` : '';

        // Salió: cada opción dice cuántas obras quedarían
        const selectAnio = $('filtroAnio');
        selectAnio.value = estado.anio;
        const sinAnio = obras.filter(o => cumpleFiltros(o, 'anio'));
        [...selectAnio.options].forEach(op => {
            if (!op.value){ op.textContent = ANIOS['']; return; }
            const n = sinAnio.filter(o => cumpleAnio(o, op.value)).length;
            op.textContent = `${ANIOS[op.value]} (${n})`;
            op.disabled = n === 0 && op.value !== estado.anio;
        });
        quitarGeneros.hidden = estado.generos.length === 0;
        cuentaGeneros.textContent = estado.generos.length ? `(${estado.generos.length})` : '';

        // Estado de la obra y «En español» (este dice cuántas quedarían, como los géneros)
        document.querySelectorAll('#filtroPublicacion input').forEach(i => { i.checked = i.value === estado.publicacion; });
        const botonEspanol = $('filtroEspanol');
        const cuentaEspanol = $('cuentaEspanol');
        botonEspanol.setAttribute('aria-pressed', String(estado.espanol));
        if (estado.espanol){
            cuentaEspanol.replaceChildren();
            botonEspanol.disabled = false;
        } else {
            const n = obras.filter(o => cumpleFiltros(o, 'espanol') && o.es === 1).length;
            cuentaEspanol.replaceChildren(crear('span', 'solo-lectores', ', '), String(n), crear('span', 'solo-lectores', n === 1 ? ' obra' : ' obras'));
            botonEspanol.disabled = n === 0;
        }

        const etiqueta = etiquetasConocidas.get(estado.etiqueta);
        $('filtroEtiqueta').hidden = !etiqueta;
        if (etiqueta){
            const nombre = $('nombreEtiqueta');
            nombre.textContent = etiqueta.nombre;
            if (etiqueta.en) nombre.lang = 'en'; else nombre.removeAttribute('lang');
        }
    }

    function pintarRejilla(lista){
        if (!lista.length){
            ordenPintado = '';
            rejilla.replaceChildren(estadoVacio());
            return;
        }
        lista.forEach(o => {
            const t = tarjetas.get(o.id);
            t.a.href = hashCatalogo(estado, o.id);
            const datos = [];
            if (estado.orden === 'fecha-desc' || estado.orden === 'fecha-asc') datos.push(crear('span', null, textoFechaCorta(o.inicio)));
            else datos.push(crear('span', null, o.inicio ? o.inicio.slice(0, 4) : ''));
            if (estado.orden === 'populares') datos.push(crear('span', null, textoLectores(popularidad(o))));
            else if (estado.orden === 'tendencia' && actividad(o).leyendo) datos.push(crear('span', null, `${formatoLectores.format(actividad(o).leyendo)} leyendo`));
            else { const p = datoPuntaje(o); if (p) datos.push(p); }
            t.datos.replaceChildren(...datos);
            pintarAlias(t.alias, o);
        });
        // Solo se mueven las tarjetas si cambió la lista (así no se pierde el foco ni se recargan portadas)
        const ids = lista.map(o => o.id).join('|');
        if (ids !== ordenPintado){
            rejilla.replaceChildren(...lista.map(o => tarjetas.get(o.id).li));
            ordenPintado = ids;
        }
    }

    // Si la búsqueda coincidió con otro nombre (p. ej. "Shingeki no Kyojin" para Attack on Titan), se muestra bajo el título
    function pintarAlias(alias, o){
        const c = coincidencias && coincidencias.get(o.id);
        const mostrar = Boolean(c && !c.principal);
        alias.hidden = !mostrar;
        if (!mostrar){
            alias.replaceChildren();
            return;
        }
        const nombre = crear('span', null, c.nombre);
        if (o.titulos && c.nombre === o.titulos.nativo) nombre.lang = IDIOMA_ORIGINAL[o.tipo];
        alias.replaceChildren(crear('span', 'solo-lectores', 'También llamada '), nombre);
    }

    function borrarBusqueda(){
        clearTimeout(esperaBusqueda);
        inputBuscar.value = '';
        cambiarEstado({ q: '' });
        inputBuscar.focus();
    }

    function estadoVacio(){
        const li = crear('li', 'estado-lista');
        if (estado.q){
            // ¿La búsqueda encuentra algo si se quitan el tipo, los géneros y la etiqueta?
            const sinFiltros = obras.filter(cumpleBusqueda).length;
            const boton = crear('button', 'boton-secundario', sinFiltros ? 'Buscar en todo el catálogo' : 'Borrar la búsqueda');
            boton.type = 'button';
            if (sinFiltros){
                li.append(crear('strong', null, `Hay ${sinFiltros} ${sinFiltros === 1 ? 'obra' : 'obras'} con «${estado.q}», pero no con los filtros que elegiste.`),
                    crear('span', null, 'Puedes buscar en todo el catálogo sin borrar lo que escribiste.'));
                boton.addEventListener('click', () => {
                    cambiarEstado({ tipo: '', generos: [], etiqueta: '', publicacion: '', espanol: false, anio: '', sin: [] });
                    $('tituloCatalogo').focus();
                });
            } else {
                li.append(crear('strong', null, `Ninguna obra se llama «${estado.q}».`),
                    crear('span', null, 'Revisa cómo está escrito o prueba con otro de sus nombres: en inglés, en romaji o en su idioma original.'));
                boton.addEventListener('click', borrarBusqueda);
            }
            li.append(document.createElement('br'), boton);
            return li;
        }
        const quien = estado.tipo ? `Ningún ${TIPOS[estado.tipo].toLowerCase()}` : 'Ninguna obra';
        // Con el estado o «En español» puestos, el aviso habla de todos los filtros
        if (estado.publicacion || estado.espanol || estado.anio || estado.sin.length){
            li.append(crear('strong', null, `${quien} cumple todos esos filtros.`), crear('span', null, 'Quita alguno de los filtros de arriba o cambia el tipo.'));
            const quitar = crear('button', 'boton-secundario', 'Quitar filtros');
            quitar.type = 'button';
            quitar.addEventListener('click', () => {
                cambiarEstado({ generos: [], etiqueta: '', publicacion: '', espanol: false, anio: '', sin: [] });
                $('tituloCatalogo').focus();
            });
            li.append(document.createElement('br'), quitar);
            return li;
        }
        const conEtiqueta = Boolean(estado.etiqueta) && estado.generos.length === 0;
        if (conEtiqueta) li.append(crear('strong', null, `${quien} tiene esa etiqueta.`), crear('span', null, 'Quita la etiqueta o cambia el tipo.'));
        else li.append(crear('strong', null, `${quien} tiene todos esos géneros.`), crear('span', null, 'Quita algún género o cambia el tipo.'));
        const boton = crear('button', 'boton-secundario', conEtiqueta ? 'Quitar etiqueta' : 'Quitar géneros');
        boton.type = 'button';
        boton.addEventListener('click', conEtiqueta ? quitarEtiqueta : quitarTodosLosGeneros);
        li.append(document.createElement('br'), boton);
        return li;
    }

    function pintarConteo(n){
        const total = obras.length;
        conteo.textContent = n === total ? `${total} obras` : `${n} de ${total} obras`;
        $('sorprendeme').disabled = n === 0;
    }

    function pintar(){
        calcularCoincidencias();
        const lista = resultados();
        pintarFiltros();
        pintarRejilla(lista);
        pintarConteo(lista.length);
        // El menú y el botón del Inicio vuelven al catálogo con los mismos filtros
        enlaceMenuCatalogo.href = hashCatalogo();
        botonExplorar.href = hashCatalogo();
    }

    // Quita los géneros elegidos. El botón que se usó desaparece, así que el foco
    // pasa al primer género (o al título del catálogo) en vez de perderse
    function quitarTodosLosGeneros(){
        cambiarEstado({ generos: [] });
        const activo = document.activeElement;
        if (activo && activo !== document.body && activo.isConnected && activo.offsetParent !== null) return;
        const chip = zonaGeneros.querySelector('.chip:not(:disabled)');
        if (chip && chip.offsetParent !== null) chip.focus();
        else $('tituloCatalogo').focus();
    }

    // Quita la etiqueta; como su botón desaparece, el foco pasa al título del catálogo
    function quitarEtiqueta(){
        cambiarEstado({ etiqueta: '' });
        $('tituloCatalogo').focus();
    }

    // ---------- Inicio: lo más popular de hoy, de la semana y del mes, y las recién llegadas ----------
    // Sale de datos/populares.json (scripts/populares.mjs, una tarea diaria de GitHub). Cambia sola cada
    // 9,5 s con una transición suave; se queda quieta mientras tienes el mouse o el foco encima, mientras
    // la tocas en el celular, si la pestaña está oculta o con "menos movimiento" activado en tu sistema.
    // Sin ese archivo queda como antes: lo más popular de siempre de cada tipo.
    // «Nuevas»: las obras del catálogo que salieron más recientemente (por la fecha en que empezaron
    // a publicarse), sin importar cuándo llegaron a la página.
    const PERIODOS_BASE = [
        { clave: 'hoy', boton: 'Hoy', titulo: 'Lo más popular de hoy', cuando: 'hoy' },
        { clave: 'semana', boton: 'Semana', titulo: 'Lo más popular de la semana', cuando: 'esta semana' },
        { clave: 'mes', boton: 'Mes', titulo: 'Lo más popular del mes', cuando: 'este mes' }
    ];
    const NUEVAS = { clave: 'nuevas', boton: 'Nuevas', titulo: 'Las más recientes en salir', nuevas: true };
    const CUANTAS_NUEVAS = 6;
    let PERIODOS_POP = PERIODOS_BASE;
    const INTERVALO_POP = 9500;
    const POR_TIPO_POP = 2;
    const TAMANOS_MINI = '(max-width: 1279px) 96px, 54px';
    const menosMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)');
    let populares = null;
    let periodoPop = 0;
    let relojPop = 0;
    let inicioCiclo = 0;
    let restanteCiclo = INTERVALO_POP;
    let pausaUsuario = menosMovimiento.matches;
    let cambiandoPop = Promise.resolve();
    const pausasPop = new Set();
    const panelPop = $('inicioPopulares');

    async function cargarPopulares(){
        try {
            const r = await fetch('datos/populares.json', { cache: 'no-cache' });
            if (!r.ok) return null;
            const datos = await r.json();
            return datos && datos.periodos ? datos : null;
        } catch (error){
            return null;
        }
    }

    // Cuándo salió: "Salió el 12 de noviembre", "Salió en marzo de 2025" o "Salió en 2024" (según lo que diga AniList)
    function textoSalida(inicio){
        const [anio, mes, dia] = String(inicio || '').split('-').map(Number);
        if (!anio) return '';
        if (!mes) return `Salió en ${anio}`;
        if (!dia) return `Salió en ${MESES[mes - 1]} de ${anio}`;
        return anio === new Date().getFullYear() ? `Salió el ${dia} de ${MESES[mes - 1]}` : `Salió el ${dia} de ${MESES[mes - 1]} de ${anio}`;
    }
    // Las más recientes en salir (las que todavía no salen no cuentan); el mismo día, las más populares
    function recientes(){
        const d = new Date();
        const hoy = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return obras.filter(o => o.inicio && claveFecha(o) <= hoy)
            .sort((a, b) => claveFecha(b).localeCompare(claveFecha(a)) || popularidad(b) - popularidad(a))
            .slice(0, CUANTAS_NUEVAS);
    }

    // Las obras de un periodo: 2 por tipo; si faltan, se completa con las más populares de siempre
    function elegidasPop(periodo){
        if (periodo && periodo.nuevas) return recientes().map(o => ({ o, nuevos: null }));
        return Object.keys(TIPOS).flatMap(tipo => {
            const lista = ((populares && periodo && populares.periodos[periodo.clave] && populares.periodos[periodo.clave][tipo]) || [])
                .map(x => ({ o: porId.get(x.id), nuevos: Number.isFinite(x.nuevos) ? x.nuevos : null }))
                .filter(x => x.o)
                .slice(0, POR_TIPO_POP);
            if (lista.length < POR_TIPO_POP){
                obras.filter(o => o.tipo === tipo && !lista.some(x => x.o.id === o.id)).sort(ORDENES.populares)
                    .slice(0, POR_TIPO_POP - lista.length).forEach(o => lista.push({ o, nuevos: null }));
            }
            return lista;
        });
    }

    function itemPopular({ o, nuevos }, periodo){
        const li = document.createElement('li');
        const a = crear('a', 'mini-obra');
        a.href = hashCatalogo({ tipo: '', generos: [], orden: ORDEN_INICIAL }, o.id);
        a.dataset.obra = o.id;
        const portada = crear('span', 'mini-portada');
        colorDePlaca(portada, o);
        portada.append(imagenPortada(o, TAMANOS_MINI));
        const texto = crear('span', 'mini-texto');
        const datos = crear('span', 'mini-datos');
        const cifra = periodo && periodo.nuevas ? textoSalida(o.inicio)
            : periodo && nuevos > 0
                ? `+${formatoLectores.format(nuevos)} ${nuevos === 1 ? 'lector' : 'lectores'} ${periodo.cuando}`
                : textoLectores(popularidad(o));
        datos.append(etiquetaTipo(o.tipo), crear('span', 'lectores', cifra));
        texto.append(crear('span', 'mini-titulo', o.titulo), datos);
        a.append(portada, texto);
        li.append(a);
        return li;
    }

    // Deja bajando las portadas del periodo que sigue, para que el cambio no muestre huecos
    function adelantarPortadas(periodo){
        elegidasPop(periodo).forEach(({ o }) => {
            const img = new Image();
            img.referrerPolicy = 'no-referrer';
            img.sizes = TAMANOS_MINI;
            img.srcset = `${o.portada} 230w, ${portadaGrande(o)} 460w`;
            img.src = o.portada;
        });
    }

    async function cambiarLista(items, animar){
        const lista = $('listaPopulares');
        const viejos = [...lista.children];
        if (!animar || menosMovimiento.matches || !viejos.length || typeof lista.animate !== 'function'){
            lista.replaceChildren(...items);
            return;
        }
        lista.style.minHeight = lista.offsetHeight + 'px';    // que la página no salte mientras cambia
        await Promise.all(viejos.map((li, i) => li.animate(
            [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-10px)' }],
            { duration: 220, delay: i * 35, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' }
        ).finished.catch(() => {})));
        lista.scrollLeft = 0;
        lista.replaceChildren(...items);
        items.forEach((li, i) => li.animate(
            [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
            { duration: 420, delay: i * 55, easing: 'cubic-bezier(.2, .7, .2, 1)', fill: 'backwards' }
        ));
        lista.style.minHeight = '';
    }

    function mostrarPeriodo(indice, { animar = false } = {}){
        periodoPop = indice;
        const periodo = populares ? PERIODOS_POP[indice] : null;
        const titulo = $('tituloPopulares');
        titulo.textContent = periodo ? periodo.titulo : 'Lo más popular de cada tipo';
        if (animar && !menosMovimiento.matches && typeof titulo.animate === 'function'){
            titulo.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 420, easing: 'ease-out' });
        }
        $('periodosPopulares').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(Boolean(periodo) && b.dataset.periodo === periodo.clave)));
        const items = elegidasPop(periodo).map(x => itemPopular(x, periodo));
        cambiandoPop = cambiandoPop.then(() => cambiarLista(items, animar));
        if (populares) adelantarPortadas(PERIODOS_POP[(indice + 1) % PERIODOS_POP.length]);
        reiniciarCiclo();
    }

    // ----- El reloj: avanza cada 9,5 s, se pausa y retoma donde iba (la barrita de progreso va igual) -----
    const pausadoPop = () => pausaUsuario || pausasPop.size > 0;

    function actualizarRelojPop(){
        if (!populares) return;
        const parar = pausadoPop();
        panelPop.classList.toggle('pausado', parar);
        if (parar){
            if (inicioCiclo){
                restanteCiclo = Math.max(0, restanteCiclo - (Date.now() - inicioCiclo));
                inicioCiclo = 0;
                clearTimeout(relojPop);
            }
        } else if (!inicioCiclo){
            inicioCiclo = Date.now();
            relojPop = setTimeout(avanzarPop, restanteCiclo);
        }
    }

    function reiniciarCiclo(){
        clearTimeout(relojPop);
        inicioCiclo = 0;
        restanteCiclo = INTERVALO_POP;
        // La barrita del botón activo vuelve a empezar
        panelPop.querySelectorAll('.progreso-periodo').forEach(b => b.remove());
        const activo = $('periodosPopulares').querySelector('[aria-pressed="true"]');
        if (activo && populares) activo.append(crear('span', 'progreso-periodo'));
        actualizarRelojPop();
    }

    function avanzarPop(){
        inicioCiclo = 0;
        mostrarPeriodo((periodoPop + 1) % PERIODOS_POP.length, { animar: true });
    }

    function pausarPor(motivo, si){
        if (si) pausasPop.add(motivo); else pausasPop.delete(motivo);
        actualizarRelojPop();
    }

    function pintarBotonPausa(){
        const boton = $('pausaPopulares');
        boton.setAttribute('aria-pressed', String(pausaUsuario));
        boton.setAttribute('aria-label', pausaUsuario ? 'Reanudar el cambio automático' : 'Pausar el cambio automático');
        boton.dataset.estado = pausaUsuario ? 'pausado' : 'andando';
    }

    let relojToque = 0;
    function prepararRotacion(){
        $('periodosPopulares').hidden = false;
        $('pausaPopulares').hidden = false;
        pintarBotonPausa();
        $('periodosPopulares').addEventListener('click', ev => {
            const b = ev.target.closest('button[data-periodo]');
            if (!b) return;
            const i = PERIODOS_POP.findIndex(p => p.clave === b.dataset.periodo);
            if (i !== -1 && i !== periodoPop) mostrarPeriodo(i, { animar: true });
        });
        $('pausaPopulares').addEventListener('click', () => {
            pausaUsuario = !pausaUsuario;
            if (!pausaUsuario){
                // "Reanudar" es una orden clara: sigue ya, aunque el mouse o el foco estén encima
                pausasPop.delete('encima');
                pausasPop.delete('foco');
            }
            pintarBotonPausa();
            actualizarRelojPop();
        });
        panelPop.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') pausarPor('encima', true); });
        panelPop.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') pausarPor('encima', false); });
        // Solo con el teclado (con el mouse ya cuenta tenerlo encima)
        panelPop.addEventListener('focusin', e => { if (e.target.matches(':focus-visible')) pausarPor('foco', true); });
        panelPop.addEventListener('focusout', e => { if (!panelPop.contains(e.relatedTarget)) pausarPor('foco', false); });
        // En el celular: mientras la tocas o la deslizas, y hasta 8 s después
        const tocar = () => {
            pausarPor('toque', true);
            clearTimeout(relojToque);
            relojToque = setTimeout(() => pausarPor('toque', false), 8000);
        };
        panelPop.addEventListener('touchstart', tocar, { passive: true });
        $('listaPopulares').addEventListener('scroll', tocar, { passive: true });
        document.addEventListener('visibilitychange', () => pausarPor('oculta', document.visibilityState === 'hidden'));
        window.addEventListener('frozen:ruta', e => pausarPor('apartado', e.detail.seccion !== 'inicio'));
        pausasPop.clear();
        if (document.visibilityState === 'hidden') pausasPop.add('oculta');
        if (Frozen.ruta().seccion !== 'inicio') pausasPop.add('apartado');
        menosMovimiento.addEventListener('change', () => {
            if (menosMovimiento.matches){ pausaUsuario = true; pintarBotonPausa(); actualizarRelojPop(); }
        });
    }

    function pintarPopulares(datosPopulares){
        populares = datosPopulares;
        if (!obras.length) return;
        PERIODOS_POP = recientes().length ? [...PERIODOS_BASE, NUEVAS] : PERIODOS_BASE;
        $('periodosPopulares').querySelector('[data-periodo="nuevas"]').hidden = !PERIODOS_POP.includes(NUEVAS);
        if (populares) prepararRotacion();
        mostrarPeriodo(0);
        panelPop.hidden = false;
    }

    function pintarFechaDatos(fecha){
        let texto = fecha ? `Catálogo con datos de AniList del ${textoFecha(fecha)}.` : 'Catálogo con datos de AniList.';
        if (comunidad && comunidad.generado){
            const nombres = Object.entries(comunidad.fuentes || {}).filter(([, f]) => f).map(([n]) => NOMBRES_FUENTES[n]).filter(Boolean);
            texto += ` Opinión de la comunidad (${enumerar(nombres)}) actualizada el ${textoFecha(comunidad.generado.slice(0, 10))}; se renueva por partes de lunes a viernes.`;
        }
        const tono = comunidad && comunidad.tono;
        const acierto = tono && tono.metodo === 'modelo' && Number.isFinite(tono.acierto)
            ? ` Comparado con el puntaje que puso cada autor, el modelo acierta si una reseña es positiva o negativa en el ${Math.round(tono.acierto * 100)} % de los casos (promediando positivas y negativas).`
            : '';
        $('fechaDatos').textContent = texto + acierto;
        const enlace = crear('a', null, 'Cómo se calcula');
        enlace.href = '#sobre';
        $('notaDatos').replaceChildren(texto + ' ', enlace);
    }

    // ---------- Mi biblioteca (apartado) ----------
    function construirChipsBiblioteca(){
        chipsBib = new Map(Object.entries(VISTAS_BIB).map(([ver, nombre]) => {
            const boton = crear('button', 'chip');
            boton.type = 'button';
            boton.dataset.ver = ver;
            boton.setAttribute('aria-pressed', 'false');
            const cuenta = crear('span', 'cuenta');
            const texto = crear('span', null, nombre);
            if (ver === 'favoritos'){
                const corazon = crear('span', 'chip-icono');
                corazon.innerHTML = ICONO_CORAZON;
                boton.append(corazon);
            }
            boton.append(texto, cuenta);
            return [ver, { boton, cuenta }];
        }));
        filtroBib.replaceChildren(...[...chipsBib.values()].map(c => c.boton));
    }

    // Las obras de la biblioteca que siguen en el catálogo, con su entrada: [{ o, e }]
    const entradasBiblioteca = () => Biblioteca.todas()
        .map(([id, e]) => ({ o: porId.get(id), e }))
        .filter(x => x.o);

    function tarjetaBiblioteca({ o, e }){
        let t = tarjetasBib.get(o.id);
        if (!t){
            const li = document.createElement('li');
            const a = crear('a', 'obra');
            a.dataset.obra = o.id;
            const portada = crear('div', 'obra-portada');
            colorDePlaca(portada, o);
            const marca = crear('span', 'marca-biblioteca');
            portada.append(imagenPortada(o, '(max-width: 768px) 46vw, 190px'), etiquetaTipo(o.tipo), marca);
            const datos = crear('span', 'obra-datos');
            datos.append(crear('span', null, o.inicio ? o.inicio.slice(0, 4) : ''));
            const p = datoPuntaje(o);
            if (p) datos.append(p);
            a.append(portada, crear('span', 'obra-titulo', o.titulo), datos);
            li.append(a);
            t = { li, a, marca };
            tarjetasBib.set(o.id, t);
        }
        t.a.href = hashBiblioteca(vistaBib, o.id);
        pintarMarca(t.marca, e);
        return t.li;
    }

    function estadoVacioBiblioteca(total){
        const li = crear('li', 'estado-lista');
        if (!total){
            li.append(crear('strong', null, 'Tu biblioteca está vacía.'),
                crear('span', null, 'Abre una obra del catálogo y elige una etiqueta: Leyendo, Por leer, Leído…'), document.createElement('br'));
            const a = crear('a', 'boton-principal', 'Explorar el catálogo');
            a.href = hashCatalogo();
            li.append(a);
        } else {
            const nombre = VISTAS_BIB[vistaBib.ver];
            li.append(crear('strong', null, vistaBib.ver === 'favoritos' ? 'Todavía no tienes obras favoritas.' : `No tienes obras con la etiqueta «${nombre}».`),
                crear('span', null, vistaBib.ver === 'favoritos' ? 'En la ficha de una obra, toca «Favorito».' : 'En la ficha de una obra puedes cambiarle la etiqueta.'),
                document.createElement('br'));
            const boton = crear('button', 'boton-secundario', 'Ver todas');
            boton.type = 'button';
            boton.addEventListener('click', () => {
                cambiarVistaBib({ ver: 'todas' });
                $('tituloBiblioteca').focus();
            });
            li.append(boton);
        }
        return li;
    }

    function pintarBiblioteca(){
        const entradas = entradasBiblioteca();
        chipsBib.forEach(({ boton, cuenta }, ver) => {
            const n = entradas.filter(x => cumpleVista(x.e, ver)).length;
            boton.setAttribute('aria-pressed', String(ver === vistaBib.ver));
            boton.classList.toggle('vacia', n === 0);
            cuenta.replaceChildren(crear('span', 'solo-lectores', ', '), String(n), crear('span', 'solo-lectores', n === 1 ? ' obra' : ' obras'));
        });
        rejillaBib.closest('.seccion').classList.toggle('con-obras', entradas.length > 0);
        ordenBib.value = vistaBib.orden;

        const lista = entradas
            .filter(x => cumpleVista(x.e, vistaBib.ver))
            .sort((a, b) => ORDENES_BIB[vistaBib.orden](a, b) || a.o.titulo.localeCompare(b.o.titulo, 'es'));
        const total = entradas.length;
        $('conteoBiblioteca').textContent = !total ? '' : (lista.length === total ? `${total} ${total === 1 ? 'obra' : 'obras'}` : `${lista.length} de ${total} obras`);

        if (!lista.length){
            ordenPintadoBib = '';
            rejillaBib.replaceChildren(estadoVacioBiblioteca(total));
        } else {
            const items = lista.map(tarjetaBiblioteca);
            const ids = lista.map(x => x.o.id).join('|');
            if (ids !== ordenPintadoBib){
                rejillaBib.replaceChildren(...items);
                ordenPintadoBib = ids;
            }
        }
        $('avisoAlmacenamiento').hidden = Biblioteca.disponible();
        enlaceMenuBiblioteca.href = hashBiblioteca();
    }

    // ---------- Mi biblioteca (botones de la ficha) ----------
    function construirBotonesFicha(){
        const botones = Object.entries(ETIQUETAS_BIB).map(([clave, nombre]) => {
            const b = crear('button', 'chip', nombre);
            b.type = 'button';
            b.dataset.estado = clave;
            b.setAttribute('aria-pressed', 'false');
            return b;
        });
        const favorito = crear('button', 'chip chip-favorito');
        favorito.type = 'button';
        favorito.dataset.favorito = 'si';
        favorito.setAttribute('aria-pressed', 'false');
        const corazon = crear('span', 'chip-icono');
        corazon.innerHTML = ICONO_CORAZON;
        favorito.append(corazon, crear('span', null, 'Favorito'));
        botonesFicha.replaceChildren(...botones, favorito);
    }

    function pintarBotonesFicha(id){
        const e = Biblioteca.obtener(id);
        botonesFicha.querySelectorAll('[data-estado]').forEach(b => b.setAttribute('aria-pressed', String(Boolean(e && e.estado === b.dataset.estado))));
        botonesFicha.querySelector('[data-favorito]').setAttribute('aria-pressed', String(Boolean(e && e.favorito)));
        $('quitarDeBiblioteca').hidden = !e;
        $('fichaBiblioteca').classList.toggle('guardada', Boolean(e));
    }

    function avisarFicha(texto){
        $('avisoBiblioteca').textContent = texto;
    }

    botonesFicha.addEventListener('click', ev => {
        const boton = ev.target.closest('button');
        if (!boton || !fichaAbierta) return;
        const id = fichaAbierta;
        const antes = Biblioteca.obtener(id);
        let despues;
        if (boton.dataset.estado){
            const clave = boton.dataset.estado;
            const quitar = Boolean(antes && antes.estado === clave);
            despues = Biblioteca.poner(id, { estado: quitar ? null : clave });
            if (!despues) avisarFicha('La quitaste de tu biblioteca.');
            else if (quitar) avisarFicha(`Le quitaste la etiqueta «${ETIQUETAS_BIB[clave]}»; sigue en tu biblioteca como favorita.`);
            else avisarFicha(antes ? `Ahora está en «${ETIQUETAS_BIB[clave]}».` : `Guardada en tu biblioteca: «${ETIQUETAS_BIB[clave]}».`);
        } else if (boton.dataset.favorito){
            const favorita = !(antes && antes.favorito);
            despues = Biblioteca.poner(id, { favorito: favorita });
            if (favorita) avisarFicha(antes ? 'La marcaste como favorita.' : 'Guardada en tu biblioteca como favorita.');
            else avisarFicha(despues ? 'Ya no es favorita.' : 'La quitaste de tu biblioteca.');
        }
        if (!Biblioteca.disponible()) avisarFicha('Este navegador no deja guardar datos: se borrará al cerrar la página.');
    });

    $('quitarDeBiblioteca').addEventListener('click', () => {
        if (!fichaAbierta) return;
        Biblioteca.quitar(fichaAbierta);
        avisarFicha('La quitaste de tu biblioteca.');
        // El botón desaparece: el foco pasa al primer botón de etiqueta
        const primero = botonesFicha.querySelector('button');
        if (primero) primero.focus();
    });

    // Cualquier cambio (aquí, en la ficha o en otra pestaña) pone al día marcas, ficha y biblioteca
    Biblioteca.alCambiar(id => {
        if (!datosListos) return;
        const ids = id ? [id] : [...tarjetas.keys()];
        ids.forEach(x => { const t = tarjetas.get(x); if (t) pintarMarca(t.marca, Biblioteca.obtener(x)); });
        if (fichaAbierta) pintarBotonesFicha(fichaAbierta);
        pintarBiblioteca();
    });

    // ---------- Mi biblioteca (copia para llevarla a otro navegador) ----------
    function avisarCopia(texto, error = false){
        const aviso = $('avisoCopia');
        aviso.textContent = texto;
        aviso.classList.toggle('error', error);
    }

    $('guardarCopia').addEventListener('click', () => {
        const total = Biblioteca.todas().length;
        if (!total){
            avisarCopia('Tu biblioteca está vacía: no hay nada que copiar todavía.');
            return;
        }
        const archivo = new Blob([Biblioteca.exportar()], { type: 'application/json' });
        const url = URL.createObjectURL(archivo);
        const a = document.createElement('a');
        a.href = url;
        a.download = `frozen-project-biblioteca-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        avisarCopia(`Copia guardada con ${total} ${total === 1 ? 'obra' : 'obras'}. Búscala en tus descargas.`);
    });

    $('cargarCopia').addEventListener('click', () => $('archivoCopia').click());

    $('archivoCopia').addEventListener('change', async ev => {
        const archivo = ev.target.files && ev.target.files[0];
        ev.target.value = '';          // así se puede volver a elegir el mismo archivo
        if (!archivo) return;
        try {
            const r = Biblioteca.importar(await archivo.text());
            const partes = [];
            if (r.nuevas) partes.push(`${r.nuevas} ${r.nuevas === 1 ? 'obra nueva' : 'obras nuevas'}`);
            if (r.actualizadas) partes.push(`${r.actualizadas} ${r.actualizadas === 1 ? 'obra actualizada' : 'obras actualizadas'}`);
            avisarCopia(partes.length ? `Listo: ${enumerar(partes)}.` : 'Listo: ya tenías todo lo que había en esa copia.');
        } catch (error){
            avisarCopia(error.message || 'No se pudo cargar esa copia.', true);
        }
    });

    filtroBib.addEventListener('click', ev => {
        const boton = ev.target.closest('.chip');
        if (boton) cambiarVistaBib({ ver: boton.dataset.ver });
    });

    ordenBib.addEventListener('change', () => cambiarVistaBib({ orden: ordenBib.value }));

    // ---------- Lo que opina la comunidad (dentro de la ficha) ----------
    const formatoPorcentaje = new Intl.NumberFormat('es', { style: 'percent', maximumFractionDigits: 1 });

    // Opinión de la comunidad en la ficha. f: la ficha de la obra (null mientras baja, { fallo: true } si no bajó)
    function pintarComunidad(o, f){
        const c = f && !f.fallo ? f.comunidad : null;
        const p = puntaje(o);
        const nodos = [];

        // Puntaje: combinado de varias comunidades si ya está calculado; si no, el de AniList
        const fila = crear('div', 'comunidad');
        if (p != null){
            const grande = crear('span', 'puntaje', textoPuntaje(p));
            grande.append(crear('small', null, '/10'));
            fila.append(grande);
        }
        const explicacion = crear('p');
        const deDonde = Array.isArray(op(o).fuentes) ? op(o).fuentes.map(x => NOMBRES_FUENTES[x]).filter(Boolean) : [];
        if (deDonde.length){
            explicacion.append(`Combinado de ${enumerar(deDonde)}.`, document.createElement('br'),
                `${formatoLectores.format(op(o).votos || 0)} votos. Confianza ${op(o).confianza}.`);
        } else {
            explicacion.append(p == null ? 'Todavía no tiene puntaje.' : 'Promedio de los lectores de AniList.');
        }
        const leyendoAhora = actividad(o).leyendo;
        explicacion.append(document.createElement('br'),
            `${formatoLectores.format(popularidad(o))} la tienen en su lista de AniList (puesto ${puestoPopularidad.get(o.id)} de ${obras.length} en popularidad)` +
            (leyendoAhora ? ` y ${formatoLectores.format(leyendoAhora)} la están leyendo.` : '.'));
        fila.append(explicacion);
        nodos.push(fila);

        if (!f) nodos.push(crear('p', 'dato-opinion', 'Cargando la opinión de la comunidad…'));
        else if (f.fallo) nodos.push(avisoSinFicha(o));

        // Resumen de lo que dicen las reseñas, escrito por IA (Gemma 4) en la tarea de GitHub
        if (c && c.resumen && c.resumen.texto){
            nodos.push(crear('p', 'resumen-ia', c.resumen.texto),
                crear('p', 'nota-ia', `Resumen hecho con IA (${c.resumen.modelo || 'Gemma 4'}, de Google) a partir de ${c.resumen.resenas} reseñas de AniList. Puede equivocarse.`));
        }

        if (c){
            // Reparto de votos: cuántos le pusieron cada nota, del 1 al 10
            const d = c.distribucion;
            if (d && Array.isArray(d.barras)){
                const maximo = Math.max(...d.barras, 1);
                const grafico = crear('div', 'reparto');
                grafico.setAttribute('role', 'img');
                grafico.setAttribute('aria-label', 'Votos en AniList, del 1 al 10: ' +
                    d.barras.map((b, i) => `${i + 1}: ${formatoPorcentaje.format(b / 100)}`).join(', '));
                d.barras.forEach((b, i) => {
                    const barra = crear('span', i >= 6 ? 'barra gusta' : 'barra');
                    barra.style.height = Math.max(2, Math.round(100 * b / maximo)) + '%';
                    grafico.append(barra);
                });
                const ejes = crear('div', 'reparto-ejes');
                ejes.setAttribute('aria-hidden', 'true');
                ejes.append(crear('span', null, '1'), crear('span', null, '10'));
                nodos.push(grafico, ejes,
                    crear('p', 'dato-opinion', fraseReparto(d)));
            }

            // Reseñas: cuántas son positivas y qué temas se elogian o critican
            const r = c.resenas || { n: 0 };
            if (!r.n){
                nodos.push(crear('p', 'dato-opinion', 'Todavía no tiene reseñas en AniList.'));
            } else {
                const partes = [[r.positivas, 'positiva', 'positivas'], [r.negativas, 'negativa', 'negativas'], [r.mixtas, 'mixta', 'mixtas']]
                    .filter(([x]) => x > 0).map(([x, una, varias]) => `${x} ${x === 1 ? una : varias}`);
                nodos.push(crear('p', 'dato-opinion', `${r.n === 1 ? 'Una reseña' : r.n + ' reseñas'} en AniList: ${enumerar(partes)}.`));
                if (r.elogian && r.elogian.length) nodos.push(crear('p', 'dato-opinion', `Lo más elogiado: ${enumerar(r.elogian.map(t => NOMBRES_TEMAS[t] || t))}.`));
                if (r.critican && r.critican.length) nodos.push(crear('p', 'dato-opinion', `Lo más criticado: ${enumerar(r.critican.map(t => NOMBRES_TEMAS[t] || t))}.`));
            }

            // Tendencia: lectores ganados (o perdidos) en los últimos días
            const tendencia = tendenciaDe(o);
            if (tendencia && Number.isFinite(tendencia.lectores)){
                const v = tendencia.lectores;
                const dias = Number.isFinite(tendencia.dias) ? tendencia.dias : 7;
                nodos.push(crear('p', 'dato-opinion', Math.abs(v) < 0.0005
                    ? `Los mismos lectores que hace ${dias} días.`
                    : `${v > 0 ? '+' : '−'}${formatoPorcentaje.format(Math.abs(v))} de lectores en los últimos ${dias} días.`));
            }

            // Puntaje en cada comunidad (de la última vez que se renovó la obra)
            const lista = crear('ul', 'por-fuente');
            Object.entries(c.fuentes || {}).forEach(([fuente, datos]) => {
                if (!datos || !Number.isFinite(datos.puntaje)) return;
                const li = document.createElement('li');
                li.append(crear('span', null, NOMBRES_FUENTES[fuente] || fuente), crear('strong', null, textoPuntaje(datos.puntaje)),
                    crear('span', 'votos', `${formatoLectores.format(datos.votos)} votos`));
                lista.append(li);
            });
            if (lista.children.length) nodos.push(lista);

            // La fecha en que se renovó esta obra por completo (con los niveles, cada una tiene la suya)
            const fechaObra = String(c.revisada || (comunidad && comunidad.generado) || '').slice(0, 10);
            if (fechaObra){
                const nota = crear('p', 'opinion-fecha', `Actualizado el ${textoFecha(fechaObra)}. `);
                const enlace = crear('a', null, 'Cómo se calcula');
                enlace.href = '#sobre';
                nota.append(enlace);
                nodos.push(nota);
            }
        }
        $('fichaComunidad').replaceChildren(...nodos);
    }

    // Si la ficha no bajó (sin conexión, por ejemplo): se avisa con un botón para intentar otra vez
    function avisoSinFicha(o){
        const aviso = crear('p', 'sin-enlaces', 'No se pudo cargar el resto de la ficha. ');
        const boton = crear('button', 'boton-secundario', 'Reintentar');
        boton.type = 'button';
        boton.addEventListener('click', () => {
            pintarComunidad(o, null);
            pintarDondeLeer(o, null);
            completarFicha(o);
        });
        aviso.append(boton);
        return aviso;
    }

    // ---------- Recomendaciones de los lectores ("si te gustó…") ----------
    // «Más de …»: otras obras del catálogo de las mismas personas (lo arma scripts/lista.mjs).
    // Un bloque por grupo; si quien escribe y quien dibuja comparten las mismas obras, van juntos.
    function pintarMismoAutor(o, f){
        const bloque = $('bloqueMismoAutor');
        const grupos = (f && !f.fallo && Array.isArray(f.masDelAutor)) ? f.masDelAutor : [];
        const partes = [];
        for (const g of grupos){
            const otras = (Array.isArray(g.obras) ? g.obras : []).map(id => porId.get(id)).filter(x => x && x.id !== o.id);
            const autores = (Array.isArray(g.autores) ? g.autores : []).filter(Boolean);
            if (!otras.length || !autores.length) continue;
            const lista = crear('ul', 'recomendadas');
            lista.append(...otras.map(obra => {
                const li = document.createElement('li');
                const a = crear('a', 'mini-obra');
                a.href = hashObra(obra.id);
                a.dataset.obra = obra.id;
                const portada = crear('span', 'mini-portada');
                colorDePlaca(portada, obra);
                portada.append(imagenPortada(obra, '54px'));
                const datos = crear('span', 'mini-datos');
                datos.append(etiquetaTipo(obra.tipo));
                if (obra.inicio) datos.append(crear('span', null, obra.inicio.slice(0, 4)));
                const texto = crear('span', 'mini-texto');
                texto.append(crear('span', 'mini-titulo', obra.titulo), datos);
                a.append(portada, texto);
                li.append(a);
                return li;
            }));
            partes.push(crear('h3', null, `Más de ${enumerar(autores)}`), lista);
        }
        bloque.replaceChildren(...partes);
        bloque.hidden = partes.length === 0;
    }

    // ---------- Compartir una obra ----------
    // En el celular abre el menú de compartir del sistema; en el PC copia el enlace y lo avisa.
    // El enlace es el de la obra sola (sin los filtros que tengas puestos).
    let temporizadorCompartir = null;
    function avisarCompartir(texto){
        const aviso = $('avisoCompartir');
        aviso.textContent = texto;
        clearTimeout(temporizadorCompartir);
        if (texto) temporizadorCompartir = setTimeout(() => { aviso.textContent = ''; }, 5000);
    }
    $('fichaCompartir').addEventListener('click', async () => {
        const o = porId.get(fichaAbierta);
        if (!o) return;
        const url = new URL(`${location.pathname}#catalogo?obra=${encodeURIComponent(o.id)}`, location.origin).href;
        if (navigator.share && window.matchMedia('(pointer: coarse)').matches){
            try {
                await navigator.share({ title: `${o.titulo} | Frozen Project`, url });
                return;
            } catch (error){
                if (error && error.name === 'AbortError') return;      // la persona cerró el menú
            }
        }
        try {
            await navigator.clipboard.writeText(url);
            avisarCompartir('Enlace copiado');
        } catch (error){
            avisarCompartir(`No se pudo copiar; el enlace es ${url}`);
        }
    });

    // ---------- Sorpréndeme: una obra al azar entre las que cumplen tus filtros ----------
    // Si entre ellas hay al menos 3 bien valoradas (7,5 o más), sale una de esas.
    // No repite ninguna de las últimas 10.
    const ultimasSorpresas = [];
    $('sorprendeme').addEventListener('click', () => {
        const lista = resultados();
        if (!lista.length) return;
        const buenas = lista.filter(o => (puntaje(o) || 0) >= 75);
        let opciones = buenas.length >= 3 ? buenas : lista;
        const nuevas = opciones.filter(o => !ultimasSorpresas.includes(o.id));
        if (nuevas.length) opciones = nuevas;
        const elegida = opciones[Math.floor(Math.random() * opciones.length)];
        ultimasSorpresas.push(elegida.id);
        if (ultimasSorpresas.length > 10) ultimasSorpresas.shift();
        // Como al tocar una obra: Atrás cierra la ficha y el foco vuelve a este botón
        origenFicha = $('sorprendeme');
        Frozen.navegar(hashCatalogo(estado, elegida.id), { estado: { ficha: true } });
    });

    // ---------- Tecla «/»: lleva al buscador del catálogo ----------
    // No se activa mientras escribes en un campo ni con una ventana abierta.
    document.addEventListener('keydown', e => {
        if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
        const t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        if (document.querySelector('dialog[open]')) return;
        e.preventDefault();
        if (Frozen.ruta().seccion !== 'catalogo') Frozen.navegar(hashCatalogo());
        inputBuscar.focus();
        inputBuscar.select();
    });

    function pintarRecomendadas(o, f){
        const c = f && !f.fallo ? f.comunidad : null;
        const recs = (c && Array.isArray(c.recomendaciones)) ? c.recomendaciones : [];
        const lista = $('fichaRecomendadas');
        $('bloqueRecomendadas').hidden = recs.length === 0;
        lista.replaceChildren(...recs.map(r => {
            const propia = porAniList.get(r.anilist);      // si está en el catálogo, abre su ficha
            const li = document.createElement('li');
            const a = crear('a', 'mini-obra');
            const portada = crear('span', 'mini-portada');
            const datos = crear('span', 'mini-datos');
            const texto = crear('span', 'mini-texto');
            if (propia){
                a.href = hashObra(propia.id);
                a.dataset.obra = propia.id;
                colorDePlaca(portada, propia);
                portada.append(imagenPortada(propia, '54px'));
                texto.append(crear('span', 'mini-titulo', propia.titulo), datos);
                datos.append(etiquetaTipo(propia.tipo), crear('span', null, `${formatoLectores.format(r.votos)} votos`));
            } else {
                a.href = `https://anilist.co/manga/${r.anilist}`;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                if (r.portada) portada.append(imagenPortada({ portada: r.portada }, '54px'));
                texto.append(crear('span', 'mini-titulo', r.titulo), datos);
                datos.append(etiquetaTipo(r.tipo), crear('span', null, `${formatoLectores.format(r.votos)} votos`),
                    crear('span', 'fuera', 'en AniList'));
            }
            a.append(portada, texto);
            li.append(a);
            return li;
        }));
    }

    // ---------- Fichas: lo que no viene en la lista se baja al abrir cada obra ----------
    // datos/fichas/<id>.json (scripts/lista.mjs): fechas, capítulos, dónde leer y la opinión completa.
    // Quedan guardadas mientras la página está abierta, y empiezan a bajar apenas pasas el mouse
    // sobre una obra, la tocas o llegas a ella con el teclado: así casi siempre abren al instante.
    const fichas = new Map();      // id -> promesa con su ficha
    function cargarFicha(id){
        if (!fichas.has(id)){
            const promesa = fetch(`datos/fichas/${encodeURIComponent(id)}.json`, { cache: 'no-cache' })
                .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
            promesa.catch(() => fichas.delete(id));      // si falla, la próxima vez se intenta de nuevo
            fichas.set(id, promesa);
        }
        return fichas.get(id);
    }
    const obraDe = e => {
        const a = e.target && e.target.closest ? e.target.closest('a[data-obra]') : null;
        return a && porId.has(a.dataset.obra) ? a.dataset.obra : null;
    };
    const adelantarFicha = id => { if (id) cargarFicha(id).catch(() => {}); };
    let esperaAdelanto = 0;
    document.addEventListener('pointerover', e => {
        clearTimeout(esperaAdelanto);
        const id = obraDe(e);
        if (id && e.pointerType === 'mouse') esperaAdelanto = setTimeout(() => adelantarFicha(id), 120);
    }, { passive: true });
    document.addEventListener('pointerdown', e => adelantarFicha(obraDe(e)), { passive: true });
    document.addEventListener('focusin', e => adelantarFicha(obraDe(e)));

    // ---------- Ficha de una obra ----------
    function fila(dl, termino, valor){
        if (valor == null || valor === '') return;
        dl.append(crear('dt', null, termino), crear('dd', null, String(valor)));
    }

    function abrirFicha(id){
        const o = porId.get(id);
        if (!o){
            // Enlace a una obra que ya no está: se queda en el catálogo (o en la biblioteca)
            Frozen.navegar(hashSinFicha(), { reemplazar: true });
            return;
        }
        if (fichaAbierta === id && ficha.open) return;
        if (fichaAbierta !== id) avisarFicha('');
        fichaAbierta = id;
        ultimaObra = id;
        pintarBotonesFicha(id);

        const portada = $('fichaPortada');
        portada.style.removeProperty('--color-placa');
        colorDePlaca(portada, o);
        const img = imagenPortada(o, '(max-width: 768px) 104px, 210px');
        img.loading = 'eager';
        img.alt = `Portada de ${o.titulo}`;
        portada.replaceChildren(img);

        $('fichaTitulo').textContent = o.titulo;
        // Otros títulos: el romanizado y el original (este marcado con su idioma, para los lectores de pantalla)
        const igual = (a, b) => a.toLowerCase() === b.toLowerCase();
        const romaji = o.titulos && o.titulos.romaji;
        const nativo = o.titulos && o.titulos.nativo;
        const partes = [];
        if (romaji && !igual(romaji, o.titulo)) partes.push(document.createTextNode(romaji));
        if (nativo && !igual(nativo, o.titulo) && !(romaji && igual(nativo, romaji))){
            const original = crear('span', null, nativo);
            original.lang = IDIOMA_ORIGINAL[o.tipo];
            partes.push(original);
        }
        const otrosTitulos = $('fichaOtrosTitulos');
        otrosTitulos.replaceChildren(...partes.flatMap((p, i) => i ? [' / ', p] : [p]));
        otrosTitulos.hidden = partes.length === 0;

        const etiquetas = [etiquetaTipo(o.tipo)];
        if (ESTADOS[o.estado]) etiquetas.push(crear('span', 'etiqueta-estado', ESTADOS[o.estado]));
        $('fichaEtiquetas').replaceChildren(...etiquetas);

        // Lo que trae la lista se ve al instante; lo demás llega con la ficha de la obra
        pintarDatos(o, null);
        pintarComunidad(o, null);
        pintarDondeLeer(o, null);
        pintarMismoAutor(o, null);
        pintarRecomendadas(o, null);
        avisarCompartir('');

        $('fichaAniList').href = `https://anilist.co/manga/${o.ids.anilist}`;

        if (!ficha.open){
            ficha.showModal();
            document.body.classList.add('ficha-abierta');
        }
        ficha.scrollTop = 0;
        Frozen.cambiarTitulo(o.titulo);
        completarFicha(o);
    }

    // Cuando llega la ficha (si sigue abierta la misma obra), se completa todo
    async function completarFicha(o){
        let f;
        try { f = await cargarFicha(o.id); }
        catch (error){ f = { fallo: true }; }
        if (fichaAbierta !== o.id || !ficha.open) return;
        pintarDatos(o, f.fallo ? null : f);
        pintarComunidad(o, f);
        pintarDondeLeer(o, f);
        pintarMismoAutor(o, f);
        pintarRecomendadas(o, f);
    }

    // Quién la creó: "Tatsuki Fujimoto", o con lo que hizo cada uno si son varios
    // ("Chugong (historia original) y DUBU (arte)"). El nombre no se corta entre dos líneas,
    // lo que hizo va en un tono más suave y el nombre original aparece al pasar el mouse.
    function textoAutores(autores){
        const solo = autores.length === 1 && autores[0].rol === 'historia y arte';
        const partes = [];
        autores.forEach((a, i) => {
            if (i) partes.push(document.createTextNode(i === autores.length - 1 ? ' y ' : ', '));
            const nombre = crear('span', 'autor', a.nombre);
            if (a.nativo) nombre.title = a.nativo;
            partes.push(nombre);
            if (!solo && a.rol) partes.push(document.createTextNode(' '), crear('span', 'autor-rol', `(${a.rol})`));
        });
        return partes;
    }

    // Quién la creó, fechas, capítulos, tomos, géneros y etiquetas (los autores, el fin, los capítulos
    // y los tomos vienen en la ficha)
    function pintarDatos(o, f){
        const dl = $('fichaDatos');
        dl.replaceChildren();
        if (f && Array.isArray(f.autores) && f.autores.length){
            const dd = document.createElement('dd');
            dd.append(...textoAutores(f.autores));
            dl.append(crear('dt', null, 'Creado por'), dd);
        }
        fila(dl, 'Salió', textoFecha(o.inicio));
        if (f && f.fin) fila(dl, 'Terminó', textoFecha(f.fin));
        // Capítulos y tomos: los de AniList si ya terminó; si sigue saliendo, los publicados
        // hasta ahora según MangaUpdates (los actualiza la tarea de lunes a viernes)
        const c = (f && f.comunidad) || {};
        const publicados = c.publicados || {};
        const hastaAhora = o.estado === 'terminado' ? '' : ' hasta ahora';
        const numero = n => formatoNumero.format(n);
        if (f){
            if (f.capitulos) fila(dl, 'Capítulos', numero(f.capitulos));
            else if (publicados.ultimo) fila(dl, 'Capítulos', numero(publicados.ultimo) + hastaAhora);
            if (f.tomos) fila(dl, 'Tomos', numero(f.tomos));
            else if (publicados.tomos) fila(dl, 'Tomos', numero(publicados.tomos) + hastaAhora);
        }
        fila(dl, 'Géneros', o.generos.map(g => GENEROS[g]).filter(Boolean).join(', '));

        // Etiquetas votadas por los lectores: cada una lleva al catálogo filtrado por ella
        // (con su porcentaje de acuerdo cuando llega la ficha; mientras tanto, solo sus nombres)
        const etiquetasObra = (Array.isArray(c.etiquetas) ? c.etiquetas : etiquetasDe(o)).slice(0, 8);
        if (etiquetasObra.length){
            const lista = crear('ul', 'etiquetas-votadas');
            etiquetasObra.forEach(e => {
                const li = document.createElement('li');
                const a = document.createElement('a');
                a.href = hashCatalogo({ tipo: '', generos: [], orden: estado.orden, etiqueta: e.id });
                const nombre = crear('span', null, e.nombre);
                if (e.en) nombre.lang = 'en';
                a.append(nombre);
                if (Number.isFinite(e.voto)) a.append(crear('span', 'voto', `${e.voto} %`));
                li.append(a);
                lista.append(li);
            });
            const dd = document.createElement('dd');
            dd.append(lista);
            dl.append(crear('dt', null, 'Etiquetas'), dd);
        }
    }

    // Dónde leer: solo lugares oficiales, agrupados por idioma
    function pintarDondeLeer(o, f){
        const dondeLeer = $('fichaDondeLeer');
        if (!f){
            dondeLeer.replaceChildren(crear('p', 'sin-enlaces', 'Cargando dónde leerla…'));
            return;
        }
        if (f.fallo){
            dondeLeer.replaceChildren(crear('p', 'sin-enlaces', 'No se pudo cargar dónde leerla.'));
            return;
        }
        const enlaces = (f.enlaces || []).map(e => ({ ...e, tipo: e.tipo || 'leer' }));
        // El idioma original solo se muestra si no hay dónde leerla en español o en inglés
        const hayTraduccion = enlaces.some(e => e.tipo === 'leer');
        const grupos = GRUPOS_LECTURA.map(g => ({ ...g, enlaces: enlaces.filter(g.cumple) }))
            .filter(g => g.enlaces.length && !(hayTraduccion && g.titulo === 'En su idioma original'));
        if (grupos.length){
            dondeLeer.replaceChildren(...grupos.map(g => {
                const bloque = crear('div', 'grupo-lectura');
                const lista = crear('ul', 'donde-leer');
                g.enlaces.forEach(e => {
                    const li = document.createElement('li');
                    const a = crear('a', null, e.sitio);
                    a.href = e.url;
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                    if (g.conIdioma && IDIOMAS[e.idioma]) a.append(crear('span', 'idioma', `(${IDIOMAS[e.idioma]})`));
                    li.append(a);
                    lista.append(li);
                });
                bloque.append(crear('h4', null, g.titulo), lista);
                return bloque;
            }));
        } else {
            dondeLeer.replaceChildren(crear('p', 'sin-enlaces', 'No encontramos dónde leerla oficialmente.'));
        }
        // Si solo hay sitios en el idioma original, se avisa antes de mostrarlos
        if (grupos.length && grupos.every(g => g.titulo === 'En su idioma original')){
            dondeLeer.prepend(crear('p', 'sin-enlaces', 'No encontramos una edición oficial en español ni en inglés.'));
        }
    }

    // Cierra la ficha porque cambió la dirección (Atrás, otro apartado...)
    function cerrarFichaPorRuta(){
        fichaAbierta = null;
        if (ficha.open){
            ignorarCierre = true;
            ficha.close();
        }
        document.body.classList.remove('ficha-abierta');
    }

    // La persona cerró la ficha (×, Esc o tocando afuera): la dirección vuelve a como estaba.
    // El aviso "close" llega un instante después; si para entonces la ficha ya se volvió
    // a abrir (Atrás y Adelante muy rápido), no se toca nada.
    ficha.addEventListener('close', () => {
        const porRuta = ignorarCierre;
        ignorarCierre = false;
        if (ficha.open) return;
        document.body.classList.remove('ficha-abierta');
        fichaAbierta = null;
        if (porRuta) return;
        if (!Frozen.ruta().params.has('obra')) return;
        if (history.state && history.state.ficha) volverAtras();
        else Frozen.navegar(hashSinFicha(), { reemplazar: true });
    });

    $('fichaCerrar').addEventListener('click', () => ficha.close());
    ficha.addEventListener('click', e => { if (e.target === ficha) ficha.close(); });

    // ---------- Seguir la dirección ----------
    function aplicarRuta(ruta){
        if (!datosListos) return;
        const obra = ruta.params.get('obra');
        if (ruta.seccion === 'catalogo'){
            estado = estadoDesdeParams(ruta.params);
            pintar();
        } else if (ruta.seccion === 'biblioteca'){
            vistaBib = vistaDesdeParams(ruta.params);
            pintarBiblioteca();
        }
        if (obra && (ruta.seccion === 'catalogo' || ruta.seccion === 'biblioteca')) abrirFicha(obra);
        else cerrarFichaPorRuta();
        // Al cerrar una ficha, el foco regresa a la portada que la abrió (o, si llegaste
        // directo a la ficha con un enlace, a esa misma obra en el catálogo o la biblioteca)
        if (!obra && ultimaObra){
            const visible = el => el && el.isConnected && el.offsetParent !== null;
            const tarjeta = ruta.seccion === 'biblioteca' ? tarjetasBib.get(ultimaObra) : tarjetas.get(ultimaObra);
            if (visible(origenFicha)) origenFicha.focus({ preventScroll: true });
            else if (tarjeta && visible(tarjeta.a)) tarjeta.a.focus();
            else if (ruta.seccion === 'biblioteca') $('tituloBiblioteca').focus({ preventScroll: true });
            origenFicha = null;
            ultimaObra = null;
        }
        terminarDeVolver();
    }

    window.addEventListener('frozen:ruta', e => aplicarRuta(e.detail));

    // Abrir una ficha deja una entrada en el historial: Atrás la cierra
    function alTocarObra(e){
        const a = e.target.closest('a[data-obra]');
        if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        if (volviendo) return;          // la ficha anterior todavía se está cerrando
        origenFicha = a;
        Frozen.navegar(a.getAttribute('href'), { estado: { ficha: true } });
    }
    rejilla.addEventListener('click', alTocarObra);
    rejillaBib.addEventListener('click', alTocarObra);
    $('listaPopulares').addEventListener('click', alTocarObra);
    $('fichaRecomendadas').addEventListener('click', alTocarObra);
    $('bloqueMismoAutor').addEventListener('click', alTocarObra);
    $('quitarEtiqueta').addEventListener('click', quitarEtiqueta);

    // ---------- Controles ----------
    $('filtroPublicacion').addEventListener('change', e => {
        if (e.target.name === 'publicacion') cambiarEstado({ publicacion: e.target.value });
    });
    $('filtroEspanol').addEventListener('click', () => cambiarEstado({ espanol: !estado.espanol }));
    $('filtroAnio').addEventListener('change', e => cambiarEstado({ anio: e.target.value }));
    listaOcultar.addEventListener('change', () => {
        cambiarEstado({ sin: [...listaOcultar.querySelectorAll('input:checked')].map(i => i.value) });
    });

    $('filtroTipo').addEventListener('change', e => {
        if (e.target.name === 'tipo') cambiarEstado({ tipo: e.target.value });
    });

    selectOrden.addEventListener('change', () => cambiarEstado({ orden: selectOrden.value }));

    // Buscador: filtra mientras escribes (con una pausa corta para no repintar en cada letra)
    const textoBuscado = () => inputBuscar.value.replace(/\s+/g, ' ').trim().slice(0, MAX_BUSQUEDA);
    inputBuscar.addEventListener('input', () => {
        clearTimeout(esperaBusqueda);
        esperaBusqueda = setTimeout(() => {
            if (textoBuscado() !== estado.q) cambiarEstado({ q: textoBuscado() });
        }, 150);
    });
    inputBuscar.addEventListener('keydown', e => {
        if (e.key === 'Enter'){
            clearTimeout(esperaBusqueda);
            if (textoBuscado() !== estado.q) cambiarEstado({ q: textoBuscado() });
            // En el celular se cierra el teclado para ver los resultados
            if (window.matchMedia('(pointer: coarse)').matches) inputBuscar.blur();
        } else if (e.key === 'Escape' && inputBuscar.value){
            e.preventDefault();
            borrarBusqueda();
        }
    });
    // Atajo: "/" lleva al buscador cuando estás en el catálogo
    document.addEventListener('keydown', e => {
        if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || ficha.open) return;
        if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
        if (Frozen.ruta().seccion !== 'catalogo') return;
        e.preventDefault();
        inputBuscar.focus();
        inputBuscar.select();
    });

    zonaGeneros.addEventListener('click', e => {
        const boton = e.target.closest('.chip');
        if (!boton || boton.disabled) return;
        const g = boton.dataset.genero;
        const generos = estado.generos.includes(g)
            ? estado.generos.filter(x => x !== g)
            : [...estado.generos, g];
        cambiarEstado({ generos });
    });

    quitarGeneros.addEventListener('click', quitarTodosLosGeneros);

    function abrirGeneros(abrir){
        filtros.classList.toggle('generos-abiertos', abrir);
        botonGeneros.setAttribute('aria-expanded', String(abrir));
    }
    botonGeneros.addEventListener('click', () => abrirGeneros(!filtros.classList.contains('generos-abiertos')));

    // ---------- Cargar los datos ----------
    function mostrarError(){
        const li = crear('li', 'estado-lista');
        li.append(crear('strong', null, 'No se pudo cargar el catálogo.'), crear('span', null, 'Revisa tu conexión y vuelve a intentarlo.'), document.createElement('br'));
        const boton = crear('button', 'boton-secundario', 'Reintentar');
        boton.type = 'button';
        boton.addEventListener('click', cargar);
        li.append(boton);
        rejilla.replaceChildren(li);
        conteo.textContent = '';
        const enBib = li.cloneNode(true);
        enBib.querySelector('button').addEventListener('click', cargar);
        rejillaBib.replaceChildren(enBib);
    }

    async function cargar(){
        rejilla.replaceChildren(crear('li', 'estado-lista', 'Cargando el catálogo…'));
        try {
            const [respuesta, datosPopulares] = await Promise.all([fetch('datos/lista.json', { cache: 'no-cache' }), cargarPopulares()]);
            if (!respuesta.ok) throw new Error('HTTP ' + respuesta.status);
            const datos = await respuesta.json();
            comunidad = datos.comunidad || null;
            diario = leerDiario(datosPopulares, comunidad);
            // Las portadas vienen sin el principio de la dirección (es igual en todas): se completa aquí
            const prefijo = typeof datos.portadas === 'string' ? datos.portadas : '';
            obras = (datos.obras || [])
                .map(o => (o && typeof o.portada === 'string' && !/^https?:\/\//.test(o.portada)) ? { ...o, portada: prefijo + o.portada } : o)
                .filter(o => o && o.id && o.titulo && o.portada && TIPOS[o.tipo] && Array.isArray(o.generos));
            porId = new Map(obras.map(o => [o.id, o]));
            porAniList = new Map(obras.filter(o => o.ids && o.ids.anilist).map(o => [o.ids.anilist, o]));
            etiquetasConocidas = new Map(Object.entries(datos.etiquetas || {}).map(([id, e]) => [id, { nombre: (e && e.nombre) || id, en: Boolean(e && e.en) }]));
            puestoPopularidad = new Map([...obras].sort(ORDENES.populares).map((o, i) => [o.id, i + 1]));
            construirTarjetas();
            construirIndiceBusqueda();
            construirChips();
            construirChipsBiblioteca();
            pintarPopulares(datosPopulares);
            pintarFechaDatos(datos.actualizado);
            datosListos = true;

            const ruta = Frozen.ruta();
            // Si llegas con géneros elegidos (por ejemplo desde un enlace), en celular se ven desplegados
            if (ruta.seccion === 'catalogo' && estadoDesdeParams(ruta.params).generos.length) abrirGeneros(true);
            aplicarRuta(ruta);
        } catch (error){
            mostrarError();
        }
    }

    construirBotonesFicha();
    cargar();
})();
