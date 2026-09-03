import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { suscribirseCambios } from '../lib/realtime';
import { useAuth } from '../contexts/AuthContext';
import type { DashboardResumen, EstacionEbar } from '../lib/types';
import { ModalJustificarNoVisita } from '../components/ModalJustificarNoVisita';
import { duracionVisita } from '../lib/duracionVisita';
import { StationCard } from '../components/StationCard';
import { detectarVisitasSospechosas, type ParSospechoso, type VisitaParaChequeo } from '../lib/visitasSospechosas';
import { esDiaNoRegular } from '../lib/feriadosEcuador';
import { GridEditable } from '../components/GridEditable';
import { BarraDistribucion } from '../components/BarraDistribucion';
import { PANTALLAS_EDITABLES } from '../lib/pantallasEditables';
import { useEditorDistribucion } from '../hooks/useEditorDistribucion';
import { agruparPorZonaYTipo, ETIQUETA_ZONA, ETIQUETA_TIPO, direccionOParroquia } from '../lib/agruparEstaciones';
import { hoyLocal } from '../lib/fecha';
import { ManijaRedimension } from '../components/ManijaRedimension';
import { obtenerTamanoModal, guardarTamanoModal } from '../lib/tamanoModal';

const HOY = hoyLocal();
const MINIMO_VISITAS_DIA_REGULAR = 2;

const TAMANO_MODAL_METRICA_DEFAULT = { ancho: 420, alto: 560 };
const TAMANO_MODAL_METRICA_MIN = { ancho: 320, alto: 320 };
const TAMANO_MODAL_METRICA_MAX = { ancho: 900, alto: 900 };

// Mismas 13 columnas jsonb que revisa rpc_dashboard_resumen para "equipos_con_alerta" — se
// repiten acá (en vez de traer el conteo ya hecho) porque para armar la lista de EBAR hace falta
// el estado de cada equipo, no solo el número total.
const COLUMNAS_EQUIPOS_ALERTA = [
  'lineas_impulsion', 'guias_izado', 'valvulas_compuerta', 'valvulas_check', 'valvula_aire',
  'camara_rejilla', 'camara_valvula_compuerta', 'tablero_distribucion', 'variador',
  'tuberia_400_valvulas_aire', 'tuberia_400_uniones_elastomericas',
  'tuberia_600_valvulas_aire', 'tuberia_600_uniones_elastomericas',
] as const;

type EstacionSimple = Pick<EstacionEbar, 'id' | 'nombre' | 'codigo' | 'zona' | 'tipo' | 'direccion' | 'parroquia'>;
type EstacionAsignadaHoy = EstacionSimple & { visitasHoy: number };
/** Justificación de "por qué no se visitó" ya guardada para la fecha del Dashboard, por estación
 * — a lo sumo una por EBAR (ver migración 0055). */
type MapaJustificaciones = Record<string, { motivo: string; creado_por: string; creado_por_nombre: string }>;
type AsignacionBajoMinimo = {
  operador_id: string;
  operador_nombre: string;
  estacion_id: string;
  estacion_nombre: string;
  estacion_codigo: string;
  visitas: number;
};

/** Una de las 6 tarjetas de "Inicio" — al tocarla se abre ModalListaEstaciones con el detalle. */
type TipoMetrica = 'visitas' | 'sin_visitar' | 'equipos_alerta' | 'problemas' | 'voltaje' | 'justificadas';
/** Fila del detalle de una métrica: la estación + cuántas veces contribuyó al número de la
 * tarjeta (ej. 2 visitas en la misma EBAR) — 1 cuando la métrica ya es "una fila por estación"
 * de por sí (sin_visitar, problemas). `operador_id`/`operador_nombre`/`llegada`/`salida` solo
 * vienen completos en "visitas" (única métrica que se agrupa por operador en vez de zona+tipo —
 * ver `agruparPorOperador`); en las otras 4 quedan undefined y no se usan. Con más de una visita
 * (count > 1), `llegada` es la más temprana y `salida` la más tardía de ese operador en esa EBAR
 * ese día — un resumen del rango, no de una visita puntual. */
type FilaDetalleMetrica = EstacionSimple & {
  count: number;
  operador_id?: string;
  operador_nombre?: string;
  llegada?: string;
  salida?: string | null;
  /** Solo en "justificadas": el motivo escrito para esa EBAR ese día. */
  motivo?: string;
};

const TITULOS_METRICA: Record<TipoMetrica, string> = {
  visitas: 'Visitas registradas',
  sin_visitar: 'Estaciones sin visitar',
  equipos_alerta: 'Equipos con falla o por mantener',
  problemas: 'Estaciones con problemas',
  voltaje: 'Alertas de voltaje',
  justificadas: 'EBAR justificadas (motivo de no visita)',
};

