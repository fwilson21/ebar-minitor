import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { suscribirseCambios } from '../lib/realtime';
import { useAuth } from '../contexts/AuthContext';
import type { DashboardResumen, EstacionEbar } from '../lib/types';
import { StationCard } from '../components/StationCard';
import { detectarVisitasSospechosas, type ParSospechoso, type VisitaParaChequeo } from '../lib/visitasSospechosas';
import { esDiaNoRegular } from '../lib/feriadosEcuador';
import { GridEditable } from '../components/GridEditable';
import { BarraDistribucion } from '../components/BarraDistribucion';
import { PANTALLAS_EDITABLES } from '../lib/pantallasEditables';
import { useEditorDistribucion } from '../hooks/useEditorDistribucion';

const HOY = new Date().toISOString().slice(0, 10);
const MINIMO_VISITAS_DIA_REGULAR = 2;

type EstacionSimple = Pick<EstacionEbar, 'id' | 'nombre' | 'codigo' | 'zona' | 'tipo'>;
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
  const { usuario, tienePermiso } = useAuth();
  const esAdmin = usuario?.rol === 'administrador' || usuario?.rol === 'supervisor';
  // "Editar distribución" es del administrador real o de quien tenga el permiso
  // 'editar_distribucion' (ver /permisos) — ni siquiera supervisor lo tiene por defecto, igual
  // que era la vieja pantalla separada de Distribución de entorno.
  const esAdministrador = usuario?.rol === 'administrador';
  const puedeEditarDistribucion = esAdministrador || tienePermiso('editar_distribucion');
  const editorDistribucion = useEditorDistribucion('dashboard');
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
        supabase.rpc('rpc_dashboard_resumen', {
          p_fecha: fecha,
          // Para un operador, las 5 métricas de arriba se calculan solo con sus visitas y sus
          // EBAR asignadas (no toda la empresa) — antes mostraba números globales que no tenían
          // relación con lo que ese operador había hecho.
          p_operador_id: usuario?.rol === 'operador' ? usuario.id : null,
        }),
        supabase.from('estaciones_ebar').select('*').neq('estado_actual', 'operativa').eq('activa', true),
        supabase.from('estaciones_ebar').select('id, nombre, codigo, zona, tipo').eq('activa', true).order('nombre'),
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
          .select('estacion_id, estaciones_ebar ( id, nombre, codigo, zona, tipo )')
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

  // Digitador no tiene esta pantalla (su trabajo es Turnos/Reportes, no monitoreo) — se manda
  // directo a Turnos en vez de mostrarle un mensaje de "no disponible" en lo primero que ve al
  // entrar a la app.
  if (usuario?.rol === 'digitador') return <Navigate to="/calendario-turnos" replace />;

  if (cargando) return <p className="text-slate-600">Cargando…</p>;

  function cambiarFecha(nueva: string) {
    setCargando(true);
    setFecha(nueva);
  }

  // Los bloques que ni admin/supervisor ni operador llegan a ver nunca (según el mismo criterio
  // de arriba: "tus_ebar_hoy" es solo de operador, "visitas_sospechosas"/"bajo_minimo" son solo
  // de admin/supervisor) se sacan del todo del grid editable — antes quedaban como una celda
  // vacía y arrastrable sin ningún contenido dentro.
  const bloquesDashboard = PANTALLAS_EDITABLES.find((p) => p.id === 'dashboard')!.bloques.filter((b) => {
    if (b.id === 'tus_ebar_hoy') return !esAdmin;
    if (b.id === 'visitas_sospechosas' || b.id === 'bajo_minimo') return esAdmin;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Celular: exactamente el mismo apilado de siempre, sin GridEditable. */}
      <div className="lg:hidden space-y-6">
        <BloqueResumenGeneral tituloFecha={tituloFecha} esAdmin={esAdmin} fecha={fecha} hoy={HOY} onCambiarFecha={cambiarFecha} resumen={resumen} />
        {!esAdmin && <BloqueTusEbarHoy misEstacionesHoy={misEstacionesHoy} esRegular={esRegular} />}
        <BloquePendientesVisita sinVisitar={sinVisitar} mostrarSinVisitar={mostrarSinVisitar} setMostrarSinVisitar={setMostrarSinVisitar} />
        <BloqueRequierenAtencion estacionesConProblemas={estacionesConProblemas} ultimasVisitas={ultimasVisitas} />
        {esAdmin && <BloqueVisitasSospechosas sospechosas={sospechosas} />}
        {esAdmin && <BloqueBajoMinimo bajoMinimo={bajoMinimo} />}
      </div>

      {/* Escritorio (lg+): mismos bloques, acomodados según lo guardado (o el acomodo por
          defecto). "Tus EBAR de hoy" solo existe para operador, y los de admin/supervisor no
          existen para operador — a quien no le toca ver un bloque, esa celda del grid queda
          vacía. Solo el administrador ve "Editar distribución" (ni siquiera supervisor). */}
      <div className="hidden lg:block space-y-3">
        {puedeEditarDistribucion && <BarraDistribucion editor={editorDistribucion} />}
        <GridEditable
          pantallaId="dashboard"
          bloques={bloquesDashboard}
          modoEdicion={puedeEditarDistribucion && editorDistribucion.modoEdicion}
          resetSignal={editorDistribucion.resetSignal}
          objetivoEdicion={editorDistribucion.objetivoActivo}
          onGuardar={editorDistribucion.guardar}
          renderBloque={(bloqueId) => {
            switch (bloqueId) {
              case 'resumen_general':
                return (
                  <BloqueResumenGeneral
                    tituloFecha={tituloFecha}
                    esAdmin={esAdmin}
                    fecha={fecha}
                    hoy={HOY}
                    onCambiarFecha={cambiarFecha}
                    resumen={resumen}
                  />
                );
              case 'tus_ebar_hoy':
                return !esAdmin ? <BloqueTusEbarHoy misEstacionesHoy={misEstacionesHoy} esRegular={esRegular} /> : null;
              case 'pendientes_visita':
                return (
                  <BloquePendientesVisita
                    sinVisitar={sinVisitar}
                    mostrarSinVisitar={mostrarSinVisitar}
                    setMostrarSinVisitar={setMostrarSinVisitar}
                  />
                );
              case 'requieren_atencion':
                return <BloqueRequierenAtencion estacionesConProblemas={estacionesConProblemas} ultimasVisitas={ultimasVisitas} />;
              case 'visitas_sospechosas':
                return esAdmin ? <BloqueVisitasSospechosas sospechosas={sospechosas} /> : null;
              case 'bajo_minimo':
                return esAdmin ? <BloqueBajoMinimo bajoMinimo={bajoMinimo} /> : null;
              default:
                return null;
            }
          }}
        />
        {editorDistribucion.guardando && <p className="text-xs text-slate-500">Guardando…</p>}
      </div>
    </div>
  );
}

