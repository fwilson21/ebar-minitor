// Lógica de datos del Informe Semanal (analista de redes, rol supervisor): arma un borrador
// automático a partir de las visitas ya registradas, agrupadas por día/estación/operador, y
// calcula si un día ya aprobado tuvo cambios después de aprobarse. Ver memoria del proyecto
// "Informe Semanal" para el bosquejo aprobado (fases, candado de semana, guardado día por día).
import { supabase } from './supabase';
import { urlMiniaturaDrive, urlAImagenBase64 } from './fotos';
import { esFinDeSemana, esFeriadoCalculado } from './feriadosEcuador';
import { direccionOParroquia } from './agruparEstaciones';
import type { RegistroEquipo } from './types';

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

/** Igual que formatRangoSemana pero sin la segunda "de" antes del año ("24 al 26 de julio 2026")
 * — pensado para el nombre del archivo del PDF, no para el texto dentro del documento. */
export function formatRangoParaArchivo(desde: string, hasta: string): string {
  const [yD, mD, dD] = desde.split('-').map(Number);
  const [yH, mH, dH] = hasta.split('-').map(Number);
  if (yD === yH && mD === mH) return `${dD} al ${dH} de ${MESES_LABEL[mD - 1]} ${yD}`;
  if (yD === yH) return `${dD} de ${MESES_LABEL[mD - 1]} al ${dH} de ${MESES_LABEL[mH - 1]} ${yD}`;
  return `${dD} de ${MESES_LABEL[mD - 1]} ${yD} al ${dH} de ${MESES_LABEL[mH - 1]} ${yH}`;
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

export interface RegistroBombaInforme {
  numero_bomba: number;
  estado: string;
  observaciones: string | null;
  voltaje_fuera_rango: boolean;
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
  estacion_ubicacion: string | null;
  operador_nombre: string;
  fotos: FotoInforme[];
  estado_estacion: string;
  nivel_tanque: string;
  cerramiento_observaciones: string | null;
  jardineras_observaciones: string | null;
  patios_maniobras_observaciones: string | null;
  olores_anormales: boolean;
  olores_descripcion: string | null;
  ruidos_extranos: boolean;
  ruidos_descripcion: string | null;
  bombas: RegistroBombaInforme[];
  lineas_impulsion: RegistroEquipo | null;
  guias_izado: RegistroEquipo | null;
  valvulas_compuerta: RegistroEquipo | null;
  valvulas_check: RegistroEquipo | null;
  valvula_aire: RegistroEquipo | null;
  camara_rejilla: RegistroEquipo | null;
  camara_valvula_compuerta: RegistroEquipo | null;
  tablero_distribucion: RegistroEquipo | null;
  variador: RegistroEquipo | null;
  descarga_emergencia: RegistroEquipo | null;
  tuberia_400_valvulas_aire: RegistroEquipo | null;
  tuberia_400_uniones_elastomericas: RegistroEquipo | null;
  tuberia_600_valvulas_aire: RegistroEquipo | null;
  tuberia_600_uniones_elastomericas: RegistroEquipo | null;
}

const SELECT_VISITA_INFORME = `id, estacion_id, operador_id, fecha_hora_llegada, fecha_hora_salida,
  observaciones_generales, updated_at, estado_estacion, nivel_tanque,
  cerramiento_observaciones, jardineras_observaciones, patios_maniobras_observaciones,
  olores_anormales, olores_descripcion, ruidos_extranos, ruidos_descripcion,
  lineas_impulsion, guias_izado, valvulas_compuerta, valvulas_check, valvula_aire,
  camara_rejilla, camara_valvula_compuerta, tablero_distribucion, variador, descarga_emergencia,
  tuberia_400_valvulas_aire, tuberia_400_uniones_elastomericas,
  tuberia_600_valvulas_aire, tuberia_600_uniones_elastomericas,
  estaciones_ebar ( nombre, direccion, parroquia ),
  usuarios ( nombre_completo ),
  registros_bombas ( numero_bomba, estado, observaciones, voltaje_fuera_rango ),
  fotos ( id, url_publica, drive_file_id, descripcion, tomada_en )`;

/** Todas las visitas cuya llegada cae dentro de `desde`..`hasta` (fechas locales YYYY-MM-DD),
 * con lo mínimo necesario para armar el Informe Semanal (no reutiliza SELECT_VISITA_REPORTE de
 * visitasReporte.ts porque acá hace falta id/estacion_id/operador_id/updated_at "en crudo" para
 * agrupar y para detectar cambios — ese otro select está pensado para el PDF de reportes, no para
 * esto). Trae también todos los campos de observaciones/estado de la hoja de visita (bombas,
 * equipos, cerramiento, etc.) para poder armar una viñeta por cada campo que el operador reportó
 * — ver `construirVinetasVisita`. */
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
    estacion_ubicacion: direccionOParroquia(v.estaciones_ebar ?? {}),
    operador_nombre: v.usuarios?.nombre_completo ?? '-',
    estado_estacion: v.estado_estacion,
    nivel_tanque: v.nivel_tanque,
    cerramiento_observaciones: v.cerramiento_observaciones,
    jardineras_observaciones: v.jardineras_observaciones,
    patios_maniobras_observaciones: v.patios_maniobras_observaciones,
    olores_anormales: v.olores_anormales,
    olores_descripcion: v.olores_descripcion,
    ruidos_extranos: v.ruidos_extranos,
    ruidos_descripcion: v.ruidos_descripcion,
    bombas: v.registros_bombas ?? [],
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

const ESTADO_ESTACION_LABEL: Record<string, string> = {
  operativa: 'Operativa',
  mantenimiento_correctivo: 'Mantenimiento correctivo',
  fuera_de_servicio: 'Fuera de servicio',
};

const ESTADO_BOMBA_LABEL: Record<string, string> = {
  encendida: 'Encendida',
  apagada: 'Apagada',
  en_falla: 'En falla',
  retirado_para_mantenimiento: 'Retirado para mantenimiento',
};

const ESTADO_EQUIPO_LABEL: Record<string, string> = {
  operativo: 'Operativo',
  en_falla: 'En falla',
  requiere_mantenimiento: 'Requiere mantenimiento',
};

/** Una viñeta para un equipo/subcategoría (cerramiento, válvulas, cámara, etc.) — solo si el
 * operador reportó algo digno de mención: escribió una observación, o el equipo quedó en un
 * estado distinto de "operativo" (aunque no haya escrito nada). Si `requiereTiene` viene, el
 * equipo es de los que primero preguntan "¿Tiene?" (ej. descarga de emergencia) — sin instalación
 * no hay nada que reportar. */
function vinetaEquipo(label: string, equipo: RegistroEquipo | null | undefined, requiereTiene = false): string | null {
  if (!equipo) return null;
  if (requiereTiene && equipo.tiene !== true) return null;
  const obs = equipo.observaciones?.trim();
  const estadoNotable = equipo.estado && equipo.estado !== 'operativo' ? ESTADO_EQUIPO_LABEL[equipo.estado] ?? equipo.estado : null;
  if (!obs && !estadoNotable) return null;
  const numeros = equipo.numeros_afectados?.length ? ` (N.º ${equipo.numeros_afectados.join(', ')})` : '';
  const partes = [estadoNotable, obs].filter(Boolean);
  return `${label}${numeros}: ${partes.join(' — ')}`;
}

function vinetaBomba(b: RegistroBombaInforme): string | null {
  const obs = b.observaciones?.trim();
  const estadoNotable = b.estado && b.estado !== 'encendida' ? ESTADO_BOMBA_LABEL[b.estado] ?? b.estado : null;
  if (!obs && !estadoNotable && !b.voltaje_fuera_rango) return null;
  const partes = [estadoNotable, b.voltaje_fuera_rango ? 'voltaje fuera de rango' : null, obs].filter(Boolean);
  return `Bomba ${b.numero_bomba}: ${partes.join(' — ')}`;
}

/** Arma una viñeta por cada campo que el operador realmente reportó en la visita (escribió una
 * observación, o dejó un estado distinto del normal) — cerramiento, jardineras, patios, bombas,
 * cada equipo, olores/ruidos, y el estado general si no quedó "operativa". Un campo que el
 * operador no tocó (sin texto, estado normal) no genera viñeta, para no inundar el informe con
 * líneas del tipo "Operativo" en todo lo que no tuvo novedad. `observaciones_generales` sigue
 * siendo, como siempre, la última viñeta si tiene texto. */
export function construirVinetasVisita(v: VisitaCruda): string[] {
  const vinetas: string[] = [];
  const agregar = (texto: string | null) => {
    if (texto) vinetas.push(texto);
  };

  if (v.estado_estacion && v.estado_estacion !== 'operativa') {
    const nivel = v.nivel_tanque ? `. Nivel de tanque: ${v.nivel_tanque.charAt(0).toUpperCase()}${v.nivel_tanque.slice(1)}` : '';
    agregar(`Estado de la estación: ${ESTADO_ESTACION_LABEL[v.estado_estacion] ?? v.estado_estacion}${nivel}`);
  }
  if (v.cerramiento_observaciones?.trim()) agregar(`Cerramiento y seguridad: ${v.cerramiento_observaciones.trim()}`);
  if (v.jardineras_observaciones?.trim()) agregar(`Jardineras y áreas verdes: ${v.jardineras_observaciones.trim()}`);
  if (v.patios_maniobras_observaciones?.trim()) agregar(`Patios de maniobras: ${v.patios_maniobras_observaciones.trim()}`);
  if (v.olores_anormales) agregar(`Olores anormales: ${v.olores_descripcion?.trim() || '(sin detalle)'}`);
  if (v.ruidos_extranos) agregar(`Ruidos extraños: ${v.ruidos_descripcion?.trim() || '(sin detalle)'}`);

  for (const b of [...v.bombas].sort((a, b) => a.numero_bomba - b.numero_bomba)) agregar(vinetaBomba(b));

  agregar(vinetaEquipo('Líneas de impulsión', v.lineas_impulsion));
  agregar(vinetaEquipo('Guías de izado de bombas', v.guias_izado));
  agregar(vinetaEquipo('Válvulas de compuerta', v.valvulas_compuerta));
  agregar(vinetaEquipo('Válvulas check', v.valvulas_check));
  agregar(vinetaEquipo('Válvula de aire', v.valvula_aire, true));
  agregar(vinetaEquipo('Cámara de llegada — Rejilla', v.camara_rejilla));
  agregar(vinetaEquipo('Cámara de llegada — Compuerta', v.camara_valvula_compuerta, true));
  agregar(vinetaEquipo('Tablero de distribución, contactores y breakers', v.tablero_distribucion));
  agregar(vinetaEquipo('Variadores de frecuencia', v.variador, true));
  agregar(vinetaEquipo('Descarga de emergencia', v.descarga_emergencia, true));
  agregar(vinetaEquipo('400mm — Válvulas de aire', v.tuberia_400_valvulas_aire));
  agregar(vinetaEquipo('400mm — Uniones elastoméricas', v.tuberia_400_uniones_elastomericas));
  agregar(vinetaEquipo('600mm — Válvulas de aire', v.tuberia_600_valvulas_aire));
  agregar(vinetaEquipo('600mm — Uniones elastoméricas', v.tuberia_600_uniones_elastomericas));

  if (v.observaciones_generales?.trim()) agregar(`Observaciones generales: ${v.observaciones_generales.trim()}`);

  return vinetas;
}

/** Si una viñeta viene con el patrón "Etiqueta: contenido" (como las arma
 * `construirVinetasVisita`), separa la etiqueta del resto — para resaltarla en negrita distinto
 * del contenido, tanto en pantalla (InformeSemanal.tsx) como en el PDF. Una viñeta sin ese patrón
 * (agregada a mano con "+ Agregar viñeta", o una vieja de antes de este cambio) devuelve `label`
 * null y el texto entero en `resto`, sin tocarla. El límite de 60 caracteres evita partir una
 * oración larga que por casualidad tenga un ": " en el medio. */
export function separarLabelVineta(texto: string): { label: string | null; resto: string } {
  const separador = texto.indexOf(': ');
  if (separador <= 0 || separador > 60) return { label: null, resto: texto };
  return { label: texto.slice(0, separador), resto: texto.slice(separador + 2) };
}

export interface BloqueInforme {
  estacion_id: string;
  estacion_nombre: string;
  estacion_ubicacion: string | null;
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
 * ordenados por estación y luego por operador. Las viñetas salen de cada campo que el operador
 * reportó en la visita (cerramiento, estado, jardineras, patios, bombas, equipos, observaciones
 * generales…) — ver `construirVinetasVisita`; una visita sin nada digno de mención no aporta
 * ninguna viñeta. */
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
      for (const texto of construirVinetasVisita(v)) {
        vinetas.push(texto);
        vinetaVisitaIds.push(v.id);
      }
    }
    const todasLasFotos = ordenadas.flatMap((v) => v.fotos);
    bloques.push({
      estacion_id: primera.estacion_id,
      estacion_nombre: primera.estacion_nombre,
      estacion_ubicacion: primera.estacion_ubicacion,
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
  estacion_ubicacion: string | null;
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
        estacion_ubicacion: b.estacion_ubicacion,
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
