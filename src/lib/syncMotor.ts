import { offlineDB, type VisitaPendiente } from './offlineDB';
import type { FotoLocal } from './types';

// ----------------------------------------------------------------------------
// Lógica de sincronización de visitas pendientes, compartida entre el hilo
// principal (página, botón "Sincronizar ahora", reintentos en primer plano)
// y el service worker (Background Sync, en segundo plano en Android). Todo lo
// que NO depende de cómo se habla con Supabase vive acá; lo que sí depende
// (autenticación, cliente HTTP) se recibe como `AdaptadorSync` — dos
// implementaciones distintas en offline.ts (supabase-js, hilo principal) y
// sw.ts (fetch crudo + token espejado, service worker).
// ----------------------------------------------------------------------------

/** Puntos de contacto con el backend que difieren entre el hilo principal y el service worker. */
export interface AdaptadorSync {
  /** Crea o actualiza (por cliente_uuid) una visita nueva. Devuelve el id real asignado. */
  upsertVisitaNueva(visita: Record<string, unknown>, clienteUuid: string): Promise<string>;
  /** Actualiza una visita ya existente (modo edición). */
  actualizarVisita(visitaId: string, visita: Record<string, unknown>): Promise<void>;
  upsertRegistrosBombas(registros: Record<string, unknown>[]): Promise<void>;
  /** Solo aplica en modo edición: borra registros de bombas que quedaron deseleccionadas. */
  borrarRegistrosBombasNoSeleccionados(visitaId: string, idsSeleccionados: string[]): Promise<void>;
  subirFotoADrive(visitaId: string, datos: { base64: string; contentType: string; descripcion?: string | null }): Promise<void>;
}

export async function ejecutarSincronizacion(adaptador: AdaptadorSync): Promise<{ ok: number; fallidas: number }> {
  const pendientes = await offlineDB.visitas_pendientes.toArray();
  let ok = 0;
  let fallidas = 0;

  for (const item of pendientes) {
    try {
      await sincronizarUnaVisita(item, adaptador);
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

async function sincronizarUnaVisita(item: VisitaPendiente, adaptador: AdaptadorSync): Promise<void> {
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
    await adaptador.actualizarVisita(item.visita_id, { ...visita, ...equiposParaBD });
    visitaId = item.visita_id;
  } else {
    visitaId = await adaptador.upsertVisitaNueva({ ...visita, ...equiposParaBD }, item.cliente_uuid);
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
    await adaptador.upsertRegistrosBombas(registrosBombas);
  }
  // Al editar: si el operador deseleccionó una bomba que antes tenía registro
  // (ver selector en VisitForm), el upsert de arriba no la toca — hay que
  // borrar explícitamente su fila para que no siga apareciendo en reportes.
  if (item.visita_id) {
    await adaptador.borrarRegistrosBombasNoSeleccionados(visitaId, registrosBombas.map((b) => b.bomba_id));
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
  // lista y se suben en paralelo (con tope de concurrencia): con muchas fotos (una visita
  // completa puede tener 20-30) el cuello de botella es la latencia de cada ida y vuelta a la
  // Edge Function, no el ancho de banda.
  const fotosPorSubir: Array<{ foto: FotoLocal; descripcion?: string }> = [
    ...fotos.map((foto) => ({ foto, descripcion: undefined })),
    ...seccionesEquipo.flatMap(({ datos, nombre }) =>
      datos ? datos.fotos.map((foto) => ({ foto, descripcion: nombre })) : []
    ),
    ...bombas.flatMap((b) => (b.fotos ?? []).map((foto) => ({ foto, descripcion: `bomba_${b.numero_bomba}` }))),
  ].filter(({ foto }) => foto.estado_subida !== 'subida' && foto.blob);

  await subirEnParalelo(fotosPorSubir, 4, async ({ foto, descripcion }) => {
    if (!foto.blob) return;
    const { base64, contentType } = await prepararBlobParaSubida(foto.blob);
    await adaptador.subirFotoADrive(visitaId, { base64, contentType, descripcion: descripcion ?? null });
  });
}

/** Ejecuta `tarea` sobre cada elemento de `items` con un máximo de `concurrencia` a la vez. */
export async function subirEnParalelo<T>(items: T[], concurrencia: number, tarea: (item: T) => Promise<void>): Promise<void> {
  let indice = 0;
  async function trabajador() {
    while (indice < items.length) {
      await tarea(items[indice++]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrencia, items.length) }, trabajador));
}

/**
 * Comprime (si hace falta) y convierte una foto a base64 antes de subirla. Usa `OffscreenCanvas`
 * (no `document.createElement('canvas')`) a propósito: esta función corre tanto en la página
 * como dentro del service worker (Background Sync), y `document` no existe ahí.
 */
export async function prepararBlobParaSubida(blob: Blob): Promise<{ base64: string; contentType: string }> {
  let blobParaSubir = blob;
  const contentType = blob.type || 'image/jpeg';

  if (contentType.startsWith('image/')) {
    const sizeMb = blob.size / (1024 * 1024);
    if (sizeMb > 1) {
      const imageBitmap = await createImageBitmap(blob);
      const maxWidth = 1200;
      const scale = Math.min(1, maxWidth / imageBitmap.width);
      const ancho = Math.max(1, Math.floor(imageBitmap.width * scale));
      const alto = Math.max(1, Math.floor(imageBitmap.height * scale));

      const canvas = new OffscreenCanvas(ancho, alto);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(imageBitmap, 0, 0, ancho, alto);
        const comprimido = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
        if (comprimido) blobParaSubir = comprimido;
      }
    }
  }

  return {
    base64: await blobToBase64(blobParaSubir),
    contentType: blobParaSubir.type || contentType,
  };
}

// `FileReader` no está disponible en todos los navegadores dentro de un service worker; se usa
// `Blob.arrayBuffer()` (universal) en su lugar. El chunking evita "Maximum call stack size
// exceeded" al pasar un array grande a `String.fromCharCode` con fotos de varios MB.
async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binario = '';
  const TAMANO_BLOQUE = 0x8000;
  for (let i = 0; i < bytes.length; i += TAMANO_BLOQUE) {
    binario += String.fromCharCode(...bytes.subarray(i, i + TAMANO_BLOQUE));
  }
  return btoa(binario);
}
