import { useEffect, useRef, useState } from 'react';
import type { FotoLocal } from '../lib/types';
import { useObjectUrls } from '../lib/useObjectUrls';

interface Props {
  fotos: FotoLocal[];
  indice: number;
  onCambiarIndice: (i: number) => void;
  onCerrar: () => void;
  /** Si viene, muestra esta etiqueta (ej. el capítulo al que pertenece la foto) en la esquina
   * inferior derecha de la foto ampliada — pedido del usuario para la vista previa de informes,
   * donde varias fotos sueltas se están revisando una por una y conviene ver de qué grupo es cada
   * una sin tener que cerrar el visor. Sin esta prop no se muestra nada (comportamiento de antes). */
  etiqueta?: string;
}

const UMBRAL_SWIPE = 50; // px mínimos de arrastre horizontal para contar como swipe
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_PASO_TECLADO = 1.25; // factor por cada pulsación de +/-
const ZOOM_PASO_RUEDA = 1.15; // factor por cada "muesca" de la rueda del mouse

export function FotoLightbox({ fotos, indice, onCambiarIndice, onCerrar, etiqueta }: Props) {
  const foto = fotos[indice];
  const hayAnterior = indice > 0;
  const haySiguiente = indice < fotos.length - 1;
  const touchStartX = useRef<number | null>(null);
  const urls = useObjectUrls(fotos);
  const imgRef = useRef<HTMLImageElement>(null);
  // Ancho ya renderizado en pantalla de la foto (no su resolución real) — para que la etiqueta de
  // abajo salga del MISMO tamaño que la fecha estampada en la propia foto (pedido del usuario). El
  // sello de fecha se dibuja a `anchoRealDeLaFoto * 0.035px` (ver `dibujarSelloFecha` en fotos.ts);
  // como la foto se escala completa para caber en pantalla, ese mismo tamaño en proporción a como
  // se VE queda en `anchoRenderizado * 0.035` — sin necesitar saber la resolución real de la foto.
  const [anchoFoto, setAnchoFoto] = useState<number | null>(null);
  // Zoom con la rueda del mouse o con +/- del teclado (pedido del usuario). `desplazamiento` es el
  // arrastre en px de PANTALLA (no se reescala con el zoom) para poder recorrer la foto una vez
  // ampliada — si no, con zoom no habría forma de ver las esquinas que quedan fuera de pantalla.
  const [escala, setEscala] = useState(1);
  const [desplazamiento, setDesplazamiento] = useState({ x: 0, y: 0 });
  const arrastreRef = useRef<{ x: number; y: number; offX: number; offY: number } | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  // Si el arrastre terminó fuera de la foto (se corrió la mano hasta el fondo negro), el clic que
  // dispara el navegador al soltar cerraría el visor de golpe — esta marca hace que ese único clic
  // se ignore, sin afectar a un clic normal (sin arrastre) sobre el fondo.
  const huboArrastreRef = useRef(false);

  function acercar(factor: number) {
    setEscala((s) => {
      const nueva = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s * factor));
      if (nueva === ZOOM_MIN) setDesplazamiento({ x: 0, y: 0 });
      return nueva;
    });
  }

  // Cada foto arranca sin zoom ni desplazamiento — si no, al pasar a la siguiente con ‹ › quedaría
  // ampliada y descentrada de la que ya se había dejado así en la foto anterior.
  useEffect(() => {
    setEscala(1);
    setDesplazamiento({ x: 0, y: 0 });
  }, [indice]);

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
      // '+'/'=' (misma tecla sin/con Shift en la mayoría de teclados) para acercar, '-' para alejar.
      if (e.key === '+' || e.key === '=') acercar(ZOOM_PASO_TECLADO);
      if (e.key === '-' || e.key === '_') acercar(1 / ZOOM_PASO_TECLADO);
      if (e.key === '0') { setEscala(1); setDesplazamiento({ x: 0, y: 0 }); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indice, fotos.length]);

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    acercar(e.deltaY < 0 ? ZOOM_PASO_RUEDA : 1 / ZOOM_PASO_RUEDA);
  }

  // Arrastre con el mouse para recorrer la foto una vez ampliada — solo activo con zoom (con
  // escala 1 la foto entra completa, no hay nada que recorrer). Se escucha en `window` (no en el
  // propio elemento) para no perder el arrastre si el mouse se mueve más rápido que el cursor
  // puede "seguir" al elemento, algo común al arrastrar rápido.
  function onMouseDownFoto(e: React.MouseEvent) {
    if (escala <= ZOOM_MIN) return;
    e.stopPropagation();
    arrastreRef.current = { x: e.clientX, y: e.clientY, offX: desplazamiento.x, offY: desplazamiento.y };
    huboArrastreRef.current = false;
    setArrastrando(true);
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const inicio = arrastreRef.current;
      if (!inicio) return;
      huboArrastreRef.current = true;
      setDesplazamiento({ x: inicio.offX + (e.clientX - inicio.x), y: inicio.offY + (e.clientY - inicio.y) });
    }
    function onMouseUp() {
      arrastreRef.current = null;
      setArrastrando(false);
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  function onClickFondo() {
    if (huboArrastreRef.current) {
      huboArrastreRef.current = false;
      return;
    }
    cerrar();
  }

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

  // Se re-mide con un ResizeObserver (no solo `onLoad`) porque el tamaño renderizado también
  // cambia al rotar el celular o cambiar de foto (distinta relación de aspecto → distinto ancho
  // final aunque el viewport no se mueva).
  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const medir = () => setAnchoFoto(el.clientWidth || null);
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, [indice]);

  if (!foto) return null;
  const src = foto.blob ? urls[foto.id] : foto.url_publica;
  const fontSizeEtiqueta = anchoFoto ? Math.max(12, Math.round(anchoFoto * 0.035)) : 14;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center overflow-hidden"
      onClick={onClickFondo}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onWheel={onWheel}
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
        // Envoltorio del tamaño exacto de la foto ya renderizada (inline-block se ajusta a su
        // contenido) — así el badge de abajo se puede anclar a LA FOTO y no a la pantalla entera,
        // que es distinto cuando la foto es más angosta o más baja que la pantalla (queda centrada
        // con `object-contain`, con franjas negras a los costados). El tamaño se limita en unidades
        // de viewport (no `max-w-full`/`max-h-full`, que acá dependerían del propio contenido y
        // nunca limitarían nada).
        <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <img
            ref={imgRef}
            src={src}
            onLoad={(e) => setAnchoFoto(e.currentTarget.clientWidth || null)}
            onMouseDown={onMouseDownFoto}
            draggable={false}
            style={{
              transform: `translate(${desplazamiento.x}px, ${desplazamiento.y}px) scale(${escala})`,
              transition: arrastrando ? 'none' : 'transform 0.15s ease-out',
              cursor: escala > ZOOM_MIN ? (arrastrando ? 'grabbing' : 'grab') : 'default',
            }}
            className="block max-w-[92vw] max-h-[85vh] object-contain select-none"
          />
          {etiqueta && (
            // Esquina inferior IZQUIERDA de la FOTO (no de la pantalla) — solo en esta vista
            // ampliada, no en las miniaturas ni en el PDF. Alineado a la izquierda es el orden
            // normal de lectura del texto. Mismo tamaño de letra que la fecha estampada en la
            // propia foto (ver `fontSizeEtiqueta` arriba) — pedido del usuario.
            <span
              style={{ fontSize: fontSizeEtiqueta, padding: `${fontSizeEtiqueta * 0.5}px ${fontSizeEtiqueta * 0.6}px` }}
              className="absolute bottom-2 left-2 max-w-[70%] text-left font-bold text-white bg-black/55 rounded z-10"
            >
              {etiqueta}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
