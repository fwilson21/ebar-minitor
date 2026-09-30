-- ============================================================================
-- Limpieza de visitas duplicadas SIN FOTOS (pedido del usuario 2026-09-30).
--
-- 1) 8 copias de visitas de Edisson Zambrano (24 al 30-sep-2026): cada una
--    tiene una gemela con la misma EBAR, el mismo operador y la MISMA hora de
--    llegada que sí tiene todas sus fotos. Salían de un borrador que sobrevivía
--    al guardar y reaparecía al día siguiente (arreglado en VisitForm.tsx,
--    commit 8f54619). La gemela con fotos NO se toca.
--
-- 2) Visita de José Iván Vega en EBAR-003 del 22-sep-2026 (llegada 09:06):
--    guardada 7 veces entre las 10:51 y las 11:00 (tuvo problemas para guardar
--    ese día), ninguna con fotos. Se conserva SOLO la última
--    (3a34452b-3d95-486d-8b08-40177becc009, 11:00:58) y se borran las otras 6.
--
-- Ids explícitos (sacados de la base el 2026-09-30) en vez de una condición
-- genérica, para no tocar nada más. Además, por las dudas, solo se borran si
-- SIGUEN sin fotos. Sus registros de bombas se borran solos (on delete cascade).
-- ============================================================================

delete from public.visitas v
where v.id in (
    -- 1) copias de Zambrano
    '80c5d542-d0db-40d6-b8e7-7805432ae206',
    'a0292bad-a6df-4a56-8cfd-1be14fba27d4',
    '2387c760-98f2-435e-bdbf-fdef772b51df',
    '4848a06b-d60f-4d97-93fd-18e37ee31811',
    '3640fc81-4d4d-4361-8a67-74647524a402',
    '951967c1-a75b-45ac-bab0-5cb895ffa560',
    '6f153cf2-815c-41a9-b80a-c0ba5f7ad6dc',
    'b3473ad2-95fe-49cc-9aed-9d937b45ac2e',
    -- 2) repeticiones de Vega (se conserva 3a34452b-..., la última)
    'f440c000-4eec-49d8-ba46-30192269cbfb',
    '053f17f1-d374-4583-bb76-82351655f61c',
    '2a9f0875-3546-49f2-b37f-6d5ba83a2ff9',
    '046ac3a8-fb6c-4d7b-8cbf-32267bf28692',
    '7f772427-a38b-4d75-b31b-5414d1c76b55',
    '56b093b1-946c-4098-a823-c44ed51b165f'
  )
  and not exists (select 1 from public.fotos f where f.visita_id = v.id);
