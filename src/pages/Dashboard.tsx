import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { suscribirseCambios } from '../lib/realtime';
import { useAuth } from '../contexts/AuthContext';
import type { DashboardResumen, EstacionEbar } from '../lib/types';
import { StationCard } from '../components/StationCard';
import { detectarVisitasSospechosas, type ParSospechoso, type VisitaParaChequeo } from '../lib/visitasSospechosas';
import { esDiaNoRegular } from '../lib/feriadosEcuador';

const HOY = new Date().toISOString().slice(0, 10);
const MINIMO_VISITAS_DIA_REGULAR = 2;

type EstacionSimple = Pick<EstacionEbar, 'id' | 'nombre' | 'codigo' | 'zona'>;
type EstacionAsignadaHoy = EstacionSimple & { visitasHoy: number };
type AsignacionBajoMinimo = {
  operador_id: string;
  operador_nombre: string;
  estacion_id: string;
  estacion_nombre: string;
  estacion_codigo: string;
  visitas: number;
};

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
  const [esRegular, setEsRegular] = useState(true);
  const [bajoMinimo, setBajoMinimo] = useState<AsignacionBajoMinimo[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    async function cargar() {
      const [
        { data: resumenData },
        { data: estaciones },
        { data: todasEstaciones },
        { data: visitasDelDia },
        { data: feriadosAdic },
      ] = await Promise.all([
        supabase.rpc('rpc_dashboard_resumen', { p_fecha: fecha }),
        supabase.from('estaciones_ebar').select('*').neq('estado_actual', 'operativa').eq('activa', true),
        supabase.from('estaciones_ebar').select('id, nombre, codigo, zona').eq('activa', true).order('nombre'),
        supabase.from('visitas').select('estacion_id, operador_id')
          .gte('fecha_hora_llegada', `${fecha}T00:00:00`)
          .lte('fecha_hora_llegada', `${fecha}T23:59:59`),
        supabase.from('feriados_adicionales').select('fecha'),
      ]);

      setResumen(resumenData as DashboardResumen);

      // Para operadores: sus EBAR asignadas hoy (por defecto o especial) filtran "Requieren
      // atención" y "Pendientes de visita", además de armar "Tus EBAR de hoy" más abajo. Si
      // todavía no tiene ninguna, no ve ninguna estación en estas secciones: la asignación la
      // controla exclusivamente el administrador/supervisor desde "Asignar". Si no hay señal
      // para verificarlo (la consulta falla y devuelve null), no se filtra nada.
      let idsAsignadosHoy: Set<string> | null = null;
      const estacionesAsignadasInfo = new Map<string, EstacionSimple>();
      if (usuario?.rol === 'operador') {
        const { data: asignaciones } = await supabase
          .from('asignaciones_estacion')
          .select('estacion_id, estaciones_ebar ( id, nombre, codigo, zona )')
          .eq('operador_id', usuario.id)
          .or(`fecha.is.null,fecha.eq.${fecha}`);
        if (asignaciones !== null) {
          for (const a of asignaciones as any[]) {
            const est = a.estaciones_ebar;
            if (est) estacionesAsignadasInfo.set(est.id, est);
          }
          idsAsignadosHoy = new Set(estacionesAsignadasInfo.keys());
        }
      }

      const listaConProblemas = ((estaciones as EstacionEbar[]) ?? []).filter(
        (e) => !idsAsignadosHoy || idsAsignadosHoy.has(e.id),
      );
      setEstacionesConProblemas(listaConProblemas);

      const idsConVisita = new Set((visitasDelDia ?? []).map((v: any) => v.estacion_id));
      setSinVisitar(
        ((todasEstaciones ?? []) as EstacionSimple[]).filter(
          (e) => !idsConVisita.has(e.id) && (!idsAsignadosHoy || idsAsignadosHoy.has(e.id)),
        ),
      );

      // "Mínimo de 2 visitas" (ver más abajo) solo aplica en días regulares: ni sábado/domingo,
      // ni feriado (calculado + agregados a mano en feriados_adicionales).
      const feriadosSet = new Set(((feriadosAdic as any[]) ?? []).map((f) => f.fecha as string));
      const regular = !esDiaNoRegular(fecha, feriadosSet);
      setEsRegular(regular);

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

      // "Por debajo del mínimo de 2 visitas": solo en días regulares, solo admin/supervisor —
      // no bloquea nada, es un indicador para que el supervisor note quién se está quedando
      // corto. Compara, para cada par operador+estación asignado ese día, cuántas visitas de
      // ESE operador hay registradas contra el mínimo.
      if (esAdmin && regular) {
        const { data: asignacionesTodas } = await supabase
          .from('asignaciones_estacion')
          .select('operador_id, estacion_id, usuarios ( nombre_completo ), estaciones_ebar ( codigo, nombre )')
          .or(`fecha.is.null,fecha.eq.${fecha}`);

        const conteoVisitas: Record<string, number> = {};
        for (const v of (visitasDelDia as any[]) ?? []) {
          const clave = `${v.operador_id}:${v.estacion_id}`;
          conteoVisitas[clave] = (conteoVisitas[clave] ?? 0) + 1;
        }

        const combosUnicos = new Map<string, any>();
        for (const a of (asignacionesTodas as any[]) ?? []) {
          combosUnicos.set(`${a.operador_id}:${a.estacion_id}`, a);
        }

        const listaBajoMinimo: AsignacionBajoMinimo[] = [...combosUnicos.entries()]
          .map(([clave, a]) => ({
            operador_id: a.operador_id,
            operador_nombre: a.usuarios?.nombre_completo ?? '-',
            estacion_id: a.estacion_id,
            estacion_nombre: a.estaciones_ebar?.nombre ?? '-',
            estacion_codigo: a.estaciones_ebar?.codigo ?? '-',
            visitas: conteoVisitas[clave] ?? 0,
          }))
          .filter((a) => a.visitas < MINIMO_VISITAS_DIA_REGULAR)
          .sort(
            (a, b) =>
              a.operador_nombre.localeCompare(b.operador_nombre) || a.estacion_nombre.localeCompare(b.estacion_nombre),
          );

        setBajoMinimo(listaBajoMinimo);
      } else {
        setBajoMinimo([]);
      }

      // "Tus EBAR de hoy": solo para operadores — reutiliza estacionesAsignadasInfo (ya cargado
      // arriba, combina asignación por defecto + especial de hoy) y le agrega cuántas visitas
      // lleva registradas hoy este mismo operador en cada una.
      if (usuario?.rol === 'operador') {
        const idsAsignados = [...estacionesAsignadasInfo.keys()];
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
          [...estacionesAsignadasInfo.values()]
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
            Tus EBAR de hoy (
            {misEstacionesHoy.filter((e) => e.visitasHoy >= (esRegular ? MINIMO_VISITAS_DIA_REGULAR : 1)).length}/
            {misEstacionesHoy.length} {esRegular ? `con ${MINIMO_VISITAS_DIA_REGULAR} visitas` : 'visitadas'})
          </h2>
          {!esRegular && misEstacionesHoy.length > 0 && (
            <p className="text-xs text-slate-500 mb-2">
              Hoy no aplica el mínimo de {MINIMO_VISITAS_DIA_REGULAR} visitas (fin de semana o feriado).
            </p>
          )}
          {misEstacionesHoy.length === 0 ? (
            <p className="text-sm text-slate-500">
              Aún no tienes estaciones asignadas para hoy. Habla con tu administrador o supervisor.
            </p>
          ) : (
            <div className="space-y-2">
              {misEstacionesHoy.map((e) => {
                const meta = esRegular ? MINIMO_VISITAS_DIA_REGULAR : 1;
                const completa = e.visitasHoy >= meta;
                const color = completa ? 'text-gauge-ok' : e.visitasHoy > 0 ? 'text-gauge-warn' : 'text-gauge-danger';
                return (
                  <Link
                    key={e.id}
                    to={`/estaciones/${e.id}/nueva-visita`}
                    className="tarjeta p-3 flex items-center justify-between hover:border-gauge-ok/50 transition"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-100">{e.nombre}</p>
                      <p className="text-xs text-slate-500 lectura uppercase tracking-wide">{e.codigo} · {e.zona}</p>
                    </div>
                    <span className={`text-xs flex-shrink-0 ${color}`}>
                      {esRegular
                        ? `${Math.min(e.visitasHoy, MINIMO_VISITAS_DIA_REGULAR)}/${MINIMO_VISITAS_DIA_REGULAR} hoy`
                        : e.visitasHoy > 0
                          ? `${e.visitasHoy} visita${e.visitasHoy > 1 ? 's' : ''} hoy`
                          : 'Sin visitar'}
                    </span>
                  </Link>
                );
              })}
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

      {esAdmin && bajoMinimo.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-300 mb-2">
            ⚠️ Por debajo del mínimo de {MINIMO_VISITAS_DIA_REGULAR} visitas ({bajoMinimo.length})
          </h2>
          <div className="space-y-2">
            {bajoMinimo.map((b) => (
              <div
                key={`${b.operador_id}:${b.estacion_id}`}
                className="tarjeta p-3 border border-gauge-warn/40 flex items-center justify-between"
              >
                <div>
                  <p className="text-sm font-medium text-slate-100">{b.operador_nombre}</p>
                  <p className="text-xs text-slate-400">{b.estacion_codigo} — {b.estacion_nombre}</p>
                </div>
                <span className="text-xs text-gauge-warn flex-shrink-0">
                  {b.visitas}/{MINIMO_VISITAS_DIA_REGULAR}
                </span>
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
