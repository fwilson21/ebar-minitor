-- ============================================================================
-- Restringe quién puede VER una justificación de no-visita (y sus fotos):
-- antes (migración 0055) cualquier autenticado veía cualquier justificación
-- de cualquier EBAR. El usuario pidió que un operador solo pueda ver la
-- justificación que puso OTRO operador si esa EBAR le corresponde a él por
-- ASIGNACIÓN POR DEFECTO (asignaciones_estacion con fecha null) — si no le
-- corresponde ninguna EBAR de esas, no debe poder ver la justificación de
-- otro compañero ahí. Administrador/supervisor y quien la escribió siguen
-- viendo cualquiera, sin este filtro.
--
-- Deliberadamente NO cuenta la asignación "especial por fecha" (fecha no
-- null) — el pedido dice explícitamente "por defecto".
-- ============================================================================

drop policy if exists "justificaciones_select_autenticados" on public.justificaciones_no_visita;

create policy "justificaciones_select" on public.justificaciones_no_visita
  for select using (
    creado_por = auth.uid()
    or public.current_user_role() in ('administrador', 'supervisor')
    or exists (
      select 1 from public.asignaciones_estacion a
      where a.estacion_id = justificaciones_no_visita.estacion_id
        and a.operador_id = auth.uid()
        and a.fecha is null
    )
  );

-- Las fotos de una justificación (migración 0063) tienen que seguir exactamente el mismo criterio
-- que la justificación a la que pertenecen — mismo motivo por el que 0065 las había igualado a
-- "cualquier autenticado" cuando la propia justificación todavía era así de abierta.
drop policy if exists "fotos_select" on public.fotos;

create policy "fotos_select" on public.fotos
  for select using (
    (visita_id is not null and exists (
      select 1 from public.visitas v where v.id = visita_id
        and (v.operador_id = auth.uid() or public.current_user_role() in ('administrador','supervisor'))
    ))
    or (justificacion_id is not null and exists (
      select 1 from public.justificaciones_no_visita j
      where j.id = justificacion_id
        and (
          j.creado_por = auth.uid()
          or public.current_user_role() in ('administrador', 'supervisor')
          or exists (
            select 1 from public.asignaciones_estacion a
            where a.estacion_id = j.estacion_id
              and a.operador_id = auth.uid()
              and a.fecha is null
          )
        )
    ))
  );
