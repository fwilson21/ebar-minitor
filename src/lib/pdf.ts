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
  jardineras: 'Jardineras',
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
      stack: [
        { image: f.url, fit: [150, 150] },
        { text: etiquetaFoto(f.etiqueta), fontSize: 7, alignment: 'center', color: '#5B7184', margin: [0, 2, 0, 0] },
      ],
      margin: [0, 0, 4, 0],
    })),
    margin: [0, 4, 0, 8],
  };
}

/** Fotos de una visita cuya `etiqueta` (= `descripcion` en la tabla `fotos`) corresponde a una subcategoría puntual. */
function fotosDeSeccion(fotos: Array<{ url: string; etiqueta?: string | null }> | undefined, clave: string | null): Array<{ url: string; etiqueta?: string | null }> {
  return (fotos ?? []).filter((f) => (f.etiqueta ?? null) === clave);
}

// Ancho fijo (no 'auto') para la columna de Estado: al partir la tabla en una
// mini-tabla por fila (para poder intercalar fotos entre filas), 'auto' se
// recalcularía por separado en cada una y las columnas ya no alinearían entre
// sí. 130pt alcanza para el texto más largo posible ("Requiere mantenimiento").
const ANCHO_ESTADO = 130;

/** Tabla de una sola fila (sin encabezado propio) — se usa para poder intercalar fotos entre filas. */
function tablaFila(fila: any[], widths: (string | number)[] = ['*', ANCHO_ESTADO, '*']): any {
  return {
    table: { widths, body: [fila] },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 0],
  };
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

function filaEquipo(label: string, equipo?: EquipoReporte | null): any[] {
  const estado = equipo?.estado ?? 'operativo';
  const numeros = equipo?.numeros_afectados?.length ? ` (N.º ${equipo.numeros_afectados.join(', ')})` : '';
  return [
    label + numeros,
    {
      text: ESTADO_EQUIPO_LABEL[estado] ?? estado,
      color: ESTADO_EQUIPO_COLOR[estado] ?? '#16303F',
      bold: true,
    },
    equipo?.observaciones || '-',
  ];
}

function filaTiene(label: string, equipo?: EquipoReporte | null): any[] {
  const tiene = equipo?.tiene ?? null;
  return [
    label,
    {
      text: tiene === true ? 'Sí tiene' : tiene === false ? 'No tiene' : '-',
      color: tiene === true ? '#059669' : '#16303F',
      bold: true,
    },
    tiene ? (equipo?.observaciones || '-') : '-',
  ];
}

/** Como filaTiene(), pero cuando "Sí tiene" muestra además el Estado (3 opciones), igual que filaEquipo(). */
function filaTieneConEstado(label: string, equipo?: EquipoReporte | null): any[] {
  const tiene = equipo?.tiene ?? null;
  if (tiene !== true) {
    return [label, { text: tiene === false ? 'No tiene' : '-', color: '#16303F', bold: true }, '-'];
  }
  return filaEquipo(label, equipo);
}

