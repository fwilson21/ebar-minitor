-- ============================================================================
-- Diccionario personalizado del corrector de ortografía (src/lib/correctorEs.ts).
-- El corrector ya trae una lista fija de términos técnicos de EBAR/PTAR que el
-- diccionario general no conoce (TERMINOS_EBAR, en el código) — esta tabla es
-- el complemento: cuando alguien marca "está bien escrita" una palabra que el
-- corrector subrayó en rojo (ResumenEditable.tsx), queda guardada acá para que
-- esa palabra deje de marcarse SIEMPRE, en cualquier computadora, sin tener
-- que tocar código cada vez. Pedido del usuario (2026-09-06, caso real:
-- "retrolavado" marcada como mal escrita sin estarlo).
-- ============================================================================

create table public.diccionario_personalizado (
  id uuid primary key default uuid_generate_v4(),
  -- Siempre en minúscula (revisarTexto/correct ya comparan en minúscula) — un unique acá evita
  -- duplicados aunque 2 personas agreguen la misma palabra casi al mismo tiempo.
  palabra text not null unique,
  creado_por uuid references public.usuarios(id) on delete set null,
  creado_en timestamptz not null default now()
);

alter table public.diccionario_personalizado enable row level security;

-- Cualquier autenticado la puede leer (el corrector la carga entera al iniciar, para las 3
-- pantallas que lo usan: Informe Semanal, vista previa de Reportes, VisitForm en computadora).
create policy "diccionario_select_autenticados" on public.diccionario_personalizado
  for select using (auth.uid() is not null);

-- Cualquier autenticado puede agregar una palabra (el botón "Está bien escrita" está disponible
-- para quien esté usando el corrector, no solo administrador/supervisor).
create policy "diccionario_insert_autenticados" on public.diccionario_personalizado
  for insert with check (auth.uid() is not null);

comment on table public.diccionario_personalizado is
  'Palabras que alguien marcó como "está bien escrita" en el corrector de ortografía — se suman a TERMINOS_EBAR (hardcodeado en correctorEs.ts) para que el corrector deje de subrayarlas, en cualquier computadora.';
