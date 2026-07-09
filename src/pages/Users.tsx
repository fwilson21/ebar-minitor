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
  const [nuevoUsuario, setNuevoUsuario] = useState('');
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevaPassword, setNuevaPassword] = useState('');
  const [nuevoRol, setNuevoRol] = useState<UserRole>('operador');
  const [invitando, setInvitando] = useState(false);
  const [mensajeInvitar, setMensajeInvitar] = useState<string | null>(null);
  const [restableciendoId, setRestableciendoId] = useState<string | null>(null);
  const [passwordReset, setPasswordReset] = useState('');
  const [mensajeReset, setMensajeReset] = useState<string | null>(null);
  const [guardandoReset, setGuardandoReset] = useState(false);

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
        body: { usuario: nuevoUsuario, nombre_completo: nuevoNombre, password: nuevaPassword, rol: nuevoRol },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setMensajeInvitar(`Usuario ${nuevoNombre} creado. Ya puede iniciar sesión con "${nuevoUsuario}" y la contraseña que definiste.`);
      setNuevoUsuario('');
      setNuevoNombre('');
      setNuevaPassword('');
      setNuevoRol('operador');
      await cargar();
    } catch (err: any) {
      setMensajeInvitar(`No se pudo crear el usuario: ${err.message ?? err}`);
    } finally {
      setInvitando(false);
    }
  }

  function abrirReset(id: string) {
    setRestableciendoId((actual) => (actual === id ? null : id));
    setPasswordReset('');
    setMensajeReset(null);
  }

  async function manejarRestablecer(id: string) {
    if (passwordReset.length < 6) {
      setMensajeReset('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    setGuardandoReset(true);
    setMensajeReset(null);
    try {
      const { data, error } = await supabase.functions.invoke('reset-user-password', {
        body: { usuario_id: id, password: passwordReset },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMensajeReset('Contraseña actualizada. Pásasela al usuario.');
      setPasswordReset('');
    } catch (err: any) {
      setMensajeReset(`No se pudo restablecer: ${err.message ?? err}`);
    } finally {
      setGuardandoReset(false);
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
            {mostrarForm ? 'Cancelar' : '+ Crear usuario'}
          </button>
        )}
      </div>

      {esAdmin && mostrarForm && (
        <form onSubmit={manejarInvitar} className="tarjeta p-4 space-y-3">
          <div>
            <label className="etiqueta">Usuario</label>
            <input
              type="text"
              required
              pattern="[a-z0-9._-]{3,30}"
              title="Solo minúsculas, números, puntos, guiones y guiones bajos (3-30 caracteres)"
              className="campo"
              value={nuevoUsuario}
              onChange={(e) => setNuevoUsuario(e.target.value)}
              placeholder="jperez"
              autoCapitalize="none"
              autoCorrect="off"
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
            <label className="etiqueta">Contraseña inicial</label>
            <input
              type="text"
              required
              minLength={6}
              className="campo"
              value={nuevaPassword}
              onChange={(e) => setNuevaPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
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
            {invitando ? 'Creando…' : 'Crear usuario'}
          </button>
          <p className="text-xs text-slate-500">
            No hace falta correo real. Pásale el usuario y la contraseña a la persona para que inicie sesión — puede cambiarla luego desde la app.
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

              {esAdmin && (
                <button
                  className="text-xs px-3 py-1.5 rounded-lg border border-panel-600 text-slate-400 hover:text-slate-100 flex-shrink-0"
                  onClick={() => abrirReset(u.id)}
                >
                  🔑 Contraseña
                </button>
              )}
            </div>

            {esAdmin && restableciendoId === u.id && (
              <div className="mt-3 pt-3 border-t border-panel-600/60 space-y-2">
                <label className="etiqueta">Nueva contraseña para {u.nombre_completo}</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="campo flex-1"
                    minLength={6}
                    placeholder="Mínimo 6 caracteres"
                    value={passwordReset}
                    onChange={(e) => setPasswordReset(e.target.value)}
                  />
                  <button
                    className="boton-primario px-4 flex-shrink-0"
                    disabled={guardandoReset}
                    onClick={() => manejarRestablecer(u.id)}
                  >
                    {guardandoReset ? '…' : 'Guardar'}
                  </button>
                </div>
                {mensajeReset && (
                  <p className={`text-xs ${mensajeReset.startsWith('No se pudo') ? 'text-gauge-danger' : 'text-gauge-ok'}`}>
                    {mensajeReset}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
