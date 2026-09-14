-- ============================================================================
-- Evidencia fotográfica obligatoria al justificar por qué no se visitó una
-- EBAR (migración 0055, justificaciones_no_visita) — pedido del usuario: 1 a
-- 3 fotos que respalden el motivo escrito, mismo mecanismo de cámara en vivo
-- que ya usan las visitas.
--
-- `fotos` hasta ahora solo servía a `visitas` (visita_id not null). En vez de
-- crear una tabla aparte (duplicar drive_file_id/url_publica/estado_subida/
-- índices/RLS), se reutiliza la misma tabla: `visita_id` pasa a ser opcional
-- y se agrega `justificacion_id` opcional — el check de abajo obliga a que
-- cada fila de `fotos` pertenezca a UNA sola de las dos (nunca ninguna, nunca
-- las dos), así el resto del código que ya filtra por `visita_id` sigue
-- funcionando sin tocarlo.
-- ============================================================================

alter table public.fotos alter column visita_id drop not null;

alter table public.fotos
  add column justificacion_id uuid references public.justificaciones_no_visita(id) on delete cascade;

alter table public.fotos
  add constraint fotos_pertenece_a_una_cosa
  check (
    (visita_id is not null and justificacion_id is null)
    or (visita_id is null and justificacion_id is not null)
  );

create index idx_fotos_justificacion on public.fotos(justificacion_id);

-- RLS: mismo criterio que ya tiene `justificaciones_no_visita` (quien la escribió, o
-- supervisor/administrador) para las 3 fotos de esa justificación.
drop policy if exists "fotos_select" on public.fotos;
drop policy if exists "fotos_insert" on public.fotos;
drop policy if exists "fotos_update" on public.fotos;

create policy "fotos_select" on public.fotos
  for select using (
    (visita_id is not null and exists (
      select 1 from public.visitas v where v.id = visita_id
        and (v.operador_id = auth.uid() or public.current_user_role() in ('administrador','supervisor'))
    ))
    or (justificacion_id is not null and exists (
      select 1 from public.justificaciones_no_visita j where j.id = justificacion_id
        and (j.creado_por = auth.uid() or public.current_user_role() in ('administrador','supervisor'))
    ))
  );
create policy "fotos_insert" on public.fotos
  for insert with check (
    (visita_id is not null and (
      exists (select 1 from public.visitas v where v.id = visita_id and v.operador_id = auth.uid())
      or public.current_user_role() = 'administrador'
    ))
    or (justificacion_id is not null and (
      exists (select 1 from public.justificaciones_no_visita j where j.id = justificacion_id and j.creado_por = auth.uid())
      or public.current_user_role() in ('administrador','supervisor')
    ))
  );
create policy "fotos_update" on public.fotos
  for update using (
    (visita_id is not null and (
      exists (select 1 from public.visitas v where v.id = visita_id and v.operador_id = auth.uid())
      or public.current_user_role() in ('administrador','supervisor')
    ))
    or (justificacion_id is not null and (
      exists (select 1 from public.justificaciones_no_visita j where j.id = justificacion_id and j.creado_por = auth.uid())
      or public.current_user_role() in ('administrador','supervisor')
    ))
  );

-- Borrar: mismo criterio que 0007_fotos_delete.sql, extendido con la misma rama de justificación.
drop policy if exists "fotos_delete" on public.fotos;
create policy "fotos_delete" on public.fotos
  for delete using (
    (visita_id is not null and exists (
      select 1 from public.visitas v where v.id = visita_id
        and (v.operador_id = auth.uid() or public.current_user_role() in ('administrador','supervisor'))
    ))
    or (justificacion_id is not null and exists (
      select 1 from public.justificaciones_no_visita j where j.id = justificacion_id
        and (j.creado_por = auth.uid() or public.current_user_role() in ('administrador','supervisor'))
    ))
  );

comment on column public.fotos.justificacion_id is
  'Si viene, esta foto es evidencia de una justificación de no-visita (no de una visita) — ver justificaciones_no_visita. Exactamente una de visita_id/justificacion_id va llena, nunca las dos ni ninguna.';
