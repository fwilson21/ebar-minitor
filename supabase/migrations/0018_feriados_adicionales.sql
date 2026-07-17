-- ============================================================================
-- Feriados adicionales/ajustados: el calendario base (nacionales de Ecuador +
-- cantonización de Francisco de Orellana 30-abril + provincialización de
-- Orellana 30-julio) se calcula en el cliente (src/lib/feriadosEcuador.ts).
-- Esta tabla es solo para que administrador/supervisor agreguen o corrijan una
-- fecha puntual cuando sale una resolución de traslado específica de un año,
-- que no se puede calcular de antemano.
-- ============================================================================

create table public.feriados_adicionales (
  id uuid primary key default uuid_generate_v4(),
  fecha date not null unique,
  descripcion text not null,
  creado_por uuid references public.usuarios(id),
  created_at timestamptz not null default now()
);

alter table public.feriados_adicionales enable row level security;

create policy "feriados_select_autenticados" on public.feriados_adicionales
  for select using (auth.uid() is not null);

create policy "feriados_insert_admin_supervisor" on public.feriados_adicionales
  for insert with check (public.current_user_role() in ('administrador','supervisor'));

create policy "feriados_delete_admin_supervisor" on public.feriados_adicionales
  for delete using (public.current_user_role() in ('administrador','supervisor'));

comment on table public.feriados_adicionales is
  'Fechas puntuales agregadas a mano por administrador/supervisor, además del calendario de feriados calculado en el cliente.';
