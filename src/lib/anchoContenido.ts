// Ancho máximo del contenido principal en escritorio (ver AppShell.tsx) — guardado por pantalla
// en configuracion_ancho_contenido (migraciones 0031 y 0033), cada una con su propio control
// dentro de "Editar distribución" (ver useEditorDistribucion.ts). La fila clave='global' es un
// valor heredado de cuando esto era un único control para toda la app: sirve de respaldo para
// cualquier pantalla que todavía no tenga su propio ancho guardado.

import { supabase } from './supabase';

export const ANCHO_CONTENIDO_MIN = 900;
export const ANCHO_CONTENIDO_MAX = 2200;
export const ANCHO_CONTENIDO_DEFAULT = 1280;

/** Trae de una sola vez el ancho guardado de todas las pantallas (tabla chica, no vale la pena
 * pedirlo pantalla por pantalla). AuthContext la llama una vez por sesión. */
export async function obtenerAnchosPantalla(): Promise<Record<string, number>> {
  const { data } = await supabase.from('configuracion_ancho_contenido').select('clave, ancho_px');
  const mapa: Record<string, number> = {};
  for (const fila of data ?? []) mapa[fila.clave as string] = fila.ancho_px as number;
  return mapa;
}

export async function guardarAnchoContenido(pantallaId: string, anchoPx: number): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from('configuracion_ancho_contenido').upsert({
    clave: pantallaId,
    ancho_px: anchoPx,
    actualizado_en: new Date().toISOString(),
    actualizado_por: user?.id ?? null,
  });
  if (error) throw error;
}
