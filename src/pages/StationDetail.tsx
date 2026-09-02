import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { suscribirseCambios } from '../lib/realtime';
import { useAuth } from '../contexts/AuthContext';
import type { Bomba, EstacionEbar } from '../lib/types';
import { direccionOParroquia } from '../lib/agruparEstaciones';
import { EstadoBadge } from '../components/EstadoBadge';
import { VOLTAJE_MAX, VOLTAJE_MIN } from '../lib/types';
import { abrirBlob, descargarBlob, generarReporteVisitas } from '../lib/pdf';
import { incrustarFotosVisitas } from '../lib/fotos';
import { obtenerVisitasPorEstacion } from '../lib/visitasReporte';
import { CLAVE_CACHE_ESTACIONES, leerCacheLocal } from '../lib/cacheLocal';
import { hoyLocal } from '../lib/fecha';
import { BarraDistribucion } from '../components/BarraDistribucion';
import { useEditorDistribucion } from '../hooks/useEditorDistribucion';

const VISITAS_EN_PDF = 30;

// La gestión de bombas (solo administrador) no funciona sin conexión — a diferencia de registrar
// una visita, no hay ninguna cola offline para esto (es una acción puntual, no algo que un
// administrador necesite hacer en el sitio sin señal). Sin conexión, supabase-js devuelve el
// error crudo de fetch ("TypeError: Failed to fetch"); esto lo traduce a un mensaje claro.
function mensajeErrorBombas(error: { message?: string }): string {
  if (!navigator.onLine || error.message?.includes('Failed to fetch')) {
    return 'no tienes conexión a internet. Esta acción necesita señal.';
  }
  return error.message ?? 'error desconocido';
}

interface EquipoHistorial {
  estado: string;
  observaciones?: string | null;
  numeros_afectados?: number[] | null;
  tiene?: boolean | null;
}

interface HistorialItem {
  id: string;
  fecha_hora_llegada: string;
  fecha_hora_salida?: string | null;
  estado_estacion: string;
  nivel_tanque: string;
  operador: string;
  operador_id: string;
  ubicacion_no_confirmada?: boolean;
  bombas: { numero_bomba: number; estado: string; voltaje: number | null; amperaje: number | null; voltaje_fuera_rango: boolean }[];
  fotos_count: number;
  cerramiento_observaciones?: string | null;
  jardineras_observaciones?: string | null;
  patios_maniobras_observaciones?: string | null;
  lineas_impulsion?: EquipoHistorial | null;
  guias_izado?: EquipoHistorial | null;
  valvulas_compuerta?: EquipoHistorial | null;
  valvulas_check?: EquipoHistorial | null;
  valvula_aire?: EquipoHistorial | null;
  camara_rejilla?: EquipoHistorial | null;
  camara_valvula_compuerta?: EquipoHistorial | null;
  tablero_distribucion?: EquipoHistorial | null;
  variador?: EquipoHistorial | null;
  descarga_emergencia?: EquipoHistorial | null;
  tuberia_400_valvulas_aire?: EquipoHistorial | null;
  tuberia_400_uniones_elastomericas?: EquipoHistorial | null;
  tuberia_600_valvulas_aire?: EquipoHistorial | null;
  tuberia_600_uniones_elastomericas?: EquipoHistorial | null;
}

const EQUIPOS_LABELS: { clave: keyof HistorialItem; label: string }[] = [
  { clave: 'lineas_impulsion', label: 'Líneas impulsión' },
  { clave: 'guias_izado', label: 'Guías izado' },
  { clave: 'valvulas_compuerta', label: 'Válv. compuerta' },
  { clave: 'valvulas_check', label: 'Válv. check' },
  { clave: 'valvula_aire', label: 'Válv. aire' },
  { clave: 'camara_rejilla', label: 'Cámara: Rejilla' },
  { clave: 'camara_valvula_compuerta', label: 'Cámara: Compuerta' },
  { clave: 'tablero_distribucion', label: 'Tablero' },
  { clave: 'variador', label: 'Variador' },
  { clave: 'tuberia_400_valvulas_aire', label: 'Tub.400 V.aire' },
  { clave: 'tuberia_400_uniones_elastomericas', label: 'Tub.400 Uniones' },
  { clave: 'tuberia_600_valvulas_aire', label: 'Tub.600 V.aire' },
  { clave: 'tuberia_600_uniones_elastomericas', label: 'Tub.600 Uniones' },
];

