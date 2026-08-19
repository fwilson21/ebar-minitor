-- ============================================================================
-- Carga de datos reales de estaciones EBAR/PTAR y bombas
-- Generado a partir de estaciones_plantilla.csv / bombas_plantilla.csv
--
-- IMPORTANTE: requiere que 0039_tipo_estacion_ptar.sql ya se haya ejecutado
-- (y confirmado) ANTES, en una ejecución separada — Postgres no permite usar
-- un valor de enum recién agregado en la misma transacción donde se agrega.
--
-- 22 estaciones EBAR + 7 PTAR (29 en total). Las bombas se generan como
-- "cantidad de bombas" filas por estación (bomba 1..N), todas con los mismos
-- datos de placa (marca/modelo/potencia/voltaje/amperaje), tal como venían
-- en bombas_plantilla.csv. Ningún dato existente se sobrescribe: los
-- "on conflict ... do nothing" hacen que se pueda correr más de una vez sin
-- duplicar ni pisar filas ya cargadas.
-- ============================================================================

insert into public.estaciones_ebar (codigo, nombre, zona, tipo, direccion, latitud, longitud, descripcion, numero_bombas)
values
  ('EBAR-002', 'EBAR-002', 'urbana', 'ebar', 'Av. Napo y Uquillas', -0.441474, -77.005254, 'Barrio 6 diciembre', 2),
  ('EBAR-003', 'EBAR-003', 'urbana', 'ebar', 'Av. Ambato y Rio Zuno', -0.446247, -77.002173, 'Barrio Paraízo Amazónico', 4),
  ('EBAR-004', 'EBAR-004', 'urbana', 'ebar', 'Nicolás Torres y Jatuncocha', -0.457346, -76.998996, null, 4),
  ('EBAR-005', 'EBAR-005', 'urbana', 'ebar', 'Zapotal y José Feliciano', -0.467782694, -77.00118612, null, 3),
  ('EBAR-006', 'EBAR-006', 'urbana', 'ebar', 'Espejo entre 6 de diciembre y 9 de octubre', -0.474048, -76.985419, null, 4),
  ('EBAR-007', 'EBAR-007', 'urbana', 'ebar', 'Camilo de Torrano', -0.474048, -76.985419, null, 4),
  ('EBAR-008', 'EBAR-008', 'urbana', 'ebar', 'Nicolás Torres entre Miguel Gamboa y Ernesto Rodriguez', -0.466579, -76.994125, null, 4),
  ('EBAR-009', 'EBAR-009', 'urbana', 'ebar', 'Via Auca km 1 1/2', -0.479661, -76.971076, null, 4),
  ('EBAR-010', 'EBAR-010', 'urbana', 'ebar', 'Luis Cordero', -0.430764, -76.988719, null, 2),
  ('EBAR-MILITARES 001', 'EBAR-MILITARES 001', 'urbana', 'ebar', 'FUERTE MILITAR BS19', -0.481804, -76.983028, null, 2),
  ('EBAR-MILITARES 002', 'EBAR-MILITARES 002', 'urbana', 'ebar', 'FUERTE MILITAR BS19', -0.477222, -76.980698, null, 2),
  ('EBAR-MILITARES 003', 'EBAR-MILITARES 003', 'urbana', 'ebar', 'FUERTE MILITAR BS19', -0.479556, -76.976966, null, 2),
  ('EBAR-MILITARES 004', 'EBAR-MILITARES 004', 'urbana', 'ebar', 'FUERTE MILITAR BS19', -0.47723, -76.973919, null, 2),
  ('EBAR DORADO 1', 'EBAR D1', 'rural', 'ebar', null, -0.499507, -76.953649, null, 2),
  ('EBAR DORADO 2', 'EBAR D2', 'rural', 'ebar', null, -0.504066, -76.952822, null, 2),
  ('EBAR GARCIA MORENO', 'EBAR GM', 'rural', 'ebar', null, -0.527724, -77.017174, null, 2),
  ('EBAR LA BELLEZA', 'EBAR LB', 'rural', 'ebar', null, -0.656324, -77.046208, null, 2),
  ('EBAR TARACOA', 'EBAR T', 'rural', 'ebar', null, -0.498787, -76.776067, null, 3),
  ('EBAR DAYUMA', 'EBAR DAY', 'rural', 'ebar', null, -0.664659, -76.87838, null, 2),
  ('EBAR INES ARANGO 1', 'EBAR IA1', 'rural', 'ebar', null, -0.910503, -76.915959, null, 2),
  ('EBAR INES ARANGO 2', 'EBAR IA2', 'rural', 'ebar', null, -0.91323, -76.912911, null, 2),
  ('EBAR NUEVO PARAISO', 'EBAR NP', 'rural', 'ebar', null, -0.380913, -77.013333, null, 3),
  ('PTAR NUEVO PARAISO', 'PTAR NP', 'rural', 'ptar', null, -0.372097, -77.015007, null, 0),
  ('PTAR GUAYUSA', 'PTAR GUAY', 'rural', 'ptar', null, -0.254038, -77.059558, null, 0),
  ('PTAR EL COCA', 'PTAR COCA', 'rural', 'ptar', null, -0.49067, -76.950794, null, 0),
  ('PTAR GARCIA MORENO', 'PTAR GM', 'rural', 'ptar', null, -0.532914, -77.021928, null, 0),
  ('PTAR LA BELLEZA', 'PTAR LB', 'rural', 'ptar', null, -0.660245, -77.036534, null, 0),
  ('PTAR TARACOA', 'PTAR T', 'rural', 'ptar', null, -0.509368, -76.774555, null, 0),
  ('PTAR INES ARANGO', 'PTAR IA', 'rural', 'ptar', null, -0.912808, -76.922665, null, 0)
