-- ============================================================================
-- EBAR Monitor — Mostrar el "usuario" (nombre de acceso) de cada cuenta.
-- ============================================================================
-- Hasta ahora, el nombre de usuario con el que cada persona inicia sesión
-- (ej. "elapo") solo se escribía una vez, al crearla (ver create-user), y
-- nunca quedaba guardado en ningún lado visible — el administrador no tenía
-- forma de confirmar en la pantalla de Usuarios cómo estaba escrito. Se agrega
-- la columna `nombre_usuario` para poder mostrarlo.
--
-- Se hace un backfill de las cuentas ya existentes leyendo el correo real
-- desde `auth.users` (accesible directo por SQL, aunque no desde el cliente):
-- para cuentas con el dominio ficticio (creadas desde la app) se guarda solo
-- la parte antes de la @ (lo que la persona realmente escribe para entrar);
-- para cuentas viejas con correo real (ej. el primer administrador) se guarda
-- el correo completo (que es lo que esa cuenta puntual necesita para entrar).
-- ============================================================================

alter table public.usuarios add column nombre_usuario text;

update public.usuarios u
set nombre_usuario = case
  when au.email like '%@ebar-monitor.local' then split_part(au.email, '@', 1)
  else au.email
end
from auth.users au
where au.id = u.id and u.nombre_usuario is null;
