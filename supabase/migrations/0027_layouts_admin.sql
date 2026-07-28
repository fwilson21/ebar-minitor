-- Distribución de entorno de trabajo: permite al administrador reacomodar (mover/redimensionar)
-- los bloques de una pantalla o modal en escritorio. Lo que guarda aplica para todos los usuarios.
create table if not exists layouts_admin (
  pantalla text primary key,
  layout jsonb not null,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references usuarios(id)
);

alter table layouts_admin enable row level security;

create policy "cualquiera autenticado puede leer layouts"
  on layouts_admin for select
  to authenticated
  using (true);

create policy "solo administrador puede escribir layouts"
  on layouts_admin for all
  to authenticated
  using (
    exists (select 1 from usuarios where usuarios.id = auth.uid() and usuarios.rol = 'administrador')
  )
  with check (
    exists (select 1 from usuarios where usuarios.id = auth.uid() and usuarios.rol = 'administrador')
  );
