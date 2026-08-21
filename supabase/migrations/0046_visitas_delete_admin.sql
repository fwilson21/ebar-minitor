-- Permite al administrador eliminar una visita completa — hasta ahora `visitas` no tenía
-- ninguna política de DELETE, así que estaba bloqueado a nivel de base de datos sin importar el
-- rol. Útil para visitas mal cargadas o hechas solo de prueba (pedido explícito del usuario).
-- Sus registros_bombas y fotos se borran en cascada (FK "on delete cascade", ver 0001_init.sql);
-- las fotos que ya estaban subidas a Google Drive quedan huérfanas ahí, mismo comportamiento ya
-- aceptado al borrar una foto suelta (ver eliminarFotoGuardada en src/lib/fotos.ts).
create policy "visitas_delete_admin" on public.visitas
  for delete using (public.current_user_role() = 'administrador');