// Visitas más cortas que esto se resaltan en el historial (no se bloquea nada, es solo para que
// el supervisor note "visitas relámpago" de un vistazo).
const VISITA_CORTA_MINUTOS = 3;

function duracionVisita(llegada: string, salida?: string | null): { texto: string; corta: boolean } | null {
  if (!salida) return null;
  const minutos = Math.round((new Date(salida).getTime() - new Date(llegada).getTime()) / 60000);
  if (minutos < 0) return null;
  const texto = minutos < 60 ? `${minutos} min` : `${Math.floor(minutos / 60)}h ${String(minutos % 60).padStart(2, '0')}min`;
  return { texto, corta: minutos < VISITA_CORTA_MINUTOS };
}

/** Agrupa el historial (ya filtrado) por operador, ordenado alfabéticamente por nombre — dentro
 * de cada grupo se conserva el orden de `historial` (más reciente primero). */
function agruparPorOperador(historial: HistorialItem[]): { operador: string; visitas: HistorialItem[] }[] {
  const mapa = new Map<string, HistorialItem[]>();
  for (const h of historial) {
    const lista = mapa.get(h.operador);
    if (lista) lista.push(h);
    else mapa.set(h.operador, [h]);
  }
  return [...mapa.entries()]
    .map(([operador, visitas]) => ({ operador, visitas }))
    .sort((a, b) => a.operador.localeCompare(b.operador));
}

