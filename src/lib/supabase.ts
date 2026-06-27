import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim() || 'https://example.supabase.co';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || 'dummy-anon-key';
const configurado = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

if (!configurado) {
  // eslint-disable-next-line no-console
  console.warn(
    'Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copia .env.example a .env y completa tus credenciales.'
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export function estaConfiguradoSupabase() {
  return configurado && url !== 'https://example.supabase.co' && anonKey !== 'dummy-anon-key';
}
