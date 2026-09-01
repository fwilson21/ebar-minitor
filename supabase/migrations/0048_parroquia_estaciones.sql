-- ============================================================================
-- Ubicación de las estaciones: parroquia (para cuando no hay calles)
-- ============================================================================
-- Las estaciones rurales cargadas en 0040 no tienen "dirección" (calles) porque
-- se identifican por su parroquia, no por una dirección urbana. Se agrega la
-- columna y se completa con la parroquia que ya está en el propio nombre/código
-- de cada estación rural. Las estaciones urbanas (que sí tienen calles en
-- "direccion") quedan con la parroquia urbana como respaldo, por si algún día
-- se borra la dirección.
--
-- OJO: 'La Belleza', 'San José de Guayusa' y 'PTAR EL COCA' (marcada zona
-- 'rural' pero nombrada como el centro urbano) son los 3 valores menos seguros
-- de esta lista — conviene que alguien del GAD los confirme.
-- ============================================================================

alter table public.estaciones_ebar add column if not exists parroquia text;

update public.estaciones_ebar set parroquia = 'Puerto Francisco de Orellana'
where codigo in (
  'EBAR-002', 'EBAR-003', 'EBAR-004', 'EBAR-005', 'EBAR-006', 'EBAR-007',
  'EBAR-008', 'EBAR-009', 'EBAR-010',
  'EBAR-MILITARES 001', 'EBAR-MILITARES 002', 'EBAR-MILITARES 003', 'EBAR-MILITARES 004',
  'PTAR EL COCA'
);

update public.estaciones_ebar set parroquia = 'El Dorado'
where codigo in ('EBAR DORADO 1', 'EBAR DORADO 2');

update public.estaciones_ebar set parroquia = 'García Moreno'
where codigo in ('EBAR GARCIA MORENO', 'PTAR GARCIA MORENO');

update public.estaciones_ebar set parroquia = 'La Belleza'
where codigo in ('EBAR LA BELLEZA', 'PTAR LA BELLEZA');

update public.estaciones_ebar set parroquia = 'Taracoa'
where codigo in ('EBAR TARACOA', 'PTAR TARACOA');

update public.estaciones_ebar set parroquia = 'Dayuma'
where codigo in ('EBAR DAYUMA');

update public.estaciones_ebar set parroquia = 'Inés Arango'
where codigo in ('EBAR INES ARANGO 1', 'EBAR INES ARANGO 2', 'PTAR INES ARANGO');

update public.estaciones_ebar set parroquia = 'Nuevo Paraíso'
where codigo in ('EBAR NUEVO PARAISO', 'PTAR NUEVO PARAISO');

update public.estaciones_ebar set parroquia = 'San José de Guayusa'
where codigo in ('PTAR GUAYUSA');
