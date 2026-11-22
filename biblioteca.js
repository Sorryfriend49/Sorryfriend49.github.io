/* ===================================
   FROZEN PROJECT: mi biblioteca (datos)
   Guarda en este navegador (localStorage) las obras del catálogo que agregas, cada una
   con una etiqueta (Leyendo, Por leer, Leído, En pausa, Abandonado) y, si quieres,
   marcada como favorita. Sin cuenta funciona igual: es gratis y privado, y para pasarla a
   otro navegador se guarda una copia (un archivo .json) y se carga allá.
   Con cuenta, cuenta.js la sincroniza con la nube (Supabase). Para eso también se recuerda
   qué obras quitaste y cuándo ("borradas"): así tus otros dispositivos las quitan también
   en vez de volver a subirlas. Si la misma obra cambió en dos lados, gana el cambio más reciente.
   Si alguien llega desde la dirección vieja de la página, su biblioteca viene con él y se
   junta aquí (ver index.html). catalogo.js pinta la biblioteca y los botones de la ficha.
=================================== */
(() => {
    const CLAVE = 'frozen-project:biblioteca';
    const VERSION = 1;
    const ESTADOS = ['leyendo', 'por-leer', 'leido', 'en-pausa', 'abandonado'];
    const ID_VALIDO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;      // los id del catálogo: "chainsaw-man"
    const MAX_COPIA = 2 * 1024 * 1024;                    // una copia de más de 2 MB no es de aquí
    const MAX_BORRADAS = 2000;                            // se olvidan las más viejas

    let disponible = true;          // false si el navegador no deja guardar (p. ej. en modo privado)
    const oyentes = new Set();

    const fechaValida = f => typeof f === 'string' && f.length <= 40 && !Number.isNaN(Date.parse(f));
    const idValido = id => typeof id === 'string' && id.length <= 200 && ID_VALIDO.test(id);
    const ms = f => Date.parse(f);

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
            if (!idValido(id)) continue;
            const entrada = limpiarEntrada(e);
            if (entrada) limpias.set(id, entrada);
        }
        return limpias;
    }

    // { id: fecha en que se quitó }
    function limpiarBorradas(borradas, obras){
        const limpias = new Map();
        if (!borradas || typeof borradas !== 'object' || Array.isArray(borradas)) return limpias;
        for (const [id, f] of Object.entries(borradas)){
            if (idValido(id) && fechaValida(f) && !obras.has(id)) limpias.set(id, f);
        }
        return limpias;
    }

    function leer(){
        try {
            const texto = localStorage.getItem(CLAVE);
            if (!texto) return { obras: new Map(), borradas: new Map() };
            const datos = JSON.parse(texto) || {};
            const obras = limpiarObras(datos.obras);
            return { obras, borradas: limpiarBorradas(datos.borradas, obras) };
        } catch (error){
            if (!(error instanceof SyntaxError)) disponible = false;   // datos dañados: se empieza de cero
            return { obras: new Map(), borradas: new Map() };
        }
    }

    let { obras, borradas } = leer();

    function podar(){
        if (borradas.size <= MAX_BORRADAS) return;
        const viejas = [...borradas].sort((a, b) => ms(a[1]) - ms(b[1])).slice(0, borradas.size - MAX_BORRADAS);
        viejas.forEach(([id]) => borradas.delete(id));
    }

    function guardar(){
        podar();
        try {
            const datos = { version: VERSION, obras: Object.fromEntries(obras) };
            if (borradas.size) datos.borradas = Object.fromEntries(borradas);
            localStorage.setItem(CLAVE, JSON.stringify(datos));
            disponible = true;
            return true;
        } catch (error){
            disponible = false;     // sin espacio o sin permiso: queda solo mientras la página siga abierta
            return false;
        }
    }

    // origen: 'local' (cambio hecho aquí), 'copia' (se cargó un archivo), 'nube' (llegó de la cuenta),
    // 'pestana' (cambió en otra pestaña). catalogo.js no lo necesita; cuenta.js sí.
    function avisar(id, origen){
        oyentes.forEach(fn => { try { fn(id, origen); } catch (error){ console.error(error); } });
    }

    const copiar = e => e ? { ...e } : null;

    function marcarBorrada(id, fecha){
        obras.delete(id);
        borradas.set(id, fecha);
    }

    // Fecha para un cambio nuevo en esta obra: ahora, pero siempre después del último cambio que ya tenía.
    // Así, si llegó un cambio de un dispositivo con el reloj un poco adelantado, lo que hagas después aquí igual gana.
    function marcaNueva(id){
        const antes = obras.get(id);
        const previa = antes ? ms(antes.cambiada) : (borradas.has(id) ? ms(borradas.get(id)) : 0);
        return new Date(Math.max(Date.now(), (previa || 0) + 1)).toISOString();
    }

    // Cambia la etiqueta y/o el favorito de una obra. Si queda sin etiqueta y sin favorito, sale de la biblioteca.
    function poner(id, cambios){
        if (!idValido(id)) return null;
        const antes = obras.get(id);
        const ahora = marcaNueva(id);
        const estado = 'estado' in cambios ? (ESTADOS.includes(cambios.estado) ? cambios.estado : null) : (antes ? antes.estado : null);
        const favorito = 'favorito' in cambios ? cambios.favorito === true : Boolean(antes && antes.favorito);
        if (!estado && !favorito){
            if (!antes) return null;
            marcarBorrada(id, ahora);
        } else {
            obras.set(id, { estado, favorito, agregada: antes ? antes.agregada : ahora, cambiada: ahora });
            borradas.delete(id);
        }
        guardar();
        avisar(id, 'local');
        return copiar(obras.get(id));
    }

    function quitar(id){
        if (!obras.has(id)) return;
        marcarBorrada(id, marcaNueva(id));
        guardar();
        avisar(id, 'local');
    }

    // Copia para descargar (archivo .json). No lleva las borradas: es para guardar o pasar lo que tienes.
    function exportar(){
        return JSON.stringify({
            app: 'Frozen Project',
            tipo: 'biblioteca',
            version: VERSION,
            exportada: new Date().toISOString(),
            obras: Object.fromEntries(obras)
        }, null, 2);
    }

    // Junta obras que llegan de una copia (o de la dirección vieja) con las que ya hay:
    // si una obra está en las dos, gana el cambio más reciente. Una obra que habías quitado
    // vuelve, y cuenta como cambio de ahora (si no, la nube la volvería a quitar).
    function juntar(entrantes){
        let nuevas = 0, actualizadas = 0, iguales = 0;
        const cambiadas = [];
        entrantes.forEach((e, id) => {
            const actual = obras.get(id);
            if (!actual){
                const quitada = borradas.get(id);
                obras.set(id, quitada && ms(quitada) >= ms(e.cambiada) ? { ...e, cambiada: marcaNueva(id) } : e);
                borradas.delete(id);
                nuevas++;
                cambiadas.push(id);
            } else if (ms(e.cambiada) > ms(actual.cambiada)){
                obras.set(id, e);
                actualizadas++;
                cambiadas.push(id);
            } else iguales++;
        });
        if (nuevas || actualizadas) guardar();
        return { nuevas, actualizadas, iguales, cambiadas };
    }

    // Carga una copia y la junta con lo que ya hay.
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
        const r = juntar(limpiarObras(datos.obras));
        r.cambiadas.forEach(id => avisar(id, 'copia'));
        return { nuevas: r.nuevas, actualizadas: r.actualizadas, iguales: r.iguales };
    }

    // ===== Para la sincronización con la cuenta (cuenta.js) =====

    // Todo lo que hay que conocer para comparar con la nube, borradas incluidas:
    // [[id, { estado, favorito, borrada, agregada, cambiada }], ...]
    function registro(){
        const lista = [...obras].map(([id, e]) => [id, { ...e, borrada: false }]);
        borradas.forEach((f, id) => lista.push([id, { estado: null, favorito: false, borrada: true, agregada: f, cambiada: f }]));
        return lista;
    }

    // Una fila de la nube convertida en { id, borrada, entrada } o null si no es válida
    function leerFila(f){
        if (!f || !idValido(f.obra) || !fechaValida(f.cambiada)) return null;
        if (f.borrada === true) return { id: f.obra, borrada: true, cambiada: f.cambiada };
        const entrada = limpiarEntrada(f);
        return entrada ? { id: f.obra, borrada: false, cambiada: entrada.cambiada, entrada } : null;
    }

    function aplicarFila(fila){
        if (fila.borrada) marcarBorrada(fila.id, fila.cambiada);
        else { obras.set(fila.id, fila.entrada); borradas.delete(fila.id); }
    }

    // Junta lo que llegó de la nube: solo cambia lo que allá es más reciente. Devuelve cuántas obras cambió.
    function juntarNube(filas){
        let cambios = 0;
        for (const f of filas){
            const fila = leerFila(f);
            if (!fila) continue;
            const actual = obras.get(fila.id);
            const local = actual ? actual.cambiada : borradas.get(fila.id);
            if (local && ms(local) >= ms(fila.cambiada)) continue;
            if (!local && fila.borrada) continue;          // ya no está aquí: no hace falta recordarla
            aplicarFila(fila);
            cambios++;
        }
        if (cambios){
            guardar();
            avisar(null, 'nube');
        }
        return cambios;
    }

    // Cambia toda la biblioteca de este navegador por la de la nube (cuando entra otra cuenta)
    function reemplazar(filas){
        obras = new Map();
        borradas = new Map();
        for (const f of filas){
            const fila = leerFila(f);
            if (fila && !fila.borrada) aplicarFila(fila);
        }
        guardar();
        avisar(null, 'nube');
    }

    // Deja este navegador sin biblioteca (al cerrar sesión: sigue guardada en la cuenta)
    function vaciar(){
        obras = new Map();
        borradas = new Map();
        guardar();
        avisar(null, 'nube');
    }

    // La biblioteca que llegó desde la dirección vieja (la deja el script del inicio de index.html)
    try {
        const traida = sessionStorage.getItem(CLAVE + ':traspaso');
        if (traida){
            sessionStorage.removeItem(CLAVE + ':traspaso');
            const datos = JSON.parse(traida);
            juntar(limpiarObras(datos && datos.obras));
        }
    } catch (error){
        // Si algo falla, la copia sigue guardada en la dirección vieja (frozen-project:biblioteca:trasladada)
    }

    // Si la biblioteca cambia en otra pestaña, esta se pone al día
    window.addEventListener('storage', e => {
        if (e.key !== CLAVE && e.key !== null) return;
        ({ obras, borradas } = leer());
        avisar(null, 'pestana');
    });

    window.FrozenBiblioteca = {
        ESTADOS,
        obtener: id => copiar(obras.get(id)),
        todas: () => [...obras].map(([id, e]) => [id, { ...e }]),
        poner,
        quitar,
        exportar,
        importar,
        registro,
        juntarNube,
        reemplazar,
        vaciar,
        disponible: () => disponible,
        // fn(id, origen) se llama después de cada cambio (id = null si cambiaron varias obras)
        alCambiar: fn => { oyentes.add(fn); return () => oyentes.delete(fn); }
    };
})();
