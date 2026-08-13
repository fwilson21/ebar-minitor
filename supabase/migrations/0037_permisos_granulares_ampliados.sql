-- Amplía el sistema de permisos granulares (migraciones 0028/0030/0035) más allá de Usuarios:
-- ahora también cubre Estaciones (crear estaciones, gestionar bombas), Planillas de horas
-- extras (eliminar, editar configuración) y Distribución de pantallas ("Editar distribución",
-- antes exclusivo del administrador real en TODAS las pantallas). Ver /permisos en la app —
-- la lista ahora se muestra anidada por categoría (src/lib/funcionesPermisos.ts).
--
-- No se toca ninguna política existente de administrador real (current_user_role() =
-- 'administrador') — todas las de abajo son políticas ADICIONALES (Postgres RLS combina varias
-- políticas permisivas del mismo comando con OR), así que el administrador sigue funcionando
-- exactamente igual aunque nadie más tenga ningún permiso activado. tiene_permiso() ya devuelve
-- true para administrador sin consultar la tabla (ver migración 0028), así que no hace falta
-- repetir la condición de rol en las políticas nuevas.
--
-- Pendiente a propósito (no incluido en esta migración): "Turnos" (marcar turno, declarar/quitar
-- feriados) — interactúa con el modo de solo-consulta que ya tiene el digitador en esa pantalla
-- y se prefirió no tocar de apuro. Se agrega después con el mismo patrón.

-- ── Estaciones ──────────────────────────────────────────────────────────────────────────────

-- crear_estaciones
drop policy if exists "estaciones_insert_admin" on public.estaciones_ebar;
create policy "estaciones_insert_admin" on public.estaciones_ebar
  for insert with check (public.tiene_permiso('crear_estaciones'));

-- gestionar_bombas: también necesita poder actualizar estaciones_ebar.numero_bombas, un
-- contador que se recalcula solo cada vez que se agrega/activa/desactiva una bomba (ver
-- sincronizarConteoBombas en StationDetail.tsx) — por eso el permiso se suma acá también, no
-- solo en la tabla bombas. No queda tan finamente recortado por columna como usuarios_update_*
-- (migración 0030): quien tenga este permiso técnicamente podría actualizar otros campos de
-- estaciones_ebar por fuera de la UI — riesgo aceptado, es personal de confianza y no hay
-- escalación de privilegios posible (a diferencia de cambiar el rol de alguien).
drop policy if exists "estaciones_update_admin" on public.estaciones_ebar;
create policy "estaciones_update_admin" on public.estaciones_ebar
  for update using (public.current_user_role() = 'administrador' or public.tiene_permiso('gestionar_bombas'));

drop policy if exists "bombas_write_admin" on public.bombas;
create policy "bombas_write_admin" on public.bombas
  for all
  using (public.current_user_role() = 'administrador' or public.tiene_permiso('gestionar_bombas'))
  with check (public.current_user_role() = 'administrador' or public.tiene_permiso('gestionar_bombas'));

-- ── Planillas de horas extras ───────────────────────────────────────────────────────────────

-- eliminar_planillas_horas_extras: política adicional solo para DELETE — la política existente
-- planillas_horas_extras_all (solo administrador, migración 0022) sigue intacta para el resto.
drop policy if exists "planillas_horas_extras_delete_permiso" on public.planillas_horas_extras;
create policy "planillas_horas_extras_delete_permiso" on public.planillas_horas_extras
  for delete using (public.tiene_permiso('eliminar_planillas_horas_extras'));

-- editar_configuracion_planillas: firmantes por defecto + jornada por defecto de cada operador.
drop policy if exists "configuracion_planilla_horas_extras_permiso" on public.configuracion_planilla_horas_extras;
create policy "configuracion_planilla_horas_extras_permiso" on public.configuracion_planilla_horas_extras
  for all
  using (public.tiene_permiso('editar_configuracion_planillas'))
  with check (public.tiene_permiso('editar_configuracion_planillas'));

drop policy if exists "jornadas_operador_default_permiso" on public.jornadas_operador_default;
create policy "jornadas_operador_default_permiso" on public.jornadas_operador_default
  for all
  using (public.tiene_permiso('editar_configuracion_planillas'))
  with check (public.tiene_permiso('editar_configuracion_planillas'));

-- ── Distribución de pantallas ("Editar distribución") ───────────────────────────────────────
-- Aplica por igual a layouts_admin (acomodo de bloques) y configuracion_ancho_contenido (ancho
-- de pantalla) — es una sola acción conceptual repetida en todas las pantallas que la usan.

drop policy if exists "layouts_admin_permiso_distribucion" on public.layouts_admin;
create policy "layouts_admin_permiso_distribucion" on public.layouts_admin
  for all
  using (public.tiene_permiso('editar_distribucion'))
  with check (public.tiene_permiso('editar_distribucion'));

drop policy if exists "configuracion_ancho_contenido_permiso_distribucion" on public.configuracion_ancho_contenido;
create policy "configuracion_ancho_contenido_permiso_distribucion" on public.configuracion_ancho_contenido
  for all
  using (public.tiene_permiso('editar_distribucion'))
  with check (public.tiene_permiso('editar_distribucion'));
