// supabase/functions/delete-user/index.ts
//
// Permite a un administrador eliminar por completo la cuenta de un usuario
// (auth.users, con lo que en cascada se borra su fila en `usuarios`). Si esa
// persona ya tiene visitas registradas, `visitas.operador_id` tiene
// `on delete restrict` — la base de datos rechaza el borrado para no perder
// historial; en ese caso hay que usar "Desactivar" en vez de eliminar.
// No se puede eliminar la propia cuenta, ni al último administrador activo
// (para no quedar sin nadie que pueda administrar la app).
// Solo puede ser invocada por un administrador autenticado.

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

    const { data: perfil } = await supabaseCaller
      .from('usuarios')
      .select('rol')
      .eq('id', user.id)
      .single();

    if (perfil?.rol !== 'administrador') {
      return json({ error: 'Solo un administrador puede eliminar usuarios.' }, 403);
    }

    const { usuario_id: usuarioId }: Payload = await req.json();
    if (!usuarioId) return json({ error: 'usuario_id es requerido.' }, 400);

    if (usuarioId === user.id) {
      return json({ error: 'No podés eliminar tu propia cuenta.' }, 400);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    const { data: objetivo } = await supabaseAdmin
      .from('usuarios')
      .select('rol, activo')
      .eq('id', usuarioId)
      .single();

    if (objetivo?.rol === 'administrador' && objetivo.activo) {
      const { count } = await supabaseAdmin
        .from('usuarios')
        .select('id', { count: 'exact', head: true })
        .eq('rol', 'administrador')
        .eq('activo', true);
      if ((count ?? 0) <= 1) {
        return json({ error: 'No se puede eliminar: es el único administrador activo.' }, 400);
      }
    }

    const { error: errorDelete } = await supabaseAdmin.auth.admin.deleteUser(usuarioId);
    if (errorDelete) {
      const tieneHistorial = errorDelete.message.toLowerCase().includes('foreign key') || errorDelete.message.toLowerCase().includes('violates');
      return json(
        {
          error: tieneHistorial
            ? 'No se puede eliminar: esta persona tiene visitas u otros registros guardados. Usa "Desactivar" en su lugar para no perder el historial.'
            : errorDelete.message,
        },
        400,
      );
    }

    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