export function Dashboard() {
  const { usuario, soloLectura } = useAuth();
  const esAdmin = usuario?.rol === 'administrador' || usuario?.rol === 'supervisor';
  // "Editar distribución" (mover/redimensionar bloques + ancho de pantalla) es exclusiva del
  // administrador real — ni supervisor ni ningún permiso delegado (ver migración 0053).
  const esAdministrador = usuario?.rol === 'administrador';
  const puedeEditarDistribucion = esAdministrador;
  const editorDistribucion = useEditorDistribucion('dashboard');
  // El modal de detalle (abajo) se refleja en "?modal=" de la URL — así queda como una entrada
  // real del historial del navegador: al entrar a una EBAR desde "Ver →" y volver con "← Volver"
  // (que hace navigate(-1) en AppShell), el navegador regresa a esta URL con el modal todavía en
  // el query y se reabre solo (ver el useEffect de "restaurar modal" más abajo). Antes el modal
  // era solo estado de React, sin rastro en el historial, así que "Volver" saltaba directo al
  // Dashboard sin el modal.
  const [searchParams, setSearchParams] = useSearchParams();
  const [fecha, setFecha] = useState(HOY);
  const [resumen, setResumen] = useState<DashboardResumen | null>(null);
  const [estacionesConProblemas, setEstacionesConProblemas] = useState<EstacionEbar[]>([]);
  const [ultimasVisitas, setUltimasVisitas] = useState<Record<string, string>>({});
  const [sinVisitar, setSinVisitar] = useState<EstacionSimple[]>([]);
  // Todas las EBAR relevantes para este rol (para operador, solo las asignadas — mismo filtro que
  // sinVisitar) con cuántas visitas lleva CADA UNA hoy (de cualquier operador) — a diferencia de
  // sinVisitar, no se filtran las ya visitadas: alimenta "Pendientes de visita" con semáforo
  // rojo/amarillo/verde en vez de solo listar las que faltan.
  const [estadoVisitasHoy, setEstadoVisitasHoy] = useState<EstacionAsignadaHoy[]>([]);
  const [mostrarSinVisitar, setMostrarSinVisitar] = useState(true);
  const [sospechosas, setSospechosas] = useState<ParSospechoso[]>([]);
  const [misEstacionesHoy, setMisEstacionesHoy] = useState<EstacionAsignadaHoy[]>([]);
  const [esRegular, setEsRegular] = useState(true);
  const [bajoMinimo, setBajoMinimo] = useState<AsignacionBajoMinimo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [todasEstacionesInfo, setTodasEstacionesInfo] = useState<EstacionSimple[]>([]);
  const [modalMetrica, setModalMetrica] = useState<TipoMetrica | null>(null);
  const [detalleMetrica, setDetalleMetrica] = useState<FilaDetalleMetrica[] | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [tamanoModalMetrica, setTamanoModalMetrica] = useState(TAMANO_MODAL_METRICA_DEFAULT);
  const [justificaciones, setJustificaciones] = useState<MapaJustificaciones>({});
  // Estación sobre la que se está escribiendo (o editando) la justificación de "no visitada" —
  // null = modal cerrado. Abre el mismo modal desde "Tus EBAR de hoy" (operador) y "Pendientes de
  // visita" (admin/supervisor), ver ModalJustificarNoVisita.
  const [justificarEstacion, setJustificarEstacion] = useState<EstacionSimple | null>(null);
  const [guardandoJustificacion, setGuardandoJustificacion] = useState(false);
  const [errorJustificacion, setErrorJustificacion] = useState<string | null>(null);

  // Tamaño guardado del modal de detalle — se carga una sola vez (no depende de la fecha
  // seleccionada, a diferencia de `cargar()` de abajo).
  useEffect(() => {
    obtenerTamanoModal('modal_metrica_dashboard', TAMANO_MODAL_METRICA_DEFAULT).then(setTamanoModalMetrica);
  }, []);

  useEffect(() => {
    async function cargar() {
      const [
        { data: resumenData },
        { data: estaciones },
        { data: todasEstaciones },
        { data: visitasDelDia },
        { data: feriadosAdic },
        { data: justificacionesDia },
      ] = await Promise.all([
        supabase.rpc('rpc_dashboard_resumen', {
          p_fecha: fecha,
          // Para un operador, las 5 métricas de arriba se calculan solo con sus visitas y sus
          // EBAR asignadas (no toda la empresa) — antes mostraba números globales que no tenían
          // relación con lo que ese operador había hecho.
          p_operador_id: usuario?.rol === 'operador' ? usuario.id : null,
        }),
        supabase.from('estaciones_ebar').select('*').neq('estado_actual', 'operativa').eq('activa', true),
        supabase.from('estaciones_ebar').select('id, nombre, codigo, zona, tipo, direccion, parroquia').eq('activa', true).order('nombre'),
        supabase.from('visitas').select('estacion_id, operador_id')
          .gte('fecha_hora_llegada', `${fecha}T00:00:00`)
          .lte('fecha_hora_llegada', `${fecha}T23:59:59`),
        supabase.from('feriados_adicionales').select('fecha'),
        supabase.from('justificaciones_no_visita')
          .select('estacion_id, motivo, creado_por, usuarios ( nombre_completo )')
          .eq('fecha', fecha),
      ]);

      setResumen(resumenData as DashboardResumen);
      setTodasEstacionesInfo((todasEstaciones as EstacionSimple[]) ?? []);
      const mapaJustificaciones: MapaJustificaciones = {};
      for (const j of (justificacionesDia as any[]) ?? []) {
        mapaJustificaciones[j.estacion_id] = {
          motivo: j.motivo,
          creado_por: j.creado_por,
          creado_por_nombre: j.usuarios?.nombre_completo ?? '-',
        };
      }

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

      // Mismo filtro por asignación que el resto de secciones de operador — para admin/supervisor
      // (idsAsignadosHoy null) queda el mapa completo, con todas las EBAR justificadas ese día.
      setJustificaciones(
        idsAsignadosHoy
          ? Object.fromEntries(Object.entries(mapaJustificaciones).filter(([id]) => idsAsignadosHoy!.has(id)))
          : mapaJustificaciones,
      );

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

      const conteoVisitasPorEstacion: Record<string, number> = {};
      for (const v of (visitasDelDia ?? []) as any[]) {
        conteoVisitasPorEstacion[v.estacion_id] = (conteoVisitasPorEstacion[v.estacion_id] ?? 0) + 1;
      }
      setEstadoVisitasHoy(
        ((todasEstaciones ?? []) as EstacionSimple[])
          .filter((e) => !idsAsignadosHoy || idsAsignadosHoy.has(e.id))
          .map((e) => ({ ...e, visitasHoy: conteoVisitasPorEstacion[e.id] ?? 0 })),
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

  // Los Hooks (useMemo incluido) tienen que llamarse siempre, en el mismo orden, en cada
  // renderizado — por eso este useMemo va ANTES de los `return` condicionales de más abajo
  // (digitador / cargando). Ponerlo después rompía la regla (React error #310: "Rendered more
  // hooks than during the previous render") apenas la pantalla pasaba por el estado "Cargando…".
  const estacionesPorId = useMemo(() => new Map(todasEstacionesInfo.map((e) => [e.id, e])), [todasEstacionesInfo]);

  // El modal sigue a "?modal=" de la URL en los dos sentidos, no solo al abrirlo: si cambia por
  // fuera (← Volver desde la ficha de una EBAR, atrás/adelante del navegador) este efecto carga o
  // cierra el modal para que coincida. Antes solo se restauraba una vez al montar, así que el
  // botón "atrás" real del navegador podía dejar la URL sin "modal" pero el modal seguía abierto.
  useEffect(() => {
    if (cargando) return;
    const tipoParam = searchParams.get('modal');
    if (tipoParam && tipoParam in TITULOS_METRICA) {
      if (modalMetrica !== tipoParam) cargarDetalleMetrica(tipoParam as TipoMetrica);
    } else if (modalMetrica !== null) {
      setModalMetrica(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargando, searchParams]);

  // Digitador no tiene esta pantalla (su trabajo es Turnos/Reportes, no monitoreo) — se manda
  // directo a Turnos en vez de mostrarle un mensaje de "no disponible" en lo primero que ve al
  // entrar a la app.
  if (usuario?.rol === 'digitador') return <Navigate to="/calendario-turnos" replace />;

  if (cargando) return <p className="text-slate-600">Cargando…</p>;

  function cambiarFecha(nueva: string) {
    setCargando(true);
    setFecha(nueva);
  }

  // --- Detalle de las 5 métricas de "Inicio" (ver ModalListaEstaciones más abajo) ---

  function contarPorEstacion(idsEstacion: string[]): FilaDetalleMetrica[] {
    const conteo = new Map<string, number>();
    for (const id of idsEstacion) conteo.set(id, (conteo.get(id) ?? 0) + 1);
    const filas: FilaDetalleMetrica[] = [];
    for (const [estacionId, count] of conteo) {
      const estacion = estacionesPorId.get(estacionId);
      if (estacion) filas.push({ ...estacion, count });
    }
    return filas;
  }

  // "Visitas registradas": reutiliza el mismo rango de fecha que el resto del Dashboard — a
  // diferencia de las otras 4 métricas (una fila por estación vía contarPorEstacion), acá se
  // agrupa por operador+estación (el usuario pidió ver esta lista clasificada por operador, no
  // por zona/tipo) — si 2 operadores distintos visitaron la misma EBAR hoy, salen como 2 filas
  // separadas, una en cada grupo de operador, cada una con su propio conteo.
  async function construirDetalleVisitas(): Promise<FilaDetalleMetrica[]> {
    let query = supabase
      .from('visitas')
      .select('estacion_id, operador_id, fecha_hora_llegada, fecha_hora_salida, usuarios ( nombre_completo )')
      .gte('fecha_hora_llegada', `${fecha}T00:00:00`)
      .lte('fecha_hora_llegada', `${fecha}T23:59:59`);
    if (usuario?.rol === 'operador') query = query.eq('operador_id', usuario.id);
    const { data } = await query;
    const conteo = new Map<
      string,
      { estacion_id: string; operador_id: string; operador_nombre: string; count: number; llegada: string; salida: string | null }
    >();
    for (const v of (data ?? []) as any[]) {
      const clave = `${v.operador_id}::${v.estacion_id}`;
      const actual = conteo.get(clave);
      if (actual) {
        actual.count++;
        if (v.fecha_hora_llegada < actual.llegada) actual.llegada = v.fecha_hora_llegada;
        if (v.fecha_hora_salida && (!actual.salida || v.fecha_hora_salida > actual.salida)) actual.salida = v.fecha_hora_salida;
      } else {
        conteo.set(clave, {
          estacion_id: v.estacion_id,
          operador_id: v.operador_id,
          operador_nombre: v.usuarios?.nombre_completo ?? '-',
          count: 1,
          llegada: v.fecha_hora_llegada,
          salida: v.fecha_hora_salida ?? null,
        });
      }
    }
    const filas: FilaDetalleMetrica[] = [];
    for (const { estacion_id, operador_id, operador_nombre, count, llegada, salida } of conteo.values()) {
      const estacion = estacionesPorId.get(estacion_id);
      if (estacion) filas.push({ ...estacion, count, operador_id, operador_nombre, llegada, salida });
    }
    return filas;
  }

  // "Equipos con falla o por mantener": mismo criterio que rpc_dashboard_resumen
  // (equipos_con_alerta) pero trayendo el estado de cada equipo en vez del conteo ya hecho, para
  // poder armar la lista de EBAR.
  async function construirDetalleEquiposAlerta(): Promise<FilaDetalleMetrica[]> {
    let query = supabase
      .from('visitas')
      .select(`estacion_id, ${COLUMNAS_EQUIPOS_ALERTA.join(', ')}`)
      .gte('fecha_hora_llegada', `${fecha}T00:00:00`)
      .lte('fecha_hora_llegada', `${fecha}T23:59:59`);
    if (usuario?.rol === 'operador') query = query.eq('operador_id', usuario.id);
    const { data } = await query;
    const ids = ((data ?? []) as any[])
      .filter((v) => COLUMNAS_EQUIPOS_ALERTA.some((col) => ['en_falla', 'requiere_mantenimiento'].includes(v[col]?.estado)))
      .map((v) => v.estacion_id as string);
    return contarPorEstacion(ids);
  }

  // "Alertas de voltaje": mismo criterio que rpc_dashboard_resumen (alertas_voltaje) — cuenta
  // registros_bombas con voltaje_fuera_rango, unidos a las visitas del día.
  async function construirDetalleVoltaje(): Promise<FilaDetalleMetrica[]> {
    let queryVisitas = supabase
      .from('visitas')
      .select('id, estacion_id')
      .gte('fecha_hora_llegada', `${fecha}T00:00:00`)
      .lte('fecha_hora_llegada', `${fecha}T23:59:59`);
    if (usuario?.rol === 'operador') queryVisitas = queryVisitas.eq('operador_id', usuario.id);
    const { data: visitasDia } = await queryVisitas;
    const idsVisita = ((visitasDia ?? []) as { id: string; estacion_id: string }[]).map((v) => v.id);
    if (idsVisita.length === 0) return [];
    const { data: bombas } = await supabase
      .from('registros_bombas')
      .select('visita_id')
      .in('visita_id', idsVisita)
      .eq('voltaje_fuera_rango', true);
    const mapaVisitaEstacion = new Map(((visitasDia ?? []) as { id: string; estacion_id: string }[]).map((v) => [v.id, v.estacion_id]));
    const ids = ((bombas ?? []) as { visita_id: string }[])
      .map((b) => mapaVisitaEstacion.get(b.visita_id))
      .filter((id): id is string => !!id);
    return contarPorEstacion(ids);
  }

  async function cargarDetalleMetrica(tipo: TipoMetrica) {
    setModalMetrica(tipo);
    setDetalleMetrica(null);
    // Estas 2 ya están cargadas para "Pendientes de visita"/"Requieren atención" — se reutilizan
    // tal cual, sin pedirlas de nuevo (además queda 100% consistente con esas 2 secciones).
    if (tipo === 'sin_visitar') {
      setDetalleMetrica(sinVisitar.map((e) => ({ ...e, count: 1 })));
      return;
    }
    if (tipo === 'problemas') {
      setDetalleMetrica(estacionesConProblemas.map((e) => ({ ...e, count: 1 })));
      return;
    }
    // "justificadas": también ya está cargado (mismo estado que pinta el aviso en las tarjetas
    // rojas de "Tus EBAR de hoy"/"Pendientes de visita"), agrupado por quien escribió el motivo —
    // igual que "visitas" se agrupa por operador (ver agruparPorOperadorAqui en ModalListaEstaciones).
    if (tipo === 'justificadas') {
      const filas: FilaDetalleMetrica[] = Object.entries(justificaciones)
        .map((entry): FilaDetalleMetrica | null => {
          const [estacionId, j] = entry;
          const estacion = estacionesPorId.get(estacionId);
          if (!estacion) return null;
          return { ...estacion, count: 1, operador_id: j.creado_por, operador_nombre: j.creado_por_nombre, motivo: j.motivo };
        })
        .filter((f): f is FilaDetalleMetrica => f !== null);
      setDetalleMetrica(filas);
      return;
    }
    setCargandoDetalle(true);
    try {
      const filas =
        tipo === 'visitas'
          ? await construirDetalleVisitas()
          : tipo === 'equipos_alerta'
            ? await construirDetalleEquiposAlerta()
            : await construirDetalleVoltaje();
      setDetalleMetrica(filas);
    } finally {
      setCargandoDetalle(false);
    }
  }

  // Click en una de las 5 tarjetas: además de cargar el detalle, deja "?modal=" en la URL (push,
  // una entrada nueva de historial) para que "← Volver" desde la ficha de una EBAR pueda regresar
  // acá con el modal abierto (ver el useEffect de restauración y cerrarModalMetrica).
  function abrirDetalleMetrica(tipo: TipoMetrica) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('modal', tipo);
      return next;
    });
    cargarDetalleMetrica(tipo);
  }

  function cerrarModalMetrica() {
    setModalMetrica(null);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('modal');
        return next;
      },
      { replace: true },
    );
  }

  async function guardarTamanoModalMetrica(t: { ancho: number; alto: number }) {
    setTamanoModalMetrica(t);
    await guardarTamanoModal('modal_metrica_dashboard', t);
  }

  // Guarda (o edita) el motivo de "por qué no se visitó" para justificarEstacion, en la fecha que
  // se está viendo — una fila por estación+fecha (ver migración 0055), así que reescribir el mismo
  // día actualiza la fila existente en vez de duplicarla.
  async function guardarJustificacion(motivo: string) {
    if (!justificarEstacion || !usuario) return;
    setGuardandoJustificacion(true);
    setErrorJustificacion(null);
    const { error } = await supabase
      .from('justificaciones_no_visita')
      .upsert(
        { estacion_id: justificarEstacion.id, fecha, motivo, creado_por: usuario.id },
        { onConflict: 'estacion_id,fecha' },
      );
    setGuardandoJustificacion(false);
    if (error) {
      setErrorJustificacion('No se pudo guardar. Intenta de nuevo.');
      return;
    }
    setJustificaciones((prev) => ({
      ...prev,
      [justificarEstacion.id]: { motivo, creado_por: usuario.id, creado_por_nombre: usuario.nombre_completo },
    }));
    setJustificarEstacion(null);
  }

  // Los bloques que un rol nunca llega a ver ("tus_ebar_hoy" es solo de operador,
  // "visitas_sospechosas"/"bajo_minimo"/"pendientes_visita" son solo de admin/supervisor) se
  // sacan del grid editable — si no, quedan como una celda vacía y arrastrable sin contenido
  // dentro (ver renderBloque más abajo, que además explica por qué se ven vacíos AL EDITAR aunque
  // si apliquen). "pendientes_visita" quedó redundante para operador desde que ambos bloques
  // muestran las mismas EBAR con el mismo semáforo de colores — "Tus EBAR de hoy" ya cubre eso
  // con el enfoque personal ("tus"), así que el operador ya no necesita las dos. En modo edición,
  // el rol que importa es el que se está previsualizando en el selector de "Editar distribución"
  // (objetivoActivo) — NO el rol real de quien edita: un administrador arreglando la distribución
  // de "Operador" necesita seguir viendo (y poder agrandar) "Tus EBAR de hoy" aunque él mismo no
  // sea operador. "Todos" no filtra nada, para poder acomodar el set completo del acomodo
  // compartido.
  const modoEdicionActivo = puedeEditarDistribucion && editorDistribucion.modoEdicion;
  const rolParaBloques = modoEdicionActivo ? editorDistribucion.objetivoActivo : usuario?.rol;
  const bloquesDashboard = PANTALLAS_EDITABLES.find((p) => p.id === 'dashboard')!.bloques.filter((b) => {
    if (!rolParaBloques || rolParaBloques === 'todos') return true;
    const rolEsAdminComo = rolParaBloques === 'administrador' || rolParaBloques === 'supervisor';
    if (b.id === 'tus_ebar_hoy') return !rolEsAdminComo;
    if (b.id === 'visitas_sospechosas' || b.id === 'bajo_minimo' || b.id === 'pendientes_visita') return rolEsAdminComo;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Celular: exactamente el mismo apilado de siempre, sin GridEditable. */}
      <div className="lg:hidden space-y-6">
        <BloqueResumenGeneral
          tituloFecha={tituloFecha}
          esAdmin={esAdmin}
          fecha={fecha}
          hoy={HOY}
          onCambiarFecha={cambiarFecha}
          resumen={resumen}
          justificadasHoy={Object.keys(justificaciones).length}
          onAbrirDetalle={abrirDetalleMetrica}
        />
        {!esAdmin && (
          <BloqueTusEbarHoy
            misEstacionesHoy={misEstacionesHoy}
            esRegular={esRegular}
            soloLectura={soloLectura}
            justificaciones={justificaciones}
            onJustificar={setJustificarEstacion}
          />
        )}
        {esAdmin && (
          <BloquePendientesVisita
            estadoVisitasHoy={estadoVisitasHoy}
            esRegular={esRegular}
            mostrarSinVisitar={mostrarSinVisitar}
            setMostrarSinVisitar={setMostrarSinVisitar}
            justificaciones={justificaciones}
            onJustificar={setJustificarEstacion}
          />
        )}
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
                    justificadasHoy={Object.keys(justificaciones).length}
                    onAbrirDetalle={abrirDetalleMetrica}
                  />
                );
              case 'tus_ebar_hoy':
                if (!esAdmin)
                  return (
                    <BloqueTusEbarHoy
                      misEstacionesHoy={misEstacionesHoy}
                      esRegular={esRegular}
                      soloLectura={soloLectura}
                      justificaciones={justificaciones}
                      onJustificar={setJustificarEstacion}
                    />
                  );
                // Se ve vacío para el administrador (sus propias EBAR de hoy no aplican) aunque el
                // bloque siga presente para poder acomodarlo — el operador real sí va a ver su
                // contenido acá.
                return modoEdicionActivo ? <BloqueVistaPreviaNoDisponible texto="Solo lo ve el operador." /> : null;
              case 'pendientes_visita':
                if (esAdmin) {
                  return (
                    <BloquePendientesVisita
                      estadoVisitasHoy={estadoVisitasHoy}
                      esRegular={esRegular}
                      mostrarSinVisitar={mostrarSinVisitar}
                      setMostrarSinVisitar={setMostrarSinVisitar}
                      justificaciones={justificaciones}
                      onJustificar={setJustificarEstacion}
                    />
                  );
                }
                // Redundante para operador (ya tiene "Tus EBAR de hoy" con la misma información) —
                // igual que "tus_ebar_hoy" arriba, el bloque queda solo para poder acomodarlo en
                // "Editar distribución" cuando se previsualiza el acomodo de Operador.
                return modoEdicionActivo ? <BloqueVistaPreviaNoDisponible texto="Solo lo ve administrador/supervisor." /> : null;
              case 'requieren_atencion':
                return <BloqueRequierenAtencion estacionesConProblemas={estacionesConProblemas} ultimasVisitas={ultimasVisitas} />;
              case 'visitas_sospechosas':
                if (esAdmin) return <BloqueVisitasSospechosas sospechosas={sospechosas} />;
                return modoEdicionActivo ? <BloqueVistaPreviaNoDisponible texto="Solo lo ve administrador/supervisor." /> : null;
              case 'bajo_minimo':
                if (esAdmin) return <BloqueBajoMinimo bajoMinimo={bajoMinimo} />;
                return modoEdicionActivo ? <BloqueVistaPreviaNoDisponible texto="Solo lo ve administrador/supervisor." /> : null;
              default:
                return null;
            }
          }}
        />
        {editorDistribucion.guardando && <p className="text-xs text-slate-500">Guardando…</p>}
      </div>

      {modalMetrica && (
        <ModalListaEstaciones
          titulo={TITULOS_METRICA[modalMetrica]}
          subtitulo={tituloFecha}
          tipoMetrica={modalMetrica}
          filas={detalleMetrica}
          cargando={cargandoDetalle}
          esAdmin={esAdministrador}
          tamano={tamanoModalMetrica}
          onGuardarTamano={guardarTamanoModalMetrica}
          onCerrar={cerrarModalMetrica}
        />
      )}

      {justificarEstacion && (
        <ModalJustificarNoVisita
          estacion={justificarEstacion}
          motivoInicial={justificaciones[justificarEstacion.id]?.motivo ?? ''}
          guardando={guardandoJustificacion}
          error={errorJustificacion}
          onGuardar={guardarJustificacion}
          onCerrar={() => {
            setJustificarEstacion(null);
            setErrorJustificacion(null);
          }}
        />
      )}
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
  justificadasHoy,
  onAbrirDetalle,
}: {
  tituloFecha: string;
  esAdmin: boolean;
  fecha: string;
  hoy: string;
  onCambiarFecha: (fecha: string) => void;
  resumen: DashboardResumen | null;
  justificadasHoy: number;
  onAbrirDetalle: (tipo: TipoMetrica) => void;
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
      {/* grid-metricas (ver index.css) acomoda las 6 tarjetas en 2/3/5 columnas según el ANCHO
          real del bloque (container query, no el de la pantalla) — con suficiente espacio entran
          varias en una sola fila en vez de quedar apiladas en 2 columnas siempre. */}
      <div className="grid-metricas lg:flex-1 lg:min-h-0">
        <Metrica label="Visitas registradas" valor={resumen?.total_visitas ?? 0} acento="ok" onClick={() => onAbrirDetalle('visitas')} />
        <Metrica label="Estaciones sin visitar" valor={resumen?.estaciones_sin_visitar ?? 0} acento="idle" onClick={() => onAbrirDetalle('sin_visitar')} />
        <Metrica label="Equipos con falla o por mantener" valor={resumen?.equipos_con_alerta ?? 0} acento="danger" onClick={() => onAbrirDetalle('equipos_alerta')} />
        <Metrica label="Estaciones con problemas" valor={resumen?.estaciones_con_problemas ?? 0} acento="warn" onClick={() => onAbrirDetalle('problemas')} />
        <Metrica label="Alertas de voltaje" valor={resumen?.alertas_voltaje ?? 0} acento="danger" onClick={() => onAbrirDetalle('voltaje')} />
        <Metrica label="EBAR justificadas" valor={justificadasHoy} acento="idle" onClick={() => onAbrirDetalle('justificadas')} />
      </div>
    </div>
  );
}

