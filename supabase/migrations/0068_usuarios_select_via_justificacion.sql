-- ============================================================================
-- "Registrado por" salía en blanco en el Reporte consolidado (reportado por el
-- usuario 2026-09-28): Lapo justificó "no se pudo ingresar" en EBAR-001 el
-- 05-sep-2026, pero al generar el reporte José Iván Vega Herrera (operador,
-- no administrador/supervisor) esa fila no mostraba ningún nombre — mientras
-- que una justificación del propio Vega (12-sep) sí mostraba su nombre.
--
-- Causa: Reports.tsx trae la justificación con `usuarios ( nombre_completo )`
-- incrustado. La política de "usuarios_no_visita" ya deja ver la FILA de la
-- justificación de un compañero si la EBAR le toca a uno por asignación por
-- defecto (ver 0066), pero la política de la tabla `usuarios` (para el JOIN
-- incrustado) solo dejaba leer el propio perfil o el de cualquiera si el que
-- consulta es administrador/supervisor/digitador — un operador común nunca
-- podía leer el nombre de OTRO operador, así que el JOIN volvía null aunque
-- la justificación en sí sí fuera visible.
--
-- Arreglo: agregar el mismo criterio de 0066 (creador de una justificación
-- visible para mí) como una razón más para poder leer el nombre de ese
-- usuario — sin abrir el resto de la tabla `usuarios` (cédula, device_id,
-- etc.) a cualquiera.
-- ============================================================================

drop policy if exists "usuarios_select_propio_o_admin" on public.usuarios;

create policy "usuarios_select_propio_o_admin" on public.usuarios
  for select using (
    id = auth.uid()
    or public.current_user_role() in ('administrador', 'supervisor', 'digitador')
    or public.tiene_permiso('marcar_turnos')
    or exists (
      select 1 from public.justificaciones_no_visita j
      where j.creado_por = usuarios.id
        and exists (
          select 1 from public.asignaciones_estacion a
          where a.estacion_id = j.estacion_id
            and a.operador_id = auth.uid()
            and a.fecha is null
        )
    )
  );
