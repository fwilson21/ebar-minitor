-- ============================================================================
-- Nombre de estación = código (para las 29 estaciones cargadas en 0040)
-- ============================================================================
-- El usuario pidió que el "nombre" que se muestra en pantalla sea igual al
-- "código" completo (ej: nombre "EBAR GM" -> "EBAR GARCIA MORENO"), en vez
-- de la versión abreviada que traía bombas_plantilla.csv/estaciones_plantilla.csv.
-- No toca otras estaciones (como 'LC-001', que sí tiene un nombre propio
-- distinto de su código).
-- ============================================================================

update public.estaciones_ebar
set nombre = codigo
where codigo in (
  'EBAR-002', 'EBAR-003', 'EBAR-004', 'EBAR-005', 'EBAR-006', 'EBAR-007',
  'EBAR-008', 'EBAR-009', 'EBAR-010',
  'EBAR-MILITARES 001', 'EBAR-MILITARES 002', 'EBAR-MILITARES 003', 'EBAR-MILITARES 004',
  'EBAR DORADO 1', 'EBAR DORADO 2', 'EBAR GARCIA MORENO', 'EBAR LA BELLEZA',
  'EBAR TARACOA', 'EBAR DAYUMA', 'EBAR INES ARANGO 1', 'EBAR INES ARANGO 2',
  'EBAR NUEVO PARAISO',
  'PTAR NUEVO PARAISO', 'PTAR GUAYUSA', 'PTAR EL COCA', 'PTAR GARCIA MORENO',
  'PTAR LA BELLEZA', 'PTAR TARACOA', 'PTAR INES ARANGO'
);
