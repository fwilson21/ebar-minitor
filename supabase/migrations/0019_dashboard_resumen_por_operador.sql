-- ============================================================================
-- rpc_dashboard_resumen ahora acepta un operador opcional: si se pasa
-- p_operador_id, las 5 métricas se recalculan solo con las visitas de ESE
-- operador y sus EBAR asignadas (por defecto o especial de la fecha) en vez
-- de contar toda la empresa. Sin p_operador_id (admin/supervisor), el
-- comportamiento es exactamente el mismo de siempre (todo el sistema).
-- ============================================================================

create or replace function public.rpc_dashboard_resumen(p_fecha date default current_date, p_operador_id uuid default null)
returns json language sql stable security definer as $$
  with estaciones_asignadas as (
    select estacion_id from public.asignaciones_estacion
    where p_operador_id is not null
      and operador_id = p_operador_id
      and (fecha is null or fecha = p_fecha)
  )
  select json_build_object(
    'fecha', p_fecha,
    'total_visitas', (
      select count(*) from public.visitas
      where fecha_hora_llegada::date = p_fecha
        and (p_operador_id is null or operador_id = p_operador_id)
    ),
    'estaciones_con_problemas', (
      select count(distinct estacion_id) from public.visitas
      where fecha_hora_llegada::date = p_fecha
        and estado_estacion <> 'operativa'
        and (p_operador_id is null or operador_id = p_operador_id)
    ),
    'alertas_voltaje', (
      select count(*) from public.registros_bombas rb
      join public.visitas v on v.id = rb.visita_id
      where v.fecha_hora_llegada::date = p_fecha and rb.voltaje_fuera_rango
        and (p_operador_id is null or v.operador_id = p_operador_id)
    ),
    'estaciones_sin_visitar', (
      select count(*) from public.estaciones_ebar e
      where e.activa
        and (p_operador_id is null or e.id in (select estacion_id from estaciones_asignadas))
        and not exists (
          select 1 from public.visitas v
          where v.estacion_id = e.id and v.fecha_hora_llegada::date = p_fecha
            and (p_operador_id is null or v.operador_id = p_operador_id)
        )
    ),
    'equipos_con_alerta', (
      select count(distinct id) from public.visitas
      where fecha_hora_llegada::date = p_fecha
        and (p_operador_id is null or operador_id = p_operador_id)
        and (
          (lineas_impulsion->>'estado')     in ('en_falla', 'requiere_mantenimiento')
          or (guias_izado->>'estado')       in ('en_falla', 'requiere_mantenimiento')
          or (valvulas_compuerta->>'estado') in ('en_falla', 'requiere_mantenimiento')
          or (valvulas_check->>'estado')     in ('en_falla', 'requiere_mantenimiento')
          or (valvula_aire->>'estado')       in ('en_falla', 'requiere_mantenimiento')
          or (camara_rejilla->>'estado')     in ('en_falla', 'requiere_mantenimiento')
          or (camara_valvula_compuerta->>'estado') in ('en_falla', 'requiere_mantenimiento')
          or (tablero_distribucion->>'estado') in ('en_falla', 'requiere_mantenimiento')
          or (variador->>'estado')           in ('en_falla', 'requiere_mantenimiento')
          or (tuberia_400_valvulas_aire->>'estado')         in ('en_falla', 'requiere_mantenimiento')
          or (tuberia_400_uniones_elastomericas->>'estado') in ('en_falla', 'requiere_mantenimiento')
          or (tuberia_600_valvulas_aire->>'estado')         in ('en_falla', 'requiere_mantenimiento')
          or (tuberia_600_uniones_elastomericas->>'estado') in ('en_falla', 'requiere_mantenimiento')
        )
    )
  );
$$;
