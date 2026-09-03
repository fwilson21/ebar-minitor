// Registro central de pantallas y modales cuyo acomodo de bloques en escritorio puede
// reordenar el administrador desde /distribucion-entorno (ver GridEditable.tsx). Agregar una
// pantalla nueva aquí es suficiente para que aparezca en el selector — no hace falta tocar
// DistribucionEntorno.tsx ni layoutsAdmin.ts.
//
// Las medidas de defaultLayout están en la resolución del grid de GridEditable.tsx (24 columnas
// de ancho x 20px de alto por fila). Si esa resolución cambia, estos números hay que escalarlos
// por el mismo factor (y correr una migración para lo ya guardado en Supabase).

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
      { id: 'calendario', titulo: 'Calendario', defaultLayout: { x: 0, y: 0, w: 16, h: 12 } },
      { id: 'feriados', titulo: 'Feriados', defaultLayout: { x: 0, y: 12, w: 16, h: 6 } },
      // resumen_mes más bajo (6 → 5): con el texto adaptable de BloqueResumenMes, 4-5 operadores
      // ya no necesitan tanto alto — dejaba un espacio muerto grande antes de "Exportar".
      { id: 'resumen_mes', titulo: 'Resumen del mes', defaultLayout: { x: 16, y: 0, w: 8, h: 5 } },
      { id: 'exportar', titulo: 'Exportar', defaultLayout: { x: 16, y: 5, w: 8, h: 4 } },
      { id: 'planilla_horas_extras', titulo: 'Planilla de horas extras', defaultLayout: { x: 16, y: 9, w: 8, h: 4 } },
    ],
  },
  {
    id: 'estaciones',
    nombre: 'Estaciones',
    bloques: [
      { id: 'encabezado_form', titulo: 'Encabezado y Nueva estación (admin)', defaultLayout: { x: 0, y: 0, w: 8, h: 18 } },
      { id: 'filtros', titulo: 'Buscar y filtrar', defaultLayout: { x: 8, y: 0, w: 16, h: 4 } },
      { id: 'lista_estaciones', titulo: 'Lista de estaciones', defaultLayout: { x: 8, y: 4, w: 16, h: 18 } },
    ],
  },
  {
    id: 'dashboard',
    nombre: 'Inicio (Dashboard)',
    bloques: [
      { id: 'resumen_general', titulo: 'Resumen general', defaultLayout: { x: 0, y: 0, w: 24, h: 8 } },
      // "Tus EBAR de hoy" solo lo ve el operador; "visitas_sospechosas"/"bajo_minimo" solo
      // admin/supervisor — Dashboard.tsx saca del grid el bloque que no le toca a quien mira,
      // así no queda como una celda vacía y arrastrable sin contenido dentro.
      { id: 'tus_ebar_hoy', titulo: 'Tus EBAR de hoy (operador)', defaultLayout: { x: 0, y: 8, w: 12, h: 10 } },
      { id: 'pendientes_visita', titulo: 'Pendientes de visita', defaultLayout: { x: 12, y: 8, w: 12, h: 8 } },
      { id: 'requieren_atencion', titulo: 'Requieren atención', defaultLayout: { x: 0, y: 18, w: 12, h: 10 } },
      { id: 'visitas_sospechosas', titulo: 'Visitas con horario sospechoso (admin/supervisor)', defaultLayout: { x: 12, y: 16, w: 12, h: 8 } },
      { id: 'bajo_minimo', titulo: 'Por debajo del mínimo (admin/supervisor)', defaultLayout: { x: 0, y: 28, w: 24, h: 8 } },
    ],
  },
  {
    id: 'permisos',
    nombre: 'Permisos',
    bloques: [
      { id: 'encabezado_selector', titulo: 'Encabezado y selector de rol', defaultLayout: { x: 0, y: 0, w: 8, h: 6 } },
      { id: 'lista_funciones', titulo: 'Lista de funciones', defaultLayout: { x: 8, y: 0, w: 16, h: 12 } },
    ],
  },
  {
    id: 'usuarios',
    nombre: 'Usuarios',
    bloques: [
      { id: 'encabezado_form', titulo: 'Encabezado y Crear usuario', defaultLayout: { x: 0, y: 0, w: 8, h: 18 } },
      { id: 'lista_usuarios', titulo: 'Lista de usuarios', defaultLayout: { x: 8, y: 0, w: 16, h: 18 } },
    ],
  },
  {
    id: 'asignaciones',
    nombre: 'Asignar',
    bloques: [
      { id: 'resumen', titulo: 'Resumen de asignaciones', defaultLayout: { x: 0, y: 0, w: 12, h: 18 } },
      { id: 'seleccionar_operador', titulo: 'Seleccionar operador', defaultLayout: { x: 12, y: 0, w: 12, h: 4 } },
      // Estos 2 solo tienen contenido una vez elegido un operador arriba — hasta entonces, la
      // celda queda vacía (mismo criterio que el resto de bloques condicionales de la app).
      { id: 'asignacion_default', titulo: 'Asignación por defecto', defaultLayout: { x: 12, y: 4, w: 12, h: 10 } },
      { id: 'asignacion_especial', titulo: 'Asignación especial por fecha', defaultLayout: { x: 12, y: 14, w: 12, h: 14 } },
      { id: 'excepcion_gps', titulo: 'Excepción de GPS', defaultLayout: { x: 0, y: 28, w: 24, h: 16 } },
    ],
  },
  {
    id: 'reportes',
    nombre: 'Reportes',
    bloques: [
      { id: 'filtros_generar', titulo: 'Filtros y Generar PDF', defaultLayout: { x: 0, y: 0, w: 14, h: 18 } },
      { id: 'compartir', titulo: 'Compartir', defaultLayout: { x: 14, y: 0, w: 10, h: 18 } },
    ],
  },
  {
    id: 'modal_nueva_planilla',
    nombre: 'Modal: Nueva planilla',
    bloques: [
      { id: 'encabezado_fechas', titulo: 'Encabezado y fechas', defaultLayout: { x: 0, y: 0, w: 12, h: 6 } },
      { id: 'jornada_normal', titulo: 'Jornada normal', defaultLayout: { x: 12, y: 0, w: 12, h: 6 } },
      { id: 'informe_memorando', titulo: 'N. informe y memorando', defaultLayout: { x: 0, y: 6, w: 24, h: 4 } },
      { id: 'tabla_dias', titulo: 'Tabla de dias', defaultLayout: { x: 0, y: 10, w: 24, h: 10 } },
      { id: 'acciones', titulo: 'Guardar / PDF / Cerrar', defaultLayout: { x: 0, y: 20, w: 24, h: 2 } },
    ],
  },
];
