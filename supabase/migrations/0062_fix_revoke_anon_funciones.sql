-- ============================================================================
-- Corrige la migración 0061: el REVOKE ahí apuntaba a "public" (el pseudo-rol
-- que agrupa TODOS los roles), pero Supabase le da a `anon`/`authenticated`
-- permiso de ejecutar cada función nueva de forma DIRECTA (no a través de
-- public) apenas se crea — comprobado a mano contra la base real con
-- `has_function_privilege`: después de correr 0061, `anon` seguía pudiendo
-- ejecutar las 6 funciones tal cual antes (0 efecto). "revoke ... from
-- public" no toca un permiso que nunca pasó por public.
--
-- Este SÍ se probó de la forma correcta antes de escribirlo: dentro de una
-- transacción de prueba (BEGIN; ...; ROLLBACK, sin aplicar nada todavía) se
-- corrió el REVOKE y se volvió a consultar `has_function_privilege` DENTRO de
-- esa misma transacción — recién ahí dio `false` para anon. La vez anterior
-- solo se había confirmado que el comando no tiraba error, no que de verdad
-- cambiara algo — error del que corrigió esta migración.
-- ============================================================================

revoke execute on function public.rpc_dashboard_resumen(date) from anon;
revoke execute on function public.rpc_dashboard_resumen(date, uuid) from anon;
revoke execute on function public.rpc_detalle_visita(uuid) from anon;
revoke execute on function public.rpc_historial_estacion(uuid, integer) from anon;
revoke execute on function public.actualizar_custodio_bomba(uuid, text, text) from anon;
revoke execute on function public.excepcion_gps_activa(uuid, date) from anon;

-- Nota sobre spatial_ref_sys (el ítem del correo de Supabase): SIGUE sin
-- poderse arreglar desde acá. Confirmado a mano: la tabla es dueña de
-- `supabase_admin` (un rol interno de Supabase, no `postgres`, que es con el
-- que corren las migraciones) — ni el ALTER TABLE...ENABLE RLS ni el REVOKE
-- de 0061 tuvieron efecto real por eso (dan "must be owner" o simplemente no
-- cambian nada), y la extensión PostGIS tampoco admite moverse de esquema
-- (`ALTER EXTENSION postgis SET SCHEMA` da error "does not support SET
-- SCHEMA"). Es una limitación de la plataforma, no algo que una migración
-- pueda resolver — para cerrarlo del todo haría falta pedirle a soporte de
-- Supabase que lo haga con su propio rol. Riesgo real: prácticamente nulo (ver
-- comentario completo en 0061 — dato público y estático, sin nada de EBAR).
