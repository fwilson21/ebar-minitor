import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

export interface TamanoModal {
  ancho: number;
  alto: number;
}

/** Manija en la esquina inferior derecha de un modal — visible solo para quien pueda ajustar el
 * tamaño (ver el `esAdmin` de cada pantalla que la usa; siempre el rol administrador real, no
 * delegable por permiso). Arrastrarla cambia el tamaño en vivo (`onCambiar`, en cada movimiento);
 * soltar persiste el tamaño final (`onGuardar`, una sola vez) para que se vea igual la próxima
 * vez que cualquier rol abra el modal. Usa Pointer Events (no mouse/touch por separado) para que
 * funcione igual con mouse y con el dedo en tablet/celular.
 *
 * El elemento padre debe ser `position: relative` o `fixed` (esta manija se posiciona `absolute`
 * en su esquina inferior derecha) y NO tener `overflow` recortando esa esquina. */
export function ManijaRedimension({
  tamano,
  min,
  max,
  onCambiar,
  onGuardar,
}: {
  tamano: TamanoModal;
  min: TamanoModal;
  max: TamanoModal;
  onCambiar: (t: TamanoModal) => void;
  onGuardar: (t: TamanoModal) => void;
}) {
  const tamanoRef = useRef(tamano);
  useEffect(() => {
    tamanoRef.current = tamano;
  }, [tamano]);

  function manejarPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const inicioX = e.clientX;
    const inicioY = e.clientY;
    const anchoInicial = tamano.ancho;
    const altoInicial = tamano.alto;

    function mover(ev: PointerEvent) {
      const ancho = Math.min(max.ancho, Math.max(min.ancho, Math.round(anchoInicial + (ev.clientX - inicioX))));
      const alto = Math.min(max.alto, Math.max(min.alto, Math.round(altoInicial + (ev.clientY - inicioY))));
      onCambiar({ ancho, alto });
    }
    function soltar() {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      onGuardar(tamanoRef.current);
    }
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }

  return (
    <div
      onPointerDown={manejarPointerDown}
      title="Arrastrar para cambiar el tamaño"
      className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize touch-none flex items-end justify-end p-1 text-slate-400 hover:text-slate-700"
    >
      <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
        <circle cx="13" cy="3" r="1.4" />
        <circle cx="13" cy="8" r="1.4" />
        <circle cx="8" cy="13" r="1.4" />
        <circle cx="13" cy="13" r="1.4" />
      </svg>
    </div>
  );
}