function BloqueResumenGeneral({
  tituloFecha,
  esAdmin,
  fecha,
  hoy,
  onCambiarFecha,
  resumen,
}: {
  tituloFecha: string;
  esAdmin: boolean;
  fecha: string;
  hoy: string;
  onCambiarFecha: (fecha: string) => void;
  resumen: DashboardResumen | null;
}) {
  return (
    <div className="lg:h-full lg:flex lg:flex-col lg:min-h-0 bloque-adaptable">
      <div className="flex items-center justify-between mb-3 lg:shrink-0">
        <div>
          <h1 className="titulo-pantalla">Inicio</h1>
          <p className="text-sm text-slate-500">{tituloFecha}</p>
        </div>
        {esAdmin && (
          <input
            type="date"
            className="campo py-1 text-sm w-auto"
            value={fecha}
            max={hoy}
            onChange={(e) => onCambiarFecha(e.target.value)}
          />
        )}
      </div>
      {/* grid-metricas (ver index.css) acomoda las 5 tarjetas en 2/3/5 columnas según el ANCHO
          real del bloque (container query, no el de la pantalla) — con suficiente espacio entran
          las 5 en una sola fila en vez de quedar apiladas en 2 columnas siempre. */}
      <div className="grid-metricas lg:flex-1 lg:min-h-0">
        <Metrica label="Visitas registradas" valor={resumen?.total_visitas ?? 0} acento="ok" />
        <Metrica label="Estaciones sin visitar" valor={resumen?.estaciones_sin_visitar ?? 0} acento="idle" />
        <Metrica label="Equipos con falla o por mantener" valor={resumen?.equipos_con_alerta ?? 0} acento="danger" />
        <Metrica label="Estaciones con problemas" valor={resumen?.estaciones_con_problemas ?? 0} acento="warn" />
        <Metrica label="Alertas de voltaje" valor={resumen?.alertas_voltaje ?? 0} acento="danger" />
      </div>
    </div>
  );
}

