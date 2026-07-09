// supabase/functions/reset-user-password/index.ts
//
// Permite a un administrador restablecer la contraseña de un usuario ya
// existente (por ejemplo cuando la olvidó) sin depender del correo de
// recuperación de Supabase Auth, cuya entrega a Hotmail/Outlook resultó poco
// confiable (ver notas del proyecto). Solo puede ser invocada por un
// administrador autenticado: se verifica el JWT de quien llama contra la
// tabla `usuarios` antes de usar la service role key.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';

interface Payload {
  usuario_id: string;
  password: string;
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

    const { data: perfil } = await supabaseCaller
      .from('usuarios')
      .select('rol')
      .eq('id', user.id)
      .single();

    if (perfil?.rol !== 'administrador') {
      return json({ error: 'Solo un administrador puede restablecer contraseñas.' }, 403);
    }

    const { usuario_id, password }: Payload = await req.json();
    if (!usuario_id || !password) {
      return json({ error: 'usuario_id y password son requeridos.' }, 400);
    }
    if (password.length < 6) {
      return json({ error: 'La contraseña debe tener al menos 6 caracteres.' }, 400);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);
    const { error: errorUpdate } = await supabaseAdmin.auth.admin.updateUserById(usuario_id, { password });
    if (errorUpdate) return json({ error: errorUpdate.message }, 400);

    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
