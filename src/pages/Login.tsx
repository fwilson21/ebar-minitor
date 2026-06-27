import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { estaConfiguradoSupabase } from '../lib/supabase';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function manejarSubmit(e: FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    const { error } = await login(email, password);
    setCargando(false);
    if (error) setError('Correo o contraseña incorrectos.');
    else navigate('/');
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={manejarSubmit} className="tarjeta w-full max-w-sm p-6">
        <h1 className="text-xl font-bold mb-1">EBAR · Monitor</h1>
        <p className="text-sm text-slate-400 mb-6">Gestión de estaciones de bombeo de aguas residuales</p>

        <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${estaConfiguradoSupabase() ? 'border-gauge-ok/40 bg-gauge-ok/10 text-gauge-ok' : 'border-gauge-warn/40 bg-gauge-warn/10 text-gauge-warn'}`}>
          {estaConfiguradoSupabase() ? 'Conectado a Supabase' : 'Falta configurar Supabase para usar el backend real'}
        </div>

        <label className="etiqueta">Correo electrónico</label>
        <input
          type="email"
          required
          className="campo mb-4"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="operador@empresa.com"
        />

        <label className="etiqueta">Contraseña</label>
        <input
          type="password"
          required
          className="campo mb-4"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />

        {error && <p className="text-sm text-gauge-danger mb-4">{error}</p>}

        <button type="submit" disabled={cargando} className="boton-primario w-full">
          {cargando ? 'Ingresando…' : 'Ingresar'}
        </button>

        {estaConfiguradoSupabase() && (
          <div className="mt-3 space-y-2 text-center">
            <Link to="/bootstrap" className="block text-sm text-gauge-ok">
              Crear datos base de ejemplo
            </Link>
            <Link to="/crear-admin" className="block text-sm text-gauge-ok">
              Crear primer administrador
            </Link>
          </div>
        )}
      </form>
    </div>
  );
}
