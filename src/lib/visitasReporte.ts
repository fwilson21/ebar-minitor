import { supabase } from './supabase';
import { urlMiniaturaDrive } from './fotos';
import type { VisitaParaReporte } from './pdf';

export const SELECT_VISITA_REPORTE = `id, fecha_hora_llegada, fecha_hora_salida, estado_estacion, nivel_tanque,
   cerramiento_observaciones, jardineras_observaciones, patios_maniobras_observaciones, observaciones_generales,
   lineas_impulsion, guias_izado, valvulas_compuerta, valvulas_check, valvula_aire,
   camara_rejilla, camara_valvula_compuerta, tablero_distribucion, variador, descarga_emergencia,
   tuberia_400_valvulas_aire, tuberia_400_uniones_elastomericas,
   tuberia_600_valvulas_aire, tuberia_600_uniones_elastomericas,
   estaciones_ebar ( nombre, codigo, zona, tipo ),
   usuarios ( nombre_completo, firma_url ),
   registros_bombas ( numero_bomba, estado, voltaje, amperaje, horas_operacion_acumuladas, observaciones, voltaje_fuera_rango ),
   fotos ( url_publica, drive_file_id, descripcion )`;

export function mapearVisitaFila(v: any): VisitaParaReporte {
  return {
    estacion_nombre: v.estaciones_ebar?.nombre ?? '-',
    estacion_codigo: v.estaciones_ebar?.codigo ?? '-',
    estacion_tipo: v.estaciones_ebar?.tipo ?? 'ebar',
    zona: v.estaciones_ebar?.zona ?? '-',
    fecha_hora_llegada: v.fecha_hora_llegada,
    fecha_hora_salida: v.fecha_hora_salida,
    operador_nombre: v.usuarios?.nombre_completo ?? '-',
    firma_url: v.usuarios?.firma_url ?? null,
    estado_estacion: v.estado_estacion,
    nivel_tanque: v.nivel_tanque,
    cerramiento_observaciones: v.cerramiento_observaciones,
    jardineras_observaciones: v.jardineras_observaciones,
    patios_maniobras_observaciones: v.patios_maniobras_observaciones,
    observaciones_generales: v.observaciones_generales,
    lineas_impulsion: v.lineas_impulsion ?? null,
    guias_izado: v.guias_izado ?? null,
    valvulas_compuerta: v.valvulas_compuerta ?? null,
    valvulas_check: v.valvulas_check ?? null,
    valvula_aire: v.valvula_aire ?? null,
    camara_rejilla: v.camara_rejilla ?? null,
    camara_valvula_compuerta: v.camara_valvula_compuerta ?? null,
    tablero_distribucion: v.tablero_distribucion ?? null,
    variador: v.variador ?? null,
    descarga_emergencia: v.descarga_emergencia ?? null,
    tuberia_400_valvulas_aire: v.tuberia_400_valvulas_aire ?? null,
    tuberia_400_uniones_elastomericas: v.tuberia_400_uniones_elastomericas ?? null,
    tuberia_600_valvulas_aire: v.tuberia_600_valvulas_aire ?? null,
    tuberia_600_uniones_elastomericas: v.tuberia_600_uniones_elastomericas ?? null,
    bombas: v.registros_bombas ?? [],
    fotos: (v.fotos ?? [])
      .map((f: any) => ({ url: urlMiniaturaDrive(f.drive_file_id, f.url_publica), etiqueta: f.descripcion ?? null }))
      .filter((f: { url: string | undefined }): f is { url: string; etiqueta: string | null } => Boolean(f.url)),
  };
}

/** Últimas `limite` visitas de una estación, listas para armar un reporte PDF. */
export async function obtenerVisitasPorEstacion(estacionId: string, limite: number): Promise<VisitaParaReporte[]> {
  const { data, error } = await supabase
    .from('visitas')
    .select(SELECT_VISITA_REPORTE)
    .eq('estacion_id', estacionId)
    .order('fecha_hora_llegada', { ascending: false })
    .limit(limite);
  if (error) throw error;
  return (data ?? []).map(mapearVisitaFila);
}
