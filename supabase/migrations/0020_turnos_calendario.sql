-- ============================================================================
-- Calendario de turnos de fin de semana/feriado.
-- Registra qué operador(es) están de turno un sábado, domingo o feriado
-- puntual. Al guardar un turno, la pantalla (CalendarioTurnos.tsx) inserta las
-- filas correspondientes en asignaciones_estacion (fecha = ese día, ligadas
-- por turno_id) para que ese día le aparezcan a ese operador sus EBAR a
-- atender exactamente igual que cualquier otra asignación especial — sin
-- tocar Dashboard/VisitForm/Stations, que ya combinan asignación por defecto
-- + especial del día.
-- A diferencia de asignaciones_estacion (admin y supervisor), el calendario
-- de turnos es exclusivo del administrador.
-- ============================================================================

create table public.turnos_calendario (
  id uuid primary key default uuid_generate_v4(),
  operador_id uuid not null references public.usuarios(id) on delete cascade,
  fecha date not null,
  creado_por uuid references public.usuarios(id),
  created_at timestamptz not null default now(),
  unique (operador_id, fecha)
);

create index idx_turnos_calendario_operador on public.turnos_calendario(operador_id);
create index idx_turnos_calendario_fecha on public.turnos_calendario(fecha);

alter table public.turnos_calendario enable row level security;

create policy turnos_calendario_select on public.turnos_calendario
  for select using (
    operador_id = auth.uid() or public.current_user_role() in ('administrador','supervisor')
  );

create policy turnos_calendario_insert on public.turnos_calendario
  for insert with check (public.current_user_role() = 'administrador');

create policy turnos_calendario_update on public.turnos_calendario
  for update using (public.current_user_role() = 'administrador');

create policy turnos_calendario_delete on public.turnos_calendario
  for delete using (public.current_user_role() = 'administrador');

comment on table public.turnos_calendario is
  'Calendario de quién está de turno cada sábado/domingo/feriado. Exclusivo del administrador.';

-- Vincula las filas de asignación especial que genera un turno, para poder
-- borrarlas solas si se elimina el turno, y para armar el resumen/PDF.
alter table public.asignaciones_estacion
  add column turno_id uuid references public.turnos_calendario(id) on delete cascade;

create index idx_asignaciones_turno on public.asignaciones_estacion(turno_id) where turno_id is not null;

comment on column public.asignaciones_estacion.turno_id is
  'Si esta asignación especial vino de un turno de fin de semana/feriado, referencia a turnos_calendario. Null si se cargó a mano.';
