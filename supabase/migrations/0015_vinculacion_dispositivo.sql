-- ============================================================================
-- EBAR Monitor — Vinculación de operadores a un solo celular.
-- ============================================================================
-- Objetivo: evitar que un operador inicie sesión con varias cuentas distintas
-- desde un mismo celular (para "reportar" visitas de compañeros que no fueron
-- al sitio). Se agrega `device_id`: un identificador que genera la app en el
-- celular la primera vez que se usa (guardado en el navegador/PWA, no se puede
-- cambiar desde la pantalla de login).
--
-- Regla: la primera vez que un operador inicia sesión, su cuenta queda
-- vinculada a ese celular (`device_id` pasa de null a un valor). Un celular
-- solo puede estar vinculado a UNA cuenta (constraint unique) y una cuenta
-- solo puede estar vinculada a UN celular a la vez — si se intenta iniciar
-- sesión con otra cuenta desde ese mismo celular, o con esa cuenta desde otro
-- celular, la app bloquea el ingreso. Solo un administrador puede liberar la
-- vinculación (columna `device_id` protegida por RLS igual que `rol`/`activo`
-- desde 0014_fix_autoescalacion_rol.sql).
-- ============================================================================

alter table public.usuarios add column device_id text;
alter table public.usuarios add constraint usuarios_device_id_unique unique (device_id);

drop policy if exists "usuarios_update_propio_o_admin" on public.usuarios;

create policy "usuarios_update_propio_o_admin" on public.usuarios
  for update
  using (id = auth.uid() or public.current_user_role() = 'administrador')
  with check (
    public.current_user_role() = 'administrador'
    or (
      id = auth.uid()
      and rol = (select u2.rol from public.usuarios u2 where u2.id = auth.uid())
      and activo = (select u2.activo from public.usuarios u2 where u2.id = auth.uid())
      and (
        device_id = (select u2.device_id from public.usuarios u2 where u2.id = auth.uid())
        or (select u2.device_id from public.usuarios u2 where u2.id = auth.uid()) is null
      )
    )
  );
