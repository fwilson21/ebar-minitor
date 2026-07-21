-- ============================================================================
-- Planilla de horas extras (formato "PLANILLA HORAS EXTRAS" de la Jefatura de
-- Servicios de Alcantarillado): registra, por trabajador y período, los días
-- con horas extra autorizadas por memorando, para generar el PDF horizontal
-- que se entrega a Talento Humano.
-- El trabajador puede ser un operador ya registrado en la app (operador_id) o
-- alguien que no tiene cuenta (supervisor, chofer, auxiliar, etc.) — en ese
-- caso operador_id queda null y nombre_trabajador/cargo_trabajador se
-- escriben a mano. Exclusivo del administrador, igual que el resto de
-- CalendarioTurnos.tsx.
-- ============================================================================

create table public.planillas_horas_extras (
  id uuid primary key default uuid_generate_v4(),
  operador_id uuid references public.usuarios(id) on delete set null,
  nombre_trabajador text not null,
  cargo_trabajador text not null,
  direccion text not null default 'DIRECCIÓN DE AGUA POTABLE Y ALCANTARILLADO GADMFO',
  area text not null default '',
  fecha_presentacion date,
  fecha_desde date not null,
  fecha_hasta date not null,
  -- Jornada de referencia (horario normal sin horas extra) usada para
  -- prellenar cada fila nueva y para repartir Mañana/Tarde cuando un día no
  -- tiene marcación de mediodía (ver planilla_horas_extras_filas).
  jornada_inicio_manana time not null default '08:00',
  jornada_fin_manana time not null default '12:00',
  jornada_inicio_tarde time not null default '13:00',
  jornada_fin_tarde time not null default '17:00',
  revisado_nombre text not null default 'Ing. Adriana Alejandra Bazurto Bermejo',
  revisado_cargo text not null default 'ANALISTA DE REDES DE ALCANTARILLADO Y ESTACIONES DE BOMBEO DE AGUAS RESIDUALES',
  aprobado_nombre text not null default 'Ing. Freddy W. Vásconez A.',
  aprobado_cargo text not null default 'JEFE DE SERVICIOS DE ALCANTARILLADO',
  creado_por uuid references public.usuarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_planillas_horas_extras_operador on public.planillas_horas_extras(operador_id);

create table public.planilla_horas_extras_filas (
  id uuid primary key default uuid_generate_v4(),
  planilla_id uuid not null references public.planillas_horas_extras(id) on delete cascade,
  fecha date not null,
  descripcion_actividades text,
  numero_memorando text,
  entrada_manana time,
  salida_manana time,
  entrada_tarde time,
  salida_tarde time,
  -- Sugeridas automáticamente a partir del horario (ver src/lib/horasExtras.ts)
  -- pero editables a mano, porque en la práctica no siempre coinciden con la
  -- resta exacta del reloj (dependen de lo que autorice el memorando).
  horas_manana numeric(5,2),
  horas_tarde numeric(5,2),
  horas_extra numeric(5,2)
);

create index idx_planilla_filas_planilla on public.planilla_horas_extras_filas(planilla_id);
create index idx_planilla_filas_fecha on public.planilla_horas_extras_filas(fecha);

alter table public.planillas_horas_extras enable row level security;
alter table public.planilla_horas_extras_filas enable row level security;

create policy planillas_horas_extras_all on public.planillas_horas_extras
  for all using (public.current_user_role() = 'administrador')
  with check (public.current_user_role() = 'administrador');

create policy planilla_horas_extras_filas_all on public.planilla_horas_extras_filas
  for all using (public.current_user_role() = 'administrador')
  with check (public.current_user_role() = 'administrador');

comment on table public.planillas_horas_extras is
  'Planillas de horas extras (formato de Talento Humano) por trabajador y período. Exclusivo del administrador.';
comment on table public.planilla_horas_extras_filas is
  'Filas de días con horas extra dentro de una planilla (fecha, actividad, memorando, horario y horas).';
