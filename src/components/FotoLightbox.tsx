import { useEffect, useRef } from 'react';
import type { FotoLocal } from '../lib/types';

interface Props {
  fotos: FotoLocal[];
  indice: number;
  onCambiarIndice: (i: number) => void;
  onCerrar: () => void;
}

const UMBRAL_SWIPE = 50; // px mínimos de arrastre horizontal para contar como swipe

export function FotoLightbox({ fotos, indice, onCambiarIndice, onCerrar }: Props) {
  const foto = fotos[indice];
  const hayAnterior = indice > 0;
  const haySiguiente = indice < fotos.length - 1;
  const touchStartX = useRef<number | null>(null);

  // Permite cerrar el visor con el botón de retroceso del celular en vez de
  // salir de la pantalla entera: se agrega una entrada de historial "sentinel"
  // al abrir, y se limpia al cerrar (por cualquier vía) para no dejarla huérfana.
  useEffect(() => {
    window.history.pushState({ fotoLightbox: true }, '');
    function onPopState() {
      onCerrar();
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cerrar() {
    window.history.back();
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') cerrar();
      if (e.key === 'ArrowLeft' && indice > 0) onCambiarIndice(indice - 1);
      if (e.key === 'ArrowRight' && indice < fotos.length - 1) onCambiarIndice(indice + 1);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indice, fotos.length]);

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (deltaX > UMBRAL_SWIPE && hayAnterior) onCambiarIndice(indice - 1);
    else if (deltaX < -UMBRAL_SWIPE && haySiguiente) onCambiarIndice(indice + 1);
  }

  if (!foto) return null;
  const src = foto.blob ? URL.createObjectURL(foto.blob) : foto.url_publica;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={cerrar}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <button
        type="button"
        onClick={cerrar}
        className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/60 text-white flex items-center justify-center text-lg z-10"
      >
        ✕
      </button>

      {fotos.length > 1 && (
        <span className="absolute top-4 left-4 text-white text-sm bg-black/60 px-2 py-1 rounded z-10">
          {indice + 1}/{fotos.length}
        </span>
      )}

      {hayAnterior && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onCambiarIndice(indice - 1); }}
          className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center text-2xl z-10"
        >
          ‹
        </button>
      )}

      {haySiguiente && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onCambiarIndice(indice + 1); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center text-2xl z-10"
        >
          ›
        </button>
      )}

      {src && (
        // eslint-disable-next-line jsx-a11y/alt-text
        <img
          src={src}
          onClick={(e) => e.stopPropagation()}
          className="max-w-full max-h-full object-contain"
        />
      )}
    </div>
  );
}
