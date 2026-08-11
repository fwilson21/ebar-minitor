-- Distribución de entorno de trabajo: el grid de arrastre pasa de 12 columnas x 40px de alto a
-- 24 columnas x 20px de alto (el doble de fino), para poder ajustar el tamaño de un bloque en
-- pasos más chicos. Esto duplica el sistema de medidas, así que hay que reescalar x2 (x, y, w, h)
-- cualquier distribución que ya haya guardado el administrador, para que no se vea encogida en la
-- esquina después del cambio.
update layouts_admin
set layout = (
  select jsonb_agg(
    elem
    || jsonb_build_object('x', (elem->>'x')::numeric * 2)
    || jsonb_build_object('y', (elem->>'y')::numeric * 2)
    || jsonb_build_object('w', (elem->>'w')::numeric * 2)
    || jsonb_build_object('h', (elem->>'h')::numeric * 2)
  )
  from jsonb_array_elements(layout) as elem
);
