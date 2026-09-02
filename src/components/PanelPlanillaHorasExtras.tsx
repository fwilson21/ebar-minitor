import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type FocusEvent,
  type KeyboardEvent,
  type SetStateAction,
} from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { ConfiguracionPlanillaHorasExtras, FilaPlanillaHorasExtras, JornadaOperadorDefault, PlanillaHorasExtras, Usuario } from '../lib/types';
import { hoyLocal } from '../lib/fecha';
import {
  avisoAlmuerzoLargo,
  calcularHorasFila,
  formatHoras,
  parseHorasHHMM,
  sumarHorasExtra,
  validarOrdenHorario,
  type JornadaReferencia,
} from '../lib/horasExtras';
import { abrirBlob, descargarBlob, generarReportePlanillaHorasExtras, type FilaPlanillaReporte } from '../lib/pdf';
import { GridEditable } from './GridEditable';
import { BarraDistribucion } from './BarraDistribucion';
import { PANTALLAS_EDITABLES } from '../lib/pantallasEditables';
import { useEditorDistribucion } from '../hooks/useEditorDistribucion';

const DIRECCION_DEFAULT = 'DIRECCIÓN DE AGUA POTABLE Y ALCANTARILLADO GADMFO';
const AREA_DEFAULT = 'Jefatura de servicios de alcantarillado';

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

/** "YYYY-MM" del mes en curso — año/mes con el que arranca el filtro de la lista de planillas. */
function mesActual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

let temporizadorAvanceHora: ReturnType<typeof setTimeout> | null = null;

/** Cancela cualquier salto de cursor pendiente. Se llama en cada tecla, aunque no se vaya a
 * reprogramar uno nuevo — si no, un salto agendado por una hora anterior podía disparar mientras el
 * operador ya estaba corrigiendo otro campo, sintiéndose como si el cursor "rebotara" solo. */
function cancelarAvanceHora() {
  if (temporizadorAvanceHora) {
    clearTimeout(temporizadorAvanceHora);
    temporizadorAvanceHora = null;
  }
}

/** Al terminar de escribir una hora (type="time" solo entrega .value cuando ya se completaron las
 * dos cifras de la hora y las dos de los minutos — antes de eso .value queda vacío), espera un
 * momento prudente antes de saltar al siguiente campo de hora en pantalla. */
function enfocarSiguienteHora(e: ChangeEvent<HTMLInputElement>) {
  cancelarAvanceHora();
  const el = e.target;
  if (!el.value) return;
  temporizadorAvanceHora = setTimeout(() => {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="time"]'));
    const idx = inputs.indexOf(el);
    if (idx >= 0 && idx < inputs.length - 1) inputs[idx + 1].focus();
  }, 400);
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
  horas_manana: number | null;
  horas_tarde: number | null;
  horas_extra: number | null;
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
    horas_manana: f.horas_manana ?? null,
    horas_tarde: f.horas_tarde ?? null,
    horas_extra: f.horas_extra ?? 0,
  };
}

/** Campo de horas en formato "HH:MM" (como el total del PDF) en vez de decimal: mantiene su
 * propio texto mientras se escribe y solo lo convierte a número al salir del campo, para no
 * reformatear a mitad de la escritura; si el valor cambia por fuera (recalcular, editar horario),
 * se resincroniza. null (sin dato para ese bloque, ver horasExtras.ts) se muestra y se escribe como "-". */
function InputHoras({
  valor,
  onCommit,
  className,
}: {
  valor: number | null;
  onCommit: (n: number | null) => void;
  className?: string;
}) {
  const [texto, setTexto] = useState(formatHoras(valor));
  useEffect(() => setTexto(formatHoras(valor)), [valor]);
  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="HH:MM"
      className={className}
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => onCommit(parseHorasHHMM(texto))}
    />
  );
}

interface Props {
  operadores: Usuario[];
  usuarioId: string;
  /** Borrar una planilla es exclusivo del administrador — ver BloqueAcciones/lista de abajo. */
  esAdmin: boolean;
}

type ModalPlanilla = { planilla: PlanillaHorasExtras | 'nueva'; soloLectura: boolean };

