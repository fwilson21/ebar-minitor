-- ============================================================================
-- EBAR Monitor — Permitir eliminar fotos ya subidas al editar una visita
-- ============================================================================
-- Mismo criterio que las demás políticas de `fotos`: el operador dueño de la
-- visita, o administrador/supervisor.
-- ============================================================================

drop policy if exists "fotos_delete" on public.fotos;

create policy "fotos_delete" on public.fotos
  for delete using (
    exists (select 1 from public.visitas v where v.id = visita_id
      and (v.operador_id = auth.uid() or public.current_user_role() in ('administrador','supervisor')))
  );
