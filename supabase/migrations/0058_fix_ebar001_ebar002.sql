-- ============================================================================
-- 2 correcciones de datos pedidas por el usuario (2026-09-06):
--
-- 1. La EBAR de "Moretal" quedó cargada con código "EBAR-01" (2 dígitos) y
--    nombre "EBAR 01 - Estación Moretal" — no sigue ni el formato de 3
--    dígitos del resto (EBAR-002, EBAR-003, …) ni la convención nombre =
--    código (ver migración 0041), así que en pantalla salía
--    "EBAR-01 — EBAR 01 - Estación Moretal — Av. Moretal" en vez de solo
--    "EBAR-001 — Av. Moretal". Se pareja el código y el nombre; la
--    dirección ("Av. Moretal") no cambia.
-- 2. EBAR-002: dirección correcta "Av. Moretal y 12 de Febrero".
-- ============================================================================

update public.estaciones_ebar
set codigo = 'EBAR-001',
    nombre = 'EBAR-001'
where codigo = 'EBAR-01';

update public.estaciones_ebar
set direccion = 'Av. Moretal y 12 de Febrero'
where codigo = 'EBAR-002';
