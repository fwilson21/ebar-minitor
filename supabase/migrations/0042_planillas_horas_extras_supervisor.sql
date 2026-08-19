-- ============================================================================
-- Planilla de horas extras: falta el rol "supervisor" en 3 tablas
-- ============================================================================
-- La pantalla de Turnos ya deja entrar y usar "Planilla de horas extras" a
-- supervisor (ve la tarjeta, el botón "Abrir", "+ Nueva planilla", etc.), pero
-- las políticas RLS de planillas_horas_extras/configuracion_planilla_horas_extras/
-- jornadas_operador_default solo cubrían administrador, digitador (migración
-- 0035) y quien tuviera el permiso granular 'editar_configuracion_planillas'
-- (migración 0037) — supervisor se quedó afuera. Como resultado, al abrir una
-- planilla, la consulta a configuracion_planilla_horas_extras no traía ninguna
-- fila (bloqueada por RLS) y la pantalla se quedaba en "Cargando…" sin poder
-- cerrarse (ver también el fix en PanelPlanillaHorasExtras.tsx para que esto
-- ya no vuelva a dejar a nadie atrapado, sea cual sea la causa).
--
-- Mismo patrón que 0035 (digitador) y 0038 (turnos_calendario/asignaciones):
-- políticas ADICIONALES, no tocan nada de lo que ya funcionaba.
-- ============================================================================

drop policy if exists planillas_horas_extras_select_supervisor on public.planillas_horas_extras;
create policy planillas_horas_extras_select_supervisor on public.planillas_horas_extras
  for select using (public.current_user_role() = 'supervisor');

drop policy if exists planillas_horas_extras_insert_supervisor on public.planillas_horas_extras;
create policy planillas_horas_extras_insert_supervisor on public.planillas_horas_extras
  for insert with check (public.current_user_role() = 'supervisor');

drop policy if exists planillas_horas_extras_update_supervisor on public.planillas_horas_extras;
create policy planillas_horas_extras_update_supervisor on public.planillas_horas_extras
  for update using (public.current_user_role() = 'supervisor');

-- Solo lectura (igual que el digitador) — editar estos 2 ajustes sigue siendo exclusivo de
-- administrador o de quien tenga el permiso granular 'editar_configuracion_planillas'.
drop policy if exists configuracion_planilla_horas_extras_select_supervisor on public.configuracion_planilla_horas_extras;
create policy configuracion_planilla_horas_extras_select_supervisor on public.configuracion_planilla_horas_extras
  for select using (public.current_user_role() = 'supervisor');

drop policy if exists jornadas_operador_default_select_supervisor on public.jornadas_operador_default;
create policy jornadas_operador_default_select_supervisor on public.jornadas_operador_default
  for select using (public.current_user_role() = 'supervisor');

-- Filas de cada planilla (los días de la tabla) — mismo faltante para supervisor.
drop policy if exists planilla_horas_extras_filas_select_supervisor on public.planilla_horas_extras_filas;
create policy planilla_horas_extras_filas_select_supervisor on public.planilla_horas_extras_filas
  for select using (public.current_user_role() = 'supervisor');

drop policy if exists planilla_horas_extras_filas_insert_supervisor on public.planilla_horas_extras_filas;
create policy planilla_horas_extras_filas_insert_supervisor on public.planilla_horas_extras_filas
  for insert with check (public.current_user_role() = 'supervisor');

drop policy if exists planilla_horas_extras_filas_update_supervisor on public.planilla_horas_extras_filas;
create policy planilla_horas_extras_filas_update_supervisor on public.planilla_horas_extras_filas
  for update using (public.current_user_role() = 'supervisor');

-- De paso: al editar una planilla y quitar un día de la tabla, guardar() borra esa fila
-- (planilla_horas_extras_filas.delete) — la migración 0035 nunca le dio permiso de DELETE al
-- digitador para esto (solo select/insert/update), así que le fallaba en silencio (la fila se
-- veía quitada en pantalla pero seguía en la base). Se agrega para digitador y supervisor.
drop policy if exists planilla_horas_extras_filas_delete_digitador on public.planilla_horas_extras_filas;
create policy planilla_horas_extras_filas_delete_digitador on public.planilla_horas_extras_filas
  for delete using (public.current_user_role() = 'digitador');

drop policy if exists planilla_horas_extras_filas_delete_supervisor on public.planilla_horas_extras_filas;
create policy planilla_horas_extras_filas_delete_supervisor on public.planilla_horas_extras_filas
  for delete using (public.current_user_role() = 'supervisor');