/** Línea horizontal fina para separar visualmente cada subcategoría en el PDF. */
function lineaDivisoria(): any {
  return { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#E2E8F0' }], margin: [0, 4, 0, 4] };
}

function bloqueEquipos(v: VisitaParaReporte): any {
  const items: Array<{ clave: string; fila: any[] }> = [
    { clave: 'lineas_impulsion', fila: filaEquipo('Líneas de impulsión', v.lineas_impulsion) },
    { clave: 'guias_izado', fila: filaEquipo('Guías de izado de bombas', v.guias_izado) },
    { clave: 'valvulas_compuerta', fila: filaEquipo('Válvulas de compuerta', v.valvulas_compuerta) },
    { clave: 'valvulas_check', fila: filaEquipo('Válvulas check', v.valvulas_check) },
    { clave: 'valvula_aire', fila: filaTieneConEstado('Válvula de aire', v.valvula_aire) },
    { clave: 'camara_rejilla', fila: filaEquipo('Cámara de llegada — Rejilla', v.camara_rejilla) },
    { clave: 'camara_valvula_compuerta', fila: filaTieneConEstado('Cámara de llegada — Compuerta', v.camara_valvula_compuerta) },
    { clave: 'tablero_distribucion', fila: filaEquipo('Tablero de distribución, contactores y breakers', v.tablero_distribucion) },
    { clave: 'variador', fila: filaEquipo('Variadores de frecuencia', v.variador) },
    { clave: 'descarga_emergencia', fila: filaTiene('Descarga de emergencia', v.descarga_emergencia) },
  ];

  return [
    { text: 'Estado de equipos', style: 'subtitulo', margin: [0, 4, 0, 4] },
    tablaFila(['Equipo', 'Estado', 'Observaciones']),
    ...items.flatMap(({ clave, fila }) => [
      tablaFila(fila),
      bloqueFotos(fotosDeSeccion(v.fotos, clave)),
      lineaDivisoria(),
    ]),
  ].filter(Boolean);
}

function bloqueTuberias(v: VisitaParaReporte): any {
  const items: Array<{ clave: string; fila: any[] }> = [
    { clave: 'tuberia_400_valvulas_aire', fila: filaEquipo('400mm — Válvulas de aire', v.tuberia_400_valvulas_aire) },
    { clave: 'tuberia_400_uniones_elastomericas', fila: filaEquipo('400mm — Uniones elastoméricas', v.tuberia_400_uniones_elastomericas) },
    { clave: 'tuberia_600_valvulas_aire', fila: filaEquipo('600mm — Válvulas de aire', v.tuberia_600_valvulas_aire) },
    { clave: 'tuberia_600_uniones_elastomericas', fila: filaEquipo('600mm — Uniones elastoméricas', v.tuberia_600_uniones_elastomericas) },
  ];

  return [
    { text: 'Tuberías de impulsión', style: 'subtitulo', margin: [0, 4, 0, 4] },
    tablaFila(['Tubería', 'Estado', 'Observaciones']),
    ...items.flatMap(({ clave, fila }) => [
      tablaFila(fila),
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
        ['Llegada', new Date(v.fecha_hora_llegada).toLocaleString('es-EC')],
        ['Salida', v.fecha_hora_salida ? new Date(v.fecha_hora_salida).toLocaleString('es-EC') : '-'],
        ['Operador', v.operador_nombre],
        ['Estado general', ESTADO_LABEL[v.estado_estacion] ?? v.estado_estacion],
      ]
    : [
        [
          { text: `${v.estacion_codigo} — ${v.estacion_nombre}`, style: 'estacionTitulo', colSpan: 2 },
          {},
        ],
        ['Zona', v.zona],
        ['Llegada', new Date(v.fecha_hora_llegada).toLocaleString('es-EC')],
        ['Salida', v.fecha_hora_salida ? new Date(v.fecha_hora_salida).toLocaleString('es-EC') : '-'],
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

  // Anchos fijos por la misma razón que ANCHO_ESTADO: cada bomba es su propia
  // mini-tabla (para poder intercalar sus fotos debajo), así que las columnas
  // deben tener el mismo ancho en todas para seguir alineadas verticalmente.
  const bombasWidths: (string | number)[] = [18, 150, 62, 65, 62, '*'];
  const bombasBloques = v.bombas.flatMap((b) => [
    tablaFila(
      [
        String(b.numero_bomba),
        ESTADO_BOMBA_LABEL[b.estado] ?? b.estado,
        b.voltaje_fuera_rango
          ? { text: `${b.voltaje ?? '-'} ⚠`, color: '#B91C1C', bold: true }
          : String(b.voltaje ?? '-'),
        String(b.amperaje ?? '-'),
        String(b.horas_operacion_acumuladas ?? '-'),
        b.observaciones ?? '-',
      ],
      bombasWidths,
    ),
    bloqueFotos(fotosDeSeccion(v.fotos, `bomba_${b.numero_bomba}`)),
    lineaDivisoria(),
  ]);

  return [
    cabecera,
    { text: 'Registro de bombas', style: 'subtitulo', margin: [0, 4, 0, 4] },
    tablaFila(['#', 'Estado', 'Voltaje (V)', 'Amperaje (A)', 'Horas acum.', 'Observaciones'], bombasWidths),
    bombasBloques,
    bloqueEquipos(v),
    v.cerramiento_observaciones
      ? { text: [{ text: 'Cerramiento y seguridad: ', bold: true }, v.cerramiento_observaciones], margin: [0, 0, 0, 4] }
      : null,
    bloqueFotos(fotosDeSeccion(v.fotos, 'cerramiento_seguridad')),
    lineaDivisoria(),
    v.jardineras_observaciones
      ? { text: [{ text: 'Jardineras: ', bold: true }, v.jardineras_observaciones], margin: [0, 0, 0, 4] }
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

function bloqueFirma(operadorNombre: string, firmaUrl?: string | null) {
  return {
    columns: [
      {
        width: 200,
        stack: [
          firmaUrl
            ? { image: firmaUrl, fit: [150, 80], alignment: 'center' }
            : { text: '\n\n', },
          { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 180, y2: 0, lineWidth: 0.5 }] },
          { text: operadorNombre, alignment: 'center', style: 'firmaNombre' },
          { text: 'Firma del operador', alignment: 'center', style: 'firmaEtiqueta' },
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
        bloqueFirma(v.operador_nombre, v.firma_url),
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
