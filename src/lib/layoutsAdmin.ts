import { supabase } from './supabase';

export type BloqueLayout = { i: string; x: number; y: number; w: number; h: number };

// A quién puede apuntarse una distribución guardada — 'todos' es el acomodo general (respaldo de
// cualquiera que no tenga uno propio); administrador no tiene variante propia porque es quien
// arma "todos" como punto de partida.
export const OBJETIVOS_DISTRIBUCION = ['todos', 'supervisor', 'digitador', 'operador'] as const;
export type ObjetivoDistribucion = (typeof OBJETIVOS_DISTRIBUCION)[number];

export const OBJETIVO_LABEL: Record<ObjetivoDistribucion, string> = {
  todos: 'Todos',
  supervisor: 'Supervisor',
  digitador: 'Digitador',
  operador: 'Operador',
};

function comoObjetivo(rol: string | undefined): ObjetivoDistribucion {
  return (OBJETIVOS_DISTRIBUCION as readonly string[]).includes(rol ?? '') ? (rol as ObjetivoDistribucion) : 'todos';
}

/** Resuelve qué distribución le corresponde a alguien con este rol (o a la variante que se está
 * previsualizando al editar, pasando su objetivo acá): la propia del rol si existe, si no la
 * general ("todos"), si no null (el acomodo por defecto del código, ver GridEditable.tsx). Un rol
 * que no tiene variante propia (ej. 'administrador') siempre cae directo a "todos". */
export async function obtenerLayout(pantallaId: string, rol: string | undefined): Promise<BloqueLayout[] | null> {
  const objetivo = comoObjetivo(rol);
  const { data, error } = await supabase
    .from('layouts_admin')
    .select('objetivo, layout')
    .eq('pantalla', pantallaId)
    .in('objetivo', objetivo === 'todos' ? ['todos'] : [objetivo, 'todos']);
  if (error || !data || data.length === 0) return null;
  const propio = data.find((f) => f.objetivo === objetivo);
  const general = data.find((f) => f.objetivo === 'todos');
  return ((propio ?? general)?.layout as BloqueLayout[]) ?? null;
}

/** Guarda la distribución para uno o varios objetivos a la vez (el checklist de
 * BarraDistribucion) — una fila por cada uno, todas con el mismo acomodo. */
export async function guardarLayout(pantallaId: string, layout: BloqueLayout[], objetivos: ObjetivoDistribucion[]): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const filas = objetivos.map((objetivo) => ({
    pantalla: pantallaId,
    objetivo,
    layout,
    actualizado_en: new Date().toISOString(),
    actualizado_por: user?.id ?? null,
  }));
  const { error } = await supabase.from('layouts_admin').upsert(filas, { onConflict: 'pantalla,objetivo' });
  if (error) throw error;
}
