/* ===================================
   FROZEN PROJECT: catálogo de obras
   Lee obras.json (datos de AniList), arma los filtros por tipo y género,
   ordena por popularidad, puntaje o fecha de salida, y abre la ficha de
   cada obra. Los filtros viven en la dirección de la página, por ejemplo
   #catalogo?tipo=manhwa&generos=accion,fantasia&orden=fecha-desc
   así un enlace compartido abre el catálogo tal como lo dejaste.
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
    const IDIOMAS = { es: 'español', en: 'inglés' };
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

    // Opinión de la comunidad: datos/comunidad.json, que genera cada lunes la tarea de GitHub
    // (scripts/comunidad.mjs). Si todavía no existe o le falta una obra, se usa AniList de obras.json.
    let comunidad = null;
    const deComunidad = o => (comunidad && comunidad.obras && comunidad.obras[String(o.ids && o.ids.anilist)]) || null;
    const popularidad = o => {
        const c = deComunidad(o);
        return (c && c.popularidad) || (o.comunidad && o.comunidad.anilist && o.comunidad.anilist.popularidad) || 0;
    };
    const puntaje = o => {
        const c = deComunidad(o);
        if (c && c.puntaje && Number.isFinite(c.puntaje.valor)) return c.puntaje.valor;
        return (o.comunidad && o.comunidad.anilist && o.comunidad.anilist.puntaje) || null;
    };
    const claveFecha = o => o.inicio ? (o.inicio + '-00-00').slice(0, 10) : '0000-00-00';

    const ORDENES = {
        'populares': (a, b) => popularidad(b) - popularidad(a),
        'valorados': (a, b) => (puntaje(b) || 0) - (puntaje(a) || 0) || popularidad(b) - popularidad(a),
        'fecha-desc': (a, b) => claveFecha(b).localeCompare(claveFecha(a)) || popularidad(b) - popularidad(a),
        'fecha-asc': (a, b) => claveFecha(a).localeCompare(claveFecha(b)) || popularidad(b) - popularidad(a)
    };
    const ORDEN_INICIAL = 'populares';

    const formatoLectores = new Intl.NumberFormat('es', { notation: 'compact' });   // 337640 -> "338 mil"
    const formatoPuntaje = new Intl.NumberFormat('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

    const $ = id => document.getElementById(id);
    const rejilla = $('rejilla');
    const conteo = $('conteo');
    const filtros = $('filtros');
    const zonaGeneros = $('zonaGeneros');
    const quitarGeneros = $('quitarGeneros');
    const botonGeneros = $('botonGeneros');
    const cuentaGeneros = $('cuentaGeneros');
    const selectOrden = $('orden');
    const ficha = $('ficha');
    const enlaceMenuCatalogo = document.querySelector('.nav-link[data-seccion="catalogo"]');
    const botonExplorar = document.querySelector('.inicio-texto .boton-principal');

    let obras = [];
    let porId = new Map();
    let puestoPopularidad = new Map();
    let datosListos = false;
    let estado = { tipo: '', generos: [], orden: ORDEN_INICIAL };
    let tarjetas = new Map();      // id -> { li, a, datos }
    let chips = new Map();         // género -> { boton, cuenta }
    let ordenPintado = '';         // ids en pantalla, para no mover tarjetas sin necesidad
    let fichaAbierta = null;
    let ignorarCierre = false;
    let origenFicha = null;        // elemento que abrió la ficha, para devolverle el foco
    let ultimaObra = null;         // obra de la última ficha abierta (por si no hay elemento de origen)
    let volviendo = false;         // la ficha se cerró con history.back() y el navegador aún no vuelve
    let cambioPendiente = null;    // filtro tocado justo en ese momento: se aplica al terminar de volver
    let esperaVolver = 0;

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

    // ---------- Estado <-> dirección ----------
    function estadoDesdeParams(params){
        const tipo = Object.prototype.hasOwnProperty.call(TIPOS, params.get('tipo')) ? params.get('tipo') : '';
        const generos = [...new Set((params.get('generos') || '').split(',').filter(g => Object.prototype.hasOwnProperty.call(GENEROS, g)))];
        const orden = Object.prototype.hasOwnProperty.call(ORDENES, params.get('orden')) ? params.get('orden') : ORDEN_INICIAL;
        return { tipo, generos, orden };
    }

    function hashCatalogo(e = estado, obra = null){
        const partes = [];
        if (e.tipo) partes.push('tipo=' + e.tipo);
        if (e.generos.length) partes.push('generos=' + e.generos.join(','));
        if (e.orden !== ORDEN_INICIAL) partes.push('orden=' + e.orden);
        if (obra) partes.push('obra=' + encodeURIComponent(obra));
        return '#catalogo' + (partes.length ? '?' + partes.join('&') : '');
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
    }

    // ---------- Filtrar y ordenar ----------
    const cumpleTipo = (o, tipo) => !tipo || o.tipo === tipo;
    const tieneGeneros = (o, generos) => generos.every(g => o.generos.includes(g));

    function resultados(){
        return obras
            .filter(o => cumpleTipo(o, estado.tipo) && tieneGeneros(o, estado.generos))
            .sort((a, b) => ORDENES[estado.orden](a, b) || a.titulo.localeCompare(b.titulo, 'es'));
    }

    // ---------- Construir una vez ----------
    function construirTarjetas(){
        tarjetas = new Map(obras.map(o => {
            const li = document.createElement('li');
            const a = crear('a', 'obra');
            a.dataset.obra = o.id;
            const portada = crear('div', 'obra-portada');
            colorDePlaca(portada, o);
            portada.append(imagenPortada(o, '(max-width: 768px) 46vw, 190px'), etiquetaTipo(o.tipo));
            const datos = crear('span', 'obra-datos');
            a.append(portada, crear('span', 'obra-titulo', o.titulo), datos);
            li.append(a);
            return [o.id, { li, a, datos }];
        }));
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
    }

    // ---------- Pintar ----------
    function pintarFiltros(){
        document.querySelectorAll('#filtroTipo input').forEach(i => { i.checked = i.value === estado.tipo; });
        selectOrden.value = estado.orden;

        // Cada género dice cuántas obras quedarían si lo sumas a lo que ya elegiste
        const base = obras.filter(o => cumpleTipo(o, estado.tipo) && tieneGeneros(o, estado.generos));
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
        quitarGeneros.hidden = estado.generos.length === 0;
        cuentaGeneros.textContent = estado.generos.length ? `(${estado.generos.length})` : '';
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
            else { const p = datoPuntaje(o); if (p) datos.push(p); }
            t.datos.replaceChildren(...datos);
        });
        // Solo se mueven las tarjetas si cambió la lista (así no se pierde el foco ni se recargan portadas)
        const ids = lista.map(o => o.id).join('|');
        if (ids !== ordenPintado){
            rejilla.replaceChildren(...lista.map(o => tarjetas.get(o.id).li));
            ordenPintado = ids;
        }
    }

    function estadoVacio(){
        const li = crear('li', 'estado-lista');
        const quien = estado.tipo ? `Ningún ${TIPOS[estado.tipo].toLowerCase()}` : 'Ninguna obra';
        li.append(crear('strong', null, `${quien} tiene todos esos géneros.`), crear('span', null, 'Quita algún género o cambia el tipo.'));
        const boton = crear('button', 'boton-secundario', 'Quitar géneros');
        boton.type = 'button';
        boton.addEventListener('click', quitarTodosLosGeneros);
        li.append(document.createElement('br'), boton);
        return li;
    }

    function pintarConteo(n){
        const total = obras.length;
        conteo.textContent = n === total ? `${total} obras` : `${n} de ${total} obras`;
    }

    function pintar(){
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

    function pintarPopulares(){
        const elegidas = Object.keys(TIPOS).flatMap(tipo =>
            obras.filter(o => o.tipo === tipo).sort(ORDENES.populares).slice(0, 2));
        if (!elegidas.length) return;
        $('listaPopulares').replaceChildren(...elegidas.map(o => {
            const li = document.createElement('li');
            const a = crear('a', 'mini-obra');
            a.href = hashCatalogo({ tipo: '', generos: [], orden: ORDEN_INICIAL }, o.id);
            a.dataset.obra = o.id;
            const portada = crear('span', 'mini-portada');
            colorDePlaca(portada, o);
            portada.append(imagenPortada(o, '(max-width: 1279px) 96px, 54px'));
            const texto = crear('span', 'mini-texto');
            const datos = crear('span', 'mini-datos');
            datos.append(etiquetaTipo(o.tipo), crear('span', 'lectores', textoLectores(popularidad(o))));
            texto.append(crear('span', 'mini-titulo', o.titulo), datos);
            a.append(portada, texto);
            li.append(a);
            return li;
        }));
        $('inicioPopulares').hidden = false;
    }

    function pintarFechaDatos(fecha){
        let texto = fecha ? `Catálogo con datos de AniList del ${textoFecha(fecha)}.` : 'Catálogo con datos de AniList.';
        if (comunidad && comunidad.generado){
            const nombres = Object.entries(comunidad.fuentes || {}).filter(([, f]) => f).map(([n]) => NOMBRES_FUENTES[n]).filter(Boolean);
            texto += ` Opinión de la comunidad (${enumerar(nombres)}) actualizada el ${textoFecha(comunidad.generado.slice(0, 10))}; se renueva cada lunes.`;
        }
        $('fechaDatos').textContent = texto;
        const enlace = crear('a', null, 'Cómo se calcula');
        enlace.href = '#sobre';
        $('notaDatos').replaceChildren(texto + ' ', enlace);
    }

    // ---------- Lo que opina la comunidad (dentro de la ficha) ----------
    const formatoPorcentaje = new Intl.NumberFormat('es', { style: 'percent', maximumFractionDigits: 1 });

    function pintarComunidad(o){
        const c = deComunidad(o);
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
        if (c && c.puntaje){
            const nombres = Object.keys(c.fuentes || {}).map(f => NOMBRES_FUENTES[f]).filter(Boolean);
            explicacion.append(`Combinado de ${enumerar(nombres)}.`, document.createElement('br'),
                `${formatoLectores.format(c.puntaje.votos)} votos. Confianza ${c.puntaje.confianza}.`);
        } else {
            explicacion.append(p == null ? 'Todavía no tiene puntaje.' : 'Promedio de los lectores de AniList.');
        }
        explicacion.append(document.createElement('br'),
            `${formatoLectores.format(popularidad(o))} la tienen en su lista de AniList (puesto ${puestoPopularidad.get(o.id)} de ${obras.length} en popularidad).`);
        fila.append(explicacion);
        nodos.push(fila);

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

            // Tendencia frente a la semana anterior
            if (c.tendencia && Number.isFinite(c.tendencia.lectores)){
                const v = c.tendencia.lectores;
                nodos.push(crear('p', 'dato-opinion', Math.abs(v) < 0.0005
                    ? 'Los mismos lectores que la semana pasada.'
                    : `${v > 0 ? '+' : '−'}${formatoPorcentaje.format(Math.abs(v))} de lectores frente a la semana pasada.`));
            }

            // Puntaje en cada comunidad
            const lista = crear('ul', 'por-fuente');
            Object.entries(c.fuentes || {}).forEach(([f, datos]) => {
                if (!datos || !Number.isFinite(datos.puntaje)) return;
                const li = document.createElement('li');
                li.append(crear('span', null, NOMBRES_FUENTES[f] || f), crear('strong', null, textoPuntaje(datos.puntaje)),
                    crear('span', 'votos', `${formatoLectores.format(datos.votos)} votos`));
                lista.append(li);
            });
            if (lista.children.length) nodos.push(lista);

            if (comunidad.generado){
                const nota = crear('p', 'opinion-fecha', `Actualizado el ${textoFecha(comunidad.generado.slice(0, 10))}. `);
                const enlace = crear('a', null, 'Cómo se calcula');
                enlace.href = '#sobre';
                nota.append(enlace);
                nodos.push(nota);
            }
        }
        $('fichaComunidad').replaceChildren(...nodos);
    }

    async function cargarComunidad(){
        try {
            const r = await fetch('datos/comunidad.json', { cache: 'no-cache' });
            if (!r.ok) return null;
            const d = await r.json();
            return d && d.obras ? d : null;
        } catch (error){
            return null;     // sin la opinión de la comunidad, la página sigue con los datos de AniList
        }
    }

    // ---------- Ficha de una obra ----------
    function fila(dl, termino, valor){
        if (valor == null || valor === '') return;
        dl.append(crear('dt', null, termino), crear('dd', null, String(valor)));
    }

    function abrirFicha(id){
        const o = porId.get(id);
        if (!o){
            // Enlace a una obra que ya no está: se queda en el catálogo
            Frozen.navegar(hashCatalogo(), { reemplazar: true });
            return;
        }
        if (fichaAbierta === id && ficha.open) return;
        fichaAbierta = id;
        ultimaObra = id;

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

        const dl = $('fichaDatos');
        dl.replaceChildren();
        fila(dl, 'Salió', textoFecha(o.inicio));
        if (o.fin) fila(dl, 'Terminó', textoFecha(o.fin));
        fila(dl, 'Capítulos', o.capitulos);
        fila(dl, 'Tomos', o.tomos);
        fila(dl, 'Géneros', o.generos.map(g => GENEROS[g]).filter(Boolean).join(', '));

        pintarComunidad(o);

        const dondeLeer = $('fichaDondeLeer');
        if (o.enlaces && o.enlaces.length){
            const lista = crear('ul', 'donde-leer');
            o.enlaces.forEach(e => {
                const li = document.createElement('li');
                const a = crear('a', null, e.sitio);
                a.href = e.url;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                if (IDIOMAS[e.idioma]) a.append(crear('span', 'idioma', `(${IDIOMAS[e.idioma]})`));
                li.append(a);
                lista.append(li);
            });
            dondeLeer.replaceChildren(lista);
        } else {
            dondeLeer.replaceChildren(crear('p', 'sin-enlaces', 'No encontramos dónde leerla oficialmente en español o inglés.'));
        }

        $('fichaAniList').href = `https://anilist.co/manga/${o.ids.anilist}`;

        if (!ficha.open){
            ficha.showModal();
            document.body.classList.add('ficha-abierta');
        }
        ficha.scrollTop = 0;
        Frozen.cambiarTitulo(o.titulo);
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
        else Frozen.navegar(hashCatalogo(), { reemplazar: true });
    });

    $('fichaCerrar').addEventListener('click', () => ficha.close());
    ficha.addEventListener('click', e => { if (e.target === ficha) ficha.close(); });

    // ---------- Seguir la dirección ----------
    function aplicarRuta(ruta){
        if (!datosListos) return;
        if (ruta.seccion === 'catalogo'){
            estado = estadoDesdeParams(ruta.params);
            pintar();
            const obra = ruta.params.get('obra');
            if (obra) abrirFicha(obra);
            else cerrarFichaPorRuta();
        } else {
            cerrarFichaPorRuta();
        }
        // Al cerrar una ficha, el foco regresa a la portada que la abrió (o, si llegaste
        // directo a la ficha con un enlace, a esa misma obra en el catálogo)
        if (!ruta.params.get('obra') && ultimaObra){
            const visible = el => el && el.isConnected && el.offsetParent !== null;
            const tarjeta = tarjetas.get(ultimaObra);
            if (visible(origenFicha)) origenFicha.focus({ preventScroll: true });
            else if (tarjeta && visible(tarjeta.a)) tarjeta.a.focus();
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
    $('listaPopulares').addEventListener('click', alTocarObra);

    // ---------- Controles ----------
    $('filtroTipo').addEventListener('change', e => {
        if (e.target.name === 'tipo') cambiarEstado({ tipo: e.target.value });
    });

    selectOrden.addEventListener('change', () => cambiarEstado({ orden: selectOrden.value }));

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
    }

    async function cargar(){
        rejilla.replaceChildren(crear('li', 'estado-lista', 'Cargando el catálogo…'));
        try {
            const [respuesta, datosComunidad] = await Promise.all([fetch('obras.json', { cache: 'no-cache' }), cargarComunidad()]);
            if (!respuesta.ok) throw new Error('HTTP ' + respuesta.status);
            const datos = await respuesta.json();
            comunidad = datosComunidad;
            obras = (datos.obras || []).filter(o => o && o.id && o.titulo && o.portada && TIPOS[o.tipo] && Array.isArray(o.generos));
            porId = new Map(obras.map(o => [o.id, o]));
            puestoPopularidad = new Map([...obras].sort(ORDENES.populares).map((o, i) => [o.id, i + 1]));
            construirTarjetas();
            construirChips();
            pintarPopulares();
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

    cargar();
})();
