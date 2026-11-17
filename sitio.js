/* ===================================
   FROZEN PROJECT: apartados y video de fondo
   Cada apartado tiene su dirección (#inicio, #catalogo, #biblioteca, #sobre), así se
   pueden compartir enlaces directos y el botón Atrás del celular funciona.
   catalogo.js escucha el evento "frozen:ruta" para pintar el catálogo y la biblioteca.
=================================== */
(() => {
    const NOMBRE_SITIO = 'Frozen Project';
    const SECCIONES = { inicio: 'Inicio', catalogo: 'Catálogo', biblioteca: 'Mi biblioteca', sobre: 'Sobre el sitio' };

    const secciones = document.querySelectorAll('main > .seccion');
    const enlacesMenu = document.querySelectorAll('.nav-link');
    const videoFondo = document.getElementById('fondoVideo');
    const esCelular = window.matchMedia('(max-width: 768px)');
    const reducirMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let actual = null;   // apartado visible ahora

    // "#catalogo?tipo=manhwa" -> { seccion: 'catalogo', params: tipo=manhwa }
    // Sin dirección es Inicio; una dirección desconocida no es un apartado (seccion: null).
    function leerRuta(){
        const [nombre, consulta = ''] = location.hash.slice(1).split('?');
        let seccion = null;
        if (!nombre) seccion = 'inicio';
        else if (Object.prototype.hasOwnProperty.call(SECCIONES, nombre)) seccion = nombre;
        return { seccion, params: new URLSearchParams(consulta) };
    }

    function tituloDePagina(seccion){
        return seccion === 'inicio'
            ? `${NOMBRE_SITIO} | Reseñas de manga, manhwa y manhua`
            : `${SECCIONES[seccion]} | ${NOMBRE_SITIO}`;
    }

    function mostrar(seccion, { enfocar = false } = {}){
        const cambia = seccion !== actual;
        actual = seccion;

        secciones.forEach(s => {
            const visible = s.dataset.seccion === seccion;
            s.hidden = !visible;
            if (visible && cambia){
                s.classList.remove('entra');
                void s.offsetWidth;          // reinicia la animación de entrada
                s.classList.add('entra');
            }
        });

        enlacesMenu.forEach(a => {
            if (a.dataset.seccion === seccion) a.setAttribute('aria-current', 'page');
            else a.removeAttribute('aria-current');
        });

        // Video nítido solo en Inicio; difuminado en los demás apartados
        document.body.classList.toggle('difuminado', seccion !== 'inicio');

        // En celular el video se pausa mientras está difuminado: casi no se nota
        // el movimiento y así no se recalcula el desenfoque en cada cuadro
        if (esCelular.matches && !reducirMovimiento){
            if (seccion === 'inicio') videoFondo.play().catch(() => {});
            else videoFondo.pause();
        }

        document.title = tituloDePagina(seccion);

        if (cambia){
            window.scrollTo(0, 0);
            // Para lectores de pantalla y teclado: el foco va al título del apartado nuevo
            if (enfocar){
                const titulo = document.querySelector(`.seccion[data-seccion="${seccion}"] h2`);
                if (titulo) titulo.focus({ preventScroll: true });
            }
        }
    }

    function alCambiarRuta(inicial = false){
        const ruta = leerRuta();
        if (!ruta.seccion){
            if (!inicial) return;            // p. ej. un enlace interno que no es apartado
            ruta.seccion = 'inicio';         // enlaces viejos como #contenido abren Inicio
        }
        mostrar(ruta.seccion, { enfocar: !inicial });
        window.dispatchEvent(new CustomEvent('frozen:ruta', { detail: ruta }));
    }

    // Lo que usa catalogo.js
    window.Frozen = {
        // Apartado y parámetros actuales
        ruta(){
            const r = leerRuta();
            if (!r.seccion) r.seccion = actual || 'inicio';
            return r;
        },
        // Cambia la dirección sin recargar. "reemplazar" no deja una entrada nueva en el historial
        // (para los filtros); sin él, el botón Atrás vuelve al estado anterior (para abrir una ficha).
        navegar(hash, { reemplazar = false, estado = null } = {}){
            if (reemplazar) history.replaceState(estado, '', hash);
            else history.pushState(estado, '', hash);
            alCambiarRuta();
        },
        cambiarTitulo(texto){
            document.title = texto ? `${texto} | ${NOMBRE_SITIO}` : tituloDePagina(actual);
        }
    };

    window.addEventListener('hashchange', () => alCambiarRuta());

    // ===== VIDEO DE FONDO =====
    // El video empieza justo debajo del menú para que el halo no quede tapado
    const cabecera = document.querySelector('header');
    const menu = document.querySelector('nav');
    function ajustarAltoCabecera(){
        const alto = cabecera.offsetHeight + menu.offsetHeight;
        document.documentElement.style.setProperty('--alto-cabecera', alto + 'px');
    }
    ajustarAltoCabecera();
    window.addEventListener('resize', ajustarAltoCabecera);
    window.addEventListener('load', ajustarAltoCabecera);
    if (document.fonts) document.fonts.ready.then(ajustarAltoCabecera);

    // Respeta a quien prefiere menos movimiento: deja el video quieto
    if (reducirMovimiento) videoFondo.pause();

    // Si el video arranca solo (autoplay) mientras se ve otro apartado en el celular, se detiene
    videoFondo.addEventListener('play', () => {
        if ((esCelular.matches && actual !== 'inicio') || reducirMovimiento) videoFondo.pause();
    });

    if (esCelular.matches){
        // Navegadores que ignoran media="" en <source>: forzar la versión de celular
        const asegurarVideoMovil = () => {
            if (!videoFondo.currentSrc.includes('fondo-movil')){
                videoFondo.src = 'Video/fondo-movil.mp4';
                if (!reducirMovimiento && actual === 'inicio') videoFondo.play().catch(() => {});
            }
        };
        if (videoFondo.readyState > 0) asegurarVideoMovil();
        else videoFondo.addEventListener('loadedmetadata', asegurarVideoMovil, { once: true });

        // Pausa el video si la pestaña queda en segundo plano (ahorra batería)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) videoFondo.pause();
            else if (actual === 'inicio' && !reducirMovimiento) videoFondo.play().catch(() => {});
        });
    }

    alCambiarRuta(true);
})();
