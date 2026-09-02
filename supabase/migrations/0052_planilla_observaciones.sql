-- ============================================================================
-- Planilla de horas extras: campo de observaciones
-- ============================================================================
-- Texto libre que se escribe a mano en la ventana "Nueva planilla" (opcional).
-- En el PDF sale debajo de la nota fija "en todos los casos se descuenta 1 hora
-- de almuerzo al medio día".
-- ============================================================================

alter table public.planillas_horas_extras
  add column if not exists observaciones text;

comment on column public.planillas_horas_extras.observaciones is
  'Observaciones libres de la planilla (opcional). En el PDF van debajo de la nota del almuerzo.';
