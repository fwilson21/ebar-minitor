import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Usuario, UserRole } from '../lib/types';

const ROL_LABEL: Record<UserRole, string> = {
  administrador: 'Admin',
  supervisor: 'Supervisor',
  operador: 'Operador',
};

const ROL_CLASE: Record<UserRole, string> = {
  administrador: 'bg-gauge-ok/15 text-gauge-ok border-gauge-ok/40',
  supervisor: 'bg-gauge-warn/15 text-gauge-warn border-gauge-warn/40',
  operador: 'bg-panel-600/60 text-slate-400 border-panel-600',
};

export function Users() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'administrador';
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [nuevoEmail, setNuevoEmail] = useState('');
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoRol, setNuevoRol] = useState<UserRole>('operador');
  const [invitando, setInvitando] = useState(false);
  const [mensajeInvitar, setMensajeInvitar] = useState<string | null>(null);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    const { data } = await supabase
      .from('usuarios')
      .select('*')
      .order('nombre_completo');
    setUsuarios((data as Usuario[]) ?? []);
    setCargando(false);
  }

  async function cambiarRol(id: string, rol: UserRole) {
    setGuardando(id);
    const { error } = await supabase.from('usuarios').update({ rol }).eq('id', id);
    if (!error) setUsuarios((prev) => prev.map((u) => (u.id === id ? { ...u, rol } : u)));
    else setMensaje('Error al cambiar el rol.');
    setGuardando(null);
  }

  async function toggleActivo(id: string, activo: boolean) {
    setGuardando(id);
    const { error } = await supabase.from('usuarios').update({ activo }).eq('id', id);
    if (!error) setUsuarios((prev) => prev.map((u) => (u.id === id ? { ...u, activo } : u)));
    else setMensaje('Error al actualizar el usuario.');
    setGuardando(null);
  }

  async function manejarInvitar(e: FormEvent) {
    e.preventDefault();
    setInvitando(true);
    setMensajeInvitar(null);
    try {
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: { email: nuevoEmail, nombre_completo: nuevoNombre, rol: nuevoRol },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setMensajeInvitar(`Invitación enviada a ${nuevoEmail}.`);
      setNuevoEmail('');
      setNuevoNombre('');
      setNuevoRol('operador');
      await cargar();
    } catch (err: any) {
      setMensajeInvitar(`No se pudo invitar: ${err.message ?? err}`);
    } finally {
      setInvitando(false);
    }
  }

  if (cargando) return <p className="text-slate-400">Cargando…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Usuarios</h1>
        {esAdmin && (
          <button
            className="text-sm text-gauge-ok"
            onClick={() => { setMostrarForm((v) => !v); setMensajeInvitar(null); }}
          >
            {mostrarForm ? 'Cancelar' : '+ Invitar usuario'}
          </button>
        )}
      </div>

      {esAdmin && mostrarForm && (
        <form onSubmit={manejarInvitar} className="tarjeta p-4 space-y-3">
          <div>
            <label className="etiqueta">Correo electrónico</label>
            <input
              type="email"
              required
              className="campo"
              value={nuevoEmail}
              onChange={(e) => setNuevoEmail(e.target.value)}
              placeholder="nuevo.operador@empresa.com"
            />
          </div>
          <div>
            <label className="etiqueta">Nombre completo</label>
            <input
              type="text"
              required
              className="campo"
              value={nuevoNombre}
              onChange={(e) => setNuevoNombre(e.target.value)}
              placeholder="Nombre y apellido"
            />
          </div>
          <div>
            <label className="etiqueta">Rol</label>
            <select className="campo" value={nuevoRol} onChange={(e) => setNuevoRol(e.target.value as UserRole)}>
              <option value="operador">Operador</option>
              <option value="supervisor">Supervisor</option>
              <option value="administrador">Administrador</option>
            </select>
          </div>

          {mensajeInvitar && (
            <p className={`text-sm ${mensajeInvitar.startsWith('No se pudo') ? 'text-gauge-danger' : 'text-gauge-ok'}`}>
              {mensajeInvitar}
            </p>
          )}

          <button type="submit" disabled={invitando} className="boton-primario w-full">
            {invitando ? 'Enviando invitación…' : 'Enviar invitación'}
          </button>
          <p className="text-xs text-slate-500">
            Se enviará un correo de invitación para que la persona establezca su propia contraseña.
          </p>
        </form>
      )}

      {mensaje && <p className="text-sm text-gauge-danger">{mensaje}</p>}

      <div className="space-y-2">
        {usuarios.map((u) => (
          <div key={u.id} className={`tarjeta p-4 ${!u.activo ? 'opacity-50' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-100 truncate">{u.nombre_completo}</p>
                {u.telefono && (
                  <p className="text-xs text-slate-500 mt-0.5">{u.telefono}</p>
                )}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded border flex-shrink-0 ${ROL_CLASE[u.rol]}`}>
                {ROL_LABEL[u.rol]}
              </span>
            </div>

            <div className="flex items-center gap-3 mt-3">
              <select
                className="campo py-1 text-xs flex-1"
                value={u.rol}
                disabled={guardando === u.id}
                onChange={(e) => cambiarRol(u.id, e.target.value as UserRole)}
              >
                <option value="operador">Operador</option>
                <option value="supervisor">Supervisor</option>
                <option value="administrador">Administrador</option>
              </select>

              <button
                className={`text-xs px-3 py-1.5 rounded-lg border transition flex-shrink-0 ${
                  u.activo
                    ? 'border-gauge-danger/40 text-gauge-danger hover:bg-gauge-danger/10'
                    : 'border-gauge-ok/40 text-gauge-ok hover:bg-gauge-ok/10'
                }`}
                disabled={guardando === u.id}
                onClick={() => toggleActivo(u.id, !u.activo)}
              >
                {guardando === u.id ? '…' : u.activo ? 'Desactivar' : 'Activar'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
