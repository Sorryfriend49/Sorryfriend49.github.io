/* ===================================
   FROZEN PROJECT: mi biblioteca (datos)
   Guarda en este navegador (localStorage) las obras del catálogo que agregas, cada una
   con una etiqueta (Leyendo, Por leer, Leído, En pausa, Abandonado) y, si quieres,
   marcada como favorita. No necesita cuenta ni servidor: es gratis y privado, pero
   cada navegador tiene su propia biblioteca. Para pasarla a otro, se guarda una
   copia (un archivo .json) y se carga allá.
   catalogo.js pinta la biblioteca y los botones de la ficha con lo que da este archivo.
=================================== */
(() => {
    const CLAVE = 'frozen-project:biblioteca';
    const VERSION = 1;
    const ESTADOS = ['leyendo', 'por-leer', 'leido', 'en-pausa', 'abandonado'];
    const ID_VALIDO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;      // los id del catálogo: "chainsaw-man"
    const MAX_COPIA = 2 * 1024 * 1024;                    // una copia de más de 2 MB no es de aquí

    let disponible = true;          // false si el navegador no deja guardar (p. ej. en modo privado)
    const oyentes = new Set();

    const fechaValida = f => typeof f === 'string' && f.length <= 40 && !Number.isNaN(Date.parse(f));

    // Una entrada válida o null: { estado, favorito, agregada, cambiada }
    function limpiarEntrada(e){
        if (!e || typeof e !== 'object') return null;
        const estado = ESTADOS.includes(e.estado) ? e.estado : null;
        const favorito = e.favorito === true;
        if (!estado && !favorito) return null;
        const ahora = new Date().toISOString();
        const agregada = fechaValida(e.agregada) ? e.agregada : (fechaValida(e.cambiada) ? e.cambiada : ahora);
        const cambiada = fechaValida(e.cambiada) ? e.cambiada : agregada;
        return { estado, favorito, agregada, cambiada };
    }

    // { id: entrada } solo con id y entradas válidas (así un archivo raro no rompe nada)
    function limpiarObras(obras){
        const limpias = new Map();
        if (!obras || typeof obras !== 'object' || Array.isArray(obras)) return limpias;
        for (const [id, e] of Object.entries(obras)){
            if (typeof id !== 'string' || id.length > 200 || !ID_VALIDO.test(id)) continue;
            const entrada = limpiarEntrada(e);
            if (entrada) limpias.set(id, entrada);
        }
        return limpias;
    }

    function leer(){
        try {
            const texto = localStorage.getItem(CLAVE);
            if (!texto) return new Map();
            const datos = JSON.parse(texto);
            return limpiarObras(datos && datos.obras);
        } catch (error){
            if (error instanceof SyntaxError) return new Map();   // datos dañados: se empieza de cero
            disponible = false;
            return new Map();
        }
    }

    let obras = leer();

    function guardar(){
        try {
            localStorage.setItem(CLAVE, JSON.stringify({ version: VERSION, obras: Object.fromEntries(obras) }));
            disponible = true;
            return true;
        } catch (error){
            disponible = false;     // sin espacio o sin permiso: queda solo mientras la página siga abierta
            return false;
        }
    }

    function avisar(id){
        oyentes.forEach(fn => { try { fn(id); } catch (error){ console.error(error); } });
    }

    const copiar = e => e ? { ...e } : null;

    // Cambia la etiqueta y/o el favorito de una obra. Si queda sin etiqueta y sin favorito, sale de la biblioteca.
    function poner(id, cambios){
        if (typeof id !== 'string' || !ID_VALIDO.test(id)) return null;
        const antes = obras.get(id);
        const ahora = new Date().toISOString();
        const estado = 'estado' in cambios ? (ESTADOS.includes(cambios.estado) ? cambios.estado : null) : (antes ? antes.estado : null);
        const favorito = 'favorito' in cambios ? cambios.favorito === true : Boolean(antes && antes.favorito);
        if (!estado && !favorito){
            obras.delete(id);
        } else {
            obras.set(id, { estado, favorito, agregada: antes ? antes.agregada : ahora, cambiada: ahora });
        }
        guardar();
        avisar(id);
        return copiar(obras.get(id));
    }

    function quitar(id){
        if (!obras.has(id)) return;
        obras.delete(id);
        guardar();
        avisar(id);
    }

    // Copia para descargar (archivo .json)
    function exportar(){
        return JSON.stringify({
            app: 'Frozen Project',
            tipo: 'biblioteca',
            version: VERSION,
            exportada: new Date().toISOString(),
            obras: Object.fromEntries(obras)
        }, null, 2);
    }

    // Carga una copia y la junta con lo que ya hay: si una obra está en las dos, gana el cambio más reciente.
    // Devuelve { nuevas, actualizadas, iguales } o lanza un Error con un mensaje para mostrar.
    function importar(texto){
        if (typeof texto !== 'string' || !texto.trim()) throw new Error('El archivo está vacío.');
        if (texto.length > MAX_COPIA) throw new Error('Ese archivo es demasiado grande para ser una copia de tu biblioteca.');
        let datos;
        try { datos = JSON.parse(texto); }
        catch (error){ throw new Error('Ese archivo no es una copia de la biblioteca de Frozen Project.'); }
        if (!datos || datos.tipo !== 'biblioteca' || !datos.obras || typeof datos.obras !== 'object'){
            throw new Error('Ese archivo no es una copia de la biblioteca de Frozen Project.');
        }
        const entrantes = limpiarObras(datos.obras);
        let nuevas = 0, actualizadas = 0, iguales = 0;
        entrantes.forEach((e, id) => {
            const actual = obras.get(id);
            if (!actual){ obras.set(id, e); nuevas++; }
            else if (Date.parse(e.cambiada) > Date.parse(actual.cambiada)){ obras.set(id, e); actualizadas++; }
            else iguales++;
        });
        if (nuevas || actualizadas){
            guardar();
            avisar(null);
        }
        return { nuevas, actualizadas, iguales };
    }

    // Si la biblioteca cambia en otra pestaña, esta se pone al día
    window.addEventListener('storage', e => {
        if (e.key !== CLAVE && e.key !== null) return;
        obras = leer();
        avisar(null);
    });

    window.FrozenBiblioteca = {
        ESTADOS,
        obtener: id => copiar(obras.get(id)),
        todas: () => [...obras].map(([id, e]) => [id, { ...e }]),
        poner,
        quitar,
        exportar,
        importar,
        disponible: () => disponible,
        // fn(id) se llama después de cada cambio (id = null si cambiaron varias obras)
        alCambiar: fn => { oyentes.add(fn); return () => oyentes.delete(fn); }
    };
})();
