import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { obtenerIdDispositivo } from '../lib/dispositivo';
import type { Usuario } from '../lib/types';

interface AuthState {
  usuario: Usuario | null;
  cargando: boolean;
  login: (usuarioOCorreo: string, password: string) => Promise<{ error?: string }>;
  logout: () => Promise<void>;
}

// Los usuarios creados desde la app (ver Users.tsx) no tienen correo real: se
// autentican con un nombre de usuario al que se le agrega este dominio ficticio
// para satisfacer el modelo de Supabase Auth (que requiere un "email"). Las
// cuentas antiguas creadas con correo real (ej. el primer administrador) siguen
// funcionando igual: si lo que se ingresa ya tiene "@", se usa tal cual.
const DOMINIO_USUARIO_INTERNO = 'ebar-monitor.local';

// Guarda una copia del perfil del último usuario autenticado. Sirve para que, si la app se
// recarga sin señal (EBAR sin cobertura), el operador siga adentro en vez de que la consulta
// de perfil fallida (sin red) lo mande de vuelta al login — la sesión de Supabase Auth ya está
// guardada localmente y sigue siendo válida, solo faltaba no perder el perfil si no hay red.
const CLAVE_PERFIL_CACHE = 'ebar_perfil_cache';

function resolverEmailLogin(entrada: string): string {
  const valor = entrada.trim();
  return valor.includes('@') ? valor : `${valor.toLowerCase()}@${DOMINIO_USUARIO_INTERNO}`;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);

  async function cargarPerfil(userId: string) {
    const { data } = await supabase.from('usuarios').select('*').eq('id', userId).single();
    if (data) {
      setUsuario(data as Usuario);
      localStorage.setItem(CLAVE_PERFIL_CACHE, JSON.stringify(data));
      return;
    }
    // Sin conexión (u otro error de red): usar el último perfil guardado de este mismo usuario
    // en vez de dejarlo sin sesión.
    const cache = localStorage.getItem(CLAVE_PERFIL_CACHE);
    const perfilCache = cache ? (JSON.parse(cache) as Usuario) : null;
    setUsuario(perfilCache?.id === userId ? perfilCache : null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) cargarPerfil(data.session.user.id).finally(() => setCargando(false));
      else setCargando(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) cargarPerfil(session.user.id);
      else setUsuario(null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function login(usuarioOCorreo: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email: resolverEmailLogin(usuarioOCorreo), password });
    if (error) return { error: error.message };

    const { data: sesion } = await supabase.auth.getUser();
    const userId = sesion.user?.id;
    if (!userId) return { error: 'No se pudo verificar la sesión.' };

    // Los operadores quedan vinculados al primer celular desde el que inician
    // sesión (ver 0015_vinculacion_dispositivo.sql) para evitar que reporten
    // visitas de compañeros que no fueron al sitio desde un mismo celular.
    const { data: perfil } = await supabase.from('usuarios').select('rol, device_id').eq('id', userId).single();
    if (perfil?.rol === 'operador') {
      const deviceId = obtenerIdDispositivo();
      if (perfil.device_id && perfil.device_id !== deviceId) {
        await supabase.auth.signOut();
        return { error: 'device_mismatch' };
      }
      if (!perfil.device_id) {
        const { error: vincularError } = await supabase.from('usuarios').update({ device_id: deviceId }).eq('id', userId);
        if (vincularError) {
          await supabase.auth.signOut();
          return { error: vincularError.code === '23505' ? 'device_mismatch' : vincularError.message };
        }
      }
    }

    return {};
  }

  async function logout() {
    await supabase.auth.signOut();
    localStorage.removeItem(CLAVE_PERFIL_CACHE);
  }

  return (
    <AuthContext.Provider value={{ usuario, cargando, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
