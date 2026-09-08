-- ============================================================================
-- Destinatario por defecto del encabezado "Para" de los informes (Reportes,
-- Historial de estación, Informe Semanal — ver memoria del proyecto
-- "Encabezado tipo memo GADMFO", migración 0049).
--
-- Antes el nombre/cargo de a quién va dirigido el informe estaba escrito a
-- mano en el código (Reports.tsx, StationDetail.tsx: "Ing. Freddy Vásconez,
-- JEFE DE SERVICIOS DE ALCANTARILLADO"). El usuario pidió (2026-09-08) que:
--   1. el destinatario cambie a Ing. Andrea Estefanía Logacho Morales,
--      ANALISTA DE REDES DE ALCANTARILLADO Y ESTACIONES DE BOMBEO DE AGUAS
--      RESIDUALES;
--   2. ese valor sea configurable (no fijo en el código) y quede como punto
--      de partida para cualquier informe nuevo;
--   3. solo administrador o supervisor puedan cambiarlo.
--
-- Mismo patrón de fila única que `app_config` (candado de versión, migración
-- 0050), pero con la escritura abierta a supervisor además de administrador.
-- ============================================================================

create table public.configuracion_destinatario_informe (
  id smallint primary key default 1 check (id = 1),
  nombre text not null default 'Ing. Andrea Estefanía Logacho Morales',
  cargo text not null default 'ANALISTA DE REDES DE ALCANTARILLADO Y ESTACIONES DE BOMBEO DE AGUAS RESIDUALES',
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references public.usuarios(id)
);

insert into public.configuracion_destinatario_informe (id) values (1);

alter table public.configuracion_destinatario_informe enable row level security;

-- Cualquier autenticado la lee (se usa como valor por defecto al abrir Reportes,
-- Historial de estación e Informe Semanal).
create policy configuracion_destinatario_informe_lectura on public.configuracion_destinatario_informe
  for select using (auth.uid() is not null);

-- Solo administrador o supervisor pueden cambiar el valor por defecto.
create policy configuracion_destinatario_informe_escritura on public.configuracion_destinatario_informe
  for update using (public.current_user_role() in ('administrador', 'supervisor'))
  with check (public.current_user_role() in ('administrador', 'supervisor'));

comment on table public.configuracion_destinatario_informe is
  'Nombre y cargo por defecto de a quién va dirigido el encabezado "Para" de los informes (Reportes, Historial de estación, Informe Semanal). Fila única (id=1). Editable solo por administrador/supervisor; cualquier autenticado la lee.';
