// supabase/functions/send-whatsapp/index.ts
//
// Envía el PDF de un reporte por WhatsApp usando la WhatsApp Cloud API (Meta).
// Flujo: 1) subir el PDF como "media" a la Cloud API -> obtiene media_id
//        2) enviar un mensaje tipo "document" referenciando ese media_id
//
// Variables de entorno necesarias (`supabase secrets set`):
//   WHATSAPP_CLOUD_API_TOKEN   -> token permanente del System User de Meta
//   WHATSAPP_PHONE_NUMBER_ID   -> ID del número de WhatsApp Business emisor
//   WHATSAPP_DEFAULT_GROUP_ID  -> (opcional) ID del grupo/broadcast por defecto.
//        Nota: la Cloud API oficial de Meta NO envía a "grupos" de WhatsApp
//        normales (eso solo es posible con whatsapp-web.js u otras librerías
//        no oficiales). Para un grupo real, usa una lista de difusión o envía
//        individualmente a cada integrante del grupo/supervisión.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

interface Payload {
  destino: 'grupo' | 'supervisores';
  nombre_archivo: string;
  pdf_base64: string;
  mensaje: string;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { destino, nombre_archivo, pdf_base64, mensaje }: Payload = await req.json();

    const token = Deno.env.get('WHATSAPP_CLOUD_API_TOKEN')!;
    const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')!;

    const mediaId = await subirMediaWhatsApp(token, phoneNumberId, nombre_archivo, pdf_base64);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const destinatarios = await resolverDestinatarios(supabaseAdmin, destino);
    if (destinatarios.length === 0) {
      return new Response(JSON.stringify({ error: 'No hay destinatarios configurados.' }), { status: 400 });
    }

    const resultados = [];
    for (const numero of destinatarios) {
      const r = await enviarDocumento(token, phoneNumberId, numero, mediaId, nombre_archivo, mensaje);
      resultados.push({ numero, ok: r.ok });
    }

    return new Response(JSON.stringify({ enviados: resultados }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

async function resolverDestinatarios(supabaseAdmin: any, destino: 'grupo' | 'supervisores'): Promise<string[]> {
  if (destino === 'grupo') {
    const grupo = Deno.env.get('WHATSAPP_DEFAULT_GROUP_ID');
    return grupo ? [grupo] : [];
  }
  const { data } = await supabaseAdmin
    .from('usuarios')
    .select('whatsapp_numero')
    .in('rol', ['supervisor', 'administrador'])
    .not('whatsapp_numero', 'is', null);
  return (data ?? []).map((u: any) => u.whatsapp_numero).filter(Boolean);
}

async function subirMediaWhatsApp(token: string, phoneNumberId: string, nombre: string, base64: string): Promise<string> {
  const binario = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', new Blob([binario], { type: 'application/pdf' }), nombre);

  const resp = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await resp.json();
  if (!data.id) throw new Error(`Error subiendo media a WhatsApp: ${JSON.stringify(data)}`);
  return data.id;
}

async function enviarDocumento(
  token: string,
  phoneNumberId: string,
  destinatario: string,
  mediaId: string,
  nombreArchivo: string,
  caption: string,
): Promise<Response> {
  return fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: destinatario,
      type: 'document',
      document: { id: mediaId, filename: nombreArchivo, caption },
    }),
  });
}
