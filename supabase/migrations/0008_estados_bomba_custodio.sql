-- ============================================================================
-- EBAR Monitor — Nuevos estados de bomba + Custodio / Código SIGAME del bien
-- ============================================================================
-- 1) estado_bomba: se quita 'en_reposo' y se agregan 'en_falla' y
--    'retirado_para_mantenimiento'. Postgres no permite quitar valores de un
--    enum existente, así que se recrea el tipo y se migra la columna
--    (los registros históricos en 'en_reposo' pasan a 'apagada').
-- 2) bombas.custodio / bombas.codigo_sigame: datos del bien físico (persisten
--    entre visitas), no de la visita puntual — por eso viven en `bombas`, no
--    en `registros_bombas`.
-- 3) `bombas` solo permite escritura a administradores (bombas_write_admin),
--    pero cualquier operador debe poder registrar/actualizar el custodio y el
--    código SIGAME al hacer una visita. Se expone una función security definer
--    acotada a esas dos columnas para no abrir el resto de la tabla (marca,
--    modelo, voltajes nominales, etc.) a roles no administrador.
-- ============================================================================

alter type estado_bomba rename to estado_bomba_old;
create type estado_bomba as enum ('encendida', 'apagada', 'en_falla', 'retirado_para_mantenimiento');

alter table public.registros_bombas
  alter column estado type estado_bomba
  using (
    case estado::text
      when 'en_reposo' then 'apagada'
      else estado::text
    end
  )::estado_bomba;

drop type estado_bomba_old;

alter table public.bombas add column if not exists custodio text;
alter table public.bombas add column if not exists codigo_sigame text;

create or replace function public.actualizar_custodio_bomba(
  p_bomba_id uuid,
  p_custodio text,
  p_codigo_sigame text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bombas
  set custodio = p_custodio, codigo_sigame = p_codigo_sigame
  where id = p_bomba_id;
end;
$$;

grant execute on function public.actualizar_custodio_bomba(uuid, text, text) to authenticated;
