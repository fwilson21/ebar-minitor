-- Permite al administrador "entrar como" un supervisor u operador real (nunca otro
-- administrador) para probar exactamente lo que esa persona puede hacer, con sus límites reales
-- de verdad — no una simulación de pantalla. Ver Edge Function impersonate-user: genera una
-- sesión real de Supabase Auth para el usuario elegido con auth.admin.generateLink (no hace
-- falta su contraseña). El frontend guarda la sesión del administrador antes de cambiar, para
-- poder volver con el botón "Volver a ser administrador" (ver src/lib/impersonar.ts).
--
-- Esta tabla es solo un registro de auditoría (quién entró como quién y cuándo) — no controla
-- nada por sí sola. Solo se escribe desde la Edge Function con la service role key (que no pasa
-- por RLS), por eso no hace falta política de INSERT para usuarios autenticados.
create table if not exists impersonaciones_log (
  id uuid primary key default uuid_generate_v4(),
  admin_id uuid not null references usuarios(id),
  usuario_id uuid not null references usuarios(id),
  iniciado_en timestamptz not null default now()
);

alter table impersonaciones_log enable row level security;

create policy "solo administrador puede leer impersonaciones_log"
  on impersonaciones_log for select
  to authenticated
  using (public.current_user_role() = 'administrador');
