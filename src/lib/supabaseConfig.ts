// Constantes compartidas entre el cliente supabase-js normal (supabase.ts, hilo principal) y el
// adaptador de fetch crudo del service worker (sw.ts, Background Sync) — ambos necesitan la
// misma URL/clave para hablar con el mismo proyecto de Supabase.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.trim() || 'https://example.supabase.co';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || 'dummy-anon-key';
export const SUPABASE_CONFIGURADO = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
