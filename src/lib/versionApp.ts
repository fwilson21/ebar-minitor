import { supabase } from './supabase';

// ────────────────────────────────────────────────────────────────────────────
// Candado de versión de la app (PWA).
//
// La app se actualiza sola por el service worker, pero eso falla en dos casos:
//   1. el celular no abrió la app en días → nada corre;
//   2. la caché del navegador quedó atascada (ver memoria "PWA con caché
//      atascada") y `registro.update()` no la despega.
//
// Este módulo + GuardaVersion.tsx cierran el caso 2 y garantizan el caso 1 en
// la próxima apertura con señal: el administrador fija una versión mínima
// (tabla app_config, migración 0050) y todo cliente con un build anterior
// queda bloqueado con "Actualizar ahora" hasta que baje la nueva.
//
// Regla de oro: el candado NUNCA bloquea por un fallo de red. Un operador en
// una EBAR sin cobertura tiene que poder seguir trabajando.
// ────────────────────────────────────────────────────────────────────────────

/** Timestamp (ms) del build que está corriendo — lo incrusta vite.config.ts en
 * tiempo de compilación. En `npm run dev` es la hora de arranque del server.
 * 0 solo si el `define` de vite falló: en ese caso nunca se bloquea (no sabemos
 * qué versión somos). */
export const BUILD_ACTUAL: number = typeof __BUILD_TIME__ === 'number' ? __BUILD_TIME__ : 0;

/** Fecha legible de un build ("2 sept 2026, 14:30"). Se muestra en el pie de
 * página para poder preguntar por teléfono "¿qué versión te aparece abajo?". */
export function fechaLegibleBuild(ms: number = BUILD_ACTUAL): string {
  if (!ms) return 'desconocida';
  return new Date(ms).toLocaleString('es-EC', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

/** Lee el build mínimo aceptado de `app_config`. Devuelve null si no se pudo
 * (sin señal, tabla todavía sin crear, cualquier error) — quien llama debe
 * tratar null como "no bloquear". */
export async function consultarBuildMinimo(): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('build_minimo')
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) return null;
    const n = Number(data.build_minimo);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** ¿El build de este cliente es más viejo que el mínimo exigido? Con `minimo`
 * null (no se pudo consultar) o `BUILD_ACTUAL` 0 (no sabemos qué versión
 * somos) devuelve false: ante la duda, no se bloquea. */
export function buildEsObsoleto(minimo: number | null): boolean {
  return minimo != null && BUILD_ACTUAL > 0 && BUILD_ACTUAL < minimo;
}

/** Marca el build actual como el mínimo exigido a todos (solo administrador —
 * lo refuerza la política RLS de app_config). */
export async function exigirBuildActualATodos(actualizadoPor: string | undefined): Promise<{ error?: string }> {
  if (!BUILD_ACTUAL) return { error: 'Este build no tiene sello de versión; no se puede exigir.' };
  const { error } = await supabase
    .from('app_config')
    .update({
      build_minimo: BUILD_ACTUAL,
      actualizado_en: new Date().toISOString(),
      actualizado_por: actualizadoPor ?? null,
    })
    .eq('id', 1);
  return error ? { error: error.message } : {};
}

/** Desregistra el service worker, borra toda la Cache Storage y recarga desde
 * la red con un parámetro anti-caché. Equivale a "Borrar y restablecer" del
 * menú de Chrome, pero desde un botón.
 *
 * NO toca IndexedDB/Dexie: las visitas y fotos pendientes de sincronizar quedan
 * intactas y se envían solas después de actualizar. */
export async function forzarActualizacion(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registros = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registros.map((r) => r.unregister()));
    }
  } catch {
    // Da igual: lo que de verdad importa es la recarga anti-caché de abajo.
  }
  try {
    if ('caches' in window) {
      const claves = await caches.keys();
      await Promise.all(claves.map((c) => caches.delete(c)));
    }
  } catch {
    // idem.
  }
  // La URL con `?actualizado=<ahora>` no está precacheada, así que aunque un
  // resto del service worker viejo siga vivo un instante, esto baja de la red.
  window.location.replace(`${window.location.origin}/?actualizado=${Date.now()}`);
}
