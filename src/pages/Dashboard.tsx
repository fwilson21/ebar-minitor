import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { suscribirseCambios } from '../lib/realtime';
import { useAuth } from '../contexts/AuthContext';
import type { DashboardResumen, EstacionEbar } from '../lib/types';
import { StationCard } from '../components/StationCard';
import { detectarVisitasSospechosas, type ParSospechoso, type VisitaParaChequeo } from '../lib/visitasSospechosas';

const HOY = new Date().toISOString().slice(0, 10);

type EstacionSimple = Pick<EstacionEbar, 'id' | 'nombre' | 'codigo' | 'zona'>;
type EstacionAsignadaHoy = EstacionSimple & { visitasHoy: number };

export function Dashboard() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'administrador' || usuario?.rol === 'supervisor';
  const [fecha, setFecha] = useState(HOY);
  const [resumen, setResumen] = useState<DashboardResumen | null>(null);
  const [estacionesConProblemas, setEstacionesConProblemas] = useState<EstacionEbar[]>([]);
  const [ultimasVisitas, setUltimasVisitas] = useState<Record<string, string>>({});
  const [sinVisitar, setSinVisitar] = useState<EstacionSimple[]>([]);
  const [mostrarSinVisitar, setMostrarSinVisitar] = useState(true);
  const [sospechosas, setSospechosas] = useState<ParSospechoso[]>([]);
  const [misEstacionesHoy, setMisEstacionesHoy] = useState<EstacionAsignadaHoy[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    async function cargar() {
      const [
        { data: resumenData },
        { data: estaciones },
        { data: todasEstaciones },
        { data: visitasDelDia },
      ] = await Promise.all([
        supabase.rpc('rpc_dashboard_resumen', { p_fecha: fecha }),
        supabase.from('estaciones_ebar').select('*').neq('estado_actual', 'operativa').eq('activa', true),
        supabase.from('estaciones_ebar').select('id, nombre, codigo, zona').eq('activa', true).order('nombre'),
        supabase.from('visitas').select('estacion_id')
          .gte('fecha_hora_llegada', `${fecha}T00:00:00`)
          .lte('fecha_hora_llegada', `${fecha}T23:59:59`),
      ]);

      setResumen(resumenData as DashboardResumen);
      const listaConProblemas = (estaciones as EstacionEbar[]) ?? [];
      setEstacionesConProblemas(listaConProblemas);

      const idsConVisita = new Set((visitasDelDia ?? []).map((v: any) => v.estacion_id));
      setSinVisitar(((todasEstaciones ?? []) as EstacionSimple[]).filter((e) => !idsConVisita.has(e.id)));

      if (listaConProblemas.length > 0) {
        const { data: visitasRecientes } = await supabase
          .from('visitas')
          .select('estacion_id, fecha_hora_llegada')
          .in('estacion_id', listaConProblemas.map((e) => e.id))
          .order('fecha_hora_llegada', { ascending: false });

        const mapa: Record<string, string> = {};
        for (const v of visitasRecientes ?? []) {
          if (!mapa[v.estacion_id]) mapa[v.estacion_id] = v.fecha_hora_llegada;
        }
        setUltimasVisitas(mapa);
      } else {
        setUltimasVisitas({});
      }

      // Alerta de "salto geográfico" entre visitas consecutivas de un mismo operador — es
      // información sobre el desempeño de otros operadores, así que solo se consulta y se
      // muestra a admin/supervisor, nunca a operadores viendo su propio dashboard.
      if (esAdmin) {
        const hace14Dias = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
        const { data: visitasRecientesTodas } = await supabase
          .from('visitas')
          .select('id, operador_id, estacion_id, fecha_hora_llegada, usuarios ( nombre_completo ), estaciones_ebar ( nombre, latitud, longitud )')
          .gte('fecha_hora_llegada', hace14Dias)
          .order('fecha_hora_llegada', { ascending: true });

        const paraChequeo: VisitaParaChequeo[] = ((visitasRecientesTodas as any[]) ?? []).map((v) => ({
          id: v.id,
          operador_id: v.operador_id,
          operador_nombre: v.usuarios?.nombre_completo ?? '-',
          estacion_id: v.estacion_id,
          estacion_nombre: v.estaciones_ebar?.nombre ?? '-',
          fecha_hora_llegada: v.fecha_hora_llegada,
          lat: v.estaciones_ebar?.latitud ?? null,
          lon: v.estaciones_ebar?.longitud ?? null,
        }));
        setSospechosas(detectarVisitasSospechosas(paraChequeo));
      } else {
        setSospechosas([]);
      }

      // "Tus EBAR de hoy": solo para operadores — combina su asignación por defecto (fecha null)
      // con las especiales para el día puntual seleccionado (siempre "hoy" en el caso del
      // operador, ya que el selector de fecha de arriba no se le muestra).
      if (usuario?.rol === 'operador') {
        const { data: asignaciones } = await supabase
          .from('asignaciones_estacion')
          .select('estacion_id, estaciones_ebar ( id, nombre, codigo, zona )')
          .eq('operador_id', usuario.id)
          .or(`fecha.is.null,fecha.eq.${fecha}`);

        const estacionesUnicas = new Map<string, EstacionSimple>();
        for (const a of (asignaciones as any[]) ?? []) {
          const est = a.estaciones_ebar;
          if (est) estacionesUnicas.set(est.id, est);
        }

        const idsAsignados = [...estacionesUnicas.keys()];
        const visitasPorEstacion: Record<string, number> = {};
        if (idsAsignados.length > 0) {
          const { data: misVisitas } = await supabase
            .from('visitas')
            .select('estacion_id')
            .eq('operador_id', usuario.id)
            .in('estacion_id', idsAsignados)
            .gte('fecha_hora_llegada', `${fecha}T00:00:00`)
            .lte('fecha_hora_llegada', `${fecha}T23:59:59`);
          for (const v of misVisitas ?? []) {
            visitasPorEstacion[v.estacion_id] = (visitasPorEstacion[v.estacion_id] ?? 0) + 1;
          }
        }

        setMisEstacionesHoy(
          [...estacionesUnicas.values()]
            .map((e) => ({ ...e, visitasHoy: visitasPorEstacion[e.id] ?? 0 }))
            .sort((a, b) => a.nombre.localeCompare(b.nombre)),
        );
      } else {
        setMisEstacionesHoy([]);
      }

      setCargando(false);
    }

    cargar();

    const detener = suscribirseCambios({
      channelName: 'dashboard-realtime',
      table: 'visitas',
      callback: cargar,
    });

    return () => detener();
  }, [fecha]);

  const esHoy = fecha === HOY;
  const tituloFecha = esHoy
    ? 'Resumen de hoy'
    : `Resumen del ${new Date(fecha + 'T12:00:00').toLocaleDateString('es-EC', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })}`;

  if (cargando) return <p className="text-slate-400">Cargando…</p>;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-bold">{tituloFecha}</h1>
          {esAdmin && (
            <input
              type="date"
              className="campo py-1 text-sm w-auto"
              value={fecha}
              max={HOY}
              onChange={(e) => { setCargando(true); setFecha(e.target.value); }}
            />
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Metrica label="Visitas registradas" valor={resumen?.total_visitas ?? 0} acento="ok" />
          <Metrica label="Estaciones sin visitar" valor={resumen?.estaciones_sin_visitar ?? 0} acento="idle" />
          <Metrica label="Equipos con falla o por mantener" valor={resumen?.equipos_con_alerta ?? 0} acento="danger" />
          <Metrica label="Estaciones con problemas" valor={resumen?.estaciones_con_problemas ?? 0} acento="warn" />
          <Metrica label="Alertas de voltaje" valor={resumen?.alertas_voltaje ?? 0} acento="danger" />
        </div>
      </div>

      {!esAdmin && (
        <div>
          <h2 className="text-sm font-semibold text-slate-300 mb-2">
            Tus EBAR de hoy ({misEstacionesHoy.filter((e) => e.visitasHoy > 0).length}/{misEstacionesHoy.length} visitadas)
          </h2>
          {misEstacionesHoy.length === 0 ? (
            <p className="text-sm text-slate-500">
              Aún no tienes estaciones asignadas para hoy. Habla con tu administrador o supervisor.
            </p>
          ) : (
            <div className="space-y-2">
              {misEstacionesHoy.map((e) => (
                <Link
                  key={e.id}
                  to={`/estaciones/${e.id}/nueva-visita`}
                  className="tarjeta p-3 flex items-center justify-between hover:border-gauge-ok/50 transition"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-100">{e.nombre}</p>
                    <p className="text-xs text-slate-500 lectura uppercase tracking-wide">{e.codigo} · {e.zona}</p>
                  </div>
                  <span className={`text-xs flex-shrink-0 ${e.visitasHoy > 0 ? 'text-gauge-ok' : 'text-gauge-warn'}`}>
                    {e.visitasHoy > 0 ? `${e.visitasHoy} visita${e.visitasHoy > 1 ? 's' : ''} hoy` : 'Sin visitar'}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {sinVisitar.length > 0 && (
        <div>
          <button
            className="flex items-center justify-between w-full mb-2"
            onClick={() => setMostrarSinVisitar((v) => !v)}
          >
            <h2 className="text-sm font-semibold text-slate-300">
              Pendientes de visita ({sinVisitar.length})
            </h2>
            <span className="text-xs text-slate-500">{mostrarSinVisitar ? '▲ ocultar' : '▼ ver'}</span>
          </button>
          {mostrarSinVisitar && (
            <div className="space-y-2">
              {sinVisitar.map((e) => (
                <Link
                  key={e.id}
                  to={`/estaciones/${e.id}/nueva-visita`}
                  className="tarjeta p-3 flex items-center justify-between hover:border-gauge-ok/50 transition"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-100">{e.nombre}</p>
                    <p className="text-xs text-slate-500 lectura uppercase tracking-wide">{e.codigo} · {e.zona}</p>
                  </div>
                  <span className="text-xs text-gauge-ok flex-shrink-0">+ Visita →</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {estacionesConProblemas.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-300 mb-2">Requieren atención</h2>
          <div className="space-y-2">
            {estacionesConProblemas.map((e) => (
              <StationCard key={e.id} estacion={e} ultimaVisita={ultimasVisitas[e.id]} />
            ))}
          </div>
        </div>
      )}

      {esAdmin && sospechosas.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-300 mb-2">
            ⚠️ Visitas con horario sospechoso ({sospechosas.length})
          </h2>
          <div className="space-y-2">
            {sospechosas.map((s, i) => (
              <div key={i} className="tarjeta p-3 border border-gauge-warn/40">
                <p className="text-sm font-medium text-slate-100">{s.operador_nombre}</p>
                <p className="text-xs text-slate-400">
                  {s.visitaAnterior.estacion_nombre} → {s.visitaSiguiente.estacion_nombre}
                  {' · '}
                  {s.km.toFixed(1)} km en {Math.round(s.minutos)} min
                </p>
                <p className="text-xs text-slate-500">
                  {formatFechaCorta(s.visitaAnterior.fecha_hora_llegada)} → {formatFechaCorta(s.visitaSiguiente.fecha_hora_llegada)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatFechaCorta(fechaIso: string): string {
  return new Date(fechaIso).toLocaleString('es-EC', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
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
