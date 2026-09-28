-- ============================================================================
-- URGENTE — revierte 0068. Desde que se corrió (2026-09-28 14:58 UTC) ningún
-- operador podía entrar a la app: la política nueva de `usuarios` consultaba
-- `justificaciones_no_visita`, cuya propia política vuelve a consultar
-- `usuarios` → Postgres corta con "infinite recursion detected in policy for
-- relation usuarios" (visto en los logs) cada vez que un operador lee su perfil
-- al iniciar sesión. Reportado por el usuario: Vega no podía ingresar desde su
-- iPhone aunque no tenía celular vinculado.
--
-- 0068 ya no hace falta: el reporte de un operador ahora solo trae SUS propias
-- justificaciones (Reports.tsx, commit cc9b060), así que el nombre que se
-- muestra siempre es el suyo, que ya podía leer. Se vuelve exactamente a la
-- política de 0038.
-- ============================================================================

drop policy if exists "usuarios_select_propio_o_admin" on public.usuarios;

create policy "usuarios_select_propio_o_admin" on public.usuarios
  for select using (
    id = auth.uid()
    or public.current_user_role() in ('administrador', 'supervisor', 'digitador')
    or public.tiene_permiso('marcar_turnos')
  );
