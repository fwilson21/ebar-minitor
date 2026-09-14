-- ============================================================================
-- Fotos de una visita: exponer `tomada_en` en el detalle (VisitaDetalle.tsx,
-- "Ver") y devolverlas ya ordenadas de la más vieja a la más nueva — pedido
-- del usuario: que se vean de izquierda a derecha desde la más antigua hasta
-- la más actual, tanto editando como viendo una visita.
--
-- `rpc_detalle_visita` armaba cada foto sin `tomada_en` — VisitaDetalle.tsx le
-- ponía a TODAS la hora de llegada de la visita entera (mismo valor para las
-- 14 fotos de una visita, sin poder distinguir el orden real en el que se
-- tomaron). El lado de edición (VisitForm.tsx) consulta la tabla `fotos`
-- directo, no esta función — a ese no le faltaba el dato en la base, solo
-- pedirlo en el `select` del cliente (sin migración, cambio aparte en el
-- código).
-- ============================================================================

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
    'ubicacion_no_confirmada', vi.ubicacion_no_confirmada,
    'ubicacion_distancia_m', vi.ubicacion_distancia_m,
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
        'descripcion', f.descripcion,
        'tomada_en', f.tomada_en
      ) order by f.tomada_en asc), '[]'::json)
      from public.fotos f where f.visita_id = vi.id
    )
  )
  from public.visitas vi
  join public.usuarios u on u.id = vi.operador_id
  where vi.id = p_visita_id;
$$;
