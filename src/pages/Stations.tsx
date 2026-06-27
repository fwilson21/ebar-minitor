import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { suscribirseCambios } from '../lib/realtime';
import type { EstacionEbar, ZonaTipo } from '../lib/types';
import { StationCard } from '../components/StationCard';

export function Stations() {
  const [estaciones, setEstaciones] = useState<EstacionEbar[]>([]);
  const [filtroZona, setFiltroZona] = useState<ZonaTipo | 'todas'>('todas');
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    async function cargar() {
      const { data } = await supabase
        .from('estaciones_ebar')
        .select('*')
        .eq('activa', true)
        .order('nombre');

      setEstaciones((data as EstacionEbar[]) ?? []);
      setCargando(false);
    }

    cargar();

    const detener = suscribirseCambios({
      channelName: 'stations-realtime',
      table: 'estaciones_ebar',
      callback: cargar,
    });

    return () => detener();
  }, []);

  const filtradas = estaciones.filter((e) => {
    if (filtroZona !== 'todas' && e.zona !== filtroZona) return false;
    if (busqueda && !`${e.nombre} ${e.codigo}`.toLowerCase().includes(busqueda.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Estaciones EBAR</h1>

      <input
        className="campo"
        placeholder="Buscar por nombre o código…"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
      />

      <div className="flex gap-2">
        {(['todas', 'urbana', 'rural'] as const).map((z) => (
          <button
            key={z}
            onClick={() => setFiltroZona(z)}
            className={`text-sm px-3 py-1.5 rounded-full border ${
              filtroZona === z ? 'bg-gauge-ok/15 border-gauge-ok text-gauge-ok' : 'border-panel-600 text-slate-400'
            }`}
          >
            {z === 'todas' ? 'Todas' : z === 'urbana' ? 'Urbanas' : 'Rurales'}
          </button>
        ))}
      </div>

      {cargando ? (
        <p className="text-slate-400">Cargando…</p>
      ) : filtradas.length === 0 ? (
        <p className="text-slate-400">No se encontraron estaciones.</p>
      ) : (
        <div className="space-y-2">
          {filtradas.map((e) => (
            <StationCard key={e.id} estacion={e} />
          ))}
        </div>
      )}
    </div>
  );
}