function BloqueTusEbarHoy({ misEstacionesHoy, esRegular }: { misEstacionesHoy: EstacionAsignadaHoy[]; esRegular: boolean }) {
  return (
    <div className="lg:h-full lg:overflow-auto">
      <h2 className="text-sm font-semibold text-slate-700 mb-2">
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
                  <p className="text-sm font-medium text-slate-900">{e.nombre}</p>
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
  );
}

// Orden de despliegue de los grupos zona+tipo — urbana antes que rural, y dentro de cada zona
// EBAR antes que PTAR antes que línea de conducción. Cualquier valor no listado aquí (si algún
// día aparece un tipo nuevo) simplemente se acomoda al final, no se pierde.
const ORDEN_ZONA: Record<string, number> = { urbana: 0, rural: 1 };
const ORDEN_TIPO: Record<string, number> = { ebar: 0, ptar: 1, linea_conduccion: 2 };
const ETIQUETA_ZONA: Record<string, string> = { urbana: 'Urbana', rural: 'Rural' };
const ETIQUETA_TIPO: Record<string, string> = { ebar: 'EBAR', ptar: 'PTAR', linea_conduccion: 'Línea de conducción' };

/** Agrupa por zona+tipo (ej. "Urbana · EBAR", "Rural · PTAR") — separa las tarjetas como pidió el
 * usuario, y se adapta solo a los grupos que realmente tengan estaciones pendientes. */
function agruparPorZonaYTipo(lista: EstacionSimple[]) {
  const mapa = new Map<string, EstacionSimple[]>();
  for (const e of lista) {
    const clave = `${e.zona}|${e.tipo}`;
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave)!.push(e);
  }
  return [...mapa.entries()]
    .map(([clave, estaciones]) => {
      const [zona, tipo] = clave.split('|');
      return { zona, tipo, estaciones };
    })
    .sort((a, b) => (ORDEN_ZONA[a.zona] ?? 9) - (ORDEN_ZONA[b.zona] ?? 9) || (ORDEN_TIPO[a.tipo] ?? 9) - (ORDEN_TIPO[b.tipo] ?? 9));
}

