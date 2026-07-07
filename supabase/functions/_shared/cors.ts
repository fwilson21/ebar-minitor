// Cabeceras CORS compartidas por las Edge Functions invocadas desde el navegador
// (vía `supabase.functions.invoke(...)`). Sin esto, la petición de verificación
// `OPTIONS` que envía el navegador antes de la petición real es rechazada y
// aparece como "Failed to send a request to the Edge Function" en el cliente.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
