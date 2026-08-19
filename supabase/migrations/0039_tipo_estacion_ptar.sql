-- ============================================================================
-- EBAR Monitor — Nuevo tipo de estación "ptar" (planta de tratamiento)
-- ============================================================================
-- Agrega 'ptar' al enum tipo_estacion para poder cargar las plantas de
-- tratamiento (PTAR) como estaciones propias, distintas de las EBAR.
--
-- Por ahora las estaciones tipo 'ptar' usan el MISMO formulario de visita
-- completo que las 'ebar' (con bombas y todo el resto de secciones de
-- equipo) porque el código de VisitForm.tsx / StationDetail.tsx solo trata
-- distinto al tipo 'linea_conduccion'; cualquier otro tipo (incluido 'ptar')
-- cae en el formulario completo por defecto. Si en el futuro se necesita un
-- formulario propio para plantas de tratamiento (aireación, clarificadores,
-- cloración, etc.), eso es un desarrollo aparte.
-- ============================================================================

alter type tipo_estacion add value if not exists 'ptar';
