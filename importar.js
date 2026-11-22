/* ===================================
   FROZEN PROJECT: traer tu lista de AniList o MyAnimeList a "Mi biblioteca"
   - AniList: con tu nombre de usuario, tu navegador le pide a AniList tu lista de manga
     (tiene que ser pública) y tus favoritos. No pasa por ningún servidor nuestro.
   - MyAnimeList: cargas el archivo que MAL te deja exportar (.xml o .xml.gz). Se lee aquí
     mismo, en tu navegador, y no se sube a ningún lado.
   Solo entran las obras que ya están en el catálogo (se reconocen por su número en AniList
   o en MAL); las demás se cuentan para avisarte. Las etiquetas se traducen así:
   leyendo, por leer, leído, en pausa y abandonado. Si una obra ya estaba en tu biblioteca,
   se respeta lo que tenías, salvo que marques "cambiar también las que ya tengo".
=================================== */
(() => {
    const Biblioteca = window.FrozenBiblioteca;
    const $ = id => document.getElementById(id);
    const formulario = $('formAniList');
    if (!Biblioteca || !formulario) return;

    const ANILIST = 'https://graphql.anilist.co';
    const MAX_ARCHIVO = 30 * 1024 * 1024;
    const PAGINAS_FAVORITOS = 8;          // hasta 200 favoritos (25 por página)

    const DE_ANILIST = { CURRENT: 'leyendo', REPEATING: 'leyendo', PLANNING: 'por-leer', COMPLETED: 'leido', PAUSED: 'en-pausa', DROPPED: 'abandonado' };
    const DE_MAL = {
        'reading': 'leyendo', '1': 'leyendo',
        'completed': 'leido', '2': 'leido',
        'on-hold': 'en-pausa', 'on hold': 'en-pausa', '3': 'en-pausa',
        'dropped': 'abandonado', '4': 'abandonado',
        'plan to read': 'por-leer', '6': 'por-leer'
    };

    const CONSULTA_LISTA = `query ($usuario: String) {
        MediaListCollection(userName: $usuario, type: MANGA) {
            lists { entries { status createdAt media { id } } }
        }
    }`;
    const CONSULTA_FAVORITOS = `query ($usuario: String, $pagina: Int) {
        User(name: $usuario) {
            favourites { manga(page: $pagina, perPage: 25) { nodes { id } pageInfo { hasNextPage } } }
        }
    }`;

    const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

    function avisar(texto, error = false){
        const aviso = $('avisoImportar');
        aviso.textContent = texto;
        aviso.classList.toggle('error', error);
    }

    function ocupado(si){
        ['traerAniList', 'cargarMal', 'usuarioAniList'].forEach(id => { $(id).disabled = si; });
    }

    // El catálogo como { anilist: Map(número → id), mal: Map(número → id) }
    let indice = null;
    async function cargarIndice(){
        if (indice) return indice;
        const r = await fetch('datos/lista.json', { cache: 'no-cache' });
        if (!r.ok) throw new Error('catálogo');
        const datos = await r.json();
        const lista = Array.isArray(datos) ? datos : (datos.obras || []);
        const anilist = new Map(), mal = new Map();
        lista.forEach(o => {
            if (!o || !o.id || !o.ids) return;
            if (o.ids.anilist) anilist.set(Number(o.ids.anilist), o.id);
            if (o.ids.mal) mal.set(Number(o.ids.mal), o.id);
        });
        indice = { anilist, mal };
        return indice;
    }

    // Junta lo traído con la biblioteca y cuenta lo que pasó
    function terminar(origen, total, encontradas){
        if (!total){
            avisar(`Tu lista de ${origen} está vacía: no hay obras para traer.`, true);
            return;
        }
        const faltan = total - encontradas.length;
        const r = Biblioteca.importarLista(encontradas, { cambiarExistentes: $('cambiarExistentes').checked });
        const partes = [];
        if (r.nuevas) partes.push(plural(r.nuevas, 'obra nueva', 'obras nuevas'));
        if (r.actualizadas) partes.push(plural(r.actualizadas, 'obra actualizada', 'obras actualizadas'));
        let texto = partes.length ? `Listo: ${partes.join(' y ')} desde ${origen}.` : `Ya tenías en tu biblioteca todo lo de ${origen} que está en el catálogo.`;
        if (r.iguales && partes.length) texto += ` ${plural(r.iguales, 'ya estaba', 'ya estaban')} y ${r.iguales === 1 ? 'se dejó' : 'se dejaron'} como la tenías.`;
        if (faltan) texto += ` ${plural(faltan, 'obra de tu lista todavía no está', 'obras de tu lista todavía no están')} en el catálogo.`;
        avisar(texto);
    }

    // ---------- AniList ----------
    async function preguntarAniList(consulta, variables){
        let r;
        try {
            r = await fetch(ANILIST, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ query: consulta, variables })
            });
        } catch (error){
            throw new Error('No se pudo conectar con AniList. Revisa tu internet e inténtalo otra vez.');
        }
        if (r.status === 429) throw new Error('AniList está recibiendo muchas consultas. Espera un minuto e inténtalo otra vez.');
        let datos = null;
        try { datos = await r.json(); } catch (error){}
        const errores = (datos && datos.errors) || [];
        if (errores.length){
            const mensaje = errores.map(e => e.message || '').join(' ');
            if (/private/i.test(mensaje)) throw new Error('Esa lista de AniList es privada. Hazla pública un momento en la configuración de AniList, tráela y luego vuelve a ponerla privada.');
            if (/not found|no encontr/i.test(mensaje) || r.status === 404) throw new Error('No encontramos ese usuario en AniList. Revisa cómo está escrito.');
            throw new Error('AniList no respondió bien. Inténtalo otra vez en un rato.');
        }
        if (!r.ok || !datos || !datos.data) throw new Error('AniList no respondió bien. Inténtalo otra vez en un rato.');
        return datos.data;
    }

    async function traerAniList(usuario){
        const { anilist } = await cargarIndice();
        const datos = await preguntarAniList(CONSULTA_LISTA, { usuario });
        const porObra = new Map();      // número de AniList → { estado, agregada }
        const listas = (datos.MediaListCollection && datos.MediaListCollection.lists) || [];
        listas.forEach(l => (l.entries || []).forEach(e => {
            const numero = e && e.media && Number(e.media.id);
            const estado = DE_ANILIST[e && e.status];
            if (!numero || !estado || porObra.has(numero)) return;
            porObra.set(numero, { estado, agregada: e.createdAt ? new Date(e.createdAt * 1000).toISOString() : null });
        }));

        // Favoritos (aunque no estén en la lista)
        const favoritos = new Set();
        try {
            for (let pagina = 1; pagina <= PAGINAS_FAVORITOS; pagina++){
                const f = await preguntarAniList(CONSULTA_FAVORITOS, { usuario, pagina });
                const manga = f.User && f.User.favourites && f.User.favourites.manga;
                ((manga && manga.nodes) || []).forEach(n => n && favoritos.add(Number(n.id)));
                if (!manga || !manga.pageInfo || !manga.pageInfo.hasNextPage) break;
            }
        } catch (error){
            // Sin favoritos igual se trae la lista
        }

        const numeros = new Set([...porObra.keys(), ...favoritos]);
        const encontradas = [];
        numeros.forEach(numero => {
            const id = anilist.get(numero);
            if (!id) return;
            const e = porObra.get(numero) || {};
            encontradas.push({ id, estado: e.estado || null, favorito: favoritos.has(numero), agregada: e.agregada });
        });
        terminar('AniList', numeros.size, encontradas);
    }

    formulario.addEventListener('submit', async ev => {
        ev.preventDefault();
        const usuario = $('usuarioAniList').value.trim();
        if (!/^[A-Za-z0-9_-]{2,20}$/.test(usuario)){
            avisar('Escribe tu nombre de usuario de AniList (solo letras, números, guion o guion bajo).', true);
            $('usuarioAniList').focus();
            return;
        }
        ocupado(true);
        avisar('Trayendo tu lista de AniList…');
        try {
            await traerAniList(usuario);
        } catch (error){
            avisar(error.message || 'No se pudo traer tu lista de AniList.', true);
        } finally {
            ocupado(false);
        }
    });

    // ---------- MyAnimeList ----------
    async function leerArchivo(archivo){
        const inicio = new Uint8Array(await archivo.slice(0, 2).arrayBuffer());
        const comprimido = inicio[0] === 0x1f && inicio[1] === 0x8b;
        if (!comprimido) return archivo.text();
        if (typeof DecompressionStream !== 'function'){
            throw new Error('Este navegador no puede abrir archivos .gz. Descomprímelo y carga el .xml que trae adentro.');
        }
        return new Response(archivo.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    }

    async function traerMal(archivo){
        if (archivo.size > MAX_ARCHIVO) throw new Error('Ese archivo es demasiado grande para ser una lista de MyAnimeList.');
        let texto;
        try { texto = await leerArchivo(archivo); }
        catch (error){ throw new Error(error.message && /navegador/.test(error.message) ? error.message : 'No se pudo abrir ese archivo.'); }
        const xml = new DOMParser().parseFromString(texto, 'application/xml');
        const raiz = xml.documentElement;
        if (!raiz || raiz.nodeName !== 'myanimelist' || xml.getElementsByTagName('parsererror').length){
            throw new Error('Ese archivo no es una lista exportada de MyAnimeList.');
        }
        const obras = [...raiz.children].filter(n => n.nodeName === 'manga');
        if (!obras.length && [...raiz.children].some(n => n.nodeName === 'anime')){
            throw new Error('Ese archivo es tu lista de anime. Exporta la de manga y cárgala.');
        }
        const { mal } = await cargarIndice();
        const dato = (nodo, nombre) => { const n = nodo.getElementsByTagName(nombre)[0]; return n ? n.textContent.trim() : ''; };
        const encontradas = [];
        const vistos = new Set();
        obras.forEach(nodo => {
            const numero = Number(dato(nodo, 'manga_mangadb_id'));
            const estado = DE_MAL[dato(nodo, 'my_status').toLowerCase()];
            if (!numero || vistos.has(numero)) return;
            vistos.add(numero);
            const id = mal.get(numero);
            if (!id || !estado) return;
            const inicioLectura = dato(nodo, 'my_start_date');
            const agregada = /^\d{4}-\d{2}-\d{2}$/.test(inicioLectura) && inicioLectura !== '0000-00-00' ? `${inicioLectura}T12:00:00.000Z` : null;
            encontradas.push({ id, estado, favorito: false, agregada });
        });
        terminar('MyAnimeList', vistos.size, encontradas);
    }

    $('cargarMal').addEventListener('click', () => $('archivoMal').click());
    $('archivoMal').addEventListener('change', async ev => {
        const archivo = ev.target.files && ev.target.files[0];
        ev.target.value = '';
        if (!archivo) return;
        ocupado(true);
        avisar('Leyendo tu lista de MyAnimeList…');
        try {
            await traerMal(archivo);
        } catch (error){
            avisar(error.message || 'No se pudo leer ese archivo.', true);
        } finally {
            ocupado(false);
        }
    });
})();
