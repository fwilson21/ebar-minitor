import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { AsignacionEstacion, EstacionEbar, ExcepcionGps, Usuario } from '../lib/types';
import { hoyLocal } from '../lib/fecha';
import { registrarFormularioActivo, desregistrarFormularioActivo } from '../lib/formularioActivo';
import { GridEditable } from '../components/GridEditable';
import { BarraDistribucion } from '../components/BarraDistribucion';
import { PANTALLAS_EDITABLES } from '../lib/pantallasEditables';
import { useEditorDistribucion } from '../hooks/useEditorDistribucion';
import { agruparPorZonaYTipo, ETIQUETA_ZONA, ETIQUETA_TIPO, codigoYNombre } from '../lib/agruparEstaciones';

// Sentinel del selector "Operador" para el modo "Todos los operadores" — pedido del usuario
// (2026-09-09) para agregar lo mismo a todo el mundo sin repetir operador por operador. Se ofrece
// en "Asignación especial por fecha" (ej. un refuerzo de feriado/fin de semana para todo el mundo)
// y en "Excepción de GPS" (2026-09-09, 2do pedido) — el usuario pidió explícitamente que NO
// aplique a "Asignación por defecto" (esa sigue siendo operador por operador). SIEMPRE agrega,
// nunca quita ni reemplaza nada que un operador ya tuviera.
const TODOS_OPERADORES = '__todos__';

function dentroDelRango(fecha: string, desde: string, hasta: string): boolean {
  return fecha >= desde && fecha <= hasta;
}

/** De varias asignaciones especiales para la misma estación en distintas fechas dentro del
 * rango elegido, se queda solo con la más reciente — evita listar una fila por cada día repetido
 * (típico de los turnos de fin de semana/feriado, que generan una fila por EBAR y por día). */
function soloLaUltimaPorEstacion(lista: AsignacionEstacion[]): AsignacionEstacion[] {
  const porEstacion = new Map<string, AsignacionEstacion>();
  for (const a of lista) {
    const actual = porEstacion.get(a.estacion_id);
    if (!actual || (a.fecha ?? '') > (actual.fecha ?? '')) porEstacion.set(a.estacion_id, a);
  }
  return [...porEstacion.values()].sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''));
}

