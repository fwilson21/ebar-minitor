-- ============================================================================
-- Ubicación de las estaciones: parroquia (solo para las EBAR urbanas)
-- ============================================================================
-- Las 14 estaciones de zona urbana ya tienen (o van a tener) calles en
-- "direccion" — a esas se les agrega también la parroquia, para mostrar
-- "calles, parroquia" junto al nombre. El resto (zona rural) NO recibe
-- parroquia: su propio nombre/código ya es el de la parroquia (ej. "EBAR
-- GARCIA MORENO"), así que agregarla de nuevo sería repetirla — para esas,
-- la pantalla y el PDF muestran solo el nombre de la EBAR, sin nada más.
-- ============================================================================

alter table public.estaciones_ebar add column if not exists parroquia text;

update public.estaciones_ebar set parroquia = 'Puerto Francisco de Orellana'
where codigo in (
  'EBAR-002', 'EBAR-003', 'EBAR-004', 'EBAR-005', 'EBAR-006', 'EBAR-007',
  'EBAR-008', 'EBAR-009', 'EBAR-010',
  'EBAR-MILITARES 001', 'EBAR-MILITARES 002', 'EBAR-MILITARES 003', 'EBAR-MILITARES 004',
  'LC-001'
);
