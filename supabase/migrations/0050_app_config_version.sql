-- ============================================================================
-- Candado de versión de la app (PWA)
-- ============================================================================
-- La app es una PWA: se actualiza sola a través del service worker, pero un
-- celular/tablet que no la abre en días, o que quedó con la caché del navegador
-- atascada (ver memoria del proyecto "PWA con caché atascada"), puede seguir
-- corriendo una versión vieja sin que el operador lo note — y registrar visitas
-- con reglas/campos de una versión anterior.
--
-- Esta tabla deja que el administrador fije un "piso" de versión: todo cliente
-- cuyo build sea anterior a `build_minimo` queda bloqueado con una pantalla de
-- "Hay una versión nueva de la app / Actualizar ahora" hasta que baje la nueva.
--
--   build_minimo  timestamp (Date.now(), en milisegundos) del build MÍNIMO
--                 aceptado. Cada build de la app lleva su propio timestamp
--                 incrustado (__BUILD_TIME__ en vite.config.ts). 0 = sin piso,
--                 nadie bloqueado — es el valor inicial.
--
-- Fila única (id = 1). La lectura queda abierta a todos, incluido el rol `anon`,
-- para que el candado también aplique en la pantalla de login (un cliente muy
-- atascado a veces ni siquiera llega a entrar). Solo el administrador puede
-- cambiar el valor, desde el pie de página de la app.
-- ============================================================================

create table public.app_config (
  id smallint primary key default 1 check (id = 1),
  build_minimo bigint not null default 0,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references public.usuarios(id)
);

insert into public.app_config (id) values (1);

alter table public.app_config enable row level security;

-- Lectura para cualquiera (anon incluido): el dato no es sensible (un número) y
-- se necesita antes del login.
create policy app_config_lectura on public.app_config
  for select using (true);

-- Solo el administrador real fija la versión mínima.
create policy app_config_admin on public.app_config
  for update using (public.current_user_role() = 'administrador')
  with check (public.current_user_role() = 'administrador');

comment on table public.app_config is
  'Configuración global de la app. build_minimo: timestamp (ms) del build mínimo aceptado; los clientes con un build anterior quedan bloqueados con "Actualiza la app".';
