// supabase/functions/impersonate-user/index.ts
//
// Genera una sesión real de Supabase Auth para un supervisor u operador ya existente, para que
// el administrador pueda "entrar como" esa persona y probar exactamente lo que puede hacer (sus
// límites reales, no una simulación de pantalla). NO se puede usar para entrar como otro
// administrador. Usa auth.admin.generateLink (magic link) para no necesitar la contraseña real
// de la persona — el token generado se usa directo en el navegador del administrador (no se
// envía ningún correo). Deja un registro en `impersonaciones_log` (quién entró como quién y
// cuándo, ver migración 0029).
// Solo puede ser invocada por un administrador autenticado — a propósito NO acepta ninguno de
// los permisos de /permisos (crear/editar/activar-desactivar/restablecer/eliminar usuarios):
// dejar entrar-como a alguien que no es administrador real sería una forma de escalar
// privilegios, sin importar cuál de esos permisos tenga.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';

interface Payload {
  usuario_id: string;
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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'No autorizado.' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabaseCaller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await supabaseCaller.auth.getUser();
    if (!user) return json({ error: 'No autorizado.' }, 401);

    const { data: perfil } = await supabaseCaller.from('usuarios').select('rol').eq('id', user.id).single();
    if (perfil?.rol !== 'administrador') {
      return json({ error: 'Solo un administrador puede entrar como otro usuario.' }, 403);
    }

    const { usuario_id: usuarioId }: Payload = await req.json();
    if (!usuarioId) return json({ error: 'usuario_id es requerido.' }, 400);
    if (usuarioId === user.id) return json({ error: 'Ya estás en tu propia cuenta.' }, 400);

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    const { data: objetivo } = await supabaseAdmin.from('usuarios').select('rol, activo').eq('id', usuarioId).single();
    if (!objetivo) return json({ error: 'No se encontró ese usuario.' }, 404);
    if (objetivo.rol === 'administrador') {
      return json({ error: 'No se puede entrar como otro administrador.' }, 400);
    }
    if (!objetivo.activo) {
      return json({ error: 'Ese usuario está desactivado.' }, 400);
    }

    const { data: cuenta, error: errorGet } = await supabaseAdmin.auth.admin.getUserById(usuarioId);
    if (errorGet || !cuenta.user?.email) return json({ error: 'No se pudo obtener la cuenta.' }, 404);

    const { data: link, error: errorLink } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: cuenta.user.email,
    });
    if (errorLink || !link?.properties?.hashed_token) {
      return json({ error: errorLink?.message ?? 'No se pudo generar el acceso.' }, 500);
    }

    await supabaseAdmin.from('impersonaciones_log').insert({ admin_id: user.id, usuario_id: usuarioId });

    return json({ ok: true, email: cuenta.user.email, token_hash: link.properties.hashed_token });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
