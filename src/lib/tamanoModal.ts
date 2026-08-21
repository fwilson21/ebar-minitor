// Tamaño (ancho x alto en px) de un modal con manija de redimensionar (ver
// components/ManijaRedimension.tsx), guardado en configuracion_tamano_modal — una fila por
// modal, identificada por `clave` (ej. 'panel_dia_turnos', 'modal_metrica_dashboard'). El
// administrador lo ajusta arrastrando; el tamaño guardado se ve igual para cualquier rol que
// abra ese modal (RLS: cualquiera autenticado lee, solo administrador escribe).

import { supabase } from './supabase';
import type { TamanoModal } from '../components/ManijaRedimension';

export async function obtenerTamanoModal(clave: string, porDefecto: TamanoModal): Promise<TamanoModal> {
  const { data } = await supabase.from('configuracion_tamano_modal').select('ancho_px, alto_px').eq('clave', clave).maybeSingle();
  return data ? { ancho: data.ancho_px, alto: data.alto_px } : porDefecto;
}

export async function guardarTamanoModal(clave: string, t: TamanoModal): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from('configuracion_tamano_modal').upsert({
    clave,
    ancho_px: t.ancho,
    alto_px: t.alto,
    actualizado_en: new Date().toISOString(),
    actualizado_por: user?.id ?? null,
  });
}
