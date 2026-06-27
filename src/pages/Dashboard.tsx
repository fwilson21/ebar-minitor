import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { suscribirseCambios } from '../lib/realtime';
import type { DashboardResumen, EstacionEbar } from '../lib/types';
import { StationCard } from '../components/StationCard';

export function Dashboard() {
  const [resumen, setResumen] = useState<DashboardResumen | null>(null);
  const [estacionesConProblemas, setEstacionesConProblemas] = useState<EstacionEbar[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    async function cargar() {
      const { data: resumenData } = await supabase.rpc('rpc_dashboard_resumen');
      setResumen(resumenData as DashboardResumen);

      const { data: estaciones } = await supabase
        .from('estaciones_ebar')
        .select('*')
        .neq('estado_actual', 'operativa')
        .eq('activa', true);
      setEstacionesConProblemas((estaciones as EstacionEbar[]) ?? []);

      setCargando(false);
    }

    cargar();

    const detener = suscribirseCambios({
      channelName: 'dashboard-realtime',
      table: 'visitas',
      callback: cargar,
    });

    return () => detener();
  }, []);

  if (cargando) return <p className="text-slate-400">Cargando…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold mb-3">Resumen de hoy</h1>
        <div className="grid grid-cols-2 gap-3">
          <Metrica label="Visitas registradas" valor={resumen?.total_visitas ?? 0} acento="ok" />
          <Metrica label="Estaciones con problemas" valor={resumen?.estaciones_con_problemas ?? 0} acento="warn" />
          <Metrica label="Alertas de voltaje" valor={resumen?.alertas_voltaje ?? 0} acento="danger" />
          <Metrica label="Estaciones sin visitar" valor={resumen?.estaciones_sin_visitar ?? 0} acento="idle" />
        </div>
      </div>

      {estacionesConProblemas.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-300 mb-2">Requieren atención</h2>
          <div className="space-y-2">
            {estacionesConProblemas.map((e) => (
              <StationCard key={e.id} estacion={e} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const COLOR_ACENTO: Record<'ok' | 'warn' | 'danger' | 'idle', string> = {
  ok: 'text-gauge-ok',
  warn: 'text-gauge-warn',
  danger: 'text-gauge-danger',
  idle: 'text-gauge-idle',
};

function Metrica({
  label,
  valor,
  acento,
}: {
  label: string;
  valor: number;
  acento: 'ok' | 'warn' | 'danger' | 'idle';
}) {
  return (
    <div className="tarjeta p-4">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={`text-3xl font-bold lectura ${COLOR_ACENTO[acento]}`}>{valor}</p>
    </div>
  );
}
