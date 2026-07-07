-- ============================================================================
-- EBAR Monitor — Incluir estado de equipos en el historial de estación
-- ============================================================================

create or replace function public.rpc_historial_estacion(p_estacion_id uuid, p_limite int default 50)
returns json language sql stable security definer as $$
  select coalesce(json_agg(v order by v->>'fecha_hora_llegada' desc), '[]'::json)
  from (
    select json_build_object(
      'id', vi.id,
      'fecha_hora_llegada', vi.fecha_hora_llegada,
      'fecha_hora_salida', vi.fecha_hora_salida,
      'estado_estacion', vi.estado_estacion,
      'nivel_tanque', vi.nivel_tanque,
      'operador', u.nombre_completo,
      'bombas', (
        select coalesce(json_agg(json_build_object(
          'numero_bomba', rb.numero_bomba,
          'estado', rb.estado,
          'voltaje', rb.voltaje,
          'amperaje', rb.amperaje,
          'voltaje_fuera_rango', rb.voltaje_fuera_rango
        )), '[]'::json)
        from public.registros_bombas rb where rb.visita_id = vi.id
      ),
      'fotos_count', (select count(*) from public.fotos f where f.visita_id = vi.id),
      'lineas_impulsion', vi.lineas_impulsion,
      'valvulas', vi.valvulas,
      'camara_llegada', vi.camara_llegada,
      'tablero_distribucion', vi.tablero_distribucion,
      'variador', vi.variador
    ) as v
    from public.visitas vi
    join public.usuarios u on u.id = vi.operador_id
    where vi.estacion_id = p_estacion_id
    order by vi.fecha_hora_llegada desc
    limit p_limite
  ) sub;
$$;
