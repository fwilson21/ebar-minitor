import { useEffect, useState, type ReactNode } from 'react';
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import type { BloqueDefinicion } from '../lib/pantallasEditables';
import { obtenerLayout, type BloqueLayout } from '../lib/layoutsAdmin';

const Grid = WidthProvider(GridLayout);

// Resolución del grid: el doble de fina que antes (24 columnas de ancho x 20px de alto por fila,
// en vez de 12 x 40px) para poder mover/redimensionar un bloque en pasos más chicos al arrastrar
// en Distribución de entorno, en vez de saltar de "chico" a "grande" sin nada en el medio. Si se
// vuelve a cambiar este número, hay que escalar por el mismo factor los defaultLayout de
// pantallasEditables.ts y correr una migración que reescale lo ya guardado en Supabase.
const COLUMNAS = 24;
const ALTO_FILA = 20;

function layoutPorDefecto(bloques: BloqueDefinicion[]): BloqueLayout[] {
  return bloques.map((b) => ({ i: b.id, ...b.defaultLayout }));
}

type Props = {
  pantallaId: string;
  bloques: BloqueDefinicion[];
  renderBloque: (bloqueId: string) => ReactNode;
  modoEdicion?: boolean;
  onGuardar?: (layout: BloqueLayout[]) => void;
  /** Incrementar este número (desde el padre, ej. botón "Restablecer por defecto" en
   * DistribucionEntorno) fuerza el grid a volver a defaultLayout sin tocar lo guardado en
   * Supabase — solo se persiste si después se llama a onGuardar. */
  resetSignal?: number;
};

export function GridEditable({ pantallaId, bloques, renderBloque, modoEdicion = false, onGuardar, resetSignal }: Props) {
  const [layout, setLayout] = useState<BloqueLayout[] | null>(null);

  useEffect(() => {
    let cancelado = false;
    obtenerLayout(pantallaId).then((guardado) => {
      if (cancelado) return;
      setLayout(guardado ?? layoutPorDefecto(bloques));
    });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pantallaId]);

  useEffect(() => {
    if (resetSignal === undefined) return;
    setLayout(layoutPorDefecto(bloques));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  if (!layout) return <p className="text-sm text-slate-600">Cargando distribución…</p>;

  return (
    <div className="space-y-3">
      <Grid
        cols={COLUMNAS}
        rowHeight={ALTO_FILA}
        layout={layout}
        onLayoutChange={modoEdicion ? (nuevo: Layout[]) => setLayout(nuevo as BloqueLayout[]) : undefined}
        isDraggable={modoEdicion}
        isResizable={modoEdicion}
        compactType="vertical"
        // En modo edición, solo se puede arrastrar agarrando la manija de arriba — así el resto
        // del bloque (botones, calendario, campos) se puede seguir usando normal mientras se está
        // acomodando la pantalla, en vez de que cualquier clic mueva el bloque por accidente.
        draggableHandle={modoEdicion ? '.gridEditable-manija' : undefined}
        draggableCancel=".gridEditable-noArrastrar"
      >
        {bloques.map((b) => (
          <div key={b.id} className="h-full min-h-0 flex flex-col">
            {modoEdicion && (
              <div className="gridEditable-manija cursor-move bg-panel-700 border border-b-0 border-panel-600 text-xs font-medium text-slate-600 px-2 py-1 rounded-t-lg flex items-center gap-1.5 flex-shrink-0 select-none">
                <span aria-hidden="true">⠿</span> {b.titulo}
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-auto">{renderBloque(b.id)}</div>
          </div>
        ))}
      </Grid>

      {modoEdicion && (
        <button onClick={() => onGuardar?.(layout)} className="boton-primario w-full">
          Guardar distribución
        </button>
      )}
    </div>
  );
}
