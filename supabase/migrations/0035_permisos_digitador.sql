-- Permisos de acceso para el rol "digitador" (ver 0034_rol_digitador.sql — correr esa migración
-- ANTES que esta). El digitador elabora planillas de horas extras: puede ver/crear/editar
-- planillas, pero no borrarlas (solo administrador) ni tocar los ajustes globales de "Firmantes
-- por defecto"/"Jornadas por defecto por operador" (esos ya quedaron ocultos para él en el
-- frontend, ver PanelPlanillaHorasExtras.tsx — acá solo hace falta que pueda LEER esos ajustes
-- para que se prellenen bien al generar el PDF).

-- Ver la lista de operadores (desplegable "Trabajador" al crear/editar una planilla).
drop policy if exists "usuarios_select_propio_o_admin" on public.usuarios;
create policy "usuarios_select_propio_o_admin" on public.usuarios
  for select using (id = auth.uid() or public.current_user_role() in ('administrador', 'supervisor', 'digitador'));

-- "Traer días del calendario de turnos" dentro de una planilla lee turnos_calendario, aunque el
-- digitador no vea la pantalla del calendario en sí.
drop policy if exists turnos_calendario_select on public.turnos_calendario;
create policy turnos_calendario_select on public.turnos_calendario
  for select using (
    operador_id = auth.uid() or public.current_user_role() in ('administrador', 'supervisor', 'digitador')
  );

-- Firmantes por defecto (Revisado por / Aprobado por) y jornada por defecto de cada operador:
-- solo lectura para el digitador, para que se prellenen al generar el PDF — la edición de estos
-- 2 ajustes globales sigue siendo exclusiva del administrador (política "_all" ya existente).
drop policy if exists configuracion_planilla_horas_extras_select_digitador on public.configuracion_planilla_horas_extras;
create policy configuracion_planilla_horas_extras_select_digitador on public.configuracion_planilla_horas_extras
  for select using (public.current_user_role() = 'digitador');

drop policy if exists jornadas_operador_default_select_digitador on public.jornadas_operador_default;
create policy jornadas_operador_default_select_digitador on public.jornadas_operador_default
  for select using (public.current_user_role() = 'digitador');

-- Planillas de horas extras: el digitador puede ver/crear/editar, no borrar (borrar sigue
-- exclusivo de administrador vía la política "_all" ya existente).
drop policy if exists planillas_horas_extras_select_digitador on public.planillas_horas_extras;
create policy planillas_horas_extras_select_digitador on public.planillas_horas_extras
  for select using (public.current_user_role() = 'digitador');
drop policy if exists planillas_horas_extras_insert_digitador on public.planillas_horas_extras;
create policy planillas_horas_extras_insert_digitador on public.planillas_horas_extras
  for insert with check (public.current_user_role() = 'digitador');
drop policy if exists planillas_horas_extras_update_digitador on public.planillas_horas_extras;
create policy planillas_horas_extras_update_digitador on public.planillas_horas_extras
  for update using (public.current_user_role() = 'digitador');

drop policy if exists planilla_horas_extras_filas_select_digitador on public.planilla_horas_extras_filas;
create policy planilla_horas_extras_filas_select_digitador on public.planilla_horas_extras_filas
  for select using (public.current_user_role() = 'digitador');
drop policy if exists planilla_horas_extras_filas_insert_digitador on public.planilla_horas_extras_filas;
create policy planilla_horas_extras_filas_insert_digitador on public.planilla_horas_extras_filas
  for insert with check (public.current_user_role() = 'digitador');
drop policy if exists planilla_horas_extras_filas_update_digitador on public.planilla_horas_extras_filas;
create policy planilla_horas_extras_filas_update_digitador on public.planilla_horas_extras_filas
  for update using (public.current_user_role() = 'digitador');
