import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { FilaPlanillaHorasExtras, PlanillaHorasExtras, Usuario } from '../lib/types';
import { calcularHorasFila, formatHoras, sumarHorasExtra } from '../lib/horasExtras';
import { descargarBlob, generarReportePlanillaHorasExtras, type FilaPlanillaReporte } from '../lib/pdf';

const DIRECCION_DEFAULT = 'DIRECCIÓN DE AGUA POTABLE Y ALCANTARILLADO GADMFO';
const REVISADO_NOMBRE_DEFAULT = 'Ing. Adriana Alejandra Bazurto Bermejo';
const REVISADO_CARGO_DEFAULT = 'ANALISTA DE REDES DE ALCANTARILLADO Y ESTACIONES DE BOMBEO DE AGUAS RESIDUALES';
const APROBADO_NOMBRE_DEFAULT = 'Ing. Freddy W. Vásconez A.';
const APROBADO_CARGO_DEFAULT = 'JEFE DE SERVICIOS DE ALCANTARILLADO';

const MANUAL = 'manual';

function timestampArchivo(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function formatFechaCorta(fechaIso: string): string {
  const d = new Date(`${fechaIso}T12:00:00`);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

interface FilaEdit {
  id: string;
  esNueva: boolean;
  fecha: string;
  descripcion_actividades: string;
  numero_memorando: string;
  entrada_manana: string;
  salida_manana: string;
  entrada_tarde: string;
  salida_tarde: string;
  horas_manana: number;
  horas_tarde: number;
  horas_extra: number;
}

function filaDesdeDb(f: FilaPlanillaHorasExtras): FilaEdit {
  return {
    id: f.id,
    esNueva: false,
    fecha: f.fecha,
    descripcion_actividades: f.descripcion_actividades ?? '',
    numero_memorando: f.numero_memorando ?? '',
    entrada_manana: f.entrada_manana ?? '',
    salida_manana: f.salida_manana ?? '',
    entrada_tarde: f.entrada_tarde ?? '',
    salida_tarde: f.salida_tarde ?? '',
    horas_manana: f.horas_manana ?? 0,
    horas_tarde: f.horas_tarde ?? 0,
    horas_extra: f.horas_extra ?? 0,
  };
}

interface Props {
  operadores: Usuario[];
  usuarioId: string;
}

export function PanelPlanillaHorasExtras({ operadores, usuarioId }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [planillas, setPlanillas] = useState<PlanillaHorasExtras[]>([]);
  const [editando, setEditando] = useState<PlanillaHorasExtras | 'nueva' | null>(null);

  async function cargarPlanillas() {
    setCargando(true);
    const { data } = await supabase
      .from('planillas_horas_extras')
      .select('*')
      .order('fecha_desde', { ascending: false })
      .limit(50);
    setPlanillas((data as PlanillaHorasExtras[]) ?? []);
    setCargando(false);
  }

  useEffect(() => {
    if (abierto) cargarPlanillas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  async function eliminar(id: string) {
    if (!window.confirm('¿Eliminar esta planilla? No se puede deshacer.')) return;
    const { error } = await supabase.from('planillas_horas_extras').delete().eq('id', id);
    if (!error) setPlanillas((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="tarjeta p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Planilla de horas extras</h2>
        <button onClick={() => setAbierto(true)} className="boton-secundario text-xs px-3 py-1.5">
          Abrir
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Llena la información que pide Talento Humano (memorando, horario, horas) para generar el PDF de la planilla
        de horas extras en horizontal.
      </p>

      {abierto && (
        <>
          <div className="fixed inset-0 bg-black/50 z-20" onClick={() => setAbierto(false)} />
          <div className="fixed inset-2 sm:inset-6 z-30 bg-panel-800 border border-panel-600/60 rounded-xl shadow-xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-panel-600/40">
              <h2 className="font-semibold text-sm">
                {editando && editando !== 'nueva' ? 'Editar planilla' : editando === 'nueva' ? 'Nueva planilla' : 'Planillas de horas extras'}
              </h2>
              <button
                onClick={() => (editando ? setEditando(null) : setAbierto(false))}
                className="text-slate-400 hover:text-slate-100 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {editando ? (
                <EditorPlanilla
                  planilla={editando === 'nueva' ? null : editando}
                  operadores={operadores}
                  usuarioId={usuarioId}
                  onCerrar={() => setEditando(null)}
                  onGuardado={async () => {
                    setEditando(null);
                    await cargarPlanillas();
                  }}
                />
              ) : (
                <div className="space-y-3">
                  <button onClick={() => setEditando('nueva')} className="boton-primario w-full">
                    + Nueva planilla
                  </button>
                  {cargando ? (
                    <p className="text-sm text-slate-400">Cargando…</p>
                  ) : planillas.length === 0 ? (
                    <p className="text-sm text-slate-400">Todavía no hay planillas guardadas.</p>
                  ) : (
                    <div className="space-y-2">
                      {planillas.map((p) => (
                        <div key={p.id} className="border border-panel-600/40 rounded-lg p-3 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-100 truncate">{p.nombre_trabajador}</p>
                            <p className="text-xs text-slate-400">
                              {formatFechaCorta(p.fecha_desde)} al {formatFechaCorta(p.fecha_hasta)} · {p.area || 'Sin área'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button onClick={() => setEditando(p)} className="text-xs text-gauge-ok hover:underline">
                              Abrir
                            </button>
                            <button onClick={() => eliminar(p.id)} className="text-xs text-gauge-danger hover:underline">
                              Eliminar
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function EditorPlanilla({
  planilla,
  operadores,
  usuarioId,
  onCerrar,
  onGuardado,
}: {
  planilla: PlanillaHorasExtras | null;
  operadores: Usuario[];
  usuarioId: string;
  onCerrar: () => void;
  onGuardado: () => Promise<void>;
}) {
  const [operadorId, setOperadorId] = useState<string>(planilla?.operador_id ?? '');
  const [nombreManual, setNombreManual] = useState(planilla && !planilla.operador_id ? planilla.nombre_trabajador : '');
  const [cargoTrabajador, setCargoTrabajador] = useState(planilla?.cargo_trabajador ?? '');
  const [direccion, setDireccion] = useState(planilla?.direccion ?? DIRECCION_DEFAULT);
  const [area, setArea] = useState(planilla?.area ?? '');
  const [fechaPresentacion, setFechaPresentacion] = useState(planilla?.fecha_presentacion ?? '');
  const [fechaDesde, setFechaDesde] = useState(planilla?.fecha_desde ?? '');
  const [fechaHasta, setFechaHasta] = useState(planilla?.fecha_hasta ?? '');

  const [jornadaInicioManana, setJornadaInicioManana] = useState(planilla?.jornada_inicio_manana ?? '08:00');
  const [jornadaFinManana, setJornadaFinManana] = useState(planilla?.jornada_fin_manana ?? '12:00');
  const [jornadaInicioTarde, setJornadaInicioTarde] = useState(planilla?.jornada_inicio_tarde ?? '13:00');
  const [jornadaFinTarde, setJornadaFinTarde] = useState(planilla?.jornada_fin_tarde ?? '17:00');

  const [editarRevisado, setEditarRevisado] = useState(
    !!planilla && (planilla.revisado_nombre !== REVISADO_NOMBRE_DEFAULT || planilla.revisado_cargo !== REVISADO_CARGO_DEFAULT),
  );
  const [revisadoNombre, setRevisadoNombre] = useState(planilla?.revisado_nombre ?? REVISADO_NOMBRE_DEFAULT);
  const [revisadoCargo, setRevisadoCargo] = useState(planilla?.revisado_cargo ?? REVISADO_CARGO_DEFAULT);
  const [editarAprobado, setEditarAprobado] = useState(
    !!planilla && (planilla.aprobado_nombre !== APROBADO_NOMBRE_DEFAULT || planilla.aprobado_cargo !== APROBADO_CARGO_DEFAULT),
  );
  const [aprobadoNombre, setAprobadoNombre] = useState(planilla?.aprobado_nombre ?? APROBADO_NOMBRE_DEFAULT);
  const [aprobadoCargo, setAprobadoCargo] = useState(planilla?.aprobado_cargo ?? APROBADO_CARGO_DEFAULT);

  const [descripcionDefault, setDescripcionDefault] = useState('');
  const [memorandoDefault, setMemorandoDefault] = useState('');

  const [filas, setFilas] = useState<FilaEdit[]>([]);
  const [cargandoFilas, setCargandoFilas] = useState(!!planilla);
  const [guardando, setGuardando] = useState(false);
  const [generandoPdf, setGenerandoPdf] = useState(false);
  const [trayendoDias, setTrayendoDias] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const jornada = useMemo(
    () => ({
      jornada_inicio_manana: jornadaInicioManana,
      jornada_fin_manana: jornadaFinManana,
      jornada_inicio_tarde: jornadaInicioTarde,
      jornada_fin_tarde: jornadaFinTarde,
    }),
    [jornadaInicioManana, jornadaFinManana, jornadaInicioTarde, jornadaFinTarde],
  );

  useEffect(() => {
    if (!planilla) {
      setCargandoFilas(false);
      return;
    }
    async function cargarFilas() {
      const { data } = await supabase
        .from('planilla_horas_extras_filas')
        .select('*')
        .eq('planilla_id', planilla!.id)
        .order('fecha');
      setFilas(((data as FilaPlanillaHorasExtras[]) ?? []).map(filaDesdeDb));
      setCargandoFilas(false);
    }
    cargarFilas();
  }, [planilla]);

  // Al elegir un operador registrado en una planilla nueva, prellena cargo/área/dirección/jornada
  // con los de la última planilla que se le haya generado (si existe) para no volver a escribirlos.
  useEffect(() => {
    if (planilla || !operadorId || operadorId === MANUAL) return;
    async function prellenar() {
      const { data } = await supabase
        .from('planillas_horas_extras')
        .select('*')
        .eq('operador_id', operadorId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return;
      const anterior = data as PlanillaHorasExtras;
      setCargoTrabajador((v) => v || anterior.cargo_trabajador);
      setArea((v) => v || anterior.area);
      setDireccion((v) => (v === DIRECCION_DEFAULT ? anterior.direccion : v));
      setJornadaInicioManana(anterior.jornada_inicio_manana);
      setJornadaFinManana(anterior.jornada_fin_manana);
      setJornadaInicioTarde(anterior.jornada_inicio_tarde);
      setJornadaFinTarde(anterior.jornada_fin_tarde);
    }
    prellenar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operadorId]);

  const nombreTrabajador =
    operadorId && operadorId !== MANUAL
      ? operadores.find((o) => o.id === operadorId)?.nombre_completo ?? ''
      : nombreManual;

  function nuevaFila(fecha: string): FilaEdit {
    const horario = {
      entrada_manana: jornadaInicioManana,
      salida_manana: jornadaFinManana,
      entrada_tarde: jornadaInicioTarde,
      salida_tarde: jornadaFinTarde,
    };
    const horas = calcularHorasFila(horario, jornada);
    return {
      id: `tmp-${fecha}-${Math.random().toString(36).slice(2)}`,
      esNueva: true,
      fecha,
      descripcion_actividades: descripcionDefault,
      numero_memorando: memorandoDefault,
      ...horario,
      ...horas,
    };
  }

  function agregarFilaManual() {
    setFilas((prev) => [...prev, nuevaFila(fechaDesde || new Date().toISOString().slice(0, 10))]);
  }

  async function traerDiasDeCalendario() {
    if (!operadorId || operadorId === MANUAL) {
      setMensaje('Elige un operador registrado para poder traer sus días de turno.');
      return;
    }
    if (!fechaDesde || !fechaHasta) {
      setMensaje('Escribe el período (Desde/Hasta) antes de traer los días.');
      return;
    }
    setTrayendoDias(true);
    setMensaje(null);
    try {
      const { data, error } = await supabase
        .from('turnos_calendario')
        .select('fecha')
        .eq('operador_id', operadorId)
        .gte('fecha', fechaDesde)
        .lte('fecha', fechaHasta)
        .order('fecha');
      if (error) throw error;
      const fechasExistentes = new Set(filas.map((f) => f.fecha));
      const nuevas = ((data as { fecha: string }[]) ?? [])
        .filter((t) => !fechasExistentes.has(t.fecha))
        .map((t) => nuevaFila(t.fecha));
      if (nuevas.length === 0) {
        setMensaje('No hay días de turno nuevos en ese período (o ya estaban agregados).');
      } else {
        setFilas((prev) => [...prev, ...nuevas].sort((a, b) => a.fecha.localeCompare(b.fecha)));
      }
    } catch (err: any) {
      setMensaje(`No se pudo traer los días: ${err.message ?? err}`);
    } finally {
      setTrayendoDias(false);
    }
  }

  function actualizarFila(id: string, cambios: Partial<FilaEdit>) {
    setFilas((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        const actualizada = { ...f, ...cambios };
        const horarioCambio =
          'entrada_manana' in cambios || 'salida_manana' in cambios || 'entrada_tarde' in cambios || 'salida_tarde' in cambios;
        if (horarioCambio) {
          const horas = calcularHorasFila(actualizada, jornada);
          return { ...actualizada, ...horas };
        }
        return actualizada;
      }),
    );
  }

  function quitarFila(id: string) {
    setFilas((prev) => prev.filter((f) => f.id !== id));
  }

  const totalHorasExtra = useMemo(() => sumarHorasExtra(filas), [filas]);

  async function guardar() {
    if (!nombreTrabajador.trim()) {
      setMensaje('Elige un operador o escribe el nombre del trabajador.');
      return;
    }
    if (!cargoTrabajador.trim() || !area.trim()) {
      setMensaje('Completa Ocupación y Área.');
      return;
    }
    if (!fechaDesde || !fechaHasta) {
      setMensaje('Completa el período (Desde/Hasta).');
      return;
    }
    setGuardando(true);
    setMensaje(null);
    try {
      const payloadPlanilla = {
        operador_id: operadorId && operadorId !== MANUAL ? operadorId : null,
        nombre_trabajador: nombreTrabajador.trim(),
        cargo_trabajador: cargoTrabajador.trim(),
        direccion: direccion.trim(),
        area: area.trim(),
        fecha_presentacion: fechaPresentacion || null,
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
        jornada_inicio_manana: jornadaInicioManana,
        jornada_fin_manana: jornadaFinManana,
        jornada_inicio_tarde: jornadaInicioTarde,
        jornada_fin_tarde: jornadaFinTarde,
        revisado_nombre: editarRevisado ? revisadoNombre.trim() : REVISADO_NOMBRE_DEFAULT,
        revisado_cargo: editarRevisado ? revisadoCargo.trim() : REVISADO_CARGO_DEFAULT,
        aprobado_nombre: editarAprobado ? aprobadoNombre.trim() : APROBADO_NOMBRE_DEFAULT,
        aprobado_cargo: editarAprobado ? aprobadoCargo.trim() : APROBADO_CARGO_DEFAULT,
      };

      let planillaId = planilla?.id;
      if (planillaId) {
        const { error } = await supabase.from('planillas_horas_extras').update(payloadPlanilla).eq('id', planillaId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('planillas_horas_extras')
          .insert({ ...payloadPlanilla, creado_por: usuarioId })
          .select('id')
          .single();
        if (error) throw error;
        planillaId = data!.id;
      }

      const nuevas = filas.filter((f) => f.esNueva);
      const existentes = filas.filter((f) => !f.esNueva);

      if (nuevas.length > 0) {
        const { error } = await supabase.from('planilla_horas_extras_filas').insert(
          nuevas.map((f) => ({
            planilla_id: planillaId,
            fecha: f.fecha,
            descripcion_actividades: f.descripcion_actividades || null,
            numero_memorando: f.numero_memorando || null,
            entrada_manana: f.entrada_manana || null,
            salida_manana: f.salida_manana || null,
            entrada_tarde: f.entrada_tarde || null,
            salida_tarde: f.salida_tarde || null,
            horas_manana: f.horas_manana,
            horas_tarde: f.horas_tarde,
            horas_extra: f.horas_extra,
          })),
        );
        if (error) throw error;
      }

      for (const f of existentes) {
        const { error } = await supabase
          .from('planilla_horas_extras_filas')
          .update({
            fecha: f.fecha,
            descripcion_actividades: f.descripcion_actividades || null,
            numero_memorando: f.numero_memorando || null,
            entrada_manana: f.entrada_manana || null,
            salida_manana: f.salida_manana || null,
            entrada_tarde: f.entrada_tarde || null,
            salida_tarde: f.salida_tarde || null,
            horas_manana: f.horas_manana,
            horas_tarde: f.horas_tarde,
            horas_extra: f.horas_extra,
          })
          .eq('id', f.id);
        if (error) throw error;
      }

      if (planilla) {
        const idsActuales = new Set(filas.map((f) => f.id));
        const { data: filasDb } = await supabase.from('planilla_horas_extras_filas').select('id').eq('planilla_id', planillaId);
        const idsQuitar = ((filasDb as { id: string }[]) ?? []).map((f) => f.id).filter((id) => !idsActuales.has(id));
        if (idsQuitar.length > 0) {
          await supabase.from('planilla_horas_extras_filas').delete().in('id', idsQuitar);
        }
      }

      await onGuardado();
    } catch (err: any) {
      setMensaje(`No se pudo guardar: ${err.message ?? err}`);
    } finally {
      setGuardando(false);
    }
  }

  async function generarPdf() {
    if (!nombreTrabajador.trim()) {
      setMensaje('Elige un operador o escribe el nombre del trabajador antes de generar el PDF.');
      return;
    }
    setGenerandoPdf(true);
    setMensaje(null);
    try {
      const filasReporte: FilaPlanillaReporte[] = filas.map((f) => ({
        fecha: f.fecha,
        descripcion: f.descripcion_actividades,
        memorando: f.numero_memorando,
        entradaManana: f.entrada_manana,
        salidaManana: f.salida_manana,
        entradaTarde: f.entrada_tarde,
        salidaTarde: f.salida_tarde,
        horasManana: formatHoras(f.horas_manana),
        horasTarde: formatHoras(f.horas_tarde),
        horasExtra: formatHoras(f.horas_extra),
      }));
      const blob = await generarReportePlanillaHorasExtras(
        {
          direccion: direccion.trim() || DIRECCION_DEFAULT,
          area: area.trim(),
          nombreTrabajador: nombreTrabajador.trim(),
          cargoTrabajador: cargoTrabajador.trim(),
          fechaPresentacion: fechaPresentacion || null,
          fechaDesde,
          fechaHasta,
          revisadoNombre: editarRevisado ? revisadoNombre.trim() : REVISADO_NOMBRE_DEFAULT,
          revisadoCargo: editarRevisado ? revisadoCargo.trim() : REVISADO_CARGO_DEFAULT,
          aprobadoNombre: editarAprobado ? aprobadoNombre.trim() : APROBADO_NOMBRE_DEFAULT,
          aprobadoCargo: editarAprobado ? aprobadoCargo.trim() : APROBADO_CARGO_DEFAULT,
        },
        filasReporte,
        formatHoras(totalHorasExtra),
      );
      const slug = nombreTrabajador.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      descargarBlob(blob, `planilla_horas_extras_${slug}_${timestampArchivo()}.pdf`);
    } catch (err: any) {
      setMensaje(`No se pudo generar el PDF: ${err.message ?? err}`);
    } finally {
      setGenerandoPdf(false);
    }
  }

  if (cargandoFilas) return <p className="text-sm text-slate-400">Cargando…</p>;

  return (
    <div className="space-y-4">
      <div>
        <label className="etiqueta">Trabajador</label>
        <select className="campo" value={operadorId} onChange={(e) => setOperadorId(e.target.value)}>
          <option value="">Selecciona un operador…</option>
          {operadores.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nombre_completo}
            </option>
          ))}
          <option value={MANUAL}>➕ Otro (no registrado en la app)</option>
        </select>
      </div>

      {operadorId === MANUAL && (
        <div>
          <label className="etiqueta">Nombre completo</label>
          <input type="text" className="campo" value={nombreManual} onChange={(e) => setNombreManual(e.target.value)} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="etiqueta">Ocupación</label>
          <input type="text" className="campo" value={cargoTrabajador} onChange={(e) => setCargoTrabajador(e.target.value)} />
        </div>
        <div>
          <label className="etiqueta">Área</label>
          <input type="text" className="campo" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Ej: Estaciones de bombeo" />
        </div>
      </div>

      <div>
        <label className="etiqueta">Dirección</label>
        <input type="text" className="campo" value={direccion} onChange={(e) => setDireccion(e.target.value)} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="etiqueta">Fecha de presentación</label>
          <input type="date" className="campo" value={fechaPresentacion} onChange={(e) => setFechaPresentacion(e.target.value)} />
        </div>
        <div>
          <label className="etiqueta">Período — Desde</label>
          <input type="date" className="campo" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
        </div>
        <div>
          <label className="etiqueta">Período — Hasta</label>
          <input type="date" className="campo" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} />
        </div>
      </div>

      <div className="border border-panel-600/40 rounded-lg p-3 space-y-2">
        <p className="text-xs font-semibold text-slate-300">Jornada normal (sin horas extra)</p>
        <p className="text-[11px] text-slate-500">
          Se usa para prellenar cada día nuevo. Si un día no tiene marcación al medio día, escribe solo la entrada de
          la mañana y la salida de la tarde en esa fila — las horas se calculan directo entre esas dos.
        </p>
        <div className="grid grid-cols-4 gap-2">
          <div>
            <label className="etiqueta">Entrada</label>
            <input type="time" className="campo" value={jornadaInicioManana} onChange={(e) => setJornadaInicioManana(e.target.value)} />
          </div>
          <div>
            <label className="etiqueta">Sale</label>
            <input type="time" className="campo" value={jornadaFinManana} onChange={(e) => setJornadaFinManana(e.target.value)} />
          </div>
          <div>
            <label className="etiqueta">Entrada</label>
            <input type="time" className="campo" value={jornadaInicioTarde} onChange={(e) => setJornadaInicioTarde(e.target.value)} />
          </div>
          <div>
            <label className="etiqueta">Sale</label>
            <input type="time" className="campo" value={jornadaFinTarde} onChange={(e) => setJornadaFinTarde(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="etiqueta">Descripción de actividades (por defecto)</label>
          <input
            type="text"
            className="campo"
            value={descripcionDefault}
            onChange={(e) => setDescripcionDefault(e.target.value)}
            placeholder='Ej: "Referirse al INFORME N.° ..."'
          />
        </div>
        <div>
          <label className="etiqueta">N.º de memorando (por defecto)</label>
          <input
            type="text"
            className="campo"
            value={memorandoDefault}
            onChange={(e) => setMemorandoDefault(e.target.value)}
            placeholder="Ej: MEMORANDO No. GADMFO-DAPA-2026-..."
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={traerDiasDeCalendario} disabled={trayendoDias} className="boton-secundario flex-1 text-sm">
          {trayendoDias ? 'Trayendo…' : '📅 Traer días del calendario de turnos'}
        </button>
        <button type="button" onClick={agregarFilaManual} className="boton-secundario text-sm px-3">
          + Día
        </button>
      </div>

      {filas.length > 0 && (
        <div className="overflow-x-auto border border-panel-600/40 rounded-lg">
          <table className="w-full text-xs min-w-[820px]">
            <thead>
              <tr className="text-slate-400 text-left">
                <th className="p-1.5">Fecha</th>
                <th className="p-1.5 min-w-[160px]">Descripción</th>
                <th className="p-1.5 min-w-[120px]">N.º memorando</th>
                <th className="p-1.5">Entrada</th>
                <th className="p-1.5">Sale</th>
                <th className="p-1.5">Entrada</th>
                <th className="p-1.5">Sale</th>
                <th className="p-1.5">Mañana</th>
                <th className="p-1.5">Tarde</th>
                <th className="p-1.5">Extras</th>
                <th className="p-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-t border-panel-600/30">
                  <td className="p-1">
                    <input
                      type="date"
                      className="campo text-xs py-1"
                      value={f.fecha}
                      onChange={(e) => actualizarFila(f.id, { fecha: e.target.value })}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="text"
                      className="campo text-xs py-1"
                      value={f.descripcion_actividades}
                      onChange={(e) => actualizarFila(f.id, { descripcion_actividades: e.target.value })}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="text"
                      className="campo text-xs py-1"
                      value={f.numero_memorando}
                      onChange={(e) => actualizarFila(f.id, { numero_memorando: e.target.value })}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="time"
                      className="campo text-xs py-1"
                      value={f.entrada_manana}
                      onChange={(e) => actualizarFila(f.id, { entrada_manana: e.target.value })}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="time"
                      className="campo text-xs py-1"
                      value={f.salida_manana}
                      onChange={(e) => actualizarFila(f.id, { salida_manana: e.target.value })}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="time"
                      className="campo text-xs py-1"
                      value={f.entrada_tarde}
                      onChange={(e) => actualizarFila(f.id, { entrada_tarde: e.target.value })}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="time"
                      className="campo text-xs py-1"
                      value={f.salida_tarde}
                      onChange={(e) => actualizarFila(f.id, { salida_tarde: e.target.value })}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      className="campo text-xs py-1 w-16"
                      value={f.horas_manana}
                      onChange={(e) => actualizarFila(f.id, { horas_manana: Number(e.target.value) })}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      className="campo text-xs py-1 w-16"
                      value={f.horas_tarde}
                      onChange={(e) => actualizarFila(f.id, { horas_tarde: Number(e.target.value) })}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      className="campo text-xs py-1 w-16 font-semibold"
                      value={f.horas_extra}
                      onChange={(e) => actualizarFila(f.id, { horas_extra: Number(e.target.value) })}
                    />
                  </td>
                  <td className="p-1">
                    <button onClick={() => quitarFila(f.id)} className="text-gauge-danger text-xs px-1">
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-sm text-slate-200 text-right font-semibold">Total horas extras: {formatHoras(totalHorasExtra)}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="border border-panel-600/40 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-300">Revisado por</p>
            <button type="button" onClick={() => setEditarRevisado((v) => !v)} className="text-xs text-gauge-ok hover:underline">
              {editarRevisado ? 'Usar el de siempre' : 'Cambiar'}
            </button>
          </div>
          {editarRevisado ? (
            <>
              <input type="text" className="campo text-xs" placeholder="Nombre" value={revisadoNombre} onChange={(e) => setRevisadoNombre(e.target.value)} />
              <input type="text" className="campo text-xs" placeholder="Cargo" value={revisadoCargo} onChange={(e) => setRevisadoCargo(e.target.value)} />
            </>
          ) : (
            <p className="text-xs text-slate-400">
              {REVISADO_NOMBRE_DEFAULT}
              <br />
              {REVISADO_CARGO_DEFAULT}
            </p>
          )}
        </div>
        <div className="border border-panel-600/40 rounded-lg p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-300">Aprobado por</p>
            <button type="button" onClick={() => setEditarAprobado((v) => !v)} className="text-xs text-gauge-ok hover:underline">
              {editarAprobado ? 'Usar el de siempre' : 'Cambiar'}
            </button>
          </div>
          {editarAprobado ? (
            <>
              <input type="text" className="campo text-xs" placeholder="Nombre" value={aprobadoNombre} onChange={(e) => setAprobadoNombre(e.target.value)} />
              <input type="text" className="campo text-xs" placeholder="Cargo" value={aprobadoCargo} onChange={(e) => setAprobadoCargo(e.target.value)} />
            </>
          ) : (
            <p className="text-xs text-slate-400">
              {APROBADO_NOMBRE_DEFAULT}
              <br />
              {APROBADO_CARGO_DEFAULT}
            </p>
          )}
        </div>
      </div>

      {mensaje && <p className="text-xs text-gauge-danger">{mensaje}</p>}

      <div className="flex gap-2 pt-2 sticky bottom-0 bg-panel-800 pb-1">
        <button onClick={guardar} disabled={guardando} className="boton-primario flex-1">
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        <button onClick={generarPdf} disabled={generandoPdf} className="boton-secundario flex-1">
          {generandoPdf ? 'Generando…' : '📄 Generar PDF'}
        </button>
        <button onClick={onCerrar} className="boton-secundario px-4">
          Cerrar
        </button>
      </div>
    </div>
  );
}
