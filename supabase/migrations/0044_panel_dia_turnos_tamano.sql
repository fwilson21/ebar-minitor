-- ============================================================================
-- Tamaño (ancho x alto en px) del panel que se abre al tocar un día en el
-- Calendario de turnos (CalendarioTurnos.tsx, componente PanelDia). El
-- administrador lo ajusta arrastrando una manija en la esquina inferior
-- derecha del panel; el tamaño que quede guardado se ve igual para
-- cualquier rol que abra el panel (una sola fila, sin variante por rol —
-- a diferencia de configuracion_ancho_contenido, que sí varía por pantalla
-- y por rol destino). Mismo patrón de tabla singleton que esa tabla.
-- ============================================================================

create table public.configuracion_panel_dia_turnos (
  clave text primary key default 'panel_dia_turnos',
  ancho_px integer not null default 448,
  alto_px integer not null default 600,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references public.usuarios(id),
  constraint configuracion_panel_dia_turnos_singleton check (clave = 'panel_dia_turnos')
);

insert into public.configuracion_panel_dia_turnos (clave) values ('panel_dia_turnos');

alter table public.configuracion_panel_dia_turnos enable row level security;

create policy "cualquiera autenticado puede leer configuracion_panel_dia_turnos"
  on public.configuracion_panel_dia_turnos for select
  to authenticated
  using (true);

create policy "solo administrador puede escribir configuracion_panel_dia_turnos"
  on public.configuracion_panel_dia_turnos for all
  to authenticated
  using (public.current_user_role() = 'administrador')
  with check (public.current_user_role() = 'administrador');
