-- ============================================================================
-- "Editar distribución" vuelve a ser exclusiva del administrador
-- ============================================================================
-- La migración 0037 había hecho delegable por permiso ('editar_distribucion')
-- la acción de mover/redimensionar los bloques de una pantalla y ajustar su
-- ancho en escritorio. A pedido del usuario, vuelve a ser SOLO del
-- administrador real:
--   - se quitan las 2 políticas RLS que la abrían por permiso (0037);
--   - se limpian las filas de ese permiso en permisos_rol.
-- Las políticas originales de solo-administrador (migraciones 0027 y 0031)
-- quedan intactas, así que el administrador sigue pudiendo hacerlo igual.
-- El tamaño de los modales con manija (configuracion_tamano_modal, 0044/0045)
-- ya era solo-administrador, no se toca.
-- ============================================================================

drop policy if exists "layouts_admin_permiso_distribucion" on public.layouts_admin;
drop policy if exists "configuracion_ancho_contenido_permiso_distribucion" on public.configuracion_ancho_contenido;

delete from public.permisos_rol where funcion = 'editar_distribucion';
