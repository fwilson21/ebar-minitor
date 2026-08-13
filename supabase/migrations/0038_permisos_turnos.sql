-- Completa la categoría "Turnos" que había quedado pendiente en la migración 0037: 'marcar_turnos'
-- (asignar operadores a un turno de fin de semana/feriado, y declarar un feriado nuevo desde el
-- mismo panel del día) y 'gestionar_feriados' (quitar de la lista un feriado ya declarado).
--
-- Igual que 0037: todas las políticas de abajo son ADICIONALES (Postgres RLS combina políticas
-- permisivas del mismo comando con OR) — no se toca ninguna política de administrador/supervisor/
-- digitador ya existente, así que nada de lo que ya funcionaba cambia si nadie tiene estos
-- permisos activados. tiene_permiso() ya devuelve true para administrador sin consultar la tabla.
--
-- Alcance: para que alguien SIN rol administrador/supervisor/digitador (ej. un operador) pueda
-- usar "Marcar turnos" de punta a punta, no alcanza con habilitar la escritura en
-- turnos_calendario — también necesita poder LEER la lista de operadores (usuarios) y las
-- asignaciones por defecto/turno (asignaciones_estacion) para armar el panel del día, y escribir
-- en asignaciones_estacion al guardar. Por eso esta migración toca más de una tabla.

-- ── turnos_calendario ────────────────────────────────────────────────────────────────────────

drop policy if exists turnos_calendario_select on public.turnos_calendario;
create policy turnos_calendario_select on public.turnos_calendario
  for select using (
    operador_id = auth.uid()
    or public.current_user_role() in ('administrador', 'supervisor', 'digitador')
    or public.tiene_permiso('marcar_turnos')
  );

drop policy if exists turnos_calendario_insert on public.turnos_calendario;
create policy turnos_calendario_insert on public.turnos_calendario
  for insert with check (public.tiene_permiso('marcar_turnos'));

drop policy if exists turnos_calendario_update on public.turnos_calendario;
create policy turnos_calendario_update on public.turnos_calendario
  for update using (public.tiene_permiso('marcar_turnos'));

drop policy if exists turnos_calendario_delete on public.turnos_calendario;
create policy turnos_calendario_delete on public.turnos_calendario
  for delete using (public.tiene_permiso('marcar_turnos'));

-- ── asignaciones_estacion (las que genera un turno, ligadas por turno_id) ──────────────────────

drop policy if exists asignaciones_select on public.asignaciones_estacion;
create policy asignaciones_select on public.asignaciones_estacion
  for select using (
    operador_id = auth.uid()
    or public.current_user_role() in ('administrador', 'supervisor')
    or public.tiene_permiso('marcar_turnos')
  );

drop policy if exists asignaciones_insert on public.asignaciones_estacion;
create policy asignaciones_insert on public.asignaciones_estacion
  for insert with check (public.current_user_role() in ('administrador', 'supervisor') or public.tiene_permiso('marcar_turnos'));

drop policy if exists asignaciones_update on public.asignaciones_estacion;
create policy asignaciones_update on public.asignaciones_estacion
  for update using (public.current_user_role() in ('administrador', 'supervisor') or public.tiene_permiso('marcar_turnos'));

drop policy if exists asignaciones_delete on public.asignaciones_estacion;
create policy asignaciones_delete on public.asignaciones_estacion
  for delete using (public.current_user_role() in ('administrador', 'supervisor') or public.tiene_permiso('marcar_turnos'));

-- ── feriados_adicionales: declarar (marcar_turnos) vs. quitar (gestionar_feriados) ─────────────

drop policy if exists "feriados_insert_admin_supervisor" on public.feriados_adicionales;
create policy "feriados_insert_admin_supervisor" on public.feriados_adicionales
  for insert with check (public.current_user_role() in ('administrador', 'supervisor') or public.tiene_permiso('marcar_turnos'));

drop policy if exists "feriados_delete_admin_supervisor" on public.feriados_adicionales;
create policy "feriados_delete_admin_supervisor" on public.feriados_adicionales
  for delete using (public.current_user_role() in ('administrador', 'supervisor') or public.tiene_permiso('gestionar_feriados'));

-- ── usuarios: ver la lista de operadores para armar el panel del día ────────────────────────────

drop policy if exists "usuarios_select_propio_o_admin" on public.usuarios;
create policy "usuarios_select_propio_o_admin" on public.usuarios
  for select using (
    id = auth.uid()
    or public.current_user_role() in ('administrador', 'supervisor', 'digitador')
    or public.tiene_permiso('marcar_turnos')
  );
