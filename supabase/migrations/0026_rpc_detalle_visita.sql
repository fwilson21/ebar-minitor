-- ----------------------------------------------------------------------------
-- rpc_detalle_visita: detalle completo de UNA visita, para la vista de solo
-- lectura (VisitaDetalle.tsx). Mismo patrón que rpc_historial_estacion
-- (security definer, sin filtro de rol/dueño: cualquier usuario autenticado
-- puede ver el contenido completo de cualquier visita, pero no editarlo desde
-- acá — esta función solo lee). A diferencia de rpc_historial_estacion, acá sí
-- se incluyen observaciones_generales, olores/ruidos, observaciones y horas
-- acumuladas por bomba, y las fotos reales (no solo el conteo).
-- ----------------------------------------------------------------------------
create or replace function public.rpc_detalle_visita(p_visita_id uuid)
returns json language sql stable security definer as $$
  select json_build_object(
    'id', vi.id,
    'estacion_id', vi.estacion_id,
    'operador', u.nombre_completo,
    'operador_id', vi.operador_id,
    'fecha_hora_llegada', vi.fecha_hora_llegada,
    'fecha_hora_salida', vi.fecha_hora_salida,
    'estado_estacion', vi.estado_estacion,
    'nivel_tanque', vi.nivel_tanque,
    'olores_anormales', vi.olores_anormales,
    'olores_descripcion', vi.olores_descripcion,
    'ruidos_extranos', vi.ruidos_extranos,
    'ruidos_descripcion', vi.ruidos_descripcion,
    'observaciones_generales', vi.observaciones_generales,
    'cerramiento_observaciones', vi.cerramiento_observaciones,
    'jardineras_observaciones', vi.jardineras_observaciones,
    'patios_maniobras_observaciones', vi.patios_maniobras_observaciones,
    'lineas_impulsion', vi.lineas_impulsion,
    'guias_izado', vi.guias_izado,
    'valvulas_compuerta', vi.valvulas_compuerta,
    'valvulas_check', vi.valvulas_check,
    'valvula_aire', vi.valvula_aire,
    'camara_rejilla', vi.camara_rejilla,
    'camara_valvula_compuerta', vi.camara_valvula_compuerta,
    'tablero_distribucion', vi.tablero_distribucion,
    'variador', vi.variador,
    'descarga_emergencia', vi.descarga_emergencia,
    'tuberia_400_valvulas_aire', vi.tuberia_400_valvulas_aire,
    'tuberia_400_uniones_elastomericas', vi.tuberia_400_uniones_elastomericas,
    'tuberia_600_valvulas_aire', vi.tuberia_600_valvulas_aire,
    'tuberia_600_uniones_elastomericas', vi.tuberia_600_uniones_elastomericas,
    'bombas', (
      select coalesce(json_agg(json_build_object(
        'numero_bomba', rb.numero_bomba,
        'estado', rb.estado,
        'voltaje', rb.voltaje,
        'amperaje', rb.amperaje,
        'horas_operacion_acumuladas', rb.horas_operacion_acumuladas,
        'observaciones', rb.observaciones,
        'voltaje_fuera_rango', rb.voltaje_fuera_rango
      ) order by rb.numero_bomba), '[]'::json)
      from public.registros_bombas rb where rb.visita_id = vi.id
    ),
    'fotos', (
      select coalesce(json_agg(json_build_object(
        'id', f.id,
        'url_publica', f.url_publica,
        'drive_file_id', f.drive_file_id,
        'descripcion', f.descripcion
      )), '[]'::json)
      from public.fotos f where f.visita_id = vi.id
    )
  )
  from public.visitas vi
  join public.usuarios u on u.id = vi.operador_id
  where vi.id = p_visita_id;
$$;
