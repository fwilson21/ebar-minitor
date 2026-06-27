import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';

(pdfMake as any).vfs = (pdfFonts as any).vfs;

export interface DatosEmpresa {
  nombre: string;
  logoBase64?: string; // data URL, opcional
  direccion?: string;
  telefono?: string;
}

export interface VisitaParaReporte {
  estacion_nombre: string;
  estacion_codigo: string;
  zona: string;
  fecha_hora_llegada: string;
  fecha_hora_salida?: string | null;
  operador_nombre: string;
  estado_estacion: string;
  nivel_tanque: string;
  olores_anormales: boolean;
  olores_descripcion?: string | null;
  ruidos_extranos: boolean;
  ruidos_descripcion?: string | null;
  cerramiento_ok: boolean;
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
  fotos_urls?: string[];
  firma_url?: string | null;
}

const ESTADO_LABEL: Record<string, string> = {
  operativa: 'Operativa',
  mantenimiento_correctivo: 'Mantenimiento correctivo',
  fuera_de_servicio: 'Fuera de servicio',
};

function encabezado(empresa: DatosEmpresa, titulo: string): any {
  return {
    columns: [
      empresa.logoBase64
        ? { image: empresa.logoBase64, width: 70 }
        : { text: '', width: 70 },
      {
        stack: [
          { text: empresa.nombre, style: 'empresaNombre' },
          empresa.direccion ? { text: empresa.direccion, style: 'empresaDato' } : null,
          empresa.telefono ? { text: empresa.telefono, style: 'empresaDato' } : null,
        ].filter(Boolean),
      },
      { text: titulo, style: 'tituloReporte', alignment: 'right', width: 200 },
    ],
    margin: [0, 0, 0, 16],
  };
}

function bloqueVisita(v: VisitaParaReporte): any[] {
  const bombasBody = [
    ['#', 'Estado', 'Voltaje (V)', 'Amperaje (A)', 'Horas acum.', 'Observaciones'],
    ...v.bombas.map((b) => [
      String(b.numero_bomba),
      b.estado,
      b.voltaje_fuera_rango
        ? { text: `${b.voltaje ?? '-'} ⚠`, color: '#B91C1C', bold: true }
        : String(b.voltaje ?? '-'),
      String(b.amperaje ?? '-'),
      String(b.horas_operacion_acumuladas ?? '-'),
      b.observaciones ?? '-',
    ]),
  ];

  return [
    {
      table: {
        widths: ['*', '*'],
        body: [
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
          ['Olores anormales', v.olores_anormales ? `Sí — ${v.olores_descripcion ?? ''}` : 'No'],
          ['Ruidos extraños', v.ruidos_extranos ? `Sí — ${v.ruidos_descripcion ?? ''}` : 'No'],
          ['Cerramiento / seguridad', v.cerramiento_ok ? 'OK' : 'Con observaciones'],
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 0, 0, 8],
    },
    { text: 'Registro de bombas', style: 'subtitulo', margin: [0, 4, 0, 4] },
    {
      table: { widths: ['auto', 'auto', 'auto', 'auto', 'auto', '*'], body: bombasBody },
      layout: 'lightHorizontalLines',
      margin: [0, 0, 0, 8],
    },
    v.observaciones_generales
      ? { text: [{ text: 'Observaciones generales: ', bold: true }, v.observaciones_generales], margin: [0, 0, 0, 8] }
      : null,
    v.fotos_urls?.length
      ? {
          columns: v.fotos_urls.slice(0, 3).map((url) => ({ image: url, width: 150, margin: [0, 0, 4, 0] })),
          margin: [0, 4, 0, 8],
        }
      : null,
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#CBD5E1' }], margin: [0, 4, 0, 12] },
  ].filter(Boolean);
}

function bloqueFirma(operadorNombre: string, firmaUrl?: string | null) {
  return {
    columns: [
      { text: '', width: '*' },
      {
        width: 200,
        stack: [
          firmaUrl
            ? { image: firmaUrl, width: 150, alignment: 'center' }
            : { text: '\n\n', },
          { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 180, y2: 0, lineWidth: 0.5 }] },
          { text: operadorNombre, alignment: 'center', style: 'firmaNombre' },
          { text: 'Firma del operador', alignment: 'center', style: 'firmaEtiqueta' },
        ],
      },
    ],
    margin: [0, 12, 0, 0],
  };
}

const ESTILOS = {
  empresaNombre: { fontSize: 13, bold: true, color: '#0B1521' },
  empresaDato: { fontSize: 8, color: '#5B7184' },
  tituloReporte: { fontSize: 14, bold: true, color: '#16303F' },
  estacionTitulo: { fontSize: 12, bold: true, fillColor: '#EEF2F6' },
  subtitulo: { fontSize: 10, bold: true, color: '#16303F' },
  firmaNombre: { fontSize: 9, bold: true },
  firmaEtiqueta: { fontSize: 7, color: '#5B7184' },
  pie: { fontSize: 7, color: '#94A3B8' },
};

export function generarReporteVisitas(
  empresa: DatosEmpresa,
  titulo: string,
  visitas: VisitaParaReporte[],
): Promise<Blob> {
  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 60],
    header: encabezado(empresa, titulo),
    footer: (pagina, total) => ({
      columns: [
        { text: `Generado el ${new Date().toLocaleString('es-EC')}`, style: 'pie', margin: [40, 0, 0, 0] },
        { text: `Página ${pagina} de ${total}`, alignment: 'right', style: 'pie', margin: [0, 0, 40, 0] },
      ],
    }),
    content: visitas.flatMap((v) => [
      ...bloqueVisita(v),
      bloqueFirma(v.operador_nombre, v.firma_url),
      { text: '', pageBreak: visitas.indexOf(v) < visitas.length - 1 ? 'after' : undefined },
    ]),
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
