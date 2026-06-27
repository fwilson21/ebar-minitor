-- ============================================================================
-- EBAR Monitor — Esquema de base de datos (Supabase / PostgreSQL)
-- Gestión y monitoreo de Estaciones de Bombeo de Aguas Residuales
-- ============================================================================

-- ----------------------------------------------------------------------------
-- EXTENSIONES
-- ----------------------------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists "postgis"; -- coordenadas GPS como geography (opcional, ver nota abajo)

-- ----------------------------------------------------------------------------
-- TIPOS ENUMERADOS
-- ----------------------------------------------------------------------------
create type user_role as enum ('operador', 'administrador', 'supervisor');
create type zona_tipo as enum ('urbana', 'rural');
create type estado_estacion as enum ('operativa', 'mantenimiento_correctivo', 'fuera_de_servicio');
create type estado_bomba as enum ('encendida', 'apagada', 'en_reposo');
create type nivel_tanque as enum ('alto', 'medio', 'bajo');
create type tipo_reporte as enum ('diario_operador', 'consolidado_fecha', 'individual_estacion');
create type canal_envio as enum ('whatsapp_grupo', 'whatsapp_individual');
create type estado_envio as enum ('pendiente', 'enviado', 'fallido');

-- ----------------------------------------------------------------------------
-- TABLA: usuarios (perfil extendido sobre auth.users)
-- ----------------------------------------------------------------------------
create table public.usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre_completo text not null,
  telefono text,
  rol user_role not null default 'operador',
  whatsapp_numero text,            -- número usado para recibir reportes individuales
  activo boolean not null default true,
  firma_url text,                  -- URL de imagen de firma (Storage) para PDFs
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.usuarios is 'Perfil extendido de cada usuario autenticado (operador, administrador, supervisor)';

