import { supabase } from './supabase';
import type { VisitaParaReporte } from './pdf';
import type { FotoLocal } from './types';
import { generarUUID } from './uuid';

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
// Lado más largo al que se achica cualquier foto antes de procesarla — de sobra para
// documentación (se ve nítida en el PDF y a pantalla completa en el celular) pero evita que una
// foto de cámara a resolución nativa (12+ megapíxeles en cualquier celular actual) dispare un
// pico de memoria al decodificarla + dibujarla en un canvas del mismo tamaño. Causa real
// confirmada (2026-08-21) de que la app se cerraba de golpe justo al tomar una foto en un celular
// con poca RAM (Xiaomi HyperOS, 4GB) — Android mata la pestaña/app por memoria, perdiendo todo lo
// cargado en el formulario.
const LADO_MAXIMO_FOTO = 1600;

export async function estamparFechaEnFoto(
  archivo: Blob,
  fechaISO: string,
  corregirVolteoCamaraViva = false,
): Promise<Blob> {
  try {
    const texto = formatearFechaHoraFoto(fechaISO);
    // `resizeWidth` le pide al navegador que decodifique la imagen YA achicada, en vez de
    // decodificarla completa a su resolución nativa y recién después achicarla. Esto importaba
    // poco con cámaras de 12 MP, pero muchos Xiaomi (como el celular de 4GB de RAM donde se
    // confirmó este bug) traen sensores de 48-108 MP: decodificar esa foto completa puede pedir
    // cientos de MB de golpe, ANTES de llegar siquiera a la línea de abajo que la achica — el
    // achicado con `LADO_MAXIMO_FOTO` de por sí no alcanzaba a evitar ese pico porque llegaba
    // demasiado tarde, ya con la foto completa decodificada en memoria. Solo se fija el ancho (no
    // el alto) para no deformar la foto: el navegador calcula el otro lado manteniendo la
    // proporción original, y el achicado de abajo (que sí respeta el lado más largo) sigue
    // aplicando igual sobre este bitmap ya mucho más chico.
    // `imageOrientation: 'from-image'` respeta el tag EXIF de rotación cuando el archivo lo trae
    // (fotos de la cámara nativa, usada de respaldo si falla la cámara en vivo) — sin esto,
    // createImageBitmap ignora el EXIF y decodifica los píxeles tal cual vienen del sensor.
    const bitmap = await createImageBitmap(archivo, {
      resizeWidth: LADO_MAXIMO_FOTO,
      resizeQuality: 'medium',
      imageOrientation: 'from-image',
    });
    const escala = Math.min(1, LADO_MAXIMO_FOTO / Math.max(bitmap.width, bitmap.height));
    const anchoFoto = Math.round(bitmap.width * escala);
    const altoFoto = Math.round(bitmap.height * escala);

    // La cámara en vivo (CamaraFoto.tsx, getUserMedia + canvas) no lleva EXIF y en algunos
    // celulares entrega el cuadro acostado (más ancho que alto) aunque el operador sostenga el
    // celular en vertical — este forzado corrige ESE caso puntual. Solo debe aplicarse a fotos que
    // vinieron de la cámara en vivo (`corregirVolteoCamaraViva=true`, ver `crearFotoLocal`): las
    // fotos de la cámara nativa del celular (`<input capture>`) SÍ traen EXIF y ya quedaron bien
    // orientadas por `imageOrientation: 'from-image'` de arriba, incluidas las tomadas realmente en
    // horizontal a propósito — si a esas también se les aplicara este forzado, terminarían giradas
    // de lado en el informe (bug reportado por los operadores, 2026-08-31).
    const esHorizontal = corregirVolteoCamaraViva && anchoFoto > altoFoto;
    const canvas = document.createElement('canvas');
    canvas.width = esHorizontal ? altoFoto : anchoFoto;
    canvas.height = esHorizontal ? anchoFoto : altoFoto;
    const ctx = canvas.getContext('2d');
    if (!ctx) return archivo;
    if (esHorizontal) {
      // Antihorario (-90°): en las fotos donde se detectó este problema, el lado derecho del
      // cuadro acostado era el que debía terminar arriba. Si alguna vez sale al revés, cambiar el
      // signo de este ángulo (y el translate de abajo) es todo lo que hay que tocar.
      ctx.translate(0, canvas.height);
      ctx.rotate(-Math.PI / 2);
    }
    ctx.drawImage(bitmap, 0, 0, anchoFoto, altoFoto);
    bitmap.close?.(); // libera el bitmap decodificado apenas se copió al canvas, sin esperar al recolector de basura

    // El sello se dibuja DESPUÉS de rotar, ya sobre el lienzo vertical final (canvas.width/height
    // de acá abajo son los de la foto ya derecha) — así el texto queda horizontal y pegado a la
    // esquina inferior derecha tal como se ve la foto, no de lado.
    const fontSize = Math.max(16, Math.round(canvas.width * 0.035));
    ctx.setTransform(1, 0, 0, 1, 0, 0); // deshace la rotación de arriba: el sello no debe rotar
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
 * Arma un `FotoLocal` listo para agregar al estado del formulario a partir de un blob recién
 * capturado por `CamaraFoto` (cámara en vivo) — mismo patrón repetido antes en PhotoCapture.tsx,
 * EquipoSection.tsx y PumpForm.tsx, ahora centralizado acá. Siempre pide la corrección de volteo
 * (ver comentario en `estamparFechaEnFoto`): esta función es exclusiva de la cámara en vivo, que
 * es justamente la que puede necesitarla; el `<input capture>` de respaldo llama a
 * `estamparFechaEnFoto` directo, sin este flag.
 */
export async function crearFotoLocal(archivo: Blob, fechaISO: string): Promise<FotoLocal> {
  return {
    id: generarUUID(),
    blob: await estamparFechaEnFoto(archivo, fechaISO, true),
    tomada_en: fechaISO,
    estado_subida: 'pendiente',
  };
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
