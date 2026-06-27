import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { suscribirseCambios } from '../lib/realtime';
import type { EstacionEbar } from '../lib/types';
import { EstadoBadge } from '../components/EstadoBadge';
import { VOLTAJE_MAX, VOLTAJE_MIN } from '../lib/types';

interface HistorialItem {
  id: string;
  fecha_hora_llegada: string;
  estado_estacion: string;
  nivel_tanque: string;
  operador: string;
  bombas: { numero_bomba: number; estado: string; voltaje: number | null; voltaje_fuera_rango: boolean }[];
  fotos_count: number;
}

export function StationDetail() {
  const { id } = useParams<{ id: string }>();
  const [estacion, setEstacion] = useState<EstacionEbar | null>(null);
  const [historial, setHistorial] = useState<HistorialItem[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!id) return;
    async function cargar() {
      const [{ data: est }, { data: hist }] = await Promise.all([
        supabase.from('estaciones_ebar').select('*').eq('id', id).single(),
        supabase.rpc('rpc_historial_estacion', { p_estacion_id: id, p_limite: 30 }),
      ]);
      setEstacion(est as EstacionEbar);
      setHistorial((hist as HistorialItem[]) ?? []);
      setCargando(false);
    }

    cargar();

    const detener = suscribirseCambios({
      channelName: `station-detail-${id}`,
      table: 'visitas',
      callback: cargar,
      filter: `estacion_id=eq.${id}`,
    });

    return () => detener();
  }, [id]);

  if (cargando) return <p className="text-slate-400">Cargando…</p>;
  if (!estacion) return <p className="text-slate-400">Estación no encontrada.</p>;

  return (
    <div className="space-y-5">
      <div className="tarjeta p-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-bold">{estacion.nombre}</h1>
            <p className="text-sm text-slate-400 lectura">{estacion.codigo}</p>
          </div>
          <EstadoBadge estado={estacion.estado_actual} />
        </div>
        <p className="text-sm text-slate-400 mt-2">{estacion.direccion}</p>
        {estacion.descripcion && <p className="text-sm text-slate-500 mt-1">{estacion.descripcion}</p>}
        {estacion.latitud && estacion.longitud && (
          <a
            className="text-sm text-gauge-ok mt-2 inline-block"
            target="_blank"
            rel="noreferrer"
            href={`https://maps.google.com/?q=${estacion.latitud},${estacion.longitud}`}
          >
            Ver ubicación en el mapa →
          </a>
        )}
      </div>

      <Link to={`/estaciones/${estacion.id}/nueva-visita`} className="boton-primario w-full block text-center">
        + Registrar visita
      </Link>

      <div>
        <h2 className="text-sm font-semibold text-slate-300 mb-2">Historial de visitas</h2>
        {historial.length === 0 ? (
          <p className="text-sm text-slate-500">Aún no hay visitas registradas para esta estación.</p>
        ) : (
          <div className="space-y-2">
            {historial.map((h) => (
              <div key={h.id} className="tarjeta p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{new Date(h.fecha_hora_llegada).toLocaleString('es-EC')}</span>
                  <span className="text-xs text-slate-500">{h.operador}</span>
                </div>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {h.bombas.map((b) => (
                    <span
                      key={b.numero_bomba}
                      className={`text-xs lectura px-2 py-1 rounded border ${
                        b.voltaje_fuera_rango
                          ? 'border-gauge-danger/50 text-gauge-danger bg-gauge-danger/10'
                          : 'border-panel-600 text-slate-400'
                      }`}
                    >
                      B{b.numero_bomba}: {b.voltaje ?? '-'}V
                    </span>
                  ))}
                  {h.fotos_count > 0 && (
                    <span className="text-xs text-slate-500 px-2 py-1">📷 {h.fotos_count}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-slate-600">Rango de voltaje de referencia: {VOLTAJE_MIN}–{VOLTAJE_MAX}V.</p>
    </div>
  );
}