/** Ocupa el bloque en "Editar distribución" cuando se está previsualizando/acomodando un rol
 * distinto al de quien edita — así el bloque sigue ahí para poder moverlo/agrandarlo (que es lo
 * que hace falta, ver comentario en bloquesDashboard) aunque no haya contenido real que mostrar
 * (ej. un administrador no tiene EBAR propias de operador). El rol real sí ve su contenido normal. */
function BloqueVistaPreviaNoDisponible({ texto }: { texto: string }) {
  return (
    <div className="h-full flex items-center justify-center text-center p-3 border-2 border-dashed border-panel-600 rounded-lg">
      <p className="text-xs text-slate-500">
        Sin vista previa acá — {texto}
        <br />
        Se puede mover/agrandar igual; el rol real sí va a ver su contenido.
      </p>
    </div>
  );
}

/** Semáforo de una EBAR según cuántas visitas lleva hoy contra la meta del día (2 en día regular,
 * 1 en fin de semana/feriado) — mismo criterio en "Tus EBAR de hoy" (operador) y "Pendientes de
 * visita" (todos los roles): rojo = 0 visitas, amarillo = falta al menos 1, verde = ya cumplida. */
function colorSemaforoVisita(visitasHoy: number, meta: number): 'ok' | 'warn' | 'danger' {
  if (visitasHoy >= meta) return 'ok';
  if (visitasHoy > 0) return 'warn';
  return 'danger';
}

