import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_CONFIGURADO, SUPABASE_URL } from './supabaseConfig';

if (!SUPABASE_CONFIGURADO) {
  // eslint-disable-next-line no-console
  console.warn(
    'Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copia .env.example a .env y completa tus credenciales.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export function estaConfiguradoSupabase() {
  return SUPABASE_CONFIGURADO && SUPABASE_URL !== 'https://example.supabase.co' && SUPABASE_ANON_KEY !== 'dummy-anon-key';
}
