import { supabase } from './supabase';
import { CLAVE_CACHE_ESTACIONES, claveCacheBombas, guardarCacheLocal } from './cacheLocal';
import type { Bomba, EstacionEbar } from './types';

// ----------------------------------------------------------------------------
// Antes, la copia local de una EBAR (y de sus bombas) solo se guardaba la primera vez que ESA
// estación puntual se abría con señal — en Estaciones.tsx (la lista completa) para los datos de
// la estación, y en VisitForm.tsx (el formulario de "Nueva visita" de esa EBAR) para sus bombas.
// Los operadores reportaron 2 problemas de campo por esto:
//   1. No podían abrir una EBAR sin haber estado antes ahí CON señal — muchas EBAR están en zonas
//      sin cobertura nunca, así que esa primera vez con señal jamás llegaba a pasar.
//   2. Aunque una EBAR sí hubiera quedado guardada (porque alguna vez se abrió con señal), otra
//      EBAR distinta que nunca se había abierto antes seguía sin poder abrirse sin señal — se leía
//      como "ya guardé una y no me deja guardar otra", pero en realidad cada estación necesitaba
//      su propia visita previa con señal, no había ningún límite de "una sola a la vez".
// La solución: precargar TODAS las EBAR activas y TODAS sus bombas de una sola vez, apenas hay
// señal (al entrar a la app y cada vez que la conexión vuelve) — así cualquier EBAR ya se puede
// abrir sin conexión, la haya visitado antes o no, mientras el celular haya tenido señal en algún
// momento (en la oficina, en el camino, etc.), no necesariamente parado en esa EBAR puntual.
// ----------------------------------------------------------------------------

/** Descarga y guarda en el dispositivo todas las EBAR activas + sus bombas activas, agrupadas por
 * estación (misma clave por-estación que ya usaba VisitForm.tsx, así no hace falta tocar cómo se
 * leen). No hace nada si no hay conexión — se reintenta solo en el próximo disparador (ver
 * `iniciarPrecargaOffline`), no hace falta que este intento puntual tenga éxito. */
export async function precargarDatosOffline(): Promise<void> {
  if (!navigator.onLine) return;

  const { data: estaciones, error: errorEstaciones } = await supabase
    .from('estaciones_ebar')
    .select('*')
    .eq('activa', true)
    .order('nombre');
  if (errorEstaciones || !estaciones) return; // sin señal de verdad (u otro error) — sin problema, se reintenta después

  guardarCacheLocal(CLAVE_CACHE_ESTACIONES, estaciones as EstacionEbar[]);

  const { data: bombas } = await supabase
    .from('bombas')
    .select('*')
    .eq('activa', true)
    .in('estacion_id', estaciones.map((e) => e.id));

  // Se guarda un array (aunque quede vacío) por CADA estación activa, no solo por las que
  // tuvieron alguna bomba — así "esta EBAR no tiene bombas" (guardado a propósito) no se confunde
  // con "esta EBAR todavía no se precargó" (la clave ni existe).
  const porEstacion = new Map<string, Bomba[]>();
  for (const e of estaciones as EstacionEbar[]) porEstacion.set(e.id, []);
  for (const b of (bombas as Bomba[]) ?? []) {
    porEstacion.get(b.estacion_id)?.push(b);
  }
  for (const [estacionId, lista] of porEstacion) {
    guardarCacheLocal(claveCacheBombas(estacionId), lista);
  }
}

/** Dispara la precarga al entrar a la app y cada vez que vuelve la conexión — mismo patrón de
 * eventos que `iniciarAutoSincronizacion` en offline.ts (pero en sentido contrario: esto BAJA
 * datos frescos al dispositivo, sync sube las visitas pendientes). No hace falta reintentar por
 * intervalo: en cuanto haya señal de verdad, el evento `online` la dispara sola. */
export function iniciarPrecargaOffline(): () => void {
  precargarDatosOffline();
  const alVolverOnline = () => precargarDatosOffline();
  window.addEventListener('online', alVolverOnline);
  return () => window.removeEventListener('online', alVolverOnline);
}
