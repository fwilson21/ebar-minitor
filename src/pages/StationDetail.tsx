import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { suscribirseCambios } from '../lib/realtime';
import { useAuth } from '../contexts/AuthContext';
import type { EstacionEbar } from '../lib/types';
import { EstadoBadge } from '../components/EstadoBadge';
import { VOLTAJE_MAX, VOLTAJE_MIN } from '../lib/types';
import { abrirBlob, descargarBlob, generarReporteVisitas } from '../lib/pdf';
import { incrustarFotosVisitas } from '../lib/fotos';
import { obtenerVisitasPorEstacion } from '../lib/visitasReporte';

const VISITAS_EN_PDF = 30;

interface EquipoHistorial {
  estado: string;
  observaciones?: string | null;
  numeros_afectados?: number[] | null;
  tiene?: boolean | null;
}

interface HistorialItem {
  id: string;
  fecha_hora_llegada: string;
  estado_estacion: string;
  nivel_tanque: string;
  operador: string;
  operador_id: string;
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

export function StationDetail() {
  const { id } = useParams<{ id: string }>();
  const { usuario } = useAuth();
  const puedeEditarTodo = usuario?.rol === 'administrador' || usuario?.rol === 'supervisor';
  const [estacion, setEstacion] = useState<EstacionEbar | null>(null);
  const [historial, setHistorial] = useState<HistorialItem[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtroMes, setFiltroMes] = useState('');
  const [filtroOperador, setFiltroOperador] = useState('');
  const [exportando, setExportando] = useState(false);
  const [mensajeExport, setMensajeExport] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    async function cargar() {
      const [{ data: est }, { data: hist }] = await Promise.all([
        supabase.from('estaciones_ebar').select('*').eq('id', id).single(),
        supabase.rpc('rpc_historial_estacion', { p_estacion_id: id, p_limite: 30 }),
      ]);
      setEstacion(est as EstacionEbar);
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
      const titulo = `Historial de estación\n${estacion.codigo} — ${estacion.nombre}`;
      const blob = await generarReporteVisitas(titulo, visitas);
      const nombre = `historial_${estacion.codigo}_${new Date().toISOString().slice(0, 10)}.pdf`;
      descargarBlob(blob, nombre);
      abrirBlob(blob);
    } catch (err: any) {
      setMensajeExport(`Error al generar el PDF: ${err.message ?? err}`);
    } finally {
      setExportando(false);
    }
  }

  if (cargando) return <p className="text-slate-400">Cargando…</p>;
  if (!estacion) return <p className="text-slate-400">Estación no encontrada.</p>;

  const operadoresDisponibles = Array.from(new Set(historial.map((h) => h.operador))).sort();
  const historialFiltrado = historial.filter((h) => {
    if (filtroMes && h.fecha_hora_llegada.slice(0, 7) !== filtroMes) return false;
    if (filtroOperador && h.operador !== filtroOperador) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      <div className="tarjeta p-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-bold">{estacion.nombre}</h1>
            <p className="text-sm text-slate-400 lectura">{estacion.codigo}</p>
          </div>
          <EstadoBadge estado={estacion.estado_actual} />
        </div>
        <p className="text-sm text-slate-400 mt-2">{estacion.direccion}</p>
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

      <Link to={`/estaciones/${estacion.id}/nueva-visita`} className="boton-primario w-full block text-center">
        + Registrar visita
      </Link>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-slate-300">Historial de visitas</h2>
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
          <div className="flex gap-2 mb-3">
            <input
              type="month"
              className="campo py-1.5 text-sm"
              value={filtroMes}
              onChange={(e) => setFiltroMes(e.target.value)}
            />
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
            {(filtroMes || filtroOperador) && (
              <button
                type="button"
                className="text-xs text-slate-400 hover:text-slate-200 flex-shrink-0"
                onClick={() => { setFiltroMes(''); setFiltroOperador(''); }}
              >
                Limpiar
              </button>
            )}
          </div>
        )}

        {historial.length === 0 ? (
          <p className="text-sm text-slate-500">Aún no hay visitas registradas para esta estación.</p>
        ) : historialFiltrado.length === 0 ? (
          <p className="text-sm text-slate-500">No hay visitas que coincidan con el filtro seleccionado.</p>
        ) : (
          <div className="space-y-2">
            {historialFiltrado.map((h) => {
              const puedeEditar = puedeEditarTodo || usuario?.id === h.operador_id;
              const Contenedor = puedeEditar ? Link : 'div';
              const propsContenedor = puedeEditar
                ? { to: `/estaciones/${estacion.id}/visitas/${h.id}/editar` }
                : {};
              return (
              <Contenedor key={h.id} className="tarjeta p-3 block hover:border-gauge-ok/50 transition" {...(propsContenedor as any)}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{new Date(h.fecha_hora_llegada).toLocaleString('es-EC')}</span>
                  <span className="text-xs text-slate-500">{h.operador}{puedeEditar && ' · Editar →'}</span>
                </div>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {h.bombas.filter((b) => b.estado === 'encendida').map((b) => (
                    <span
                      key={b.numero_bomba}
                      className={`text-xs lectura px-2 py-1 rounded border ${
                        b.voltaje_fuera_rango
                          ? 'border-gauge-danger/50 text-gauge-danger bg-gauge-danger/10'
                          : 'border-panel-600 text-slate-400'
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
                      🌳 Jardineras
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
                    <span className="text-xs px-2 py-0.5 rounded border border-panel-600 text-slate-400">
                      Sin descarga de emergencia
                    </span>
                  )}
                  {h.camara_valvula_compuerta?.tiene === false && (
                    <span className="text-xs px-2 py-0.5 rounded border border-panel-600 text-slate-400">
                      Cámara de llegada sin compuerta
                    </span>
                  )}
                </div>
                {EQUIPOS_LABELS.some((eq) => {
                  const datos = h[eq.clave] as EquipoHistorial | null | undefined;
                  return datos && datos.estado !== 'operativo';
                }) && (
                  <div className="flex gap-2 mt-1.5 flex-wrap">
                    {EQUIPOS_LABELS.map((eq) => {
                      const datos = h[eq.clave] as EquipoHistorial | null | undefined;
                      if (!datos || datos.estado === 'operativo') return null;
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
              </Contenedor>
              );
            })}
          </div>
        )}
      </div>
      {estacion.tipo !== 'linea_conduccion' && (
        <p className="text-xs text-slate-600">Rango de voltaje de referencia: {VOLTAJE_MIN}–{VOLTAJE_MAX}V.</p>
      )}
    </div>
  );
}

function UltimaVisitaResumen({ visita }: { visita: HistorialItem }) {
  const equiposConAlerta = EQUIPOS_LABELS.filter((eq) => {
    const datos = visita[eq.clave] as EquipoHistorial | null | undefined;
    return datos && datos.estado !== 'operativo';
  });

  const alertasVoltaje = visita.bombas.filter((b) => b.voltaje_fuera_rango).length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">
          Última visita:{' '}
          <span className="text-slate-200">
            {new Date(visita.fecha_hora_llegada).toLocaleDateString('es-EC', {
              day: 'numeric', month: 'short', year: 'numeric',
            })}
          </span>
        </p>
        <span className="text-xs text-slate-500">{visita.operador}</span>
      </div>

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
