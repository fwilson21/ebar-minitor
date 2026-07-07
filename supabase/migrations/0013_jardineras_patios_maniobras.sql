-- ============================================================================
-- EBAR Monitor — "Jardineras" y "Patios de maniobras" bajo Estado general
-- ============================================================================
-- Dos subcategorías nuevas dentro de "Estado general de la estación", debajo
-- de "Cerramiento y seguridad". Siguen el mismo patrón sin selector de Estado
-- (solo Observaciones + Fotos): se guarda un campo de texto plano, igual que
-- `cerramiento_observaciones`. Las fotos van a la tabla `fotos` con
-- `descripcion = 'jardineras' | 'patios_maniobras'`, no a esta columna.
-- ============================================================================

alter table public.visitas
  add column if not exists jardineras_observaciones text,
  add column if not exists patios_maniobras_observaciones text;

comment on column public.visitas.jardineras_observaciones is 'Observaciones de la subcategoría Jardineras (sin estado, solo texto + fotos en tabla fotos)';
comment on column public.visitas.patios_maniobras_observaciones is 'Observaciones de la subcategoría Patios de maniobras (sin estado, solo texto + fotos en tabla fotos)';

-- ----------------------------------------------------------------------------
-- Actualizar rpc_historial_estacion para exponer los 2 campos nuevos
-- ----------------------------------------------------------------------------
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
      'guias_izado', vi.guias_izado,
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
      'cerramiento_observaciones', vi.cerramiento_observaciones,
      'jardineras_observaciones', vi.jardineras_observaciones,
      'patios_maniobras_observaciones', vi.patios_maniobras_observaciones
    ) as v
    from public.visitas vi
    join public.usuarios u on u.id = vi.operador_id
    where vi.estacion_id = p_estacion_id
    order by vi.fecha_hora_llegada desc
    limit p_limite
  ) sub;
$$;
