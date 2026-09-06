import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { MEMBRETE_FONDO_BASE64 } from '../assets/membrete/membreteData';
import { formatFechaLarga, formatFechaCortaTabla, LEYENDA_CODIGOS_ASISTENCIA, type BloqueInformePdf } from './informeSemanal';
import { codigoYNombre, compararParaInforme } from './agruparEstaciones';
import { resumenARuns } from './resumenFormato';

(pdfMake as any).vfs = (pdfFonts as any).vfs;

export interface EquipoReporte {
  estado: string;
  observaciones?: string | null;
  numeros_afectados?: number[] | null;
  tiene?: boolean | null;
}

export interface VisitaParaReporte {
  /** id real de la visita — lo necesita la vista previa de Reportes para girar una foto ya subida. */
  id?: string;
  estacion_nombre: string;
  estacion_codigo: string;
  estacion_ubicacion?: string | null;
  estacion_tipo?: string;
  zona: string;
  fecha_hora_llegada: string;
  fecha_hora_salida?: string | null;
  operador_nombre: string;
  /** Cargo del operador (tabla usuarios) — usado solo por el formato "Súper compacto" para
   * rotular la firma; los otros formatos rotulan "Firma del operador" a secas. */
  operador_cargo?: string | null;
  estado_estacion: string;
  nivel_tanque: string;
  cerramiento_observaciones?: string | null;
  jardineras_observaciones?: string | null;
  patios_maniobras_observaciones?: string | null;
  observaciones_generales?: string | null;
  bombas: Array<{
    numero_bomba: number;
    estado: string;
    voltaje?: number | null;
    amperaje?: number | null;
    horas_operacion_acumuladas?: number | null;
    observaciones?: string | null;
    voltaje_fuera_rango: boolean;
  }>;
  lineas_impulsion?: EquipoReporte | null;
  guias_izado?: EquipoReporte | null;
  valvulas_compuerta?: EquipoReporte | null;
  valvulas_check?: EquipoReporte | null;
  valvula_aire?: EquipoReporte | null;
  camara_rejilla?: EquipoReporte | null;
  camara_valvula_compuerta?: EquipoReporte | null;
  tablero_distribucion?: EquipoReporte | null;
  variador?: EquipoReporte | null;
  descarga_emergencia?: EquipoReporte | null;
  tuberia_400_valvulas_aire?: EquipoReporte | null;
  tuberia_400_uniones_elastomericas?: EquipoReporte | null;
  tuberia_600_valvulas_aire?: EquipoReporte | null;
  tuberia_600_uniones_elastomericas?: EquipoReporte | null;
  fotos?: Array<{ url: string; etiqueta?: string | null; id?: string; tomada_en?: string }>;
  firma_url?: string | null;
}

function formatFechaHora(fechaISO: string): string {
  const d = new Date(fechaISO);
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const anio = d.getFullYear();
  const horas = String(d.getHours()).padStart(2, '0');
  const minutos = String(d.getMinutes()).padStart(2, '0');
  return `${dia}/${mes}/${anio}, ${horas}:${minutos}`;
}

