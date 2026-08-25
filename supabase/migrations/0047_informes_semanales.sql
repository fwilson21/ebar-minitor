-- ============================================================================
-- Informe Semanal (analista de redes, rol supervisor): borrador automático del
-- informe semanal en formato GADMFO armado a partir de las visitas ya
-- registradas por los operadores, guardado día por día (no todo junto al
-- final) para que la analista pueda ir aprobando de a un día y retomar más
-- tarde sin rehacer lo ya aprobado. Ver memoria del proyecto "Informe Semanal"
-- para el detalle completo de fases/decisiones aprobadas.
--
-- Dos tablas:
--   informes_semanales       — una fila por semana (lunes a viernes), con los
--                               campos de todo el informe que no son día por
--                               día: antecedentes, conclusiones,
--                               recomendaciones, firma, asistencia semanal
--                               (jsonb, un código por operador/fecha) y el N.º
--                               de informe (se pone recién al final).
--   informes_semanales_dias  — una fila por día (5 por semana). `contenido`
--                               guarda los bloques estación/operador editados
--                               por la analista (responsable, viñetas, fotos
--                               elegidas). `aprobado` fija el día. Al aprobar
--                               se guarda además `snapshot_visitas`: una copia
--                               liviana (id + texto de observaciones + fecha
--                               de actualización) de las visitas que se usaron
--                               ese día, para poder comparar más tarde si el
--                               operador editó/agregó algo después de
--                               aprobado y avisarle a la analista en vez de
--                               desactualizar el informe en silencio.
--
-- "Semana desde/hasta" es única (una sola fila por semana calendario) — el
-- candado de semana lo aplica la pantalla (no se edita el rango una vez que
-- ya hay al menos un día guardado), no hace falta reforzarlo acá.
-- ============================================================================

create table public.informes_semanales (
  id uuid primary key default uuid_generate_v4(),
  semana_desde date not null,
  semana_hasta date not null,
  antecedentes text not null default '',
  conclusiones text not null default '',
  recomendaciones text not null default '',
  firma_fecha date,
  firma_nombre text not null default 'Ing. Andrea E. Logacho',
  firma_cargo text not null default 'Analista de Redes de Alcantarillado y Estaciones de Bombeo de Aguas Residuales',
  -- { "<operador_id>": { "YYYY-MM-DD": "T" } } — códigos T/FT/DJ/DM/F/VA/PP/CM/M/PS/DE/PCD.
  asistencia jsonb not null default '{}'::jsonb,
  numero_informe text,
  creado_por uuid references public.usuarios(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  generado_en timestamptz,
  unique (semana_desde)
);

create table public.informes_semanales_dias (
  id uuid primary key default uuid_generate_v4(),
  informe_id uuid not null references public.informes_semanales(id) on delete cascade,
  fecha date not null,
  -- Array de bloques: [{ estacion_id, estacion_nombre, operador_id, operador_nombre,
  -- responsable, hora_inicio, hora_fin, vinetas: string[], fotos_seleccionadas: string[] }]
  contenido jsonb not null default '[]'::jsonb,
  aprobado boolean not null default false,
  aprobado_en timestamptz,
  aprobado_por uuid references public.usuarios(id),
  -- Array de [{ visita_id, texto, actualizado_en }] tomado al momento de aprobar — compararlo
  -- contra las visitas actuales de ese día es lo que detecta "⚠️ Cambió algo".
  snapshot_visitas jsonb,
  updated_at timestamptz not null default now(),
  unique (informe_id, fecha)
);

create index idx_informes_semanales_dias_informe on public.informes_semanales_dias(informe_id);

alter table public.informes_semanales enable row level security;
alter table public.informes_semanales_dias enable row level security;

-- Exclusivo de administrador y supervisor (la analista entra como supervisor) — mismo patrón que
-- planillas_horas_extras (ver 0022 + 0042).
create policy informes_semanales_all on public.informes_semanales
  for all using (public.current_user_role() in ('administrador', 'supervisor'))
  with check (public.current_user_role() in ('administrador', 'supervisor'));

create policy informes_semanales_dias_all on public.informes_semanales_dias
  for all using (public.current_user_role() in ('administrador', 'supervisor'))
  with check (public.current_user_role() in ('administrador', 'supervisor'));

comment on table public.informes_semanales is
  'Informe semanal de la analista de redes (formato GADMFO), una fila por semana lunes-viernes. Exclusivo de administrador/supervisor.';
comment on table public.informes_semanales_dias is
  'Contenido y estado de aprobación de cada día del informe semanal, con snapshot de las visitas usadas para detectar cambios posteriores.';
