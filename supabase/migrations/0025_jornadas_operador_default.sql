-- ============================================================================
-- Jornada normal por defecto de cada operador: hasta ahora, al crear una
-- planilla de horas extras nueva, la jornada (entrada/salida mañana y tarde)
-- se prellenaba solo si el operador ya tenía una planilla anterior; si era la
-- primera, siempre partía de 08:00-12:00/13:00-17:00 aunque ese operador
-- trabaje otro horario. Esta tabla deja guardar esa jornada por operador una
-- sola vez, para que cualquier planilla nueva (con o sin planilla previa) la
-- use como punto de partida.
-- ============================================================================

create table public.jornadas_operador_default (
  operador_id uuid primary key references public.usuarios(id) on delete cascade,
  jornada_inicio_manana time not null default '08:00',
  jornada_fin_manana time not null default '12:00',
  jornada_inicio_tarde time not null default '13:00',
  jornada_fin_tarde time not null default '17:00',
  updated_at timestamptz not null default now()
);

alter table public.jornadas_operador_default enable row level security;

create policy jornadas_operador_default_all on public.jornadas_operador_default
  for all using (public.current_user_role() = 'administrador')
  with check (public.current_user_role() = 'administrador');

comment on table public.jornadas_operador_default is
  'Jornada normal (sin horas extra) por defecto de cada operador, para prellenar una planilla de horas extras nueva aunque no tenga ninguna anterior.';
