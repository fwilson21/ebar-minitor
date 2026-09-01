-- ============================================================================
-- Ubicación de las estaciones: parroquia (solo para las EBAR urbanas)
-- ============================================================================
-- Las 14 estaciones de zona urbana llevan parroquia "El Coca". 13 de ellas ya
-- tienen calles en "direccion" y muestran "calles, El Coca"; LC-001 no tiene
-- calles cargadas y no las necesita — para esa alcanza con la parroquia sola.
-- El resto (zona rural) NO recibe parroquia: su propio nombre/código ya es el
-- de la parroquia (ej. "EBAR GARCIA MORENO"), así que agregarla de nuevo
-- sería repetirla — para esas, la pantalla y el PDF muestran solo el nombre
-- de la EBAR, sin nada más.
-- ============================================================================

alter table public.estaciones_ebar add column if not exists parroquia text;

update public.estaciones_ebar set parroquia = 'El Coca'
where codigo in (
  'EBAR-002', 'EBAR-003', 'EBAR-004', 'EBAR-005', 'EBAR-006', 'EBAR-007',
  'EBAR-008', 'EBAR-009', 'EBAR-010',
  'EBAR-MILITARES 001', 'EBAR-MILITARES 002', 'EBAR-MILITARES 003', 'EBAR-MILITARES 004',
  'LC-001'
);
