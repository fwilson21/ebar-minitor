-- ============================================================================
-- Respuesta al correo de Supabase "Acción requerida: vulnerabilidades de
-- seguridad detectadas en sus proyectos" (2026-09-08) + revisión completa del
-- Security Advisor (`supabase db advisors --linked --type security`) hecha en
-- esa misma fecha, no solo el ítem del correo.
--
-- 1) EL ÍTEM DEL CORREO (crítico, "rls_disabled_in_public"): la tabla
--    `public.spatial_ref_sys` no tiene RLS. NO es una tabla de la app —
--    la crea automáticamente la extensión PostGIS (`create extension postgis`
--    en 0001_init.sql, dejada como "opcional" para coordenadas GPS como
--    geography; en los hechos, NINGUNA migración llegó a usar columnas
--    geography/geometry — lat/lon quedaron como double precision de siempre).
--    Contiene ~8500 filas de definiciones de sistemas de referencia espacial
--    (EPSG), un catálogo público y estático, igual en cualquier instalación
--    de PostGIS del mundo — no hay ningún dato de EBAR ahí. Se arregla
--    habilitando RLS con lectura abierta (así queda, técnicamente, resuelto
--    el hallazgo) sin restringir nada que la app use de verdad.
--
-- 2) HALLAZGOS ADICIONALES ENCONTRADOS AL REVISAR (no estaban en el correo,
--    que solo avisa del ítem CRÍTICO; estos son "WARN" en el Advisor pero, a
--    diferencia de spatial_ref_sys, SÍ tocan datos reales de la app):
--    varias funciones `security definer` (que corren saltándose RLS) quedaron
--    ejecutables por el rol `anon` (cualquiera, SIN iniciar sesión) porque
--    Postgres le da a PUBLIC permiso de ejecutar toda función nueva por
--    defecto, y ninguna de estas hizo el `revoke` correspondiente (algunas sí
--    tenían `grant ... to authenticated`, pero eso SUMA, no reemplaza, el
--    permiso por defecto de PUBLIC). Confirmado leyendo la definición real en
--    la base (no solo el archivo de la migración, por si hubo cambios directos
--    en el SQL Editor de Supabase sin migración — pasa con get_my_role/
--    is_admin/is_admin_or_supervisor, que no están en ningún archivo de acá):
--      - rpc_dashboard_resumen(date) y (date, uuid): sin auth.uid() adentro —
--        cualquiera sin sesión podía leer el resumen del dashboard.
--      - rpc_detalle_visita(uuid) / rpc_historial_estacion(uuid, int): sin
--        auth.uid() adentro — cualquiera sin sesión podía leer el detalle
--        completo de cualquier visita (nombre del operador, estado de
--        equipos, fotos, observaciones) solo sabiendo o adivinando un id.
--      - actualizar_custodio_bomba(uuid, text, text): sin auth.uid() adentro
--        Y ES DE ESCRITURA — cualquiera sin sesión podía sobreescribir el
--        custodio/código SIGAME de cualquier bomba. La más seria de todas.
--      - excepcion_gps_activa(uuid, date): SÍ filtra por auth.uid() adentro
--        (devuelve falso para anon, sin filtrar por ningún operador real —
--        no hay fuga de datos en la práctica), pero se cierra igual para
--        que quede acorde al resto: solo autenticados.
--    Arreglo: revocar el permiso por defecto de PUBLIC y dejarlo solo para
--    `authenticated` — ningún cambio de comportamiento para quien ya inicia
--    sesión (que es como se usa la app siempre), cierra el acceso anónimo.
--
--    A propósito NO se tocan get_my_role()/is_admin()/is_admin_or_supervisor()/
--    current_user_role()/tiene_permiso(text): todas leen el rol del que
--    llama vía auth.uid() (devuelven null/false para anon, sin filtrar por
--    nadie más — no hay fuga real) y varias políticas RLS de otras tablas las
--    llaman por dentro; revocarles el ejecutar a PUBLIC podría convertir un
--    "false" inofensivo en un error de permiso duro dentro de esas políticas
--    para CUALQUIER usuario, autenticado incluido — más riesgo que beneficio
--    para cerrar un WARN que no expone nada. Tampoco se toca
--    handle_new_auth_user() (función de trigger del alta de usuarios nuevos,
--    Postgres no deja invocarla como RPC de todas formas).
-- ============================================================================

-- 1) spatial_ref_sys (PostGIS) — dato público y estático, no hay nada de EBAR
--    acá. Se intenta habilitar RLS (con lectura abierta) y, si el rol con el
--    que corre esta migración no es dueño de la tabla (la crea la extensión
--    PostGIS, no la app — probado a mano: "must be owner of table
--    spatial_ref_sys"), no revienta la migración por eso: sigue con el
--    REVOKE de abajo, que solo no depende de ser dueño y ya deja la tabla sin
--    ningún acceso desde la API (anon/authenticated) — igual de cerrada en la
--    práctica aunque el linter de Supabase pueda seguir mostrando el aviso.
do $$
begin
  execute 'alter table public.spatial_ref_sys enable row level security';
  execute $policy$
    create policy "spatial_ref_sys_lectura_publica" on public.spatial_ref_sys
      for select using (true)
  $policy$;
exception when insufficient_privilege then
  raise notice 'spatial_ref_sys: no somos dueños de la tabla (la crea PostGIS) — queda asegurada solo con el REVOKE de abajo, sin RLS.';
end $$;

revoke all on public.spatial_ref_sys from anon, authenticated;

-- 2) Cierra el acceso anónimo a las funciones que sí tocan datos reales.
revoke execute on function public.rpc_dashboard_resumen(date) from public;
grant execute on function public.rpc_dashboard_resumen(date) to authenticated;

revoke execute on function public.rpc_dashboard_resumen(date, uuid) from public;
grant execute on function public.rpc_dashboard_resumen(date, uuid) to authenticated;

revoke execute on function public.rpc_detalle_visita(uuid) from public;
grant execute on function public.rpc_detalle_visita(uuid) to authenticated;

revoke execute on function public.rpc_historial_estacion(uuid, integer) from public;
grant execute on function public.rpc_historial_estacion(uuid, integer) to authenticated;

revoke execute on function public.actualizar_custodio_bomba(uuid, text, text) from public;
grant execute on function public.actualizar_custodio_bomba(uuid, text, text) to authenticated;

revoke execute on function public.excepcion_gps_activa(uuid, date) from public;
grant execute on function public.excepcion_gps_activa(uuid, date) to authenticated;