// "warn" usa el color "amarillo" (antes tomate, un naranja-rojizo que contrastaba poco contra el
// rojo de "danger" al lado) — border y bg comparten el mismo tono en los 3 estados, sin mezclar
// dos colores distintos para una misma tarjeta.
const CLASE_TARJETA_SEMAFORO: Record<'ok' | 'warn' | 'danger', string> = {
  ok: 'bg-gauge-ok/15 border-gauge-ok',
  warn: 'bg-amarillo/15 border-amarillo',
  danger: 'bg-gauge-danger/15 border-gauge-danger',
};
const CLASE_TEXTO_SEMAFORO: Record<'ok' | 'warn' | 'danger', string> = {
  ok: 'text-gauge-ok',
  warn: 'text-gauge-warn',
  danger: 'text-gauge-danger',
};

/** Qué significa cada color de las tarjetas de EBAR — usada tanto en "Tus EBAR de hoy" (operador)
 * como en "Pendientes de visita" (los 3 roles), mismo criterio de semáforo. Cada muestra es un
 * mini-recuadro con el MISMO relleno + borde que usa la tarjeta real (CLASE_TARJETA_SEMAFORO) —
 * antes era un punto sólido de un solo tono, que no se veía igual al relleno clarito + borde más
 * fuerte de la tarjeta (el usuario lo notó: la tarjeta se ve "tomate" por dentro pero el borde se
 * ve más rojizo aparte — ya no aplica desde que "tomate" pasó a ser "amarillo"). */
