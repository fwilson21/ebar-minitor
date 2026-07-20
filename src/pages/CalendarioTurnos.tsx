import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { AsignacionEstacion, EstacionEbar, TurnoCalendario, Usuario } from '../lib/types';
import { calcularFeriados, esFeriadoCalculado, esFinDeSemana, nombreFeriadoCalculado } from '../lib/feriadosEcuador';
import {
  descargarBlob,
  generarReporteTurnos,
  type FilaTurnoReporte,
  type ResumenOperadorReporte,
} from '../lib/pdf';
import { registrarFormularioActivo, desregistrarFormularioActivo } from '../lib/formularioActivo';
import { nombreCorto } from '../lib/nombres';

const DIAS_SEMANA_CORTOS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DIAS_SEMANA_ABREV = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/** Horas mensuales de turno a partir de las cuales se avisa al administrador (para control de
 * horas extra/pago). No bloquea nada, solo alerta. */
const LIMITE_HORAS_MES = 60;

/** Máximo de nombres que se listan dentro de una celda del calendario antes de resumir en "+N más". */
const MAX_NOMBRES_EN_CELDA = 3;

/** Orden preferido para listar operadores cuando comparten día (pedido explícito del usuario,
 * no alfabético) — se busca por apellido dentro del nombre completo. Quien no matchee ninguno
 * queda al final, en orden alfabético entre ellos. */
const ORDEN_OPERADORES_PREFERIDO = ['lapo', 'caicedo', 'vega', 'zambrano'];

function indiceOrdenOperador(nombreCompleto: string): number {
  const normalizado = nombreCompleto.toLowerCase();
  const indice = ORDEN_OPERADORES_PREFERIDO.findIndex((clave) => normalizado.includes(clave));
  return indice === -1 ? ORDEN_OPERADORES_PREFERIDO.length : indice;
}

function compararPorOrdenOperador(nombreA: string, nombreB: string): number {
  return indiceOrdenOperador(nombreA) - indiceOrdenOperador(nombreB) || nombreA.localeCompare(nombreB);
}

