-- Reemplaza el permiso único 'gestionar_usuarios' (migración 0028) por 5 permisos separados, uno
-- por acción, a pedido del usuario tras ver la pantalla /permisos: Crear, Editar (nombre, nombre
-- de usuario, cédula, cargo, celular vinculado), Activar/Desactivar, Restablecer contraseña,
-- Eliminar. Cambiar el rol de alguien sigue siendo exclusivo del administrador real en todos los
-- casos — no existe (ni existirá) un permiso para eso, a propósito.
--
-- La tabla permisos_rol no cambia de estructura (rol/función/habilitado ya son genéricos) — esta
-- migración solo reemplaza las políticas de la tabla `usuarios` para consultar las claves nuevas.
-- Si algún rol ya tenía activado 'gestionar_usuarios', esa fila queda huérfana (sin ningún
-- efecto) — no hace falta borrarla a mano, no molesta si queda ahí.

drop policy if exists "usuarios_insert_admin" on public.usuarios;
create policy "usuarios_insert_admin" on public.usuarios
  for insert with check (public.tiene_permiso('crear_usuarios'));

drop policy if exists "usuarios_update_propio_o_admin" on public.usuarios;
create policy "usuarios_update_propio_o_admin" on public.usuarios
  for update
  using (
    id = auth.uid()
    or public.tiene_permiso('editar_usuarios')
    or public.tiene_permiso('activar_desactivar_usuarios')
  )
  with check (
    public.current_user_role() = 'administrador'
    or (
      -- Editando a otra persona: el rol nunca puede cambiar por esta vía (exclusivo del admin
      -- real). Cada grupo de columnas exige su propio permiso SOLO si de verdad cambió algo de
      -- ese grupo — así alguien con un solo permiso (ej. activar_desactivar_usuarios) puede
      -- tocar `activo` sin que la fila se rechace por no tener también editar_usuarios.
      rol = (select u2.rol from public.usuarios u2 where u2.id = usuarios.id)
      and (
        activo = (select u2.activo from public.usuarios u2 where u2.id = usuarios.id)
        or public.tiene_permiso('activar_desactivar_usuarios')
      )
      and (
        (
          nombre_completo is not distinct from (select u2.nombre_completo from public.usuarios u2 where u2.id = usuarios.id)
          and nombre_usuario is not distinct from (select u2.nombre_usuario from public.usuarios u2 where u2.id = usuarios.id)
          and cedula is not distinct from (select u2.cedula from public.usuarios u2 where u2.id = usuarios.id)
          and cargo is not distinct from (select u2.cargo from public.usuarios u2 where u2.id = usuarios.id)
          and device_id is not distinct from (select u2.device_id from public.usuarios u2 where u2.id = usuarios.id)
        )
        or public.tiene_permiso('editar_usuarios')
      )
    )
    or (
      -- Editando la propia fila (ej. futura pantalla "editar mi perfil"): rol y activo deben
      -- quedar iguales, sin necesitar ningún permiso — igual que antes de esta migración.
      id = auth.uid()
      and rol = (select u2.rol from public.usuarios u2 where u2.id = auth.uid())
      and activo = (select u2.activo from public.usuarios u2 where u2.id = auth.uid())
    )
  );
