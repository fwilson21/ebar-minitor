import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// Por debajo de esta escala, encoger ya no ayuda (el texto queda ilegible/imposible de tocar) —
// en ese caso se desiste de encoger y se deja el scroll de siempre como respaldo. Así un bloque
// genuinamente largo (ej. "Lista de estaciones" con 50 filas) no se encoge en vano y sigue
// leyéndose a tamaño normal mientras se hace scroll, igual que antes.
const ESCALA_MINIMA = 0.55;

/**
 * Envuelve el contenido de un bloque de GridEditable para que, si el administrador lo achica con
 * "Editar distribución" y el contenido ya no entra completo, se vea encogido en vez de quedar
 * cortado fuera de la vista (que era el problema: al arrastrar la esquina/borde inferior de un
 * bloque, el bloque se achicaba pero el contenido de adentro se quedaba del mismo tamaño y se
 * perdía lo que quedaba fuera). Mide el tamaño natural del contenido (sin encoger) contra el
 * espacio disponible y aplica la escala justa para que quepa entero — solo si con eso alcanza
 * (ver ESCALA_MINIMA); si no, no encoge y deja el scroll normal.
 */
export function BloqueAutoEncogible({ children }: { children: ReactNode }) {
  const contenedorRef = useRef<HTMLDivElement>(null);
  const contenidoRef = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(1);

  function recalcular() {
    const contenedor = contenedorRef.current;
    const contenido = contenidoRef.current;
    if (!contenedor || !contenido) return;
    const disponibleAncho = contenedor.clientWidth;
    const disponibleAlto = contenedor.clientHeight;
    if (disponibleAncho === 0 || disponibleAlto === 0) return;
    // scrollWidth/scrollHeight reflejan el tamaño natural del contenido (el transform de escala
    // no participa en el layout, así que esta medición no se retroalimenta con la escala actual).
    const necesarioAncho = contenido.scrollWidth;
    const necesarioAlto = contenido.scrollHeight;
    const ideal = Math.min(1, disponibleAncho / necesarioAncho, disponibleAlto / necesarioAlto);
    const siguiente = Number.isFinite(ideal) && ideal >= ESCALA_MINIMA ? ideal : 1;
    setEscala((prev) => (Math.abs(siguiente - prev) < 0.001 ? prev : siguiente));
  }

  // Reobserva el tamaño disponible en tiempo real — hace falta un ResizeObserver aparte del ciclo
  // normal de React porque, al arrastrar el borde de un bloque en "Editar distribución", el tamaño
  // cambia en vivo (vía react-grid-layout/react-resizable) sin esperar a que React vuelva a renderizar.
  useLayoutEffect(() => {
    const contenedor = contenedorRef.current;
    if (!contenedor) return;
    const observer = new ResizeObserver(recalcular);
    observer.observe(contenedor);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recalcula también cuando cambia el contenido en sí (ej. crece una lista) aunque el tamaño del
  // bloque no se haya movido.
  useLayoutEffect(() => {
    recalcular();
  });

  return (
    <div ref={contenedorRef} className="w-full h-full overflow-auto">
      <div ref={contenidoRef} style={{ transform: `scale(${escala})`, transformOrigin: 'top left' }}>
        {children}
      </div>
    </div>
  );
}
