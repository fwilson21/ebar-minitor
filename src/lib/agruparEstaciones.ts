// Orden y agrupado de estaciones por zona+tipo, compartido entre pantallas (Dashboard →
// "Pendientes de visita", Asignaciones → listas de EBAR por operador) para que se vea siempre
// igual: urbana antes que rural, y dentro de cada zona EBAR antes que PTAR antes que línea de
// conducción. Cualquier valor no listado (si algún día aparece un tipo/zona nuevo) se acomoda al
// final, no se pierde.

const ORDEN_ZONA: Record<string, number> = { urbana: 0, rural: 1 };
const ORDEN_TIPO: Record<string, number> = { ebar: 0, ptar: 1, linea_conduccion: 2 };

export const ETIQUETA_ZONA: Record<string, string> = { urbana: 'Urbana', rural: 'Rural' };
export const ETIQUETA_TIPO: Record<string, string> = {
  ebar: 'EBAR',
  ptar: 'PTAR',
  linea_conduccion: 'Línea de conducción',
};

/** Calles si la estación las tiene registradas; si no, su parroquia — para mostrar la ubicación
 * justo después del nombre/código de la EBAR (pantallas y PDF). Las estaciones rurales no siempre
 * tienen una dirección de calles y se identifican por su parroquia en su lugar. */
export function direccionOParroquia(estacion: { direccion?: string | null; parroquia?: string | null }): string | null {
  return estacion.direccion?.trim() || estacion.parroquia?.trim() || null;
}

function comparar(a: { zona: string; tipo: string }, b: { zona: string; tipo: string }): number {
  return (ORDEN_ZONA[a.zona] ?? 9) - (ORDEN_ZONA[b.zona] ?? 9) || (ORDEN_TIPO[a.tipo] ?? 9) - (ORDEN_TIPO[b.tipo] ?? 9);
}

/** Misma lista, ordenada por zona+tipo (sin agrupar en secciones — para listas planas como los
 * botones de estación en Asignaciones). */
export function ordenarPorZonaYTipo<T extends { zona: string; tipo: string }>(lista: T[]): T[] {
  return [...lista].sort(comparar);
}

/** Agrupa en secciones por zona+tipo (ej. "Urbana · EBAR", "Rural · PTAR") — usado donde además
 * de ordenar se quiere mostrar un encabezado por grupo (ver Dashboard "Pendientes de visita"). */
export function agruparPorZonaYTipo<T extends { zona: string; tipo: string }>(
  lista: T[],
): { zona: string; tipo: string; estaciones: T[] }[] {
  const mapa = new Map<string, T[]>();
  for (const e of lista) {
    const clave = `${e.zona}|${e.tipo}`;
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave)!.push(e);
  }
  return [...mapa.entries()]
    .map(([clave, estaciones]) => {
      const [zona, tipo] = clave.split('|');
      return { zona, tipo, estaciones };
    })
    .sort(comparar);
}
