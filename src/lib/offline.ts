import Dexie, { type Table } from 'dexie';
import { supabase } from './supabase';
import type { VisitaInput } from './types';

// ----------------------------------------------------------------------------
// Base de datos local (IndexedDB) para soportar el modo offline básico.
// Los operadores en campo a menudo pierden señal dentro de cámaras de bombeo
// o zonas rurales; toda visita se guarda primero aquí y se sincroniza cuando
// vuelve la conexión.
// ----------------------------------------------------------------------------

interface VisitaPendiente {
  cliente_uuid: string;
  payload: VisitaInput;
  intentos: number;
  ultimo_error?: string;
  creado_en: string;
}

class OfflineDB extends Dexie {
  visitas_pendientes!: Table<VisitaPendiente, string>;

  constructor() {
    super('ebar_monitor_offline');
    this.version(1).stores({
      visitas_pendientes: 'cliente_uuid, creado_en',
    });
  }
}

export const offlineDB = new OfflineDB();

export async function encolarVisita(payload: VisitaInput) {
  await offlineDB.visitas_pendientes.put({
    cliente_uuid: payload.cliente_uuid,
    payload,
    intentos: 0,
    creado_en: new Date().toISOString(),
  });
}

export async function contarPendientes(): Promise<number> {
  return offlineDB.visitas_pendientes.count();
}

/**
 * Intenta enviar todas las visitas pendientes al backend.
 * Usa `cliente_uuid` como clave de idempotencia (columna única en `visitas`)
 * para que reintentos no creen duplicados.
 */
export async function sincronizarPendientes(): Promise<{ ok: number; fallidas: number }> {
  const pendientes = await offlineDB.visitas_pendientes.toArray();
  let ok = 0;
  let fallidas = 0;

  for (const item of pendientes) {
    try {
      const { bombas, fotos, ...visita } = item.payload;

      const { data: visitaInsertada, error: errorVisita } = await supabase
        .from('visitas')
        .upsert(visita, { onConflict: 'cliente_uuid' })
        .select('id')
        .single();

      if (errorVisita) throw errorVisita;

      const registrosBombas = bombas.map((b) => ({
        ...b,
        visita_id: visitaInsertada.id,
      }));
      if (registrosBombas.length) {
        const { error: errorBombas } = await supabase
          .from('registros_bombas')
          .upsert(registrosBombas, { onConflict: 'visita_id,bomba_id' });
        if (errorBombas) throw errorBombas;
      }

      // Las fotos con blob pendiente se suben vía Edge Function `upload-to-drive`
      for (const foto of fotos) {
        if (foto.estado_subida === 'subida' || !foto.blob) continue;
        await subirFotoADrive(visitaInsertada.id, foto);
      }

      await offlineDB.visitas_pendientes.delete(item.cliente_uuid);
      ok += 1;
    } catch (err: any) {
      fallidas += 1;
      await offlineDB.visitas_pendientes.update(item.cliente_uuid, {
        intentos: item.intentos + 1,
        ultimo_error: err?.message ?? String(err),
      });
    }
  }

  return { ok, fallidas };
}

/**
 * Sube una foto a Google Drive a través de la Edge Function `upload-to-drive`.
 * La función recibe el archivo en base64 y devuelve el file_id / url pública de Drive,
 * que luego se inserta en la tabla `fotos`.
 */
async function subirFotoADrive(visitaId: string, foto: { id: string; blob?: Blob; descripcion?: string }) {
  if (!foto.blob) return;

  const { base64, contentType } = await prepararBlobParaSubida(foto.blob);

  const { data, error } = await supabase.functions.invoke('upload-to-drive', {
    body: {
      visita_id: visitaId,
      file_base64: base64,
      content_type: contentType,
      descripcion: foto.descripcion ?? null,
    },
  });

  if (error) throw error;
}

async function prepararBlobParaSubida(blob: Blob): Promise<{ base64: string; contentType: string }> {
  let blobParaSubir = blob;
  const contentType = blob.type || 'image/jpeg';

  if (contentType.startsWith('image/')) {
    const sizeMb = blob.size / (1024 * 1024);
    if (sizeMb > 1) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const imageBitmap = await createImageBitmap(blob);
        const maxWidth = 1200;
        const scale = Math.min(1, maxWidth / imageBitmap.width);
        canvas.width = Math.max(1, Math.floor(imageBitmap.width * scale));
        canvas.height = Math.max(1, Math.floor(imageBitmap.height * scale));
        ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);

        const comprimido = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, 'image/jpeg', 0.75);
        });

        if (comprimido) {
          blobParaSubir = comprimido;
        }
      }
    }
  }

  return {
    base64: await blobToBase64(blobParaSubir),
    contentType: blobParaSubir.type || contentType,
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]); // quitar el prefijo data:...;base64,
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Registra listeners para sincronizar automáticamente al recuperar conexión. */
export function iniciarAutoSincronizacion(onResultado?: (r: { ok: number; fallidas: number }) => void) {
  const intentar = async () => {
    if (!navigator.onLine) return;
    const pendientes = await contarPendientes();
    if (pendientes === 0) return;
    const resultado = await sincronizarPendientes();
    onResultado?.(resultado);
  };

  window.addEventListener('online', intentar);
  // también reintentar periódicamente por si la conexión es intermitente sin disparar el evento
  const interval = setInterval(intentar, 60_000);
  intentar();

  return () => {
    window.removeEventListener('online', intentar);
    clearInterval(interval);
  };
}
