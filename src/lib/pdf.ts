import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { MEMBRETE_FONDO_BASE64 } from '../assets/membrete/membreteData';

(pdfMake as any).vfs = (pdfFonts as any).vfs;

export interface EquipoReporte {
  estado: string;
  observaciones?: string | null;
  numeros_afectados?: number[] | null;
  tiene?: boolean | null;
}

export interface VisitaParaReporte {
  estacion_nombre: string;
  estacion_codigo: string;
  estacion_tipo?: string;
  zona: string;
  fecha_hora_llegada: string;
  fecha_hora_salida?: string | null;
  operador_nombre: string;
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
  fotos?: Array<{ url: string; etiqueta?: string | null }>;
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

function etiquetaFoto(etiqueta?: string | null): string {
  if (!etiqueta) return 'Foto general';
  const bomba = etiqueta.match(/^bomba_(\d+)$/);
  if (bomba) return `Bomba ${bomba[1]}`;
  return ETIQUETA_FOTO[etiqueta] ?? 'Foto general';
}

function bloqueFotos(fotos?: Array<{ url: string; etiqueta?: string | null }>): any {
  if (!fotos?.length) return null;
  return {
    columns: fotos.slice(0, 3).map((f) => ({
      width: '*',
      stack: [
        { image: f.url, fit: [150, 150], alignment: 'center' },
        { text: etiquetaFoto(f.etiqueta), fontSize: 7, alignment: 'center', color: '#5B7184', margin: [0, 2, 0, 0] },
      ],
    })),
    columnGap: 8,
    margin: [0, 4, 0, 8],
  };
}

/** Fotos de una visita cuya `etiqueta` (= `descripcion` en la tabla `fotos`) corresponde a una subcategoría puntual. */
function fotosDeSeccion(fotos: Array<{ url: string; etiqueta?: string | null }> | undefined, clave: string | null): Array<{ url: string; etiqueta?: string | null }> {
  return (fotos ?? []).filter((f) => (f.etiqueta ?? null) === clave);
}

function encabezado(titulo: string): any {
  return {
    stack: [
      { text: 'GOBIERNO AUTÓNOMO DESCENTRALIZADO MUNICIPAL FRANCISCO DE ORELLANA', style: 'institucionalTitulo', alignment: 'center' },
      { text: 'DIRECCIÓN DE AGUA POTABLE Y ALCANTARILLADO', style: 'institucionalSub', alignment: 'center' },
      { text: 'JEFATURA DE SERVICIOS DE ALCANTARILLADO', style: 'institucionalSub', alignment: 'center' },
      { text: titulo, style: 'tituloReporte', alignment: 'center', margin: [0, 8, 0, 0] },
    ],
    margin: [0, 0, 0, 16],
  };
}

/** Bloque en formato párrafo: título del elemento en negrita y una línea por dato (Estado, Observaciones, etc). */
function parrafoElemento(titulo: string, lineas: any[]): any {
  return {
    stack: [
      { text: titulo, bold: true, fontSize: 10, margin: [0, 0, 0, 3] },
      ...lineas.map((linea) => ({ text: linea, margin: [0, 0, 0, 1] })),
    ],
    margin: [0, 2, 0, 4],
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

/** Línea horizontal fina para separar visualmente cada subcategoría en el PDF. */
function lineaDivisoria(): any {
  return { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#E2E8F0' }], margin: [0, 4, 0, 4] };
}

function bloqueEquipos(v: VisitaParaReporte): any {
  const items: Array<{ clave: string; parrafo: any }> = [
    { clave: 'lineas_impulsion', parrafo: parrafoEquipo('Líneas de impulsión', v.lineas_impulsion) },
    { clave: 'guias_izado', parrafo: parrafoEquipo('Guías de izado de bombas', v.guias_izado) },
    { clave: 'valvulas_compuerta', parrafo: parrafoEquipo('Válvulas de compuerta', v.valvulas_compuerta) },
    { clave: 'valvulas_check', parrafo: parrafoEquipo('Válvulas check', v.valvulas_check) },
    { clave: 'valvula_aire', parrafo: parrafoTieneConEstado('Válvula de aire', v.valvula_aire) },
    { clave: 'camara_rejilla', parrafo: parrafoEquipo('Cámara de llegada — Rejilla', v.camara_rejilla) },
    { clave: 'camara_valvula_compuerta', parrafo: parrafoTieneConEstado('Cámara de llegada — Compuerta', v.camara_valvula_compuerta) },
    { clave: 'tablero_distribucion', parrafo: parrafoEquipo('Tablero de distribución, contactores y breakers', v.tablero_distribucion) },
    { clave: 'variador', parrafo: parrafoTieneConEstado('Variadores de frecuencia', v.variador) },
    { clave: 'descarga_emergencia', parrafo: parrafoTiene('Descarga de emergencia', v.descarga_emergencia) },
  ];

  return [
    { text: 'Estado de equipos', style: 'subtitulo', margin: [0, 4, 0, 4] },
    ...items.flatMap(({ clave, parrafo }) => [
      parrafo,
      bloqueFotos(fotosDeSeccion(v.fotos, clave)),
      lineaDivisoria(),
    ]),
  ].filter(Boolean);
}

function bloqueTuberias(v: VisitaParaReporte): any {
  const items: Array<{ clave: string; parrafo: any }> = [
    { clave: 'tuberia_400_valvulas_aire', parrafo: parrafoEquipo('400mm — Válvulas de aire', v.tuberia_400_valvulas_aire) },
    { clave: 'tuberia_400_uniones_elastomericas', parrafo: parrafoEquipo('400mm — Uniones elastoméricas', v.tuberia_400_uniones_elastomericas) },
    { clave: 'tuberia_600_valvulas_aire', parrafo: parrafoEquipo('600mm — Válvulas de aire', v.tuberia_600_valvulas_aire) },
    { clave: 'tuberia_600_uniones_elastomericas', parrafo: parrafoEquipo('600mm — Uniones elastoméricas', v.tuberia_600_uniones_elastomericas) },
  ];

  return [
    { text: 'Tuberías de impulsión', style: 'subtitulo', margin: [0, 4, 0, 4] },
    ...items.flatMap(({ clave, parrafo }) => [
      parrafo,
      bloqueFotos(fotosDeSeccion(v.fotos, clave)),
      lineaDivisoria(),
    ]),
  ].filter(Boolean);
}

function bloqueVisita(v: VisitaParaReporte): any[] {
  const esLineaConduccion = v.estacion_tipo === 'linea_conduccion';

  const encabezadoTabla = esLineaConduccion
    ? [
        [
          { text: `${v.estacion_codigo} — ${v.estacion_nombre}`, style: 'estacionTitulo', colSpan: 2 },
          {},
        ],
        ['Zona', v.zona],
        ['Llegada', formatFechaHora(v.fecha_hora_llegada)],
        ['Salida', v.fecha_hora_salida ? formatFechaHora(v.fecha_hora_salida) : '-'],
        ['Operador', v.operador_nombre],
        ['Estado general', ESTADO_LABEL[v.estado_estacion] ?? v.estado_estacion],
      ]
    : [
        [
          { text: `${v.estacion_codigo} — ${v.estacion_nombre}`, style: 'estacionTitulo', colSpan: 2 },
          {},
        ],
        ['Zona', v.zona],
        ['Llegada', formatFechaHora(v.fecha_hora_llegada)],
        ['Salida', v.fecha_hora_salida ? formatFechaHora(v.fecha_hora_salida) : '-'],
        ['Operador', v.operador_nombre],
        ['Estado de la estación', ESTADO_LABEL[v.estado_estacion] ?? v.estado_estacion],
        ['Nivel de tanque', v.nivel_tanque],
      ];

  const cabecera = {
    table: { widths: ['*', '*'], body: encabezadoTabla },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 8],
  };

  if (esLineaConduccion) {
    return [
      cabecera,
      bloqueTuberias(v),
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#CBD5E1' }], margin: [0, 4, 0, 12] },
    ].filter(Boolean);
  }

  const bombasBloques = v.bombas.flatMap((b) => [
    parrafoElemento(`Bomba ${b.numero_bomba}`, [
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
    ]),
    bloqueFotos(fotosDeSeccion(v.fotos, `bomba_${b.numero_bomba}`)),
    lineaDivisoria(),
  ]);

  return [
    cabecera,
    { text: 'Registro de bombas', style: 'subtitulo', margin: [0, 4, 0, 4] },
    bombasBloques,
    bloqueEquipos(v),
    v.cerramiento_observaciones
      ? { text: [{ text: 'Cerramiento y seguridad: ', bold: true }, v.cerramiento_observaciones], margin: [0, 0, 0, 4] }
      : null,
    bloqueFotos(fotosDeSeccion(v.fotos, 'cerramiento_seguridad')),
    lineaDivisoria(),
    v.jardineras_observaciones
      ? { text: [{ text: 'Jardineras y áreas verdes: ', bold: true }, v.jardineras_observaciones], margin: [0, 0, 0, 4] }
      : null,
    bloqueFotos(fotosDeSeccion(v.fotos, 'jardineras')),
    lineaDivisoria(),
    v.patios_maniobras_observaciones
      ? { text: [{ text: 'Patios de maniobras: ', bold: true }, v.patios_maniobras_observaciones], margin: [0, 0, 0, 4] }
      : null,
    bloqueFotos(fotosDeSeccion(v.fotos, 'patios_maniobras')),
    lineaDivisoria(),
    v.observaciones_generales
      ? { text: [{ text: 'Observaciones generales: ', bold: true }, v.observaciones_generales], margin: [0, 0, 0, 4] }
      : null,
    bloqueFotos(fotosDeSeccion(v.fotos, null)),
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#CBD5E1' }], margin: [0, 4, 0, 12] },
  ].filter(Boolean);
}

function bloqueFirma(nombre: string, etiqueta: string, firmaUrl?: string | null, espacioVacio = '\n\n') {
  return {
    columns: [
      {
        width: 200,
        stack: [
          firmaUrl
            ? { image: firmaUrl, fit: [150, 80], alignment: 'center' }
            : { text: espacioVacio },
          { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 180, y2: 0, lineWidth: 0.5 }] },
          { text: nombre, alignment: 'center', style: 'firmaNombre' },
          { text: etiqueta, alignment: 'center', style: 'firmaEtiqueta' },
        ],
      },
      { text: '', width: '*' },
    ],
    margin: [0, 12, 0, 0],
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
  titulo: string,
  visitas: VisitaParaReporte[],
): Promise<Blob> {
  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    // Márgenes generosos arriba/abajo para no encimarse con el logo y las
    // franjas de color del membrete institucional (fondo de página) ni con
    // el texto del pie de página.
    pageMargins: [40, 100, 40, 100],
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
      encabezado(titulo),
      ...visitas.flatMap((v) => [
        ...bloqueVisita(v),
        bloqueFirma(v.operador_nombre, 'Firma del operador', v.firma_url),
        { text: '', pageBreak: visitas.indexOf(v) < visitas.length - 1 ? 'after' : undefined },
      ]),
    ],
    styles: ESTILOS,
    defaultStyle: { fontSize: 9, color: '#16303F' },
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
    pageMargins: [40, 100, 40, 100],
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
    margin: [0, 0, 0, 10] as [number, number, number, number],
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
    pageMargins: [30, 55, 30, 80],
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
      { text: 'Nota: en todos los casos se descuenta 1 hora de almuerzo al medio día.', fontSize: 7.5, italics: true, margin: [0, 0, 0, 24] },
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