const ESTADO_LABEL: Record<string, string> = {
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

const ESTADO_EQUIPO_COLOR: Record<string, string> = {
  operativo: '#059669',
  en_falla: '#B91C1C',
  requiere_mantenimiento: '#D97706',
};

const ETIQUETA_FOTO: Record<string, string> = {
  lineas_impulsion: 'Líneas de impulsión',
  guias_izado: 'Guías de izado de bombas',
  valvulas_compuerta: 'Válvulas de compuerta',
  valvulas_check: 'Válvulas check',
  valvula_aire: 'Válvula de aire',
  camara_rejilla: 'Cámara de llegada — Rejilla',
  camara_valvula_compuerta: 'Cámara de llegada — Compuerta',
  tablero_distribucion: 'Tablero de distribución',
  variador: 'Variadores de frecuencia',
  descarga_emergencia: 'Descarga de emergencia',
  tuberia_400_valvulas_aire: '400mm — Válvulas de aire',
  tuberia_400_uniones_elastomericas: '400mm — Uniones elastoméricas',
  tuberia_600_valvulas_aire: '600mm — Válvulas de aire',
  tuberia_600_uniones_elastomericas: '600mm — Uniones elastoméricas',
  cerramiento_seguridad: 'Cerramiento y seguridad',
  jardineras: 'Jardineras y áreas verdes',
  patios_maniobras: 'Patios de maniobras',
};

export function etiquetaFoto(etiqueta?: string | null): string {
  if (!etiqueta) return 'Foto general';
  const bomba = etiqueta.match(/^bomba_(\d+)$/);
  if (bomba) return `Bomba ${bomba[1]}`;
  return ETIQUETA_FOTO[etiqueta] ?? 'Foto general';
}

// Antes 3 columnas de 150x150 — el usuario pidió reducir la cantidad de hojas al imprimir en A4;
// las fotos son lo que más espacio vertical ocupa en el reporte completo (Reporte consolidado /
// Historial de estación), así que se achican y se ponen 4 por fila (mismo tamaño que ya usa
// Informe Semanal en filasFotosInforme, probado ahí) en vez de 3 más grandes.
// Ancho FIJO (no '*'): con columnas flexibles, 1 o 2 fotos se estiraban para ocupar todo el ancho
// de la fila (fotos gigantes, separadas entre sí) — con ancho fijo quedan agrupadas a la izquierda,
// del mismo tamaño haya 1, 2, 3 o 4, y el resto de la fila simplemente queda en blanco.
// 108/100 (antes 120/110): achicadas un poco más para que 2 categorías de 2 fotos cada una entren
// juntas en la misma línea (ver anchoCategoria) — pedido del usuario con captura mostrando
// "Cerramiento y seguridad" y "Jardineras y áreas verdes" (2 fotos cada una) en líneas separadas
// pudiendo compartir una sola.
function bloqueFotos(fotos?: Array<{ url: string; etiqueta?: string | null }>): any {
  if (!fotos?.length) return null;
  return {
    columns: fotos.slice(0, 4).map((f) => ({
      width: 108,
      // `unbreakable` evita que pdfmake corte la foto en una hoja y su leyenda en la siguiente
      // cuando la fila cae justo en el límite de página (bug reportado por el usuario, 2026-09-03).
      unbreakable: true,
      stack: [
        { image: f.url, fit: [100, 100], alignment: 'center' },
        { text: etiquetaFoto(f.etiqueta), fontSize: 7, alignment: 'center', color: '#5B7184', margin: [0, 2, 0, 0] },
      ],
    })),
    columnGap: 8,
    margin: [0, 2, 0, 4],
  };
}

/** Fotos de una visita cuya `etiqueta` (= `descripcion` en la tabla `fotos`) corresponde a una subcategoría puntual. */
function fotosDeSeccion(fotos: Array<{ url: string; etiqueta?: string | null }> | undefined, clave: string | null): Array<{ url: string; etiqueta?: string | null }> {
  return (fotos ?? []).filter((f) => (f.etiqueta ?? null) === clave);
}

// `titulo` es opcional: generarReporteVisitas ya no lo usa (esa línea quedaba redundante con el
// "Asunto" del encabezado tipo memo — ver bloqueEncabezadoMemo) — generarInformeSemanal y
// generarReporteTurnos sí lo siguen pasando.
function encabezado(titulo?: string): any {
  return {
    stack: [
      { text: 'GOBIERNO AUTÓNOMO DESCENTRALIZADO MUNICIPAL FRANCISCO DE ORELLANA', style: 'institucionalTitulo', alignment: 'center' },
      { text: 'DIRECCIÓN DE AGUA POTABLE Y ALCANTARILLADO', style: 'institucionalSub', alignment: 'center' },
      { text: 'JEFATURA DE SERVICIOS DE ALCANTARILLADO', style: 'institucionalSub', alignment: 'center' },
      ...(titulo ? [{ text: titulo, style: 'tituloReporte', alignment: 'center', margin: [0, 8, 0, 0] }] : []),
    ],
    margin: [0, 0, 0, 16],
  };
}

const MESES_LARGO = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** "El Coca, 6 de agosto de 2026" — formato de la fila "Fecha:" del encabezado tipo memo. */
function formatFechaMemo(fechaIso: string | null): string {
  if (!fechaIso) return '-';
  const [y, m, d] = fechaIso.split('-').map(Number);
  return `El Coca, ${d} de ${MESES_LARGO[m - 1]} de ${y}`;
}

export interface DatosEncabezadoMemo {
  numero: string;
  para: { nombre: string; cargo: string };
  de: { nombre: string; cargo: string };
  asunto: string;
  /** YYYY-MM-DD — se formatea acá mismo como "El Coca, D de mes de AAAA". */
  fecha: string | null;
}

/** Una EBAR sin ninguna visita en la fecha del reporte QUE YA TIENE justificación registrada (ver
 * migración 0055 / justificaciones_no_visita) — usada solo en "Reporte consolidado" de un solo
 * día (ver bloqueNoVisitadas). Reports.tsx ya filtra a solo las que tienen motivo antes de
 * armar esta lista — acá `motivo` nunca debería llegar null, pero el tipo se deja opcional por
 * si alguna vez se reutiliza esta interfaz sin ese filtro. */
export interface FilaNoVisitadaReporte {
  nombre: string;
  codigo: string;
  motivo: string | null;
  registrado_por: string | null;
}

/** Encabezado tipo memo institucional (formato GADMFO: "INFORME No. ..." + tabla PARA/DE/ASUNTO/
 * FECHA) — pedido explícito del usuario con una captura de referencia, usado tanto en el Informe
 * Semanal como en el Reporte consolidado/de estación/diario e Historial de estación (todos los que
 * arma generarReporteVisitas). Va después de encabezado() (el membrete institucional). */
function bloqueEncabezadoMemo(datos: DatosEncabezadoMemo): any {
  const filaEtiqueta = (texto: string) => ({ text: texto, bold: true, fillColor: '#DCE4E9', margin: [4, 3, 4, 3] });
  const filaValor = (contenido: any) => ({ ...contenido, fillColor: '#FFFFFF', margin: [6, 3, 6, 3] });
  return {
    stack: [
      // Solo Informe Semanal tiene un N.º de informe propio (formato GADMFO); los reportes de
      // visitas (Reporte consolidado/de estación/diario, Historial de estación) no tienen ese
      // concepto — con `numero` vacío, esta línea no se muestra.
      ...(datos.numero ? [{ text: `INFORME No. ${datos.numero}`, bold: true, fontSize: 11, alignment: 'center', margin: [0, 0, 0, 8] }] : []),
      {
        table: {
          widths: [60, '*'],
          body: [
            [filaEtiqueta('PARA:'), filaValor({ stack: [{ text: datos.para.nombre || '-', bold: true }, { text: (datos.para.cargo || '').toUpperCase(), bold: true }] })],
            [filaEtiqueta('DE:'), filaValor({ stack: [{ text: datos.de.nombre || '-', bold: true }, { text: (datos.de.cargo || '').toUpperCase(), bold: true }] })],
            [filaEtiqueta('ASUNTO:'), filaValor({ text: datos.asunto || '-' })],
            [filaEtiqueta('FECHA:'), filaValor({ text: formatFechaMemo(datos.fecha) })],
          ],
        },
        layout: {
          hLineWidth: () => 0.75,
          vLineWidth: () => 0.75,
          hLineColor: () => '#B9C6CE',
          vLineColor: () => '#B9C6CE',
        },
      },
    ],
    margin: [0, 0, 0, 16],
  };
}

/** "EBAR sin visitar" del día del reporte QUE YA TIENE motivo registrado (Reports.tsx filtra las
 * que no lo tienen antes de llegar acá — listar las 29 sin ninguna razón no aportaba nada) — solo
 * se agrega en "Reporte consolidado" de un solo día. Vacío = no se agrega nada. */
function bloqueNoVisitadas(filas: FilaNoVisitadaReporte[]): any {
  if (filas.length === 0) return null;
  return {
    stack: [
      { text: `EBAR sin visitar — motivo registrado (${filas.length})`, style: 'subtitulo', margin: [0, 4, 0, 4] },
      {
        table: {
          widths: ['auto', '*', '*'],
          body: [
            [{ text: 'Código', bold: true }, { text: 'Estación', bold: true }, { text: 'Motivo', bold: true }],
            ...filas.map((f) => [f.codigo, f.nombre, f.motivo ? `${f.motivo}${f.registrado_por ? ` (${f.registrado_por})` : ''}` : '-']),
          ],
        },
        layout: 'lightHorizontalLines',
      },
    ],
    margin: [0, 0, 0, 16],
  };
}

/** Bloque en formato párrafo: título del elemento en negrita y una línea por dato (Estado, Observaciones, etc).
 * Márgenes achicados a pedido del usuario (menos hojas al imprimir en A4). El título usa un color
 * propio (no el negro/gris del resto del texto) y letra más grande — pedido explícito para que se
 * note de un vistazo a qué categoría corresponde cada bloque, sobre todo ahora que varias caben en
 * la misma fila (ver cajaCategoria/empacarCajas). */
const COLOR_TITULO_CATEGORIA = '#1D4ED8';
function parrafoElemento(titulo: string, lineas: any[]): any {
  return {
    stack: [
      { text: titulo, bold: true, fontSize: 10.5, color: COLOR_TITULO_CATEGORIA, margin: [0, 0, 0, 2] },
      ...lineas.map((linea) => ({ text: linea, margin: [0, 0, 0, 0.5] })),
    ],
    margin: [0, 1, 0, 2],
  };
}

function parrafoEquipo(label: string, equipo?: EquipoReporte | null): any {
  const estado = equipo?.estado ?? 'operativo';
  const numeros = equipo?.numeros_afectados?.length ? ` (N.º ${equipo.numeros_afectados.join(', ')})` : '';
  return parrafoElemento(label + numeros, [
    [
      { text: 'Estado: ', bold: true },
      { text: ESTADO_EQUIPO_LABEL[estado] ?? estado, color: ESTADO_EQUIPO_COLOR[estado] ?? '#16303F', bold: true },
    ],
    [{ text: 'Observaciones: ', bold: true }, equipo?.observaciones || '-'],
  ]);
}

function parrafoTiene(label: string, equipo?: EquipoReporte | null): any {
  const tiene = equipo?.tiene ?? null;
  const lineas: any[] = [
    [
      { text: 'Tiene: ', bold: true },
      { text: tiene === true ? 'Sí' : tiene === false ? 'No' : '-', color: tiene === true ? '#059669' : '#16303F', bold: true },
    ],
  ];
  if (tiene) lineas.push([{ text: 'Observaciones: ', bold: true }, equipo?.observaciones || '-']);
  return parrafoElemento(label, lineas);
}

/** Como parrafoTiene(), pero cuando "Sí tiene" muestra además el Estado (3 opciones), igual que parrafoEquipo(). */
function parrafoTieneConEstado(label: string, equipo?: EquipoReporte | null): any {
  const tiene = equipo?.tiene ?? null;
  if (tiene !== true) {
    return parrafoElemento(label, [
      [{ text: 'Tiene: ', bold: true }, { text: tiene === false ? 'No' : '-', bold: true }],
    ]);
  }
  return parrafoEquipo(label, equipo);
}

// Margen izquierdo más ancho que el derecho: deja aire para perforar la hoja y archivarla sin
// perder texto — pedido del usuario (2026-09-05). Arriba/abajo 100pt para no encimar el logo ni
// el pie del membrete institucional (fondo de página). Compartido por los 3 reportes verticales
// (visitas, turnos, informe semanal); la planilla de horas extras es apaisada y lleva los suyos.
const MARGENES_PAGINA: [number, number, number, number] = [60, 100, 40, 100];
// Ancho útil del contenido en A4 vertical (595.28pt − margen izq − margen der) — contra esto se
// calculan todas las líneas y cajas de ancho fijo del reporte.
const ANCHO_CONTENIDO = 595.28 - MARGENES_PAGINA[0] - MARGENES_PAGINA[2];
const GAP_CAJAS = 8;

/** Línea horizontal fina para separar visualmente cada día en el Informe Semanal (bloqueDiaInforme).
 * En el Reporte consolidado ya no se usa: ahí cada categoría queda en su propia caja con borde
 * (ver cajaCategoria), que ya las separa. */
function lineaDivisoria(): any {
  return { canvas: [{ type: 'line', x1: 0, y1: 0, x2: ANCHO_CONTENIDO, y2: 0, lineWidth: 0.5, lineColor: '#E2E8F0' }], margin: [0, 2, 0, 2] };
}

/** Envuelve una categoría (párrafo + sus fotos) en una caja con borde fino — para que varias
 * categorías compactas (pocas fotos) puedan compartir la misma fila sin mezclarse visualmente
 * (pedido explícito del usuario, con captura de "Válvulas de compuerta/check/de aire" con 1 foto
 * cada una, apiladas ocupando 3 hojas de espacio de sobra). El truco de la tabla de 1x1 es la
 * forma estándar de pdfmake para ponerle borde a contenido cualquiera (no hay un "div con borde"
 * directo). */
function cajaCategoria(contenido: any[], ancho: number): any {
  return {
    width: ancho,
    table: { widths: ['*'], body: [[{ stack: contenido.filter(Boolean), margin: [6, 5, 6, 5] }]] },
    layout: {
      hLineWidth: () => 0.75,
      vLineWidth: () => 0.75,
      hLineColor: () => '#D8E0E6',
      vLineColor: () => '#D8E0E6',
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  };
}

/** Ancho de la caja según cuántas fotos tiene la categoría: con 3 o más ocupa toda la fila para
 * ella sola (se ve igual que antes); con 0-2 queda angosta, lista para compartir fila con otras
 * categorías compactas via empacarCajas(). */
function anchoCategoria(numFotos: number): number {
  if (numFotos >= 3) return ANCHO_CONTENIDO;
  // 236 = 2×108 (columnas de bloqueFotos) + 8 (separación entre las 2 fotos) + 12 (relleno
  // interno de la caja) — el mínimo real para que quepan 2 fotos sin desbordar la caja. Con este
  // ancho, 2 categorías de 2 fotos entran juntas en la misma línea (236×2 + 8 = 480 ≤ 515).
  if (numFotos === 2) return 236;
  if (numFotos === 1) return 150;
  return 160;
}

/** Acomoda una lista de cajas en filas —va agregando cajas a la fila actual mientras entren en el
 * ancho de la página, y arranca una fila nueva apenas la próxima ya no entra. Así 2 o 3 categorías
 * con pocas fotos comparten la misma línea en vez de ocupar una fila completa cada una. */
function empacarCajas(cajas: { ancho: number; contenido: any }[]): any[] {
  const filas: { ancho: number; contenido: any }[][] = [];
  let filaActual: { ancho: number; contenido: any }[] = [];
  let anchoFila = 0;
  for (const caja of cajas) {
    const espacioNecesario = caja.ancho + (filaActual.length > 0 ? GAP_CAJAS : 0);
    if (filaActual.length > 0 && anchoFila + espacioNecesario > ANCHO_CONTENIDO) {
      filas.push(filaActual);
      filaActual = [];
      anchoFila = 0;
    }
    filaActual.push(caja);
    anchoFila += caja.ancho + (filaActual.length > 1 ? GAP_CAJAS : 0);
  }
  if (filaActual.length > 0) filas.push(filaActual);
  return filas.map((fila) => ({
    columns: fila.map((c) => c.contenido),
    columnGap: GAP_CAJAS,
    margin: [0, 0, 0, 6],
  }));
}

/** Una categoría de una visita (una bomba, un equipo, una tubería, o un bloque de observaciones
 * sueltas como "Patios de maniobras") — el mismo dato de fondo alimenta las 2 presentaciones del
 * reporte: el formato Extenso la mete en una caja con borde junto a sus fotos (cajaCategoria +
 * bloqueFotos), el Compacto solo lista `parrafo` en texto corrido y junta UNA foto representativa
 * de cada categoría en una grilla aparte (ver bloqueVisitaCompacto/filasFotosCompacto). Que las 2
 * presentaciones lean de la misma fuente evita que se desincronicen si algún día se agrega/quita
 * una categoría. */
interface CategoriaVisita {
  label: string;
  parrafo: any;
  fotos: Array<{ url: string; etiqueta?: string | null }>;
}

function categoriasBombas(v: VisitaParaReporte): CategoriaVisita[] {
  return v.bombas.map((b) => {
    const label = `Bomba ${b.numero_bomba}`;
    const parrafo = parrafoElemento(label, [
      [{ text: 'Estado: ', bold: true }, ESTADO_BOMBA_LABEL[b.estado] ?? b.estado],
      [
        { text: 'Voltaje: ', bold: true },
        b.voltaje_fuera_rango
          ? { text: `${b.voltaje ?? '-'} V ⚠`, color: '#B91C1C', bold: true }
          : `${b.voltaje ?? '-'} V`,
      ],
      [{ text: 'Amperaje: ', bold: true }, `${b.amperaje ?? '-'} A`],
      [{ text: 'Horas acumuladas: ', bold: true }, `${b.horas_operacion_acumuladas ?? '-'}`],
      [{ text: 'Observaciones: ', bold: true }, b.observaciones || '-'],
    ]);
    return { label, parrafo, fotos: fotosDeSeccion(v.fotos, `bomba_${b.numero_bomba}`) };
  });
}

function categoriasEquipos(v: VisitaParaReporte): CategoriaVisita[] {
  const items: Array<{ clave: string; label: string; parrafo: any }> = [
    { clave: 'lineas_impulsion', label: 'Líneas de impulsión', parrafo: parrafoEquipo('Líneas de impulsión', v.lineas_impulsion) },
    { clave: 'guias_izado', label: 'Guías de izado de bombas', parrafo: parrafoEquipo('Guías de izado de bombas', v.guias_izado) },
    { clave: 'valvulas_compuerta', label: 'Válvulas de compuerta', parrafo: parrafoEquipo('Válvulas de compuerta', v.valvulas_compuerta) },
    { clave: 'valvulas_check', label: 'Válvulas check', parrafo: parrafoEquipo('Válvulas check', v.valvulas_check) },
    { clave: 'valvula_aire', label: 'Válvula de aire', parrafo: parrafoTieneConEstado('Válvula de aire', v.valvula_aire) },
    { clave: 'camara_rejilla', label: 'Cámara de llegada — Rejilla', parrafo: parrafoEquipo('Cámara de llegada — Rejilla', v.camara_rejilla) },
    { clave: 'camara_valvula_compuerta', label: 'Cámara de llegada — Compuerta', parrafo: parrafoTieneConEstado('Cámara de llegada — Compuerta', v.camara_valvula_compuerta) },
    { clave: 'tablero_distribucion', label: 'Tablero de distribución, contactores y breakers', parrafo: parrafoEquipo('Tablero de distribución, contactores y breakers', v.tablero_distribucion) },
    { clave: 'variador', label: 'Variadores de frecuencia', parrafo: parrafoTieneConEstado('Variadores de frecuencia', v.variador) },
    { clave: 'descarga_emergencia', label: 'Descarga de emergencia', parrafo: parrafoTiene('Descarga de emergencia', v.descarga_emergencia) },
  ];
  return items.map(({ clave, label, parrafo }) => ({ label, parrafo, fotos: fotosDeSeccion(v.fotos, clave) }));
}

function categoriasTuberias(v: VisitaParaReporte): CategoriaVisita[] {
  const items: Array<{ clave: string; label: string; parrafo: any }> = [
    { clave: 'tuberia_400_valvulas_aire', label: '400mm — Válvulas de aire', parrafo: parrafoEquipo('400mm — Válvulas de aire', v.tuberia_400_valvulas_aire) },
    { clave: 'tuberia_400_uniones_elastomericas', label: '400mm — Uniones elastoméricas', parrafo: parrafoEquipo('400mm — Uniones elastoméricas', v.tuberia_400_uniones_elastomericas) },
    { clave: 'tuberia_600_valvulas_aire', label: '600mm — Válvulas de aire', parrafo: parrafoEquipo('600mm — Válvulas de aire', v.tuberia_600_valvulas_aire) },
    { clave: 'tuberia_600_uniones_elastomericas', label: '600mm — Uniones elastoméricas', parrafo: parrafoEquipo('600mm — Uniones elastoméricas', v.tuberia_600_uniones_elastomericas) },
  ];
  return items.map(({ clave, label, parrafo }) => ({ label, parrafo, fotos: fotosDeSeccion(v.fotos, clave) }));
}

/** Cerramiento/jardineras/patios de maniobras/observaciones generales — solo entran las que
 * tienen texto (mismo criterio de siempre). */
function categoriasExtra(v: VisitaParaReporte): CategoriaVisita[] {
  return (
    [
      { label: 'Cerramiento y seguridad', texto: v.cerramiento_observaciones, clave: 'cerramiento_seguridad' },
      { label: 'Jardineras y áreas verdes', texto: v.jardineras_observaciones, clave: 'jardineras' },
      { label: 'Patios de maniobras', texto: v.patios_maniobras_observaciones, clave: 'patios_maniobras' },
      { label: 'Observaciones generales', texto: v.observaciones_generales, clave: null },
    ] as Array<{ label: string; texto?: string | null; clave: string | null }>
  )
    .filter((it) => it.texto)
    .map((it) => ({
      label: it.label,
      parrafo: { text: [{ text: `${it.label}: `, bold: true, color: COLOR_TITULO_CATEGORIA }, it.texto], margin: [0, 0, 0, 2] },
      fotos: fotosDeSeccion(v.fotos, it.clave),
    }));
}

function cajasDeCategorias(categorias: CategoriaVisita[]): { ancho: number; contenido: any }[] {
  return categorias.map((c) => {
    const ancho = anchoCategoria(c.fotos.length);
    return { ancho, contenido: cajaCategoria([c.parrafo, bloqueFotos(c.fotos)], ancho) };
  });
}

function bloqueEquipos(v: VisitaParaReporte): any {
  return [{ text: 'Estado de equipos', style: 'subtitulo', margin: [0, 2, 0, 4] }, ...empacarCajas(cajasDeCategorias(categoriasEquipos(v)))];
}

function bloqueTuberias(v: VisitaParaReporte): any {
  return [{ text: 'Tuberías de impulsión', style: 'subtitulo', margin: [0, 2, 0, 4] }, ...empacarCajas(cajasDeCategorias(categoriasTuberias(v)))];
}

function lineaCierreVisita(): any {
  return { canvas: [{ type: 'line', x1: 0, y1: 0, x2: ANCHO_CONTENIDO, y2: 0, lineWidth: 0.5, lineColor: '#CBD5E1' }], margin: [0, 2, 0, 6] };
}

/** Tabla de datos de la visita (estación/zona/llegada/salida/operador/estado/...) — idéntica para
 * el formato Extenso y el Compacto (el usuario pidió mantener el encabezado y los datos igual). */
function cabeceraVisita(v: VisitaParaReporte, esLineaConduccion: boolean): any {
  const filaTitulo = [
    { text: codigoYNombre({ codigo: v.estacion_codigo, nombre: v.estacion_nombre }), style: 'estacionTitulo', colSpan: 2 },
    {},
  ];
  const filaUbicacion = v.estacion_ubicacion ? [['Ubicación', v.estacion_ubicacion]] : [];

  const encabezadoTabla = esLineaConduccion
    ? [
        filaTitulo,
        ...filaUbicacion,
        ['Zona', v.zona],
        ['Llegada', formatFechaHora(v.fecha_hora_llegada)],
        ['Salida', v.fecha_hora_salida ? formatFechaHora(v.fecha_hora_salida) : '-'],
        ['Operador', v.operador_nombre],
        ['Estado general', ESTADO_LABEL[v.estado_estacion] ?? v.estado_estacion],
      ]
    : [
        filaTitulo,
        ...filaUbicacion,
        ['Zona', v.zona],
        ['Llegada', formatFechaHora(v.fecha_hora_llegada)],
        ['Salida', v.fecha_hora_salida ? formatFechaHora(v.fecha_hora_salida) : '-'],
        ['Operador', v.operador_nombre],
        ['Estado de la estación', ESTADO_LABEL[v.estado_estacion] ?? v.estado_estacion],
        ['Nivel de tanque', v.nivel_tanque],
      ];

  return {
    table: { widths: ['*', '*'], body: encabezadoTabla },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 4],
  };
}

function bloqueVisita(v: VisitaParaReporte): any[] {
  const esLineaConduccion = v.estacion_tipo === 'linea_conduccion';
  const cabecera = cabeceraVisita(v, esLineaConduccion);

  if (esLineaConduccion) {
    return [cabecera, bloqueTuberias(v), lineaCierreVisita()].filter(Boolean);
  }

  const cajasBombas = cajasDeCategorias(categoriasBombas(v));

  return [
    cabecera,
    { text: 'Registro de bombas', style: 'subtitulo', margin: [0, 2, 0, 4] },
    v.bombas.length > 0
      ? empacarCajas(cajasBombas)
      : { text: 'Sin registro de bombas en esta visita.', italics: true, fontSize: 9, color: '#5B7184', margin: [0, 0, 0, 3] },
    bloqueEquipos(v),
    ...empacarCajas(cajasDeCategorias(categoriasExtra(v))),
    lineaCierreVisita(),
  ].filter(Boolean);
}

/** Fotos representativas de un grupo de categorías: la primera foto de cada una que tenga alguna
 * (categorías sin fotos simplemente no aportan ninguna) — usada por el formato Compacto. */
function fotosRepresentativas(categorias: CategoriaVisita[]): Array<{ url: string; label: string }> {
  return categorias.filter((c) => c.fotos.length > 0).map((c) => ({ url: c.fotos[0].url, label: c.label }));
}

/** Grilla de fotos del formato Compacto: 5 por fila, con el nombre de la categoría centrado debajo
 * — mismo mecanismo que `filasFotosInforme` (Informe Semanal), a 5 en vez de 4. */
function filasFotosCompacto(items: Array<{ url: string; label: string }>): any[] {
  if (!items.length) return [];
  const filas: any[] = [];
  for (let i = 0; i < items.length; i += 5) {
    const grupo = items.slice(i, i + 5);
    filas.push({
      columns: grupo.map((it) => ({
        width: '*',
        // Ver comentario igual en bloqueFotos: sin esto, pdfmake puede dejar la foto en una hoja
        // y su leyenda en la siguiente cuando la fila cae en el límite de página.
        unbreakable: true,
        stack: [
          { image: it.url, fit: [90, 90], alignment: 'center' },
          { text: it.label, fontSize: 6.5, alignment: 'center', color: '#5B7184', margin: [0, 2, 0, 0] },
        ],
      })),
      columnGap: 6,
      margin: [0, 4, 0, 4],
    });
  }
  return filas;
}

/** Reparte una lista de párrafos en 2 columnas — el Compacto tiene puro texto corto (una línea de
 * "Estado: X" al lado de otra) que a columna única deja media página en blanco a la derecha (el
 * usuario lo señaló con captura); a 2 columnas se aprovecha el ancho y baja a la mitad el alto que
 * ocupa. `null` si no hay nada que repartir. */
function dosColumnas(parrafos: any[]): any {
  if (parrafos.length === 0) return null;
  const mitad = Math.ceil(parrafos.length / 2);
  return {
    columns: [
      { width: '*', stack: parrafos.slice(0, mitad) },
      { width: '*', stack: parrafos.slice(mitad) },
    ],
    columnGap: 16,
  };
}

/** Formato Compacto de una visita: misma cabecera de datos que el Extenso (bloqueVisita), pero las
 * categorías van listadas en texto corrido a 2 columnas (ver dosColumnas), sin la caja con borde
 * de cada una, y las fotos se juntan en una sola grilla al final — una foto representativa por
 * categoría en vez de todas las que se tomaron. Pedido explícito del usuario (2026-09-03) para un
 * reporte de menos hojas. */
function bloqueVisitaCompacto(v: VisitaParaReporte): any[] {
  const esLineaConduccion = v.estacion_tipo === 'linea_conduccion';
  const cabecera = cabeceraVisita(v, esLineaConduccion);

  if (esLineaConduccion) {
    const categorias = categoriasTuberias(v);
    return [
      cabecera,
      { text: 'Tuberías de impulsión', style: 'subtitulo', margin: [0, 2, 0, 4] },
      dosColumnas(categorias.map((c) => c.parrafo)),
      ...filasFotosCompacto(fotosRepresentativas(categorias)),
      lineaCierreVisita(),
    ].filter(Boolean);
  }

  const catBombas = categoriasBombas(v);
  const catEquipos = categoriasEquipos(v);
  const catExtra = categoriasExtra(v);

  return [
    cabecera,
    { text: 'Registro de bombas', style: 'subtitulo', margin: [0, 2, 0, 4] },
    catBombas.length > 0
      ? dosColumnas(catBombas.map((c) => c.parrafo))
      : { text: 'Sin registro de bombas en esta visita.', italics: true, fontSize: 9, color: '#5B7184', margin: [0, 0, 0, 3] },
    { text: 'Estado de equipos', style: 'subtitulo', margin: [0, 2, 0, 4] },
    dosColumnas(catEquipos.map((c) => c.parrafo)),
    catExtra.length > 0 ? { ...dosColumnas(catExtra.map((c) => c.parrafo)), margin: [0, 2, 0, 0] } : null,
    ...filasFotosCompacto(fotosRepresentativas([...catBombas, ...catEquipos, ...catExtra])),
    lineaCierreVisita(),
  ].filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// Formato "Súper compacto" (selector "Formato" en Reports.tsx) — pedido del usuario (2026-09-05).
// A diferencia de Extenso/Compacto (un bloque por visita), acá va UN bloque por
// operador + EBAR + DÍA: si el mismo operador visitó la misma EBAR dos veces el
// mismo día, se arma un solo resumen que menciona las dos horas. Cada bloque:
// encabezado corto + UN párrafo de resumen (≤6 líneas: datos objetivos de la visita
// + las observaciones que escribió el operador) + grilla de fotos (una
// representativa por capítulo, 5 por fila) + firma del operador.
// ─────────────────────────────────────────────────────────────────────────────

export interface GrupoDiario {
  estacion_nombre: string;
  estacion_codigo: string;
  estacion_ubicacion?: string | null;
  estacion_tipo?: string;
  zona: string;
  operador_nombre: string;
  operador_cargo?: string | null;
  firma_url?: string | null;
  /** YYYY-MM-DD */
  fecha: string;
  /** Ordenadas por hora de llegada. */
  visitas: VisitaParaReporte[];
}

/** Clave estable de un grupo (operador + estación + día) — para asociar el resumen editado en la
 * vista previa de Reportes con el grupo correcto al generar el PDF. */
export function claveGrupoDiario(g: Pick<GrupoDiario, 'operador_nombre' | 'estacion_codigo' | 'fecha'>): string {
  return `${g.operador_nombre}|${g.estacion_codigo}|${g.fecha}`;
}

/** Agrupa las visitas por (operador + estación + día). Los grupos salen ordenados por fecha,
 * luego EBAR/línea de conducción antes que PTAR (urbana antes que rural dentro de cada una, ver
 * compararParaInforme — pedido del usuario, 2026-09-06: las PTAR siempre al final del reporte),
 * luego operador; las visitas dentro de cada grupo, por hora. */
export function agruparVisitasPorDia(visitas: VisitaParaReporte[]): GrupoDiario[] {
  const mapa = new Map<string, GrupoDiario>();
  for (const v of visitas) {
    const fecha = v.fecha_hora_llegada.slice(0, 10);
    const clave = claveGrupoDiario({ operador_nombre: v.operador_nombre, estacion_codigo: v.estacion_codigo, fecha });
    let g = mapa.get(clave);
    if (!g) {
      g = {
        estacion_nombre: v.estacion_nombre,
        estacion_codigo: v.estacion_codigo,
        estacion_ubicacion: v.estacion_ubicacion,
        estacion_tipo: v.estacion_tipo,
        zona: v.zona,
        operador_nombre: v.operador_nombre,
        operador_cargo: v.operador_cargo,
        firma_url: v.firma_url,
        fecha,
        visitas: [],
      };
      mapa.set(clave, g);
    }
    g.visitas.push(v);
  }
  const grupos = [...mapa.values()];
  for (const g of grupos) g.visitas.sort((a, b) => a.fecha_hora_llegada.localeCompare(b.fecha_hora_llegada));
  grupos.sort(
    (a, b) =>
      a.fecha.localeCompare(b.fecha) ||
      compararParaInforme(
        { zona: a.zona, tipo: a.estacion_tipo ?? '', codigo: a.estacion_codigo },
        { zona: b.zona, tipo: b.estacion_tipo ?? '', codigo: b.estacion_codigo },
      ) ||
      a.operador_nombre.localeCompare(b.operador_nombre),
  );
  return grupos;
}

function formatHora(fechaISO: string): string {
  const d = new Date(fechaISO);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Corta un texto largo en el último espacio antes de `max` y le agrega "…" — para que el párrafo
 * de resumen no pase de ~6 líneas por más larga que sea la observación del operador. */
function recortarTexto(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  const cortado = texto.slice(0, max);
  const ultimoEspacio = cortado.lastIndexOf(' ');
  return `${(ultimoEspacio > max * 0.6 ? cortado.slice(0, ultimoEspacio) : cortado).trimEnd()}…`;
}

const EQUIPOS_RESUMEN: Array<{ clave: keyof VisitaParaReporte; label: string }> = [
  { clave: 'lineas_impulsion', label: 'líneas de impulsión' },
  { clave: 'guias_izado', label: 'guías de izado' },
  { clave: 'valvulas_compuerta', label: 'válvulas de compuerta' },
  { clave: 'valvulas_check', label: 'válvulas check' },
  { clave: 'valvula_aire', label: 'válvula de aire' },
  { clave: 'camara_rejilla', label: 'cámara de llegada (rejilla)' },
  { clave: 'camara_valvula_compuerta', label: 'cámara de llegada (compuerta)' },
  { clave: 'tablero_distribucion', label: 'tablero de distribución' },
  { clave: 'variador', label: 'variadores de frecuencia' },
  { clave: 'descarga_emergencia', label: 'descarga de emergencia' },
];

const TUBERIAS_RESUMEN: Array<{ clave: keyof VisitaParaReporte; label: string }> = [
  { clave: 'tuberia_400_valvulas_aire', label: '400mm válvulas de aire' },
  { clave: 'tuberia_400_uniones_elastomericas', label: '400mm uniones elastoméricas' },
  { clave: 'tuberia_600_valvulas_aire', label: '600mm válvulas de aire' },
  { clave: 'tuberia_600_uniones_elastomericas', label: '600mm uniones elastoméricas' },
];

/** Peor estado observado para un equipo a lo largo de las visitas del día ('en_falla' pesa más
 * que 'requiere_mantenimiento'; 'operativo' no es novedad). null = sin novedad. */
function peorEstadoEquipo(visitas: VisitaParaReporte[], clave: keyof VisitaParaReporte): string | null {
  let peor: string | null = null;
  for (const v of visitas) {
    const estado = (v[clave] as EquipoReporte | null | undefined)?.estado;
    if (estado === 'en_falla') return 'en_falla';
    if (estado === 'requiere_mantenimiento') peor = 'requiere_mantenimiento';
  }
  return peor;
}

/** El párrafo de resumen (≤6 líneas): datos objetivos de la(s) visita(s) del día + las
 * observaciones que escribió el operador, todo seguido en un solo párrafo. */
export function parrafoResumenDia(g: GrupoDiario): string {
  const partes: string[] = [];
  const { visitas } = g;
  const horas = visitas.map((v) => formatHora(v.fecha_hora_llegada));
  const esLC = g.estacion_tipo === 'linea_conduccion';

  if (visitas.length === 1) {
    const v = visitas[0];
    partes.push(`Visita a las ${horas[0]}${v.fecha_hora_salida ? `, salida ${formatHora(v.fecha_hora_salida)}` : ''}.`);
  } else {
    partes.push(`${visitas.length} visitas en el día (${horas.join(', ')}).`);
  }

  const ultima = visitas[visitas.length - 1];
  partes.push(`Estado general: ${(ESTADO_LABEL[ultima.estado_estacion] ?? ultima.estado_estacion).toLowerCase()}.`);
  if (!esLC && ultima.nivel_tanque) partes.push(`Nivel de tanque ${ultima.nivel_tanque}.`);

  if (!esLC) {
    const porEstado = new Map<string, Set<number>>();
    const voltajeFuera = new Set<number>();
    for (const v of visitas)
      for (const b of v.bombas) {
        if (!porEstado.has(b.estado)) porEstado.set(b.estado, new Set());
        porEstado.get(b.estado)!.add(b.numero_bomba);
        if (b.voltaje_fuera_rango) voltajeFuera.add(b.numero_bomba);
      }
    const trozos = [...porEstado.entries()].map(([estado, nums]) => {
      const lista = [...nums].sort((a, b) => a - b).join(', ');
      return `${nums.size > 1 ? 'bombas' : 'bomba'} ${lista} ${(ESTADO_BOMBA_LABEL[estado] ?? estado).toLowerCase()}`;
    });
    if (trozos.length) partes.push(`Bombas: ${trozos.join('; ')}.`);
    if (voltajeFuera.size)
      partes.push(
        `Voltaje fuera de rango en ${voltajeFuera.size > 1 ? 'las bombas' : 'la bomba'} ${[...voltajeFuera]
          .sort((a, b) => a - b)
          .join(', ')}.`,
      );
  }

  const catalogo = esLC ? TUBERIAS_RESUMEN : EQUIPOS_RESUMEN;
  const novedades = catalogo
    .map(({ clave, label }) => {
      const peor = peorEstadoEquipo(visitas, clave);
      return peor ? `${label} (${(ESTADO_EQUIPO_LABEL[peor] ?? peor).toLowerCase()})` : null;
    })
    .filter(Boolean);
  partes.push(novedades.length ? `Novedades en equipos: ${novedades.join(', ')}.` : 'Equipos sin novedad.');

  // Cada observación va con su etiqueta ("Jardineras: …") — sin eso, en el párrafo quedaban
  // varias frases sueltas ("Se requiere mantenimiento / Se requiere mantenimiento") sin decir de
  // qué hablaban (reportado por el usuario). Se sacan duplicados por si el mismo texto se repite
  // entre varias visitas del día.
  const obs: string[] = [];
  for (const v of visitas) {
    const etiquetadas: Array<[string, string | null | undefined]> = [
      ['Cerramiento', v.cerramiento_observaciones],
      ['Jardineras', v.jardineras_observaciones],
      ['Patios de maniobras', v.patios_maniobras_observaciones],
      ['Observaciones generales', v.observaciones_generales],
    ];
    for (const [etiqueta, texto] of etiquetadas) {
      const limpio = texto?.trim();
      if (limpio) {
        const frase = `${etiqueta}: ${limpio}`;
        if (!obs.includes(frase)) obs.push(frase);
      }
    }
  }
  if (obs.length) partes.push(obs.join('. ') + '.');

  return recortarTexto(partes.join(' '), 560);
}

/** Categorías del día combinando todas las visitas del grupo: para cada capítulo, la primera
 * versión que tenga alguna foto — así la grilla lleva una foto representativa por capítulo aunque
 * la foto se haya tomado en la primera visita del día y el resto de datos vengan de la segunda. */
function categoriasGrupo(g: GrupoDiario): CategoriaVisita[] {
  const esLC = g.estacion_tipo === 'linea_conduccion';
  const todas = g.visitas.flatMap((v) =>
    esLC ? categoriasTuberias(v) : [...categoriasBombas(v), ...categoriasEquipos(v), ...categoriasExtra(v)],
  );
  const porLabel = new Map<string, CategoriaVisita>();
  for (const c of todas) {
    const prev = porLabel.get(c.label);
    if (!prev || (prev.fotos.length === 0 && c.fotos.length > 0)) porLabel.set(c.label, c);
  }
  return [...porLabel.values()];
}

function bloqueGrupoSuperCompacto(g: GrupoDiario, resumenEditado?: string): any[] {
  const titulo = codigoYNombre({ codigo: g.estacion_codigo, nombre: g.estacion_nombre });
  return [
    {
      text: g.estacion_ubicacion ? `${titulo} — ${g.estacion_ubicacion}` : titulo,
      style: 'estacionTitulo',
      margin: [0, 4, 0, 3],
    },
    {
      text: [
        { text: 'Operador: ', bold: true },
        g.operador_nombre,
        { text: '     Fecha: ', bold: true },
        formatFechaDMY(g.fecha),
        { text: `     Zona: ${g.zona}`, color: '#5B7184' },
      ],
      fontSize: 8,
      margin: [0, 0, 0, 4],
    },
    {
      text: resumenARuns(resumenEditado?.trim() || parrafoResumenDia(g)),
      fontSize: 9,
      alignment: 'justify',
      margin: [0, 0, 0, 4],
    },
    ...filasFotosCompacto(fotosRepresentativas(categoriasGrupo(g))),
  ];
}

/** Espacio vertical fijo que NO se recorta ni siquiera si cae justo al inicio de una hoja nueva —
 * a diferencia de un `margin` (que sí se recorta ahí, ver bloqueFirmaSuperCompacto), esto es
 * contenido real (pdfmake calcula el alto de un `canvas` a partir de la geometría del rectángulo,
 * sin importar si algo se llega a pintar) cuya altura pdfmake respeta siempre. `fillOpacity: 0` es
 * a propósito y NO se puede sacar: sin `color`, pdfmake dibuja el rectángulo con un TRAZO NEGRO por
 * defecto (`vector.lineColor || 'black'` en su código), y `lineWidth: 0` no lo evita (usa
 * `vector.lineWidth || 1`, y 0 es falsy en JS) — comprobado generando un PDF de prueba real y
 * viendo el operador `S` (stroke) en el resultado antes de este ajuste. Dándole un `color` con
 * opacidad 0 entra por la rama de relleno (invisible) en vez de la de trazo. `alturaPt` en puntos
 * (72pt = 1 pulgada = 2.54cm). */
function espacioFijo(alturaPt: number): any {
  return { canvas: [{ type: 'rect', x: 0, y: 0, w: 1, h: alturaPt, color: '#ffffff', fillOpacity: 0 }] };
}

/** Firma del formato "Súper compacto": la raya mide lo mismo que la línea de texto más ancha
 * (nombre o cargo del operador) — se logra con una tabla de ancho 'auto' (se encoge exacto al
 * contenido) cuyo único borde visible es el de arriba. Va separada 4cm (≈113pt) de lo que quede
 * encima (la última fila de fotos, o el margen superior de la hoja si le toca sola al inicio de
 * una hoja nueva) — antes era un `margin`, que pdfmake recorta a 0 justo cuando el bloque cae al
 * inicio de una hoja (nada arriba de qué separarse), y la firma quedaba pegada al membrete
 * institucional. Con `espacioFijo` (contenido real, no margen) el espacio nunca se recorta —
 * pedido del usuario, con captura mostrando el caso pegado (2026-09-06). TODO el bloque (espacio +
 * foto de firma + raya/nombre/cargo) va `unbreakable`: si no fuera así, pdfmake podía separar el
 * espacio (que sí entraba al pie de la hoja anterior) de la firma en sí (que no entraba y pasaba
 * sola a la hoja siguiente) — mismo problema de origen, solo que el espacio quedaba "gastado" en
 * la hoja de atrás en vez de viajar junto con la firma. Comprobado generando un PDF de prueba e
 * inspeccionando las coordenadas reales del texto en el resultado. */
function bloqueFirmaSuperCompacto(nombre: string, cargo: string | null | undefined, firmaUrl?: string | null): any {
  const rotulo = (cargo && cargo.trim() ? cargo : 'OPERADOR').toUpperCase();
  const rayaYNombre = {
    table: {
      widths: ['auto'],
      body: [
        [
          {
            margin: [0, 3, 0, 0],
            stack: [
              { text: nombre, bold: true, fontSize: 9 },
              { text: rotulo, fontSize: 7, color: '#5B7184' },
            ],
          },
        ],
      ],
    },
    layout: {
      hLineWidth: (i: number) => (i === 0 ? 0.75 : 0),
      vLineWidth: () => 0,
      hLineColor: () => '#16303F',
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  };
  return {
    unbreakable: true,
    stack: [
      espacioFijo(113), // 4cm
      firmaUrl
        ? { image: firmaUrl, fit: [150, 48], alignment: 'left', margin: [0, 0, 0, 2] }
        : { text: ' ', margin: [0, 0, 0, 14] },
      rayaYNombre,
    ],
  };
}

/** Firmas al FINAL del reporte de visitas (los 3 formatos) — pedido del usuario (2026-09-06): la
 * firma del operador ya no va después de cada visita/bloque, solo una vez al final. Una firma por
 * operador distinto que aparezca en el reporte (por diario suele ser una sola). */
function bloqueFirmasFinales(visitas: VisitaParaReporte[]): any[] {
  const porOperador = new Map<string, VisitaParaReporte>();
  for (const v of visitas) if (!porOperador.has(v.operador_nombre)) porOperador.set(v.operador_nombre, v);
  return [...porOperador.values()].map((v) =>
    bloqueFirmaSuperCompacto(v.operador_nombre, v.operador_cargo, v.firma_url),
  );
}

// Compartido por los 3 generadores que firman (generarReporteVisitas, generarReporteTurnos,
// generarInformeSemanal) — pedido explícito del usuario (2026-09-03, con captura señalando el
// espacio vacío a la derecha de la firma): el bloque de firma era angosto (200pt de ancho fijo,
// línea de 180pt) dejando la mayor parte de la página en blanco. Se agranda el bloque entero
// (línea + nombre + cargo se achican/agrandan juntos, siguen centrados como un solo grupo bajo la
// línea) en vez de solo estirar el espacio vacío de al lado.
const ANCHO_BLOQUE_FIRMA = 320;
const ANCHO_LINEA_FIRMA = 280;

function bloqueFirma(nombre: string, etiqueta: string, firmaUrl?: string | null, espacioVacio = '\n\n') {
  return {
    columns: [
      {
        width: ANCHO_BLOQUE_FIRMA,
        stack: [
          firmaUrl
            ? { image: firmaUrl, fit: [190, 90], alignment: 'center' }
            : { text: espacioVacio },
          { canvas: [{ type: 'line', x1: 0, y1: 0, x2: ANCHO_LINEA_FIRMA, y2: 0, lineWidth: 0.5 }] },
          // Izquierda, no centrado (pedido del usuario) — la línea ya arranca en el borde
          // izquierdo de la columna (x1: 0 arriba), así nombre/cargo quedan alineados con ella en
          // vez de flotar centrados debajo de una línea que empieza a la izquierda.
          { text: nombre, alignment: 'left', style: 'firmaNombre' },
          { text: etiqueta, alignment: 'left', style: 'firmaEtiqueta' },
        ],
      },
      { text: '', width: '*' },
    ],
    // Más separación de lo que quede arriba (la grilla de fotos, en el formato Compacto) — pedido
    // del usuario con captura señalando que quedaban demasiado pegados.
    margin: [0, 28, 0, 0],
  };
}

const ESTILOS = {
  institucionalTitulo: { fontSize: 11, bold: true, color: '#0B1521' },
  institucionalSub: { fontSize: 9, bold: true, color: '#16303F' },
  tituloReporte: { fontSize: 11, bold: true, color: '#16303F' },
  estacionTitulo: { fontSize: 12, bold: true, fillColor: '#EEF2F6' },
  subtitulo: { fontSize: 10, bold: true, color: '#16303F' },
  firmaNombre: { fontSize: 9, bold: true },
  firmaEtiqueta: { fontSize: 7, color: '#5B7184' },
  pie: { fontSize: 7, color: '#94A3B8' },
};

export function generarReporteVisitas(
  visitas: VisitaParaReporte[],
  memo: DatosEncabezadoMemo,
  noVisitadas: FilaNoVisitadaReporte[] = [],
  formato: 'extenso' | 'compacto' | 'super_compacto' = 'extenso',
  /** Solo formato "super_compacto": resúmenes ya retocados por el operador en la vista previa de
   * Reportes, por `claveGrupoDiario`. Los grupos sin entrada usan el resumen auto-generado. */
  resumenesEditados: Record<string, string> = {},
): Promise<Blob> {
  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    // Márgenes generosos arriba/abajo para no encimarse con el logo y las
    // franjas de color del membrete institucional (fondo de página) ni con
    // el texto del pie de página.
    pageMargins: MARGENES_PAGINA,
    background: (_currentPage, pageSize) => ({
      image: MEMBRETE_FONDO_BASE64,
      width: pageSize.width,
      height: pageSize.height,
    }),
    footer: (currentPage: number, pageCount: number) => ({
      margin: [40, 12, 40, 25],
      stack: [
        {
          columns: [
            {
              width: '55%',
              margin: [95, 0, 0, 0],
              stack: [
                { text: 'www.orellana.gob.ec', fontSize: 7, bold: true, color: '#16303F' },
                { text: 'Francisco de Orellana – Ecuador', fontSize: 7, color: '#16303F' },
                { text: 'Calle Napo 11-05 y Uquillas', fontSize: 7, color: '#16303F' },
              ],
            },
            {
              width: '*',
              alignment: 'right',
              stack: [
                { text: 'DIRECCIÓN DE AGUA POTABLE Y ALCANTARILLADO', fontSize: 7, bold: true, color: '#16303F' },
                { text: 'TELF.: 062-999-060   Ext. 1801', fontSize: 7, color: '#16303F' },
              ],
            },
          ],
        },
        { text: `Hoja ${currentPage} de ${pageCount}`, alignment: 'center', fontSize: 7, color: '#16303F', margin: [0, 4, 0, 0] },
      ],
    }),
    content: [
      encabezado(),
      bloqueEncabezadoMemo(memo),
      // "EBAR sin visitar" va ACÁ (antes del detalle de visitas) para que siempre quede antes de
      // cualquier firma — pedido del usuario, que antes la veía después de la firma del último
      // operador porque se agregaba al final del documento.
      bloqueNoVisitadas(noVisitadas),
      // La firma del operador va SOLO al final del documento (ver bloqueFirmasFinales), no después
      // de cada visita/bloque — pedido del usuario (2026-09-06).
      // Súper compacto: un bloque por operador+EBAR+día (no por visita), sin salto de página
      // entre bloques — la idea es que quepan varios por hoja; solo una raya fina los separa.
      ...(formato === 'super_compacto'
        ? agruparVisitasPorDia(visitas).flatMap((g, idx, arr) => [
            ...bloqueGrupoSuperCompacto(g, resumenesEditados[claveGrupoDiario(g)]),
            idx < arr.length - 1 ? lineaCierreVisita() : null,
          ])
        : // Compacto/Extenso: mismo orden que Súper compacto — por fecha, luego EBAR/línea de
          // conducción antes que PTAR (ver compararParaInforme), luego código de estación.
          [...visitas]
            .sort(
              (a, b) =>
                a.fecha_hora_llegada.slice(0, 10).localeCompare(b.fecha_hora_llegada.slice(0, 10)) ||
                compararParaInforme(
                  { zona: a.zona, tipo: a.estacion_tipo ?? '', codigo: a.estacion_codigo },
                  { zona: b.zona, tipo: b.estacion_tipo ?? '', codigo: b.estacion_codigo },
                ) ||
                a.fecha_hora_llegada.localeCompare(b.fecha_hora_llegada),
            )
            .flatMap((v, idx, arr) => [
              ...(formato === 'compacto' ? bloqueVisitaCompacto(v) : bloqueVisita(v)),
              { text: '', pageBreak: idx < arr.length - 1 ? 'after' : undefined },
            ])),
      ...bloqueFirmasFinales(visitas),
    ].filter(Boolean),
    styles: ESTILOS,
    // 8 en vez de 9 — junto con los márgenes achicados de arriba, menos hojas al imprimir.
    defaultStyle: { fontSize: 8, color: '#16303F' },
  };

  return new Promise((resolve) => {
    pdfMake.createPdf(docDefinition).getBlob((blob: Blob) => resolve(blob));
  });
}

export interface FilaTurnoReporte {
  fecha: string; // ISO (YYYY-MM-DD)
  motivo: string; // 'Fin de semana' o nombre del feriado
  operadores: string[]; // nombres de quienes están de turno ese día
}

export interface ResumenOperadorReporte {
  nombre: string;
  dias: number;
}

export interface CedulaOperadorReporte {
  nombre: string;
  cedula: string;
}

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function formatFechaConDia(fechaIso: string): string {
  const d = new Date(`${fechaIso}T12:00:00`);
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return `${DIAS_SEMANA[d.getDay()]} ${dia}/${mes}/${d.getFullYear()}`;
}

/** Calendario de turnos de fin de semana/feriado: lista cronológica de días cubiertos + resumen
 * de días/horas por operador (mismo cálculo "días × 8 horas" que se llevaba a mano en Excel). */
export function generarReporteTurnos(
  tituloMes: string,
  filas: FilaTurnoReporte[],
  resumen: ResumenOperadorReporte[],
  cedulas: CedulaOperadorReporte[],
  firmante: { nombre: string; firmaUrl?: string | null },
): Promise<Blob> {
  const filasOrdenadas = [...filas].sort((a, b) => a.fecha.localeCompare(b.fecha));

  const tablaDias = {
    table: {
      widths: ['auto', '*', '*'],
      body: [
        [{ text: 'Fecha', bold: true }, { text: 'Motivo', bold: true }, { text: 'Operador(es) de turno', bold: true }],
        ...filasOrdenadas.map((f) => [formatFechaConDia(f.fecha), f.motivo, f.operadores.join('\n') || '-']),
      ],
    },
    layout: 'lightHorizontalLines',
    margin: [0, 4, 0, 16],
  };

  // Va al pie de la tabla de días (una fila por operador), no reordenada — mismo orden que ya
  // decidió quien llama.
  const tablaCedulas = {
    table: {
      widths: ['*', 'auto'],
      body: [
        [{ text: 'Operador', bold: true }, { text: 'Cédula', bold: true }],
        ...cedulas.map((c) => [c.nombre, c.cedula]),
      ],
    },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 16],
  };

  // El orden de `resumen` ya viene decidido por quien llama (orden preferido de operadores, no
  // alfabético) — acá no se reordena de nuevo.
  const tablaResumen = {
    table: {
      widths: ['*', 'auto', 'auto'],
      body: [
        [{ text: 'Operador', bold: true }, { text: 'Días de turno', bold: true }, { text: 'Horas', bold: true }],
        ...resumen.map((r) => [r.nombre, String(r.dias), `${r.dias} x 8 = ${r.dias * 8}`]),
      ],
    },
    layout: 'lightHorizontalLines',
  };

  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: MARGENES_PAGINA,
    background: (_currentPage, pageSize) => ({
      image: MEMBRETE_FONDO_BASE64,
      width: pageSize.width,
      height: pageSize.height,
    }),
    footer: (currentPage: number, pageCount: number) => ({
      margin: [40, 12, 40, 25],
      stack: [
        {
          columns: [
            {
              width: '55%',
              margin: [95, 0, 0, 0],
              stack: [
                { text: 'www.orellana.gob.ec', fontSize: 7, bold: true, color: '#16303F' },
                { text: 'Francisco de Orellana – Ecuador', fontSize: 7, color: '#16303F' },
                { text: 'Calle Napo 11-05 y Uquillas', fontSize: 7, color: '#16303F' },
              ],
            },
            {
              width: '*',
              alignment: 'right',
              stack: [
                { text: 'DIRECCIÓN DE AGUA POTABLE Y ALCANTARILLADO', fontSize: 7, bold: true, color: '#16303F' },
                { text: 'TELF.: 062-999-060   Ext. 1801', fontSize: 7, color: '#16303F' },
              ],
            },
          ],
        },
        { text: `Hoja ${currentPage} de ${pageCount}`, alignment: 'center', fontSize: 7, color: '#16303F', margin: [0, 4, 0, 0] },
      ],
    }),
    content: [
      encabezado(`Calendario de turnos — ${tituloMes}`),
      filasOrdenadas.length === 0
        ? { text: 'No hay turnos cargados este mes.', italics: true, margin: [0, 0, 0, 16] }
        : tablaDias,
      cedulas.length > 0 ? { text: 'Cédulas de los operadores de turno', style: 'subtitulo', margin: [0, 0, 0, 4] } : null,
      cedulas.length > 0 ? tablaCedulas : null,
      { text: 'Resumen del mes', style: 'subtitulo', margin: [0, 0, 0, 4] },
      resumen.length === 0 ? { text: 'Sin datos.', italics: true } : tablaResumen,
      { text: '', margin: [0, 30, 0, 0] },
      bloqueFirma(firmante.nombre, 'Administrador', firmante.firmaUrl, '\n\n\n\n\n'),
    ].filter(Boolean),
    styles: ESTILOS,
    defaultStyle: { fontSize: 9, color: '#16303F' },
  };

  return new Promise((resolve) => {
    pdfMake.createPdf(docDefinition).getBlob((blob: Blob) => resolve(blob));
  });
}

export interface FilaPlanillaReporte {
  fecha: string; // ISO (YYYY-MM-DD)
  descripcion: string;
  memorando: string;
  entradaManana: string;
  salidaManana: string;
  entradaTarde: string;
  salidaTarde: string;
  horasManana: string; // ya formateadas "HH:MM"
  horasTarde: string;
  horasExtra: string;
}

export interface DatosPlanillaReporte {
  direccion: string;
  area: string;
  nombreTrabajador: string;
  cargoTrabajador: string;
  fechaPresentacion: string | null; // ISO o null
  fechaDesde: string; // ISO
  fechaHasta: string; // ISO
  revisadoNombre: string;
  revisadoCargo: string;
  aprobadoNombre: string;
  aprobadoCargo: string;
  observaciones?: string | null;
}

function formatFechaDMY(fechaIso: string): string {
  const d = new Date(`${fechaIso}T12:00:00`);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Planilla de horas extras (formato de Talento Humano, apaisada) para un trabajador y período:
 * cabecera con dirección/área/ocupación, tabla de días con horario y horas, y las 3 firmas
 * (Revisado por / Aprobado por / Trabajador municipal) al pie. */
export function generarReportePlanillaHorasExtras(
  datos: DatosPlanillaReporte,
  filas: FilaPlanillaReporte[],
  totalHorasExtra: string,
): Promise<Blob> {
  const filasOrdenadas = [...filas].sort((a, b) => a.fecha.localeCompare(b.fecha));

  const tablaCabecera = {
    table: {
      widths: ['auto', '*', 'auto', '*'],
      body: [
        ['Dirección:', { text: datos.direccion, colSpan: 3 }, {}, {}],
        ['Área:', datos.area, 'Ocupación:', datos.cargoTrabajador],
        [
          'Nombres y apellidos:',
          { text: datos.nombreTrabajador, colSpan: 3 },
          {},
          {},
        ],
        [
          'Fecha de presentación:',
          datos.fechaPresentacion ? formatFechaDMY(datos.fechaPresentacion) : '-',
          'Período:',
          `${formatFechaDMY(datos.fechaDesde)} al ${formatFechaDMY(datos.fechaHasta)}`,
        ],
      ],
    },
    layout: 'noBorders',
    margin: [0, 0, 0, 20] as [number, number, number, number],
  };

  const tablaDias = {
    table: {
      headerRows: 1,
      widths: [55, '*', 170, 34, 34, 34, 34, 34, 34, 34],
      body: [
        [
          { text: 'Fecha', bold: true },
          { text: 'Descripción de actividades', bold: true },
          { text: 'N.º memorando', bold: true },
          { text: 'Entrada', bold: true },
          { text: 'Sale', bold: true },
          { text: 'Entrada', bold: true },
          { text: 'Sale', bold: true },
          { text: 'Mañana', bold: true },
          { text: 'Tarde', bold: true },
          { text: 'Extras', bold: true },
        ],
        ...filasOrdenadas.map((f) => [
          formatFechaDMY(f.fecha),
          { text: f.descripcion || '-', fontSize: 7.5 },
          { text: f.memorando || '-', fontSize: 7.5 },
          f.entradaManana || '-',
          f.salidaManana || '-',
          f.entradaTarde || '-',
          f.salidaTarde || '-',
          f.horasManana,
          f.horasTarde,
          { text: f.horasExtra, bold: true },
        ]),
        [
          { text: 'TOTAL HORAS', colSpan: 9, bold: true, alignment: 'right' },
          {}, {}, {}, {}, {}, {}, {}, {},
          { text: totalHorasExtra, bold: true },
        ],
      ],
    },
    layout: 'lightHorizontalLines',
    fontSize: 8,
    margin: [0, 0, 0, 6] as [number, number, number, number],
  };

  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    // Margen superior más chico que en los reportes verticales: el membrete de fondo se estira al
    // ancho de la hoja apaisada y queda proporcionalmente más bajo, así que 90pt dejaba un hueco
    // vacío entre el membrete y el título — con 55pt el contenido queda pegado justo debajo.
    pageMargins: [30, 68, 30, 80],
    background: (_currentPage, pageSize) => ({
      image: MEMBRETE_FONDO_BASE64,
      width: pageSize.width,
      height: pageSize.height,
    }),
    footer: (currentPage: number, pageCount: number) => ({
      margin: [30, 10, 30, 20],
      stack: [
        {
          columns: [
            {
              width: '40%',
              margin: [95, 0, 0, 0],
              stack: [
                { text: 'www.orellana.gob.ec', fontSize: 7, bold: true, color: '#16303F' },
                { text: 'Francisco de Orellana – Ecuador', fontSize: 7, color: '#16303F' },
                { text: 'Calle Napo 11-05 y Uquillas', fontSize: 7, color: '#16303F' },
              ],
            },
            {
              width: '*',
              alignment: 'right',
              stack: [
                { text: 'DIRECCIÓN DE AGUA POTABLE Y ALCANTARILLADO', fontSize: 7, bold: true, color: '#16303F' },
                { text: 'TELF.: 062-999-060   Ext. 1801', fontSize: 7, color: '#16303F' },
              ],
            },
          ],
        },
        { text: `Hoja ${currentPage} de ${pageCount}`, alignment: 'center', fontSize: 7, color: '#16303F', margin: [0, 4, 0, 0] },
      ],
    }),
    content: [
      encabezado('Planilla de horas extras'),
      tablaCabecera,
      filasOrdenadas.length === 0
        ? { text: 'No hay días cargados en este período.', italics: true, margin: [0, 0, 0, 16] }
        : tablaDias,
      { text: 'Nota: en todos los casos se descuenta 1 hora de almuerzo al medio día.', fontSize: 7.5, italics: true, margin: [0, 0, 0, datos.observaciones?.trim() ? 4 : 24] },
      ...(datos.observaciones?.trim()
        ? [{
            text: [{ text: 'Observaciones: ', bold: true }, datos.observaciones.trim()],
            fontSize: 7.5,
            margin: [0, 0, 0, 24] as [number, number, number, number],
          }]
        : []),
      {
        columns: [
          firmaSimple(datos.revisadoNombre, 'REVISADO POR', datos.revisadoCargo),
          firmaSimple(datos.aprobadoNombre, 'APROBADO POR', datos.aprobadoCargo),
          firmaSimple(datos.nombreTrabajador, 'TRABAJADOR MUNICIPAL', datos.cargoTrabajador),
        ],
        columnGap: 20,
      },
    ],
    styles: ESTILOS,
    defaultStyle: { fontSize: 9, color: '#16303F' },
  };

  return new Promise((resolve) => {
    pdfMake.createPdf(docDefinition).getBlob((blob: Blob) => resolve(blob));
  });
}

/** Línea centrada dentro de su columna sin importar el ancho real que le toque (las 3 firmas
 * usan columnas '*', cuyo ancho en puntos solo lo sabe pdfmake al momento de maquetar) — envolver
 * el canvas entre dos espaciadores '*' de igual ancho lo centra siempre, en vez de un x1/x2 fijo
 * que solo queda centrado para un ancho de columna exacto. */
function lineaCentrada(ancho = 170): any {
  return {
    columns: [
      { text: '', width: '*' },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: ancho, y2: 0, lineWidth: 0.5 }], width: ancho },
      { text: '', width: '*' },
    ],
    margin: [0, 30, 0, 4],
  };
}

