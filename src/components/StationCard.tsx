import { Link } from 'react-router-dom';
import type { EstacionEbar } from '../lib/types';
import { EstadoBadge } from './EstadoBadge';

export function StationCard({ estacion }: { estacion: EstacionEbar }) {
  return (
    <Link
      to={`/estaciones/${estacion.id}`}
      className="tarjeta p-4 flex gap-4 hover:border-gauge-ok/50 transition"
    >
      <div className="w-16 h-16 rounded-lg bg-panel-700 overflow-hidden flex-shrink-0 flex items-center justify-center text-slate-500">
        {estacion.foto_url ? (
          // eslint-disable-next-line jsx-a11y/alt-text
          <img src={estacion.foto_url} className="w-full h-full object-cover" alt={estacion.nombre} />
        ) : (
          <span className="text-2xl">🏭</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-slate-100 truncate">{estacion.nombre}</h3>
          <span className="text-xs text-slate-500 lectura">{estacion.codigo}</span>
        </div>
        <p className="text-sm text-slate-400 truncate">{estacion.direccion ?? 'Sin dirección registrada'}</p>
        <div className="flex items-center gap-2 mt-2">
          <EstadoBadge estado={estacion.estado_actual} />
          <span className="text-xs text-slate-500 uppercase tracking-wide">{estacion.zona}</span>
          <span className="text-xs text-slate-500">· {estacion.numero_bombas} bomba(s)</span>
        </div>
      </div>
    </Link>
  );
}