function LeyendaSemaforoVisitas({ esRegular }: { esRegular: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-700 mb-3">
      <span className="flex items-center gap-2">
        <span className={`inline-block w-6 h-6 rounded border-2 ${CLASE_TARJETA_SEMAFORO.danger}`} />
        Sin ninguna visita hoy
      </span>
      {esRegular && (
        <span className="flex items-center gap-2">
          <span className={`inline-block w-6 h-6 rounded border-2 ${CLASE_TARJETA_SEMAFORO.warn}`} />
          Le falta al menos 1 visita
        </span>
      )}
      <span className="flex items-center gap-2">
        <span className={`inline-block w-6 h-6 rounded border-2 ${CLASE_TARJETA_SEMAFORO.ok}`} />
        Ya cumplió el mínimo de hoy
      </span>
    </div>
  );
}

/** Una tarjeta de EBAR con semáforo (usada por "Tus EBAR de hoy" y "Pendientes de visita"). El
 * nombre/código llevan al formulario (o a la ficha, en modo consulta); si la tarjeta está en rojo
 * (0 visitas hoy) y el rol puede justificar, se agrega debajo un botón aparte (no anidado dentro
 * del Link) para poner o ver el motivo de "por qué no se visitó" — ver ModalJustificarNoVisita. */
function TarjetaEstacionSemaforo({
  estacion,
  esRegular,
  meta,
  to,
  justificacion,
  permiteJustificar,
  onJustificar,
}: {
  estacion: EstacionAsignadaHoy;
  esRegular: boolean;
  meta: number;
  to: string;
  justificacion?: { motivo: string; creado_por_nombre: string };
  permiteJustificar: boolean;
  onJustificar: (estacion: EstacionSimple) => void;
}) {
  const semaforo = colorSemaforoVisita(estacion.visitasHoy, meta);
  return (
    <div className={`tarjeta p-3 flex flex-col gap-1 border-2 transition ${CLASE_TARJETA_SEMAFORO[semaforo]}`}>
      <Link key={estacion.id} to={to} className="flex flex-col gap-1">
        <p className="text-sm font-medium text-slate-900 truncate">{estacion.nombre}</p>
        <p className="text-xs text-slate-500 lectura uppercase tracking-wide truncate">{estacion.codigo}</p>
        <span className={`text-xs mt-1 font-semibold ${CLASE_TEXTO_SEMAFORO[semaforo]}`}>
          {esRegular
            ? `${Math.min(estacion.visitasHoy, meta)}/${meta} hoy`
            : estacion.visitasHoy > 0
              ? `${estacion.visitasHoy} visita${estacion.visitasHoy > 1 ? 's' : ''} hoy`
              : 'Sin visitar'}
        </span>
      </Link>
      {semaforo === 'danger' && permiteJustificar && (
        <button
          type="button"
          onClick={() => onJustificar(estacion)}
          className="text-[11px] text-left mt-1 pt-1 border-t border-black/10"
        >
          {justificacion ? (
            <span className="text-slate-600">📝 {justificacion.motivo}</span>
          ) : (
            <span className="text-sky-700 hover:text-sky-900 font-medium">+ Justificar</span>
          )}
        </button>
      )}
    </div>
  );
}

