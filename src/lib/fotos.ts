import { supabase } from './supabase';
import type { VisitaParaReporte } from './pdf';

/**
 * Elimina el registro de una foto ya subida (no borra el archivo de Drive,
 * solo el registro en la BD). Requiere confirmación previa del usuario y
 * conexión a internet.
 */
export async function eliminarFotoGuardada(fotoId: string): Promise<{ ok: boolean; error?: string }> {
  if (!navigator.onLine) {
    return { ok: false, error: 'Necesitas conexión a internet para eliminar una foto ya guardada.' };
  }
  const { error } = await supabase.from('fotos').delete().eq('id', fotoId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Google Drive no permite embeber directamente el link "view" que devuelve
 * la subida (https://drive.google.com/file/d/ID/view) como <img src> ni como
 * imagen en un PDF; hace falta un link directo a la imagen.
 *
 * OJO: `https://drive.google.com/thumbnail?id=...` NO sirve para `fetch()` desde
 * el navegador — redirige primero a través de una respuesta intermedia sin
 * cabecera CORS, así que el navegador bloquea toda la cadena (aunque el destino
 * final sí tenga CORS, y aunque `curl` no lo detecte porque no aplica CORS).
 * `https://lh3.googleusercontent.com/d/{ID}=w1000` sí responde directo (sin
 * redirecciones) con `Access-Control-Allow-Origin: *`, y sirve igual para
 * mostrar en <img> y para descargar con `fetch` (necesario para los PDF).
 * Requiere que el archivo esté compartido "cualquiera con el enlace".
 */
export function urlMiniaturaDrive(driveFileId?: string | null, urlPublica?: string | null): string | undefined {
  if (driveFileId) return `https://lh3.googleusercontent.com/d/${driveFileId}=w1000`;
  return urlPublica ?? undefined;
}

/**
 * Descarga una imagen y la convierte a data URI base64, para embeberla en un PDF con pdfmake.
 * Si Google responde 429 (demasiadas peticiones) se rinde de inmediato para esa foto sin
 * reintentar — reintentar rápido solo empeora el límite de tasa; mejor que falte una foto
 * a que el reporte se vuelva lento o siga golpeando un límite ya activado.
 */
const MESES_ABREV = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function formatearFechaHoraFoto(fechaISO: string): string {
  const d = new Date(fechaISO);
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = MESES_ABREV[d.getMonth()];
  const horas = String(d.getHours()).padStart(2, '0');
  const minutos = String(d.getMinutes()).padStart(2, '0');
  return `${dia}-${mes}-${d.getFullYear()} ${horas}:${minutos}`;
}

export function esMismoDia(fechaISOa: string, fechaISOb: string): boolean {
  const a = new Date(fechaISOa);
  const b = new Date(fechaISOb);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Dibuja la fecha/hora de captura en la esquina inferior de la foto (evidencia visual
 * de cuándo se tomó, para que no se puedan reutilizar fotos de otro día en una visita).
 */
export async function estamparFechaEnFoto(archivo: Blob, fechaISO: string): Promise<Blob> {
  try {
    const texto = formatearFechaHoraFoto(fechaISO);
    const bitmap = await createImageBitmap(archivo);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return archivo;
    ctx.drawImage(bitmap, 0, 0);

    const fontSize = Math.max(16, Math.round(canvas.width * 0.035));
    ctx.font = `bold ${fontSize}px sans-serif`;
    const paddingX = fontSize * 0.6;
    const paddingY = fontSize * 0.5;
    const anchoTexto = ctx.measureText(texto).width;
    const cajaAncho = anchoTexto + paddingX * 2;
    const cajaAlto = fontSize + paddingY * 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(canvas.width - cajaAncho, canvas.height - cajaAlto, cajaAncho, cajaAlto);
    ctx.fillStyle = '#FFFFFF';
    ctx.textBaseline = 'middle';
    ctx.fillText(texto, canvas.width - cajaAncho + paddingX, canvas.height - cajaAlto / 2);

    return await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b ?? archivo), 'image/jpeg', 0.9);
    });
  } catch {
    return archivo;
  }
}

/**
 * Ejecuta `tarea` sobre cada elemento de `items` con un máximo de `concurrencia` a la vez
 * (ni todo secuencial —muy lento— ni todo en paralelo —satura el CDN de Google y dispara 429—).
 */
async function enParalelo<T, R>(items: T[], concurrencia: number, tarea: (item: T) => Promise<R>): Promise<R[]> {
  const resultados: R[] = new Array(items.length);
  let indice = 0;
  async function trabajador() {
    while (indice < items.length) {
      const i = indice++;
      resultados[i] = await tarea(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrencia, items.length) }, trabajador));
  return resultados;
}

/**
 * Descarga las fotos de cada visita y las convierte a base64 para poder embeberlas en el PDF.
 * Se convierten TODAS (cada subcategoría del reporte muestra sus propias fotos, ya no hay un
 * único bloque de "máx. 3 fotos" al final) con concurrencia limitada para no saturar el CDN.
 */
export async function incrustarFotosVisitas(visitas: VisitaParaReporte[]): Promise<VisitaParaReporte[]> {
  const resultado: VisitaParaReporte[] = [];
  for (const v of visitas) {
    if (!v.fotos?.length) {
      resultado.push(v);
      continue;
    }
    const convertidas = await enParalelo(v.fotos, 4, async (foto) => {
      const b64 = await urlAImagenBase64(foto.url);
      return b64 ? { url: b64, etiqueta: foto.etiqueta } : null;
    });
    const fotosValidas: NonNullable<VisitaParaReporte['fotos']> = [];
    for (const f of convertidas) if (f) fotosValidas.push(f);
    resultado.push({ ...v, fotos: fotosValidas });
  }
  return resultado;
}

export async function urlAImagenBase64(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn(`No se pudo descargar la foto para el PDF (${resp.status} ${resp.statusText}): ${url}`);
      return null;
    }
    const blob = await resp.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
