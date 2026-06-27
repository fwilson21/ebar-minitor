import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export function CreateAdmin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function manejarSubmit(e: FormEvent) {
    e.preventDefault();
    setCargando(true);
    setMensaje(null);

    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { nombre_completo: nombre },
        },
      });

      if (authError) throw authError;

      const userId = authData.user?.id;
      if (!userId) throw new Error('No se pudo crear el usuario de autenticación.');

      const { error: perfilError } = await supabase.from('usuarios').upsert({
        id: userId,
        nombre_completo: nombre,
        rol: 'administrador',
        activo: true,
      });

      if (perfilError) throw perfilError;

      setMensaje('Administrador creado. Ahora puedes iniciar sesión.');
      setTimeout(() => navigate('/login'), 1200);
    } catch (err: any) {
      setMensaje(`No se pudo crear el administrador: ${err.message ?? err}`);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={manejarSubmit} className="tarjeta w-full max-w-md p-6 space-y-4">
        <div>
          <h1 className="text-xl font-bold">Crear primer administrador</h1>
          <p className="text-sm text-slate-400">Crea la cuenta inicial para gestionar estaciones y reportes.</p>
        </div>

        <div>
          <label className="etiqueta">Nombre completo</label>
          <input className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        </div>

        <div>
          <label className="etiqueta">Correo</label>
          <input type="email" className="campo" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>

        <div>
          <label className="etiqueta">Contraseña</label>
          <input type="password" className="campo" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        </div>

        <button type="submit" disabled={cargando} className="boton-primario w-full">
          {cargando ? 'Creando…' : 'Crear administrador'}
        </button>

        {mensaje && <p className="text-sm text-slate-300">{mensaje}</p>}
      </form>
    </div>
  );
}
