-- ============================================================================
-- Cargo/ocupación de cada usuario (necesario para la Planilla de horas extras,
-- que necesita la "Ocupación" del trabajador) — mismo patrón que la cédula
-- (0021_cedula_operador.sql): obligatorio al crear un usuario nuevo desde la
-- Edge Function create-user; los usuarios existentes quedan con cargo = null
-- hasta que el administrador lo complete a mano desde Usuarios.
-- ============================================================================

alter table public.usuarios add column cargo text;

comment on column public.usuarios.cargo is
  'Cargo/ocupación del usuario (ej. "Operador de estaciones de bombeo"). Obligatorio para usuarios nuevos; nulo en cuentas creadas antes de este campo hasta que se complete a mano.';
