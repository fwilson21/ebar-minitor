import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { estaConfiguradoSupabase } from '../lib/supabase';

function mensajeError(original: string): string {
  const m = original.toLowerCase();
  if (m.includes('device_mismatch')) return 'Este celular ya está vinculado a otro usuario, o tu usuario ya está vinculado a otro celular. Solicita a un administrador que lo libere desde Usuarios.';
  if (m.includes('invalid login credentials')) return 'Usuario o contraseña incorrectos.';
  if (m.includes('email not confirmed')) return 'Debes confirmar tu correo antes de ingresar.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'No se pudo conectar. Verifica tu conexión a internet.';
  return 'No se pudo iniciar sesión. Intenta de nuevo.';
}

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function manejarSubmit(e: FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    const { error } = await login(usuario, password);
    setCargando(false);
    if (error) setError(mensajeError(error));
    else navigate('/');
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={manejarSubmit} className="tarjeta w-full max-w-sm p-6">
        <h1 className="text-xl font-bold mb-1">EBAR · Monitor</h1>
        <p className="text-sm text-slate-600 mb-6">Gestión de estaciones de bombeo de aguas residuales</p>

        <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${estaConfiguradoSupabase() ? 'border-gauge-ok/40 bg-gauge-ok/10 text-gauge-ok' : 'border-gauge-warn/40 bg-gauge-warn/10 text-gauge-warn'}`}>
          {estaConfiguradoSupabase() ? 'Conectado a Supabase' : 'Falta configurar Supabase para usar el backend real'}
        </div>

        <label className="etiqueta">Usuario</label>
        <input
          type="text"
          required
          className="campo mb-4"
          value={usuario}
          onChange={(e) => setUsuario(e.target.value)}
          placeholder="jperez"
          autoCapitalize="none"
          autoCorrect="off"
        />

        <label className="etiqueta">Contraseña</label>
        <div className="relative mb-4">
          <input
            type={mostrarPassword ? 'text' : 'password'}
            required
            className="campo pr-16"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setMostrarPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-600 hover:text-slate-800"
          >
            {mostrarPassword ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>

        {error && <p className="text-sm text-gauge-danger mb-4">{error}</p>}

        <button type="submit" disabled={cargando} className="boton-primario w-full flex items-center justify-center gap-2">
          {cargando && (
            <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          )}
          {cargando ? 'Ingresando…' : 'Ingresar'}
        </button>

      </form>
    </div>
  );
}