function BloqueTusEbarHoy({
  misEstacionesHoy,
  esRegular,
  soloLectura,
  justificaciones,
  onJustificar,
}: {
  misEstacionesHoy: EstacionAsignadaHoy[];
  esRegular: boolean;
  soloLectura: boolean;
  justificaciones: MapaJustificaciones;
  onJustificar: (estacion: EstacionSimple) => void;
}) {
  return (
    <div className="lg:h-full lg:overflow-auto bloque-adaptable">
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
        <>
        <LeyendaSemaforoVisitas esRegular={esRegular} />
        <div className="space-y-4">
          {/* Mismo agrupado por zona+tipo y cuadrícula de "Pendientes de visita" — ver
              agruparEstaciones.ts y .grid-tarjetas-compactas en index.css. */}
          {agruparPorZonaYTipo(misEstacionesHoy).map(({ zona, tipo, estaciones }) => (
            <div key={`${zona}-${tipo}`}>
              <p className="text-xs font-bold text-sky-700 uppercase tracking-wider mb-1.5">
                {ETIQUETA_ZONA[zona] ?? zona} · {ETIQUETA_TIPO[tipo] ?? tipo} ({estaciones.length})
              </p>
              <div className="grid-tarjetas-compactas">
                {estaciones.map((e) => (
                  <TarjetaEstacionSemaforo
                    key={e.id}
                    estacion={e}
                    esRegular={esRegular}
                    meta={esRegular ? MINIMO_VISITAS_DIA_REGULAR : 1}
                    // En "modo consulta" (computadora) no se registra nada — la tarjeta lleva a la
                    // ficha de la estación (ver historial / exportar) en vez de al formulario, y
                    // tampoco se puede justificar.
                    to={soloLectura ? `/estaciones/${e.id}` : `/estaciones/${e.id}/nueva-visita`}
                    justificacion={justificaciones[e.id]}
                    permiteJustificar={!soloLectura}
                    onJustificar={onJustificar}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        </>
      )}
    </div>
  );
}


function BloquePendientesVisita({
  estadoVisitasHoy,
  esRegular,
  mostrarSinVisitar,
  setMostrarSinVisitar,
  justificaciones,
  onJustificar,
}: {
  estadoVisitasHoy: EstacionAsignadaHoy[];
  esRegular: boolean;
  mostrarSinVisitar: boolean;
  setMostrarSinVisitar: (updater: (v: boolean) => boolean) => void;
  justificaciones: MapaJustificaciones;
  onJustificar: (estacion: EstacionSimple) => void;
}) {
  if (estadoVisitasHoy.length === 0) return null;
  const meta = esRegular ? MINIMO_VISITAS_DIA_REGULAR : 1;
  const completas = estadoVisitasHoy.filter((e) => e.visitasHoy >= meta).length;
  return (
    <div className="lg:h-full lg:overflow-auto bloque-adaptable">
      <button className="flex items-center justify-between w-full mb-2" onClick={() => setMostrarSinVisitar((v) => !v)}>
        <h2 className="text-sm font-semibold text-slate-700">
          Pendientes de visita ({completas}/{estadoVisitasHoy.length} {esRegular ? `con ${MINIMO_VISITAS_DIA_REGULAR} visitas` : 'visitadas'})
        </h2>
        <span className="text-xs text-slate-500">{mostrarSinVisitar ? '▲ ocultar' : '▼ ver'}</span>
      </button>
      {!esRegular && (
        <p className="text-xs text-slate-500 mb-2">Hoy no aplica el mínimo de {MINIMO_VISITAS_DIA_REGULAR} visitas (fin de semana o feriado).</p>
      )}
      {mostrarSinVisitar && (
        <>
        <LeyendaSemaforoVisitas esRegular={esRegular} />
        <div className="space-y-4">
          {agruparPorZonaYTipo(estadoVisitasHoy).map(({ zona, tipo, estaciones }) => (
            <div key={`${zona}-${tipo}`}>
              <p className="text-xs font-bold text-sky-700 uppercase tracking-wider mb-1.5">
                {ETIQUETA_ZONA[zona] ?? zona} · {ETIQUETA_TIPO[tipo] ?? tipo} ({estaciones.length})
              </p>
              {/* grid-tarjetas-compactas (ver index.css): 2/3/4 columnas según el ancho real del
                  bloque — con suficiente espacio entran 4 tarjetas por fila. Cada tarjeta se
                  pinta entera (fondo + borde) según el semáforo: rojo sin ninguna visita hoy,
                  amarillo con al menos 1 pero sin llegar a la meta, verde ya cumplida. */}
              <div className="grid-tarjetas-compactas">
                {estaciones.map((e) => (
                  <TarjetaEstacionSemaforo
                    key={e.id}
                    estacion={e}
                    esRegular={esRegular}
                    meta={meta}
                    to={`/estaciones/${e.id}/nueva-visita`}
                    justificacion={justificaciones[e.id]}
                    permiteJustificar
                    onJustificar={onJustificar}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        </>
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

// Fondo + borde de cada tarjeta de métrica — antes eran blancas de punta a punta, con solo el
// número coloreado; ahora toda la tarjeta lleva el color de su acento, para que se distingan de
// un vistazo sin tener que leer el número.
const CLASE_TARJETA_ACENTO: Record<'ok' | 'warn' | 'danger' | 'idle', string> = {
  ok: 'bg-gauge-ok/10 border-gauge-ok/50',
  warn: 'bg-gauge-warn/10 border-gauge-warn/50',
  danger: 'bg-gauge-danger/10 border-gauge-danger/50',
  idle: 'bg-gauge-idle/10 border-gauge-idle/50',
};

function Metrica({
  label,
  valor,
  acento,
  onClick,
}: {
  label: string;
  valor: number;
  acento: 'ok' | 'warn' | 'danger' | 'idle';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tarjeta p-4 text-left w-full border-2 hover:brightness-95 transition ${CLASE_TARJETA_ACENTO[acento]}`}
    >
      <p className="text-xs text-slate-700 mb-1">{label}</p>
      <p className={`text-3xl font-bold lectura ${COLOR_ACENTO[acento]}`}>{valor}</p>
    </button>
  );
}

/** Una fila de ModalListaEstaciones (mismo aspecto sea cual sea el agrupado — por zona+tipo o por
 * operador) — enlace directo a la ficha de la estación, con el conteo de veces que apareció. */
function FilaEstacionDetalle({ estacion: e }: { estacion: FilaDetalleMetrica }) {
  const ubicacion = direccionOParroquia(e);
  return (
    <Link to={`/estaciones/${e.id}`} className="tarjeta p-3 flex items-center justify-between gap-2 hover:border-gauge-ok/50 transition">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900 truncate">{e.nombre}</p>
        {/* Muchas EBAR tienen nombre = código a propósito (ver migración 0041) — repetirlo acá no
            agrega nada, solo se muestra cuando de verdad son distintos (ej. LC-001). */}
        {e.codigo !== e.nombre && (
          <p className="text-xs text-slate-500 lectura uppercase tracking-wide truncate">{e.codigo}</p>
        )}
        {ubicacion && <p className="text-xs text-slate-500 truncate">{ubicacion}</p>}
        {/* Solo "justificadas" trae motivo — el porqué de no haber visitado esa EBAR ese día. */}
        {e.motivo && <p className="text-xs text-slate-600 italic mt-0.5">📝 {e.motivo}</p>}
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        {e.llegada && (
          <p className="text-[11px] text-slate-500 leading-tight text-right">
            Llegada {formatFechaCorta(e.llegada)}
            {e.salida && (
              <>
                <br />
                Salida {formatFechaCorta(e.salida)}
                {/* Cuánto le tomó la visita (llegada → salida) — mismo criterio de "visita
                    relámpago" que el historial de StationDetail (ver duracionVisita). */}
                {(() => {
                  const duracion = duracionVisita(e.llegada!, e.salida);
                  return (
                    duracion && (
                      <span className={duracion.corta ? 'text-gauge-warn' : 'text-slate-500'}> · {duracion.texto}</span>
                    )
                  );
                })()}
              </>
            )}
          </p>
        )}
        <div className="flex items-center gap-2">
          {e.count > 1 && <span className="text-xs text-slate-500">×{e.count}</span>}
          <span className="text-xs text-gauge-ok">Ver →</span>
        </div>
      </div>
    </Link>
  );
}

/** Una fila por operador con las EBAR que visitó (ordenadas por nombre), ordenados por nombre de
 * operador — usado solo por "Visitas registradas" (ver comentario en ModalListaEstaciones). */
function agruparPorOperador(filas: FilaDetalleMetrica[]): { operador_id: string; operador_nombre: string; estaciones: FilaDetalleMetrica[] }[] {
  const mapa = new Map<string, { operador_id: string; operador_nombre: string; estaciones: FilaDetalleMetrica[] }>();
  for (const f of filas) {
    const id = f.operador_id ?? '-';
    if (!mapa.has(id)) mapa.set(id, { operador_id: id, operador_nombre: f.operador_nombre ?? '-', estaciones: [] });
    mapa.get(id)!.estaciones.push(f);
  }
  return [...mapa.values()]
    .map((g) => ({ ...g, estaciones: [...g.estaciones].sort((a, b) => a.nombre.localeCompare(b.nombre)) }))
    .sort((a, b) => a.operador_nombre.localeCompare(b.operador_nombre));
}

/** Se abre al tocar cualquiera de las 5 tarjetas de "Inicio" — lista las EBAR que componen ese
 * número. "Visitas registradas" se agrupa por operador (pedido explícito del usuario, para ver de
 * un vistazo qué hizo cada quien); las otras 4 siguen agrupadas por zona+tipo (mismo criterio y
 * estilo que el resto de la app) — cada estación como enlace directo a su ficha. Redimensionable
 * por el administrador (ver ManijaRedimension). */
function ModalListaEstaciones({
  titulo,
  subtitulo,
  tipoMetrica,
  filas,
  cargando,
  esAdmin,
  tamano,
  onGuardarTamano,
  onCerrar,
}: {
  titulo: string;
  subtitulo: string;
  tipoMetrica: TipoMetrica | null;
  filas: FilaDetalleMetrica[] | null;
  cargando: boolean;
  esAdmin: boolean;
  tamano: { ancho: number; alto: number };
  onGuardarTamano: (t: { ancho: number; alto: number }) => void;
  onCerrar: () => void;
}) {
  const [tam, setTam] = useState(tamano);
  const agruparPorOperadorAqui = tipoMetrica === 'visitas' || tipoMetrica === 'justificadas';
  const gruposOperador = useMemo(() => (agruparPorOperadorAqui ? agruparPorOperador(filas ?? []) : []), [filas, agruparPorOperadorAqui]);
  const gruposZona = useMemo(() => (agruparPorOperadorAqui ? [] : agruparPorZonaYTipo(filas ?? [])), [filas, agruparPorOperadorAqui]);

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-20" onClick={onCerrar} />
      <div
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-panel-800 border border-panel-600/60 rounded-xl shadow-xl flex flex-col overflow-hidden"
        style={{ width: `min(${tam.ancho}px, 94vw)`, height: `min(${tam.alto}px, 92vh)` }}
      >
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="titulo-pantalla text-xl">{titulo}</h2>
              <p className="text-sm text-slate-600">{subtitulo}</p>
            </div>
            <button onClick={onCerrar} className="text-slate-600 hover:text-slate-900 text-xl leading-none">
              ✕
            </button>
          </div>

          {cargando ? (
            <p className="text-sm text-slate-600">Cargando…</p>
          ) : !filas || filas.length === 0 ? (
            <p className="text-sm text-slate-500">No hay ninguna EBAR con esta condición en esta fecha.</p>
          ) : agruparPorOperadorAqui ? (
            <div className="space-y-4">
              {gruposOperador.map(({ operador_id, operador_nombre, estaciones }) => (
                <div key={operador_id}>
                  <p className="text-xs font-bold text-sky-700 uppercase tracking-wider mb-1.5">
                    {operador_nombre} ({estaciones.length})
                  </p>
                  <div className="space-y-1.5">
                    {estaciones.map((e) => (
                      <FilaEstacionDetalle key={e.id} estacion={e} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {gruposZona.map(({ zona, tipo, estaciones }) => (
                <div key={`${zona}-${tipo}`}>
                  <p className="text-xs font-bold text-sky-700 uppercase tracking-wider mb-1.5">
                    {ETIQUETA_ZONA[zona] ?? zona} · {ETIQUETA_TIPO[tipo] ?? tipo} ({estaciones.length})
                  </p>
                  <div className="space-y-1.5">
                    {estaciones.map((e) => (
                      <FilaEstacionDetalle key={e.id} estacion={e} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {esAdmin && (
          <ManijaRedimension
            tamano={tam}
            min={TAMANO_MODAL_METRICA_MIN}
            max={TAMANO_MODAL_METRICA_MAX}
            onCambiar={setTam}
            onGuardar={onGuardarTamano}
          />
        )}
      </div>
    </>
  );
}
