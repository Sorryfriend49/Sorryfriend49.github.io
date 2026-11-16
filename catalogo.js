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
    const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

    const popularidad = o => (o.comunidad && o.comunidad.anilist && o.comunidad.anilist.popularidad) || 0;
    const puntaje = o => (o.comunidad && o.comunidad.anilist && o.comunidad.anilist.puntaje) || null;
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
        boton.addEventListener('click', () => cambiarEstado({ generos: [] }));
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
        // El menú vuelve al catálogo con los mismos filtros
        enlaceMenuCatalogo.href = hashCatalogo();
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
        const texto = fecha ? `actualizados el ${textoFecha(fecha)}` : 'actualizados periódicamente';
        const nota = (antes) => {
            const enlace = crear('a', null, 'AniList');
            enlace.href = 'https://anilist.co';
            enlace.target = '_blank';
            enlace.rel = 'noopener';
            return [antes, enlace, `, ${texto}.`];
        };
        $('notaDatos').replaceChildren(...nota('Datos de '));
        $('fechaDatos').replaceChildren(...nota('Datos de '));
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

        const portada = $('fichaPortada');
        portada.style.removeProperty('--color-placa');
        colorDePlaca(portada, o);
        const img = imagenPortada(o, '(max-width: 768px) 104px, 210px');
        img.loading = 'eager';
        img.alt = `Portada de ${o.titulo}`;
        portada.replaceChildren(img);

        $('fichaTitulo').textContent = o.titulo;
        const otros = [...new Set([o.titulos && o.titulos.romaji, o.titulos && o.titulos.nativo])]
            .filter(t => t && t !== o.titulo);
        const otrosTitulos = $('fichaOtrosTitulos');
        otrosTitulos.textContent = otros.join(' / ');
        otrosTitulos.hidden = otros.length === 0;

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

        const comunidad = $('fichaComunidad');
        const p = puntaje(o);
        const explicacion = crear('p');
        const puesto = puestoPopularidad.get(o.id);
        explicacion.append(
            p == null ? 'Todavía no tiene puntaje en AniList.' : 'Promedio de los lectores de AniList.',
            document.createElement('br'),
            `${formatoLectores.format(popularidad(o))} la tienen en su lista (puesto ${puesto} de ${obras.length} en popularidad).`
        );
        if (p == null){
            comunidad.replaceChildren(explicacion);
        } else {
            const grande = crear('span', 'puntaje', textoPuntaje(p));
            grande.append(crear('small', null, '/10'));
            comunidad.replaceChildren(grande, explicacion);
        }

        const dondeLeer = $('fichaDondeLeer');
        if (o.enlaces && o.enlaces.length){
            const lista = crear('ul', 'donde-leer');
            o.enlaces.forEach(e => {
                const li = document.createElement('li');
                const a = crear('a', null, e.sitio);
                a.href = e.url;
                a.target = '_blank';
                a.rel = 'noopener';
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

    // La persona cerró la ficha (×, Esc o tocando afuera): la dirección vuelve a como estaba
    ficha.addEventListener('close', () => {
        document.body.classList.remove('ficha-abierta');
        fichaAbierta = null;
        if (ignorarCierre){
            ignorarCierre = false;
            return;
        }
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
        // Al volver de una ficha, el foco regresa a la portada que la abrió
        if (!ruta.params.get('obra') && origenFicha && origenFicha.isConnected){
            const destino = origenFicha;
            origenFicha = null;
            if (destino.offsetParent !== null) destino.focus({ preventScroll: true });
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

    quitarGeneros.addEventListener('click', () => cambiarEstado({ generos: [] }));

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
            const respuesta = await fetch('obras.json', { cache: 'no-cache' });
            if (!respuesta.ok) throw new Error('HTTP ' + respuesta.status);
            const datos = await respuesta.json();
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