/** Bloque de firma simple (línea + nombre + rótulo + cargo), usado en la planilla de horas
 * extras — distinto de bloqueFirma() porque acá van 3 firmas lado a lado sin foto de firma. */
function firmaSimple(nombre: string, rotulo: string, cargo: string): any {
  return {
    width: '*',
    stack: [
      lineaCentrada(),
      { text: nombre, alignment: 'center', style: 'firmaNombre' },
      { text: rotulo, alignment: 'center', fontSize: 7, bold: true, color: '#16303F' },
      { text: cargo, alignment: 'center', style: 'firmaEtiqueta' },
    ],
  };
}

export interface DiaInformePdf {
  fecha: string;
  esFeriado: boolean;
  nombreFeriado?: string;
  /** false si el día todavía no se aprobó — el informe ya no exige los 5 días aprobados para
   * generarse, así que un día pendiente entra igual pero sin su contenido. */
  aprobado: boolean;
  bloques: BloqueInformePdf[];
}

export interface DatosInformeSemanal {
  antecedentes: string;
  conclusiones: string;
  recomendaciones: string;
  firmaFecha: string | null;
  firmaNombre: string;
  firmaCargo: string;
  paraNombre: string;
  paraCargo: string;
  asunto: string;
  numeroInforme: string;
  semanaDesde: string;
  semanaHasta: string;
  dias: DiaInformePdf[];
  operadores: { id: string; nombre_completo: string }[];
  asistencia: Record<string, Record<string, string>>;
  /** Los 5 días laborables + sábado/domingo, para las columnas de la tabla de asistencia. */
  diasTabla: string[];
}

