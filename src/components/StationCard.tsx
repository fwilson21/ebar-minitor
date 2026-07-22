import { Link } from 'react-router-dom';
import type { EstacionEbar } from '../lib/types';
import { EstadoBadge } from './EstadoBadge';

function tiempoRelativo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutos = Math.floor(diff / 60000);
  const horas = Math.floor(minutos / 60);
  const dias = Math.floor(horas / 24);
  if (minutos < 1) return 'justo ahora';
  if (minutos < 60) return `hace ${minutos} min`;
  if (horas < 24) return `hace ${horas}h`;
  if (dias === 1) return 'ayer';
  if (dias < 7) return `hace ${dias} días`;
  return new Date(iso).toLocaleDateString('es-EC');
}

export function StationCard({ estacion, ultimaVisita }: { estacion: EstacionEbar; ultimaVisita?: string }) {
  return (
    <Link
      to={`/estaciones/${estacion.id}`}
      className="tarjeta p-4 flex gap-4 hover:border-gauge-ok/50 transition"
    >
      <div className="w-16 h-16 rounded-lg bg-panel-700 overflow-hidden flex-shrink-0 flex items-center justify-center text-slate-500">
        {estacion.foto_url ? (
          <img src={estacion.foto_url} className="w-full h-full object-cover" alt={estacion.nombre} />
        ) : (
          <span className="text-2xl">🏭</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-slate-900 truncate">{estacion.nombre}</h3>
          <span className="text-xs text-slate-500 lectura">{estacion.codigo}</span>
        </div>
        <p className="text-sm text-slate-600 truncate">{estacion.direccion ?? 'Sin dirección registrada'}</p>
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-2">
            <EstadoBadge estado={estacion.estado_actual} />
            <span className="text-xs text-slate-500 uppercase tracking-wide">{estacion.zona}</span>
            {estacion.numero_bombas > 0 && (
              <span className="text-xs text-slate-500">· {estacion.numero_bombas} bomba(s)</span>
            )}
          </div>
          <span className={`text-xs lectura ${ultimaVisita ? 'text-slate-500' : 'text-gauge-warn'}`}>
            {ultimaVisita ? tiempoRelativo(ultimaVisita) : 'Sin visitas'}
          </span>
        </div>
      </div>
    </Link>
  );
}
