import Dexie, { type Table } from 'dexie';
import type { VisitaInput } from './types';

// ----------------------------------------------------------------------------
// Base de datos local (IndexedDB), accesible tanto desde la página como desde
// el service worker (sw.ts) — necesario para poder sincronizar visitas
// pendientes en segundo plano (Background Sync) sin depender de que la
// pestaña esté abierta.
// ----------------------------------------------------------------------------

export interface VisitaPendiente {
  cliente_uuid: string;
  payload: VisitaInput;
  intentos: number;
  ultimo_error?: string;
  creado_en: string;
  /** Si está presente, esta entrada es una edición de una visita ya existente (no una nueva). */
  visita_id?: string;
}

// Borrador de una visita en curso: el operador puede pausar el registro (ej. para
// ir a limpiar válvulas sin el celular) y continuar más tarde donde quedó, en el
// mismo dispositivo. Se guarda TODO el estado del formulario (incluidas fotos ya
// tomadas, como Blob) — no es lo mismo que `visitas_pendientes`, que es una visita
// ya finalizada esperando sincronizar con el servidor.
export interface BorradorVisita {
  clave: string; // `visita:${estacion_id}:${visita_id ?? 'nueva'}`
  estacion_id: string;
  visita_id?: string;
  actualizado_en: string;
  datos: unknown;
}

// Copia de la sesión de Supabase Auth (access/refresh token). El service worker no tiene
// acceso a localStorage (donde vive la sesión real de supabase-js), así que se mantiene
// esta copia en IndexedDB para que la sincronización en segundo plano pueda autenticarse.
export interface SesionEspejo {
  clave: 'actual';
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch en segundos, igual que lo entrega Supabase Auth
}

// Clave/valor simple para datos del dispositivo que deben sobrevivir un borrado de localStorage
// (en iPhone el navegador lo limpia con relativa frecuencia). Hoy solo guarda el identificador
// del dispositivo (ver dispositivo.ts).
export interface ValorDispositivo {
  clave: string;
  valor: string;
}

class OfflineDB extends Dexie {
  visitas_pendientes!: Table<VisitaPendiente, string>;
  borradores_visita!: Table<BorradorVisita, string>;
  sesion!: Table<SesionEspejo, string>;
  config_dispositivo!: Table<ValorDispositivo, string>;

  constructor() {
    super('ebar_monitor_offline');
    this.version(1).stores({
      visitas_pendientes: 'cliente_uuid, creado_en',
    });
    this.version(2).stores({
      visitas_pendientes: 'cliente_uuid, creado_en',
      borradores_visita: 'clave, actualizado_en',
    });
    this.version(3).stores({
      visitas_pendientes: 'cliente_uuid, creado_en',
      borradores_visita: 'clave, actualizado_en',
      sesion: 'clave',
    });
    this.version(4).stores({
      visitas_pendientes: 'cliente_uuid, creado_en',
      borradores_visita: 'clave, actualizado_en',
      sesion: 'clave',
      config_dispositivo: 'clave',
    });
  }
}

export const offlineDB = new OfflineDB();

export async function guardarSesionEspejo(sesion: { access_token: string; refresh_token: string; expires_at?: number }) {
  await offlineDB.sesion.put({
    clave: 'actual',
    access_token: sesion.access_token,
    refresh_token: sesion.refresh_token,
    expires_at: sesion.expires_at ?? 0,
  });
}

export async function leerSesionEspejo(): Promise<SesionEspejo | undefined> {
  return offlineDB.sesion.get('actual');
}

export async function limpiarSesionEspejo() {
  await offlineDB.sesion.delete('actual');
}

export async function leerDeviceIdEspejo(): Promise<string | null> {
  const fila = await offlineDB.config_dispositivo.get('device_id');
  return fila?.valor ?? null;
}

export async function guardarDeviceIdEspejo(valor: string) {
  await offlineDB.config_dispositivo.put({ clave: 'device_id', valor });
}

export async function guardarBorradorVisita(clave: string, estacionId: string, visitaId: string | undefined, datos: unknown) {
  await offlineDB.borradores_visita.put({ clave, estacion_id: estacionId, visita_id: visitaId, datos, actualizado_en: new Date().toISOString() });
}

export async function obtenerBorradorVisita(clave: string): Promise<BorradorVisita | undefined> {
  return offlineDB.borradores_visita.get(clave);
}

export async function eliminarBorradorVisita(clave: string) {
  await offlineDB.borradores_visita.delete(clave);
}

export async function encolarVisita(payload: VisitaInput) {
  await offlineDB.visitas_pendientes.put({
    cliente_uuid: payload.cliente_uuid,
    payload,
    intentos: 0,
    creado_en: new Date().toISOString(),
  });
}

/** Encola la edición de una visita ya existente (identificada por su id real en la BD). */
export async function encolarEdicionVisita(visitaId: string, payload: VisitaInput) {
  await offlineDB.visitas_pendientes.put({
    cliente_uuid: payload.cliente_uuid,
    visita_id: visitaId,
    payload,
    intentos: 0,
    creado_en: new Date().toISOString(),
  });
}

export async function contarPendientes(): Promise<number> {
  return offlineDB.visitas_pendientes.count();
}

export async function obtenerPendientes(): Promise<VisitaPendiente[]> {
  return offlineDB.visitas_pendientes.orderBy('creado_en').toArray();
}
