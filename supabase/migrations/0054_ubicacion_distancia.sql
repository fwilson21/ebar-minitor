-- ============================================================================
-- Visitas: distancia a la que el GPS ubicó al operador
-- ============================================================================
-- Complemento de `ubicacion_no_confirmada` (0051). Cuando el operador tiene que
-- confirmar a mano su presencia porque el GPS no lo pudo verificar, ahora se
-- guarda TAMBIÉN a qué distancia de la EBAR lo ubicó el GPS en ese momento:
--   - un número (metros) si el GPS dio alguna posición (aunque fuera mala);
--   - null si el GPS no dio ninguna posición (apagado, permiso denegado, timeout).
--
-- Sirve para que el supervisor distinga de un vistazo un fix malo dentro de la
-- cámara (~300 m) de una visita registrada desde lejos (varios km).
--
-- Ya no hay bloqueo duro por GPS: cualquier problema de ubicación deja pasar al
-- operador con confirmación manual, y la visita queda marcada + con esta
-- distancia para revisión.
-- ============================================================================

alter table public.visitas
  add column if not exists ubicacion_distancia_m integer;

comment on column public.visitas.ubicacion_distancia_m is
  'Distancia en metros a la que el GPS ubicó al operador respecto de la EBAR, al confirmar manualmente su presencia (ubicacion_no_confirmada = true). null = el GPS no dio ninguna posición.';

-- ----------------------------------------------------------------------------
-- Exponerla en el historial de la estación (StationDetail.tsx)
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
      'ubicacion_no_confirmada', vi.ubicacion_no_confirmada,
      'ubicacion_distancia_m', vi.ubicacion_distancia_m,
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

-- ----------------------------------------------------------------------------
-- Exponerla en el detalle de una visita (VisitaDetalle.tsx)
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
        'descripcion', f.descripcion
      )), '[]'::json)
      from public.fotos f where f.visita_id = vi.id
    )
  )
  from public.visitas vi
  join public.usuarios u on u.id = vi.operador_id
  where vi.id = p_visita_id;
$$;
