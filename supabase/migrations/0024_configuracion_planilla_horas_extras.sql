-- ============================================================================
-- Firmantes por defecto de la Planilla de horas extras (Revisado por / Aprobado
-- por): antes vivían fijos en el código (PanelPlanillaHorasExtras.tsx). Se
-- guardan aquí como una fila única para que el administrador los pueda cambiar
-- desde la app y el cambio aplique a todas las planillas nuevas que se generen
-- de ahí en adelante, sin necesidad de tocar código.
-- ============================================================================

create table public.configuracion_planilla_horas_extras (
  id boolean primary key default true,
  revisado_nombre text not null default 'Ing. Adriana Alejandra Bazurto Bermejo',
  revisado_cargo text not null default 'ANALISTA DE REDES DE ALCANTARILLADO Y ESTACIONES DE BOMBEO DE AGUAS RESIDUALES',
  aprobado_nombre text not null default 'Ing. Freddy W. Vásconez A.',
  aprobado_cargo text not null default 'JEFE DE SERVICIOS DE ALCANTARILLADO',
  updated_at timestamptz not null default now(),
  constraint configuracion_planilla_horas_extras_singleton check (id)
);

insert into public.configuracion_planilla_horas_extras (id) values (true);

alter table public.configuracion_planilla_horas_extras enable row level security;

create policy configuracion_planilla_horas_extras_all on public.configuracion_planilla_horas_extras
  for all using (public.current_user_role() = 'administrador')
  with check (public.current_user_role() = 'administrador');

comment on table public.configuracion_planilla_horas_extras is
  'Fila única con los firmantes por defecto (Revisado por / Aprobado por) de la Planilla de horas extras.';
