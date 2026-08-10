-- Ancho máximo del contenido principal en escritorio (evita que las pantallas se vean
-- "estiradas" de punta a punta en monitores anchos). Es un valor único global, ajustable por el
-- administrador con un control deslizante en /distribucion-entorno — se aplica a todos los
-- usuarios, solo en escritorio (en celular el ancho siempre es el de la pantalla, no aplica).
--
-- Tabla de una sola fila (constraint fuerza `clave = 'global'`), mismo espíritu que
-- layouts_admin (migración 0027) pero para un valor suelto en vez de un layout de bloques.
create table if not exists configuracion_ancho_contenido (
  clave text primary key default 'global',
  ancho_px integer not null default 1280,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references usuarios(id),
  constraint configuracion_ancho_contenido_singleton check (clave = 'global')
);

alter table configuracion_ancho_contenido enable row level security;

create policy "cualquiera autenticado puede leer configuracion_ancho_contenido"
  on configuracion_ancho_contenido for select
  to authenticated
  using (true);

create policy "solo administrador puede escribir configuracion_ancho_contenido"
  on configuracion_ancho_contenido for all
  to authenticated
  using (public.current_user_role() = 'administrador')
  with check (public.current_user_role() = 'administrador');
