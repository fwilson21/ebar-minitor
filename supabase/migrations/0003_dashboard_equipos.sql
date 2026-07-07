-- ============================================================================
-- EBAR Monitor — Agregar métrica de equipos con alerta al resumen del dashboard
-- ============================================================================

create or replace function public.rpc_dashboard_resumen(p_fecha date default current_date)
returns json language sql stable security definer as $$
  select json_build_object(
    'fecha', p_fecha,
    'total_visitas', (
      select count(*) from public.visitas
      where fecha_hora_llegada::date = p_fecha
    ),
    'estaciones_con_problemas', (
      select count(distinct estacion_id) from public.visitas
      where fecha_hora_llegada::date = p_fecha
        and estado_estacion <> 'operativa'
    ),
    'alertas_voltaje', (
      select count(*) from public.registros_bombas rb
      join public.visitas v on v.id = rb.visita_id
      where v.fecha_hora_llegada::date = p_fecha and rb.voltaje_fuera_rango
    ),
    'estaciones_sin_visitar', (
      select count(*) from public.estaciones_ebar e
      where e.activa and not exists (
        select 1 from public.visitas v
        where v.estacion_id = e.id and v.fecha_hora_llegada::date = p_fecha
      )
    ),
    'equipos_con_alerta', (
      select count(distinct id) from public.visitas
      where fecha_hora_llegada::date = p_fecha
        and (
          (lineas_impulsion->>'estado')     in ('en_falla', 'requiere_mantenimiento')
          or (valvulas->>'estado')           in ('en_falla', 'requiere_mantenimiento')
          or (camara_llegada->>'estado')     in ('en_falla', 'requiere_mantenimiento')
          or (tablero_distribucion->>'estado') in ('en_falla', 'requiere_mantenimiento')
          or (variador->>'estado')           in ('en_falla', 'requiere_mantenimiento')
        )
    )
  );
$$;
