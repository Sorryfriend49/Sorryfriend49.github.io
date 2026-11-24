/* ===================================
   FROZEN PROJECT: página de una obra (obra/<id>/, la arma scripts/paginas.mjs)
   El botón Compartir: en el celular abre el menú de compartir del sistema; en el PC copia
   el enlace y lo avisa. Sin JavaScript el botón no aparece (la página se ve igual).
=================================== */
(() => {
    const boton = document.getElementById('compartir');
    const aviso = document.getElementById('avisoCompartir');
    if (!boton || !aviso) return;
    // Siempre la dirección oficial, aunque la página se abra desde otra
    const canonica = document.querySelector('link[rel="canonical"]');
    const url = canonica ? canonica.href : location.href;
    const titulo = (document.querySelector('h1') || {}).textContent || document.title;

    let temporizador = 0;
    function avisar(texto){
        aviso.textContent = texto;
        clearTimeout(temporizador);
        if (texto) temporizador = setTimeout(() => { aviso.textContent = ''; }, 5000);
    }

    boton.hidden = false;
    boton.addEventListener('click', async () => {
        if (navigator.share && window.matchMedia('(pointer: coarse)').matches){
            try {
                await navigator.share({ title: `${titulo} | Frozen Project`, url });
                return;
            } catch (error){
                if (error && error.name === 'AbortError') return;      // la persona cerró el menú
            }
        }
        try {
            await navigator.clipboard.writeText(url);
            avisar('Enlace copiado');
        } catch (error){
            avisar(`No se pudo copiar; el enlace es ${url}`);
        }
    });
})();