function formatFechaCorta(fechaIso: string): string {
  const d = new Date(`${fechaIso}T12:00:00`);
  return `${DIAS_SEMANA_CORTOS[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function formatFechaListado(fechaIso: string): string {
  const d = new Date(`${fechaIso}T12:00:00`);
  return `${DIAS_SEMANA_ABREV[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function mesActualISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function sumarMeses(mes: string, delta: number): string {
  const [anio, mesNum] = mes.split('-').map(Number);
  const d = new Date(anio, mesNum - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Celdas del mes para una grilla de 7 columnas (lunes primero): null = relleno fuera de mes. */
function generarCeldasMes(mes: string): (string | null)[] {
  const [anioStr, mesStr] = mes.split('-');
  const anio = Number(anioStr);
  const mesNum = Number(mesStr);
  const primerDia = new Date(anio, mesNum - 1, 1);
  const ultimoDiaNum = new Date(anio, mesNum, 0).getDate();
  const offset = (primerDia.getDay() + 6) % 7; // getDay(): 0=domingo → acá 0=lunes
  const celdas: (string | null)[] = Array(offset).fill(null);
  for (let d = 1; d <= ultimoDiaNum; d++) celdas.push(`${anioStr}-${mesStr}-${String(d).padStart(2, '0')}`);
  while (celdas.length % 7 !== 0) celdas.push(null);
  return celdas;
}

/** null = día regular (no clickeable); si no, el motivo a mostrar (fin de semana o nombre del feriado). */
function motivoDia(fecha: string, feriadosAdicionales: Map<string, string>): string | null {
  if (esFeriadoCalculado(fecha)) return nombreFeriadoCalculado(fecha) ?? 'Feriado';
  if (feriadosAdicionales.has(fecha)) return feriadosAdicionales.get(fecha)!;
  if (esFinDeSemana(fecha)) return 'Fin de semana';
  return null;
}

export function CalendarioTurnos() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'administrador';

  const [mes, setMes] = useState(mesActualISO());
  const [cargandoBase, setCargandoBase] = useState(true);
  const [cargandoMes, setCargandoMes] = useState(false);
  const [operadores, setOperadores] = useState<Usuario[]>([]);
  const [estaciones, setEstaciones] = useState<EstacionEbar[]>([]);
  const [feriadosAdicionales, setFeriadosAdicionales] = useState<{ id: string; fecha: string; descripcion: string }[]>([]);
  const [asignacionesDefault, setAsignacionesDefault] = useState<AsignacionEstacion[]>([]);
  const [turnos, setTurnos] = useState<TurnoCalendario[]>([]);
  const [asignacionesTurno, setAsignacionesTurno] = useState<AsignacionEstacion[]>([]);
  const [diaSeleccionado, setDiaSeleccionado] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [generandoPdf, setGenerandoPdf] = useState(false);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfNombre, setPdfNombre] = useState('');
  const [compartiendo, setCompartiendo] = useState(false);
  const [mensajeCompartir, setMensajeCompartir] = useState<string | null>(null);

  useEffect(() => {
    if (!esAdmin) return;
    async function cargarBase() {
      const [{ data: ops }, { data: est }, { data: feriados }, { data: defaults }] = await Promise.all([
        supabase.from('usuarios').select('*').eq('rol', 'operador').eq('activo', true).order('nombre_completo'),
        supabase.from('estaciones_ebar').select('*').eq('activa', true).order('nombre'),
        supabase.from('feriados_adicionales').select('id, fecha, descripcion').order('fecha'),
        supabase.from('asignaciones_estacion').select('*').is('fecha', null),
      ]);
      setOperadores((ops as Usuario[]) ?? []);
      setEstaciones((est as EstacionEbar[]) ?? []);
      setFeriadosAdicionales((feriados as { id: string; fecha: string; descripcion: string }[]) ?? []);
      setAsignacionesDefault((defaults as AsignacionEstacion[]) ?? []);
      setCargandoBase(false);
    }
    cargarBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esAdmin]);

  // Feriado decretado de último momento (no calculable de antemano ni ya cargado como fin de
  // semana/feriado fijo): lo agrega el propio administrador desde el panel del día. Reutiliza la
  // misma tabla que ya usa /asignaciones para esto, así el resto de la app (mínimo de visitas del
  // Dashboard, etc.) lo trata como no regular en todos lados, no solo en este calendario.
  async function declararFeriado(fecha: string, descripcion: string) {
    const { data, error } = await supabase
      .from('feriados_adicionales')
      .insert({ fecha, descripcion, creado_por: usuario!.id })
      .select('id, fecha, descripcion')
      .single();
    if (error) throw error;
    setFeriadosAdicionales((prev) =>
      [...prev, data as { id: string; fecha: string; descripcion: string }].sort((a, b) => a.fecha.localeCompare(b.fecha)),
    );
  }

  async function quitarFeriado(id: string) {
    const { error } = await supabase.from('feriados_adicionales').delete().eq('id', id);
    if (!error) setFeriadosAdicionales((prev) => prev.filter((f) => f.id !== id));
  }

  async function cargarMes(m: string) {
    setCargandoMes(true);
    const [anio, mesNum] = m.split('-').map(Number);
    const inicio = `${m}-01`;
    const fin = new Date(anio, mesNum, 0).toISOString().slice(0, 10);
    const [{ data: turnosData }, { data: asigData }] = await Promise.all([
      supabase.from('turnos_calendario').select('*').gte('fecha', inicio).lte('fecha', fin),
      supabase.from('asignaciones_estacion').select('*').not('turno_id', 'is', null).gte('fecha', inicio).lte('fecha', fin),
    ]);
    setTurnos((turnosData as TurnoCalendario[]) ?? []);
    setAsignacionesTurno((asigData as AsignacionEstacion[]) ?? []);
    setPdfBlob(null);
    setMensajeCompartir(null);
    setCargandoMes(false);
  }

  useEffect(() => {
    if (!esAdmin) return;
    cargarMes(mes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes, esAdmin]);

  const feriadosAdicionalesMap = useMemo(
    () => new Map(feriadosAdicionales.map((f) => [f.fecha, f.descripcion])),
    [feriadosAdicionales],
  );

  const asignacionesDefaultPorOperador = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const a of asignacionesDefault) {
      if (!m.has(a.operador_id)) m.set(a.operador_id, new Set());
      m.get(a.operador_id)!.add(a.estacion_id);
    }
    return m;
  }, [asignacionesDefault]);

  function nombreOperadorPorId(id: string): string {
    return operadores.find((o) => o.id === id)?.nombre_completo ?? '—';
  }

  const turnosPorFecha = useMemo(() => {
    const m = new Map<string, TurnoCalendario[]>();
    for (const t of turnos) {
      if (!m.has(t.fecha)) m.set(t.fecha, []);
      m.get(t.fecha)!.push(t);
    }
    for (const lista of m.values()) {
      lista.sort((a, b) => compararPorOrdenOperador(nombreOperadorPorId(a.operador_id), nombreOperadorPorId(b.operador_id)));
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnos, operadores]);

  const asignacionesPorTurno = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const a of asignacionesTurno) {
      if (!a.turno_id) continue;
      if (!m.has(a.turno_id)) m.set(a.turno_id, new Set());
      m.get(a.turno_id)!.add(a.estacion_id);
    }
    return m;
  }, [asignacionesTurno]);

  const resumenMes = useMemo(() => {
    const conteo = new Map<string, number>();
    for (const t of turnos) conteo.set(t.operador_id, (conteo.get(t.operador_id) ?? 0) + 1);
    return [...conteo.entries()]
      .map(([operadorId, dias]) => {
        const horas = dias * 8;
        return {
          operadorId,
          nombre: operadores.find((o) => o.id === operadorId)?.nombre_completo ?? '—',
          dias,
          horas,
          sobrepasaLimite: horas > LIMITE_HORAS_MES,
        };
      })
      .sort((a, b) => compararPorOrdenOperador(a.nombre, b.nombre));
  }, [turnos, operadores]);

  const algunoSobrepasaLimite = resumenMes.some((r) => r.sobrepasaLimite);

  const turnosOrdenados = useMemo(
    () => [...turnosPorFecha.entries()].sort(([a], [b]) => a.localeCompare(b)),
    [turnosPorFecha],
  );

  const celdas = useMemo(() => generarCeldasMes(mes), [mes]);
  const tituloMesLabel = new Date(`${mes}-01T12:00:00`).toLocaleDateString('es-EC', { month: 'long', year: 'numeric' });
  const anioVisible = Number(mes.slice(0, 4));

  async function manejarGenerarPdf() {
    setGenerandoPdf(true);
    setMensaje(null);
    try {
      const filas: FilaTurnoReporte[] = [...turnosPorFecha.entries()].map(([fecha, lista]) => ({
        fecha,
        motivo: motivoDia(fecha, feriadosAdicionalesMap) ?? 'Fin de semana',
        operadores: lista.map((t) => nombreOperadorPorId(t.operador_id)),
      }));
      const resumen: ResumenOperadorReporte[] = resumenMes.map((r) => ({ nombre: r.nombre, dias: r.dias }));
      const blob = await generarReporteTurnos(tituloMesLabel, filas, resumen, {
        nombre: usuario!.nombre_completo,
        firmaUrl: usuario!.firma_url,
      });
      const nombre = `calendario_turnos_${mes}.pdf`;
      setPdfBlob(blob);
      setPdfNombre(nombre);
      descargarBlob(blob, nombre);
    } catch (err: any) {
      setMensaje(`No se pudo generar el PDF: ${err.message ?? err}`);
    } finally {
      setGenerandoPdf(false);
    }
  }

  // Mismo mecanismo que "Descargar y compartir" en Reportes: comparte el PDF con el selector
  // nativo del celular (el admin elige WhatsApp ahí). No usa la función send-whatsapp — la API
  // oficial de WhatsApp de Meta no manda a grupos normales y se descartó configurarla (2026-07-09).
  async function manejarCompartir() {
    if (!pdfBlob) return;
    setCompartiendo(true);
    setMensajeCompartir(null);
    try {
      const archivo = new File([pdfBlob], pdfNombre, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
        await navigator.share({ files: [archivo], title: 'Calendario de turnos', text: tituloMesLabel });
        setMensajeCompartir('Compartido.');
      } else {
        descargarBlob(pdfBlob, pdfNombre);
        setMensajeCompartir('Tu navegador no soporta compartir directo. El PDF se descargó — compártelo manualmente por WhatsApp.');
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') setMensajeCompartir(`No se pudo compartir: ${err.message ?? err}`);
    } finally {
      setCompartiendo(false);
    }
  }

  if (!usuario) return null;

  if (usuario.rol !== 'administrador') {
    return (
      <div className="tarjeta p-4">
        <p className="text-sm text-slate-400">Esta pantalla es exclusiva del administrador.</p>
      </div>
    );
  }

  if (cargandoBase) return <p className="text-slate-400">Cargando…</p>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">Calendario de turnos</h1>
        <p className="text-sm text-slate-400">
          Marca qué operador está de turno cada sábado, domingo o feriado. Ese día le van a aparecer automáticamente
          sus EBAR a atender.
        </p>
      </div>

      <div className="tarjeta p-4 space-y-3">
        <div className="flex items-center justify-between">
          <button onClick={() => setMes((m) => sumarMeses(m, -1))} className="boton-secundario px-3 py-1.5 text-sm">
            ‹
          </button>
          <p className="font-semibold text-sm capitalize">{tituloMesLabel}</p>
          <button onClick={() => setMes((m) => sumarMeses(m, 1))} className="boton-secundario px-3 py-1.5 text-sm">
            ›
          </button>
        </div>

        {cargandoMes ? (
          <p className="text-slate-400 text-sm">Cargando…</p>
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1 text-center">
              {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
                <div key={d} className="text-xs text-slate-300 font-semibold py-1">
                  {d}
                </div>
              ))}
              {celdas.map((fecha, i) => {
                if (!fecha) return <div key={i} />;
                const motivo = motivoDia(fecha, feriadosAdicionalesMap);
                const turnosDia = turnosPorFecha.get(fecha) ?? [];
                const esFeriado = motivo !== null && motivo !== 'Fin de semana';
                return (
                  <button
                    key={fecha}
                    type="button"
                    onClick={() => setDiaSeleccionado(fecha)}
                    className={`min-h-[3.75rem] rounded-lg border text-sm font-medium flex flex-col items-center pt-1 pb-1 gap-0.5 transition overflow-hidden ${
                      esFeriado
                        ? 'border-gauge-warn bg-gauge-warn/20 text-gauge-warn hover:bg-gauge-warn/30'
                        : motivo === 'Fin de semana'
                          ? 'border-panel-500 bg-panel-700 text-slate-100 hover:bg-panel-600'
                          : 'border-panel-600/60 bg-panel-700/40 text-slate-300 hover:bg-panel-700 hover:text-slate-100'
                    } ${turnosDia.length > 0 ? 'ring-2 ring-gauge-ok' : ''}`}
                  >
                    <span>{Number(fecha.slice(-2))}</span>
                    {turnosDia.length > 0 && (
                      <div className="flex flex-col items-center leading-tight w-full px-0.5">
                        {turnosDia.slice(0, MAX_NOMBRES_EN_CELDA).map((t) => (
                          <span key={t.id} className="text-[8.5px] font-bold text-gauge-ok truncate max-w-full">
                            {nombreCorto(nombreOperadorPorId(t.operador_id))}
                          </span>
                        ))}
                        {turnosDia.length > MAX_NOMBRES_EN_CELDA && (
                          <span className="text-[8.5px] font-bold text-gauge-ok">
                            +{turnosDia.length - MAX_NOMBRES_EN_CELDA} más
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300 pt-1">
              <span>
                <span className="inline-block w-3 h-3 rounded bg-panel-700 border border-panel-500 align-middle mr-1" />
                Fin de semana
              </span>
              <span>
                <span className="inline-block w-3 h-3 rounded bg-gauge-warn/20 border border-gauge-warn align-middle mr-1" />
                Feriado
              </span>
              <span>
                <span className="inline-block w-3 h-3 rounded ring-2 ring-gauge-ok align-middle mr-1" />
                Con turno asignado (nombre del operador)
              </span>
              <span>
                <span className="inline-block w-3 h-3 rounded bg-panel-700/40 border border-panel-600/60 align-middle mr-1" />
                Regular (tocar para declarar feriado)
              </span>
            </div>
          </>
        )}
      </div>

      <div className="tarjeta p-4 space-y-2">
        <h2 className="text-base font-semibold">Turnos de este mes</h2>
        {turnosOrdenados.length === 0 ? (
          <p className="text-sm text-slate-400">Todavía no hay turnos cargados este mes.</p>
        ) : (
          <div className="divide-y divide-panel-600/40">
            {turnosOrdenados.map(([fecha, lista]) => (
              <button
                key={fecha}
                onClick={() => setDiaSeleccionado(fecha)}
                className="w-full text-left hover:bg-panel-700/40 rounded px-1.5 py-2 -mx-1.5"
              >
                <p className="text-xs text-slate-400 mb-1">{formatFechaListado(fecha)}</p>
                <div className="space-y-0.5">
                  {lista.map((t) => (
                    <p key={t.id} className="text-sm text-slate-100">
                      {nombreOperadorPorId(t.operador_id)}
                    </p>
                  ))}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="tarjeta p-4 space-y-2">
        <h2 className="text-base font-semibold">Resumen del mes</h2>
        {algunoSobrepasaLimite && (
          <p className="text-sm text-gauge-danger bg-gauge-danger/10 border border-gauge-danger/40 rounded-lg px-3 py-2">
            ⚠ {resumenMes.filter((r) => r.sobrepasaLimite).length === 1 ? 'Un operador supera' : 'Algunos operadores superan'} las{' '}
            {LIMITE_HORAS_MES} horas este mes.
          </p>
        )}
        {resumenMes.length === 0 ? (
          <p className="text-sm text-slate-400">Todavía no hay turnos cargados este mes.</p>
        ) : (
          <div className="space-y-1">
            {resumenMes.map((r) => (
              <div
                key={r.operadorId}
                className={`flex items-center justify-between text-sm gap-2 ${r.sobrepasaLimite ? 'text-gauge-danger' : ''}`}
              >
                <span className={r.sobrepasaLimite ? 'font-semibold' : 'text-slate-200'}>
                  {r.sobrepasaLimite ? '⚠ ' : ''}
                  {r.nombre}
                </span>
                <span className={r.sobrepasaLimite ? 'font-semibold' : 'text-slate-300'}>
                  {r.dias} x 8 = {r.horas} horas
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="tarjeta p-4 space-y-3">
        <h2 className="text-base font-semibold">Exportar</h2>
        {mensaje && <p className="text-sm text-gauge-danger">{mensaje}</p>}
        <button onClick={manejarGenerarPdf} disabled={generandoPdf} className="boton-primario w-full">
          {generandoPdf ? 'Generando…' : '📄 Generar PDF del mes'}
        </button>

        {pdfBlob && (
          <div className="space-y-2 pt-2 border-t border-panel-600/40">
            <button onClick={manejarCompartir} disabled={compartiendo} className="boton-primario w-full">
              {compartiendo ? 'Abriendo…' : '📤 Compartir por WhatsApp'}
            </button>
            {mensajeCompartir && (
              <p className={`text-xs ${mensajeCompartir.startsWith('No se pudo') ? 'text-gauge-danger' : 'text-gauge-ok'}`}>
                {mensajeCompartir}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="tarjeta p-4 space-y-3">
        <div>
          <h2 className="text-base font-semibold">Feriados</h2>
          <p className="text-xs text-slate-500">
            Referencia: el calendario nacional de Ecuador y los locales (cantonización de Francisco de Orellana 30
            de abril, provincialización de Orellana 30 de julio) se calculan solos. Los feriados de última hora se
            declaran tocando el día en el calendario de arriba.
          </p>
        </div>

        <div>
          <p className="text-xs text-slate-400 mb-1">Feriados calculados para {anioVisible}:</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-300">
            {[...calcularFeriados(anioVisible).entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([fecha, nombres]) => (
                <span key={fecha}>
                  {fecha} — {nombres.join(' + ')}
                </span>
              ))}
          </div>
        </div>

        {feriadosAdicionales.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-panel-600/40">
            <p className="text-xs text-slate-400">Feriados de última hora ya declarados:</p>
            {feriadosAdicionales.map((f) => (
              <div key={f.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-300">
                  {f.fecha} · {f.descripcion}
                </span>
                <button onClick={() => quitarFeriado(f.id)} className="text-gauge-danger hover:underline text-xs">
                  Quitar
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {diaSeleccionado && (
        <PanelDia
          fecha={diaSeleccionado}
          motivo={motivoDia(diaSeleccionado, feriadosAdicionalesMap)}
          operadores={operadores}
          estaciones={estaciones}
          asignacionesDefaultPorOperador={asignacionesDefaultPorOperador}
          turnosDia={turnosPorFecha.get(diaSeleccionado) ?? []}
          asignacionesPorTurno={asignacionesPorTurno}
          usuarioId={usuario.id}
          onCerrar={() => setDiaSeleccionado(null)}
          onGuardado={() => cargarMes(mes)}
          onDeclararFeriado={declararFeriado}
        />
      )}
    </div>
  );
}

interface PanelDiaProps {
  fecha: string;
  /** null = día regular, ni fin de semana ni feriado (todavía) — se puede declarar feriado acá mismo. */
  motivo: string | null;
  operadores: Usuario[];
  estaciones: EstacionEbar[];
  asignacionesDefaultPorOperador: Map<string, Set<string>>;
  turnosDia: TurnoCalendario[];
  asignacionesPorTurno: Map<string, Set<string>>;
  usuarioId: string;
  onCerrar: () => void;
  onGuardado: () => Promise<void>;
  onDeclararFeriado: (fecha: string, descripcion: string) => Promise<void>;
}

function PanelDia({
  fecha,
  motivo,
  operadores,
  estaciones,
  asignacionesDefaultPorOperador,
  turnosDia,
  asignacionesPorTurno,
  usuarioId,
  onCerrar,
  onGuardado,
  onDeclararFeriado,
}: PanelDiaProps) {
  const [motivoActual, setMotivoActual] = useState(motivo);
  const [descripcionFeriado, setDescripcionFeriado] = useState('');
  const [declarando, setDeclarando] = useState(false);
  const [mensajeFeriado, setMensajeFeriado] = useState<string | null>(null);

  async function manejarDeclararFeriado() {
    if (!descripcionFeriado.trim()) {
      setMensajeFeriado('Escribe un motivo (ej: "Feriado decretado por el Gobierno").');
      return;
    }
    setDeclarando(true);
    setMensajeFeriado(null);
    try {
      await onDeclararFeriado(fecha, descripcionFeriado.trim());
      setMotivoActual(descripcionFeriado.trim());
      setDescripcionFeriado('');
    } catch (err: any) {
      setMensajeFeriado(`No se pudo declarar: ${err.message ?? err}`);
    } finally {
      setDeclarando(false);
    }
  }

  const estadoInicial = useMemo(() => {
    const m = new Map<string, { turnoId: string; estaciones: Set<string> }>();
    for (const t of turnosDia) {
      m.set(t.operador_id, { turnoId: t.id, estaciones: new Set(asignacionesPorTurno.get(t.id) ?? []) });
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnosDia, asignacionesPorTurno]);

  const [seleccion, setSeleccion] = useState<Map<string, { turnoId: string | null; estaciones: Set<string> }>>(
    () => new Map([...estadoInicial].map(([id, d]) => [id, { turnoId: d.turnoId, estaciones: new Set(d.estaciones) }])),
  );
  const [operadorParaAgregar, setOperadorParaAgregar] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  function nombreOperador(id: string) {
    return operadores.find((o) => o.id === id)?.nombre_completo ?? '—';
  }

  function agregarOperador(id: string) {
    if (!id) return;
    setSeleccion((prev) => {
      const copia = new Map(prev);
      copia.set(id, { turnoId: null, estaciones: new Set(asignacionesDefaultPorOperador.get(id) ?? []) });
      return copia;
    });
    setOperadorParaAgregar('');
  }

  function quitarOperador(id: string) {
    setSeleccion((prev) => {
      const copia = new Map(prev);
      copia.delete(id);
      return copia;
    });
  }

  function toggleEstacion(operadorId: string, estacionId: string) {
    setSeleccion((prev) => {
      const actual = prev.get(operadorId);
      if (!actual) return prev;
      const nuevas = new Set(actual.estaciones);
      if (nuevas.has(estacionId)) nuevas.delete(estacionId);
      else nuevas.add(estacionId);
      const copia = new Map(prev);
      copia.set(operadorId, { ...actual, estaciones: nuevas });
      return copia;
    });
  }

  async function manejarGuardar() {
    for (const [operadorId, datos] of seleccion) {
      if (datos.estaciones.size === 0) {
        setMensaje(`${nombreOperador(operadorId)} no tiene ninguna EBAR seleccionada: agrega al menos una o quítalo con "Quitar".`);
        return;
      }
    }
    setGuardando(true);
    setMensaje(null);
    try {
      const quitados = [...estadoInicial.keys()].filter((id) => !seleccion.has(id));
      for (const operadorId of quitados) {
        const turnoId = estadoInicial.get(operadorId)!.turnoId;
        const { error } = await supabase.from('turnos_calendario').delete().eq('id', turnoId);
        if (error) throw error;
      }

      for (const [operadorId, datos] of seleccion) {
        if (datos.turnoId === null) {
          const { data: turnoNuevo, error: errorTurno } = await supabase
            .from('turnos_calendario')
            .insert({ operador_id: operadorId, fecha, creado_por: usuarioId })
            .select('id')
            .single();
          if (errorTurno) throw errorTurno;
          const filas = [...datos.estaciones].map((estacionId) => ({
            operador_id: operadorId,
            estacion_id: estacionId,
            fecha,
            turno_id: turnoNuevo!.id,
            creado_por: usuarioId,
          }));
          const { error: errorAsig } = await supabase.from('asignaciones_estacion').insert(filas);
          if (errorAsig) throw errorAsig;
        } else {
          const original = estadoInicial.get(operadorId)?.estaciones ?? new Set<string>();
          const agregar = [...datos.estaciones].filter((id) => !original.has(id));
          const quitar = [...original].filter((id) => !datos.estaciones.has(id));
          if (agregar.length) {
            const { error } = await supabase.from('asignaciones_estacion').insert(
              agregar.map((estacionId) => ({
                operador_id: operadorId,
                estacion_id: estacionId,
                fecha,
                turno_id: datos.turnoId,
                creado_por: usuarioId,
              })),
            );
            if (error) throw error;
          }
          if (quitar.length) {
            const { error } = await supabase
              .from('asignaciones_estacion')
              .delete()
              .eq('turno_id', datos.turnoId)
              .in('estacion_id', quitar);
            if (error) throw error;
          }
        }
      }

      await onGuardado();
      onCerrar();
    } catch (err: any) {
      setMensaje(`No se pudo guardar: ${err.message ?? err}`);
    } finally {
      setGuardando(false);
    }
  }

  // Avisa al header ("Salir") si hay operadores/estaciones agregados o quitados en este panel sin
  // guardar todavía — mismo mecanismo que usa Asignaciones.tsx.
  useEffect(() => {
    function serializar(m: Map<string, { estaciones: Set<string> }>) {
      return [...m.entries()]
        .map(([id, d]) => `${id}:${[...d.estaciones].sort().join(',')}`)
        .sort()
        .join('|');
    }
    const inicialComparable = new Map([...estadoInicial].map(([id, d]) => [id, { estaciones: d.estaciones }]));
    const hayCambios = serializar(seleccion) !== serializar(inicialComparable);
    registrarFormularioActivo({ hayCambios, guardar: manejarGuardar });
    return () => desregistrarFormularioActivo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccion]);

  const operadoresDisponibles = operadores.filter((o) => !seleccion.has(o.id));

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-20" onClick={() => !guardando && onCerrar()} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-panel-800 border border-panel-600/60 rounded-xl shadow-xl w-[92vw] max-w-md max-h-[85vh] overflow-y-auto p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-sm text-slate-100">{formatFechaCorta(fecha)}</h2>
            <p className={`text-xs ${motivoActual ? 'text-gauge-warn' : 'text-slate-400'}`}>
              {motivoActual ?? 'Día regular'}
            </p>
          </div>
          <button onClick={() => !guardando && onCerrar()} className="text-slate-400 hover:text-slate-100 text-lg leading-none">
            ✕
          </button>
        </div>

        {motivoActual === null && (
          <div className="border border-gauge-warn/40 bg-gauge-warn/10 rounded-lg p-3 space-y-2">
            <p className="text-xs text-slate-200">
              Este día es regular. Si de última hora lo decretaron feriado, declaralo acá para que cuente las horas
              y le aparezcan las EBAR a quien quede de turno:
            </p>
            <input
              type="text"
              className="campo"
              placeholder='Ej: "Feriado decretado por el Gobierno"'
              value={descripcionFeriado}
              onChange={(e) => setDescripcionFeriado(e.target.value)}
            />
            <button
              type="button"
              onClick={manejarDeclararFeriado}
              disabled={declarando}
              className="boton-secundario w-full text-sm border-gauge-warn/50 text-gauge-warn"
            >
              {declarando ? 'Declarando…' : '📌 Declarar este día feriado'}
            </button>
            {mensajeFeriado && <p className="text-xs text-gauge-danger">{mensajeFeriado}</p>}
          </div>
        )}

        {seleccion.size === 0 && <p className="text-sm text-slate-400">Nadie está de turno este día todavía.</p>}

        <div className="space-y-3">
          {[...seleccion.entries()].map(([operadorId, datos]) => (
            <div key={operadorId} className="border border-panel-600/40 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-100">{nombreOperador(operadorId)}</p>
                <button onClick={() => quitarOperador(operadorId)} className="text-xs text-gauge-danger hover:underline">
                  Quitar
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {estaciones.map((e) => {
                  const activo = datos.estaciones.has(e.id);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => toggleEstacion(operadorId, e.id)}
                      className={`text-xs px-2.5 py-1 rounded-full border ${
                        activo ? 'bg-gauge-ok/15 border-gauge-ok text-gauge-ok' : 'border-panel-600 text-slate-400'
                      }`}
                    >
                      {e.codigo}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {operadoresDisponibles.length > 0 && (
          <div>
            <label className="etiqueta">Agregar operador a este día</label>
            <select className="campo" value={operadorParaAgregar} onChange={(e) => agregarOperador(e.target.value)}>
              <option value="">Selecciona un operador…</option>
              {operadoresDisponibles.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nombre_completo}
                </option>
              ))}
            </select>
          </div>
        )}

        {mensaje && <p className="text-xs text-gauge-danger">{mensaje}</p>}

        <button onClick={manejarGuardar} disabled={guardando} className="boton-primario w-full">
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </>
  );
}