// Grilla de fotos del Informe Semanal: 5 por fila con el nombre del capítulo debajo (Bomba 1,
// Válvula de aire, …) — mismo formato que el reporte "Súper compacto" (pedido del usuario,
// 2026-09-05; antes eran 4 por fila con la leyenda "Foto N: bomba_1", que no se entendía).
function filasFotosInforme(fotos: { url: string; descripcion: string | null }[]): any[] {
  if (!fotos.length) return [];
  const filas: any[] = [];
  for (let i = 0; i < fotos.length; i += 5) {
    const grupo = fotos.slice(i, i + 5);
    filas.push({
      columns: grupo.map((f) => ({
        width: '*',
        // Ver comentario igual en bloqueFotos: sin esto, pdfmake puede dejar la foto en una hoja
        // y su leyenda en la siguiente cuando la fila cae en el límite de página.
        unbreakable: true,
        stack: [
          { image: f.url, fit: [90, 90], alignment: 'center' },
          {
            text: etiquetaFoto(f.descripcion),
            fontSize: 6.5,
            alignment: 'center',
            color: '#5B7184',
            margin: [0, 2, 0, 0],
          },
        ],
      })),
      columnGap: 6,
      margin: [0, 4, 0, 4],
    });
  }
  return filas;
}

function bloqueOperadorInforme(b: BloqueInformePdf): any[] {
  const horario = b.hora_inicio || b.hora_fin ? ` (${b.hora_inicio ?? '—'} – ${b.hora_fin ?? '—'})` : '';
  const ubicacion = b.estacion_ubicacion ? ` — ${b.estacion_ubicacion}` : '';
  return [
    { text: `${b.estacion_nombre}${ubicacion}${horario}`, bold: true, fontSize: 10, margin: [0, 5, 0, 1] },
    { text: [{ text: 'Responsable: ', bold: true }, b.responsable], fontSize: 9, margin: [0, 0, 0, 3] },
    {
      text: resumenARuns(b.resumen?.trim() || 'Sin observaciones registradas.'),
      fontSize: 9,
      alignment: 'justify',
      margin: [0, 0, 0, 2],
    },
    ...filasFotosInforme(b.fotos),
  ];
}

