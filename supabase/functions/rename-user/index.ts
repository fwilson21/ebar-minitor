// supabase/functions/rename-user/index.ts
//
// Permite a un administrador cambiar el nombre de usuario (login) de una
// cuenta ya creada. A diferencia de editar la columna `usuarios.nombre_usuario`
// directamente (que es solo un campo informativo para mostrar en la app), esta
// función actualiza el correo interno real en Supabase Auth
// (`usuario@ebar-monitor.local`), que es lo que de verdad se usa para iniciar
// sesión — y de paso mantiene sincronizado `nombre_usuario`.
// Solo aplica a cuentas creadas desde la app (correo con el dominio ficticio);
// no permite renombrar cuentas viejas con correo real (ej. el primer
// administrador), para no romper su acceso por error.
// Solo puede ser invocada por un administrador autenticado.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';

const DOMINIO_USUARIO_INTERNO = 'ebar-monitor.local';

interface Payload {
  usuario_id: string;
  nuevo_usuario: string;
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
      return json({ error: 'Solo un administrador puede cambiar nombres de usuario.' }, 403);
    }

    const { usuario_id, nuevo_usuario: nuevoUsuario }: Payload = await req.json();
    if (!usuario_id || !nuevoUsuario) {
      return json({ error: 'usuario_id y nuevo_usuario son requeridos.' }, 400);
    }
    if (!/^[a-z0-9._-]{3,30}$/.test(nuevoUsuario)) {
      return json({ error: 'El usuario debe tener 3-30 caracteres: minúsculas, números, puntos, guiones o guiones bajos.' }, 400);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    const { data: cuentaActual, error: errorGet } = await supabaseAdmin.auth.admin.getUserById(usuario_id);
    if (errorGet || !cuentaActual.user) return json({ error: 'No se encontró la cuenta.' }, 404);
    if (!cuentaActual.user.email?.endsWith(`@${DOMINIO_USUARIO_INTERNO}`)) {
      return json({ error: 'Esta cuenta usa un correo real (no se creó desde "+ Crear usuario") — no se puede renombrar así.' }, 400);
    }

    const nuevoEmail = `${nuevoUsuario}@${DOMINIO_USUARIO_INTERNO}`;
    const { error: errorRenombrar } = await supabaseAdmin.auth.admin.updateUserById(usuario_id, {
      email: nuevoEmail,
      email_confirm: true,
    });
    if (errorRenombrar) {
      const yaExiste = errorRenombrar.message.toLowerCase().includes('already registered');
      return json({ error: yaExiste ? `Ya existe un usuario "${nuevoUsuario}".` : errorRenombrar.message }, 400);
    }

    await supabaseAdmin.from('usuarios').update({ nombre_usuario: nuevoUsuario }).eq('id', usuario_id);

    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
