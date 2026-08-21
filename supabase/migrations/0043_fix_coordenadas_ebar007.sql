-- Corrige las coordenadas de EBAR-007: en la carga inicial (0040_carga_datos_reales_estaciones.sql)
-- quedó con exactamente las mismas coordenadas que EBAR-006 (-0.474048, -76.985419) — error de
-- copiado en el CSV de origen. El usuario confirmó las coordenadas correctas de EBAR-007.
update public.estaciones_ebar
set latitud = -0.47144992220697024,
    longitud = -76.98020785419298
where codigo = 'EBAR-007';
