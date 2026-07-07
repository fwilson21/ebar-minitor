-- ============================================================================
-- EBAR Monitor — Estaciones tipo "línea de conducción" + nuevos campos de equipo
-- ============================================================================
-- 1. Nuevo campo de equipo "Descarga de emergencia" para estaciones EBAR
--    (misma estructura {estado, observaciones} que los otros 5 ya existentes).
-- 2. Nuevo tipo de estación "linea_conduccion" (sin bombas), con su propio
--    subconjunto de campos: tubería de impulsión de 400mm y 600mm, cada una
--    con "Válvulas de aire" y "Uniones elastoméricas".
-- 3. Se crea la estación "Líneas de conducción sobre el puente".
-- ============================================================================

create type tipo_estacion as enum ('ebar', 'linea_conduccion');

alter table public.estaciones_ebar
  add column if not exists tipo tipo_estacion not null default 'ebar';

-- Las estaciones tipo línea de conducción no tienen bombas.
alter table public.estaciones_ebar drop constraint if exists estaciones_ebar_numero_bombas_check;
alter table public.estaciones_ebar add constraint estaciones_ebar_numero_bombas_check check (numero_bombas between 0 and 4);

alter table public.visitas
  add column if not exists descarga_emergencia               jsonb,
  add column if not exists tuberia_400_valvulas_aire          jsonb,
  add column if not exists tuberia_400_uniones_elastomericas  jsonb,
  add column if not exists tuberia_600_valvulas_aire          jsonb,
  add column if not exists tuberia_600_uniones_elastomericas  jsonb;

comment on column public.visitas.descarga_emergencia is 'Estado de la descarga de emergencia (estaciones EBAR). Estructura: {estado, observaciones}';
comment on column public.visitas.tuberia_400_valvulas_aire is 'Válvulas de aire — tubería de impulsión 400mm (línea de conducción). Estructura: {estado, observaciones}';
comment on column public.visitas.tuberia_400_uniones_elastomericas is 'Uniones elastoméricas — tubería de impulsión 400mm (línea de conducción). Estructura: {estado, observaciones}';
comment on column public.visitas.tuberia_600_valvulas_aire is 'Válvulas de aire — tubería de impulsión 600mm (línea de conducción). Estructura: {estado, observaciones}';
comment on column public.visitas.tuberia_600_uniones_elastomericas is 'Uniones elastoméricas — tubería de impulsión 600mm (línea de conducción). Estructura: {estado, observaciones}';

insert into public.estaciones_ebar (codigo, nombre, zona, tipo, numero_bombas, estado_actual, activa)
values ('LC-001', 'Líneas de conducción sobre el puente', 'urbana', 'linea_conduccion', 0, 'operativa', true)
on conflict (codigo) do nothing;

-- ----------------------------------------------------------------------------
-- Actualizar RPCs para incluir los nuevos campos
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
          or (valvulas->>'estado')           in ('en_falla', 'requiere_mantenimiento')
          or (camara_llegada->>'estado')     in ('en_falla', 'requiere_mantenimiento')
          or (tablero_distribucion->>'estado') in ('en_falla', 'requiere_mantenimiento')
          or (variador->>'estado')           in ('en_falla', 'requiere_mantenimiento')
          or (descarga_emergencia->>'estado') in ('en_falla', 'requiere_mantenimiento')
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
      'variador', vi.variador,
      'descarga_emergencia', vi.descarga_emergencia,
      'tuberia_400_valvulas_aire', vi.tuberia_400_valvulas_aire,
      'tuberia_400_uniones_elastomericas', vi.tuberia_400_uniones_elastomericas,
      'tuberia_600_valvulas_aire', vi.tuberia_600_valvulas_aire,
      'tuberia_600_uniones_elastomericas', vi.tuberia_600_uniones_elastomericas
    ) as v
    from public.visitas vi
    join public.usuarios u on u.id = vi.operador_id
    where vi.estacion_id = p_estacion_id
    order by vi.fecha_hora_llegada desc
    limit p_limite
  ) sub;
$$;
