// Registro central de pantallas y modales cuyo acomodo de bloques en escritorio puede
// reordenar el administrador desde /distribucion-entorno (ver GridEditable.tsx). Agregar una
// pantalla nueva aquí es suficiente para que aparezca en el selector — no hace falta tocar
// DistribucionEntorno.tsx ni layoutsAdmin.ts.

export type BloqueDefinicion = {
  id: string;
  titulo: string;
  defaultLayout: { x: number; y: number; w: number; h: number };
};

export type PantallaEditable = {
  id: string;
  nombre: string;
  bloques: BloqueDefinicion[];
};

export const PANTALLAS_EDITABLES: PantallaEditable[] = [
  {
    id: 'turnos',
    nombre: 'Calendario de turnos',
    bloques: [
      { id: 'calendario', titulo: 'Calendario', defaultLayout: { x: 0, y: 0, w: 8, h: 6 } },
      { id: 'feriados', titulo: 'Feriados', defaultLayout: { x: 0, y: 6, w: 8, h: 3 } },
      { id: 'resumen_mes', titulo: 'Resumen del mes', defaultLayout: { x: 8, y: 0, w: 4, h: 3 } },
      { id: 'exportar', titulo: 'Exportar', defaultLayout: { x: 8, y: 3, w: 4, h: 2 } },
      { id: 'planilla_horas_extras', titulo: 'Planilla de horas extras', defaultLayout: { x: 8, y: 5, w: 4, h: 2 } },
    ],
  },
  {
    id: 'estaciones',
    nombre: 'Estaciones',
    bloques: [
      { id: 'encabezado_form', titulo: 'Encabezado y Nueva estación (admin)', defaultLayout: { x: 0, y: 0, w: 4, h: 9 } },
      { id: 'filtros', titulo: 'Buscar y filtrar', defaultLayout: { x: 4, y: 0, w: 8, h: 2 } },
      { id: 'lista_estaciones', titulo: 'Lista de estaciones', defaultLayout: { x: 4, y: 2, w: 8, h: 9 } },
    ],
  },
  {
    id: 'dashboard',
    nombre: 'Inicio (Dashboard)',
    bloques: [
      { id: 'resumen_general', titulo: 'Resumen general', defaultLayout: { x: 0, y: 0, w: 12, h: 4 } },
      // "Tus EBAR de hoy" solo lo ve el operador; los otros 3 de abajo solo admin/supervisor —
      // igual quedan todos en el layout compartido: a quien no le toca ver un bloque, esa celda
      // le queda vacía (mismo criterio que ya se acepta hoy sin distribución, ej. "Pendientes de
      // visita" ya desaparece solo si no hay ninguna).
      { id: 'tus_ebar_hoy', titulo: 'Tus EBAR de hoy (operador)', defaultLayout: { x: 0, y: 4, w: 6, h: 5 } },
      { id: 'pendientes_visita', titulo: 'Pendientes de visita', defaultLayout: { x: 6, y: 4, w: 6, h: 4 } },
      { id: 'requieren_atencion', titulo: 'Requieren atención', defaultLayout: { x: 0, y: 9, w: 6, h: 5 } },
      { id: 'visitas_sospechosas', titulo: 'Visitas con horario sospechoso (admin/supervisor)', defaultLayout: { x: 6, y: 8, w: 6, h: 4 } },
      { id: 'bajo_minimo', titulo: 'Por debajo del mínimo (admin/supervisor)', defaultLayout: { x: 0, y: 14, w: 12, h: 4 } },
    ],
  },
  {
    id: 'modal_nueva_planilla',
    nombre: 'Modal: Nueva planilla',
    bloques: [
      { id: 'encabezado_fechas', titulo: 'Encabezado y fechas', defaultLayout: { x: 0, y: 0, w: 6, h: 3 } },
      { id: 'jornada_normal', titulo: 'Jornada normal', defaultLayout: { x: 6, y: 0, w: 6, h: 3 } },
      { id: 'informe_memorando', titulo: 'N. informe y memorando', defaultLayout: { x: 0, y: 3, w: 12, h: 2 } },
      { id: 'tabla_dias', titulo: 'Tabla de dias', defaultLayout: { x: 0, y: 5, w: 12, h: 5 } },
      { id: 'acciones', titulo: 'Guardar / PDF / Cerrar', defaultLayout: { x: 0, y: 10, w: 12, h: 1 } },
    ],
  },
];