on conflict (codigo) do nothing;

-- Bombas: una fila por cada bomba (1..N) por estación, con los mismos datos de placa
insert into public.bombas (estacion_id, numero_bomba, marca, modelo, potencia_hp, voltaje_nominal, amperaje_nominal)
select e.id, x.numero_bomba, x.marca, x.modelo, x.potencia_hp, x.voltaje_nominal, x.amperaje_nominal
from (values
  ('EBAR-002', 1, 'Flygt', '3127', 7.5, 460, null),
  ('EBAR-002', 2, 'Flygt', '3127', 7.5, 460, null),
  ('EBAR-003', 1, 'Grundfos', null, null, 460, null),
  ('EBAR-003', 2, 'Grundfos', null, null, 460, null),
  ('EBAR-003', 3, 'Grundfos', null, null, 460, null),
  ('EBAR-003', 4, 'Grundfos', null, null, 460, null),
  ('EBAR-004', 1, 'Grundfos', null, null, 460, null),
  ('EBAR-004', 2, 'Grundfos', null, null, 460, null),
  ('EBAR-004', 3, 'Grundfos', null, null, 460, null),
  ('EBAR-004', 4, 'Grundfos', null, null, 460, null),
  ('EBAR-005', 1, 'Grundfos', null, null, 460, null),
  ('EBAR-005', 2, 'Grundfos', null, null, 460, null),
  ('EBAR-005', 3, 'Grundfos', null, null, 460, null),
  ('EBAR-006', 1, 'Flygt', '3202', 60, 460, 68),
  ('EBAR-006', 2, 'Flygt', '3202', 60, 460, 68),
  ('EBAR-006', 3, 'Flygt', '3202', 60, 460, 68),
  ('EBAR-006', 4, 'Flygt', '3202', 60, 460, 68),
  ('EBAR-007', 1, 'Flygt', '3202', 60, 460, 68),
  ('EBAR-007', 2, 'Flygt', '3202', 60, 460, 68),
  ('EBAR-007', 3, 'Flygt', '3202', 60, 460, 68),
  ('EBAR-007', 4, 'Flygt', '3202', 60, 460, 68),
  ('EBAR-008', 1, 'Flygt', '3202', 70, 460, 79),
  ('EBAR-008', 2, 'Flygt', '3202', 70, 460, 79),
  ('EBAR-008', 3, 'Flygt', '3202', 70, 460, 79),
  ('EBAR-008', 4, 'Flygt', '3202', 70, 460, 79),
  ('EBAR-009', 1, 'Flygt', '3315', 140, 460, 179),
  ('EBAR-009', 2, 'Flygt', '3315', 140, 460, 179),
  ('EBAR-009', 3, 'Flygt', '3315', 140, 460, 179),
  ('EBAR-009', 4, 'Flygt', '3315', 140, 460, 179),
  ('EBAR-010', 1, 'Grundfos', null, null, 230, null),
  ('EBAR-010', 2, 'Grundfos', null, null, 230, null),
  ('EBAR-MILITARES 001', 1, 'Flygt', '3085', 4, 460, 6),
  ('EBAR-MILITARES 001', 2, 'Flygt', '3085', 4, 460, 6),
  ('EBAR-MILITARES 002', 1, 'Flygt', '3127', 7.5, 460, 9.9),
  ('EBAR-MILITARES 002', 2, 'Flygt', '3127', 7.5, 460, 9.9),
  ('EBAR-MILITARES 003', 1, 'Flygt', '3085', 4, 460, 6),
  ('EBAR-MILITARES 003', 2, 'Flygt', '3085', 4, 460, 6),
  ('EBAR-MILITARES 004', 1, 'Flygt', '3085', 4, 230, 9),
  ('EBAR-MILITARES 004', 2, 'Flygt', '3085', 4, 230, 9),
  ('EBAR DORADO 1', 1, null, null, null, null, null),
  ('EBAR DORADO 1', 2, null, null, null, null, null),
  ('EBAR DORADO 2', 1, 'Flygt', null, null, null, null),
  ('EBAR DORADO 2', 2, 'Flygt', null, null, null, null),
  ('EBAR GARCIA MORENO', 1, 'Flygt', null, null, null, null),
  ('EBAR GARCIA MORENO', 2, 'Flygt', null, null, null, null),
  ('EBAR LA BELLEZA', 1, 'Flygt', null, null, null, null),
  ('EBAR LA BELLEZA', 2, 'Flygt', null, null, null, null),
  ('EBAR TARACOA', 1, null, null, null, null, null),
  ('EBAR TARACOA', 2, null, null, null, null, null),
  ('EBAR TARACOA', 3, null, null, null, null, null),
  ('EBAR DAYUMA', 1, null, null, null, null, null),
  ('EBAR DAYUMA', 2, null, null, null, null, null),
  ('EBAR INES ARANGO 1', 1, 'Flygt', null, null, null, null),
  ('EBAR INES ARANGO 1', 2, 'Flygt', null, null, null, null),
  ('EBAR INES ARANGO 2', 1, 'Flygt', null, null, null, null),
  ('EBAR INES ARANGO 2', 2, 'Flygt', null, null, null, null),
  ('EBAR NUEVO PARAISO', 1, null, null, null, null, null),
  ('EBAR NUEVO PARAISO', 2, null, null, null, null, null),
  ('EBAR NUEVO PARAISO', 3, null, null, null, null, null)
) as x(codigo_estacion, numero_bomba, marca, modelo, potencia_hp, voltaje_nominal, amperaje_nominal)
join public.estaciones_ebar e on e.codigo = x.codigo_estacion
on conflict (estacion_id, numero_bomba) do nothing;

