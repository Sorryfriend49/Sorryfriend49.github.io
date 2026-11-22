/* ===================================
   FROZEN PROJECT: tu cuenta (opcional) y la biblioteca en la nube
   Sin cuenta, la biblioteca vive solo en este navegador (biblioteca.js). Si entras con
   Google o Discord, también se guarda en Supabase (una base de datos gratuita) y se
   sincroniza entre tus dispositivos: al entrar, al volver a la pestaña y después de cada
   cambio. Si una obra cambió en dos lados, gana el cambio más reciente.
   Para no hacer más pesada la página, la librería de Supabase (vendor/supabase.js) y el
   botón de Google solo se descargan cuando hacen falta: al abrir "Entrar" o si ya hay una
   sesión iniciada en este navegador.
   Las claves de aquí son públicas a propósito (están hechas para ir en la página): los datos
   los protegen las reglas de la base, donde cada usuario solo ve y cambia lo suyo
   (ver supabase/esquema.sql).
=================================== */
(() => {
    const SUPABASE_URL = 'https://jbujqndemyxxnxznhvqe.supabase.co';
    const SUPABASE_CLAVE = 'sb_publishable_e7wYrt7DYwAc8c7dN6A_iA_xwmqNJ-4';
    const GOOGLE_CLIENTE = '956265002134-hfmprssc6keev7o3dlp9ujmmqctpvdb9.apps.googleusercontent.com';
    const LIBRERIA = 'vendor/supabase.js?v=2.119.2';
    const GOOGLE_GSI = 'https://accounts.google.com/gsi/client';

    const CLAVE_SESION = 'frozen-project:sesion';              // ahí la guarda supabase-js
    const CLAVE_VINCULO = 'frozen-project:biblioteca:cuenta';  // cuenta con la que está sincronizada esta biblioteca
    const CLAVE_VOLVER = 'frozen-project:cuenta:volver';       // apartado al que se vuelve tras entrar con Discord
    const TABLA = 'biblioteca';
    const COLUMNAS = 'obra,estado,favorito,borrada,agregada,cambiada';
    const POR_PAGINA = 1000;          // Supabase devuelve como mucho 1000 filas por consulta
    const LOTE = 500;                 // filas por envío
    const ESPERA_SUBIDA = 1200;       // ms: varios cambios seguidos van en un solo envío
    const CADA_CUANTO = 60 * 1000;    // al volver a la pestaña, sincroniza si pasó al menos un minuto
    const PROVEEDORES = { google: 'Google', discord: 'Discord' };

    const Biblioteca = window.FrozenBiblioteca;
    const $ = id => document.getElementById(id);
    const boton = $('botonCuenta');
    const dialogo = $('dialogoCuenta');
    if (!Biblioteca || !boton || !dialogo) return;

    let cliente = null;           // cliente de Supabase, cuando ya se cargó
    let cargando = null;          // promesa de la carga de la librería
    let usuario = null;           // usuario con sesión iniciada, o null
    let conectando = false;       // mientras se averigua si hay sesión
    let estado = 'nada';          // 'nada' | 'sincronizando' | 'listo' | 'sin-conexion' | 'error'
    let resumen = '';             // lo que pasó en la última sincronización
    let ultimaSync = 0;
    let cola = Promise.resolve(); // las idas a la nube van una detrás de otra
    let temporizador = 0;
    let googleListo = null;
    const pendientes = new Set(); // obras cambiadas aquí que faltan por subir

    // ---------- Pequeñas ayudas ----------
    function leerLocal(clave){ try { return localStorage.getItem(clave); } catch (e){ return null; } }
    function guardarLocal(clave, valor){
        try { if (valor === null) localStorage.removeItem(clave); else localStorage.setItem(clave, valor); } catch (e){}
    }
    function leerSesionNav(clave){ try { return sessionStorage.getItem(clave); } catch (e){ return null; } }
    function guardarSesionNav(clave, valor){
        try { if (valor === null) sessionStorage.removeItem(clave); else sessionStorage.setItem(clave, valor); } catch (e){}
    }
    const enCola = tarea => (cola = cola.catch(() => {}).then(tarea));
    const sinConexion = () => navigator.onLine === false;
    const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

    function cargarScript(src, tiempo = 15000){
        return new Promise((resolver, rechazar) => {
            const s = document.createElement('script');
            const fallo = () => { clearTimeout(reloj); s.remove(); rechazar(new Error('No se pudo cargar ' + src)); };
            const reloj = setTimeout(fallo, tiempo);
            s.src = src;
            s.async = true;
            s.onload = () => { clearTimeout(reloj); resolver(); };
            s.onerror = fallo;
            document.head.append(s);
        });
    }

    function cargarCliente(){
        if (!cargando){
            cargando = (window.supabase ? Promise.resolve() : cargarScript(LIBRERIA)).then(() => {
                cliente = window.supabase.createClient(SUPABASE_URL, SUPABASE_CLAVE, {
                    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true, storageKey: CLAVE_SESION }
                });
                // supabase-js pide no llamar a sus funciones dentro de este aviso: se atiende justo después
                cliente.auth.onAuthStateChange((evento, sesion) => setTimeout(() => alCambiarSesion(evento, sesion), 0));
                return cliente;
            }).catch(error => { cargando = null; throw error; });
        }
        return cargando;
    }

    // ---------- Quién eres ----------
    function datosUsuario(u){
        const m = (u && u.user_metadata) || {};
        const correo = (u && u.email) || m.email || '';
        const nombre = m.full_name || m.name || (m.custom_claims && m.custom_claims.global_name) || m.user_name || correo.split('@')[0] || 'Tu cuenta';
        const proveedor = (u && u.app_metadata && u.app_metadata.provider) || '';
        const foto = typeof m.avatar_url === 'string' ? m.avatar_url : (typeof m.picture === 'string' ? m.picture : '');
        return { nombre: String(nombre).slice(0, 60), correo, proveedor: PROVEEDORES[proveedor] || proveedor, foto: /^https:\/\//.test(foto) ? foto : '' };
    }

    function pintarAvatar(contenedor, datos){
        contenedor.replaceChildren();
        const inicial = document.createElement('span');
        inicial.className = 'avatar-inicial';
        inicial.dataset.inicial = (datos.nombre.trim()[0] || '?').toUpperCase();
        contenedor.append(inicial);
        if (datos.foto){
            const img = document.createElement('img');
            img.alt = '';
            img.referrerPolicy = 'no-referrer';
            img.decoding = 'async';
            img.src = datos.foto;
            img.addEventListener('error', () => img.remove());
            contenedor.append(img);
        }
    }

    // ---------- Pintar ----------
    const ICONO_PERSONA = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

    function textoEstado(){
        if (!usuario) return '';
        switch (estado){
            case 'sincronizando': return 'Sincronizando tu biblioteca…';
            case 'sin-conexion': return 'Sin conexión: tus cambios se guardan aquí y se subirán cuando vuelva el internet.';
            case 'error': return 'No se pudo sincronizar tu biblioteca. Se volverá a intentar; también puedes darle a «Sincronizar ahora».';
            case 'listo': return resumen || 'Tu biblioteca está al día en tu cuenta.';
            default: return 'Conectando con tu cuenta…';
        }
    }

    function pintar(){
        const avatar = $('avatarCuenta');
        const texto = $('textoCuenta');
        if (usuario){
            const datos = datosUsuario(usuario);
            pintarAvatar(avatar, datos);
            texto.textContent = datos.nombre.split(/\s+/)[0];
            boton.setAttribute('aria-label', `Tu cuenta: ${datos.nombre}`);
            boton.classList.add('con-sesion');

            $('tituloCuenta').textContent = 'Tu cuenta';
            pintarAvatar($('fotoPerfil'), datos);
            $('nombrePerfil').textContent = datos.nombre;
            $('detallePerfil').textContent = [datos.proveedor && `Entraste con ${datos.proveedor}`, datos.correo].filter(Boolean).join(' · ');
        } else {
            avatar.innerHTML = ICONO_PERSONA;
            texto.textContent = conectando ? 'Entrando…' : 'Entrar';
            boton.setAttribute('aria-label', conectando ? 'Entrando a tu cuenta' : 'Entrar a tu cuenta (opcional)');
            boton.classList.remove('con-sesion');
            $('tituloCuenta').textContent = 'Guarda tu biblioteca en tu cuenta';
        }
        $('cuentaFuera').hidden = Boolean(usuario);
        $('cuentaDentro').hidden = !usuario;
        pintarEstado();
    }

    function pintarEstado(){
        const t = textoEstado();
        $('estadoSync').textContent = t;
        $('estadoSync').classList.toggle('error', estado === 'error');
        $('sincronizarAhora').disabled = estado === 'sincronizando';

        // El recuadro "Llévala a otro celular o computador" de Mi biblioteca
        const nube = $('textoNube');
        const entrar = $('entrarDesdeBiblioteca');
        if (!nube || !entrar) return;
        if (usuario){
            const { proveedor } = datosUsuario(usuario);
            nube.textContent = `Tu biblioteca se guarda en tu cuenta${proveedor ? ` de ${proveedor}` : ''} y se sincroniza sola en todos tus dispositivos. ${t}`;
            entrar.hidden = true;
        } else {
            nube.textContent = 'Entra con Google o Discord y tu biblioteca se guarda en tu cuenta: la tendrás en todos tus celulares y computadores. Sin cuenta también funciona, pero queda solo en este navegador. También puedes guardar una copia y cargarla en otro lado.';
            entrar.hidden = false;
        }
    }

    function ponerEstado(nuevo, texto = ''){
        estado = nuevo;
        if (nuevo === 'listo') resumen = texto;
        pintarEstado();
    }

    function avisarDialogo(texto, error = false){
        const aviso = $('avisoCuenta');
        aviso.textContent = texto;
        aviso.classList.toggle('error', error);
    }

    let relojAviso = 0;
    function avisarPagina(texto){
        const aviso = $('avisoGlobal');
        if (!aviso) return;
        aviso.textContent = texto;
        aviso.hidden = false;
        clearTimeout(relojAviso);
        relojAviso = setTimeout(() => { aviso.hidden = true; }, 6000);
    }

    // ---------- La nube ----------
    async function bajarTodo(){
        const filas = new Map();
        for (let desde = 0; ; desde += POR_PAGINA){
            const { data, error } = await cliente.from(TABLA).select(COLUMNAS).order('obra').range(desde, desde + POR_PAGINA - 1);
            if (error) throw error;
            (data || []).forEach(f => filas.set(f.obra, f));
            if (!data || data.length < POR_PAGINA) break;
        }
        return filas;
    }

    async function subirFilas(lista, id){
        for (let i = 0; i < lista.length; i += LOTE){
            const filas = lista.slice(i, i + LOTE).map(([obra, e]) => ({
                usuario: id,
                obra,
                estado: e.borrada ? null : e.estado,
                favorito: e.borrada ? false : e.favorito,
                borrada: e.borrada,
                agregada: e.agregada,
                cambiada: e.cambiada
            }));
            const { error } = await cliente.from(TABLA).upsert(filas, { onConflict: 'usuario,obra' });
            if (error) throw error;
        }
    }

    // Trae la biblioteca de la nube, la junta con la de aquí y sube lo que aquí es más nuevo
    function sincronizar(){
        return enCola(async () => {
            if (!usuario || !cliente) return;
            const id = usuario.id;
            ponerEstado('sincronizando');
            try {
                const remotas = await bajarTodo();
                if (!usuario || usuario.id !== id) return;          // cerró sesión mientras tanto
                const vinculo = leerLocal(CLAVE_VINCULO);
                let texto = '';
                if (vinculo && vinculo !== id){
                    // Esta biblioteca era de otra cuenta: se cambia por la de la cuenta que entró
                    Biblioteca.reemplazar(remotas.values());
                    pendientes.clear();
                    texto = 'Cargamos la biblioteca de tu cuenta en este navegador.';
                } else {
                    const bajadas = Biblioteca.juntarNube(remotas.values());
                    const subir = Biblioteca.registro().filter(([obra, e]) => {
                        const f = remotas.get(obra);
                        return f ? Date.parse(e.cambiada) > Date.parse(f.cambiada) : !e.borrada;
                    });
                    await subirFilas(subir, id);
                    subir.forEach(([obra]) => pendientes.delete(obra));
                    const subidas = subir.filter(([, e]) => !e.borrada).length;
                    if (!vinculo && subidas) texto = `Listo: subimos ${plural(subidas, 'obra', 'obras')} de este navegador a tu cuenta.`;
                    else if (bajadas) texto = `Listo: llegaron ${plural(bajadas, 'cambio', 'cambios')} de tus otros dispositivos.`;
                }
                guardarLocal(CLAVE_VINCULO, id);
                ultimaSync = Date.now();
                ponerEstado('listo', texto);
                if (texto) avisarPagina(texto);
            } catch (error){
                console.warn('Frozen Project: no se pudo sincronizar', error);
                ponerEstado(sinConexion() ? 'sin-conexion' : 'error');
            }
        }).then(() => { if (pendientes.size) programarSubida(); });
    }

    // Sube las obras que cambiaron aquí desde la última vez
    function subirPendientes(){
        return enCola(async () => {
            if (!usuario || !cliente || !pendientes.size) return;
            const id = usuario.id;
            const ids = [...pendientes];
            pendientes.clear();
            const registro = new Map(Biblioteca.registro());
            const lista = ids.filter(obra => registro.has(obra)).map(obra => [obra, registro.get(obra)]);
            try {
                ponerEstado('sincronizando');
                await subirFilas(lista, id);
                ponerEstado('listo');
            } catch (error){
                ids.forEach(obra => pendientes.add(obra));
                ponerEstado(sinConexion() ? 'sin-conexion' : 'error');
            }
        });
    }

    function programarSubida(){
        clearTimeout(temporizador);
        temporizador = setTimeout(subirPendientes, ESPERA_SUBIDA);
    }

    // ---------- Sesión ----------
    function cambiarUsuario(u){
        const antes = usuario ? usuario.id : null;
        usuario = u || null;
        conectando = false;
        if (!usuario){
            estado = 'nada';
            resumen = '';
            pendientes.clear();
        }
        pintar();
        if (usuario && usuario.id !== antes) sincronizar();
    }

    let saliendo = false;
    function alCambiarSesion(evento, sesion){
        if (evento === 'SIGNED_OUT'){
            // Si no la cerraste tú (venció o la cerraron en otro lado), la biblioteca se queda aquí
            if (!saliendo) cambiarUsuario(null);
            return;
        }
        if (sesion && sesion.user) cambiarUsuario(sesion.user);
        else if (evento === 'INITIAL_SESSION') cambiarUsuario(null);
    }

    // Quita de la dirección lo que dejó la vuelta de Discord/Google (?code=…, ?error=…)
    function limpiarDireccion(){
        const params = new URLSearchParams(location.search);
        let error = params.get('error_description') || params.get('error');
        ['code', 'error', 'error_code', 'error_description', 'state'].forEach(p => params.delete(p));
        const busqueda = params.toString();
        history.replaceState(history.state, '', location.pathname + (busqueda ? '?' + busqueda : '') + location.hash);
        guardarSesionNav(CLAVE_VOLVER, null);
        return error;
    }

    async function arrancar({ volvioDeEntrar = false } = {}){
        conectando = true;
        pintar();
        try {
            const sb = await cargarCliente();
            const { data } = await sb.auth.getSession();     // también termina la entrada con ?code=…
            if (volvioDeEntrar){
                const error = limpiarDireccion();
                if (error && !(data && data.session)){
                    avisarPagina('No se completó la entrada a tu cuenta. Puedes intentarlo otra vez desde «Entrar».');
                } else if (data && data.session){
                    const { proveedor } = datosUsuario(data.session.user);
                    avisarPagina(`¡Entraste${proveedor ? ` con ${proveedor}` : ''}! Tu biblioteca se está sincronizando.`);
                }
            }
            cambiarUsuario(data && data.session ? data.session.user : null);
        } catch (error){
            console.warn('Frozen Project: no se pudo conectar con la cuenta', error);
            conectando = false;
            if (volvioDeEntrar) limpiarDireccion();
            pintar();
        }
    }

    async function entrarConRedireccion(proveedor){
        avisarDialogo('Abriendo ' + PROVEEDORES[proveedor] + '…');
        guardarSesionNav(CLAVE_VOLVER, location.hash || '#inicio');
        try {
            const sb = await cargarCliente();
            const { error } = await sb.auth.signInWithOAuth({ provider: proveedor, options: { redirectTo: location.origin + location.pathname } });
            if (error) throw error;
        } catch (error){
            guardarSesionNav(CLAVE_VOLVER, null);
            avisarDialogo(`No se pudo abrir ${PROVEEDORES[proveedor]}. Revisa tu conexión e inténtalo otra vez.`, true);
        }
    }

    // Google: su botón oficial (abre una ventanita de Google) y Supabase recibe la credencial.
    // El "nonce" evita que alguien reuse una credencial robada: Google recibe su huella y Supabase el original.
    async function crearNonce(){
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        const crudo = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '');
        const huella = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(crudo));
        const hash = [...new Uint8Array(huella)].map(b => b.toString(16).padStart(2, '0')).join('');
        return { crudo, hash };
    }

    function prepararGoogle(){
        if (googleListo) return googleListo;
        $('googleAlterno').hidden = true;
        googleListo = (async () => {
            const [, nonce] = await Promise.all([window.google && window.google.accounts ? null : cargarScript(GOOGLE_GSI, 10000), crearNonce()]);
            const gid = window.google && window.google.accounts && window.google.accounts.id;
            if (!gid) throw new Error('El botón de Google no cargó');
            gid.initialize({
                client_id: GOOGLE_CLIENTE,
                nonce: nonce.hash,
                callback: respuesta => entrarConGoogle(respuesta && respuesta.credential, nonce.crudo),
                context: 'signin',
                ux_mode: 'popup',
                auto_select: false,
                itp_support: true
            });
            const contenedor = $('botonGoogle');
            gid.renderButton(contenedor, {
                type: 'standard', theme: 'filled_black', size: 'large', text: 'continue_with',
                shape: 'pill', logo_alignment: 'left', locale: 'es',
                width: Math.max(220, Math.min(320, contenedor.clientWidth || 300))
            });
        })().catch(error => {
            console.warn('Frozen Project: Google', error);
            googleListo = null;
            $('googleAlterno').hidden = false;      // queda la entrada con Google por redirección
        });
        return googleListo;
    }

    async function entrarConGoogle(token, nonce){
        if (!token) return;
        avisarDialogo('Entrando…');
        try {
            const sb = await cargarCliente();
            const { data, error } = await sb.auth.signInWithIdToken({ provider: 'google', token, nonce });
            if (error) throw error;
            avisarDialogo('');
            if (data && data.user) cambiarUsuario(data.user);
        } catch (error){
            console.warn('Frozen Project: Google', error);
            avisarDialogo('No se pudo entrar con Google. Inténtalo otra vez.', true);
        }
    }

    function terminarSesionLocal(){
        clearTimeout(temporizador);
        pendientes.clear();
        guardarLocal(CLAVE_VINCULO, null);
        Biblioteca.vaciar();
        cambiarUsuario(null);
    }

    async function cerrarSesion({ aunqueFalte = false } = {}){
        if (!usuario || !cliente) return;
        $('cerrarSesion').disabled = true;
        avisarDialogo('Guardando tus últimos cambios…');
        clearTimeout(temporizador);
        await subirPendientes();
        if (pendientes.size && !aunqueFalte){
            $('cerrarSesion').disabled = false;
            $('cerrarIgual').hidden = false;
            avisarDialogo(`Hay ${plural(pendientes.size, 'cambio', 'cambios')} que no se pudieron subir (¿sin internet?). Si cierras sesión ahora, se pierden.`, true);
            return;
        }
        saliendo = true;
        try { await cliente.auth.signOut({ scope: 'local' }); } catch (error){}
        guardarLocal(CLAVE_SESION, null);
        saliendo = false;
        $('cerrarSesion').disabled = false;
        $('cerrarIgual').hidden = true;
        terminarSesionLocal();
        avisarDialogo('Cerraste sesión. Tu biblioteca sigue guardada en tu cuenta.');
    }

    async function borrarCuenta(){
        if (!usuario || !cliente) return;
        const botonBorrar = $('borrarCuenta');
        botonBorrar.disabled = true;
        avisarDialogo('Borrando tu cuenta…');
        try {
            const { error } = await cliente.rpc('borrar_mi_cuenta');
            if (error) throw error;
        } catch (error){
            botonBorrar.disabled = false;
            avisarDialogo('No se pudo borrar tu cuenta. Revisa tu conexión e inténtalo otra vez.', true);
            return;
        }
        saliendo = true;
        try { await cliente.auth.signOut({ scope: 'local' }); } catch (error){}
        guardarLocal(CLAVE_SESION, null);
        saliendo = false;
        botonBorrar.disabled = false;
        $('zonaBorrar').open = false;
        terminarSesionLocal();
        avisarDialogo('Tu cuenta y la biblioteca guardada en ella se borraron para siempre.');
    }

    // ---------- Diálogo ----------
    function abrirDialogo(){
        avisarDialogo('');
        $('cerrarIgual').hidden = true;
        if (!dialogo.open) dialogo.showModal();
        if (!usuario){
            prepararGoogle();
            cargarCliente().catch(() => {});      // así entrar con Discord es más rápido
        }
    }

    boton.addEventListener('click', abrirDialogo);
    $('cerrarCuenta').addEventListener('click', () => dialogo.close());
    dialogo.addEventListener('click', ev => { if (ev.target === dialogo) dialogo.close(); });
    $('entrarDiscord').addEventListener('click', () => entrarConRedireccion('discord'));
    $('entrarGoogleRedireccion').addEventListener('click', () => entrarConRedireccion('google'));
    $('sincronizarAhora').addEventListener('click', () => sincronizar());
    $('cerrarSesion').addEventListener('click', () => cerrarSesion());
    $('cerrarIgual').addEventListener('click', () => cerrarSesion({ aunqueFalte: true }));
    $('borrarCuenta').addEventListener('click', borrarCuenta);
    $('irBiblioteca').addEventListener('click', () => dialogo.close());
    const entrarBiblioteca = $('entrarDesdeBiblioteca');
    if (entrarBiblioteca) entrarBiblioteca.addEventListener('click', abrirDialogo);

    // Cambios en la biblioteca: los de aquí (o de una copia cargada) se suben
    Biblioteca.alCambiar((id, origen) => {
        if (!usuario) return;
        if (origen === 'local' || origen === 'copia'){
            if (id) pendientes.add(id);
            programarSubida();
        }
    });

    // Al volver a la pestaña o al recuperar internet, se pone al día
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && usuario && Date.now() - ultimaSync > CADA_CUANTO) sincronizar();
    });
    window.addEventListener('online', () => {
        if (usuario) sincronizar();
        else if (!cliente && leerLocal(CLAVE_SESION)) arrancar();   // la página cargó sin internet
    });

    // Si entras o sales en otra pestaña, esta se entera
    window.addEventListener('storage', e => {
        if (e.key !== CLAVE_SESION && e.key !== null) return;
        const hay = Boolean(leerLocal(CLAVE_SESION));
        if (hay && !usuario && !cargando) arrancar();
        else if (!hay && usuario) cambiarUsuario(null);
    });

    // ---------- Al cargar la página ----------
    const params = new URLSearchParams(location.search);
    const volvioDeEntrar = params.has('code') || params.has('error') || params.has('error_description');
    if (volvioDeEntrar || leerLocal(CLAVE_SESION)) arrancar({ volvioDeEntrar });
    else pintar();
})();
