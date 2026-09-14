import { useState } from 'react';
import type { EstacionEbar, FotoLocal } from '../lib/types';
import { PhotoCapture } from './PhotoCapture';

type EstacionSimple = Pick<EstacionEbar, 'id' | 'nombre' | 'codigo' | 'zona' | 'tipo' | 'direccion' | 'parroquia'>;

const MAX_FOTOS_JUSTIFICACION = 3;

/** Modal chico para poner (o editar) el motivo de "por qué no se visitó" una EBAR, en la fecha
 * que se está viendo en el Dashboard — lo usan tanto "Tus EBAR de hoy" (operador) como
 * "Pendientes de visita" (admin/supervisor). No bloquea nada más allá del motivo + evidencia: se
 * guarda en `justificaciones_no_visita` (migración 0055) y se muestra junto a la tarjeta y en el
 * reporte del día. El mensaje de error va junto al botón "Guardar" (no en un lugar aparte), como
 * el resto de formularios de la app.
 *
 * **Evidencia fotográfica obligatoria** (migración 0063, pedido del usuario 2026-09-13): 1 a 3
 * fotos con la cámara en vivo que respalden el motivo escrito — mismo mecanismo (`PhotoCapture`)
 * que usan las visitas. Al editar una justificación que ya tenía fotos, `fotos`/`cargandoFotos`
 * vienen del padre (`Dashboard.tsx`, que las trae de la base antes de abrir este modal) — no hace
 * falta retomarlas si no se tocan. */
export function ModalJustificarNoVisita({
  estacion,
  motivoInicial,
  fotos,
  cargandoFotos,
  onFotosChange,
  guardando,
  error,
  onGuardar,
  onCerrar,
}: {
  estacion: EstacionSimple;
  motivoInicial: string;
  /** Fotos de evidencia (existentes al editar + las que se vayan tomando en esta sesión) —
   * controladas por el padre, igual que `PhotoCapture`. */
  fotos: FotoLocal[];
  /** `true` mientras el padre trae las fotos ya guardadas de esta justificación (solo al editar
   * una que ya tenía). */
  cargandoFotos: boolean;
  onFotosChange: (fotos: FotoLocal[]) => void;
  guardando: boolean;
  error: string | null;
  onGuardar: (motivo: string) => void;
  onCerrar: () => void;
}) {
  const [motivo, setMotivo] = useState(motivoInicial);
  const puedeGuardar = motivo.trim().length > 0 && fotos.length > 0 && !guardando && !cargandoFotos;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-20" onClick={onCerrar} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-panel-800 border border-panel-600/60 rounded-xl shadow-xl w-[min(420px,94vw)] max-h-[90vh] overflow-y-auto p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="titulo-pantalla text-lg">¿Por qué no se visitó?</h2>
          <button onClick={onCerrar} className="text-slate-600 hover:text-slate-900 text-xl leading-none">
            ✕
          </button>
        </div>
        <p className="text-sm text-slate-600">
          {estacion.nombre}
          {estacion.codigo !== estacion.nombre && <span className="text-slate-400"> · {estacion.codigo}</span>}
        </p>
        <div>
          <label className="etiqueta">Motivo</label>
          <textarea
            className="campo"
            rows={3}
            placeholder="Ej: el equipo estaba en otra EBAR / en otra actividad"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="etiqueta">Evidencia fotográfica (obligatoria, 1 a 3 fotos)</label>
          <p className="text-xs text-slate-500 mb-1">
            Una foto de la EBAR o del lugar/actividad que impidió la visita, para respaldar el motivo de arriba.
          </p>
          {cargandoFotos ? (
            <p className="text-sm text-slate-500">Cargando fotos…</p>
          ) : (
            <PhotoCapture fotos={fotos} onChange={onFotosChange} max={MAX_FOTOS_JUSTIFICACION} />
          )}
        </div>
        <div className="flex items-center justify-end gap-2">
          {error && <p className="text-sm text-gauge-danger mr-auto">{error}</p>}
          <button type="button" className="boton-secundario" onClick={onCerrar}>
            Cancelar
          </button>
          <button type="button" className="boton-primario" disabled={!puedeGuardar} onClick={() => onGuardar(motivo.trim())}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </>
  );
}
