// supabase/functions/upload-to-drive/index.ts
//
// Edge Function (Deno) que recibe una foto en base64 y la sube a Google Drive
// usando una cuenta de servicio (Service Account), organizándola en carpetas
// del tipo:  <ROOT>/<AAAA-MM-DD>/<codigo_estacion>/
//
// Variables de entorno necesarias (configurar con `supabase secrets set`):
//   GOOGLE_SERVICE_ACCOUNT_JSON   -> contenido completo del JSON de la cuenta de servicio
//   GOOGLE_DRIVE_ROOT_FOLDER_ID   -> ID de la carpeta raíz en Drive (compartida con la cuenta de servicio)
//   GOOGLE_DRIVE_WEBAPP_URL       -> URL de un Google Apps Script publicado como Web App
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY -> ya provistas automáticamente por Supabase
//
// IMPORTANTE: si no quieres entrar en Google Cloud Console, puedes usar la opción
// más simple con Google Apps Script: publica un script como Web App y deja su URL
// en GOOGLE_DRIVE_WEBAPP_URL. Si esa variable existe, se usa primero.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';

interface Payload {
  visita_id: string;
  file_base64: string;
  content_type: string;
  descripcion?: string | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body: Payload = await req.json();
    const { visita_id, file_base64, content_type } = body;

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Obtener datos de la visita para nombrar/organizar la carpeta correctamente.
    const { data: visita, error: visitaError } = await supabaseAdmin
      .from('visitas')
      .select('fecha_hora_llegada, estaciones_ebar ( codigo )')
      .eq('id', visita_id)
      .single();
    if (visitaError) throw visitaError;

    const fecha = (visita.fecha_hora_llegada as string).slice(0, 10);
    const codigoEstacion = (visita as any).estaciones_ebar?.codigo ?? 'SIN_CODIGO';

    const appsScriptUrl = Deno.env.get('GOOGLE_DRIVE_WEBAPP_URL');
    if (appsScriptUrl) {
      const resultado = await subirArchivoViaAppsScript(appsScriptUrl, {
        visita_id,
        file_base64,
        content_type,
        descripcion: body.descripcion ?? null,
      });
      await insertarRegistroFoto(supabaseAdmin, visita_id, {
        file_id: resultado.file_id,
        folder_id: resultado.folder_id,
        url_publica: resultado.url_publica,
        descripcion: body.descripcion ?? null,
      });
      return json(resultado);
    }

    const accessToken = await obtenerTokenAccesoGoogle();
    const rootFolderId = Deno.env.get('GOOGLE_DRIVE_ROOT_FOLDER_ID')!;

    const carpetaFecha = await obtenerOcrearCarpeta(accessToken, fecha, rootFolderId);
    const carpetaEstacion = await obtenerOcrearCarpeta(accessToken, codigoEstacion, carpetaFecha);

    const nombreArchivo = `${visita_id}_${Date.now()}.jpg`;
    const archivo = await subirArchivo(accessToken, nombreArchivo, content_type, file_base64, carpetaEstacion);
    const resultado = {
      file_id: archivo.id,
      folder_id: carpetaEstacion,
      url_publica: `https://drive.google.com/file/d/${archivo.id}/view`,
    };

    await insertarRegistroFoto(supabaseAdmin, visita_id, {
      file_id: resultado.file_id,
      folder_id: resultado.folder_id,
      url_publica: resultado.url_publica,
      descripcion: body.descripcion ?? null,
    });

    return json(resultado);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

// ----------------------------------------------------------------------------
// Autenticación de la cuenta de servicio (JWT firmado con la clave privada del JSON)
// ----------------------------------------------------------------------------
async function subirArchivoViaAppsScript(url: string, payload: Payload): Promise<{ file_id: string; folder_id: string; url_publica: string }> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await resp.json();
  if (!resp.ok || !data?.file_id) {
    throw new Error(`No se pudo subir la foto vía Google Apps Script: ${JSON.stringify(data)}`);
  }

  return data;
}

async function insertarRegistroFoto(
  supabaseAdmin: any,
  visitaId: string,
  datos: { file_id: string; folder_id: string; url_publica: string; descripcion?: string | null },
) {
  const { error } = await supabaseAdmin.from('fotos').insert({
    visita_id: visitaId,
    drive_file_id: datos.file_id,
    drive_folder_id: datos.folder_id,
    url_publica: datos.url_publica,
    descripcion: datos.descripcion ?? null,
    estado_subida: 'subida',
  });

  if (error) throw error;
}

async function obtenerTokenAccesoGoogle(): Promise<string> {
  const serviceAccount = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')!);

  const ahora = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp: ahora + 3600,
    iat: ahora,
  };

  const enc = (obj: unknown) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const sinFirmar = `${enc(header)}.${enc(claim)}`;

  const clave = await importarClavePrivada(serviceAccount.private_key);
  const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', clave, new TextEncoder().encode(sinFirmar));
  const firmaB64 = btoa(String.fromCharCode(...new Uint8Array(firma)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const jwt = `${sinFirmar}.${firmaB64}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error(`No se pudo autenticar con Google: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function importarClavePrivada(pem: string): Promise<CryptoKey> {
  const pemBody = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s/g, '');
  const binario = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', binario, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

// ----------------------------------------------------------------------------
// Helpers de la API de Google Drive
// ----------------------------------------------------------------------------
async function obtenerOcrearCarpeta(token: string, nombre: string, padreId: string): Promise<string> {
  const query = encodeURIComponent(`name='${nombre}' and '${padreId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const buscar = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());

  if (buscar.files?.length) return buscar.files[0].id;

  const crear = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nombre, mimeType: 'application/vnd.google-apps.folder', parents: [padreId] }),
  }).then((r) => r.json());

  return crear.id;
}

async function subirArchivo(
  token: string,
  nombre: string,
  contentType: string,
  base64: string,
  carpetaId: string,
): Promise<{ id: string }> {
  const boundary = 'ebar_monitor_boundary';
  const metadata = { name: nombre, parents: [carpetaId] };
  const binario = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

  const cuerpo =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${contentType}\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64}\r\n` +
    `--${boundary}--`;

  const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: cuerpo,
  });
  return resp.json();
}