export function Asignaciones() {
  const { usuario } = useAuth();
  // "Editar distribución" es exclusiva del administrador real (ver migración 0053) — esta
  // pantalla también la usa el supervisor, que puede usarla pero no reacomodarla.
  const esAdmin = usuario?.rol === 'administrador';
  const puedeEditarDistribucion = esAdmin;
  const editorDistribucion = useEditorDistribucion('asignaciones');
  const [operadores, setOperadores] = useState<Usuario[]>([]);
  const [estaciones, setEstaciones] = useState<EstacionEbar[]>([]);
  const [operadorId, setOperadorId] = useState('');
  const [cargando, setCargando] = useState(true);
  const [cargandoAsignaciones, setCargandoAsignaciones] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [todasAsignaciones, setTodasAsignaciones] = useState<AsignacionEstacion[]>([]);

  // Filtro de "qué ventana de fechas estoy viendo" — se usa tanto en el resumen de arriba como en
  // la lista de asignaciones especiales del operador elegido más abajo. Sin fecha "desde", no se
  // muestra ninguna asignación especial (solo la de por defecto), para no inundar la pantalla.
  const [filtroDesde, setFiltroDesde] = useState('');
  const [filtroHasta, setFiltroHasta] = useState('');
  const hayFiltro = !!filtroDesde;
  const filtroHastaEfectivo = filtroHasta || filtroDesde;

  const [asignacionesDefault, setAsignacionesDefault] = useState<Set<string>>(new Set());
  const [seleccionDefault, setSeleccionDefault] = useState<Set<string>>(new Set());

  const [asignacionesEspeciales, setAsignacionesEspeciales] = useState<AsignacionEstacion[]>([]);
  const [fechaEspecial, setFechaEspecial] = useState('');
  const [seleccionEspecial, setSeleccionEspecial] = useState<Set<string>>(new Set());
  // Aviso propio de este bloque (no el `mensaje` compartido de arriba, que solo se ve en el panel
  // "Operador") — mismo criterio que ya tenía Excepción de GPS. El usuario reportó (2026-09-10)
  // que "Quitar de todos" parecía no hacer nada: lo más probable es que sí funcionaba pero el
  // aviso quedaba en un panel que no estaba mirando.
  const [mensajeEspecial, setMensajeEspecial] = useState<string | null>(null);

  // Excepción de GPS (ver migración 0056): supervisor/administrador la otorga a un operador para
  // una EBAR con problemas conocidos de cobertura, sin depender de que el propio operador se la
  // auto-conceda. Mensaje/guardando propios (no el `mensaje`/`guardando` compartido de arriba) —
  // el usuario pidió que cada aviso quede pegado a su propio botón.
  const [excepcionesGps, setExcepcionesGps] = useState<ExcepcionGps[]>([]);
  // Todas las excepciones de GPS de todos los operadores — solo se usa para el modo "Todos los
  // operadores" (ver TODOS_OPERADORES), para no duplicar una excepción idéntica que ya exista
  // (la tabla no tiene una restricción única que lo evite sola, a diferencia de asignaciones_estacion).
  const [todasExcepciones, setTodasExcepciones] = useState<ExcepcionGps[]>([]);
  const [seleccionExcepcion, setSeleccionExcepcion] = useState<Set<string>>(new Set());
  const [modoExcepcion, setModoExcepcion] = useState<'un_dia' | 'rango' | 'indefinido'>('un_dia');
  const [excepcionDesde, setExcepcionDesde] = useState('');
  const [excepcionHasta, setExcepcionHasta] = useState('');
  const [guardandoExcepcion, setGuardandoExcepcion] = useState(false);
  const [mensajeExcepcion, setMensajeExcepcion] = useState<string | null>(null);

  useEffect(() => {
    async function cargarBase() {
      const [{ data: ops }, { data: est }, { data: asigTodas }, { data: excepTodas }] = await Promise.all([
        supabase.from('usuarios').select('*').eq('rol', 'operador').eq('activo', true).order('nombre_completo'),
        supabase.from('estaciones_ebar').select('*').eq('activa', true).order('nombre'),
        supabase.from('asignaciones_estacion').select('*'),
        supabase.from('excepciones_gps').select('*'),
      ]);
      setOperadores((ops as Usuario[]) ?? []);
      setEstaciones((est as EstacionEbar[]) ?? []);
      setTodasAsignaciones((asigTodas as AsignacionEstacion[]) ?? []);
      setTodasExcepciones((excepTodas as ExcepcionGps[]) ?? []);
      setCargando(false);
    }
    cargarBase();
  }, []);

  async function cargarTodasAsignaciones() {
    const { data } = await supabase.from('asignaciones_estacion').select('*');
    setTodasAsignaciones((data as AsignacionEstacion[]) ?? []);
  }

  async function cargarTodasExcepciones() {
    const { data } = await supabase.from('excepciones_gps').select('*');
    setTodasExcepciones((data as ExcepcionGps[]) ?? []);
  }

  useEffect(() => {
    // "Todos los operadores": arranca en blanco (nada premarcado — mezclar lo que cada operador
    // ya tiene por defecto no tendría sentido acá) y no trae asignaciones especiales ni
    // excepciones de GPS (esos 2 bloques quedan deshabilitados en este modo, ver TODOS_OPERADORES).
    if (!operadorId || operadorId === TODOS_OPERADORES) {
      setAsignacionesDefault(new Set());
      setSeleccionDefault(new Set());
      setAsignacionesEspeciales([]);
      setExcepcionesGps([]);
      return;
    }
    cargarAsignaciones(operadorId);
    cargarExcepciones(operadorId);
  }, [operadorId]);

  async function cargarExcepciones(opId: string) {
    const { data } = await supabase.from('excepciones_gps').select('*').eq('operador_id', opId);
    setExcepcionesGps(((data as ExcepcionGps[]) ?? []).sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')));
  }

  async function agregarExcepcion() {
    if (!operadorId || seleccionExcepcion.size === 0) return;
    if (modoExcepcion !== 'indefinido' && !excepcionDesde) return;
    if (modoExcepcion === 'rango' && !excepcionHasta) return;
    setGuardandoExcepcion(true);
    setMensajeExcepcion(null);
    try {
      const fecha_inicio = modoExcepcion === 'indefinido' ? null : excepcionDesde;
      const fecha_fin = modoExcepcion === 'indefinido' ? null : modoExcepcion === 'un_dia' ? excepcionDesde : excepcionHasta;
      const { error } = await supabase.from('excepciones_gps').insert(
        [...seleccionExcepcion].map((estacion_id) => ({
          operador_id: operadorId,
          estacion_id,
          fecha_inicio,
          fecha_fin,
          creado_por: usuario?.id,
        })),
      );
      if (error) throw error;
      setSeleccionExcepcion(new Set());
      await cargarExcepciones(operadorId);
      setMensajeExcepcion('Excepción de GPS agregada.');
    } catch (err: any) {
      setMensajeExcepcion(`No se pudo agregar: ${err.message ?? err}`);
    } finally {
      setGuardandoExcepcion(false);
    }
  }

  /** "Todos los operadores": otorga la(s) excepción(es) de GPS marcadas a TODOS los operadores
   * activos de una sola vez, con el mismo período elegido. Nunca duplica: `excepciones_gps` no
   * tiene una restricción única que lo evite sola (a diferencia de asignaciones_estacion), así que
   * se descarta a mano cualquier combinación operador+estación+período IDÉNTICA que ya exista. */
  async function agregarExcepcionParaTodos() {
    if (seleccionExcepcion.size === 0) return;
    if (modoExcepcion !== 'indefinido' && !excepcionDesde) return;
    if (modoExcepcion === 'rango' && !excepcionHasta) return;
    setGuardandoExcepcion(true);
    setMensajeExcepcion(null);
    try {
      const fecha_inicio = modoExcepcion === 'indefinido' ? null : excepcionDesde;
      const fecha_fin = modoExcepcion === 'indefinido' ? null : modoExcepcion === 'un_dia' ? excepcionDesde : excepcionHasta;
      const yaExisten = new Set(
        todasExcepciones
          .filter((e) => e.fecha_inicio === fecha_inicio && e.fecha_fin === fecha_fin)
          .map((e) => `${e.operador_id}:${e.estacion_id}`),
      );
      const filas = operadores.flatMap((o) =>
        [...seleccionExcepcion]
          .filter((estacionId) => !yaExisten.has(`${o.id}:${estacionId}`))
          .map((estacion_id) => ({
            operador_id: o.id,
            estacion_id,
            fecha_inicio,
            fecha_fin,
            creado_por: usuario?.id,
          })),
      );
      if (filas.length) {
        const { error } = await supabase.from('excepciones_gps').insert(filas);
        if (error) throw error;
      }
      setSeleccionExcepcion(new Set());
      await cargarTodasExcepciones();
      setMensajeExcepcion(
        filas.length
          ? `Otorgada a los ${operadores.length} operadores (${filas.length} excepciones nuevas — a quien ya tenía la misma no se le duplicó).`
          : 'Todos los operadores ya tenían esa misma excepción — no había nada que agregar.',
      );
    } catch (err: any) {
      setMensajeExcepcion(`No se pudo agregar: ${err.message ?? err}`);
    } finally {
      setGuardandoExcepcion(false);
    }
  }

  /** "Todos los operadores": lo contrario de agregarExcepcionParaTodos — quita esa excepción
   * (EBAR + período EXACTO) a cualquier operador que la tuviera. Pedido del usuario (2026-09-09):
   * así como se puede otorgar a todos de una sola, también poder revocarla a todos. */
  /** Quita TODAS las excepciones de GPS de ese período exacto (de cualquier operador, cualquier
   * EBAR) — ya no depende de tener marcada la EBAR en los botones de arriba, mismo motivo (y
   * mismo arreglo) que quitarEspecialParaTodos: `seleccionExcepcion` se vacía solo después de
   * "Otorgar a todos", así que al querer revocar lo recién otorgado ya no había nada marcado y el
   * botón quedaba deshabilitado sin ningún aviso. Para sacar una EBAR puntual está el "Quitar" de
   * la lista de abajo (uno por uno). */
  async function quitarExcepcionParaTodos() {
    if (modoExcepcion !== 'indefinido' && !excepcionDesde) return;
    if (modoExcepcion === 'rango' && !excepcionHasta) return;
    setGuardandoExcepcion(true);
    setMensajeExcepcion(null);
    try {
      const fecha_inicio = modoExcepcion === 'indefinido' ? null : excepcionDesde;
      const fecha_fin = modoExcepcion === 'indefinido' ? null : modoExcepcion === 'un_dia' ? excepcionDesde : excepcionHasta;
      let query = supabase.from('excepciones_gps').delete();
      query = fecha_inicio === null ? query.is('fecha_inicio', null) : query.eq('fecha_inicio', fecha_inicio);
      query = fecha_fin === null ? query.is('fecha_fin', null) : query.eq('fecha_fin', fecha_fin);
      const { data, error } = await query.select('id');
      if (error) throw error;
      const cantidad = data?.length ?? 0;
      await cargarTodasExcepciones();
      setMensajeExcepcion(
        cantidad > 0
          ? `Quitadas las ${cantidad} excepciones de ese período (de todos los operadores).`
          : 'No había ninguna excepción con ese período — no había nada que quitar.',
      );
    } catch (err: any) {
      setMensajeExcepcion(`No se pudo quitar: ${err.message ?? err}`);
    } finally {
      setGuardandoExcepcion(false);
    }
  }

  async function quitarExcepcion(id: string) {
    setGuardandoExcepcion(true);
    setMensajeExcepcion(null);
    const { error } = await supabase.from('excepciones_gps').delete().eq('id', id);
    if (error) {
      setMensajeExcepcion(`No se pudo quitar: ${error.message}`);
    } else {
      setExcepcionesGps((prev) => prev.filter((e) => e.id !== id));
      setTodasExcepciones((prev) => prev.filter((e) => e.id !== id));
    }
    setGuardandoExcepcion(false);
  }

  async function cargarAsignaciones(opId: string) {
    setCargandoAsignaciones(true);
    const { data } = await supabase.from('asignaciones_estacion').select('*').eq('operador_id', opId);
    const lista = (data as AsignacionEstacion[]) ?? [];
    const porDefecto = new Set(lista.filter((a) => a.fecha === null).map((a) => a.estacion_id));
    setAsignacionesDefault(porDefecto);
    setSeleccionDefault(new Set(porDefecto));
    setAsignacionesEspeciales(
      lista.filter((a) => a.fecha !== null).sort((a, b) => (a.fecha! < b.fecha! ? 1 : -1)),
    );
    setSeleccionEspecial(new Set());
    setCargandoAsignaciones(false);
  }

  function alternar(set: Set<string>, setSet: (s: Set<string>) => void, estacionId: string) {
    const nuevo = new Set(set);
    if (nuevo.has(estacionId)) nuevo.delete(estacionId);
    else nuevo.add(estacionId);
    setSet(nuevo);
  }

  async function guardarDefault() {
    if (!operadorId) return;
    setGuardando(true);
    setMensaje(null);
    try {
      const agregar = [...seleccionDefault].filter((id) => !asignacionesDefault.has(id));
      const quitar = [...asignacionesDefault].filter((id) => !seleccionDefault.has(id));

      if (agregar.length) {
        const { error } = await supabase.from('asignaciones_estacion').insert(
          agregar.map((estacion_id) => ({ operador_id: operadorId, estacion_id, fecha: null, creado_por: usuario?.id })),
        );
        if (error) throw error;
      }
      if (quitar.length) {
        const { error } = await supabase
          .from('asignaciones_estacion')
          .delete()
          .eq('operador_id', operadorId)
          .is('fecha', null)
          .in('estacion_id', quitar);
        if (error) throw error;
      }
      setAsignacionesDefault(new Set(seleccionDefault));
      await cargarTodasAsignaciones();
      setMensaje('Asignación por defecto guardada.');
    } catch (err: any) {
      setMensaje(`No se pudo guardar: ${err.message ?? err}`);
    } finally {
      setGuardando(false);
    }
  }

  async function agregarEspecial() {
    if (!operadorId || !fechaEspecial || seleccionEspecial.size === 0) return;
    setGuardando(true);
    setMensajeEspecial(null);
    try {
      const { error } = await supabase.from('asignaciones_estacion').insert(
        [...seleccionEspecial].map((estacion_id) => ({
          operador_id: operadorId,
          estacion_id,
          fecha: fechaEspecial,
          creado_por: usuario?.id,
        })),
      );
      // 23505 = ya existía esa estación asignada para ese operador en esa fecha: no es un error real.
      if (error && error.code !== '23505') throw error;
      await cargarAsignaciones(operadorId);
      await cargarTodasAsignaciones();
      setMensajeEspecial('Asignación especial agregada.');
    } catch (err: any) {
      setMensajeEspecial(`No se pudo agregar: ${err.message ?? err}`);
    } finally {
      setGuardando(false);
    }
  }

  /** "Todos los operadores": agrega la(s) EBAR marcadas como asignación especial de esa fecha a
   * TODOS los operadores activos de una sola vez (ej. un refuerzo de feriado/fin de semana para
   * todo el mundo). Nunca quita nada; a quien ya tuviera esa EBAR asignada ese mismo día
   * simplemente no se le duplica — se filtra ANTES de insertar (en vez de confiar en el error
   * 23505 de `agregarEspecial`, que en un insert de varias filas a la vez haría fallar el lote
   * completo si UNA sola ya existía, y ninguna de las demás quedaría agregada). */
  async function agregarEspecialParaTodos() {
    if (!fechaEspecial || seleccionEspecial.size === 0) return;
    setGuardando(true);
    setMensajeEspecial(null);
    try {
      const yaExisten = new Set(
        todasAsignaciones.filter((a) => a.fecha === fechaEspecial).map((a) => `${a.operador_id}:${a.estacion_id}`),
      );
      const filas = operadores.flatMap((o) =>
        [...seleccionEspecial]
          .filter((estacionId) => !yaExisten.has(`${o.id}:${estacionId}`))
          .map((estacionId) => ({ operador_id: o.id, estacion_id: estacionId, fecha: fechaEspecial, creado_por: usuario?.id })),
      );
      if (filas.length) {
        const { error } = await supabase.from('asignaciones_estacion').insert(filas);
        if (error) throw error;
      }
      setSeleccionEspecial(new Set());
      await cargarTodasAsignaciones();
      setMensajeEspecial(
        filas.length
          ? `Agregada a los ${operadores.length} operadores para el ${fechaEspecial} (${filas.length} asignaciones nuevas — a quien ya la tenía ese día no se le duplicó).`
          : 'Todos los operadores ya tenían esas EBAR asignadas ese día — no había nada que agregar.',
      );
    } catch (err: any) {
      setMensajeEspecial(`No se pudo agregar: ${err.message ?? err}`);
    } finally {
      setGuardando(false);
    }
  }

  /** "Todos los operadores": lo contrario de agregarEspecialParaTodos — quita la asignación
   * especial de esa fecha con esas EBAR a CUALQUIER operador que la tuviera, no solo a los
   * activos ahora mismo (mismo criterio "de una sola vez" que agregar). Pedido del usuario
   * (2026-09-09): así como se puede asignar a todos de una sola, también poder desasignar. */
  /** Quita TODAS las asignaciones especiales de esa fecha (de cualquier operador, cualquier EBAR)
   * — ya no depende de tener marcada la EBAR en los botones de arriba. Antes sí dependía de eso
   * (`.in('estacion_id', [...seleccionEspecial])`) y el usuario reportó (2026-09-10) que el botón
   * "no funcionaba": la causa real es que `seleccionEspecial` se vacía solo después de "Agregar a
   * todos" (para dejar la selección lista para la próxima), así que al querer quitar lo recién
   * agregado ya no había nada marcado — el botón quedaba deshabilitado y el clic no hacía nada,
   * sin ningún aviso (confirmado contra la base real: las filas de prueba del usuario seguían ahí
   * intactas). "Todos de una" ahora significa de verdad "todo lo de ese día", no "lo que esté
   * marcado en los botones" — para sacar una EBAR puntual está el botón "Quitar" de la lista de
   * abajo (uno por uno). */
  async function quitarEspecialParaTodos() {
    if (!fechaEspecial) return;
    setGuardando(true);
    setMensajeEspecial(null);
    try {
      const { data, error } = await supabase
        .from('asignaciones_estacion')
        .delete()
        .eq('fecha', fechaEspecial)
        .select('id');
      if (error) throw error;
      const cantidad = data?.length ?? 0;
      await cargarTodasAsignaciones();
      setMensajeEspecial(
        cantidad > 0
          ? `Quitadas las ${cantidad} asignaciones especiales del ${fechaEspecial} (de todos los operadores).`
          : 'No había ninguna asignación especial para ese día — no había nada que quitar.',
      );
    } catch (err: any) {
      setMensajeEspecial(`No se pudo quitar: ${err.message ?? err}`);
    } finally {
      setGuardando(false);
    }
  }

  async function quitarEspecial(id: string) {
    setGuardando(true);
    setMensajeEspecial(null);
    const { error } = await supabase.from('asignaciones_estacion').delete().eq('id', id);
    if (error) {
      setMensajeEspecial(`No se pudo quitar: ${error.message}`);
    } else {
      setAsignacionesEspeciales((prev) => prev.filter((a) => a.id !== id));
      await cargarTodasAsignaciones();
    }
    setGuardando(false);
  }

  function nombreEstacion(estacionId: string): string {
    const e = estaciones.find((x) => x.id === estacionId);
    return e ? codigoYNombre(e) : estacionId;
  }

  function codigoEstacion(estacionId: string): string {
    return estaciones.find((x) => x.id === estacionId)?.codigo ?? '?';
  }

  // Le avisa al header (botón "Salir") si hay cambios sin guardar en esta pantalla: la
  // asignación por defecto marcada pero no guardada, una asignación especial a medio llenar
  // (fecha + al menos una estación ya elegidas pero sin tocar "Agregar" todavía), o una excepción
  // de GPS a medio llenar (misma idea, ver agregarExcepcion para la validación exacta por modo).
  useEffect(() => {
    const seleccionDefaultDistinta =
      seleccionDefault.size !== asignacionesDefault.size ||
      [...seleccionDefault].some((id) => !asignacionesDefault.has(id));
    const hayPendienteEspecial = !!fechaEspecial && seleccionEspecial.size > 0;
    const hayPendienteExcepcion =
      seleccionExcepcion.size > 0 &&
      (modoExcepcion === 'indefinido' || !!excepcionDesde) &&
      (modoExcepcion !== 'rango' || !!excepcionHasta);

    registrarFormularioActivo({
      hayCambios: seleccionDefaultDistinta || hayPendienteEspecial || hayPendienteExcepcion,
      guardar: async () => {
        if (seleccionDefaultDistinta) await guardarDefault();
        if (hayPendienteEspecial) {
          if (operadorId === TODOS_OPERADORES) await agregarEspecialParaTodos();
          else await agregarEspecial();
        }
        if (hayPendienteExcepcion) {
          if (operadorId === TODOS_OPERADORES) await agregarExcepcionParaTodos();
          else await agregarExcepcion();
        }
      },
    });
    return () => desregistrarFormularioActivo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operadorId, seleccionDefault, asignacionesDefault, fechaEspecial, seleccionEspecial, seleccionExcepcion, modoExcepcion, excepcionDesde, excepcionHasta]);

  if (cargando) return <p className="text-slate-600">Cargando…</p>;

  const asignacionesEspecialesFiltradas = hayFiltro
    ? soloLaUltimaPorEstacion(
        asignacionesEspeciales.filter((a) => a.fecha && dentroDelRango(a.fecha, filtroDesde, filtroHastaEfectivo)),
      )
    : [];

  const props = {
    operadores,
    estaciones,
    operadorId,
    setOperadorId,
    mensaje,
    todasAsignaciones,
    todasExcepciones,
    filtroDesde,
    setFiltroDesde,
    filtroHasta,
    setFiltroHasta,
    hayFiltro,
    filtroHastaEfectivo,
    cargandoAsignaciones,
    seleccionDefault,
    setSeleccionDefault,
    guardando,
    guardarDefault,
    fechaEspecial,
    setFechaEspecial,
    seleccionEspecial,
    setSeleccionEspecial,
    agregarEspecial,
    agregarEspecialParaTodos,
    quitarEspecialParaTodos,
    mensajeEspecial,
    asignacionesEspecialesFiltradas,
    quitarEspecial,
    alternar,
    nombreEstacion,
    codigoEstacion,
    excepcionesGps,
    seleccionExcepcion,
    setSeleccionExcepcion,
    modoExcepcion,
    setModoExcepcion,
    excepcionDesde,
    setExcepcionDesde,
    excepcionHasta,
    setExcepcionHasta,
    guardandoExcepcion,
    mensajeExcepcion,
    agregarExcepcion,
    agregarExcepcionParaTodos,
    quitarExcepcionParaTodos,
    quitarExcepcion,
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="titulo-pantalla">Asignación de EBAR a operadores</h1>
        <p className="text-sm text-slate-600">
          Elige qué estaciones visita cada operador por defecto, y agrega asignaciones extra para un día puntual
          (fines de semana, feriados, refuerzos).
        </p>
      </div>

      {/* Celular: exactamente el mismo apilado de siempre, sin GridEditable. */}
      <div className="lg:hidden space-y-5">
        <BloqueResumen {...props} />
        <BloqueSeleccionarOperador {...props} />
        {operadorId && cargandoAsignaciones ? (
          <p className="text-slate-600">Cargando asignaciones…</p>
        ) : (
          <>
            <BloqueAsignacionDefault {...props} />
            <BloqueAsignacionEspecial {...props} />
            <BloqueExcepcionGps {...props} />
          </>
        )}
      </div>

      {/* Escritorio (lg+): mismos bloques, acomodados según lo guardado (o el acomodo por
          defecto). Los últimos 2 siempre se muestran (con las estaciones sin marcar, deshabilitadas
          hasta elegir un operador arriba) para no dejar la pantalla con huecos vacíos. Solo el
          administrador ve "Editar distribución" (supervisor la usa pero no la reacomoda). */}
      <div className="hidden lg:block space-y-3">
        {puedeEditarDistribucion && <BarraDistribucion editor={editorDistribucion} />}
        <GridEditable
          pantallaId="asignaciones"
          bloques={PANTALLAS_EDITABLES.find((p) => p.id === 'asignaciones')!.bloques}
          modoEdicion={puedeEditarDistribucion && editorDistribucion.modoEdicion}
          resetSignal={editorDistribucion.resetSignal}
          objetivoEdicion={editorDistribucion.objetivoActivo}
          onGuardar={editorDistribucion.guardar}
          renderBloque={(bloqueId) => {
            switch (bloqueId) {
              case 'resumen':
                return <BloqueResumen {...props} />;
              case 'seleccionar_operador':
                return <BloqueSeleccionarOperador {...props} />;
              case 'asignacion_default':
                return operadorId && cargandoAsignaciones ? <p className="text-slate-600">Cargando…</p> : <BloqueAsignacionDefault {...props} />;
              case 'asignacion_especial':
                return operadorId && cargandoAsignaciones ? <p className="text-slate-600">Cargando…</p> : <BloqueAsignacionEspecial {...props} />;
              case 'excepcion_gps':
                return operadorId && cargandoAsignaciones ? <p className="text-slate-600">Cargando…</p> : <BloqueExcepcionGps {...props} />;
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

type BloquesProps = {
  operadores: Usuario[];
  estaciones: EstacionEbar[];
  operadorId: string;
  setOperadorId: (v: string) => void;
  mensaje: string | null;
  todasAsignaciones: AsignacionEstacion[];
  todasExcepciones: ExcepcionGps[];
  filtroDesde: string;
  setFiltroDesde: (v: string) => void;
  filtroHasta: string;
  setFiltroHasta: (v: string) => void;
  hayFiltro: boolean;
  filtroHastaEfectivo: string;
  cargandoAsignaciones: boolean;
  seleccionDefault: Set<string>;
  setSeleccionDefault: (s: Set<string>) => void;
  guardando: boolean;
  guardarDefault: () => void;
  fechaEspecial: string;
  setFechaEspecial: (v: string) => void;
  seleccionEspecial: Set<string>;
  setSeleccionEspecial: (s: Set<string>) => void;
  agregarEspecial: () => void;
  agregarEspecialParaTodos: () => void;
  quitarEspecialParaTodos: () => void;
  mensajeEspecial: string | null;
  asignacionesEspecialesFiltradas: AsignacionEstacion[];
  quitarEspecial: (id: string) => void;
  alternar: (set: Set<string>, setSet: (s: Set<string>) => void, estacionId: string) => void;
  nombreEstacion: (id: string) => string;
  codigoEstacion: (id: string) => string;
  excepcionesGps: ExcepcionGps[];
  seleccionExcepcion: Set<string>;
  setSeleccionExcepcion: (s: Set<string>) => void;
  modoExcepcion: 'un_dia' | 'rango' | 'indefinido';
  setModoExcepcion: (m: 'un_dia' | 'rango' | 'indefinido') => void;
  excepcionDesde: string;
  setExcepcionDesde: (v: string) => void;
  excepcionHasta: string;
  setExcepcionHasta: (v: string) => void;
  guardandoExcepcion: boolean;
  mensajeExcepcion: string | null;
  agregarExcepcion: () => void;
  agregarExcepcionParaTodos: () => void;
  quitarExcepcionParaTodos: () => void;
  quitarExcepcion: (id: string) => void;
};

function BloqueResumen({
  operadores,
  todasAsignaciones,
  filtroDesde,
  setFiltroDesde,
  filtroHasta,
  setFiltroHasta,
  hayFiltro,
  filtroHastaEfectivo,
  codigoEstacion,
}: BloquesProps) {
  return (
    <div className="tarjeta p-4 space-y-3 lg:h-full lg:overflow-auto">
      <div>
        <h2 className="text-base font-semibold">Resumen de asignaciones</h2>
        <p className="text-xs text-slate-500">
          Qué EBAR tiene cada operador por defecto. Elegí una fecha (o un rango) para ver también sus asignaciones
          especiales de esos días.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="etiqueta">Ver desde</label>
          <input type="date" className="campo" value={filtroDesde} onChange={(e) => setFiltroDesde(e.target.value)} />
        </div>
        <div>
          <label className="etiqueta">Hasta (opcional)</label>
          <input
            type="date"
            className="campo"
            value={filtroHasta}
            onChange={(e) => setFiltroHasta(e.target.value)}
            disabled={!filtroDesde}
          />
        </div>
      </div>

      {operadores.length === 0 ? (
        <p className="text-sm text-slate-500">No hay operadores activos.</p>
      ) : (
        <div className="space-y-3">
          {operadores.map((o) => {
            const deEsteOperador = todasAsignaciones.filter((a) => a.operador_id === o.id);
            const porDefecto = deEsteOperador.filter((a) => a.fecha === null);
            const especialesEnRango = hayFiltro
              ? soloLaUltimaPorEstacion(
                  deEsteOperador.filter((a) => a.fecha && dentroDelRango(a.fecha, filtroDesde, filtroHastaEfectivo)),
                )
              : [];
            return (
              <div key={o.id} className="border-b border-panel-600/40 pb-3 last:border-0 last:pb-0">
                <p className="text-sm font-medium text-slate-900">{o.nombre_completo}</p>
                <p className="text-xs text-slate-600">
                  Por defecto:{' '}
                  {porDefecto.length > 0 ? porDefecto.map((a) => codigoEstacion(a.estacion_id)).join(', ') : 'Ninguna'}
                </p>
                {hayFiltro && (
                  <div className="text-xs text-slate-500 mt-1">
                    {especialesEnRango.length > 0 ? (
                      especialesEnRango.map((a) => (
                        <p key={a.id}>
                          {a.fecha} · {codigoEstacion(a.estacion_id)}
                        </p>
                      ))
                    ) : (
                      <p className="italic">Sin asignación especial en ese rango.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BloqueSeleccionarOperador({ operadores, operadorId, setOperadorId, mensaje }: BloquesProps) {
  return (
    <div className="space-y-3 lg:h-full lg:overflow-auto">
      <div>
        <label className="etiqueta">Operador</label>
        <select className="campo" value={operadorId} onChange={(e) => setOperadorId(e.target.value)}>
          <option value="">Selecciona un operador…</option>
          <option value={TODOS_OPERADORES}>— Todos los operadores —</option>
          {operadores.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nombre_completo}
            </option>
          ))}
        </select>
      </div>
      {mensaje && (
        <p className={`text-sm ${mensaje.startsWith('No se pudo') ? 'text-gauge-danger' : 'text-gauge-ok'}`}>{mensaje}</p>
      )}
    </div>
  );
}

function BloqueAsignacionDefault({
  estaciones,
  operadorId,
  seleccionDefault,
  setSeleccionDefault,
  guardando,
  guardarDefault,
  alternar,
}: BloquesProps) {
  const modoTodos = operadorId === TODOS_OPERADORES;
  const sinOperador = !operadorId || modoTodos;
  return (
    <div className="tarjeta p-4 space-y-3 lg:h-full lg:overflow-auto">
      <div>
        <h2 className="text-base font-semibold">Asignación por defecto</h2>
        <p className="text-xs text-slate-500">EBAR que este operador visita habitualmente, todos los días.</p>
      </div>
      {modoTodos ? (
        <p className="text-xs text-slate-500 italic">No aplica a "Todos los operadores" — elegí un operador puntual para esto.</p>
      ) : (
        sinOperador && (
          <p className="text-xs text-slate-500 italic">Elegí un operador arriba para ver y editar su asignación.</p>
        )
      )}
      <div className="space-y-3">
        {agruparPorZonaYTipo(estaciones).map(({ zona, tipo, estaciones: delGrupo }) => (
          <div key={`${zona}-${tipo}`}>
            <p className="text-xs font-bold text-sky-700 uppercase tracking-wider mb-1.5">
              {ETIQUETA_ZONA[zona] ?? zona} · {ETIQUETA_TIPO[tipo] ?? tipo}
            </p>
            <div className="flex flex-wrap gap-2">
              {delGrupo.map((e) => {
                const activo = seleccionDefault.has(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    disabled={sinOperador}
                    onClick={() => alternar(seleccionDefault, setSeleccionDefault, e.id)}
                    className={`text-sm px-3 py-1.5 rounded-full border transition ${
                      activo ? 'bg-gauge-ok/15 border-gauge-ok text-gauge-ok' : 'border-panel-600 text-slate-600'
                    } ${sinOperador ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {e.codigo}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <button onClick={guardarDefault} disabled={guardando || sinOperador} className="boton-primario w-full">
        {guardando ? 'Guardando…' : 'Guardar asignación por defecto'}
      </button>
    </div>
  );
}

function BloqueAsignacionEspecial({
  operadores,
  estaciones,
  operadorId,
  todasAsignaciones,
  fechaEspecial,
  setFechaEspecial,
  seleccionEspecial,
  setSeleccionEspecial,
  guardando,
  agregarEspecial,
  agregarEspecialParaTodos,
  quitarEspecialParaTodos,
  mensajeEspecial,
  hayFiltro,
  asignacionesEspecialesFiltradas,
  quitarEspecial,
  alternar,
  nombreEstacion,
}: BloquesProps) {
  const modoTodos = operadorId === TODOS_OPERADORES;
  const sinOperador = !operadorId;
  // Modo "Todos": quién (qué operador) tiene qué EBAR asignada ESA fecha puntual — para poder
  // desasignar una por una además del botón "Quitar de todos" (pedido del usuario, 2026-09-09).
  const especialesEnFecha = fechaEspecial
    ? todasAsignaciones
        .filter((a) => a.fecha === fechaEspecial)
        .sort(
          (a, b) =>
            (operadores.find((o) => o.id === a.operador_id)?.nombre_completo ?? '').localeCompare(
              operadores.find((o) => o.id === b.operador_id)?.nombre_completo ?? '',
            ) || a.estacion_id.localeCompare(b.estacion_id),
        )
    : [];
  return (
    <div className="tarjeta p-4 space-y-3 lg:h-full lg:overflow-auto">
      <div>
        <h2 className="text-base font-semibold">Asignación especial por fecha</h2>
        <p className="text-xs text-slate-500">
          {modoTodos
            ? '"Agregar a todos" suma las EBAR marcadas a TODOS los operadores para esa fecha (ej. un refuerzo de feriado). "Quitar todo ese día" borra TODO lo asignado esa fecha, de cualquier operador — no hace falta volver a marcar nada. Ninguno de los dos toca la asignación por defecto.'
            : 'EBAR adicionales que este operador debe visitar solo ese día, sin afectar su asignación por defecto.'}
        </p>
      </div>

      {sinOperador && (
        <p className="text-xs text-slate-500 italic">Elegí un operador arriba (o "Todos los operadores") para poder agregar una asignación especial.</p>
      )}

      <div>
        <label className="etiqueta">Fecha</label>
        <input
          type="date"
          className="campo"
          value={fechaEspecial}
          onChange={(e) => setFechaEspecial(e.target.value)}
          disabled={sinOperador}
        />
      </div>

      <div className="space-y-3">
        {agruparPorZonaYTipo(estaciones).map(({ zona, tipo, estaciones: delGrupo }) => (
          <div key={`${zona}-${tipo}`}>
            <p className="text-xs font-bold text-sky-700 uppercase tracking-wider mb-1.5">
              {ETIQUETA_ZONA[zona] ?? zona} · {ETIQUETA_TIPO[tipo] ?? tipo}
            </p>
            <div className="flex flex-wrap gap-2">
              {delGrupo.map((e) => {
                const activo = seleccionEspecial.has(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    disabled={sinOperador}
                    onClick={() => alternar(seleccionEspecial, setSeleccionEspecial, e.id)}
                    className={`text-sm px-3 py-1.5 rounded-full border transition ${
                      activo ? 'bg-gauge-warn/15 border-gauge-warn text-gauge-warn' : 'border-panel-600 text-slate-600'
                    } ${sinOperador ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {e.codigo}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {modoTodos ? (
        <div className="flex gap-2">
          <button
            onClick={agregarEspecialParaTodos}
            disabled={guardando || !fechaEspecial || seleccionEspecial.size === 0}
            className="boton-primario flex-1"
          >
            {guardando ? 'Guardando…' : 'Agregar a todos'}
          </button>
          <button
            onClick={quitarEspecialParaTodos}
            disabled={guardando || !fechaEspecial}
            className="boton-secundario flex-1 text-gauge-danger border-gauge-danger/40 hover:bg-gauge-danger/10"
          >
            Quitar todo ese día
          </button>
        </div>
      ) : (
        <button
          onClick={agregarEspecial}
          disabled={guardando || sinOperador || !fechaEspecial || seleccionEspecial.size === 0}
          className="boton-primario w-full"
        >
          {guardando ? 'Guardando…' : 'Agregar asignación especial'}
        </button>
      )}

      {mensajeEspecial && (
        <p className={`text-sm ${mensajeEspecial.startsWith('No se pudo') ? 'text-gauge-danger' : 'text-gauge-ok'}`}>
          {mensajeEspecial}
        </p>
      )}

      {modoTodos ? (
        <div className="space-y-1.5 pt-2 border-t border-panel-600/40">
          <p className="text-xs text-slate-500">
            {fechaEspecial ? `Asignado el ${fechaEspecial}:` : 'Elegí una fecha arriba para ver quién tiene qué asignado ese día.'}
          </p>
          {fechaEspecial && (
            especialesEnFecha.length > 0 ? (
              especialesEnFecha.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">
                    {operadores.find((o) => o.id === a.operador_id)?.nombre_completo ?? '?'} · {nombreEstacion(a.estacion_id)}
                  </span>
                  <button onClick={() => quitarEspecial(a.id)} disabled={guardando} className="text-gauge-danger hover:underline text-xs">
                    Quitar
                  </button>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-500 italic">Nadie tiene asignaciones especiales para esa fecha.</p>
            )
          )}
        </div>
      ) : hayFiltro ? (
        <div className="space-y-1.5 pt-2 border-t border-panel-600/40">
          <p className="text-xs text-slate-500">Asignaciones especiales de este operador en ese rango:</p>
          {asignacionesEspecialesFiltradas.length > 0 ? (
            asignacionesEspecialesFiltradas.map((a) => (
              <div key={a.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-700">
                  {a.fecha} · {nombreEstacion(a.estacion_id)}
                </span>
                <button onClick={() => quitarEspecial(a.id)} disabled={guardando} className="text-gauge-danger hover:underline text-xs">
                  Quitar
                </button>
              </div>
            ))
          ) : (
            <p className="text-xs text-slate-500 italic">Sin asignaciones especiales en ese rango.</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-500 pt-2 border-t border-panel-600/40">
          Elegí una fecha arriba, en "Resumen de asignaciones", para ver las que ya están cargadas.
        </p>
      )}
    </div>
  );
}

/** Cómo se ve el período de una excepción ya guardada — igual criterio que la migración: ambas
 * fechas null = indefinida, iguales = un día, distintas = un rango. Si ya venció (fecha_fin en el
 * pasado), lo aclara aparte en vez de dejarla ver como si siguiera vigente. */
function descripcionRangoExcepcion(e: ExcepcionGps): string {
  const hoy = hoyLocal();
  if (!e.fecha_inicio && !e.fecha_fin) return 'Todos los días (indefinida)';
  const vencida = e.fecha_fin !== null && e.fecha_fin < hoy;
  const texto = e.fecha_inicio === e.fecha_fin ? `${e.fecha_inicio}` : `${e.fecha_inicio ?? '—'} al ${e.fecha_fin ?? '—'}`;
  return vencida ? `${texto} (vencida)` : texto;
}

/** Excepción al bloqueo por GPS de VisitForm.tsx (ver migración 0056) — para un operador con
 * problemas conocidos de cobertura en una EBAR puntual (ej. Lapo en EBAR-9 con la señal de Claro
 * floja). La otorga supervisor/administrador, nunca el propio operador. */
function BloqueExcepcionGps({
  operadores,
  estaciones,
  operadorId,
  todasExcepciones,
  excepcionesGps,
  seleccionExcepcion,
  setSeleccionExcepcion,
  modoExcepcion,
  setModoExcepcion,
  excepcionDesde,
  setExcepcionDesde,
  excepcionHasta,
  setExcepcionHasta,
  guardandoExcepcion,
  mensajeExcepcion,
  agregarExcepcion,
  agregarExcepcionParaTodos,
  quitarExcepcionParaTodos,
  quitarExcepcion,
  alternar,
  nombreEstacion,
}: BloquesProps) {
  const modoTodos = operadorId === TODOS_OPERADORES;
  const sinOperador = !operadorId;
  const periodoElegido =
    (modoExcepcion === 'indefinido' || !!excepcionDesde) && (modoExcepcion !== 'rango' || !!excepcionHasta);
  const listaParaGuardar = seleccionExcepcion.size > 0 && periodoElegido;
  // Modo "Todos": quién (qué operador) tiene qué excepción para ESE período exacto — para poder
  // desasignar una por una además del botón "Quitar de todos" (pedido del usuario, 2026-09-09).
  const fechaInicioElegida = modoExcepcion === 'indefinido' ? null : excepcionDesde;
  const fechaFinElegida = modoExcepcion === 'indefinido' ? null : modoExcepcion === 'un_dia' ? excepcionDesde : excepcionHasta;
  const excepcionesEnPeriodo = periodoElegido
    ? todasExcepciones
        .filter((e) => e.fecha_inicio === fechaInicioElegida && e.fecha_fin === fechaFinElegida)
        .sort(
          (a, b) =>
            (operadores.find((o) => o.id === a.operador_id)?.nombre_completo ?? '').localeCompare(
              operadores.find((o) => o.id === b.operador_id)?.nombre_completo ?? '',
            ) || a.estacion_id.localeCompare(b.estacion_id),
        )
    : [];
  return (
    <div className="tarjeta p-4 space-y-3 lg:h-full lg:overflow-auto">
      <div>
        <h2 className="text-base font-semibold">Excepción de GPS</h2>
        <p className="text-xs text-slate-500">
          {modoTodos
            ? '"Otorgar a todos" da la excepción de las EBAR marcadas, para ese período, a TODOS los operadores. "Quitar todas ese período" revoca TODAS las excepciones con ese período exacto, de cualquier operador — no hace falta volver a marcar nada.'
            : 'Para cuando el GPS no logra confirmar la ubicación de este operador en una EBAR puntual (ej. sin señal de datos dentro de la cámara) y de verdad está ahí — deja registrar la visita sin el chequeo de ubicación, solo para la(s) EBAR y el período que elijas.'}
        </p>
      </div>

      {sinOperador && (
        <p className="text-xs text-slate-500 italic">Elegí un operador arriba (o "Todos los operadores") para poder agregar una excepción.</p>
      )}

      <div>
        <label className="etiqueta">Duración</label>
        <div className="flex gap-2 flex-wrap">
          {(
            [
              ['un_dia', 'Un día puntual'],
              ['rango', 'Un rango de fechas'],
              ['indefinido', 'Todos los días'],
            ] as const
          ).map(([valor, etiqueta]) => (
            <button
              key={valor}
              type="button"
              disabled={sinOperador}
              onClick={() => setModoExcepcion(valor)}
              className={`text-sm px-3 py-1.5 rounded-full border transition ${
                modoExcepcion === valor ? 'bg-gauge-ok/15 border-gauge-ok text-gauge-ok' : 'border-panel-600 text-slate-600'
              } ${sinOperador ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {etiqueta}
            </button>
          ))}
        </div>
      </div>

      {modoExcepcion !== 'indefinido' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiqueta">{modoExcepcion === 'un_dia' ? 'Fecha' : 'Desde'}</label>
            <input
              type="date"
              className="campo"
              value={excepcionDesde}
              onChange={(e) => setExcepcionDesde(e.target.value)}
              disabled={sinOperador}
            />
          </div>
          {modoExcepcion === 'rango' && (
            <div>
              <label className="etiqueta">Hasta</label>
              <input
                type="date"
                className="campo"
                value={excepcionHasta}
                min={excepcionDesde || undefined}
                onChange={(e) => setExcepcionHasta(e.target.value)}
                disabled={sinOperador}
              />
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {agruparPorZonaYTipo(estaciones).map(({ zona, tipo, estaciones: delGrupo }) => (
          <div key={`${zona}-${tipo}`}>
            <p className="text-xs font-bold text-sky-700 uppercase tracking-wider mb-1.5">
              {ETIQUETA_ZONA[zona] ?? zona} · {ETIQUETA_TIPO[tipo] ?? tipo}
            </p>
            <div className="flex flex-wrap gap-2">
              {delGrupo.map((e) => {
                const activo = seleccionExcepcion.has(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    disabled={sinOperador}
                    onClick={() => alternar(seleccionExcepcion, setSeleccionExcepcion, e.id)}
                    className={`text-sm px-3 py-1.5 rounded-full border transition ${
                      activo ? 'bg-gauge-warn/15 border-gauge-warn text-gauge-warn' : 'border-panel-600 text-slate-600'
                    } ${sinOperador ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {e.codigo}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {modoTodos ? (
        <div className="flex gap-2">
          <button onClick={agregarExcepcionParaTodos} disabled={guardandoExcepcion || !listaParaGuardar} className="boton-primario flex-1">
            {guardandoExcepcion ? 'Guardando…' : 'Otorgar a todos'}
          </button>
          <button
            onClick={quitarExcepcionParaTodos}
            disabled={guardandoExcepcion || !periodoElegido}
            className="boton-secundario flex-1 text-gauge-danger border-gauge-danger/40 hover:bg-gauge-danger/10"
          >
            Quitar todas ese período
          </button>
        </div>
      ) : (
        <button onClick={agregarExcepcion} disabled={guardandoExcepcion || sinOperador || !listaParaGuardar} className="boton-primario w-full">
          {guardandoExcepcion ? 'Guardando…' : 'Agregar excepción'}
        </button>
      )}
      {mensajeExcepcion && (
        <p className={`text-sm ${mensajeExcepcion.startsWith('No se pudo') ? 'text-gauge-danger' : 'text-gauge-ok'}`}>
          {mensajeExcepcion}
        </p>
      )}

      {modoTodos ? (
      <div className="space-y-1.5 pt-2 border-t border-panel-600/40">
        <p className="text-xs text-slate-500">
          {periodoElegido ? 'Con ese período, ya tienen la excepción:' : 'Elegí el período arriba para ver quién ya tiene esa excepción.'}
        </p>
        {periodoElegido && (
          excepcionesEnPeriodo.length > 0 ? (
            excepcionesEnPeriodo.map((ex) => (
              <div key={ex.id} className="flex items-center justify-between text-sm gap-2">
                <span className="text-slate-700 truncate">
                  {operadores.find((o) => o.id === ex.operador_id)?.nombre_completo ?? '?'} · {nombreEstacion(ex.estacion_id)}
                </span>
                <button
                  onClick={() => quitarExcepcion(ex.id)}
                  disabled={guardandoExcepcion}
                  className="text-gauge-danger hover:underline text-xs shrink-0"
                >
                  Quitar
                </button>
              </div>
            ))
          ) : (
            <p className="text-xs text-slate-500 italic">Nadie tiene esa excepción todavía.</p>
          )
        )}
      </div>
      ) : (
      <div className="space-y-1.5 pt-2 border-t border-panel-600/40">
        <p className="text-xs text-slate-500">Excepciones de este operador:</p>
        {sinOperador ? null : excepcionesGps.length > 0 ? (
          excepcionesGps.map((ex) => (
            <div key={ex.id} className="flex items-center justify-between text-sm gap-2">
              <span className="text-slate-700 truncate">
                {nombreEstacion(ex.estacion_id)} · {descripcionRangoExcepcion(ex)}
              </span>
              <button
                onClick={() => quitarExcepcion(ex.id)}
                disabled={guardandoExcepcion}
                className="text-gauge-danger hover:underline text-xs shrink-0"
              >
                Quitar
              </button>
            </div>
          ))
        ) : (
          <p className="text-xs text-slate-500 italic">Sin excepciones de GPS para este operador.</p>
        )}
      </div>
      )}
    </div>
  );
}
