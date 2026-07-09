import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
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
    setUsuario(data as Usuario | null);
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
    return {};
  }

  async function logout() {
    await supabase.auth.signOut();
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
