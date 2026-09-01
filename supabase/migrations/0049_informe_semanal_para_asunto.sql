-- ============================================================================
-- Encabezado tipo memo del Informe Semanal (formato GADMFO): "Para" y "Asunto"
-- ============================================================================
-- "De:" y "Fecha:" del encabezado ya salían de firma_nombre/firma_cargo/
-- firma_fecha (columnas existentes) — acá solo faltaban "Para" (a quién va
-- dirigido, ej. el director) y "Asunto". Igual que conclusiones/
-- recomendaciones: editables, y se copian de la semana pasada como punto de
-- partida (ver InformeSemanal.tsx).
-- ============================================================================

alter table public.informes_semanales
  add column if not exists para_nombre text not null default '',
  add column if not exists para_cargo text not null default '',
  add column if not exists asunto text not null default '';
