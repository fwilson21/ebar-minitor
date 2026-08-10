-- Permisos personalizables por rol: permite al administrador activar o desactivar funciones
-- puntuales del sistema para "operador" y "supervisor" desde una pantalla con checkboxes
-- (ver /permisos), sin tener que cambiarle el rol a nadie.
--
-- El administrador SIEMPRE tiene acceso completo — no se guarda fila para 'administrador' en
-- esta tabla (ver constraint de abajo), es una regla fija en tiene_permiso(). Así nunca se puede
-- quedar sin acceso a su propia pantalla de permisos por un check mal puesto.
--
-- Primera función controlada: 'gestionar_usuarios' (crear/editar/desactivar/eliminar usuarios,
-- restablecer contraseña, cambiar nombre de usuario). NO incluye cambiar el rol de alguien ni
-- crear un usuario nuevo con rol distinto de operador — eso queda siempre exclusivo del
-- administrador real, para que nadie pueda auto-ascenderse a administrador aunque tenga este
-- permiso activado (ver política de UPDATE más abajo y los Edge Functions de usuarios).
create table if not exists permisos_rol (
  rol user_role not null,
  funcion text not null,
  habilitado boolean not null default false,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references usuarios(id),
  primary key (rol, funcion),
  constraint permisos_rol_no_administrador check (rol <> 'administrador')
);

alter table permisos_rol enable row level security;

create policy "cualquiera autenticado puede leer permisos_rol"
  on permisos_rol for select
  to authenticated
  using (true);

create policy "solo administrador puede escribir permisos_rol"
  on permisos_rol for all
  to authenticated
  using (public.current_user_role() = 'administrador')
  with check (public.current_user_role() = 'administrador');

-- Helper para RLS y Edge Functions: ¿el usuario autenticado actual tiene esta función
-- habilitada? El administrador siempre da true, sin ni siquiera consultar la tabla.
create or replace function public.tiene_permiso(p_funcion text)
returns boolean language sql stable security definer as $$
  select public.current_user_role() = 'administrador'
    or coalesce(
      (select habilitado from public.permisos_rol
       where rol = public.current_user_role() and funcion = p_funcion),
      false
    );
$$;

-- usuarios: crear/editar pasa a depender del permiso 'gestionar_usuarios' (antes, solo admin).
-- Cambiar el campo `rol` de alguien se mantiene exclusivo del administrador real (ver 0014):
-- quien solo tiene el permiso puede editar cualquier otro campo de cualquier usuario, pero el
-- `rol` resultante debe quedar igual al que ya tenía.
drop policy if exists "usuarios_insert_admin" on public.usuarios;
create policy "usuarios_insert_admin" on public.usuarios
  for insert with check (public.tiene_permiso('gestionar_usuarios'));

drop policy if exists "usuarios_update_propio_o_admin" on public.usuarios;
create policy "usuarios_update_propio_o_admin" on public.usuarios
  for update
  using (id = auth.uid() or public.tiene_permiso('gestionar_usuarios'))
  with check (
    public.current_user_role() = 'administrador'
    or (
      public.tiene_permiso('gestionar_usuarios')
      and rol = (select u2.rol from public.usuarios u2 where u2.id = usuarios.id)
    )
    or (
      id = auth.uid()
      and rol = (select u2.rol from public.usuarios u2 where u2.id = auth.uid())
      and activo = (select u2.activo from public.usuarios u2 where u2.id = auth.uid())
    )
  );
