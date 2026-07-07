-- ============================================================================
-- EBAR Monitor — Nuevos campos de estado de equipos por visita
-- ============================================================================
-- Cada columna almacena { estado, observaciones } como JSONB.
-- Las fotografías se almacenan en la tabla `fotos` usando el campo `descripcion`
-- para identificar a qué sección pertenecen (lineas_impulsion, valvulas, etc.)
-- ============================================================================

alter table public.visitas
  add column if not exists lineas_impulsion     jsonb,
  add column if not exists valvulas             jsonb,
  add column if not exists camara_llegada       jsonb,
  add column if not exists tablero_distribucion jsonb,
  add column if not exists variador             jsonb;

comment on column public.visitas.lineas_impulsion     is 'Estado de líneas de impulsión y guías de izado. Estructura: {estado, observaciones}';
comment on column public.visitas.valvulas             is 'Estado de válvulas. Estructura: {estado, observaciones}';
comment on column public.visitas.camara_llegada       is 'Estado de la cámara de llegada al cárcamo de bombeo. Estructura: {estado, observaciones}';
comment on column public.visitas.tablero_distribucion is 'Estado del tablero de distribución, contactores y breakers. Estructura: {estado, observaciones}';
comment on column public.visitas.variador             is 'Estado del variador de frecuencia. Estructura: {estado, observaciones}';
