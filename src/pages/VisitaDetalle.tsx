import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { urlMiniaturaDrive } from '../lib/fotos';
import { FotoLightbox } from '../components/FotoLightbox';
import { VOLTAJE_MAX, VOLTAJE_MIN } from '../lib/types';
import type { EstacionEbar, EstadoBomba, FotoLocal } from '../lib/types';

// ----------------------------------------------------------------------------
// Vista de solo lectura de una visita ya guardada, para cuando el usuario no
// puede editarla (no es suya, ni es administrador/supervisor) pero sí debe
// poder verificar todo su contenido — sin ningún <input> ni botón de guardar.
// Los datos se traen con rpc_detalle_visita (security definer, igual que
// rpc_historial_estacion) porque la política RLS de `visitas`/`fotos` no deja
// leer directamente visitas ajenas.
// ----------------------------------------------------------------------------

interface FotoDetalle {
  id: string;
  url_publica: string | null;
  drive_file_id: string | null;
  descripcion: string | null;
}

interface EquipoDetalle {
  estado?: string | null;
  observaciones?: string | null;
  numeros_afectados?: number[] | null;
  tiene?: boolean | null;
}

interface BombaDetalle {
  numero_bomba: number;
  estado: EstadoBomba;
  voltaje: number | null;
  amperaje: number | null;
  horas_operacion_acumuladas: number | null;
  observaciones: string | null;
  voltaje_fuera_rango: boolean;
}

interface DetalleVisita {
  operador: string;
  fecha_hora_llegada: string;
  fecha_hora_salida: string | null;
  estado_estacion: string;
  nivel_tanque: string;
  observaciones_generales: string | null;
  cerramiento_observaciones: string | null;
  jardineras_observaciones: string | null;
  patios_maniobras_observaciones: string | null;
  lineas_impulsion: EquipoDetalle | null;
  guias_izado: EquipoDetalle | null;
  valvulas_compuerta: EquipoDetalle | null;
  valvulas_check: EquipoDetalle | null;
  valvula_aire: EquipoDetalle | null;
  camara_rejilla: EquipoDetalle | null;
  camara_valvula_compuerta: EquipoDetalle | null;
  tablero_distribucion: EquipoDetalle | null;
  variador: EquipoDetalle | null;
  descarga_emergencia: EquipoDetalle | null;
  tuberia_400_valvulas_aire: EquipoDetalle | null;
  tuberia_400_uniones_elastomericas: EquipoDetalle | null;
  tuberia_600_valvulas_aire: EquipoDetalle | null;
  tuberia_600_uniones_elastomericas: EquipoDetalle | null;
  bombas: BombaDetalle[];
  fotos: FotoDetalle[];
}

const ESTADOS_ESTACION_LABEL: Record<string, { label: string; clase: string }> = {
  operativa: { label: 'Operativa', clase: 'bg-gauge-ok/15 border-gauge-ok text-gauge-ok' },
  mantenimiento_correctivo: { label: 'Mantenimiento correctivo', clase: 'bg-gauge-warn/15 border-gauge-warn text-gauge-warn' },
  fuera_de_servicio: { label: 'Fuera de servicio', clase: 'bg-gauge-danger/15 border-gauge-danger text-gauge-danger' },
};

// Mismos 3 valores del enum en ambos casos: solo cambia cómo se llama "en_falla" según la
// sección (ver ESTADOS_VALVULAS_LINEAS / EquipoSection en VisitForm.tsx — la mayoría de
// secciones dicen "Fuera de servicio", solo el tablero de distribución dice "En falla").
const ESTADOS_EQUIPO_LINEAS: Record<string, { label: string; clase: string }> = {
  operativo: { label: 'Operativo', clase: 'bg-gauge-ok/15 border-gauge-ok text-gauge-ok' },
  requiere_mantenimiento: { label: 'Requiere mantenimiento', clase: 'bg-gauge-warn/15 border-gauge-warn text-gauge-warn' },
  en_falla: { label: 'Fuera de servicio', clase: 'bg-gauge-danger/15 border-gauge-danger text-gauge-danger' },
};
const ESTADOS_EQUIPO_DEFAULT: Record<string, { label: string; clase: string }> = {
  operativo: { label: 'Operativo', clase: 'bg-gauge-ok/15 border-gauge-ok text-gauge-ok' },
  en_falla: { label: 'En falla', clase: 'bg-gauge-danger/15 border-gauge-danger text-gauge-danger' },
  requiere_mantenimiento: { label: 'Requiere mtto.', clase: 'bg-gauge-warn/15 border-gauge-warn text-gauge-warn' },
};

