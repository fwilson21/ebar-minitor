// supabase/functions/create-user/index.ts
//
// Invita a un nuevo usuario (operador/supervisor/administrador) por correo.
// Solo puede ser invocada por un administrador autenticado: se verifica el
// JWT de quien llama contra la tabla `usuarios` antes de usar la service role
// key para crear la cuenta. El usuario recibe un correo de invitación de
// Supabase Auth para establecer su propia contraseña.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';

interface Payload {
  email: string;
  nombre_completo: string;
  rol?: 'operador' | 'supervisor' | 'administrador';
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

    // Cliente con el JWT de quien llama, para verificar su identidad y rol.
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
      return json({ error: 'Solo un administrador puede crear usuarios.' }, 403);
    }

    const { email, nombre_completo, rol }: Payload = await req.json();
    if (!email || !nombre_completo) {
      return json({ error: 'Correo y nombre completo son requeridos.' }, 400);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    const { data: invitado, error: errorInvitar } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { nombre_completo },
    });
    if (errorInvitar) return json({ error: errorInvitar.message }, 400);

    // El trigger handle_new_auth_user crea la fila en `usuarios` con rol 'operador' por defecto.
    if (rol && rol !== 'operador') {
      await supabaseAdmin.from('usuarios').update({ rol }).eq('id', invitado.user.id);
    }

    return json({ ok: true, id: invitado.user.id });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
