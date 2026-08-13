// Registro central de funciones del sistema que el administrador puede activar/desactivar por
// rol desde /permisos (ver Permisos.tsx). Agregar una función nueva acá y hacer que el código
// real la consulte con `tienePermiso('clave')` (frontend) o `tiene_permiso('clave')` (RLS/Edge
// Functions) es suficiente para que aparezca en el selector — no hace falta tocar Permisos.tsx.
//
// El administrador siempre tiene todas las funciones habilitadas (no aparece como columna acá,
// ver tiene_permiso() en la migración 0028) — esta lista es solo para operador/supervisor.
//
// `categoria` agrupa la lista en la pantalla (a pedido del usuario, 2026-08-13): cada categoría
// es una sección de la app, y sus funciones son las subfunciones puntuales dentro de esa
// sección — el checklist se muestra anidado por categoría en vez de una lista plana.

export type FuncionPermiso = {
  clave: string;
  nombre: string;
  descripcion: string;
  categoria: string;
};

// Las 5 funciones de "Usuarios" eran originalmente UNA sola ("Gestionar usuarios", migración
// 0028); se separaron a pedido del usuario (migración 0030) para poder activar cada acción por
// separado. Cambiar el rol de alguien NO está en esta lista a propósito — eso queda siempre
// exclusivo del administrador real, sin importar qué funciones tenga habilitadas un rol.
//
// Nota sobre alcance (2026-08-13): esta lista todavía no cubre TODO lo que puede editar un
// administrador — quedó pendiente "Turnos" (marcar turno, declarar/quitar feriados), que
// interactúa con el modo de solo-consulta que ya tiene el digitador en esa misma pantalla
// (CalendarioTurnos.tsx) y se prefirió no tocar de apuro. Agregarlo después sigue el mismo
// patrón que las categorías de abajo.
export const FUNCIONES_PERMISOS: FuncionPermiso[] = [
  {
    clave: 'crear_usuarios',
    nombre: 'Crear usuarios',
    descripcion: 'Dar de alta usuarios nuevos. Siempre nacen con rol Operador — crearlos con otro rol sigue siendo exclusivo del administrador.',
    categoria: 'Usuarios',
  },
  {
    clave: 'editar_usuarios',
    nombre: 'Editar usuarios',
    descripcion: 'Editar nombre completo, nombre de usuario (login), cédula, cargo, y liberar el celular vinculado de cualquier usuario. No incluye cambiar el rol de nadie.',
    categoria: 'Usuarios',
  },
  {
    clave: 'activar_desactivar_usuarios',
    nombre: 'Activar/Desactivar usuarios',
    descripcion: 'Activar o desactivar la cuenta de cualquier usuario.',
    categoria: 'Usuarios',
  },
  {
    clave: 'restablecer_password_usuarios',
    nombre: 'Restablecer contraseña',
    descripcion: 'Definir una contraseña nueva para cualquier usuario que la haya olvidado.',
    categoria: 'Usuarios',
  },
  {
    clave: 'eliminar_usuarios',
    nombre: 'Eliminar usuarios',
    descripcion: 'Borrar por completo la cuenta de un usuario (si no tiene visitas registradas guardadas).',
    categoria: 'Usuarios',
  },
  {
    clave: 'crear_estaciones',
    nombre: 'Crear estaciones',
    descripcion: 'Dar de alta una estación EBAR o línea de conducción nueva desde la pantalla Estaciones.',
    categoria: 'Estaciones',
  },
  {
    clave: 'gestionar_bombas',
    nombre: 'Gestionar bombas',
    descripcion: 'Agregar bombas a una estación y activar/desactivar las que ya tiene, desde el detalle de la estación.',
    categoria: 'Estaciones',
  },
  {
    clave: 'eliminar_planillas_horas_extras',
    nombre: 'Eliminar planillas de horas extras',
    descripcion: 'Borrar por completo una planilla ya creada. Ver/crear/editar planillas no necesita este permiso — ya lo puede hacer cualquiera con acceso a Turnos.',
    categoria: 'Planillas de horas extras',
  },
  {
    clave: 'editar_configuracion_planillas',
    nombre: 'Editar configuración de planillas',
    descripcion: 'Cambiar los firmantes por defecto (Revisado por / Aprobado por) y la jornada por defecto de cada operador — ajustes globales que se prellenan al generar cualquier planilla.',
    categoria: 'Planillas de horas extras',
  },
  {
    clave: 'editar_distribucion',
    nombre: 'Editar distribución de pantallas',
    descripcion: 'Mover y redimensionar los bloques de cualquier pantalla, y ajustar su ancho en escritorio ("Editar distribución") — aplica por igual a todas las pantallas que lo tienen.',
    categoria: 'Distribución de pantallas',
  },
  {
    clave: 'marcar_turnos',
    nombre: 'Marcar turnos',
    descripcion: 'Asignar qué operador está de turno un sábado, domingo o feriado, y las EBAR que le tocan ese día. Desde ese mismo panel del día también se puede declarar un feriado nuevo (comparte pantalla con "Marcar turnos", no es un permiso aparte para esa parte puntual).',
    categoria: 'Turnos',
  },
  {
    clave: 'gestionar_feriados',
    nombre: 'Quitar feriados declarados',
    descripcion: 'Quitar de la lista un feriado adicional ya declarado. Para declarar uno nuevo hace falta el permiso "Marcar turnos" (se hace desde el mismo panel).',
    categoria: 'Turnos',
  },
];

// Orden de categorías para la pantalla /permisos: el mismo orden en que aparecen por primera vez
// arriba (no alfabético) — así "Usuarios" queda primero, que es la categoría más usada.
export const CATEGORIAS_PERMISOS: string[] = [...new Set(FUNCIONES_PERMISOS.map((f) => f.categoria))];
