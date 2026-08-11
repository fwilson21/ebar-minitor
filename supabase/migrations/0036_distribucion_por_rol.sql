-- La distribución de cada pantalla (acomodo de bloques + ancho de contenido) deja de ser un solo
-- acomodo compartido por todos y pasa a poder apuntarse a roles específicos — a pedido del
-- usuario: "lo que acomodo para digitador no afecte en la pantalla del administrador o del
-- supervisor". El administrador elige, al guardar, para quién aplica (checklist: Todos /
-- Supervisor / Digitador / Operador — ver BarraDistribucion.tsx). Quien mira una pantalla ve la
-- distribución de su propio rol si existe, si no la de "todos", si no el acomodo por defecto del
-- código.

alter table layouts_admin add column if not exists objetivo text not null default 'todos';
alter table layouts_admin drop constraint layouts_admin_pkey;
alter table layouts_admin add constraint layouts_admin_pkey primary key (pantalla, objetivo);
alter table layouts_admin add constraint layouts_admin_objetivo_check
  check (objetivo in ('todos', 'supervisor', 'digitador', 'operador'));

alter table configuracion_ancho_contenido add column if not exists objetivo text not null default 'todos';
alter table configuracion_ancho_contenido drop constraint configuracion_ancho_contenido_pkey;
alter table configuracion_ancho_contenido add constraint configuracion_ancho_contenido_pkey primary key (clave, objetivo);
alter table configuracion_ancho_contenido add constraint configuracion_ancho_contenido_objetivo_check
  check (objetivo in ('todos', 'supervisor', 'digitador', 'operador'));
