-- ============================================================================
-- EBAR Monitor — Fix de seguridad: impedir que un usuario se auto-asigne
-- rol de administrador o se reactive a sí mismo.
-- ============================================================================
-- La política "usuarios_update_propio_o_admin" original permitía a cualquier
-- usuario autenticado actualizar CUALQUIER columna de su propia fila en
-- `usuarios` (con tal de que id = auth.uid()), incluyendo `rol` y `activo`.
-- Esto significa que un operador podía, con una llamada directa a la API
-- (sin pasar por ninguna pantalla), hacer:
--   supabase.from('usuarios').update({ rol: 'administrador' }).eq('id', suPropioId)
-- y quedar con acceso total. La pantalla pública "Crear primer administrador"
-- (removida del código junto con esta migración) explotaba exactamente este
-- hueco de forma intencional para el setup inicial, pero la regla de fondo
-- seguía abierta para cualquier usuario ya registrado.
--
-- Esta migración reemplaza la política: un usuario puede seguir editando su
-- propia fila (para cuando exista una pantalla de "editar mi perfil"), pero
-- el valor de `rol` y `activo` en la fila resultante debe ser igual al que
-- ya tenía — solo un administrador puede cambiar esas dos columnas.
-- ============================================================================

drop policy if exists "usuarios_update_propio_o_admin" on public.usuarios;

create policy "usuarios_update_propio_o_admin" on public.usuarios
  for update
  using (id = auth.uid() or public.current_user_role() = 'administrador')
  with check (
    public.current_user_role() = 'administrador'
    or (
      id = auth.uid()
      and rol = (select u2.rol from public.usuarios u2 where u2.id = auth.uid())
      and activo = (select u2.activo from public.usuarios u2 where u2.id = auth.uid())
    )
  );
