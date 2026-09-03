-- ============================================================================
-- Excepción puntual al bloqueo por GPS (ver VisitForm.tsx, DISTANCIA_MAXIMA_METROS)
-- para un operador+estación con problemas conocidos de cobertura (ej. Lapo en
-- EBAR-9, sin señal de datos suficiente para que el GPS logre ubicarse dentro
-- de la cámara de concreto). La otorga supervisor/administrador — no es algo
-- que el operador pueda auto-concederse — con 3 alcances posibles según las
-- 2 fechas:
--   fecha_inicio = fecha_fin = un día          -> excepción de un solo día
--   fecha_inicio < fecha_fin                   -> excepción por un rango de días
--   fecha_inicio y fecha_fin ambas null        -> indefinida ("todos los días"),
--                                                  hasta que se quite a mano
-- Mientras esté activa para la fecha de hoy, VisitForm.tsx deja pasar la
-- visita sin exigir que el GPS confirme la ubicación — no se guarda ninguna
-- marca especial en la visita, el registro de "quién/cuándo/por qué" queda en
-- esta misma tabla.
-- ============================================================================

create table public.excepciones_gps (
  id uuid primary key default uuid_generate_v4(),
  operador_id uuid not null references public.usuarios(id) on delete cascade,
  estacion_id uuid not null references public.estaciones_ebar(id) on delete cascade,
  fecha_inicio date,
  fecha_fin date,
  creado_por uuid not null references public.usuarios(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint excepciones_gps_rango_valido check (
    fecha_inicio is null or fecha_fin is null or fecha_fin >= fecha_inicio
  )
);

create index idx_excepciones_gps_operador_estacion on public.excepciones_gps(operador_id, estacion_id);

alter table public.excepciones_gps enable row level security;

-- El operador puede ver sus propias excepciones (VisitForm.tsx necesita consultarlas);
-- administrador/supervisor ven todas (pantalla de gestión en /asignaciones).
create policy "excepciones_gps_select" on public.excepciones_gps
  for select using (
    operador_id = auth.uid() or public.current_user_role() in ('administrador', 'supervisor')
  );

create policy "excepciones_gps_insert" on public.excepciones_gps
  for insert with check (public.current_user_role() in ('administrador', 'supervisor'));

create policy "excepciones_gps_delete" on public.excepciones_gps
  for delete using (public.current_user_role() in ('administrador', 'supervisor'));

comment on table public.excepciones_gps is
  'Excepción al bloqueo por GPS al registrar una visita, otorgada por supervisor/administrador a un operador en una EBAR puntual — un día, un rango de fechas, o indefinida (ambas fechas null). No se auto-concede.';
