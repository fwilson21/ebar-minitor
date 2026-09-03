// Cuánto le tomó al operador una visita (llegada → salida) — compartido entre el historial de
// StationDetail y "Visitas registradas" del Dashboard (ModalListaEstaciones), mismo criterio de
// "visita relámpago" en los dos lados.

// Visitas más cortas que esto se resaltan (no se bloquea nada, es solo para que el supervisor
// note "visitas relámpago" de un vistazo).
export const VISITA_CORTA_MINUTOS = 3;

export function duracionVisita(llegada: string, salida?: string | null): { texto: string; corta: boolean } | null {
  if (!salida) return null;
  const minutos = Math.round((new Date(salida).getTime() - new Date(llegada).getTime()) / 60000);
  if (minutos < 0) return null;
  const texto = minutos < 60 ? `${minutos} min` : `${Math.floor(minutos / 60)}h ${String(minutos % 60).padStart(2, '0')}min`;
  return { texto, corta: minutos < VISITA_CORTA_MINUTOS };
}
