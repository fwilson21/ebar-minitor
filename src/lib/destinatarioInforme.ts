import { supabase } from './supabase';

// ────────────────────────────────────────────────────────────────────────────
// Destinatario por defecto del encabezado "Para" de los informes (Reportes,
// Historial de estación, Informe Semanal) — tabla de fila única
// `configuracion_destinatario_informe` (migración 0060), mismo patrón que
// `app_config` (ver versionApp.ts). Cualquier autenticado la lee; solo
// administrador/supervisor pueden cambiarla — lo refuerza la política RLS.
// ────────────────────────────────────────────────────────────────────────────

export interface DestinatarioInforme {
  nombre: string;
  cargo: string;
}

/** Respaldo si la tabla todavía no existe (migración 0060 sin correr) o falla
 * la consulta (sin señal, etc.) — para no dejar el encabezado en blanco. */
const DESTINATARIO_RESPALDO: DestinatarioInforme = {
  nombre: 'Ing. Andrea Estefanía Logacho Morales',
  cargo: 'ANALISTA DE REDES DE ALCANTARILLADO Y ESTACIONES DE BOMBEO DE AGUAS RESIDUALES',
};

export async function consultarDestinatarioInforme(): Promise<DestinatarioInforme> {
  try {
    const { data, error } = await supabase
      .from('configuracion_destinatario_informe')
      .select('nombre, cargo')
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) return DESTINATARIO_RESPALDO;
    return {
      nombre: data.nombre ?? DESTINATARIO_RESPALDO.nombre,
      cargo: data.cargo ?? DESTINATARIO_RESPALDO.cargo,
    };
  } catch {
    return DESTINATARIO_RESPALDO;
  }
}

/** Cambia el valor por defecto para todos (solo administrador/supervisor —
 * lo refuerza la política RLS de `configuracion_destinatario_informe`). */
export async function actualizarDestinatarioInforme(
  valor: DestinatarioInforme,
  actualizadoPor: string | undefined,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('configuracion_destinatario_informe')
    .update({
      nombre: valor.nombre,
      cargo: valor.cargo,
      actualizado_en: new Date().toISOString(),
      actualizado_por: actualizadoPor ?? null,
    })
    .eq('id', 1);
  return error ? { error: error.message } : {};
}
