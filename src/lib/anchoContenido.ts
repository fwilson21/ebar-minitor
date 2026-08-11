// Ancho máximo del contenido principal en escritorio (ver AppShell.tsx) — guardado por pantalla Y
// por rol destino (migraciones 0031, 0033, 0036), cada una con su propio control dentro de
// "Editar distribución" (ver useEditorDistribucion.ts). La fila clave='global' es un valor
// heredado de cuando esto era un único control para toda la app: sirve de respaldo para cualquier
// pantalla que todavía no tenga su propio ancho guardado.

import { supabase } from './supabase';
import { OBJETIVOS_DISTRIBUCION, type ObjetivoDistribucion } from './layoutsAdmin';

export const ANCHO_CONTENIDO_MIN = 900;
export const ANCHO_CONTENIDO_MAX = 2200;
export const ANCHO_CONTENIDO_DEFAULT = 1280;

function comoObjetivo(rol: string | undefined): ObjetivoDistribucion {
  return (OBJETIVOS_DISTRIBUCION as readonly string[]).includes(rol ?? '') ? (rol as ObjetivoDistribucion) : 'todos';
}

/** Trae de una sola vez el ancho guardado de todas las pantallas para el rol dado (ya resuelto:
 * el propio del rol si existe, si no el de "todos") — tabla chica, no vale la pena pedirlo
 * pantalla por pantalla. AuthContext la llama una vez por sesión con el rol real de quien entró. */
export async function obtenerAnchosPantalla(rol: string | undefined): Promise<Record<string, number>> {
  const objetivo = comoObjetivo(rol);
  const { data } = await supabase
    .from('configuracion_ancho_contenido')
    .select('clave, objetivo, ancho_px')
    .in('objetivo', objetivo === 'todos' ? ['todos'] : [objetivo, 'todos']);
  const generales: Record<string, number> = {};
  const propios: Record<string, number> = {};
  for (const fila of data ?? []) {
    if (fila.objetivo === 'todos') generales[fila.clave as string] = fila.ancho_px as number;
    else propios[fila.clave as string] = fila.ancho_px as number;
  }
  return { ...generales, ...propios };
}

/** Guarda el ancho para uno o varios objetivos a la vez (mismo checklist que la distribución de
 * bloques — se editan juntos). */
export async function guardarAnchoContenido(pantallaId: string, anchoPx: number, objetivos: ObjetivoDistribucion[]): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const filas = objetivos.map((objetivo) => ({
    clave: pantallaId,
    objetivo,
    ancho_px: anchoPx,
    actualizado_en: new Date().toISOString(),
    actualizado_por: user?.id ?? null,
  }));
  const { error } = await supabase.from('configuracion_ancho_contenido').upsert(filas, { onConflict: 'clave,objetivo' });
  if (error) throw error;
}