function bloqueDiaInforme(d: DiaInformePdf): any[] {
  if (d.esFeriado) {
    return [
      {
        text: `${formatFechaLarga(d.fecha)} — Feriado${d.nombreFeriado ? ` (${d.nombreFeriado})` : ''}. Sin actividad registrada.`,
        italics: true,
        fontSize: 9,
        color: '#5B7184',
        margin: [0, 0, 0, 8],
      },
    ];
  }
  // Día sin aprobar: no entra al informe impreso — ni su contenido ni ninguna mención de que
  // existe (a diferencia del feriado de arriba, que sí es informativo aunque no haya actividad).
  if (!d.aprobado) return [];
  if (d.bloques.length === 0) {
    return [
      {
        text: `${formatFechaLarga(d.fecha)} — Ningún operador registró visitas.`,
        italics: true,
        fontSize: 9,
        color: '#5B7184',
        margin: [0, 0, 0, 8],
      },
    ];
  }
  return [
    { text: formatFechaLarga(d.fecha), style: 'estacionTitulo', margin: [0, 8, 0, 4] },
    ...d.bloques.flatMap(bloqueOperadorInforme),
    lineaDivisoria(),
  ];
}

function tablaAsistenciaInforme(datos: DatosInformeSemanal): any {
  return {
    table: {
      headerRows: 1,
      widths: ['*', ...datos.diasTabla.map(() => 30)],
      body: [
        [
          { text: 'Operador', bold: true, fontSize: 8 },
          ...datos.diasTabla.map((f) => {
            const { dia, abrev } = formatFechaCortaTabla(f);
            return { text: `${dia}\n${abrev}`, bold: true, fontSize: 7, alignment: 'center' };
          }),
        ],
        ...datos.operadores.map((op) => [
          { text: op.nombre_completo, fontSize: 8 },
          ...datos.diasTabla.map((f) => ({
            text: datos.asistencia[op.id]?.[f] || '-',
            fontSize: 8,
            alignment: 'center',
          })),
        ]),
      ],
    },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 6],
  };
}

