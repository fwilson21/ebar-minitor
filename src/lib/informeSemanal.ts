// Lógica de datos del Informe Semanal (analista de redes, rol supervisor): arma un borrador
// automático a partir de las visitas ya registradas, agrupadas por día/estación/operador, y
// calcula si un día ya aprobado tuvo cambios después de aprobarse. Ver memoria del proyecto
// "Informe Semanal" para el bosquejo aprobado (fases, candado de semana, guardado día por día).
import { supabase } from './supabase';
import { urlMiniaturaDrive, urlAImagenBase64 } from './fotos';
import { esFinDeSemana, esFeriadoCalculado } from './feriadosEcuador';

export const DIAS_SEMANA = 5; // lunes a viernes — el fin de semana solo entra en la asistencia

// ----------------------------------------------------------------------------
// Fechas
// ----------------------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** YYYY-MM-DD de un Date en hora LOCAL (mismo criterio que hoyLocal() en fecha.ts, pero para una
 * fecha cualquiera, no solo "ahora"). */
export function fechaLocalDe(fechaIso: string): string {
  const d = new Date(fechaIso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function sumarDiasIso(fechaIso: string, dias: number): string {
  const [y, m, d] = fechaIso.split('-').map(Number);
  const fecha = new Date(y, m - 1, d + dias);
  return `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}`;
}

/** Lunes de la semana que contiene `fechaIso` (si ya es lunes, devuelve la misma fecha). */
export function lunesDeSemana(fechaIso: string): string {
  const [y, m, d] = fechaIso.split('-').map(Number);
  const diaSemana = new Date(y, m - 1, d).getDay(); // 0=domingo … 6=sábado
  const offset = diaSemana === 0 ? -6 : 1 - diaSemana; // retrocede hasta el lunes
  return sumarDiasIso(fechaIso, offset);
}

/** Los 5 días laborables (lunes a viernes) de la semana que empieza en `desde`. */
export function diasLaborables(desde: string): string[] {
  return Array.from({ length: DIAS_SEMANA }, (_, i) => sumarDiasIso(desde, i));
}

/** Sábado y domingo que siguen a los 5 días laborables (para la tabla de asistencia). */
export function diasFinDeSemana(desde: string): string[] {
  return [sumarDiasIso(desde, 5), sumarDiasIso(desde, 6)];
}

const DIAS_LABEL = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES_LABEL = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** "Lunes 11 de agosto de 2026" a partir de una fecha YYYY-MM-DD. */
export function formatFechaLarga(fechaIso: string): string {
  const [y, m, d] = fechaIso.split('-').map(Number);
  const fecha = new Date(y, m - 1, d);
  const dia = DIAS_LABEL[fecha.getDay()];
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)} ${d} de ${MESES_LABEL[m - 1]} de ${y}`;
}

/** "10 al 14 de agosto de 2026" (o "28 de julio al 3 de agosto de 2026" si la semana cruza de
 * mes) — para el encabezado de "Semana del…", tanto en pantalla como en el PDF. */
export function formatRangoSemana(desde: string, hasta: string): string {
  const [yD, mD, dD] = desde.split('-').map(Number);
  const [yH, mH, dH] = hasta.split('-').map(Number);
  if (yD === yH && mD === mH) return `${dD} al ${dH} de ${MESES_LABEL[mD - 1]} de ${yD}`;
  if (yD === yH) return `${dD} de ${MESES_LABEL[mD - 1]} al ${dH} de ${MESES_LABEL[mH - 1]} de ${yD}`;
  return `${dD} de ${MESES_LABEL[mD - 1]} de ${yD} al ${dH} de ${MESES_LABEL[mH - 1]} de ${yH}`;
}

/** "10" (día) + "Lun" (abreviatura), para el encabezado de la tabla de asistencia. */
export function formatFechaCortaTabla(fechaIso: string): { dia: string; abrev: string } {
  const [, , d] = fechaIso.split('-');
  const fecha = new Date(`${fechaIso}T12:00:00`);
  const abrev = DIAS_LABEL[fecha.getDay()].slice(0, 3);
  return { dia: d, abrev: `${abrev.charAt(0).toUpperCase()}${abrev.slice(1)}` };
}

function formatHora(fechaIso: string): string {
  const d = new Date(fechaIso);
  return `${pad(d.getHours())}h${pad(d.getMinutes())}`;
}

// ----------------------------------------------------------------------------
// Visitas de la semana → bloques día/estación/operador
// ----------------------------------------------------------------------------

export interface FotoInforme {
  id: string;
  url: string;
  descripcion: string | null;
  tomada_en: string;
}

export interface VisitaCruda {
  id: string;
  estacion_id: string;
  operador_id: string;
  fecha_hora_llegada: string;
  fecha_hora_salida: string | null;
  observaciones_generales: string | null;
  updated_at: string;
  estacion_nombre: string;
  operador_nombre: string;
  fotos: FotoInforme[];
}

const SELECT_VISITA_INFORME = `id, estacion_id, operador_id, fecha_hora_llegada, fecha_hora_salida,
  observaciones_generales, updated_at,
  estaciones_ebar ( nombre ),
  usuarios ( nombre_completo ),
  fotos ( id, url_publica, drive_file_id, descripcion, tomada_en )`;

/** Todas las visitas cuya llegada cae dentro de `desde`..`hasta` (fechas locales YYYY-MM-DD),
 * con lo mínimo necesario para armar el Informe Semanal (no reutiliza SELECT_VISITA_REPORTE de
 * visitasReporte.ts porque acá hace falta id/estacion_id/operador_id/updated_at "en crudo" para
 * agrupar y para detectar cambios — ese otro select está pensado para el PDF de reportes, no para
 * esto). */
export async function obtenerVisitasSemana(desde: string, hasta: string): Promise<VisitaCruda[]> {
  const { data, error } = await supabase
    .from('visitas')
    .select(SELECT_VISITA_INFORME)
    .gte('fecha_hora_llegada', `${desde}T00:00:00`)
    .lt('fecha_hora_llegada', `${sumarDiasIso(hasta, 1)}T00:00:00`)
    .order('fecha_hora_llegada');
  if (error) throw error;
  return (data ?? []).map((v: any) => ({
    id: v.id,
    estacion_id: v.estacion_id,
    operador_id: v.operador_id,
    fecha_hora_llegada: v.fecha_hora_llegada,
    fecha_hora_salida: v.fecha_hora_salida,
    observaciones_generales: v.observaciones_generales,
    updated_at: v.updated_at,
    estacion_nombre: v.estaciones_ebar?.nombre ?? '-',
    operador_nombre: v.usuarios?.nombre_completo ?? '-',
    fotos: (v.fotos ?? [])
      .map((f: any) => ({
        id: f.id as string,
        url: urlMiniaturaDrive(f.drive_file_id, f.url_publica),
        descripcion: f.descripcion ?? null,
        tomada_en: f.tomada_en,
      }))
      .filter((f: any): f is FotoInforme => Boolean(f.url)),
  }));
}

export interface BloqueInforme {
  estacion_id: string;
  estacion_nombre: string;
  operador_id: string;
  operador_nombre: string;
  responsable: string;
  hora_inicio: string | null;
  hora_fin: string | null;
  vinetas: string[];
  /** ids de las visitas que aportaron viñetas, en el mismo orden que `vinetas` — permite
   * reconstruir el snapshot al aprobar sin tener que re-consultar la base. */
  vinetas_visita_ids: string[];
  fotos_seleccionadas: string[];
}

/** Arma los bloques (uno por cada par estación+operador con al menos una visita) de un día,
 * ordenados por estación y luego por operador. Las viñetas salen de `observaciones_generales` de
 * cada visita (una visita vacía no aporta viñeta) — el operador escribe ahí la narrativa libre de
 * lo que hizo, que es lo que se pega tal cual en "Desarrollo de la semana". */
export function construirBloquesDia(visitasDia: VisitaCruda[]): BloqueInforme[] {
  const grupos = new Map<string, VisitaCruda[]>();
  for (const v of visitasDia) {
    const clave = `${v.estacion_id}::${v.operador_id}`;
    grupos.set(clave, [...(grupos.get(clave) ?? []), v]);
  }

  const bloques: BloqueInforme[] = [];
  for (const visitas of grupos.values()) {
    const ordenadas = [...visitas].sort((a, b) => a.fecha_hora_llegada.localeCompare(b.fecha_hora_llegada));
    const primera = ordenadas[0];
    const conSalida = ordenadas.filter((v) => v.fecha_hora_salida);
    const vinetas: string[] = [];
    const vinetaVisitaIds: string[] = [];
    for (const v of ordenadas) {
      const texto = v.observaciones_generales?.trim();
      if (texto) {
        vinetas.push(texto);
        vinetaVisitaIds.push(v.id);
      }
    }
    const todasLasFotos = ordenadas.flatMap((v) => v.fotos);
    bloques.push({
      estacion_id: primera.estacion_id,
      estacion_nombre: primera.estacion_nombre,
      operador_id: primera.operador_id,
      operador_nombre: primera.operador_nombre,
      responsable: primera.operador_nombre,
      hora_inicio: formatHora(ordenadas[0].fecha_hora_llegada),
      hora_fin: conSalida.length ? formatHora(conSalida[conSalida.length - 1].fecha_hora_salida!) : null,
      vinetas,
      vinetas_visita_ids: vinetaVisitaIds,
      fotos_seleccionadas: todasLasFotos.map((f) => f.id),
    });
  }
  return bloques.sort(
    (a, b) => a.estacion_nombre.localeCompare(b.estacion_nombre) || a.operador_nombre.localeCompare(b.operador_nombre),
  );
}

/** Todas las fotos disponibles ese día (recalculadas siempre desde las visitas — no se guardan en
 * `contenido`, solo los ids marcados en `fotos_seleccionadas`). */
export function fotosDelDia(visitasDia: VisitaCruda[]): FotoInforme[] {
  return visitasDia.flatMap((v) => v.fotos);
}

// ----------------------------------------------------------------------------
// Snapshot y detección de cambios (día ya aprobado)
// ----------------------------------------------------------------------------

export interface SnapshotVisita {
  visita_id: string;
  texto: string;
  actualizado_en: string;
}

/** Copia liviana de las visitas de un día en el momento de aprobarlo — comparar esto contra las
 * visitas actuales es lo que detecta "⚠️ Cambió algo". */
export function construirSnapshotDia(visitasDia: VisitaCruda[]): SnapshotVisita[] {
  return visitasDia.map((v) => ({
    visita_id: v.id,
    texto: v.observaciones_generales?.trim() ?? '',
    actualizado_en: v.updated_at,
  }));
}

export interface CambioDetectado {
  quien: string;
  cuando: string;
  textoAntes: string;
  textoAhora: string;
}

/** Compara el snapshot guardado al aprobar contra las visitas actuales del mismo día. Devuelve el
 * primer cambio encontrado (edición de una visita ya conocida, visita nueva, o visita borrada) o
 * `null` si no cambió nada — el mockup solo muestra un cuadro de diff a la vez, así que alcanza
 * con el primero. */
export function detectarCambioDia(snapshot: SnapshotVisita[] | null, visitasDiaActuales: VisitaCruda[]): CambioDetectado | null {
  if (!snapshot) return null;
  const snapshotPorId = new Map(snapshot.map((s) => [s.visita_id, s]));
  const actualesPorId = new Map(visitasDiaActuales.map((v) => [v.id, v]));

  for (const v of visitasDiaActuales) {
    const previa = snapshotPorId.get(v.id);
    const textoActual = v.observaciones_generales?.trim() ?? '';
    if (!previa) {
      return {
        quien: v.operador_nombre,
        cuando: formatHora(v.updated_at),
        textoAntes: '(no existía ninguna visita acá)',
        textoAhora: textoActual || '(sin observaciones)',
      };
    }
    if (previa.actualizado_en !== v.updated_at) {
      return {
        quien: v.operador_nombre,
        cuando: formatHora(v.updated_at),
        textoAntes: previa.texto || '(sin observaciones)',
        textoAhora: textoActual || '(sin observaciones)',
      };
    }
  }
  for (const s of snapshot) {
    if (!actualesPorId.has(s.visita_id)) {
      return {
        quien: '(visita eliminada)',
        cuando: '',
        textoAntes: s.texto || '(sin observaciones)',
        textoAhora: '(esta visita ya no existe)',
      };
    }
  }
  return null;
}

// ----------------------------------------------------------------------------
// Asistencia semanal
// ----------------------------------------------------------------------------

export const CODIGOS_ASISTENCIA = ['T', 'FT', 'DJ', 'DM', 'F', 'VA', 'PP', 'CM', 'M', 'PS', 'DE', 'PCD'] as const;

export const LEYENDA_CODIGOS_ASISTENCIA =
  'T = Trabajo · FT = Falto al trabajo · DJ = Descanso de jornada · DM = Descanso médico · F = Feriado · ' +
  'VA = Vacaciones anuales · PP = Permiso personal · CM = Cita médica · M = Maternidad · PS = Permiso sindical · ' +
  'DE = Decreto ejecutivo · PCD = Permiso por calamidad doméstica';

// ----------------------------------------------------------------------------
// PDF: resolver las fotos elegidas (ids) a base64, listas para pdfmake
// ----------------------------------------------------------------------------

export interface BloqueInformePdf {
  estacion_nombre: string;
  responsable: string;
  hora_inicio: string | null;
  hora_fin: string | null;
  vinetas: string[];
  fotos: { url: string; descripcion: string | null }[];
}

/** Convierte las fotos marcadas (`fotos_seleccionadas`, solo ids) de cada bloque a data URI
 * base64 — igual que `incrustarFotosVisitas` en fotos.ts hace para los otros reportes, pdfmake no
 * puede usar directo una URL remota de Drive como `image`. */
export async function incrustarFotosBloques(
  bloques: BloqueInforme[],
  fotosDisponibles: FotoInforme[],
): Promise<BloqueInformePdf[]> {
  const porId = new Map(fotosDisponibles.map((f) => [f.id, f]));
  return Promise.all(
    bloques.map(async (b) => {
      const seleccionadas = b.fotos_seleccionadas.map((id) => porId.get(id)).filter((f): f is FotoInforme => !!f);
      const fotos = await Promise.all(
        seleccionadas.map(async (f) => ({ url: (await urlAImagenBase64(f.url)) ?? f.url, descripcion: f.descripcion })),
      );
      return {
        estacion_nombre: b.estacion_nombre,
        responsable: b.responsable,
        hora_inicio: b.hora_inicio,
        hora_fin: b.hora_fin,
        vinetas: b.vinetas,
        fotos,
      };
    }),
  );
}

/** Código sugerido para una celda de la tabla de asistencia: "-" fin de semana, "F" feriado, "T"
 * si el operador tiene al menos una visita ese día, vacío si no hay nada de qué inferir (queda
 * para que la analista lo complete a mano — permisos, faltas, etc.). */
export function codigoAsistenciaSugerido(fechaIso: string, tieneVisitaEseDia: boolean, feriadosAdicionales: Set<string>): string {
  if (esFinDeSemana(fechaIso)) return '-';
  if (esFeriadoCalculado(fechaIso) || feriadosAdicionales.has(fechaIso)) return 'F';
  if (tieneVisitaEseDia) return 'T';
  return '';
}
