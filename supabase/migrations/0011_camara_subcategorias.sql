-- ============================================================================
-- EBAR Monitor — "Cámara de llegada al cárcamo de bombeo" con subcategorías
-- ============================================================================
-- La categoría se desglosa en dos subcategorías, cada una con su propio
-- estado/observaciones/fotos:
--   - Rejilla: siempre presente (no tiene selector "Tiene"/"No tiene").
--   - Válvula de compuerta: tiene selector "Sí tiene"/"No tiene" (igual que
--     Descarga de emergencia); el detalle solo aplica si "Sí tiene".
-- La columna `camara_llegada` (antigua, {estado, observaciones}) queda en
-- desuso — ya no se escribe desde la app, se conserva por el historial.
-- ============================================================================

alter table public.visitas
  add column if not exists camara_rejilla jsonb,
  add column if not exists camara_valvula_compuerta jsonb;

comment on column public.visitas.camara_llegada is 'EN DESUSO (ver camara_rejilla / camara_valvula_compuerta). Se conserva solo por el historial de visitas ya registradas.';
comment on column public.visitas.camara_rejilla is 'Estado de la rejilla de la cámara de llegada (siempre presente). Estructura: {estado, observaciones, numeros_afectados}';
comment on column public.visitas.camara_valvula_compuerta is 'Estado de la válvula de compuerta de la cámara de llegada (solo si tiene = true). Estructura: {estado, observaciones, numeros_afectados, tiene}';

-- ----------------------------------------------------------------------------
-- Actualizar RPCs: alertas ya no miran camara_llegada->>'estado' (ahora es
-- {tiene}), sino los 2 campos nuevos; historial expone los 2 campos nuevos.
-- ----------------------------------------------------------------------------
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
      'operador_id', vi.operador_id,
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
      'valvulas_compuerta', vi.valvulas_compuerta,
      'valvulas_check', vi.valvulas_check,
      'valvula_aire', vi.valvula_aire,
      'camara_llegada', vi.camara_llegada,
      'camara_rejilla', vi.camara_rejilla,
      'camara_valvula_compuerta', vi.camara_valvula_compuerta,
      'tablero_distribucion', vi.tablero_distribucion,
      'variador', vi.variador,
      'descarga_emergencia', vi.descarga_emergencia,
      'tuberia_400_valvulas_aire', vi.tuberia_400_valvulas_aire,
      'tuberia_400_uniones_elastomericas', vi.tuberia_400_uniones_elastomericas,
      'tuberia_600_valvulas_aire', vi.tuberia_600_valvulas_aire,
      'tuberia_600_uniones_elastomericas', vi.tuberia_600_uniones_elastomericas,
      'cerramiento_observaciones', vi.cerramiento_observaciones
    ) as v
    from public.visitas vi
    join public.usuarios u on u.id = vi.operador_id
    where vi.estacion_id = p_estacion_id
    order by vi.fecha_hora_llegada desc
    limit p_limite
  ) sub;
$$;
