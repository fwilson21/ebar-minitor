-- El ancho del contenido en escritorio deja de ser un único valor global (ajustado desde la
-- pantalla separada "Distribución de entorno de trabajo") y pasa a guardarse por pantalla, junto
-- al mismo botón "Editar distribución" que ahora vive directo en cada pantalla. La fila
-- clave='global' que ya existía queda como respaldo (valor por defecto) para cualquier pantalla
-- que todavía no tenga su propio ancho guardado.
alter table configuracion_ancho_contenido drop constraint if exists configuracion_ancho_contenido_singleton;
