// supabase/functions/create-user/index.ts
//
// Crea un nuevo usuario (operador/supervisor/administrador) con la contraseña
// que define el administrador al momento de crearlo — no se envía correo de
// invitación (la entrega de correos a Hotmail/Outlook resultó poco confiable,
// ver notas del proyecto). Los usuarios no tienen correo real: Supabase Auth
// exige un "email" internamente, así que se construye uno ficticio a partir
// del nombre de usuario (ej. "jperez" -> "jperez@ebar-monitor.local"). El
// usuario puede cambiar su contraseña luego desde la app; si la olvida, el
// administrador se la puede restablecer desde Usuarios (ver Edge Function
// reset-user-password).
// Solo puede ser invocada por un administrador autenticado: se verifica el
// JWT de quien llama contra la tabla `usuarios` antes de usar la service role
// key para crear la cuenta.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';

const DOMINIO_USUARIO_INTERNO = 'ebar-monitor.local';

interface Payload {
  usuario: string;
  nombre_completo: string;
  password: string;
  cedula: string;
  cargo: string;
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

    const { usuario: nombreUsuario, nombre_completo, password, cedula, cargo, rol }: Payload = await req.json();
    if (!nombreUsuario || !nombre_completo || !password || !cedula || !cargo) {
      return json({ error: 'Usuario, nombre completo, contraseña, cédula y cargo son requeridos.' }, 400);
    }
    if (!/^[a-z0-9._-]{3,30}$/.test(nombreUsuario)) {
      return json({ error: 'El usuario debe tener 3-30 caracteres: minúsculas, números, puntos, guiones o guiones bajos.' }, 400);
    }
    if (password.length < 6) {
      return json({ error: 'La contraseña debe tener al menos 6 caracteres.' }, 400);
    }
    if (!/^\d{10}$/.test(cedula)) {
      return json({ error: 'La cédula debe tener 10 dígitos numéricos.' }, 400);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);
    const email = `${nombreUsuario}@${DOMINIO_USUARIO_INTERNO}`;

    const { data: creado, error: errorCrear } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre_completo },
    });
    if (errorCrear) {
      const yaExiste = errorCrear.message.toLowerCase().includes('already registered');
      return json({ error: yaExiste ? `Ya existe un usuario "${nombreUsuario}".` : errorCrear.message }, 400);
    }

    // El trigger handle_new_auth_user crea la fila en `usuarios` con rol 'operador' por defecto;
    // acá se completa el nombre de usuario (para poder mostrarlo luego en la pantalla de Usuarios),
    // la cédula, el cargo, y se ajusta el rol si no es el operador por defecto.
    const { error: errorActualizar } = await supabaseAdmin
      .from('usuarios')
      .update({ nombre_usuario: nombreUsuario, cedula, cargo, ...(rol && rol !== 'operador' ? { rol } : {}) })
      .eq('id', creado.user.id);
    if (errorActualizar) {
      const cedulaDuplicada = errorActualizar.message.toLowerCase().includes('cedula');
      return json(
        { error: cedulaDuplicada ? `Ya existe un usuario con la cédula ${cedula}.` : errorActualizar.message },
        400,
      );
    }

    return json({ ok: true, id: creado.user.id });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
