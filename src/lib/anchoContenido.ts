// Ancho máximo del contenido principal en escritorio (ver AppShell.tsx y DistribucionEntorno.tsx)
// — valor único global, guardado en configuracion_ancho_contenido (migración 0031).

import { supabase } from './supabase';

export const ANCHO_CONTENIDO_MIN = 900;
export const ANCHO_CONTENIDO_MAX = 2200;
export const ANCHO_CONTENIDO_DEFAULT = 1280;

export async function obtenerAnchoContenido(): Promise<number> {
  const { data } = await supabase
    .from('configuracion_ancho_contenido')
    .select('ancho_px')
    .eq('clave', 'global')
    .maybeSingle();
  return data?.ancho_px ?? ANCHO_CONTENIDO_DEFAULT;
}

export async function guardarAnchoContenido(anchoPx: number): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from('configuracion_ancho_contenido').upsert({
    clave: 'global',
    ancho_px: anchoPx,
    actualizado_en: new Date().toISOString(),
    actualizado_por: user?.id ?? null,
  });
  if (error) throw error;
}