const ESTADOS_BOMBA_LABEL: Record<EstadoBomba, { label: string; clase: string }> = {
  encendida: { label: 'Encendida', clase: 'bg-gauge-ok/15 border-gauge-ok text-gauge-ok' },
  apagada: { label: 'Apagada', clase: 'bg-panel-700 border-panel-600 text-slate-800' },
  en_falla: { label: 'En falla', clase: 'bg-gauge-danger/15 border-gauge-danger text-gauge-danger' },
  retirado_para_mantenimiento: { label: 'Retirado para mtto.', clase: 'bg-gauge-warn/15 border-gauge-warn text-gauge-warn' },
};

function Badge({ texto, clase }: { texto: string; clase: string }) {
  return <span className={`inline-block rounded-lg px-3 py-1.5 text-sm border ${clase}`}>{texto}</span>;
}

function GrillaFotos({ fotos }: { fotos: FotoLocal[] }) {
  const [abierta, setAbierta] = useState<number | null>(null);
  if (fotos.length === 0) return null;
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {fotos.map((foto, idx) => (
          <div key={foto.id} className="relative aspect-square rounded-lg overflow-hidden bg-panel-700">
            {foto.url_publica && (
              // eslint-disable-next-line jsx-a11y/alt-text
              <img
                src={foto.url_publica}
                className="w-full h-full object-cover cursor-pointer"
                onClick={() => setAbierta(idx)}
              />
            )}
          </div>
        ))}
      </div>
      {abierta !== null && (
        <FotoLightbox fotos={fotos} indice={abierta} onCambiarIndice={setAbierta} onCerrar={() => setAbierta(null)} />
      )}
    </div>
  );
}

/** Presentación de solo lectura de una sección de equipo (equivalente a EquipoSection, sin edición). */
function SeccionVista({
  titulo,
  valor,
  fotos,
  etiquetas = ESTADOS_EQUIPO_DEFAULT,
  sinEstado,
}: {
  titulo: string;
  valor: EquipoDetalle | null | undefined;
  fotos: FotoLocal[];
  etiquetas?: Record<string, { label: string; clase: string }>;
  sinEstado?: boolean;
}) {
  const tiene = valor?.tiene;
  const estado = valor?.estado;
  const estadoInfo = estado ? etiquetas[estado] : undefined;
  const noAplica = tiene === false;

  return (
    <div className="tarjeta p-4 space-y-3">
      <h3 className="text-base font-bold uppercase tracking-wide text-slate-800">{titulo}</h3>
      {tiene !== undefined && tiene !== null && (
        <p className="text-sm text-slate-600">{tiene ? 'Sí tiene' : 'No tiene'}</p>
      )}
      {!noAplica && (
        <>
          {!sinEstado && estadoInfo && <Badge texto={estadoInfo.label} clase={estadoInfo.clase} />}
          {valor?.numeros_afectados && valor.numeros_afectados.length > 0 && (
            <p className="text-sm text-slate-600">N.º afectados: {valor.numeros_afectados.join(', ')}</p>
          )}
          {valor?.observaciones && <p className="text-sm text-slate-700 whitespace-pre-wrap">{valor.observaciones}</p>}
          <GrillaFotos fotos={fotos} />
        </>
      )}
    </div>
  );
}

