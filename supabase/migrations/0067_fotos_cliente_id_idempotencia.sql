-- ============================================================================
-- Fotos duplicadas al subir con una red inestable (reportado por el usuario,
-- 2026-09-23 — operadores usando el wifi de una institución sin salida
-- confiable a internet): si la subida A GOOGLE DRIVE termina bien pero la
-- RESPUESTA de esa subida no le llega de vuelta al celular (la conexión se
-- corta justo ahí), el celular la trata como fallida y la reintenta más
-- tarde — subiendo la MISMA foto por segunda vez a Drive y creando una
-- segunda fila en `fotos`. Confirmado con una visita real: una sección con
-- tope de 3 fotos terminó con 5 filas en `fotos`, cada una con su propio
-- `drive_file_id` distinto (5 archivos reales en Drive, no un problema
-- visual).
--
-- `cliente_id`: un UUID que el celular genera UNA sola vez al tomar la foto
-- (ya existía como `FotoLocal.id`, ahora se manda también al servidor) y que
-- se mantiene igual en cualquier reintento de esa misma foto — permite que la
-- Edge Function detecte "esta ya se subió antes" y no repita ni la subida a
-- Drive ni el insert, en vez de confiar en que la respuesta de la primera vez
-- haya llegado bien.
-- ============================================================================

alter table public.fotos add column if not exists cliente_id uuid;

-- Múltiples NULL no chocan entre sí en un índice único de Postgres — las fotos
-- de antes de esta migración (sin cliente_id) no se ven afectadas.
create unique index if not exists idx_fotos_cliente_id_unico on public.fotos(cliente_id);

comment on column public.fotos.cliente_id is
  'UUID generado en el celular al tomar la foto (FotoLocal.id) — se manda en cada subida para que un reintento por mala conexión no cree una fila duplicada si la subida anterior sí había llegado a buen puerto. NULL en fotos subidas antes de esta migración.';
