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

export const FUNCIONES_PERMISOS: FuncionPermiso[] = [
  {
    clave: 'gestionar_usuarios',
    nombre: 'Gestionar usuarios',
    descripcion:
      'Crear, editar (nombre, usuario, cédula, cargo), activar/desactivar, restablecer contraseña y eliminar usuarios. No incluye cambiar el rol de nadie ni crear un usuario con un rol distinto de Operador — eso sigue siendo exclusivo del administrador.',
  },
];
