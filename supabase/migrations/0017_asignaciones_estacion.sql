-- ============================================================================
-- Asignación de estaciones EBAR a operadores.
-- - Asignación "por defecto" (fecha = null): permanente, hasta que se quite.
-- - Asignación "especial" (fecha con valor): válida solo ese día puntual —
--   para fines de semana/feriados donde se cubre distinto, o refuerzos.
-- Gestionada por administrador y supervisor (no solo administrador).
-- ============================================================================

create table public.asignaciones_estacion (
  id uuid primary key default uuid_generate_v4(),
  operador_id uuid not null references public.usuarios(id) on delete cascade,
  estacion_id uuid not null references public.estaciones_ebar(id) on delete cascade,
  fecha date, -- null = asignación por defecto; con valor = asignación especial para ese día
  creado_por uuid references public.usuarios(id),
  created_at timestamptz not null default now()
);

-- Un operador no puede tener la misma estación asignada dos veces por defecto...
create unique index idx_asignaciones_default_unicas
  on public.asignaciones_estacion(operador_id, estacion_id)
  where fecha is null;

-- ...ni dos veces en el mismo día puntual.
create unique index idx_asignaciones_especiales_unicas
  on public.asignaciones_estacion(operador_id, estacion_id, fecha)
  where fecha is not null;

create index idx_asignaciones_operador on public.asignaciones_estacion(operador_id);
create index idx_asignaciones_fecha on public.asignaciones_estacion(fecha);

alter table public.asignaciones_estacion enable row level security;

-- El operador puede ver sus propias asignaciones (necesario para la vista de
-- "tus EBAR de hoy" de una próxima etapa); administrador/supervisor ven todas.
create policy asignaciones_select on public.asignaciones_estacion
  for select using (
    operador_id = auth.uid() or public.current_user_role() in ('administrador','supervisor')
  );

create policy asignaciones_insert on public.asignaciones_estacion
  for insert with check (public.current_user_role() in ('administrador','supervisor'));

create policy asignaciones_update on public.asignaciones_estacion
  for update using (public.current_user_role() in ('administrador','supervisor'));

create policy asignaciones_delete on public.asignaciones_estacion
  for delete using (public.current_user_role() in ('administrador','supervisor'));

comment on table public.asignaciones_estacion is
  'Qué EBAR debe visitar cada operador: por defecto (fecha null, permanente) o especial (fecha puntual). Gestionado por administrador/supervisor.';
