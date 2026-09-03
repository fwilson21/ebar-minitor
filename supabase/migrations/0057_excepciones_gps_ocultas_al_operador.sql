-- ============================================================================
-- Endurece excepciones_gps (migración 0056): el operador ya NO puede leer sus
-- propias filas de la tabla directo. El usuario pidió explícitamente que Lapo
-- (o cualquier operador) no tenga forma de darse cuenta de que se le quitó el
-- bloqueo por GPS en una EBAR. La app nunca mostró esto en pantalla, pero la
-- política de SELECT original sí dejaba consultar la tabla completa (quién la
-- otorgó, desde cuándo, si es indefinida) si alguna vez se inspeccionaban las
-- llamadas a la base de datos — un operador algo técnico podía descubrirlo.
--
-- En su lugar: una función con SECURITY DEFINER que solo devuelve
-- verdadero/falso para el propio usuario que llama (auth.uid() adentro de la
-- función, no un parámetro que se le pueda pasar otro operador) y una
-- estación puntual — sin exponer quién la otorgó, cuándo, ni el alcance.
-- ============================================================================

drop policy if exists "excepciones_gps_select" on public.excepciones_gps;

-- Ahora solo administrador/supervisor pueden leer la tabla (pantalla de gestión
-- en /asignaciones) — el operador ya no tiene ningún permiso de lectura directa.
create policy "excepciones_gps_select" on public.excepciones_gps
  for select using (public.current_user_role() in ('administrador', 'supervisor'));

create or replace function public.excepcion_gps_activa(p_estacion_id uuid, p_fecha date)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.excepciones_gps
    where operador_id = auth.uid()
      and estacion_id = p_estacion_id
      and (fecha_inicio is null or fecha_inicio <= p_fecha)
      and (fecha_fin is null or fecha_fin >= p_fecha)
  );
$$;

grant execute on function public.excepcion_gps_activa(uuid, date) to authenticated;

comment on function public.excepcion_gps_activa is
  'Único punto por el que un operador puede consultar si tiene una excepción de GPS activa — devuelve solo verdadero/falso para sí mismo (auth.uid()), sin exponer quién la otorgó, desde cuándo, ni el alcance. Usado por VisitForm.tsx en vez de leer excepciones_gps directo (ver migración 0056).';
