import { useEffect, useState, type ReactNode } from 'react';
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import type { BloqueDefinicion } from '../lib/pantallasEditables';
import { obtenerLayout, type BloqueLayout } from '../lib/layoutsAdmin';

const Grid = WidthProvider(GridLayout);

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
        cols={12}
        rowHeight={40}
        layout={layout}
        onLayoutChange={modoEdicion ? (nuevo: Layout[]) => setLayout(nuevo as BloqueLayout[]) : undefined}
        isDraggable={modoEdicion}
        isResizable={modoEdicion}
        compactType="vertical"
        draggableCancel=".gridEditable-noArrastrar"
      >
        {bloques.map((b) => (
          <div key={b.id} className="h-full min-h-0 overflow-auto">
            {renderBloque(b.id)}
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