export function StationDetail() {
  const { id } = useParams<{ id: string }>();
  const { usuario, tienePermiso, soloLectura } = useAuth();
  const puedeEditarTodo = usuario?.rol === 'administrador' || usuario?.rol === 'supervisor';
  const esAdmin = usuario?.rol === 'administrador';
  // Delegable por permiso (ver /permisos) además del administrador real — antes era esAdmin a secas.
  // En "modo consulta" (operador desde una computadora) no se gestiona nada, solo se mira.
  const puedeGestionarBombas = !soloLectura && (esAdmin || tienePermiso('gestionar_bombas'));
  // "Editar distribución" acá es solo el control de ancho de esta pantalla (sinBloques en
  // BarraDistribucion, mismo patrón que VisitForm.tsx) — no una grilla de bloques movibles.
  const puedeEditarDistribucion = esAdmin || tienePermiso('editar_distribucion');
  const editorDistribucion = useEditorDistribucion('estacion_detalle');
  const [estacion, setEstacion] = useState<EstacionEbar | null>(null);
  const [historial, setHistorial] = useState<HistorialItem[]>([]);
  const [cargando, setCargando] = useState(true);
  // Por defecto, el historial arranca mostrando solo las visitas de HOY (antes se veían mezcladas
  // las de todos los días de una vez, hasta 30 visitas atrás). El filtro de mes arranca en el mes
  // actual (antes vacío) y el rango de fechas arranca en hoy-hoy; el usuario amplía cualquiera de
  // los dos para ver otros días. "Ver todo el historial" (más abajo) limpia los 4 filtros.
  const [filtroMes, setFiltroMes] = useState(() => hoyLocal().slice(0, 7));
  const [filtroDesde, setFiltroDesde] = useState(hoyLocal);
  const [filtroHasta, setFiltroHasta] = useState(hoyLocal);
  const [filtroOperador, setFiltroOperador] = useState('');
  const [exportando, setExportando] = useState(false);
  const [mensajeExport, setMensajeExport] = useState<string | null>(null);
  const [bombasAdmin, setBombasAdmin] = useState<Bomba[]>([]);
  const [mensajeBombas, setMensajeBombas] = useState<string | null>(null);
  const [guardandoBomba, setGuardandoBomba] = useState(false);

  useEffect(() => {
    if (!id) return;
    async function cargar() {
      const [{ data: est }, { data: hist }] = await Promise.all([
        supabase.from('estaciones_ebar').select('*').eq('id', id).single(),
        supabase.rpc('rpc_historial_estacion', { p_estacion_id: id, p_limite: 30 }),
      ]);
      // Sin conexión: usar la copia de esta estación guardada la última vez que se cargó
      // la lista de Estaciones (ver Stations.tsx), para poder llegar igual a "Nueva visita".
      const estacionFinal = est ?? leerCacheLocal<EstacionEbar[]>(CLAVE_CACHE_ESTACIONES)?.find((e) => e.id === id) ?? null;
      setEstacion(estacionFinal as EstacionEbar | null);
      setHistorial((hist as HistorialItem[]) ?? []);
      setCargando(false);
    }

    cargar();

    const detener = suscribirseCambios({
      channelName: `station-detail-${id}`,
      table: 'visitas',
      callback: cargar,
      filter: `estacion_id=eq.${id}`,
    });

    return () => detener();
  }, [id]);

  async function cargarBombasAdmin() {
    if (!id) return;
    const { data } = await supabase.from('bombas').select('*').eq('estacion_id', id).order('numero_bomba');
    setBombasAdmin((data as Bomba[]) ?? []);
  }

  useEffect(() => {
    if (!puedeGestionarBombas) return;
    cargarBombasAdmin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, puedeGestionarBombas]);

  /** Mantiene estaciones_ebar.numero_bombas (solo informativo, se muestra en la lista de estaciones) al día. */
  async function sincronizarConteoBombas(lista: Bomba[]) {
    if (!id) return;
    const activas = lista.filter((b) => b.activa).length;
    await supabase.from('estaciones_ebar').update({ numero_bombas: activas }).eq('id', id);
    setEstacion((prev) => (prev ? { ...prev, numero_bombas: activas } : prev));
  }

  async function agregarBomba(numero: number) {
    if (!id) return;
    setGuardandoBomba(true);
    setMensajeBombas(null);
    const { error } = await supabase.from('bombas').insert({ estacion_id: id, numero_bomba: numero });
    if (error) {
      setMensajeBombas(`No se pudo agregar la bomba: ${mensajeErrorBombas(error)}`);
    } else {
      const { data } = await supabase.from('bombas').select('*').eq('estacion_id', id).order('numero_bomba');
      const lista = (data as Bomba[]) ?? [];
      setBombasAdmin(lista);
      await sincronizarConteoBombas(lista);
    }
    setGuardandoBomba(false);
  }

  async function alternarActivaBomba(bomba: Bomba) {
    if (!id) return;
    if (bomba.activa) {
      const continuar = window.confirm(
        `¿Desactivar la Bomba ${bomba.numero_bomba}? Dejará de aparecer en el formulario de visitas, pero su historial se conserva.`,
      );
      if (!continuar) return;
    }
    setGuardandoBomba(true);
    setMensajeBombas(null);
    const { error } = await supabase.from('bombas').update({ activa: !bomba.activa }).eq('id', bomba.id);
    if (error) {
      setMensajeBombas(`No se pudo actualizar la bomba: ${mensajeErrorBombas(error)}`);
    } else {
      const { data } = await supabase.from('bombas').select('*').eq('estacion_id', id).order('numero_bomba');
      const lista = (data as Bomba[]) ?? [];
      setBombasAdmin(lista);
      await sincronizarConteoBombas(lista);
    }
    setGuardandoBomba(false);
  }

  async function manejarExportarPDF() {
    if (!estacion) return;
    setExportando(true);
    setMensajeExport(null);
    try {
      const visitasSinFotos = await obtenerVisitasPorEstacion(estacion.id, VISITAS_EN_PDF);
      if (visitasSinFotos.length === 0) {
        setMensajeExport('No hay visitas registradas para exportar.');
        return;
      }
      const visitas = await incrustarFotosVisitas(visitasSinFotos);
      const blob = await generarReporteVisitas(visitas, {
        numero: '',
        para: { nombre: 'Ing. Freddy Vásconez', cargo: 'JEFE DE SERVICIOS DE ALCANTARILLADO' },
        de: { nombre: usuario?.nombre_completo ?? '', cargo: usuario?.cargo ?? '' },
        asunto: `Historial de estación — ${estacion.nombre}`,
        fecha: hoyLocal(),
      });
      const nombre = `historial_${estacion.codigo}_${hoyLocal()}.pdf`;
      descargarBlob(blob, nombre);
      abrirBlob(blob);
    } catch (err: any) {
      setMensajeExport(`Error al generar el PDF: ${err.message ?? err}`);
    } finally {
      setExportando(false);
    }
  }

  if (cargando) return <p className="text-slate-600">Cargando…</p>;
  if (!estacion) return <p className="text-slate-600">Estación no encontrada.</p>;

  const operadoresDisponibles = Array.from(new Set(historial.map((h) => h.operador))).sort();
  const historialFiltrado = historial.filter((h) => {
    const dia = h.fecha_hora_llegada.slice(0, 10);
    if (filtroMes && dia.slice(0, 7) !== filtroMes) return false;
    if (filtroDesde && dia < filtroDesde) return false;
    if (filtroHasta && dia > filtroHasta) return false;
    if (filtroOperador && h.operador !== filtroOperador) return false;
    return true;
  });
  // Clasificado por operador (en vez de una sola lista larga) — mismo orden cronológico de
  // `historial` (más reciente primero) dentro de cada grupo, agrupado y ordenado por nombre.
  const historialPorOperador = agruparPorOperador(historialFiltrado);

  function limpiarFiltros() {
    setFiltroMes('');
    setFiltroDesde('');
    setFiltroHasta('');
    setFiltroOperador('');
  }

  return (
    <div className="space-y-5">
      <div className="tarjeta p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-0.5">Detalle de estación</p>
            <h1 className="titulo-pantalla">{estacion.nombre}</h1>
          </div>
          <EstadoBadge estado={estacion.estado_actual} />
        </div>
        <p className="text-sm text-slate-600 mt-2">{direccionOParroquia(estacion)}</p>
        {estacion.descripcion && <p className="text-sm text-slate-500 mt-1">{estacion.descripcion}</p>}
        {estacion.latitud && estacion.longitud && (
          <a
            className="text-sm text-gauge-ok mt-2 inline-block"
            target="_blank"
            rel="noreferrer"
            href={`https://maps.google.com/?q=${estacion.latitud},${estacion.longitud}`}
          >
            Ver ubicación en el mapa →
          </a>
        )}

        <div className="mt-3 pt-3 border-t border-panel-600/60">
          {historial.length === 0 ? (
            <p className="text-xs text-gauge-warn">Sin visitas registradas aún</p>
          ) : (
            <UltimaVisitaResumen visita={historial[0]} />
          )}
        </div>
      </div>

      {puedeEditarDistribucion && <BarraDistribucion editor={editorDistribucion} sinBloques />}

      {!soloLectura && (
        <Link to={`/estaciones/${estacion.id}/nueva-visita`} className="boton-primario w-full block text-center">
          + Registrar visita
        </Link>
      )}

      {puedeGestionarBombas && estacion.tipo !== 'linea_conduccion' && (
        <div className="tarjeta p-4 space-y-2">
          <h2 className="text-sm font-semibold text-slate-700">Gestión de bombas</h2>
          <div className="flex gap-2 flex-wrap">
            {[1, 2, 3, 4].map((numero) => {
              const bomba = bombasAdmin.find((b) => b.numero_bomba === numero);
              if (!bomba) {
                return (
                  <button
                    key={numero}
                    type="button"
                    disabled={guardandoBomba}
                    onClick={() => agregarBomba(numero)}
                    className="rounded-lg px-3 py-2 text-sm border border-dashed border-panel-600 text-slate-500 hover:text-gauge-ok hover:border-gauge-ok disabled:opacity-50"
                  >
                    + Bomba {numero}
                  </button>
                );
              }
              return (
                <button
                  key={numero}
                  type="button"
                  disabled={guardandoBomba}
                  onClick={() => alternarActivaBomba(bomba)}
                  className={`rounded-lg px-3 py-2 text-sm border transition disabled:opacity-50 ${
                    bomba.activa
                      ? 'bg-gauge-ok/15 border-gauge-ok text-gauge-ok'
                      : 'bg-panel-900 border-panel-600 text-slate-500 line-through'
                  }`}
                >
                  Bomba {numero}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-slate-500">
            Agrega hasta 4 bombas por estación. Desactivar una bomba la oculta del formulario de visitas sin borrar su historial.
          </p>
          {mensajeBombas && <p className="text-xs text-gauge-danger">{mensajeBombas}</p>}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-slate-700">Historial de visitas</h2>
          {historial.length > 0 && (
            <button
              type="button"
              onClick={manejarExportarPDF}
              disabled={exportando}
              className="text-xs text-gauge-ok hover:underline flex-shrink-0 disabled:opacity-50"
            >
              {exportando ? 'Generando PDF…' : '📄 Exportar a PDF'}
            </button>
          )}
        </div>
        {mensajeExport && <p className="text-xs text-gauge-warn mb-2">{mensajeExport}</p>}

        {historial.length > 0 && (
          <div className="flex flex-wrap gap-3 mb-3 items-end">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Mes
              <input
                type="month"
                className="campo py-1.5 text-sm"
                value={filtroMes}
                onChange={(e) => setFiltroMes(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Desde
              <input
                type="date"
                className="campo py-1.5 text-sm"
                value={filtroDesde}
                max={filtroHasta || undefined}
                onChange={(e) => setFiltroDesde(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Hasta
              <input
                type="date"
                className="campo py-1.5 text-sm"
                value={filtroHasta}
                min={filtroDesde || undefined}
                onChange={(e) => setFiltroHasta(e.target.value)}
              />
            </label>
            <select
              className="campo py-1.5 text-sm"
              value={filtroOperador}
              onChange={(e) => setFiltroOperador(e.target.value)}
            >
              <option value="">Todos los operadores</option>
              {operadoresDisponibles.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
            <button
              type="button"
              className="text-xs text-slate-600 hover:text-slate-800 flex-shrink-0 pb-2"
              onClick={limpiarFiltros}
            >
              Ver todo el historial
            </button>
          </div>
        )}

        {historial.length === 0 ? (
          <p className="text-sm text-slate-500">Aún no hay visitas registradas para esta estación.</p>
        ) : historialFiltrado.length === 0 ? (
          <div className="text-sm text-slate-500">
            <p>No hay visitas que coincidan con el filtro seleccionado.</p>
            <button type="button" className="text-xs text-gauge-ok hover:underline mt-1" onClick={limpiarFiltros}>
              Ver todo el historial →
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {historialPorOperador.map(({ operador, visitas }) => (
              <div key={operador}>
                <p className="text-xs font-bold text-sky-700 uppercase tracking-wider mb-1.5">
                  {operador} ({visitas.length})
                </p>
                <div className="space-y-2">
                  {visitas.map((h) => {
                    const puedeEditar = !soloLectura && (puedeEditarTodo || usuario?.id === h.operador_id);
                    const duracion = duracionVisita(h.fecha_hora_llegada, h.fecha_hora_salida);
                    return (
                      <div key={h.id} className="tarjeta p-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{new Date(h.fecha_hora_llegada).toLocaleString('es-EC', { hour12: false })}</span>
                            {duracion && (
                              <span className={`text-xs ${duracion.corta ? 'text-gauge-warn' : 'text-slate-500'}`}>
                                · {duracion.texto}
                              </span>
                            )}
                            {h.ubicacion_no_confirmada && (
                              <span className="text-xs px-2 py-0.5 rounded-full border border-gauge-warn/50 text-gauge-warn bg-gauge-warn/10">
                                📍 Ubicación sin confirmar por GPS
                              </span>
                            )}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <Link
                              to={`/estaciones/${estacion.id}/visitas/${h.id}/ver`}
                              className="text-xs font-semibold px-2.5 py-1 rounded-full border border-gauge-idle/50 text-gauge-idle bg-gauge-idle/10 hover:bg-gauge-idle/20 transition"
                            >
                              👁 Ver
                            </Link>
                            {puedeEditar && (
                              <Link
                                to={`/estaciones/${estacion.id}/visitas/${h.id}/editar`}
                                className="text-xs font-semibold px-2.5 py-1 rounded-full border border-gauge-ok/50 text-gauge-ok bg-gauge-ok/10 hover:bg-gauge-ok/20 transition"
                              >
                                ✏️ Editar
                              </Link>
                            )}
                          </span>
                        </div>
                        <div className="flex gap-2 mt-2 flex-wrap">
                          {h.bombas.filter((b) => b.estado === 'encendida').map((b) => (
                            <span
                              key={b.numero_bomba}
                              className={`text-xs lectura px-2 py-1 rounded border ${
                                b.voltaje_fuera_rango
                                  ? 'border-gauge-danger/50 text-gauge-danger bg-gauge-danger/10'
                                  : 'border-panel-600 text-slate-600'
                              }`}
                            >
                              B{b.numero_bomba}: {b.voltaje ?? '-'}V / {b.amperaje ?? '-'}A
                            </span>
                          ))}
                          {h.fotos_count > 0 && (
                            <span className="text-xs text-slate-500 px-2 py-1">📷 {h.fotos_count}</span>
                          )}
                          {h.cerramiento_observaciones && (
                            <span
                              className="text-xs px-2 py-0.5 rounded border border-gauge-warn/50 text-gauge-warn bg-gauge-warn/10"
                              title={h.cerramiento_observaciones}
                            >
                              🔒 Cerramiento
                            </span>
                          )}
                          {h.jardineras_observaciones && (
                            <span
                              className="text-xs px-2 py-0.5 rounded border border-gauge-warn/50 text-gauge-warn bg-gauge-warn/10"
                              title={h.jardineras_observaciones}
                            >
                              🌳 Jardineras y áreas verdes
                            </span>
                          )}
                          {h.patios_maniobras_observaciones && (
                            <span
                              className="text-xs px-2 py-0.5 rounded border border-gauge-warn/50 text-gauge-warn bg-gauge-warn/10"
                              title={h.patios_maniobras_observaciones}
                            >
                              🚧 Patios de maniobras
                            </span>
                          )}
                          {h.descarga_emergencia?.tiene === false && (
                            <span className="text-xs px-2 py-0.5 rounded border border-panel-600 text-slate-600">
                              Sin descarga de emergencia
                            </span>
                          )}
                          {h.camara_valvula_compuerta?.tiene === false && (
                            <span className="text-xs px-2 py-0.5 rounded border border-panel-600 text-slate-600">
                              Cámara de llegada sin compuerta
                            </span>
                          )}
                        </div>
                        {EQUIPOS_LABELS.some((eq) => {
                          const datos = h[eq.clave] as EquipoHistorial | null | undefined;
                          return datos && datos.estado && datos.estado !== 'operativo';
                        }) && (
                          <div className="flex gap-2 mt-1.5 flex-wrap">
                            {EQUIPOS_LABELS.map((eq) => {
                              const datos = h[eq.clave] as EquipoHistorial | null | undefined;
                              if (!datos || !datos.estado || datos.estado === 'operativo') return null;
                              const esFalla = datos.estado === 'en_falla';
                              return (
                                <span
                                  key={eq.clave}
                                  className={`text-xs px-2 py-0.5 rounded border ${
                                    esFalla
                                      ? 'border-gauge-danger/50 text-gauge-danger bg-gauge-danger/10'
                                      : 'border-gauge-warn/50 text-gauge-warn bg-gauge-warn/10'
                                  }`}
                                  title={datos.observaciones ?? undefined}
                                >
                                  {eq.label}: {esFalla ? 'Falla' : 'Mtto.'}
                                  {datos.numeros_afectados?.length ? ` (N.º ${datos.numeros_afectados.join(', ')})` : ''}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {estacion.tipo !== 'linea_conduccion' && (
        <p className="text-xs text-slate-500">Rango de voltaje de referencia: {VOLTAJE_MIN}–{VOLTAJE_MAX}V.</p>
      )}
    </div>
  );
}

function UltimaVisitaResumen({ visita }: { visita: HistorialItem }) {
  const equiposConAlerta = EQUIPOS_LABELS.filter((eq) => {
    const datos = visita[eq.clave] as EquipoHistorial | null | undefined;
    return datos && datos.estado && datos.estado !== 'operativo';
  });

  const alertasVoltaje = visita.bombas.filter((b) => b.voltaje_fuera_rango).length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-600">
          Última visita:{' '}
          <span className="text-slate-800">
            {new Date(visita.fecha_hora_llegada).toLocaleDateString('es-EC', {
              day: 'numeric', month: 'short', year: 'numeric',
            })}
          </span>
        </p>
        <span className="text-xs text-slate-500">{visita.operador}</span>
      </div>

      {visita.ubicacion_no_confirmada && (
        <p className="text-[11px] text-gauge-warn">📍 Ubicación sin confirmar por GPS — revisar</p>
      )}

      {(equiposConAlerta.length > 0 || alertasVoltaje > 0) ? (
        <div className="flex gap-1.5 flex-wrap">
          {equiposConAlerta.map((eq) => {
            const datos = visita[eq.clave] as EquipoHistorial;
            const esFalla = datos.estado === 'en_falla';
            return (
              <span
                key={eq.clave}
                className={`text-[10px] px-1.5 py-0.5 rounded border ${
                  esFalla
                    ? 'border-gauge-danger/50 text-gauge-danger bg-gauge-danger/10'
                    : 'border-gauge-warn/50 text-gauge-warn bg-gauge-warn/10'
                }`}
              >
                {eq.label}: {esFalla ? 'Falla' : 'Mtto.'}
              </span>
            );
          })}
          {alertasVoltaje > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-gauge-danger/50 text-gauge-danger bg-gauge-danger/10">
              ⚡ {alertasVoltaje} voltaje{alertasVoltaje > 1 ? 's' : ''} fuera de rango
            </span>
          )}
        </div>
      ) : (
        <p className="text-[10px] text-gauge-ok">Todo operativo en la última visita</p>
      )}
    </div>
  );
}
