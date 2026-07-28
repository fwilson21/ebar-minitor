import { supabase } from './supabase';

export type BloqueLayout = { i: string; x: number; y: number; w: number; h: number };

export async function obtenerLayout(pantallaId: string): Promise<BloqueLayout[] | null> {
  const { data, error } = await supabase
    .from('layouts_admin')
    .select('layout')
    .eq('pantalla', pantallaId)
    .maybeSingle();
  if (error || !data) return null;
  return data.layout as BloqueLayout[];
}

export async function guardarLayout(pantallaId: string, layout: BloqueLayout[]): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from('layouts_admin').upsert({
    pantalla: pantallaId,
    layout,
    actualizado_en: new Date().toISOString(),
    actualizado_por: user?.id ?? null,
  });
  if (error) throw error;
}
