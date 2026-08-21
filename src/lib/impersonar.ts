// "Entrar como" un supervisor u operador real desde la sesión del administrador (ver
// Users.tsx botón "🎭 Entrar como" y Edge Function impersonate-user). supabase-js solo mantiene
// UNA sesión activa a la vez en el navegador — no hay forma de tener la del administrador y la
// de la otra persona en paralelo — por eso antes de cambiar se guarda la sesión del
// administrador en localStorage, para poder restaurarla con volverAAdministrador().

import { supabase } from './supabase';
import { mensajeErrorFuncion } from './edgeFunctions';

const CLAVE_SESION_ADMIN = 'ebar_impersonando_sesion_admin';

/** ¿Hay una sesión de administrador guardada esperando a que se vuelva? */
export function estaImpersonando(): boolean {
  return localStorage.getItem(CLAVE_SESION_ADMIN) !== null;
}

// Si se cierra sesión (botón "Salir") mientras se está "como" otra persona, en vez de usar
// "Volver a ser administrador", la sesión guardada quedaría atascada en el navegador — la
// llama AuthContext.logout() para descartarla siempre, haya o no una guardada.
export function descartarSesionGuardada() {
  localStorage.removeItem(CLAVE_SESION_ADMIN);
}

export async function entrarComo(usuarioId: string): Promise<{ error?: string }> {
  const { data: sesionActual } = await supabase.auth.getSession();
  if (!sesionActual.session) return { error: 'No hay sesión activa.' };

  // Se refresca el token a propósito antes de invocar la función: si la sesión del administrador
  // venía con el token de acceso vencido o a punto de vencer (ej. la pestaña estuvo mucho tiempo
  // en segundo plano y el refresco automático no llegó a dispararse), la Edge Function la rechaza
  // con "No autorizado." aunque en el navegador se siga viendo como sesión iniciada.
  // refreshSession() fuerza un token nuevo usando el refresh_token, que dura mucho más.
  const { data: refrescada, error: errorRefresh } = await supabase.auth.refreshSession();
  if (errorRefresh || !refrescada.session) {
    return { error: 'Tu sesión venció — cierra sesión y vuelve a entrar antes de intentar "Entrar como" de nuevo.' };
  }

  const { data, error } = await supabase.functions.invoke('impersonate-user', {
    body: { usuario_id: usuarioId },
  });
  if (error) return { error: await mensajeErrorFuncion(error) };
  if (data?.error) return { error: data.error };

  // Se guarda ANTES de cambiar de sesión (verifyOtp reemplaza la sesión actual en el navegador) —
  // la recién refrescada, no la de antes (esa ya rotó y dejó de servir al refrescar arriba).
  localStorage.setItem(
    CLAVE_SESION_ADMIN,
    JSON.stringify({
      access_token: refrescada.session.access_token,
      refresh_token: refrescada.session.refresh_token,
    }),
  );

  // Solo token_hash + type: Supabase rechaza la llamada si además se manda `email` junto con
  // token_hash ("Only the token_hash and type should be provided") — son dos formas alternativas
  // de verificar (token_hash solo, o email + token de 6 dígitos), no se combinan.
  const { error: errorOtp } = await supabase.auth.verifyOtp({
    token_hash: data.token_hash,
    type: 'magiclink',
  });
  if (errorOtp) {
    localStorage.removeItem(CLAVE_SESION_ADMIN);
    return { error: errorOtp.message };
  }
  return {};
}

export async function volverAAdministrador(): Promise<{ error?: string }> {
  const guardada = localStorage.getItem(CLAVE_SESION_ADMIN);
  if (!guardada) return { error: 'No hay una sesión de administrador guardada.' };
  localStorage.removeItem(CLAVE_SESION_ADMIN);
  const { access_token, refresh_token } = JSON.parse(guardada);
  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) return { error: error.message };
  return {};
}
