// Registro central de funciones del sistema que el administrador puede activar/desactivar por
// rol desde /permisos (ver Permisos.tsx). Agregar una función nueva acá y hacer que el código
// real la consulte con `tienePermiso('clave')` (frontend) o `tiene_permiso('clave')` (RLS/Edge
// Functions) es suficiente para que aparezca en el selector — no hace falta tocar Permisos.tsx.
//
// El administrador siempre tiene todas las funciones habilitadas (no aparece como columna acá,
// ver tiene_permiso() en la migración 0028) — esta lista es solo para operador/supervisor.

export type FuncionPermiso = {
  clave: string;
  nombre: string;
  descripcion: string;
};

// Las 5 funciones de abajo eran originalmente UNA sola ("Gestionar usuarios", migración 0028);
// se separaron a pedido del usuario (migración 0030) para poder activar cada acción por separado.
// Cambiar el rol de alguien NO está en esta lista a propósito — eso queda siempre exclusivo del
// administrador real, sin importar qué funciones tenga habilitadas un rol.
export const FUNCIONES_PERMISOS: FuncionPermiso[] = [
  {
    clave: 'crear_usuarios',
    nombre: 'Crear usuarios',
    descripcion: 'Dar de alta usuarios nuevos. Siempre nacen con rol Operador — crearlos con otro rol sigue siendo exclusivo del administrador.',
  },
  {
    clave: 'editar_usuarios',
    nombre: 'Editar usuarios',
    descripcion: 'Editar nombre completo, nombre de usuario (login), cédula, cargo, y liberar el celular vinculado de cualquier usuario. No incluye cambiar el rol de nadie.',
  },
  {
    clave: 'activar_desactivar_usuarios',
    nombre: 'Activar/Desactivar usuarios',
    descripcion: 'Activar o desactivar la cuenta de cualquier usuario.',
  },
  {
    clave: 'restablecer_password_usuarios',
    nombre: 'Restablecer contraseña',
    descripcion: 'Definir una contraseña nueva para cualquier usuario que la haya olvidado.',
  },
  {
    clave: 'eliminar_usuarios',
    nombre: 'Eliminar usuarios',
    descripcion: 'Borrar por completo la cuenta de un usuario (si no tiene visitas registradas guardadas).',
  },
];
