-- ============================================================================
-- Justificación de por qué no se visitó una EBAR, por día y por estación.
-- Una fila por estación+fecha (si se edita el motivo el mismo día, se
-- actualiza la misma fila en vez de crear otra — ver upsert en el frontend).
-- La puede escribir el operador asignado a esa EBAR, o supervisor/
-- administrador (mismo criterio flexible que ya usa asignaciones_estacion:
-- el frontend limita qué estaciones puede justificar cada operador —las
-- suyas de hoy—, no la base de datos). No bloquea nada, es solo informativo:
-- se muestra junto a la EBAR sin visitar y en el reporte del día.
-- ============================================================================

create table public.justificaciones_no_visita (
  id uuid primary key default uuid_generate_v4(),
  estacion_id uuid not null references public.estaciones_ebar(id) on delete cascade,
  fecha date not null,
  motivo text not null,
  creado_por uuid not null references public.usuarios(id) on delete restrict,
  creado_en timestamptz not null default now(),
  unique (estacion_id, fecha)
);

create index idx_justificaciones_fecha on public.justificaciones_no_visita(fecha);
create index idx_justificaciones_estacion on public.justificaciones_no_visita(estacion_id);

alter table public.justificaciones_no_visita enable row level security;

-- Cualquier autenticado la puede ver (aparece en el Dashboard y en el reporte
-- del día para los 3 roles, igual que estaciones_ebar).
create policy "justificaciones_select_autenticados" on public.justificaciones_no_visita
  for select using (auth.uid() is not null);

-- Operador, supervisor y administrador pueden justificar. El operador solo ve
-- el botón para sus EBAR asignadas de hoy (filtro del frontend, no de la
-- base) — mismo criterio que ya se usa para asignaciones_estacion.
create policy "justificaciones_insert" on public.justificaciones_no_visita
  for insert with check (public.current_user_role() in ('operador', 'supervisor', 'administrador'));

-- Editar: quien la escribió originalmente, o supervisor/administrador (para
-- poder corregir la nota de un operador).
create policy "justificaciones_update" on public.justificaciones_no_visita
  for update using (
    creado_por = auth.uid() or public.current_user_role() in ('administrador', 'supervisor')
  );

-- Borrar: solo supervisor/administrador (el operador no puede hacer
-- desaparecer su propia justificación una vez puesta).
create policy "justificaciones_delete" on public.justificaciones_no_visita
  for delete using (public.current_user_role() in ('administrador', 'supervisor'));

comment on table public.justificaciones_no_visita is
  'Motivo por el que una EBAR no se visitó un día puntual (ej. equipo en otra EBAR/actividad) — escrito por el operador asignado o por supervisor/administrador. No bloquea nada, es solo informativo.';