/** Informe Semanal de la analista de redes (formato GADMFO): antecedentes, desarrollo de la
 * semana día por día (estación/responsable/viñetas/fotos), tabla de asistencia, conclusiones,
 * recomendaciones y firma. Las fotos de `datos.dias[].bloques[].fotos` deben venir ya
 * convertidas a base64 (ver `incrustarFotosBloques` en informeSemanal.ts) — pdfmake no puede usar
 * directo una URL remota de Drive como `image`, igual que en `generarReporteVisitas`. */
export function generarInformeSemanal(datos: DatosInformeSemanal): Promise<Blob> {
  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: MARGENES_PAGINA,
    background: (_currentPage, pageSize) => ({
      image: MEMBRETE_FONDO_BASE64,
      width: pageSize.width,
      height: pageSize.height,
    }),
    footer: (currentPage: number, pageCount: number) => ({
      margin: [40, 12, 40, 25],
      stack: [
        {
          columns: [
            {
              width: '55%',
              margin: [95, 0, 0, 0],
              stack: [
                { text: 'www.orellana.gob.ec', fontSize: 7, bold: true, color: '#16303F' },
                { text: 'Francisco de Orellana – Ecuador', fontSize: 7, color: '#16303F' },
                { text: 'Calle Napo 11-05 y Uquillas', fontSize: 7, color: '#16303F' },
              ],
            },
            {
              width: '*',
              alignment: 'right',
              stack: [
                { text: 'DIRECCIÓN DE AGUA POTABLE Y ALCANTARILLADO', fontSize: 7, bold: true, color: '#16303F' },
                { text: 'TELF.: 062-999-060   Ext. 1801', fontSize: 7, color: '#16303F' },
              ],
            },
          ],
        },
        { text: `Hoja ${currentPage} de ${pageCount}`, alignment: 'center', fontSize: 7, color: '#16303F', margin: [0, 4, 0, 0] },
      ],
    }),
    content: [
      encabezado('INFORME SEMANAL'),
      {
        text: `Del ${formatFechaDMY(datos.semanaDesde)} al ${formatFechaDMY(datos.semanaHasta)}`,
        alignment: 'center',
        fontSize: 9,
        color: '#5B7184',
        margin: [0, -10, 0, 14],
      },
      bloqueEncabezadoMemo({
        numero: datos.numeroInforme,
        para: { nombre: datos.paraNombre, cargo: datos.paraCargo },
        de: { nombre: datos.firmaNombre, cargo: datos.firmaCargo },
        asunto: datos.asunto,
        fecha: datos.firmaFecha,
      }),
      { text: 'ANTECEDENTES', style: 'subtitulo', margin: [0, 0, 0, 4] },
      { text: datos.antecedentes || '-', fontSize: 9, margin: [0, 0, 0, 14] },
      { text: 'DESARROLLO DE LA SEMANA', style: 'subtitulo', margin: [0, 0, 0, 2] },
      ...datos.dias.flatMap(bloqueDiaInforme),
      // Sin pageBreak:'before' a propósito: si el contenido de arriba termina justo al borde de
      // una página, un salto forzado incondicional deja una página en blanco antes de esta
      // sección (pdfmake no sabe "saltar solo si hace falta") — mismo motivo por el que el resto
      // del documento no fuerza saltos entre secciones, deja que fluya solo.
      { text: 'CONTROL SEMANAL DEL PERSONAL', style: 'subtitulo', margin: [0, 10, 0, 6] },
      tablaAsistenciaInforme(datos),
      { text: LEYENDA_CODIGOS_ASISTENCIA, fontSize: 7, color: '#5B7184', margin: [0, 0, 0, 14] },
      { text: 'CONCLUSIONES', style: 'subtitulo', margin: [0, 0, 0, 4] },
      { text: datos.conclusiones || '-', fontSize: 9, margin: [0, 0, 0, 10] },
      { text: 'RECOMENDACIONES', style: 'subtitulo', margin: [0, 0, 0, 4] },
      { text: datos.recomendaciones || '-', fontSize: 9, margin: [0, 0, 0, 14] },
      { text: `Fecha de emisión: ${datos.firmaFecha ? formatFechaDMY(datos.firmaFecha) : '-'}`, fontSize: 9, margin: [0, 0, 0, 4] },
      bloqueFirma(datos.firmaNombre, datos.firmaCargo, null),
    ],
    styles: ESTILOS,
    defaultStyle: { fontSize: 9, color: '#16303F' },
  };

  return new Promise((resolve) => {
    pdfMake.createPdf(docDefinition).getBlob((blob: Blob) => resolve(blob));
  });
}

export function descargarBlob(blob: Blob, nombreArchivo: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Abre el PDF en una pestaña nueva (visor de PDF del navegador) para que el
 * usuario lo vea de inmediato sin tener que ir a buscarlo en Descargas.
 */
export function abrirBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}