export function PanelPlanillaHorasExtras({ operadores, usuarioId, esAdmin }: Props) {
  const { tienePermiso } = useAuth();
  // Delegables por permiso (ver /permisos) además del administrador real — antes eran esAdmin a secas.
  const puedeEliminarPlanillas = esAdmin || tienePermiso('eliminar_planillas_horas_extras');
  const puedeEditarConfigPlanillas = esAdmin || tienePermiso('editar_configuracion_planillas');
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [planillas, setPlanillas] = useState<PlanillaHorasExtras[]>([]);
  const [modal, setModal] = useState<ModalPlanilla | null>(null);
  const [configuracion, setConfiguracion] = useState<ConfiguracionPlanillaHorasExtras | null>(null);
  const [editandoFirmantes, setEditandoFirmantes] = useState(false);
  const [editandoJornadas, setEditandoJornadas] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [mesFiltro, setMesFiltro] = useState(mesActual());
  const [mostrarListado, setMostrarListado] = useState(false);
  const [mostrarSugerencias, setMostrarSugerencias] = useState(false);
  const [operadorExpandido, setOperadorExpandido] = useState<string | null>(null);
  // Si config no llega a cargar (ej. permisos de un rol que todavía no lo tiene habilitado), se
  // avisa acá en vez de quedar la pantalla en "Cargando…" sin ninguna pista de qué pasó — ver
  // también el botón "Cerrar" en el placeholder de abajo para no dejar a nadie atrapado ahí.
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  async function cargarPlanillas() {
    setCargando(true);
    setErrorCarga(null);
    try {
      const [{ data, error: errorPlanillas }, { data: config, error: errorConfig }] = await Promise.all([
        supabase.from('planillas_horas_extras').select('*').order('fecha_desde', { ascending: false }).limit(1000),
        supabase.from('configuracion_planilla_horas_extras').select('*').eq('id', true).single(),
      ]);
      if (errorPlanillas) throw errorPlanillas;
      setPlanillas((data as PlanillaHorasExtras[]) ?? []);
      if (config) setConfiguracion(config as ConfiguracionPlanillaHorasExtras);
      else if (errorConfig) throw errorConfig;
    } catch (err: any) {
      setErrorCarga(`No se pudo cargar: ${err.message ?? err}`);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    if (abierto) cargarPlanillas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  async function eliminar(id: string) {
    // El botón que llama a esto ya está oculto para quien no tenga el permiso (ver lista de
    // abajo) — este chequeo es solo una segunda defensa, la de fondo es la política de Supabase
    // (ver migración de permisos granulares para planillas).
    if (!puedeEliminarPlanillas) return;
    if (!window.confirm('¿Eliminar esta planilla? No se puede deshacer.')) return;
    const { error } = await supabase.from('planillas_horas_extras').delete().eq('id', id);
    if (!error) setPlanillas((prev) => prev.filter((p) => p.id !== id));
  }

  // Todas las personas (operadores o no) que alguna vez tuvieron una planilla, sin importar el
  // filtro actual — alimenta el desplegable de sugerencias del campo de búsqueda.
  const personasDisponibles = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const p of planillas) {
      const clave = p.operador_id ?? p.nombre_trabajador;
      if (!mapa.has(clave)) mapa.set(clave, p.nombre_trabajador);
    }
    return [...mapa.entries()].map(([clave, nombre]) => ({ clave, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [planillas]);

  const planillasFiltradas = useMemo(() => {
    const termino = busqueda.trim().toLowerCase();
    return planillas.filter((p) => {
      if (termino && !p.nombre_trabajador.toLowerCase().includes(termino)) return false;
      if (mesFiltro) {
        const inicioMes = `${mesFiltro}-01`;
        const [anio, mes] = mesFiltro.split('-').map(Number);
        const finMes = new Date(anio, mes, 0);
        const finMesStr = `${finMes.getFullYear()}-${String(finMes.getMonth() + 1).padStart(2, '0')}-${String(
          finMes.getDate(),
        ).padStart(2, '0')}`;
        if (p.fecha_desde > finMesStr || p.fecha_hasta < inicioMes) return false;
      }
      return true;
    });
  }, [planillas, busqueda, mesFiltro]);

  const gruposPorOperador = useMemo(() => {
    const mapa = new Map<string, { clave: string; nombre: string; planillas: PlanillaHorasExtras[] }>();
    for (const p of planillasFiltradas) {
      const clave = p.operador_id ?? p.nombre_trabajador;
      if (!mapa.has(clave)) mapa.set(clave, { clave, nombre: p.nombre_trabajador, planillas: [] });
      mapa.get(clave)!.planillas.push(p);
    }
    return [...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [planillasFiltradas]);

  return (
    <div className="tarjeta p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold cursor-pointer" onClick={() => setAbierto(true)}>
          Planilla de horas extras
        </h2>
        <button onClick={() => setAbierto(true)} className="boton-secundario text-xs px-3 py-1.5">
          Abrir
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Llena la información que pide Talento Humano (memorando, horario, horas) para generar el PDF de la planilla
        de horas extras en horizontal.
      </p>

      {abierto &&
        // Portal a document.body: este panel puede terminar dentro de una celda de GridEditable
        // (react-grid-layout posiciona sus celdas con CSS transform), y transform crea un nuevo
        // "containing block" para todo lo que sea position:fixed adentro — sin el portal, este
        // modal quedaba atrapado dentro del tamaño de esa celda en vez de cubrir toda la pantalla.
        createPortal(
        <>
          <div className="fixed inset-0 bg-black/50 z-20" onClick={() => setAbierto(false)} />

          {modal ? (
            configuracion ? (
              // EditorPlanilla se posiciona a sí mismo (distinto en celular vs escritorio, ver
              // GridEditable dentro) — no lo envuelve una caja fija del padre para no montarlo dos
              // veces (una por breakpoint) y duplicar sus llamadas a Supabase.
              <EditorPlanilla
                planilla={modal.planilla === 'nueva' ? null : modal.planilla}
                operadores={operadores}
                usuarioId={usuarioId}
                configuracion={configuracion}
                soloLectura={modal.soloLectura}
                esAdmin={esAdmin}
                onEditar={() => setModal((m) => (m ? { ...m, soloLectura: false } : m))}
                onCerrar={() => setModal(null)}
                onGuardado={async () => {
                  setModal(null);
                  await cargarPlanillas();
                }}
              />
            ) : (
              // Placeholder mientras llega "configuracion" (ver cargarPlanillas). Antes no tenía
              // ninguna salida: si esa consulta fallaba (ej. un rol sin permiso todavía en
              // Supabase), quedaba atrapado en "Cargando…" para siempre, sin poder ni cerrar ni
              // volver atrás. Ahora siempre tiene un botón para cerrar y, si hubo un error, lo
              // muestra en vez de quedarse en silencio.
              <div className="fixed inset-2 sm:inset-6 lg:inset-0 z-30 lg:flex lg:items-center lg:justify-center lg:p-4">
                <div className="h-full lg:h-auto lg:w-full lg:max-w-4xl bg-panel-800 border border-panel-600/60 rounded-xl lg:rounded-2xl shadow-xl flex flex-col items-center justify-center gap-3 p-4 text-center">
                  {errorCarga ? (
                    <>
                      <p className="text-sm text-gauge-danger">{errorCarga}</p>
                      <button
                        onClick={() => {
                          setModal(null);
                          setAbierto(false);
                        }}
                        className="boton-secundario text-sm px-4 py-1.5"
                      >
                        Cerrar
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-slate-600">Cargando…</p>
                      <button onClick={() => setModal(null)} className="text-xs text-slate-500 hover:underline">
                        Cancelar
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          ) : (
            <div className="fixed inset-2 sm:inset-6 z-30 bg-panel-800 border border-panel-600/60 rounded-xl shadow-xl flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-panel-600/40">
                <h2 className="font-semibold text-sm"></h2>
                <button onClick={() => setAbierto(false)} className="text-slate-600 hover:text-slate-900 text-lg leading-none">
                  ✕
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                <div className="max-w-2xl mx-auto space-y-3">
                    <h1 className="text-xl font-bold text-slate-900 text-center">Planillas de horas extras</h1>
                    <p className="text-sm font-semibold text-slate-700">Buscar planilla</p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="relative">
                        <input
                          type="text"
                          className="campo text-sm pr-7"
                          placeholder="Buscar por nombre…"
                          value={busqueda}
                          onChange={(e) => {
                            setBusqueda(e.target.value);
                            if (e.target.value.trim()) setMostrarListado(true);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => setMostrarSugerencias((v) => !v)}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs px-1"
                          title="Ver todo el personal con planillas"
                        >
                          ▾
                        </button>
                        {mostrarSugerencias && (
                          <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-panel-800 border border-panel-600/60 rounded-lg shadow-xl">
                            {personasDisponibles.length === 0 ? (
                              <p className="text-xs text-slate-500 p-2">Todavía no hay planillas guardadas.</p>
                            ) : (
                              <ul className="divide-y divide-panel-600/40">
                                {personasDisponibles.map((p) => (
                                  <li key={p.clave}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setBusqueda(p.nombre);
                                        setMesFiltro('');
                                        setOperadorExpandido(p.clave);
                                        setMostrarListado(true);
                                        setMostrarSugerencias(false);
                                      }}
                                      className="w-full text-left text-xs px-3 py-1.5 hover:bg-panel-700/60"
                                    >
                                      • {p.nombre}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                      <input
                        type="month"
                        className="campo text-sm"
                        value={mesFiltro}
                        onChange={(e) => {
                          setMesFiltro(e.target.value);
                          setMostrarListado(true);
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (mostrarListado) {
                          setBusqueda('');
                          setMesFiltro(mesActual());
                          setOperadorExpandido(null);
                          setMostrarListado(false);
                        } else {
                          setMesFiltro('');
                          setMostrarListado(true);
                        }
                      }}
                      className="text-xs text-gauge-ok hover:underline"
                    >
                      {mostrarListado ? 'Ocultar listado' : 'Ver todos (sin filtro de mes)'}
                    </button>

                    {mostrarListado && (cargando ? (
                      <p className="text-sm text-slate-600">Cargando…</p>
                    ) : planillas.length === 0 ? (
                      <p className="text-sm text-slate-600">Todavía no hay planillas guardadas.</p>
                    ) : gruposPorOperador.length === 0 ? (
                      <p className="text-sm text-slate-600">Nadie tiene planillas con ese filtro.</p>
                    ) : (
                      <div className="space-y-2">
                        {gruposPorOperador.map((g) => (
                          <div key={g.clave} className="border border-panel-600/40 rounded-lg overflow-hidden">
                            <button
                              type="button"
                              onClick={() => setOperadorExpandido((v) => (v === g.clave ? null : g.clave))}
                              className="w-full flex items-center justify-between gap-2 p-3 text-left"
                            >
                              <span className="text-sm font-medium text-slate-900 truncate">{g.nombre}</span>
                              <span className="text-xs text-slate-500 shrink-0">
                                {g.planillas.length} planilla{g.planillas.length === 1 ? '' : 's'}{' '}
                                {operadorExpandido === g.clave ? '▲' : '▼'}
                              </span>
                            </button>
                            {operadorExpandido === g.clave && (
                              <div className="border-t border-panel-600/40 divide-y divide-panel-600/40">
                                {g.planillas.map((p) => (
                                  <div key={p.id} className="p-3 flex items-center justify-between gap-2">
                                    <div
                                      className="min-w-0 cursor-pointer"
                                      onClick={() => setModal({ planilla: p, soloLectura: true })}
                                    >
                                      <p className="text-xs text-slate-600">
                                        {formatFechaCorta(p.fecha_desde)} al {formatFechaCorta(p.fecha_hasta)} · {p.area || 'Sin área'}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <button
                                        onClick={() => setModal({ planilla: p, soloLectura: true })}
                                        className="text-xs text-gauge-ok hover:underline"
                                      >
                                        Ver
                                      </button>
                                      <button
                                        onClick={() => setModal({ planilla: p, soloLectura: false })}
                                        className="text-xs text-gauge-ok hover:underline"
                                      >
                                        Editar
                                      </button>
                                      {puedeEliminarPlanillas && (
                                        <button onClick={() => eliminar(p.id)} className="text-xs text-gauge-danger hover:underline">
                                          Borrar
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}

                    {puedeEditarConfigPlanillas && (
                      <div className="border-t border-panel-600/40 pt-3 space-y-2">
                        <div>
                          <button
                            type="button"
                            onClick={() => setEditandoFirmantes((v) => !v)}
                            className="text-xs text-gauge-ok hover:underline"
                          >
                            ⚙️ Firmantes por defecto (Revisado por / Aprobado por)
                          </button>
                          {editandoFirmantes && configuracion && (
                            <EditorFirmantesDefault
                              configuracion={configuracion}
                              onGuardado={(c) => {
                                setConfiguracion(c);
                                setEditandoFirmantes(false);
                              }}
                            />
                          )}
                        </div>
                        <div>
                          <button
                            type="button"
                            onClick={() => setEditandoJornadas((v) => !v)}
                            className="text-xs text-gauge-ok hover:underline"
                          >
                            ⚙️ Jornadas por defecto por operador
                          </button>
                          {editandoJornadas && <EditorJornadasOperadorDefault operadores={operadores} />}
                        </div>
                      </div>
                    )}

                    <button onClick={() => setModal({ planilla: 'nueva', soloLectura: false })} className="boton-primario w-full">
                      + Nueva planilla
                    </button>
                  </div>
              </div>
            </div>
          )}
        </>,
        document.body,
      )}
    </div>
  );
}

/** Edita la fila única de configuracion_planilla_horas_extras: el cambio aplica a todas las
 * planillas nuevas que se generen de ahí en adelante (las ya guardadas no se tocan). */
function EditorFirmantesDefault({
  configuracion,
  onGuardado,
}: {
  configuracion: ConfiguracionPlanillaHorasExtras;
  onGuardado: (c: ConfiguracionPlanillaHorasExtras) => void;
}) {
  const [revisadoNombre, setRevisadoNombre] = useState(configuracion.revisado_nombre);
  const [revisadoCargo, setRevisadoCargo] = useState(configuracion.revisado_cargo);
  const [aprobadoNombre, setAprobadoNombre] = useState(configuracion.aprobado_nombre);
  const [aprobadoCargo, setAprobadoCargo] = useState(configuracion.aprobado_cargo);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function guardar() {
    setGuardando(true);
    setMensaje(null);
    const payload = {
      revisado_nombre: revisadoNombre.trim(),
      revisado_cargo: revisadoCargo.trim(),
      aprobado_nombre: aprobadoNombre.trim(),
      aprobado_cargo: aprobadoCargo.trim(),
    };
    const { error } = await supabase.from('configuracion_planilla_horas_extras').update(payload).eq('id', true);
    setGuardando(false);
    if (error) {
      setMensaje(`No se pudo guardar: ${error.message}`);
      return;
    }
    onGuardado(payload);
  }

  return (
    <div className="mt-2 border border-panel-600/40 rounded-lg p-3 space-y-3">
      <p className="text-[11px] text-slate-500">
        Se usan como firmantes de toda planilla nueva que se genere de aquí en adelante.
      </p>
      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-slate-700">Revisado por</p>
        <input type="text" className="campo text-xs" placeholder="Nombre" value={revisadoNombre} onChange={(e) => setRevisadoNombre(e.target.value)} />
        <input type="text" className="campo text-xs" placeholder="Cargo" value={revisadoCargo} onChange={(e) => setRevisadoCargo(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-slate-700">Aprobado por</p>
        <input type="text" className="campo text-xs" placeholder="Nombre" value={aprobadoNombre} onChange={(e) => setAprobadoNombre(e.target.value)} />
        <input type="text" className="campo text-xs" placeholder="Cargo" value={aprobadoCargo} onChange={(e) => setAprobadoCargo(e.target.value)} />
      </div>
      {mensaje && <p className="text-xs text-gauge-danger">{mensaje}</p>}
      <button onClick={guardar} disabled={guardando} className="boton-primario w-full text-sm">
        {guardando ? 'Guardando…' : 'Guardar firmantes por defecto'}
      </button>
    </div>
  );
}

const JORNADA_DEFECTO_VACIA = { jornada_inicio_manana: '08:00', jornada_fin_manana: '12:00', jornada_inicio_tarde: '13:00', jornada_fin_tarde: '17:00' };

/** Deja fijar el horario normal de cada operador (por si nunca tuvo una planilla, ver
 * EditorPlanilla → prellenar) sin tener que crear una planilla primero solo para eso. */
function EditorJornadasOperadorDefault({ operadores }: { operadores: Usuario[] }) {
  const [operadorId, setOperadorId] = useState('');
  const [cargando, setCargando] = useState(false);
  const [inicioManana, setInicioManana] = useState(JORNADA_DEFECTO_VACIA.jornada_inicio_manana);
  const [finManana, setFinManana] = useState(JORNADA_DEFECTO_VACIA.jornada_fin_manana);
  const [inicioTarde, setInicioTarde] = useState(JORNADA_DEFECTO_VACIA.jornada_inicio_tarde);
  const [finTarde, setFinTarde] = useState(JORNADA_DEFECTO_VACIA.jornada_fin_tarde);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    if (!operadorId) return;
    setCargando(true);
    setMensaje(null);
    supabase
      .from('jornadas_operador_default')
      .select('*')
      .eq('operador_id', operadorId)
      .maybeSingle()
      .then(({ data }) => {
        const j = (data as JornadaOperadorDefault | null) ?? JORNADA_DEFECTO_VACIA;
        setInicioManana(j.jornada_inicio_manana.slice(0, 5));
        setFinManana(j.jornada_fin_manana.slice(0, 5));
        setInicioTarde(j.jornada_inicio_tarde.slice(0, 5));
        setFinTarde(j.jornada_fin_tarde.slice(0, 5));
        setCargando(false);
      });
  }, [operadorId]);

  async function guardar() {
    setGuardando(true);
    setMensaje(null);
    const { error } = await supabase.from('jornadas_operador_default').upsert({
      operador_id: operadorId,
      jornada_inicio_manana: inicioManana,
      jornada_fin_manana: finManana,
      jornada_inicio_tarde: inicioTarde,
      jornada_fin_tarde: finTarde,
    });
    setGuardando(false);
    setMensaje(error ? `No se pudo guardar: ${error.message}` : 'Guardado.');
  }

  return (
    <div className="mt-2 border border-panel-600/40 rounded-lg p-3 space-y-3">
      <p className="text-[11px] text-slate-500">
        Se usa para prellenar la jornada de una planilla nueva de ese operador cuando todavía no tiene ninguna
        planilla anterior de donde copiarla.
      </p>
      <select className="campo text-xs" value={operadorId} onChange={(e) => setOperadorId(e.target.value)}>
        <option value="">Selecciona un operador…</option>
        {operadores.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nombre_completo}
          </option>
        ))}
      </select>

      {operadorId && (cargando ? (
        <p className="text-xs text-slate-600">Cargando…</p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2">
            <div>
              <label className="etiqueta text-[10px]">Entrada</label>
              <input type="time" className="campo text-xs" value={inicioManana} onChange={(e) => setInicioManana(e.target.value)} />
            </div>
            <div>
              <label className="etiqueta text-[10px]">Sale</label>
              <input type="time" className="campo text-xs" value={finManana} onChange={(e) => setFinManana(e.target.value)} />
            </div>
            <div>
              <label className="etiqueta text-[10px]">Entrada</label>
              <input type="time" className="campo text-xs" value={inicioTarde} onChange={(e) => setInicioTarde(e.target.value)} />
            </div>
            <div>
              <label className="etiqueta text-[10px]">Sale</label>
              <input type="time" className="campo text-xs" value={finTarde} onChange={(e) => setFinTarde(e.target.value)} />
            </div>
          </div>
          {mensaje && (
            <p className={`text-xs ${mensaje.startsWith('No se pudo') ? 'text-gauge-danger' : 'text-gauge-ok'}`}>{mensaje}</p>
          )}
          <button onClick={guardar} disabled={guardando} className="boton-primario w-full text-sm">
            {guardando ? 'Guardando…' : 'Guardar jornada de este operador'}
          </button>
        </>
      ))}
    </div>
  );
}

function EditorPlanilla({
  planilla,
  operadores,
  usuarioId,
  configuracion,
  soloLectura,
  onEditar,
  onCerrar,
  onGuardado,
  esAdmin,
}: {
  planilla: PlanillaHorasExtras | null;
  operadores: Usuario[];
  usuarioId: string;
  configuracion: ConfiguracionPlanillaHorasExtras;
  /** true = "Ver" (todo deshabilitado, ni Guardar ni las acciones que agregan/quitan filas). */
  soloLectura: boolean;
  /** Pasa de "Ver" a "Editar" sin cerrar y reabrir el modal. */
  onEditar: () => void;
  onCerrar: () => void;
  onGuardado: () => Promise<void>;
  /** Este modal también lo abre el digitador (crea/edita planillas) — "Editar distribución"
   * sigue siendo exclusiva del administrador real (ver migración 0053), igual que en el resto
   * de las pantallas. */
  esAdmin: boolean;
}) {
  const editorDistribucion = useEditorDistribucion('modal_nueva_planilla');
  const { anchoPropioDePantalla } = useAuth();
  // "Editar distribución" es exclusiva del administrador real (ver migración 0053).
  const puedeEditarDistribucion = esAdmin;
  // A diferencia de las demás pantallas, este modal por defecto ocupa casi toda la pantalla (no
  // el ancho general de 1280px) — solo se achica si alguien lo pidió explícitamente arrastrando
  // el control, por eso no usa el respaldo de anchoDePantalla().
  const anchoModal = anchoPropioDePantalla('modal_nueva_planilla');
  const [operadorId, setOperadorId] = useState<string>(planilla?.operador_id ?? '');
  const [nombreManual, setNombreManual] = useState(planilla && !planilla.operador_id ? planilla.nombre_trabajador : '');
  const [cargoTrabajador, setCargoTrabajador] = useState(planilla?.cargo_trabajador ?? '');
  const [direccion, setDireccion] = useState(planilla?.direccion ?? DIRECCION_DEFAULT);
  const [area, setArea] = useState(planilla?.area ?? AREA_DEFAULT);
  const [fechaPresentacion, setFechaPresentacion] = useState(planilla?.fecha_presentacion ?? '');
  const [fechaDesde, setFechaDesde] = useState(planilla?.fecha_desde ?? '');
  const [fechaHasta, setFechaHasta] = useState(planilla?.fecha_hasta ?? '');

  const [jornadaInicioManana, setJornadaInicioManana] = useState(planilla?.jornada_inicio_manana ?? '08:00');
  const [jornadaFinManana, setJornadaFinManana] = useState(planilla?.jornada_fin_manana ?? '12:00');
  const [jornadaInicioTarde, setJornadaInicioTarde] = useState(planilla?.jornada_inicio_tarde ?? '13:00');
  const [jornadaFinTarde, setJornadaFinTarde] = useState(planilla?.jornada_fin_tarde ?? '17:00');

  const [editarRevisado, setEditarRevisado] = useState(
    !!planilla &&
      (planilla.revisado_nombre !== configuracion.revisado_nombre || planilla.revisado_cargo !== configuracion.revisado_cargo),
  );
  const [revisadoNombre, setRevisadoNombre] = useState(planilla?.revisado_nombre ?? configuracion.revisado_nombre);
  const [revisadoCargo, setRevisadoCargo] = useState(planilla?.revisado_cargo ?? configuracion.revisado_cargo);
  const [editarAprobado, setEditarAprobado] = useState(
    !!planilla &&
      (planilla.aprobado_nombre !== configuracion.aprobado_nombre || planilla.aprobado_cargo !== configuracion.aprobado_cargo),
  );
  const [aprobadoNombre, setAprobadoNombre] = useState(planilla?.aprobado_nombre ?? configuracion.aprobado_nombre);
  const [aprobadoCargo, setAprobadoCargo] = useState(planilla?.aprobado_cargo ?? configuracion.aprobado_cargo);

  const [descripcionDefault, setDescripcionDefault] = useState('');
  const [memorandoDefault, setMemorandoDefault] = useState('');
  // Observaciones libres de la planilla (opcional). En el PDF van debajo de la nota del almuerzo.
  const [observaciones, setObservaciones] = useState(planilla?.observaciones ?? '');

  // Una planilla nueva arranca con 5 líneas en blanco por defecto (para digitar a mano si hace
  // falta); al traer los días de turno del calendario, esas líneas se van llenando con las fechas
  // encontradas y la tabla se ajusta sola para tener exactamente una fila por día (ver
  // traerDiasDeCalendario más abajo) — 4 días trabajados borran una línea, 6 agregan una. Al abrir
  // una planilla ya guardada, arranca vacía: sus filas reales las trae el efecto de "cargarFilas".
  const [filas, setFilas] = useState<FilaEdit[]>(() =>
    planilla ? [] : Array.from({ length: 5 }, () => nuevaFila('')),
  );
  const [cargandoFilas, setCargandoFilas] = useState(!!planilla);
  const [guardando, setGuardando] = useState(false);
  const [generandoPdf, setGenerandoPdf] = useState(false);
  const [trayendoDias, setTrayendoDias] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfNombre, setPdfNombre] = useState('');
  const [compartiendo, setCompartiendo] = useState(false);
  // Caso puntual "no se pudo compartir directo, quedó descargado" — su propio aviso destacado con
  // la instrucción de qué hacer, no un renglón de texto plano más.
  const [avisoCompartirManual, setAvisoCompartirManual] = useState(false);

  // Flujo de "campos incompletos" antes de Guardar/Generar PDF: primero se ofrece elegir entre
  // guardar igual o completar; si elige guardar igual se pregunta una segunda vez para confirmar;
  // si elige completar, se sombrean en rojo los campos vacíos (campoClase más abajo) y el sombreado
  // se quita solo, en vivo, apenas se llena cada uno — no hay que limpiarlo a mano.
  const [accionPendiente, setAccionPendiente] = useState<'guardar' | 'pdf' | null>(null);
  const [confirmarSinCompletar, setConfirmarSinCompletar] = useState(false);
  const [resaltarFaltantes, setResaltarFaltantes] = useState(false);

  const jornada = useMemo(
    () => ({
      jornada_inicio_manana: jornadaInicioManana,
      jornada_fin_manana: jornadaFinManana,
      jornada_inicio_tarde: jornadaInicioTarde,
      jornada_fin_tarde: jornadaFinTarde,
    }),
    [jornadaInicioManana, jornadaFinManana, jornadaInicioTarde, jornadaFinTarde],
  );

  // Los avisos de "falta el operador" o "falta el período" (al traer días o al guardar) se limpian
  // solos apenas se subsana lo que pedían — no deben quedarse en pantalla una vez elegido el
  // trabajador o llenadas las fechas.
  useEffect(() => {
    setMensaje((m) => {
      if (m === 'Elige un operador registrado para poder traer sus días de turno.') {
        return operadorId && operadorId !== MANUAL ? null : m;
      }
      if (
        m === 'Escribe el período (Desde/Hasta) antes de traer los días.' ||
        m === 'El período (Desde/Hasta) es obligatorio — sin esas dos fechas no se puede guardar la planilla.'
      ) {
        return fechaDesde && fechaHasta ? null : m;
      }
      return m;
    });
  }, [operadorId, fechaDesde, fechaHasta]);

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
      const cargadas = ((data as FilaPlanillaHorasExtras[]) ?? []).map(filaDesdeDb);
      setFilas(cargadas);
      // Al reabrir una planilla ya guardada, "N.º de informe de actividades" y "N.º de memorando
      // de autorización" partían siempre en blanco (solo se usaban como plantilla para las filas
      // nuevas que se agregaran) aunque las filas ya tuvieran su propio valor guardado — se
      // prellenan acá con el de la primera fila que tenga algo, para que se vean de una.
      const conInforme = cargadas.find((f) => f.descripcion_actividades);
      if (conInforme) setDescripcionDefault(conInforme.descripcion_actividades);
      const conMemorando = cargadas.find((f) => f.numero_memorando);
      if (conMemorando) setMemorandoDefault(conMemorando.numero_memorando);
      setCargandoFilas(false);
    }
    cargarFilas();
  }, [planilla]);

  // Al elegir un operador registrado en una planilla nueva: el cargo/ocupación sale directo de su
  // perfil (Usuarios → 💼 Cargo), que manda sobre cualquier valor anterior porque es un dato de la
  // persona, no de la planilla. Área/dirección/jornada se prellenan con los de la última planilla
  // que se le haya generado (si existe) solo para no volver a escribirlos, sin forzarlos.
  useEffect(() => {
    if (planilla || !operadorId || operadorId === MANUAL) return;
    const operador = operadores.find((o) => o.id === operadorId);
    if (operador?.cargo) setCargoTrabajador(operador.cargo);

    async function prellenar() {
      // Se piden en paralelo: el área/dirección/ocupación siguen saliendo de la última planilla del
      // operador (si existe), pero la jornada la manda la jornada por defecto configurada para ese
      // operador (ver EditorJornadasOperadorDefault) siempre que exista — es la más reciente decisión
      // del usuario sobre su horario, más confiable que lo que haya quedado en una planilla vieja.
      // Solo si nunca se configuró una jornada por defecto se cae de vuelta a la de la última planilla.
      const [{ data }, { data: jornadaDefaultData }] = await Promise.all([
        supabase
          .from('planillas_horas_extras')
          .select('*')
          .eq('operador_id', operadorId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from('jornadas_operador_default').select('*').eq('operador_id', operadorId).maybeSingle(),
      ]);
      const anterior = data as PlanillaHorasExtras | null;
      if (anterior) {
        if (!operador?.cargo) setCargoTrabajador((v) => v || anterior.cargo_trabajador);
        setArea((v) => (v === AREA_DEFAULT ? anterior.area : v));
        setDireccion((v) => (v === DIRECCION_DEFAULT ? anterior.direccion : v));
      }
      const jornadaDefault = jornadaDefaultData as JornadaOperadorDefault | null;
      if (jornadaDefault) {
        setJornadaInicioManana(jornadaDefault.jornada_inicio_manana);
        setJornadaFinManana(jornadaDefault.jornada_fin_manana);
        setJornadaInicioTarde(jornadaDefault.jornada_inicio_tarde);
        setJornadaFinTarde(jornadaDefault.jornada_fin_tarde);
      } else if (anterior) {
        setJornadaInicioManana(anterior.jornada_inicio_manana);
        setJornadaFinManana(anterior.jornada_fin_manana);
        setJornadaInicioTarde(anterior.jornada_inicio_tarde);
        setJornadaFinTarde(anterior.jornada_fin_tarde);
      }
    }
    prellenar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operadorId]);

  const nombreTrabajador =
    operadorId && operadorId !== MANUAL
      ? operadores.find((o) => o.id === operadorId)?.nombre_completo ?? ''
      : nombreManual;

  // Campos vacíos de toda la planilla (encabezado + cada fila) — se recalcula solo con cada cambio,
  // así el sombreado en rojo (ver campoClase) desaparece de un campo apenas se llena, sin tener que
  // limpiarlo a mano en cada onChange.
  const camposFaltantes = useMemo(() => {
    const faltan = new Set<string>();
    if (!operadorId) faltan.add('operador');
    if (operadorId === MANUAL && !nombreManual.trim()) faltan.add('nombreManual');
    if (!cargoTrabajador.trim()) faltan.add('cargoTrabajador');
    if (!area.trim()) faltan.add('area');
    if (!direccion.trim()) faltan.add('direccion');
    if (!fechaPresentacion) faltan.add('fechaPresentacion');
    if (!fechaDesde) faltan.add('fechaDesde');
    if (!fechaHasta) faltan.add('fechaHasta');
    if (!jornadaInicioManana) faltan.add('jornadaInicioManana');
    if (!jornadaFinManana) faltan.add('jornadaFinManana');
    if (!jornadaInicioTarde) faltan.add('jornadaInicioTarde');
    if (!jornadaFinTarde) faltan.add('jornadaFinTarde');
    if (editarRevisado && !revisadoNombre.trim()) faltan.add('revisadoNombre');
    if (editarRevisado && !revisadoCargo.trim()) faltan.add('revisadoCargo');
    if (editarAprobado && !aprobadoNombre.trim()) faltan.add('aprobadoNombre');
    if (editarAprobado && !aprobadoCargo.trim()) faltan.add('aprobadoCargo');
    if (!descripcionDefault.trim()) faltan.add('descripcionDefault');
    if (!memorandoDefault.trim()) faltan.add('memorandoDefault');
    for (const f of filas) {
      if (!f.descripcion_actividades.trim()) faltan.add(`fila-${f.id}-descripcion`);
      if (!f.numero_memorando.trim()) faltan.add(`fila-${f.id}-memorando`);
      // Entrada/Sale de cada bloque: no se marcan como "faltante" (rojo) las que ya tienen su propio
      // aviso amarillo de "Calcular igual" (pendienteManana/pendienteTarde, ver la tabla más abajo)
      // para no pelear dos colores por el mismo campo — ahí el amarillo manda hasta que se confirme.
      const tieneManana = !!(f.entrada_manana && f.salida_manana);
      const tieneTarde = !!(f.entrada_tarde && f.salida_tarde);
      const algoManana = !!(f.entrada_manana || f.salida_manana);
      const algoTarde = !!(f.entrada_tarde || f.salida_tarde);
      const pendienteManana = !tieneManana && algoManana && tieneTarde && f.horas_manana === null;
      const pendienteTarde = !tieneTarde && algoTarde && tieneManana && f.horas_tarde === null;
      if (!f.entrada_manana) faltan.add(`fila-${f.id}-entrada_manana`);
      if (!f.salida_manana && !pendienteManana) faltan.add(`fila-${f.id}-salida_manana`);
      if (!f.entrada_tarde && !pendienteTarde) faltan.add(`fila-${f.id}-entrada_tarde`);
      if (!f.salida_tarde) faltan.add(`fila-${f.id}-salida_tarde`);
    }
    return faltan;
  }, [
    operadorId,
    nombreManual,
    cargoTrabajador,
    area,
    direccion,
    fechaPresentacion,
    fechaDesde,
    fechaHasta,
    jornadaInicioManana,
    jornadaFinManana,
    jornadaInicioTarde,
    jornadaFinTarde,
    editarRevisado,
    revisadoNombre,
    revisadoCargo,
    editarAprobado,
    aprobadoNombre,
    aprobadoCargo,
    descripcionDefault,
    memorandoDefault,
    filas,
  ]);

  function campoClase(base: string, clave: string): string {
    return resaltarFaltantes && camposFaltantes.has(clave) ? `${base} border-2 border-gauge-danger bg-gauge-danger/10` : base;
  }

  // Al escribir en "N.º de informe de actividades" / "N.º de memorando de autorización", se
  // completan de una vez las filas que todavía no tengan su propia Descripción/N.º memorando —
  // antes solo se usaban como plantilla para los días que se agregaran después ("+ Día"), dejando
  // en blanco los que ya existían en la tabla. Se compara contra el valor anterior (no solo contra
  // vacío) para que cada letra que se escribe siga completando la fila entera, en vez de solo la
  // primera letra: si no, apenas se llenaba con "I" esa fila dejaba de estar "vacía" y la siguiente
  // letra ("N", "F"...) ya no la alcanzaba.
  const descripcionDefaultAnteriorRef = useRef('');
  useEffect(() => {
    const anterior = descripcionDefaultAnteriorRef.current;
    setFilas((prev) =>
      prev.map((f) =>
        !f.descripcion_actividades || f.descripcion_actividades === anterior
          ? { ...f, descripcion_actividades: descripcionDefault }
          : f,
      ),
    );
    descripcionDefaultAnteriorRef.current = descripcionDefault;
  }, [descripcionDefault]);

  const memorandoDefaultAnteriorRef = useRef('');
  useEffect(() => {
    const anterior = memorandoDefaultAnteriorRef.current;
    setFilas((prev) =>
      prev.map((f) => (!f.numero_memorando || f.numero_memorando === anterior ? { ...f, numero_memorando: memorandoDefault } : f)),
    );
    memorandoDefaultAnteriorRef.current = memorandoDefault;
  }, [memorandoDefault]);

  function nuevaFila(fecha: string): FilaEdit {
    return {
      id: `tmp-${fecha}-${Math.random().toString(36).slice(2)}`,
      esNueva: true,
      fecha,
      descripcion_actividades: descripcionDefault,
      numero_memorando: memorandoDefault,
      entrada_manana: '',
      salida_manana: '',
      entrada_tarde: '',
      salida_tarde: '',
      horas_manana: null,
      horas_tarde: null,
      horas_extra: null,
    };
  }

  function agregarFilaManual() {
    setFilas((prev) => [...prev, nuevaFila(fechaDesde || hoyLocal())]);
  }

  // filasBase: de dónde partir al mezclar los días traídos — por defecto las filas actuales
  // (comportamiento del botón manual), pero el efecto de "cambio de operador" de más abajo pasa
  // un arreglo de 5 en blanco explícito para no mezclar con los días del operador anterior (ver
  // nota ahí sobre por qué no alcanza con hacer setFilas(blancas) y confiar en el estado `filas`,
  // que todavía no se habría actualizado para cuando esta función lo lee).
  async function traerDiasDeCalendario(filasBase?: FilaEdit[]) {
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
      const base = filasBase ?? filas;
      const fechasExistentes = new Set(base.filter((f) => f.fecha).map((f) => f.fecha));
      const nuevasFechas = ((data as { fecha: string }[]) ?? [])
        .map((t) => t.fecha)
        .filter((fecha) => !fechasExistentes.has(fecha));
      if (nuevasFechas.length === 0) {
        setFilas(base);
        setMensaje('No hay días de turno nuevos en ese período (o ya estaban agregados).');
      } else {
        // Las líneas en blanco (las 5 por defecto, o cualquier otra que haya quedado vacía) se
        // rellenan primero con estos días; lo que sobra de días se agrega como filas nuevas, y lo
        // que sobra de líneas en blanco (si trajo menos días que líneas vacías) se descarta — así
        // la tabla queda con exactamente una fila por día de turno encontrado.
        const conContenido = base.filter((f) => f.fecha);
        const blancas = base.filter((f) => !f.fecha);
        const reutilizadas = nuevasFechas.slice(0, blancas.length).map((fecha, i) => ({ ...blancas[i], fecha }));
        const extras = nuevasFechas.slice(blancas.length).map((fecha) => nuevaFila(fecha));
        setFilas([...conContenido, ...reutilizadas, ...extras].sort((a, b) => a.fecha.localeCompare(b.fecha)));
      }
    } catch (err: any) {
      setMensaje(`No se pudo traer los días: ${err.message ?? err}`);
    } finally {
      setTrayendoDias(false);
    }
  }

  // En una planilla nueva, apenas queda elegido el trabajador (registrado, no "Otro") y completo
  // el período (Desde/Hasta), se traen solos los días de turno (sábados/domingos/feriados
  // trabajados) sin tener que tocar el botón "Traer días del calendario de turnos" — ese botón
  // queda igual, como respaldo, por si se cambia el período después o se agregan turnos nuevos al
  // calendario y hay que volver a jalarlos. No corre al abrir una planilla ya guardada (edición):
  // ahí el operador/período ya vienen llenos desde el inicio y no se debe reconsultar el calendario.
  const operadorAnteriorRef = useRef(operadorId);
  useEffect(() => {
    if (planilla || !operadorId || operadorId === MANUAL || !fechaDesde || !fechaHasta) return;
    // Si el trabajador cambió (ej. se eligió a alguien por error y se corrige), las filas que ya
    // se habían traído eran del trabajador anterior — no tiene sentido mezclarlas con las del
    // nuevo, así que se parte de una tabla limpia de 5 en blanco antes de traer sus días. Se pasa
    // ese arreglo directo a traerDiasDeCalendario (en vez de hacer setFilas y confiar en que el
    // estado ya esté actualizado) porque React no aplica el setFilas a tiempo para que esta misma
    // función lo vea en la misma pasada.
    const cambioDeOperador = !!operadorAnteriorRef.current && operadorAnteriorRef.current !== operadorId;
    operadorAnteriorRef.current = operadorId;
    traerDiasDeCalendario(cambioDeOperador ? Array.from({ length: 5 }, () => nuevaFila('')) : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planilla, operadorId, fechaDesde, fechaHasta]);

  // Mañana/Tarde/Extras se calculan solas en cuanto el operador escribe Entrada/Sale (nunca antes:
  // una fila nueva empieza en blanco, sin horario ni horas de ejemplo — ver nuevaFila). Si edita
  // Mañana/Tarde/Extras directamente en vez de tocar el horario, ese valor a mano se respeta.
  // Si el cálculo resulta en un bloque "asumido" (falta una marcación, ver horasExtras.ts), no se
  // aplica solo — se deja pendiente para que el operador lo confirme con el botón "Calcular igual".
  function actualizarFila(id: string, cambios: Partial<FilaEdit>) {
    setFilas((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        const actualizada = { ...f, ...cambios };
        const horarioCambio =
          'entrada_manana' in cambios || 'salida_manana' in cambios || 'entrada_tarde' in cambios || 'salida_tarde' in cambios;
        if (horarioCambio) {
          const r = calcularHorasFila(actualizada, jornada);
          const pendiente = r.manana_asumida || r.tarde_asumida;
          return {
            ...actualizada,
            horas_manana: r.manana_asumida ? null : r.horas_manana,
            horas_tarde: r.tarde_asumida ? null : r.horas_tarde,
            horas_extra: pendiente ? null : r.horas_extra,
          };
        }
        return actualizada;
      }),
    );
  }

  function quitarFila(id: string) {
    setFilas((prev) => prev.filter((f) => f.id !== id));
  }

  /** Aplica el cálculo completo de una fila aunque incluya un bloque "asumido" — el operador lo pidió
   * a propósito con el botón "Calcular igual" de esa fila. */
  function calcularIgual(id: string) {
    setFilas((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        const r = calcularHorasFila(f, jornada);
        return { ...f, horas_manana: r.horas_manana, horas_tarde: r.horas_tarde, horas_extra: r.horas_extra };
      }),
    );
  }

  // Vuelve a calcular Mañana/Tarde/Extras de todas las filas con la jornada y las reglas actuales
  // — útil para filas ya guardadas antes de un ajuste en la lógica de cálculo (quedan con el valor
  // viejo hasta que se recalculan a mano). A diferencia del cálculo automático al editar una fila,
  // este botón sí aplica de una los bloques "asumidos", porque tocarlo ya es la confirmación.
  function recalcularTodas() {
    setFilas((prev) =>
      prev.map((f) => {
        const r = calcularHorasFila(f, jornada);
        return { ...f, horas_manana: r.horas_manana, horas_tarde: r.horas_tarde, horas_extra: r.horas_extra };
      }),
    );
  }

  const totalHorasExtra = useMemo(() => sumarHorasExtra(filas), [filas]);
  // Se recalcula en cada cambio de filas: en cuanto se corrige la hora mal digitada, la fila deja
  // de aparecer aquí sola, sin necesidad de tocar Guardar ni Generar PDF.
  const erroresOrden = useMemo(
    () =>
      filas
        .map((f) => ({ fecha: f.fecha, error: validarOrdenHorario(f) }))
        .filter((r): r is { fecha: string; error: string } => !!r.error),
    [filas],
  );
  // Aviso, no bloquea: un almuerzo mucho más largo que el de la Jornada normal no es un dato
  // inválido (el orden de las horas está bien), pero vale la pena que el operador lo confirme.
  const [avisosDescartados, setAvisosDescartados] = useState<Set<string>>(new Set());
  const avisosAlmuerzo = useMemo(
    () =>
      filas
        .map((f) => ({ id: f.id, fecha: f.fecha, aviso: avisoAlmuerzoLargo(f, jornada) }))
        .filter(
          (r): r is { id: string; fecha: string; aviso: NonNullable<ReturnType<typeof avisoAlmuerzoLargo>> } =>
            !!r.aviso && !avisosDescartados.has(r.id),
        ),
    [filas, jornada, avisosDescartados],
  );

  async function guardar() {
    // Único campo que sigue bloqueando incluso con "Guardar sin completar": la base de datos exige
    // sí o sí un período (columnas fecha_desde/fecha_hasta no admiten vacío), así que sin esto la
    // planilla no se puede grabar de ninguna forma, a diferencia del resto de campos.
    if (!fechaDesde || !fechaHasta) {
      setMensaje('El período (Desde/Hasta) es obligatorio — sin esas dos fechas no se puede guardar la planilla.');
      return;
    }
    const filaInvalida = filas.map((f) => ({ f, error: validarOrdenHorario(f) })).find((r) => r.error);
    if (filaInvalida) {
      setMensaje(`Revisa el horario del ${formatFechaCorta(filaInvalida.f.fecha)}: ${filaInvalida.error}`);
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
        revisado_nombre: editarRevisado ? revisadoNombre.trim() : configuracion.revisado_nombre,
        revisado_cargo: editarRevisado ? revisadoCargo.trim() : configuracion.revisado_cargo,
        aprobado_nombre: editarAprobado ? aprobadoNombre.trim() : configuracion.aprobado_nombre,
        aprobado_cargo: editarAprobado ? aprobadoCargo.trim() : configuracion.aprobado_cargo,
        observaciones: observaciones.trim() || null,
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
    const filaInvalida = filas.map((f) => ({ f, error: validarOrdenHorario(f) })).find((r) => r.error);
    if (filaInvalida) {
      setMensaje(`Revisa el horario del ${formatFechaCorta(filaInvalida.f.fecha)}: ${filaInvalida.error}`);
      return;
    }
    setGenerandoPdf(true);
    setMensaje(null);
    setAvisoCompartirManual(false);
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
          revisadoNombre: editarRevisado ? revisadoNombre.trim() : configuracion.revisado_nombre,
          revisadoCargo: editarRevisado ? revisadoCargo.trim() : configuracion.revisado_cargo,
          aprobadoNombre: editarAprobado ? aprobadoNombre.trim() : configuracion.aprobado_nombre,
          aprobadoCargo: editarAprobado ? aprobadoCargo.trim() : configuracion.aprobado_cargo,
          observaciones: observaciones.trim() || null,
        },
        filasReporte,
        formatHoras(totalHorasExtra),
      );
      const slug = nombreTrabajador.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      const nombreArchivo = `planilla_horas_extras_${slug}_${timestampArchivo()}.pdf`;
      setPdfBlob(blob);
      setPdfNombre(nombreArchivo);
      descargarBlob(blob, nombreArchivo);
      abrirBlob(blob);
    } catch (err: any) {
      setMensaje(`No se pudo generar el PDF: ${err.message ?? err}`);
    } finally {
      setGenerandoPdf(false);
    }
  }

  // Mismo mecanismo que "Descargar y compartir" en Reportes y en Calendario de turnos: comparte
  // el PDF con el selector nativo del celular (el usuario elige WhatsApp ahí).
  async function compartirPorWhatsApp() {
    if (!pdfBlob) return;
    setCompartiendo(true);
    setMensaje(null);
    setAvisoCompartirManual(false);
    try {
      const archivo = new File([pdfBlob], pdfNombre, { type: 'application/pdf' });
      if (!navigator.canShare || !navigator.canShare({ files: [archivo] })) {
        descargarBlob(pdfBlob, pdfNombre);
        setAvisoCompartirManual(true);
        return;
      }
      try {
        await navigator.share({ files: [archivo], title: 'Planilla de horas extras', text: nombreTrabajador.trim() });
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        // El navegador dice que sí puede compartir (canShare) pero lo niega al intentarlo — se
        // descarga como respaldo en vez de dejar al usuario solo con un error técnico.
        descargarBlob(pdfBlob, pdfNombre);
        setAvisoCompartirManual(true);
      }
    } finally {
      setCompartiendo(false);
    }
  }

  // Antes de guardar o generar el PDF, si hay campos vacíos se pide confirmación (ver el modal más
  // abajo) en vez de dejar pasar directo. "Guardar sin completar" salta esto y llama a guardar()/
  // generarPdf() de una vez — por eso esas dos funciones ya no bloquean por campos vacíos, solo por
  // errores reales de horario (validarOrdenHorario).
  function alGuardarClick() {
    if (camposFaltantes.size > 0) {
      setAccionPendiente('guardar');
      return;
    }
    guardar();
  }

  function alGenerarPdfClick() {
    // El PDF sale de lo que hay guardado en la base (RPCs/PDF no leen el estado sin guardar del
    // formulario) — generarlo antes de guardar una planilla nueva mostraría datos que todavía no
    // existen ahí. `planilla` solo es no-nulo si ya estaba guardada al abrir este editor (Ver/
    // Editar) — para una "Nueva planilla", sigue siendo null durante toda la vida de este editor
    // (guardar() cierra el modal al terminar, ver onGuardado en el padre).
    if (!planilla) {
      setMensaje('Primero guarda la planilla — recién después de guardar se puede generar el PDF.');
      return;
    }
    if (camposFaltantes.size > 0) {
      setAccionPendiente('pdf');
      return;
    }
    generarPdf();
  }

  // Mismo encabezado (título + cerrar) para las dos cajas de abajo (celular y escritorio) — el
  // modal se posiciona distinto según el ancho de pantalla, pero es un solo EditorPlanilla montado
  // (ver PanelPlanillaHorasExtras), así que esto solo cambia de forma visualmente, no de estado.
  const titulo = soloLectura ? 'Ver planilla' : planilla ? 'Editar planilla' : 'Nueva planilla';
  const encabezado = (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b-2 border-gauge-ok/50 bg-panel-900/60 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-1.5 h-7 rounded-full bg-gauge-ok shrink-0" aria-hidden="true" />
        <h2 className="text-lg font-bold text-slate-900 truncate">{titulo}</h2>
        {soloLectura && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 bg-panel-700 border border-panel-600 rounded-full px-2 py-0.5 shrink-0">
            Solo lectura
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {soloLectura && (
          <button onClick={onEditar} className="text-sm text-gauge-ok hover:underline">
            ✏️ Editar
          </button>
        )}
        <button onClick={onCerrar} className="text-slate-600 hover:text-slate-900 text-lg leading-none">
          ✕
        </button>
      </div>
    </div>
  );

  if (cargandoFilas) {
    return (
      <>
        <div className="lg:hidden fixed inset-2 sm:inset-6 z-30 bg-panel-800 border border-panel-600/60 rounded-xl shadow-xl flex flex-col overflow-hidden">
          {encabezado}
          <div className="flex-1 flex items-center justify-center p-4">
            <p className="text-sm text-slate-600">Cargando…</p>
          </div>
        </div>
        <div className="hidden lg:flex fixed inset-6 z-30">
          <div className="bg-panel-800 rounded-2xl w-full flex flex-col overflow-hidden">
            {encabezado}
            <div className="flex-1 flex items-center justify-center p-8">
              <p className="text-sm text-slate-600">Cargando…</p>
            </div>
          </div>
        </div>
      </>
    );
  }

  const bloquesModalPlanilla = PANTALLAS_EDITABLES.find((p) => p.id === 'modal_nueva_planilla')!.bloques;

  const props_encabezadoFechas: BloqueEncabezadoFechasProps = {
    operadorId,
    setOperadorId,
    operadores,
    campoClase,
    nombreManual,
    setNombreManual,
    cargoTrabajador,
    setCargoTrabajador,
    area,
    setArea,
    direccion,
    setDireccion,
    fechaPresentacion,
    setFechaPresentacion,
    fechaDesde,
    setFechaDesde,
    fechaHasta,
    setFechaHasta,
    soloLectura,
  };
  const props_jornadaNormal: BloqueJornadaNormalProps = {
    campoClase,
    soloLectura,
    jornadaInicioManana,
    setJornadaInicioManana,
    jornadaFinManana,
    setJornadaFinManana,
    jornadaInicioTarde,
    setJornadaInicioTarde,
    jornadaFinTarde,
    setJornadaFinTarde,
  };
  const props_informeMemorando: BloqueInformeMemorandoProps = {
    campoClase,
    descripcionDefault,
    setDescripcionDefault,
    memorandoDefault,
    setMemorandoDefault,
    observaciones,
    setObservaciones,
    traerDiasDeCalendario,
    trayendoDias,
    mensaje,
    soloLectura,
  };
  const props_tablaDias: BloqueTablaDiasProps = {
    filas,
    jornada,
    resaltarFaltantes,
    campoClase,
    actualizarFila,
    quitarFila,
    calcularIgual,
    recalcularTodas,
    agregarFilaManual,
    erroresOrden,
    avisosAlmuerzo,
    setAvisosDescartados,
    soloLectura,
  };
  const props_acciones: BloqueAccionesProps = {
    totalHorasExtra,
    configuracion,
    campoClase,
    soloLectura,
    editarRevisado,
    setEditarRevisado,
    revisadoNombre,
    setRevisadoNombre,
    revisadoCargo,
    setRevisadoCargo,
    editarAprobado,
    setEditarAprobado,
    aprobadoNombre,
    setAprobadoNombre,
    aprobadoCargo,
    setAprobadoCargo,
    pdfBlob,
    pdfNombre,
    compartirPorWhatsApp,
    compartiendo,
    avisoCompartirManual,
    alGuardarClick,
    guardando,
    alGenerarPdfClick,
    generandoPdf,
    onCerrar,
    mensaje,
  };

  return (
    <>
      {/* Celular: exactamente el mismo apilado de siempre, sin GridEditable. */}
      <div className="lg:hidden fixed inset-2 sm:inset-6 z-30 bg-panel-800 border border-panel-600/60 rounded-xl shadow-xl flex flex-col overflow-hidden">
        {encabezado}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="max-w-2xl mx-auto w-full space-y-4">
            <BloqueEncabezadoFechas {...props_encabezadoFechas} />
            <BloqueJornadaNormal {...props_jornadaNormal} />
            <BloqueInformeMemorando {...props_informeMemorando} />
          </div>
          <BloqueTablaDias {...props_tablaDias} />
          <BloqueAcciones {...props_acciones} />
        </div>
      </div>

      {/* Escritorio (lg+): por defecto ocupa casi toda la pantalla (no una caja chica centrada)
          para que los 5 bloques tengan espacio de sobra y no haga falta scroll para verlos todos
          — "Editar distribución" puede achicarlo si se prefiere más angosto. */}
      <div className="hidden lg:flex fixed inset-6 z-30 justify-center">
        <div
          className="bg-panel-800 rounded-2xl w-full flex flex-col overflow-hidden"
          style={anchoModal ? { maxWidth: `${anchoModal}px` } : undefined}
        >
          {encabezado}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
            {puedeEditarDistribucion && <BarraDistribucion editor={editorDistribucion} />}
            <GridEditable
              pantallaId="modal_nueva_planilla"
              bloques={bloquesModalPlanilla}
              modoEdicion={puedeEditarDistribucion && editorDistribucion.modoEdicion}
              resetSignal={editorDistribucion.resetSignal}
              objetivoEdicion={editorDistribucion.objetivoActivo}
              onGuardar={editorDistribucion.guardar}
              renderBloque={(bloqueId) => {
                switch (bloqueId) {
                  case 'encabezado_fechas':
                    return <BloqueEncabezadoFechas {...props_encabezadoFechas} />;
                  case 'jornada_normal':
                    return <BloqueJornadaNormal {...props_jornadaNormal} />;
                  case 'informe_memorando':
                    return <BloqueInformeMemorando {...props_informeMemorando} />;
                  case 'tabla_dias':
                    return <BloqueTablaDias {...props_tablaDias} />;
                  case 'acciones':
                    return <BloqueAcciones {...props_acciones} />;
                  default:
                    return null;
                }
              }}
            />
            {editorDistribucion.guardando && <p className="text-xs text-slate-500">Guardando…</p>}
          </div>
        </div>
      </div>

      {accionPendiente && !confirmarSinCompletar && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setAccionPendiente(null)} />
          <div className="fixed inset-x-4 top-1/3 z-50 max-w-sm mx-auto bg-panel-800 border border-panel-600/60 rounded-xl shadow-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Faltan campos por completar</p>
              <button
                onClick={() => setAccionPendiente(null)}
                className="text-slate-600 hover:text-slate-900 text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-slate-600">Todavía hay campos vacíos en esta planilla. ¿Qué deseas hacer?</p>
            <div className="space-y-2">
              <button onClick={() => setConfirmarSinCompletar(true)} className="boton-secundario w-full text-sm">
                {accionPendiente === 'pdf' ? 'Generar PDF sin completar' : 'Guardar sin completar'}
              </button>
              <button
                onClick={() => {
                  setResaltarFaltantes(true);
                  setAccionPendiente(null);
                }}
                className="boton-primario w-full text-sm"
              >
                Cerrar el mensaje y completar
              </button>
            </div>
          </div>
        </>
      )}

      {confirmarSinCompletar && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => {
              setConfirmarSinCompletar(false);
              setAccionPendiente(null);
            }}
          />
          <div className="fixed inset-x-4 top-1/3 z-50 max-w-sm mx-auto bg-panel-800 border border-panel-600/60 rounded-xl shadow-xl p-4 space-y-3">
            <p className="text-sm font-semibold">
              ¿Seguro que deseas {accionPendiente === 'pdf' ? 'generar el PDF' : 'guardar la planilla'} sin completar
              todos los campos?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setConfirmarSinCompletar(false);
                  const accion = accionPendiente;
                  setAccionPendiente(null);
                  if (accion === 'pdf') generarPdf();
                  else guardar();
                }}
                className="boton-primario flex-1 text-sm"
              >
                Sí, {accionPendiente === 'pdf' ? 'generar' : 'guardar'}
              </button>
              <button
                onClick={() => {
                  setConfirmarSinCompletar(false);
                  setAccionPendiente(null);
                }}
                className="boton-secundario flex-1 text-sm"
              >
                No, cancelar
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

interface BloqueEncabezadoFechasProps {
  operadorId: string;
  setOperadorId: Dispatch<SetStateAction<string>>;
  operadores: Usuario[];
  campoClase: (base: string, clave: string) => string;
  nombreManual: string;
  setNombreManual: Dispatch<SetStateAction<string>>;
  cargoTrabajador: string;
  setCargoTrabajador: Dispatch<SetStateAction<string>>;
  area: string;
  setArea: Dispatch<SetStateAction<string>>;
  direccion: string;
  setDireccion: Dispatch<SetStateAction<string>>;
  fechaPresentacion: string;
  setFechaPresentacion: Dispatch<SetStateAction<string>>;
  fechaDesde: string;
  setFechaDesde: Dispatch<SetStateAction<string>>;
  fechaHasta: string;
  setFechaHasta: Dispatch<SetStateAction<string>>;
  soloLectura: boolean;
}

function BloqueEncabezadoFechas({
  operadorId,
  setOperadorId,
  operadores,
  campoClase,
  nombreManual,
  setNombreManual,
  cargoTrabajador,
  setCargoTrabajador,
  soloLectura,
  area,
  setArea,
  direccion,
  setDireccion,
  fechaPresentacion,
  setFechaPresentacion,
  fechaDesde,
  setFechaDesde,
  fechaHasta,
  setFechaHasta,
}: BloqueEncabezadoFechasProps) {
  return (
    // fieldset disabled deshabilita de una todos los campos/selects de adentro sin tener que
    // agregarle disabled={soloLectura} a cada uno por separado — className="contents" para que
    // no meta una caja nueva que rompa el space-y-4 de afuera.
    <fieldset disabled={soloLectura} className="contents">
    <div className="space-y-4">
      <div>
        <label className="etiqueta">Trabajador</label>
        <select className={campoClase('campo', 'operador')} value={operadorId} onChange={(e) => setOperadorId(e.target.value)}>
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
          <input
            type="text"
            className={campoClase('campo', 'nombreManual')}
            value={nombreManual}
            onChange={(e) => setNombreManual(e.target.value)}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="etiqueta">Ocupación</label>
          <input
            type="text"
            className={campoClase('campo', 'cargoTrabajador')}
            value={cargoTrabajador}
            onChange={(e) => setCargoTrabajador(e.target.value)}
          />
        </div>
        <div>
          <label className="etiqueta">Área</label>
          <input
            type="text"
            className={campoClase('campo', 'area')}
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="Ej: Estaciones de bombeo"
          />
        </div>
      </div>

      <div>
        <label className="etiqueta">Dirección</label>
        <input type="text" className={campoClase('campo', 'direccion')} value={direccion} onChange={(e) => setDireccion(e.target.value)} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="etiqueta">Fecha de presentación</label>
          <input
            type="date"
            className={campoClase('campo', 'fechaPresentacion')}
            value={fechaPresentacion}
            onChange={(e) => setFechaPresentacion(e.target.value)}
          />
        </div>
        <div>
          <label className="etiqueta">Período — Desde</label>
          <input
            type="date"
            className={campoClase('campo', 'fechaDesde')}
            value={fechaDesde}
            onChange={(e) => setFechaDesde(e.target.value)}
          />
        </div>
        <div>
          <label className="etiqueta">Período — Hasta</label>
          <input
            type="date"
            className={campoClase('campo', 'fechaHasta')}
            value={fechaHasta}
            onChange={(e) => setFechaHasta(e.target.value)}
          />
        </div>
      </div>
    </div>
    </fieldset>
  );
}

interface BloqueJornadaNormalProps {
  campoClase: (base: string, clave: string) => string;
  jornadaInicioManana: string;
  setJornadaInicioManana: Dispatch<SetStateAction<string>>;
  jornadaFinManana: string;
  setJornadaFinManana: Dispatch<SetStateAction<string>>;
  jornadaInicioTarde: string;
  setJornadaInicioTarde: Dispatch<SetStateAction<string>>;
  jornadaFinTarde: string;
  setJornadaFinTarde: Dispatch<SetStateAction<string>>;
  soloLectura: boolean;
}

function BloqueJornadaNormal({
  campoClase,
  jornadaInicioManana,
  setJornadaInicioManana,
  jornadaFinManana,
  setJornadaFinManana,
  jornadaInicioTarde,
  setJornadaInicioTarde,
  jornadaFinTarde,
  setJornadaFinTarde,
  soloLectura,
}: BloqueJornadaNormalProps) {
  return (
    <fieldset disabled={soloLectura} className="contents">
    <div className="border border-panel-600/40 rounded-lg p-3 space-y-2">
      <p className="text-xs font-semibold text-slate-700">Jornada normal (sin horas extra)</p>
      <p className="text-[11px] text-slate-500">
        Se usa para prellenar cada día nuevo y como límite del cálculo: si una marcación es más temprano que la
        jornada no suma de más (ej. entrar antes de las 08:00), pero si es más tarde sí se descuenta — y al revés
        para la salida (salir después no suma de más, salir antes sí se descuenta). Si un día no tiene marcación al
        medio día, escribe solo la entrada de la mañana y la salida de la tarde en esa fila: se calcula directo
        entre esas dos y se descuenta 1 hora de almuerzo.
      </p>
      <div className="grid grid-cols-4 gap-2">
        <div>
          <label className="etiqueta">Entrada</label>
          <input
            type="time" lang="en-GB"
            className={campoClase('campo', 'jornadaInicioManana')}
            value={jornadaInicioManana}
            onChange={(e) => {
              setJornadaInicioManana(e.target.value);
              enfocarSiguienteHora(e);
            }}
          />
        </div>
        <div>
          <label className="etiqueta">Sale</label>
          <input
            type="time" lang="en-GB"
            className={campoClase('campo', 'jornadaFinManana')}
            value={jornadaFinManana}
            onChange={(e) => {
              setJornadaFinManana(e.target.value);
              enfocarSiguienteHora(e);
            }}
          />
        </div>
        <div>
          <label className="etiqueta">Entrada</label>
          <input
            type="time" lang="en-GB"
            className={campoClase('campo', 'jornadaInicioTarde')}
            value={jornadaInicioTarde}
            onChange={(e) => {
              setJornadaInicioTarde(e.target.value);
              enfocarSiguienteHora(e);
            }}
          />
        </div>
        <div>
          <label className="etiqueta">Sale</label>
          <input
            type="time" lang="en-GB"
            className={campoClase('campo', 'jornadaFinTarde')}
            value={jornadaFinTarde}
            onChange={(e) => {
              setJornadaFinTarde(e.target.value);
              enfocarSiguienteHora(e);
            }}
          />
        </div>
      </div>
    </div>
    </fieldset>
  );
}

interface BloqueInformeMemorandoProps {
  campoClase: (base: string, clave: string) => string;
  descripcionDefault: string;
  setDescripcionDefault: Dispatch<SetStateAction<string>>;
  memorandoDefault: string;
  setMemorandoDefault: Dispatch<SetStateAction<string>>;
  observaciones: string;
  setObservaciones: Dispatch<SetStateAction<string>>;
  traerDiasDeCalendario: () => void;
  trayendoDias: boolean;
  mensaje: string | null;
  soloLectura: boolean;
}

function BloqueInformeMemorando({
  campoClase,
  descripcionDefault,
  setDescripcionDefault,
  memorandoDefault,
  setMemorandoDefault,
  observaciones,
  setObservaciones,
  traerDiasDeCalendario,
  trayendoDias,
  mensaje,
  soloLectura,
}: BloqueInformeMemorandoProps) {
  return (
    <fieldset disabled={soloLectura} className="contents">
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="etiqueta">N.º de informe de actividades</label>
          <input
            type="text"
            className={campoClase('campo', 'descripcionDefault')}
            value={descripcionDefault}
            onChange={(e) => setDescripcionDefault(e.target.value)}
          />
        </div>
        <div>
          <label className="etiqueta">N.º de memorando de autorización</label>
          <input
            type="text"
            className={campoClase('campo', 'memorandoDefault')}
            value={memorandoDefault}
            onChange={(e) => setMemorandoDefault(e.target.value)}
          />
        </div>
      </div>

      <button type="button" onClick={traerDiasDeCalendario} disabled={trayendoDias} className="boton-secundario w-full text-sm">
        {trayendoDias ? 'Trayendo…' : '📅 Traer días del calendario de turnos'}
      </button>
      {mensaje && <p className="text-xs text-gauge-danger">{mensaje}</p>}

      <div>
        <label className="etiqueta">Observaciones (opcional)</label>
        <textarea
          className="campo min-h-[72px] resize-y"
          rows={3}
          placeholder="Se escribe a mano si la planilla tiene alguna observación. En el PDF sale debajo de la nota del almuerzo."
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
        />
      </div>
    </div>
    </fieldset>
  );
}

interface BloqueTablaDiasProps {
  filas: FilaEdit[];
  jornada: JornadaReferencia;
  resaltarFaltantes: boolean;
  campoClase: (base: string, clave: string) => string;
  actualizarFila: (id: string, cambios: Partial<FilaEdit>) => void;
  quitarFila: (id: string) => void;
  calcularIgual: (id: string) => void;
  recalcularTodas: () => void;
  agregarFilaManual: () => void;
  erroresOrden: { fecha: string; error: string }[];
  avisosAlmuerzo: { id: string; fecha: string; aviso: NonNullable<ReturnType<typeof avisoAlmuerzoLargo>> }[];
  setAvisosDescartados: Dispatch<SetStateAction<Set<string>>>;
  soloLectura: boolean;
}

function BloqueTablaDias({
  filas,
  jornada,
  resaltarFaltantes,
  campoClase,
  actualizarFila,
  quitarFila,
  calcularIgual,
  recalcularTodas,
  agregarFilaManual,
  erroresOrden,
  avisosAlmuerzo,
  setAvisosDescartados,
  soloLectura,
}: BloqueTablaDiasProps) {
  return (
    <fieldset disabled={soloLectura} className="contents">
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        {filas.length > 0 ? (
          <button
            type="button"
            onClick={recalcularTodas}
            className="text-xs text-gauge-ok hover:underline"
            title="Vuelve a calcular Mañana/Tarde/Extras de todas las filas con la jornada de arriba"
          >
            🔄 Recalcular horas de todas las filas
          </button>
        ) : (
          <span />
        )}
        <button type="button" onClick={agregarFilaManual} className="boton-secundario text-sm px-3 flex-shrink-0">
          + Día
        </button>
      </div>

      {filas.length > 0 && (
        <div className="overflow-x-auto border border-panel-600/40 rounded-lg">
          <table className="w-full text-xs min-w-[820px]">
            <thead>
              <tr className="text-slate-600 text-left">
                <th className="p-1.5">Fecha</th>
                <th className="p-1.5 min-w-[160px]">Descripción</th>
                <th className="p-1.5 min-w-[120px]">N.º memorando</th>
                <th className="p-1.5 w-28">Entrada</th>
                <th className="p-1.5 w-28">Sale</th>
                <th className="p-1.5 w-28">Entrada</th>
                <th className="p-1.5 w-28">Sale</th>
                <th className="p-1.5 w-28">Mañana</th>
                <th className="p-1.5 w-28">Tarde</th>
                <th className="p-1.5 w-28">Extras</th>
                <th className="p-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const tieneManana = !!(f.entrada_manana && f.salida_manana);
                const tieneTarde = !!(f.entrada_tarde && f.salida_tarde);
                const algoManana = !!(f.entrada_manana || f.salida_manana);
                const algoTarde = !!(f.entrada_tarde || f.salida_tarde);
                const pendienteManana = !tieneManana && algoManana && tieneTarde && f.horas_manana === null;
                const pendienteTarde = !tieneTarde && algoTarde && tieneManana && f.horas_tarde === null;
                const pendiente = pendienteManana || pendienteTarde;

                const errorManana = tieneManana && f.salida_manana <= f.entrada_manana;
                const errorTarde = tieneTarde && f.salida_tarde <= f.entrada_tarde;
                const errorCruce = !!(f.salida_manana && f.entrada_tarde && f.entrada_tarde < f.salida_manana);
                const ordenError = errorManana || errorTarde || errorCruce;
                const aviso = avisoAlmuerzoLargo(f, jornada);

                const clase = (error: boolean, falta: boolean, faltante: boolean = false) =>
                  error || faltante
                    ? 'campo text-xs py-1 border-2 border-gauge-danger bg-gauge-danger/10 text-gauge-danger focus:ring-gauge-danger/60'
                    : falta
                    ? 'campo text-xs py-1 border-gauge-warn bg-gauge-warn/10'
                    : 'campo text-xs py-1';

                // Actualiza el campo de hora y, salvo que ese cambio deje la fila con un horario
                // fuera de orden (ver validarOrdenHorario), avanza al siguiente campo. Si queda
                // inválido, el cursor se queda ahí — no se sigue de largo hasta corregirlo.
                const manejarCambioHora = (
                  campo: 'entrada_manana' | 'salida_manana' | 'entrada_tarde' | 'salida_tarde',
                  e: ChangeEvent<HTMLInputElement>,
                ) => {
                  const valor = e.target.value;
                  actualizarFila(f.id, { [campo]: valor });
                  // Siempre se cancela un salto pendiente de una hora anterior, aunque este cambio
                  // no programe uno nuevo — si no, ese salto viejo podía disparar mientras se está
                  // corrigiendo otro campo distinto, dando la sensación de quedar en un bucle.
                  cancelarAvanceHora();
                  if (!validarOrdenHorario({ ...f, [campo]: valor })) enfocarSiguienteHora(e);
                };

                // Si ese campo de hora quedó con un valor inválido, no deja que el foco se vaya a otro campo — ni
                // con Tab ni haciendo click en otro lado — hasta que se corrija. El Tab se corta antes de que
                // llegue a moverse (más confiable); para el clic, que solo se puede atajar después de que ya
                // pasó, se recupera el foco de una y también un instante después, por si el navegador no lo
                // respeta de inmediato.
                const bloquearTabSiError = (error: boolean) => (e: KeyboardEvent<HTMLInputElement>) => {
                  if (error && e.key === 'Tab') e.preventDefault();
                };
                const atraparFoco = (error: boolean) => (e: FocusEvent<HTMLInputElement>) => {
                  if (!error) return;
                  const el = e.currentTarget;
                  el.focus();
                  setTimeout(() => el.focus(), 0);
                };

                return (
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
                        className={campoClase('campo text-xs py-1', `fila-${f.id}-descripcion`)}
                        value={f.descripcion_actividades}
                        onChange={(e) => actualizarFila(f.id, { descripcion_actividades: e.target.value })}
                      />
                    </td>
                    <td className="p-1">
                      <input
                        type="text"
                        className={campoClase('campo text-xs py-1', `fila-${f.id}-memorando`)}
                        value={f.numero_memorando}
                        onChange={(e) => actualizarFila(f.id, { numero_memorando: e.target.value })}
                      />
                    </td>
                    <td className="p-1">
                      <input
                        type="time" lang="en-GB"
                        className={clase(errorManana, false, resaltarFaltantes && !f.entrada_manana)}
                        value={f.entrada_manana}
                        onChange={(e) => manejarCambioHora('entrada_manana', e)}
                        onBlur={atraparFoco(errorManana)}
                        onKeyDown={bloquearTabSiError(errorManana)}
                      />
                    </td>
                    <td className="p-1">
                      <input
                        type="time" lang="en-GB"
                        className={clase(
                          errorManana || errorCruce,
                          (pendienteManana && !f.salida_manana) || !!aviso?.salidaManana,
                          resaltarFaltantes && !f.salida_manana && !pendienteManana,
                        )}
                        value={f.salida_manana}
                        onChange={(e) => manejarCambioHora('salida_manana', e)}
                        onBlur={atraparFoco(errorManana || errorCruce)}
                        onKeyDown={bloquearTabSiError(errorManana || errorCruce)}
                        title={aviso?.salidaManana ? aviso.mensaje : undefined}
                      />
                    </td>
                    <td className="p-1">
                      <input
                        type="time" lang="en-GB"
                        className={clase(
                          errorTarde || errorCruce,
                          (pendienteTarde && !f.entrada_tarde) || !!aviso?.entradaTarde,
                          resaltarFaltantes && !f.entrada_tarde && !pendienteTarde,
                        )}
                        value={f.entrada_tarde}
                        onChange={(e) => manejarCambioHora('entrada_tarde', e)}
                        onBlur={atraparFoco(errorTarde || errorCruce)}
                        onKeyDown={bloquearTabSiError(errorTarde || errorCruce)}
                        title={aviso?.entradaTarde ? aviso.mensaje : undefined}
                      />
                    </td>
                    <td className="p-1">
                      <input
                        type="time" lang="en-GB"
                        className={clase(errorTarde, pendienteTarde && !f.salida_tarde, resaltarFaltantes && !f.salida_tarde)}
                        value={f.salida_tarde}
                        onChange={(e) => manejarCambioHora('salida_tarde', e)}
                        onBlur={atraparFoco(errorTarde)}
                        onKeyDown={bloquearTabSiError(errorTarde)}
                      />
                    </td>
                    <td className="p-1">
                      <InputHoras
                        valor={f.horas_manana}
                        onCommit={(n) => actualizarFila(f.id, { horas_manana: n })}
                        className="campo text-xs py-1"
                      />
                    </td>
                    <td className="p-1">
                      <InputHoras
                        valor={f.horas_tarde}
                        onCommit={(n) => actualizarFila(f.id, { horas_tarde: n })}
                        className="campo text-xs py-1"
                      />
                    </td>
                    <td className="p-1">
                      {pendiente ? (
                        <button
                          type="button"
                          onClick={() => calcularIgual(f.id)}
                          title="Falta una marcación de mediodía — al aceptar se asume la jornada normal completa para ese bloque."
                          className="w-full rounded-lg border border-gauge-warn text-gauge-warn text-[10px] leading-tight font-semibold px-1 py-1.5 hover:bg-gauge-warn/10"
                        >
                          ⚠ Calcular igual
                        </button>
                      ) : (
                        <InputHoras
                          valor={f.horas_extra}
                          onCommit={(n) => actualizarFila(f.id, { horas_extra: n })}
                          className={`campo text-xs py-1 font-semibold ${ordenError ? 'text-gauge-danger border-gauge-danger' : ''}`}
                        />
                      )}
                    </td>
                    <td className="p-1">
                      <button onClick={() => quitarFila(f.id)} className="text-gauge-danger text-xs px-1">
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {erroresOrden.length > 0 && (
        <div className="border border-gauge-danger/50 bg-gauge-danger/10 rounded-lg p-2 space-y-0.5">
          {erroresOrden.map((e, i) => (
            <p key={i} className="text-xs text-gauge-danger">
              ⚠ {formatFechaCorta(e.fecha)}: {e.error}
            </p>
          ))}
        </div>
      )}

      {avisosAlmuerzo.length > 0 && (
        <div className="space-y-1.5">
          {avisosAlmuerzo.map((a) => (
            <div
              key={a.id}
              className="border border-gauge-warn/50 bg-gauge-warn/10 rounded-lg p-2 flex items-start justify-between gap-2"
            >
              <p className="text-xs text-gauge-warn">
                ⚠ {formatFechaCorta(a.fecha)}: {a.aviso.mensaje}
              </p>
              <button
                type="button"
                onClick={() => setAvisosDescartados((prev) => new Set(prev).add(a.id))}
                className="text-gauge-warn text-xs px-1 shrink-0"
                title="Ya lo revisé, ocultar aviso"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
    </fieldset>
  );
}

interface BloqueAccionesProps {
  totalHorasExtra: number;
  configuracion: ConfiguracionPlanillaHorasExtras;
  campoClase: (base: string, clave: string) => string;
  editarRevisado: boolean;
  setEditarRevisado: Dispatch<SetStateAction<boolean>>;
  revisadoNombre: string;
  setRevisadoNombre: Dispatch<SetStateAction<string>>;
  revisadoCargo: string;
  setRevisadoCargo: Dispatch<SetStateAction<string>>;
  editarAprobado: boolean;
  setEditarAprobado: Dispatch<SetStateAction<boolean>>;
  aprobadoNombre: string;
  setAprobadoNombre: Dispatch<SetStateAction<string>>;
  aprobadoCargo: string;
  setAprobadoCargo: Dispatch<SetStateAction<string>>;
  pdfBlob: Blob | null;
  pdfNombre: string;
  compartirPorWhatsApp: () => void;
  compartiendo: boolean;
  avisoCompartirManual: boolean;
  alGuardarClick: () => void;
  guardando: boolean;
  alGenerarPdfClick: () => void;
  generandoPdf: boolean;
  onCerrar: () => void;
  soloLectura: boolean;
  mensaje: string | null;
}

function BloqueAcciones({
  totalHorasExtra,
  configuracion,
  campoClase,
  soloLectura,
  editarRevisado,
  setEditarRevisado,
  revisadoNombre,
  setRevisadoNombre,
  revisadoCargo,
  setRevisadoCargo,
  editarAprobado,
  setEditarAprobado,
  aprobadoNombre,
  setAprobadoNombre,
  aprobadoCargo,
  setAprobadoCargo,
  pdfBlob,
  pdfNombre,
  compartirPorWhatsApp,
  compartiendo,
  avisoCompartirManual,
  alGuardarClick,
  guardando,
  alGenerarPdfClick,
  generandoPdf,
  onCerrar,
  mensaje,
}: BloqueAccionesProps) {
  return (
    <div className="space-y-4">
      <div className="max-w-2xl mx-auto w-full space-y-4">
        <p className="text-sm text-slate-800 text-right font-semibold">Total horas extras: {formatHoras(totalHorasExtra)}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="border border-panel-600/40 rounded-lg p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-700">Revisado por</p>
              {!soloLectura && (
                <button type="button" onClick={() => setEditarRevisado((v) => !v)} className="text-xs text-gauge-ok hover:underline">
                  {editarRevisado ? 'Usar el de siempre' : 'Cambiar'}
                </button>
              )}
            </div>
            {editarRevisado ? (
              <>
                <input type="text" disabled={soloLectura} className={campoClase('campo text-xs', 'revisadoNombre')} placeholder="Nombre" value={revisadoNombre} onChange={(e) => setRevisadoNombre(e.target.value)} />
                <input type="text" disabled={soloLectura} className={campoClase('campo text-xs', 'revisadoCargo')} placeholder="Cargo" value={revisadoCargo} onChange={(e) => setRevisadoCargo(e.target.value)} />
              </>
            ) : (
              <p className="text-xs text-slate-600">
                {configuracion.revisado_nombre}
                <br />
                {configuracion.revisado_cargo}
              </p>
            )}
          </div>
          <div className="border border-panel-600/40 rounded-lg p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-700">Aprobado por</p>
              {!soloLectura && (
                <button type="button" onClick={() => setEditarAprobado((v) => !v)} className="text-xs text-gauge-ok hover:underline">
                  {editarAprobado ? 'Usar el de siempre' : 'Cambiar'}
                </button>
              )}
            </div>
            {editarAprobado ? (
              <>
                <input type="text" disabled={soloLectura} className={campoClase('campo text-xs', 'aprobadoNombre')} placeholder="Nombre" value={aprobadoNombre} onChange={(e) => setAprobadoNombre(e.target.value)} />
                <input type="text" disabled={soloLectura} className={campoClase('campo text-xs', 'aprobadoCargo')} placeholder="Cargo" value={aprobadoCargo} onChange={(e) => setAprobadoCargo(e.target.value)} />
              </>
            ) : (
              <p className="text-xs text-slate-600">
                {configuracion.aprobado_nombre}
                <br />
                {configuracion.aprobado_cargo}
              </p>
            )}
          </div>
        </div>

        {pdfBlob && (
          <button onClick={compartirPorWhatsApp} disabled={compartiendo} className="boton-primario w-full">
            {compartiendo ? 'Abriendo…' : '📤 Compartir por WhatsApp'}
          </button>
        )}
        {avisoCompartirManual && (
          <div className="rounded-lg border-2 border-gauge-warn/40 bg-gauge-warn/10 p-3 space-y-1">
            <p className="text-sm font-bold text-gauge-warn">📥 El PDF ya está en tu carpeta de Descargas</p>
            <p className="text-xs text-slate-700">
              Tu navegador no dejó enviarlo directo — abre WhatsApp y <b>adjúntalo a mano desde Descargas</b>, ya
              tiene el nombre "{pdfNombre}".
            </p>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 bg-panel-800 pb-1">
        {mensaje && (
          <div className="max-w-2xl mx-auto pt-2">
            <p className={`text-xs ${mensaje.startsWith('No se pudo') ? 'text-gauge-danger' : 'text-gauge-warn'}`}>{mensaje}</p>
          </div>
        )}
        <div className="max-w-2xl mx-auto flex gap-2 pt-2">
          {!soloLectura && (
            <button onClick={alGuardarClick} disabled={guardando} className="boton-primario flex-1">
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          )}
          <button onClick={alGenerarPdfClick} disabled={generandoPdf} className="boton-secundario flex-1">
            {generandoPdf ? 'Generando…' : '📄 Generar PDF'}
          </button>
          <button onClick={onCerrar} className="boton-secundario px-4">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
