-- ============================================================================
-- Las fotos de una justificación de no-visita deben verse igual de abiertas
-- que el propio motivo (justificaciones_no_visita ya es "select" para
-- cualquier autenticado, migración 0055) — la política de `fotos` (migración
-- 0063) había quedado más estricta para esa rama (creado_por o admin/
-- supervisor), así que un operador viendo la justificación de OTRO
-- compañero (ej. desde el detalle de la estación, StationDetail.tsx) veía el
-- motivo escrito pero ninguna foto, sin ningún aviso de por qué.
--
-- Solo se toca SELECT — insert/update/delete de fotos siguen exactamente
-- igual que en 0063 (creado_por o admin/supervisor).
-- ============================================================================

drop policy if exists "fotos_select" on public.fotos;

create policy "fotos_select" on public.fotos
  for select using (
    (visita_id is not null and exists (
      select 1 from public.visitas v where v.id = visita_id
        and (v.operador_id = auth.uid() or public.current_user_role() in ('administrador','supervisor'))
    ))
    or (justificacion_id is not null and auth.uid() is not null)
  );
