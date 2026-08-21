import { supabase } from './supabase';
import { ejecutarSincronizacion, type AdaptadorSync } from './syncMotor';
import { mensajeErrorFuncion } from './edgeFunctions';

export {
  offlineDB,
  obtenerPendientes,
  guardarBorradorVisita,
  obtenerBorradorVisita,
  eliminarBorradorVisita,
  type VisitaPendiente,
  type BorradorVisita,
} from './offlineDB';

import {
  encolarVisita as encolarVisitaDB,
  encolarEdicionVisita as encolarEdicionVisitaDB,
  contarPendientes,
} from './offlineDB';
import type { VisitaInput } from './types';

export { contarPendientes };

// ----------------------------------------------------------------------------
// Sincronización de visitas pendientes (modo offline básico). Los operadores en
// campo a menudo pierden señal dentro de cámaras de bombeo o zonas rurales;
// toda visita se guarda primero en IndexedDB y se sincroniza cuando vuelve la
// conexión — en primer plano (este archivo, usando supabase-js) o en segundo
// plano en Android vía Background Sync (ver sw.ts, que reusa la misma lógica
// de syncMotor.ts con un adaptador basado en fetch crudo).
// ----------------------------------------------------------------------------

const TAG_SINCRONIZACION = 'sync-visitas';

/** Le pide al navegador que dispare una sincronización en segundo plano en cuanto haya señal,
 * incluso si el operador no vuelve a abrir la app (solo Android/Chrome — en el resto de
 * navegadores esto simplemente no hace nada, y sigue cubierto por `iniciarAutoSincronizacion`). */
async function pedirSincronizacionEnSegundoPlano() {
  if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;
  try {
    const registro = await navigator.serviceWorker.ready;
    await (registro as ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } }).sync.register(
      TAG_SINCRONIZACION,
    );
  } catch {
    // Background Sync no disponible o denegado: sin problema, los otros mecanismos
    // (evento 'online', reenfoque, intervalo) siguen cubriendo la sincronización.
  }
}

export async function encolarVisita(payload: VisitaInput) {
  await encolarVisitaDB(payload);
  await pedirSincronizacionEnSegundoPlano();
}

export async function encolarEdicionVisita(visitaId: string, payload: VisitaInput) {
  await encolarEdicionVisitaDB(visitaId, payload);
  await pedirSincronizacionEnSegundoPlano();
}

const adaptadorSupabase: AdaptadorSync = {
  async upsertVisitaNueva(visita, clienteUuid) {
    const { data, error } = await supabase
      .from('visitas')
      .upsert({ ...visita, cliente_uuid: clienteUuid }, { onConflict: 'cliente_uuid' })
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  },

  async actualizarVisita(visitaId, visita) {
    const { error } = await supabase.from('visitas').update(visita).eq('id', visitaId);
    if (error) throw error;
  },

  async upsertRegistrosBombas(registros) {
    const { error } = await supabase.from('registros_bombas').upsert(registros, { onConflict: 'visita_id,bomba_id' });
    if (error) throw error;
  },

  async borrarRegistrosBombasNoSeleccionados(visitaId, idsSeleccionados) {
    let borrado = supabase.from('registros_bombas').delete().eq('visita_id', visitaId);
    if (idsSeleccionados.length) {
      borrado = borrado.not('bomba_id', 'in', `(${idsSeleccionados.join(',')})`);
    }
    const { error } = await borrado;
    if (error) throw error;
  },

  async subirFotoADrive(visitaId, { base64, contentType, descripcion }) {
    const { error } = await supabase.functions.invoke('upload-to-drive', {
      body: { visita_id: visitaId, file_base64: base64, content_type: contentType, descripcion },
    });
    if (error) throw new Error(await mensajeErrorFuncion(error));
  },
};

/**
 * Intenta enviar todas las visitas pendientes al backend, desde el hilo principal (página
 * abierta), usando el cliente supabase-js normal. Usa `cliente_uuid` como clave de idempotencia
 * (columna única en `visitas`) para que reintentos no creen duplicados.
 */
export async function sincronizarPendientes(): Promise<{ ok: number; fallidas: number }> {
  return ejecutarSincronizacion(adaptadorSupabase);
}

/**
 * Registra listeners para sincronizar automáticamente al recuperar conexión, sin que el
 * operador tenga que tocar el botón "Sincronizar ahora" (ese botón queda solo como respaldo
 * manual). Además del evento `online`, se reintenta cuando la pestaña vuelve a primer plano
 * (`visibilitychange`/`focus`) — el navegador puede pausar o retrasar mucho el intervalo
 * mientras la pantalla está bloqueada o la app en segundo plano. En Android, la sincronización
 * real en segundo plano (sin que el operador mire el celular) la cubre Background Sync
 * (`pedirSincronizacionEnSegundoPlano` + `sw.ts`); esto de acá es el respaldo en primer plano
 * que además es lo único disponible en iPhone (no soporta Background Sync).
 */
export function iniciarAutoSincronizacion(onResultado?: (r: { ok: number; fallidas: number }) => void) {
  const intentar = async () => {
    if (!navigator.onLine) return;
    const pendientes = await contarPendientes();
    if (pendientes === 0) return;
    const resultado = await sincronizarPendientes();
    onResultado?.(resultado);
  };

  const alVolverVisible = () => {
    if (document.visibilityState === 'visible') intentar();
  };

  window.addEventListener('online', intentar);
  window.addEventListener('focus', intentar);
  document.addEventListener('visibilitychange', alVolverVisible);
  // también reintentar periódicamente por si la conexión es intermitente sin disparar el evento
  const interval = setInterval(intentar, 60_000);
  intentar();

  return () => {
    window.removeEventListener('online', intentar);
    window.removeEventListener('focus', intentar);
    document.removeEventListener('visibilitychange', alVolverVisible);
    clearInterval(interval);
  };
}
