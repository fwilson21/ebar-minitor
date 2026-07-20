-- ============================================================================
-- Número de cédula de cada usuario (necesario para el calendario de turnos en
-- PDF, que lo lista al pie por operador). Se pide obligatorio al crear un
-- usuario nuevo desde la Edge Function create-user; los usuarios existentes
-- quedan con cedula = null hasta que el administrador la complete a mano
-- desde Usuarios.
-- ============================================================================

alter table public.usuarios add column cedula text unique;

comment on column public.usuarios.cedula is
  'Número de cédula del usuario. Obligatorio para usuarios nuevos (se pide al crearlos); nulo en cuentas creadas antes de este campo hasta que se complete a mano.';
