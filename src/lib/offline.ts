import Dexie, { type Table } from 'dexie';
import { supabase } from './supabase';
import type { FotoLocal, VisitaInput } from './types';

// ----------------------------------------------------------------------------
// Base de datos local (IndexedDB) para soportar el modo offline básico.
// Los operadores en campo a menudo pierden señal dentro de cámaras de bombeo
// o zonas rurales; toda visita se guarda primero aquí y se sincroniza cuando
// vuelve la conexión.
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
      const {
        id: _idPayload, cliente_uuid: _clienteUuidPayload,
        bombas, fotos, lineas_impulsion, guias_izado, valvulas_compuerta, valvulas_check, valvula_aire,
        camara_rejilla, camara_valvula_compuerta,
        tablero_distribucion, variador,
        descarga_emergencia, tuberia_400_valvulas_aire, tuberia_400_uniones_elastomericas,
        tuberia_600_valvulas_aire, tuberia_600_uniones_elastomericas, cerramiento_seguridad,
        jardineras, patios_maniobras, ...visita
      } = item.payload;

      // Columnas JSONB: estado/observaciones/números afectados/tiene (las fotos van a la tabla fotos)
      const aJsonb = (eq: typeof lineas_impulsion) =>
        eq
          ? {
              estado: eq.estado,
              observaciones: eq.observaciones ?? null,
              numeros_afectados: eq.numeros_afectados ?? null,
              tiene: eq.tiene ?? null,
            }
          : null;
      const equiposParaBD = {
        lineas_impulsion: aJsonb(lineas_impulsion),
        guias_izado: aJsonb(guias_izado),
        valvulas_compuerta: aJsonb(valvulas_compuerta),
        valvulas_check: aJsonb(valvulas_check),
        valvula_aire: aJsonb(valvula_aire),
        camara_rejilla: aJsonb(camara_rejilla),
        camara_valvula_compuerta: aJsonb(camara_valvula_compuerta),
        tablero_distribucion: aJsonb(tablero_distribucion),
        variador: aJsonb(variador),
        descarga_emergencia: aJsonb(descarga_emergencia),
        tuberia_400_valvulas_aire: aJsonb(tuberia_400_valvulas_aire),
        tuberia_400_uniones_elastomericas: aJsonb(tuberia_400_uniones_elastomericas),
        tuberia_600_valvulas_aire: aJsonb(tuberia_600_valvulas_aire),
        tuberia_600_uniones_elastomericas: aJsonb(tuberia_600_uniones_elastomericas),
      };

      let visitaId: string;
      if (item.visita_id) {
        // Edición de una visita existente: actualizar por id real, sin tocar cliente_uuid.
        const { error: errorUpdate } = await supabase
          .from('visitas')
          .update({ ...visita, ...equiposParaBD })
          .eq('id', item.visita_id);
        if (errorUpdate) throw errorUpdate;
        visitaId = item.visita_id;
      } else {
        const { data: visitaInsertada, error: errorVisita } = await supabase
          .from('visitas')
          .upsert({ ...visita, cliente_uuid: item.cliente_uuid, ...equiposParaBD }, { onConflict: 'cliente_uuid' })
          .select('id')
          .single();
        if (errorVisita) throw errorVisita;
        visitaId = visitaInsertada.id;
      }

      const registrosBombas = bombas.map((b) => ({
        bomba_id: b.bomba_id,
        numero_bomba: b.numero_bomba,
        estado: b.estado,
        voltaje: b.voltaje,
        amperaje: b.amperaje,
        horas_operacion_acumuladas: b.horas_operacion_acumuladas,
        observaciones: b.observaciones,
        visita_id: visitaId,
      }));
      if (registrosBombas.length) {
        const { error: errorBombas } = await supabase
          .from('registros_bombas')
          .upsert(registrosBombas, { onConflict: 'visita_id,bomba_id' });
        if (errorBombas) throw errorBombas;
      }

      // Fotos de cada sección de equipo (descripcion identifica la sección en Drive)
      const seccionesEquipo = [
        { datos: lineas_impulsion, nombre: 'lineas_impulsion' },
        { datos: guias_izado, nombre: 'guias_izado' },
        { datos: valvulas_compuerta, nombre: 'valvulas_compuerta' },
        { datos: valvulas_check, nombre: 'valvulas_check' },
        { datos: valvula_aire, nombre: 'valvula_aire' },
        { datos: camara_rejilla, nombre: 'camara_rejilla' },
        { datos: camara_valvula_compuerta, nombre: 'camara_valvula_compuerta' },
        { datos: tablero_distribucion, nombre: 'tablero_distribucion' },
        { datos: variador, nombre: 'variador' },
        { datos: descarga_emergencia, nombre: 'descarga_emergencia' },
        { datos: tuberia_400_valvulas_aire, nombre: 'tuberia_400_valvulas_aire' },
        { datos: tuberia_400_uniones_elastomericas, nombre: 'tuberia_400_uniones_elastomericas' },
        { datos: tuberia_600_valvulas_aire, nombre: 'tuberia_600_valvulas_aire' },
        { datos: tuberia_600_uniones_elastomericas, nombre: 'tuberia_600_uniones_elastomericas' },
        { datos: cerramiento_seguridad, nombre: 'cerramiento_seguridad' },
        { datos: jardineras, nombre: 'jardineras' },
        { datos: patios_maniobras, nombre: 'patios_maniobras' },
      ] as const;

      // Se juntan todas las fotos pendientes (generales + por sección + por bomba) en una sola
      // lista y se suben en paralelo (con tope de concurrencia): antes se subían de a una en
      // serie, y con internet rápido pero muchas fotos (una visita completa puede tener 20-30)
      // el cuello de botella era la latencia de cada ida y vuelta a la Edge Function, no el ancho
      // de banda — subir 20 fotos secuenciales podía tardar más de medio minuto solo en eso.
      const fotosPorSubir: Array<{ foto: FotoLocal; descripcion?: string }> = [
        ...fotos.map((foto) => ({ foto, descripcion: undefined })),
        ...seccionesEquipo.flatMap(({ datos, nombre }) =>
          datos ? datos.fotos.map((foto) => ({ foto, descripcion: nombre })) : []
        ),
        ...bombas.flatMap((b) => (b.fotos ?? []).map((foto) => ({ foto, descripcion: `bomba_${b.numero_bomba}` }))),
      ].filter(({ foto }) => foto.estado_subida !== 'subida' && foto.blob);

      await subirEnParalelo(fotosPorSubir, 4, ({ foto, descripcion }) => subirFotoADrive(visitaId, { ...foto, descripcion }));

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

/** Ejecuta `tarea` sobre cada elemento de `items` con un máximo de `concurrencia` a la vez. */
async function subirEnParalelo<T>(items: T[], concurrencia: number, tarea: (item: T) => Promise<void>): Promise<void> {
  let indice = 0;
  async function trabajador() {
    while (indice < items.length) {
      await tarea(items[indice++]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrencia, items.length) }, trabajador));
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
