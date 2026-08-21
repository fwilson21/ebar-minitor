-- ============================================================================
-- Generaliza configuracion_panel_dia_turnos (que solo servía para el panel del
-- día de Calendario de turnos) en configuracion_tamano_modal: una fila por
-- modal, identificada por `clave`, para que cualquier modal nuevo con manija
-- de redimensionar (ver src/components/ManijaRedimension.tsx) pueda guardar
-- su propio tamaño sin necesitar una tabla nueva cada vez. Las políticas RLS
-- ya definidas en 0044 se conservan tal cual al renombrar la tabla.
-- ============================================================================

alter table public.configuracion_panel_dia_turnos rename to configuracion_tamano_modal;
alter table public.configuracion_tamano_modal drop constraint configuracion_panel_dia_turnos_singleton;
alter table public.configuracion_tamano_modal alter column clave drop default;

comment on table public.configuracion_tamano_modal is
  'Tamaño (ancho x alto en px) guardado de cada modal con manija de redimensionar, uno por fila (clave). Solo administrador escribe.';

-- Modal de detalle de las 5 métricas del resumen del Dashboard ("Visitas registradas",
-- "Estaciones sin visitar", etc. — ver Dashboard.tsx, ModalListaEstaciones).
insert into public.configuracion_tamano_modal (clave, ancho_px, alto_px)
values ('modal_metrica_dashboard', 420, 560)
on conflict (clave) do nothing;