function BloquePendientesVisita({
  sinVisitar,
  mostrarSinVisitar,
  setMostrarSinVisitar,
}: {
  sinVisitar: EstacionSimple[];
  mostrarSinVisitar: boolean;
  setMostrarSinVisitar: (updater: (v: boolean) => boolean) => void;
}) {
  if (sinVisitar.length === 0) return null;
  return (
    <div className="lg:h-full lg:overflow-auto bloque-adaptable">
      <button className="flex items-center justify-between w-full mb-2" onClick={() => setMostrarSinVisitar((v) => !v)}>
        <h2 className="text-sm font-semibold text-slate-700">Pendientes de visita ({sinVisitar.length})</h2>
        <span className="text-xs text-slate-500">{mostrarSinVisitar ? '▲ ocultar' : '▼ ver'}</span>
      </button>
      {mostrarSinVisitar && (
        <div className="space-y-4">
          {agruparPorZonaYTipo(sinVisitar).map(({ zona, tipo, estaciones }) => (
            <div key={`${zona}-${tipo}`}>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                {ETIQUETA_ZONA[zona] ?? zona} · {ETIQUETA_TIPO[tipo] ?? tipo} ({estaciones.length})
              </p>
              {/* grid-tarjetas-compactas (ver index.css): 2/3/4 columnas según el ancho real del
                  bloque — con suficiente espacio entran 4 tarjetas por fila. */}
              <div className="grid-tarjetas-compactas">
                {estaciones.map((e) => (
                  <Link
                    key={e.id}
                    to={`/estaciones/${e.id}/nueva-visita`}
                    className="tarjeta p-3 flex flex-col gap-1 hover:border-gauge-ok/50 transition"
                  >
                    <p className="text-sm font-medium text-slate-900 truncate">{e.nombre}</p>
                    <p className="text-xs text-slate-500 lectura uppercase tracking-wide truncate">{e.codigo}</p>
                    <span className="text-xs text-gauge-ok mt-1">+ Visita →</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BloqueRequierenAtencion({
  estacionesConProblemas,
  ultimasVisitas,
}: {
  estacionesConProblemas: EstacionEbar[];
  ultimasVisitas: Record<string, string>;
}) {
  if (estacionesConProblemas.length === 0) return null;
  return (
    <div className="lg:h-full lg:overflow-auto">
      <h2 className="text-sm font-semibold text-slate-700 mb-2">Requieren atención</h2>
      <div className="space-y-2">
        {estacionesConProblemas.map((e) => (
          <StationCard key={e.id} estacion={e} ultimaVisita={ultimasVisitas[e.id]} />
        ))}
      </div>
    </div>
  );
}

function BloqueVisitasSospechosas({ sospechosas }: { sospechosas: ParSospechoso[] }) {
  if (sospechosas.length === 0) return null;
  return (
    <div className="lg:h-full lg:overflow-auto">
      <h2 className="text-sm font-semibold text-slate-700 mb-2">⚠️ Visitas con horario sospechoso ({sospechosas.length})</h2>
      <div className="space-y-2">
        {sospechosas.map((s, i) => (
          <div key={i} className="tarjeta p-3 border border-gauge-warn/40">
            <p className="text-sm font-medium text-slate-900">{s.operador_nombre}</p>
            <p className="text-xs text-slate-600">
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
  );
}

function BloqueBajoMinimo({ bajoMinimo }: { bajoMinimo: AsignacionBajoMinimo[] }) {
  if (bajoMinimo.length === 0) return null;
  return (
    <div className="lg:h-full lg:overflow-auto">
      <h2 className="text-sm font-semibold text-slate-700 mb-2">
        ⚠️ Por debajo del mínimo de {MINIMO_VISITAS_DIA_REGULAR} visitas ({bajoMinimo.length})
      </h2>
      <div className="space-y-2">
        {bajoMinimo.map((b) => (
          <div
            key={`${b.operador_id}:${b.estacion_id}`}
            className="tarjeta p-3 border border-gauge-warn/40 flex items-center justify-between"
          >
            <div>
              <p className="text-sm font-medium text-slate-900">{b.operador_nombre}</p>
              <p className="text-xs text-slate-600">{b.estacion_codigo} — {b.estacion_nombre}</p>
            </div>
            <span className="text-xs text-gauge-warn flex-shrink-0">
              {b.visitas}/{MINIMO_VISITAS_DIA_REGULAR}
            </span>
          </div>
        ))}
      </div>
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
      <p className="text-xs text-slate-600 mb-1">{label}</p>
      <p className={`text-3xl font-bold lectura ${COLOR_ACENTO[acento]}`}>{valor}</p>
    </div>
  );
}