function TarjetaBomba({ bomba, fotos }: { bomba: BombaDetalle; fotos: FotoLocal[] }) {
  const info = ESTADOS_BOMBA_LABEL[bomba.estado];
  return (
    <div className={`tarjeta p-4 space-y-2 ${bomba.voltaje_fuera_rango ? 'border-gauge-danger/60' : ''}`}>
      <div className="flex items-center justify-between">
        <h4 className="text-base font-bold uppercase tracking-wide">Bomba {bomba.numero_bomba}</h4>
        {bomba.voltaje_fuera_rango && (
          <span className="text-xs text-gauge-danger font-medium">⚠ Voltaje fuera de rango ({VOLTAJE_MIN}–{VOLTAJE_MAX}V)</span>
        )}
      </div>
      {info && <Badge texto={info.label} clase={info.clase} />}
      <p className="text-sm text-slate-600">Voltaje: {bomba.voltaje ?? '-'}V · Amperaje: {bomba.amperaje ?? '-'}A</p>
      <p className="text-sm text-slate-600">Horas de operación acumuladas: {bomba.horas_operacion_acumuladas ?? '-'}</p>
      {bomba.observaciones && <p className="text-sm text-slate-700 whitespace-pre-wrap">{bomba.observaciones}</p>}
      <GrillaFotos fotos={fotos} />
    </div>
  );
}