-- ----------------------------------------------------------------------------
-- TABLA: estaciones_ebar
-- ----------------------------------------------------------------------------
create table public.estaciones_ebar (
  id uuid primary key default uuid_generate_v4(),
  codigo text unique not null,            -- ej: EBAR-001
  nombre text not null,
  zona zona_tipo not null default 'urbana',
  direccion text,
  latitud double precision,
  longitud double precision,
  descripcion text,
  foto_url text,                          -- foto principal de la estación
  numero_bombas smallint not null default 2 check (numero_bombas between 1 and 4),
  estado_actual estado_estacion not null default 'operativa',
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_estaciones_zona on public.estaciones_ebar(zona);
create index idx_estaciones_estado on public.estaciones_ebar(estado_actual);

-- ----------------------------------------------------------------------------
-- TABLA: bombas (catálogo físico de bombas por estación, 1 a 4 por EBAR)
-- ----------------------------------------------------------------------------
create table public.bombas (
  id uuid primary key default uuid_generate_v4(),
  estacion_id uuid not null references public.estaciones_ebar(id) on delete cascade,
  numero_bomba smallint not null check (numero_bomba between 1 and 4),
  marca text,
  modelo text,
  potencia_hp numeric(6,2),
  voltaje_nominal numeric(6,2),
  amperaje_nominal numeric(6,2),
  fecha_instalacion date,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  unique (estacion_id, numero_bomba)
);

-- ----------------------------------------------------------------------------
-- TABLA: visitas (registro de cada visita técnica)
-- ----------------------------------------------------------------------------
create table public.visitas (
  id uuid primary key default uuid_generate_v4(),
  estacion_id uuid not null references public.estaciones_ebar(id) on delete restrict,
  operador_id uuid not null references public.usuarios(id) on delete restrict,
  fecha_hora_llegada timestamptz not null,
  fecha_hora_salida timestamptz,
  estado_estacion estado_estacion not null,
  nivel_tanque nivel_tanque not null,
  olores_anormales boolean not null default false,
  olores_descripcion text,
  ruidos_extranos boolean not null default false,
  ruidos_descripcion text,
  cerramiento_ok boolean not null default true,
  cerramiento_observaciones text,
  observaciones_generales text,
  -- soporte offline: identificador generado en cliente para evitar duplicados al sincronizar
  cliente_uuid uuid unique,
  sincronizada boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_visitas_estacion on public.visitas(estacion_id);
create index idx_visitas_operador on public.visitas(operador_id);
create index idx_visitas_fecha on public.visitas(fecha_hora_llegada);

-- ----------------------------------------------------------------------------
-- TABLA: registros_bombas (datos capturados por bomba en cada visita)
-- ----------------------------------------------------------------------------
create table public.registros_bombas (
  id uuid primary key default uuid_generate_v4(),
  visita_id uuid not null references public.visitas(id) on delete cascade,
  bomba_id uuid not null references public.bombas(id) on delete restrict,
  numero_bomba smallint not null check (numero_bomba between 1 and 4),
  estado estado_bomba not null,
  voltaje numeric(6,2),
  amperaje numeric(6,2),
  horas_operacion_acumuladas numeric(10,2),
  observaciones text,
  voltaje_fuera_rango boolean generated always as (
    voltaje is not null and (voltaje < 200 or voltaje > 240)
  ) stored, -- umbral referencial 200-240V; ajustar según el rango operativo real de cada planta
  created_at timestamptz not null default now(),
  unique (visita_id, bomba_id)
);

create index idx_registros_bombas_visita on public.registros_bombas(visita_id);
create index idx_registros_bombas_alerta on public.registros_bombas(voltaje_fuera_rango) where voltaje_fuera_rango = true;

-- ----------------------------------------------------------------------------
-- TABLA: fotos (fotografías vinculadas a una visita, almacenadas en Drive)
-- ----------------------------------------------------------------------------
create table public.fotos (
  id uuid primary key default uuid_generate_v4(),
  visita_id uuid not null references public.visitas(id) on delete cascade,
  drive_file_id text,              -- ID del archivo en Google Drive
  drive_folder_id text,            -- carpeta (organizada por fecha/estación)
  url_publica text,                -- link compartible generado por Drive
  url_local_temporal text,         -- ruta temporal/local mientras está offline o subiendo
  estado_subida text not null default 'pendiente' check (estado_subida in ('pendiente','subiendo','subida','error')),
  descripcion text,
  tomada_en timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_fotos_visita on public.fotos(visita_id);

-- ----------------------------------------------------------------------------
-- TABLA: reportes (reportes generados en PDF y su estado de envío)
-- ----------------------------------------------------------------------------
create table public.reportes (
  id uuid primary key default uuid_generate_v4(),
  tipo tipo_reporte not null,
  generado_por uuid references public.usuarios(id),
  fecha_referencia date not null,           -- fecha que cubre el reporte
  estacion_id uuid references public.estaciones_ebar(id), -- solo para reportes individuales
  operador_id uuid references public.usuarios(id),         -- solo para reportes diarios por operador
  pdf_url text,                              -- URL del PDF (Storage o Drive)
  pdf_storage_path text,
  created_at timestamptz not null default now()
);

create table public.reportes_envios (
  id uuid primary key default uuid_generate_v4(),
  reporte_id uuid not null references public.reportes(id) on delete cascade,
  canal canal_envio not null,
  destinatario text not null,        -- número de WhatsApp o ID de grupo
  estado estado_envio not null default 'pendiente',
  intentos smallint not null default 0,
  ultimo_error text,
  enviado_en timestamptz,
  created_at timestamptz not null default now()
);

create index idx_reportes_fecha on public.reportes(fecha_referencia);
create index idx_reportes_envios_estado on public.reportes_envios(estado);

-- ----------------------------------------------------------------------------
-- TRIGGERS: updated_at automático
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_usuarios_updated_at before update on public.usuarios
  for each row execute function public.set_updated_at();
create trigger trg_estaciones_updated_at before update on public.estaciones_ebar
  for each row execute function public.set_updated_at();
create trigger trg_visitas_updated_at before update on public.visitas
  for each row execute function public.set_updated_at();

-- Al insertar un usuario en auth.users, crear automáticamente su fila en usuarios
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.usuarios (id, nombre_completo, rol)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre_completo', new.email), 'operador');
  return new;
end;
$$;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ----------------------------------------------------------------------------
-- FUNCIONES RPC
-- ----------------------------------------------------------------------------

-- Devuelve el rol del usuario autenticado actual (helper para políticas RLS)
create or replace function public.current_user_role()
returns user_role language sql stable security definer as $$
  select rol from public.usuarios where id = auth.uid();
$$;

-- Dashboard: resumen del día para administradores/supervisores
create or replace function public.rpc_dashboard_resumen(p_fecha date default current_date)
returns json language sql stable security definer as $$
  select json_build_object(
    'fecha', p_fecha,
    'total_visitas', (select count(*) from public.visitas where fecha_hora_llegada::date = p_fecha),
    'estaciones_con_problemas', (
      select count(distinct estacion_id) from public.visitas
      where fecha_hora_llegada::date = p_fecha
        and estado_estacion <> 'operativa'
    ),
    'alertas_voltaje', (
      select count(*) from public.registros_bombas rb
      join public.visitas v on v.id = rb.visita_id
      where v.fecha_hora_llegada::date = p_fecha and rb.voltaje_fuera_rango
    ),
    'estaciones_sin_visitar', (
      select count(*) from public.estaciones_ebar e
      where e.activa and not exists (
        select 1 from public.visitas v
        where v.estacion_id = e.id and v.fecha_hora_llegada::date = p_fecha
      )
    )
  );
$$;

-- Historial de visitas de una estación con datos de bombas anidados
create or replace function public.rpc_historial_estacion(p_estacion_id uuid, p_limite int default 50)
returns json language sql stable security definer as $$
  select coalesce(json_agg(v order by v->>'fecha_hora_llegada' desc), '[]'::json)
  from (
    select json_build_object(
      'id', vi.id,
      'fecha_hora_llegada', vi.fecha_hora_llegada,
      'fecha_hora_salida', vi.fecha_hora_salida,
      'estado_estacion', vi.estado_estacion,
      'nivel_tanque', vi.nivel_tanque,
      'operador', u.nombre_completo,
      'bombas', (
        select coalesce(json_agg(json_build_object(
          'numero_bomba', rb.numero_bomba,
          'estado', rb.estado,
          'voltaje', rb.voltaje,
          'amperaje', rb.amperaje,
          'voltaje_fuera_rango', rb.voltaje_fuera_rango
        )), '[]'::json)
        from public.registros_bombas rb where rb.visita_id = vi.id
      ),
      'fotos_count', (select count(*) from public.fotos f where f.visita_id = vi.id)
    ) as v
    from public.visitas vi
    join public.usuarios u on u.id = vi.operador_id
    where vi.estacion_id = p_estacion_id
    order by vi.fecha_hora_llegada desc
    limit p_limite
  ) sub;
$$;

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
alter table public.usuarios enable row level security;
alter table public.estaciones_ebar enable row level security;
alter table public.bombas enable row level security;
alter table public.visitas enable row level security;
alter table public.registros_bombas enable row level security;
alter table public.fotos enable row level security;
alter table public.reportes enable row level security;
alter table public.reportes_envios enable row level security;

-- usuarios: cada uno ve/edita su propio perfil; admins ven todos
drop policy if exists "usuarios_select_propio_o_admin" on public.usuarios;
drop policy if exists "usuarios_update_propio_o_admin" on public.usuarios;
drop policy if exists "usuarios_insert_admin" on public.usuarios;

create policy "usuarios_select_propio_o_admin" on public.usuarios
  for select using (id = auth.uid() or public.current_user_role() in ('administrador','supervisor'));
create policy "usuarios_update_propio_o_admin" on public.usuarios
  for update using (id = auth.uid() or public.current_user_role() = 'administrador');
create policy "usuarios_insert_admin" on public.usuarios
  for insert with check (public.current_user_role() = 'administrador');

-- estaciones_ebar: todos los autenticados leen; solo admin escribe
drop policy if exists "estaciones_select_autenticados" on public.estaciones_ebar;
drop policy if exists "estaciones_insert_admin" on public.estaciones_ebar;
drop policy if exists "estaciones_update_admin" on public.estaciones_ebar;
drop policy if exists "estaciones_delete_admin" on public.estaciones_ebar;

create policy "estaciones_select_autenticados" on public.estaciones_ebar
  for select using (auth.uid() is not null);
create policy "estaciones_insert_admin" on public.estaciones_ebar
  for insert with check (public.current_user_role() = 'administrador');
create policy "estaciones_update_admin" on public.estaciones_ebar
  for update using (public.current_user_role() = 'administrador');
create policy "estaciones_delete_admin" on public.estaciones_ebar
  for delete using (public.current_user_role() = 'administrador');

-- bombas: lectura para autenticados, escritura para admin
drop policy if exists "bombas_select_autenticados" on public.bombas;
drop policy if exists "bombas_write_admin" on public.bombas;

create policy "bombas_select_autenticados" on public.bombas
  for select using (auth.uid() is not null);
create policy "bombas_write_admin" on public.bombas
  for all using (public.current_user_role() = 'administrador')
  with check (public.current_user_role() = 'administrador');

-- visitas: operador crea/edita las propias; admin/supervisor ven y editan todas
drop policy if exists "visitas_select" on public.visitas;
drop policy if exists "visitas_insert_propio" on public.visitas;
drop policy if exists "visitas_update" on public.visitas;

create policy "visitas_select" on public.visitas
  for select using (operador_id = auth.uid() or public.current_user_role() in ('administrador','supervisor'));
create policy "visitas_insert_propio" on public.visitas
  for insert with check (operador_id = auth.uid() or public.current_user_role() = 'administrador');
create policy "visitas_update" on public.visitas
  for update using (operador_id = auth.uid() or public.current_user_role() in ('administrador','supervisor'));

-- registros_bombas: heredan visibilidad de la visita asociada
drop policy if exists "registros_bombas_select" on public.registros_bombas;
drop policy if exists "registros_bombas_insert" on public.registros_bombas;
drop policy if exists "registros_bombas_update" on public.registros_bombas;

create policy "registros_bombas_select" on public.registros_bombas
  for select using (
    exists (select 1 from public.visitas v where v.id = visita_id
      and (v.operador_id = auth.uid() or public.current_user_role() in ('administrador','supervisor')))
  );
create policy "registros_bombas_insert" on public.registros_bombas
  for insert with check (
    exists (select 1 from public.visitas v where v.id = visita_id and v.operador_id = auth.uid())
    or public.current_user_role() = 'administrador'
  );
create policy "registros_bombas_update" on public.registros_bombas
  for update using (
    exists (select 1 from public.visitas v where v.id = visita_id and v.operador_id = auth.uid())
    or public.current_user_role() in ('administrador','supervisor')
  );

-- fotos: igual criterio que la visita
drop policy if exists "fotos_select" on public.fotos;
drop policy if exists "fotos_insert" on public.fotos;
drop policy if exists "fotos_update" on public.fotos;

create policy "fotos_select" on public.fotos
  for select using (
    exists (select 1 from public.visitas v where v.id = visita_id
      and (v.operador_id = auth.uid() or public.current_user_role() in ('administrador','supervisor')))
  );
create policy "fotos_insert" on public.fotos
  for insert with check (
    exists (select 1 from public.visitas v where v.id = visita_id and v.operador_id = auth.uid())
    or public.current_user_role() = 'administrador'
  );
create policy "fotos_update" on public.fotos
  for update using (
    exists (select 1 from public.visitas v where v.id = visita_id and v.operador_id = auth.uid())
    or public.current_user_role() in ('administrador','supervisor')
  );

-- reportes y envíos: solo admin/supervisor gestionan; operador ve los suyos
drop policy if exists "reportes_select" on public.reportes;
drop policy if exists "reportes_insert" on public.reportes;
drop policy if exists "reportes_envios_select" on public.reportes_envios;
drop policy if exists "reportes_envios_write" on public.reportes_envios;

create policy "reportes_select" on public.reportes
  for select using (
    generado_por = auth.uid() or operador_id = auth.uid()
    or public.current_user_role() in ('administrador','supervisor')
  );
create policy "reportes_insert" on public.reportes
  for insert with check (auth.uid() is not null);
create policy "reportes_envios_select" on public.reportes_envios
  for select using (public.current_user_role() in ('administrador','supervisor'));
create policy "reportes_envios_write" on public.reportes_envios
  for all using (public.current_user_role() in ('administrador','supervisor'))
  with check (public.current_user_role() in ('administrador','supervisor'));

-- ----------------------------------------------------------------------------
-- STORAGE BUCKETS (ejecutar también desde el dashboard o vía API de Storage)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('firmas', 'firmas', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('reportes-pdf', 'reportes-pdf', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('fotos-temp', 'fotos-temp', false)
  on conflict (id) do nothing; -- buffer temporal antes de subir a Google Drive

-- Nota: si PostGIS no está disponible en el plan de Supabase usado, eliminar
-- la línea "create extension postgis" — latitud/longitud como double precision
-- ya son suficientes para este modelo y no dependen de PostGIS.
