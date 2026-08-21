import { useEffect, useMemo, useState } from 'react';
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
import { agruparPorZonaYTipo, ETIQUETA_ZONA, ETIQUETA_TIPO } from '../lib/agruparEstaciones';
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

/** Una de las 5 tarjetas de "Inicio" — al tocarla se abre ModalListaEstaciones con el detalle. */
type TipoMetrica = 'visitas' | 'sin_visitar' | 'equipos_alerta' | 'problemas' | 'voltaje';
/** Fila del detalle de una métrica: la estación + cuántas veces contribuyó al número de la
 * tarjeta (ej. 2 visitas en la misma EBAR) — 1 cuando la métrica ya es "una fila por estación"
 * de por sí (sin_visitar, problemas). */
type FilaDetalleMetrica = EstacionSimple & { count: number };

const TITULOS_METRICA: Record<TipoMetrica, string> = {
  visitas: 'Visitas registradas',
  sin_visitar: 'Estaciones sin visitar',
  equipos_alerta: 'Equipos con falla o por mantener',
  problemas: 'Estaciones con problemas',
  voltaje: 'Alertas de voltaje',
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
  // Todas las EBAR relevantes para este rol (para operador, solo las asignadas — mismo filtro que
  // sinVisitar) con cuántas visitas lleva CADA UNA hoy (de cualquier operador) — a diferencia de
  // sinVisitar, no se filtran las ya visitadas: alimenta "Pendientes de visita" con semáforo
  // rojo/tomate/verde en vez de solo listar las que faltan.
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
      setTodasEstacionesInfo((todasEstaciones as EstacionSimple[]) ?? []);

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

  // "Visitas registradas": reutiliza el mismo rango de fecha que el resto del Dashboard — una
  // fila por estación, con cuántas visitas tuvo hoy (puede ser más de 1).
  async function construirDetalleVisitas(): Promise<FilaDetalleMetrica[]> {
    let query = supabase
      .from('visitas')
      .select('estacion_id')
      .gte('fecha_hora_llegada', `${fecha}T00:00:00`)
      .lte('fecha_hora_llegada', `${fecha}T23:59:59`);
    if (usuario?.rol === 'operador') query = query.eq('operador_id', usuario.id);
    const { data } = await query;
    return contarPorEstacion(((data ?? []) as { estacion_id: string }[]).map((v) => v.estacion_id));
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

  async function abrirDetalleMetrica(tipo: TipoMetrica) {
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

  async function guardarTamanoModalMetrica(t: { ancho: number; alto: number }) {
    setTamanoModalMetrica(t);
    await guardarTamanoModal('modal_metrica_dashboard', t);
  }

  // Los bloques que un rol nunca llega a ver ("tus_ebar_hoy" es solo de operador,
  // "visitas_sospechosas"/"bajo_minimo" son solo de admin/supervisor) se sacan del grid editable
  // — si no, quedan como una celda vacía y arrastrable sin contenido dentro (ver
  // renderBloque más abajo, que además explica por qué se ven vacíos AL EDITAR aunque si
  // apliquen). En modo edición, el rol que importa es el que se está previsualizando en el
  // selector de "Editar distribución" (objetivoActivo) — NO el rol real de quien edita: un
  // administrador arreglando la distribución de "Operador" necesita seguir viendo (y poder
  // agrandar) "Tus EBAR de hoy" aunque él mismo no sea operador. "Todos" no filtra nada, para
  // poder acomodar el set completo del acomodo compartido.
  const modoEdicionActivo = puedeEditarDistribucion && editorDistribucion.modoEdicion;
  const rolParaBloques = modoEdicionActivo ? editorDistribucion.objetivoActivo : usuario?.rol;
  const bloquesDashboard = PANTALLAS_EDITABLES.find((p) => p.id === 'dashboard')!.bloques.filter((b) => {
    if (!rolParaBloques || rolParaBloques === 'todos') return true;
    const rolEsAdminComo = rolParaBloques === 'administrador' || rolParaBloques === 'supervisor';
    if (b.id === 'tus_ebar_hoy') return !rolEsAdminComo;
    if (b.id === 'visitas_sospechosas' || b.id === 'bajo_minimo') return rolEsAdminComo;
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
          onAbrirDetalle={abrirDetalleMetrica}
        />
        {!esAdmin && <BloqueTusEbarHoy misEstacionesHoy={misEstacionesHoy} esRegular={esRegular} />}
        <BloquePendientesVisita
          estadoVisitasHoy={estadoVisitasHoy}
          esRegular={esRegular}
          mostrarSinVisitar={mostrarSinVisitar}
          setMostrarSinVisitar={setMostrarSinVisitar}
        />
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
                    onAbrirDetalle={abrirDetalleMetrica}
                  />
                );
              case 'tus_ebar_hoy':
                if (!esAdmin) return <BloqueTusEbarHoy misEstacionesHoy={misEstacionesHoy} esRegular={esRegular} />;
                // Se ve vacío para el administrador (sus propias EBAR de hoy no aplican) aunque el
                // bloque siga presente para poder acomodarlo — el operador real sí va a ver su
                // contenido acá.
                return modoEdicionActivo ? <BloqueVistaPreviaNoDisponible texto="Solo lo ve el operador." /> : null;
              case 'pendientes_visita':
                return (
                  <BloquePendientesVisita
                    estadoVisitasHoy={estadoVisitasHoy}
                    esRegular={esRegular}
                    mostrarSinVisitar={mostrarSinVisitar}
                    setMostrarSinVisitar={setMostrarSinVisitar}
                  />
                );
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
          filas={detalleMetrica}
          cargando={cargandoDetalle}
          esAdmin={esAdministrador}
          tamano={tamanoModalMetrica}
          onGuardarTamano={guardarTamanoModalMetrica}
          onCerrar={() => setModalMetrica(null)}
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
  onAbrirDetalle,
}: {
  tituloFecha: string;
  esAdmin: boolean;
  fecha: string;
  hoy: string;
  onCambiarFecha: (fecha: string) => void;
  resumen: DashboardResumen | null;
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
      {/* grid-metricas (ver index.css) acomoda las 5 tarjetas en 2/3/5 columnas según el ANCHO
          real del bloque (container query, no el de la pantalla) — con suficiente espacio entran
          las 5 en una sola fila en vez de quedar apiladas en 2 columnas siempre. */}
      <div className="grid-metricas lg:flex-1 lg:min-h-0">
        <Metrica label="Visitas registradas" valor={resumen?.total_visitas ?? 0} acento="ok" onClick={() => onAbrirDetalle('visitas')} />
        <Metrica label="Estaciones sin visitar" valor={resumen?.estaciones_sin_visitar ?? 0} acento="idle" onClick={() => onAbrirDetalle('sin_visitar')} />
        <Metrica label="Equipos con falla o por mantener" valor={resumen?.equipos_con_alerta ?? 0} acento="danger" onClick={() => onAbrirDetalle('equipos_alerta')} />
        <Metrica label="Estaciones con problemas" valor={resumen?.estaciones_con_problemas ?? 0} acento="warn" onClick={() => onAbrirDetalle('problemas')} />
        <Metrica label="Alertas de voltaje" valor={resumen?.alertas_voltaje ?? 0} acento="danger" onClick={() => onAbrirDetalle('voltaje')} />
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
 * visita" (todos los roles): rojo = 0 visitas, tomate = falta al menos 1, verde = ya cumplida. */
function colorSemaforoVisita(visitasHoy: number, meta: number): 'ok' | 'warn' | 'danger' {
  if (visitasHoy >= meta) return 'ok';
  if (visitasHoy > 0) return 'warn';
  return 'danger';
}

const CLASE_TARJETA_SEMAFORO: Record<'ok' | 'warn' | 'danger', string> = {
  ok: 'bg-gauge-ok/15 border-gauge-ok',
  warn: 'bg-gauge-warn/15 border-gauge-warn',
  danger: 'bg-gauge-danger/15 border-gauge-danger',
};
const CLASE_TEXTO_SEMAFORO: Record<'ok' | 'warn' | 'danger', string> = {
  ok: 'text-gauge-ok',
  warn: 'text-gauge-warn',
  danger: 'text-gauge-danger',
};

function BloqueTusEbarHoy({ misEstacionesHoy, esRegular }: { misEstacionesHoy: EstacionAsignadaHoy[]; esRegular: boolean }) {
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
        <div className="space-y-4">
          {/* Mismo agrupado por zona+tipo y cuadrícula de "Pendientes de visita" — ver
              agruparEstaciones.ts y .grid-tarjetas-compactas en index.css. */}
          {agruparPorZonaYTipo(misEstacionesHoy).map(({ zona, tipo, estaciones }) => (
            <div key={`${zona}-${tipo}`}>
              <p className="text-xs font-bold text-sky-700 uppercase tracking-wider mb-1.5">
                {ETIQUETA_ZONA[zona] ?? zona} · {ETIQUETA_TIPO[tipo] ?? tipo} ({estaciones.length})
              </p>
              <div className="grid-tarjetas-compactas">
                {estaciones.map((e) => {
                  const meta = esRegular ? MINIMO_VISITAS_DIA_REGULAR : 1;
                  const semaforo = colorSemaforoVisita(e.visitasHoy, meta);
                  return (
                    <Link
                      key={e.id}
                      to={`/estaciones/${e.id}/nueva-visita`}
                      className={`tarjeta p-3 flex flex-col gap-1 border-2 transition ${CLASE_TARJETA_SEMAFORO[semaforo]}`}
                    >
                      <p className="text-sm font-medium text-slate-900 truncate">{e.nombre}</p>
                      <p className="text-xs text-slate-500 lectura uppercase tracking-wide truncate">{e.codigo}</p>
                      <span className={`text-xs mt-1 font-semibold ${CLASE_TEXTO_SEMAFORO[semaforo]}`}>
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function BloquePendientesVisita({
  estadoVisitasHoy,
  esRegular,
  mostrarSinVisitar,
  setMostrarSinVisitar,
}: {
  estadoVisitasHoy: EstacionAsignadaHoy[];
  esRegular: boolean;
  mostrarSinVisitar: boolean;
  setMostrarSinVisitar: (updater: (v: boolean) => boolean) => void;
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
        <div className="space-y-4">
          {agruparPorZonaYTipo(estadoVisitasHoy).map(({ zona, tipo, estaciones }) => (
            <div key={`${zona}-${tipo}`}>
              <p className="text-xs font-bold text-sky-700 uppercase tracking-wider mb-1.5">
                {ETIQUETA_ZONA[zona] ?? zona} · {ETIQUETA_TIPO[tipo] ?? tipo} ({estaciones.length})
              </p>
              {/* grid-tarjetas-compactas (ver index.css): 2/3/4 columnas según el ancho real del
                  bloque — con suficiente espacio entran 4 tarjetas por fila. Cada tarjeta se
                  pinta entera (fondo + borde) según el semáforo: rojo sin ninguna visita hoy,
                  tomate (ámbar) con al menos 1 pero sin llegar a la meta, verde ya cumplida. */}
              <div className="grid-tarjetas-compactas">
                {estaciones.map((e) => {
                  const semaforo = colorSemaforoVisita(e.visitasHoy, meta);
                  return (
                    <Link
                      key={e.id}
                      to={`/estaciones/${e.id}/nueva-visita`}
                      className={`tarjeta p-3 flex flex-col gap-1 border-2 transition ${CLASE_TARJETA_SEMAFORO[semaforo]}`}
                    >
                      <p className="text-sm font-medium text-slate-900 truncate">{e.nombre}</p>
                      <p className="text-xs text-slate-500 lectura uppercase tracking-wide truncate">{e.codigo}</p>
                      <span className={`text-xs mt-1 font-semibold ${CLASE_TEXTO_SEMAFORO[semaforo]}`}>
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
  onClick,
}: {
  label: string;
  valor: number;
  acento: 'ok' | 'warn' | 'danger' | 'idle';
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="tarjeta p-4 text-left w-full hover:border-gauge-ok/50 transition">
      <p className="text-xs text-slate-600 mb-1">{label}</p>
      <p className={`text-3xl font-bold lectura ${COLOR_ACENTO[acento]}`}>{valor}</p>
    </button>
  );
}

/** Se abre al tocar cualquiera de las 5 tarjetas de "Inicio" — lista las EBAR que componen ese
 * número, agrupadas por zona+tipo (mismo criterio y estilo que el resto de la app), cada una
 * como enlace directo a su ficha. Redimensionable por el administrador (ver ManijaRedimension). */
function ModalListaEstaciones({
  titulo,
  subtitulo,
  filas,
  cargando,
  esAdmin,
  tamano,
  onGuardarTamano,
  onCerrar,
}: {
  titulo: string;
  subtitulo: string;
  filas: FilaDetalleMetrica[] | null;
  cargando: boolean;
  esAdmin: boolean;
  tamano: { ancho: number; alto: number };
  onGuardarTamano: (t: { ancho: number; alto: number }) => void;
  onCerrar: () => void;
}) {
  const [tam, setTam] = useState(tamano);
  const grupos = useMemo(() => agruparPorZonaYTipo(filas ?? []), [filas]);

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
          ) : (
            <div className="space-y-4">
              {grupos.map(({ zona, tipo, estaciones }) => (
                <div key={`${zona}-${tipo}`}>
                  <p className="text-xs font-bold text-sky-700 uppercase tracking-wider mb-1.5">
                    {ETIQUETA_ZONA[zona] ?? zona} · {ETIQUETA_TIPO[tipo] ?? tipo} ({estaciones.length})
                  </p>
                  <div className="space-y-1.5">
                    {estaciones.map((e) => (
                      <Link
                        key={e.id}
                        to={`/estaciones/${e.id}`}
                        className="tarjeta p-3 flex items-center justify-between gap-2 hover:border-gauge-ok/50 transition"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">{e.nombre}</p>
                          <p className="text-xs text-slate-500 lectura uppercase tracking-wide truncate">{e.codigo}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {e.count > 1 && <span className="text-xs text-slate-500">×{e.count}</span>}
                          <span className="text-xs text-gauge-ok">Ver →</span>
                        </div>
                      </Link>
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