export function VisitaDetalle() {
  const { id: estacionId, visitaId } = useParams<{ id: string; visitaId: string }>();
  const [estacion, setEstacion] = useState<EstacionEbar | null>(null);
  const [visita, setVisita] = useState<DetalleVisita | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function cargar() {
      const [{ data: est }, { data: det, error: errDet }] = await Promise.all([
        supabase.from('estaciones_ebar').select('*').eq('id', estacionId).single(),
        supabase.rpc('rpc_detalle_visita', { p_visita_id: visitaId }),
      ]);
      setEstacion(est as EstacionEbar);
      if (errDet || !det) setError('No se pudo cargar la visita.');
      else setVisita(det as DetalleVisita);
      setCargando(false);
    }
    cargar();
  }, [estacionId, visitaId]);

  if (cargando) return <p className="p-4 text-slate-500">Cargando…</p>;
  if (error || !visita) return <p className="p-4 text-gauge-danger">{error ?? 'Visita no encontrada.'}</p>;

  const esLineaConduccion = estacion?.tipo === 'linea_conduccion';
  const todasLasFotos = visita.fotos ?? [];
  const fotosPorSeccion = (nombre: string | null): FotoLocal[] =>
    todasLasFotos
      .filter((f) => (nombre ? f.descripcion === nombre : !f.descripcion))
      .map((f) => ({
        id: f.id,
        url_publica: urlMiniaturaDrive(f.drive_file_id, f.url_publica),
        tomada_en: visita.fecha_hora_llegada,
        estado_subida: 'subida' as const,
      }));

  const llegada = new Date(visita.fecha_hora_llegada);
  const salida = visita.fecha_hora_salida ? new Date(visita.fecha_hora_salida) : null;
  const estadoEstacionInfo = ESTADOS_ESTACION_LABEL[visita.estado_estacion];

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-4">
      <Link to={`/estaciones/${estacionId}`} className="text-sm text-gauge-ok hover:underline">
        ← Volver
      </Link>

      <div className="tarjeta p-4 space-y-1">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Detalle de visita</p>
        <h1 className="titulo-pantalla">{estacion?.nombre} · {estacion?.codigo}</h1>
        <p className="text-sm text-slate-600">Operador: {visita.operador}</p>
        <p className="text-sm text-slate-600">
          Llegada: {llegada.toLocaleString('es-EC', { hour12: false })}
          {salida && <> · Salida: {salida.toLocaleString('es-EC', { hour12: false })}</>}
        </p>
      </div>

      {!esLineaConduccion && (
        <>
          <div className="tarjeta p-4 space-y-3">
            {estadoEstacionInfo && (
              <div>
                <p className="etiqueta">Estado de la estación</p>
                <Badge texto={estadoEstacionInfo.label} clase={estadoEstacionInfo.clase} />
              </div>
            )}
            <div>
              <p className="etiqueta">Nivel de tanque de almacenamiento</p>
              <p className="text-sm text-slate-700 capitalize">{visita.nivel_tanque}</p>
            </div>
            {visita.observaciones_generales && (
              <div>
                <p className="etiqueta">Observaciones generales</p>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{visita.observaciones_generales}</p>
              </div>
            )}
            <GrillaFotos fotos={fotosPorSeccion(null)} />
          </div>

          {visita.bombas.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-bold uppercase tracking-wide text-slate-800">Bombas</h2>
              {visita.bombas.map((b) => (
                <TarjetaBomba key={b.numero_bomba} bomba={b} fotos={fotosPorSeccion(`bomba_${b.numero_bomba}`)} />
              ))}
            </div>
          )}

          <SeccionVista titulo="Cerramiento de seguridad" valor={{ observaciones: visita.cerramiento_observaciones }} fotos={fotosPorSeccion('cerramiento_seguridad')} sinEstado />
          <SeccionVista titulo="Jardineras" valor={{ observaciones: visita.jardineras_observaciones }} fotos={fotosPorSeccion('jardineras')} sinEstado />
          <SeccionVista titulo="Patios de maniobras" valor={{ observaciones: visita.patios_maniobras_observaciones }} fotos={fotosPorSeccion('patios_maniobras')} sinEstado />

          <div>
            <h2 className="text-lg font-bold uppercase tracking-wide text-slate-800 mb-2">Estado de equipos</h2>
            <div className="space-y-3">
              <SeccionVista titulo="Líneas de impulsión" valor={visita.lineas_impulsion} fotos={fotosPorSeccion('lineas_impulsion')} etiquetas={ESTADOS_EQUIPO_LINEAS} />
              <SeccionVista titulo="Guías de izado de bombas" valor={visita.guias_izado} fotos={fotosPorSeccion('guias_izado')} etiquetas={ESTADOS_EQUIPO_LINEAS} />
              <SeccionVista titulo="Válvulas de compuerta" valor={visita.valvulas_compuerta} fotos={fotosPorSeccion('valvulas_compuerta')} etiquetas={ESTADOS_EQUIPO_LINEAS} />
              <SeccionVista titulo="Válvulas check" valor={visita.valvulas_check} fotos={fotosPorSeccion('valvulas_check')} etiquetas={ESTADOS_EQUIPO_LINEAS} />
              <SeccionVista titulo="Válvula de aire" valor={visita.valvula_aire} fotos={fotosPorSeccion('valvula_aire')} etiquetas={ESTADOS_EQUIPO_LINEAS} />
              <SeccionVista titulo="Cámara de llegada — Rejilla" valor={visita.camara_rejilla} fotos={fotosPorSeccion('camara_rejilla')} etiquetas={ESTADOS_EQUIPO_LINEAS} />
              <SeccionVista titulo="Cámara de llegada — Compuerta" valor={visita.camara_valvula_compuerta} fotos={fotosPorSeccion('camara_valvula_compuerta')} etiquetas={ESTADOS_EQUIPO_LINEAS} />
              <SeccionVista titulo="Tablero de distribución, contactores y breakers" valor={visita.tablero_distribucion} fotos={fotosPorSeccion('tablero_distribucion')} />
              <SeccionVista titulo="Variadores de frecuencia" valor={visita.variador} fotos={fotosPorSeccion('variador')} etiquetas={ESTADOS_EQUIPO_LINEAS} />
              <SeccionVista titulo="Descarga de emergencia" valor={visita.descarga_emergencia} fotos={fotosPorSeccion('descarga_emergencia')} sinEstado />
            </div>
          </div>
        </>
      )}

      {esLineaConduccion && (
        <div className="space-y-3">
          <SeccionVista titulo="Tubería 400mm — Válvulas de aire" valor={visita.tuberia_400_valvulas_aire} fotos={fotosPorSeccion('tuberia_400_valvulas_aire')} etiquetas={ESTADOS_EQUIPO_LINEAS} />
          <SeccionVista titulo="Tubería 400mm — Uniones elastoméricas" valor={visita.tuberia_400_uniones_elastomericas} fotos={fotosPorSeccion('tuberia_400_uniones_elastomericas')} etiquetas={ESTADOS_EQUIPO_LINEAS} />
          <SeccionVista titulo="Tubería 600mm — Válvulas de aire" valor={visita.tuberia_600_valvulas_aire} fotos={fotosPorSeccion('tuberia_600_valvulas_aire')} etiquetas={ESTADOS_EQUIPO_LINEAS} />
          <SeccionVista titulo="Tubería 600mm — Uniones elastoméricas" valor={visita.tuberia_600_uniones_elastomericas} fotos={fotosPorSeccion('tuberia_600_uniones_elastomericas')} etiquetas={ESTADOS_EQUIPO_LINEAS} />
        </div>
      )}
    </div>
  );
}
