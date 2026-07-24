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
  operador: 'bg-panel-600/60 text-slate-600 border-panel-600',
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
  const [nuevaCedula, setNuevaCedula] = useState('');
  const [nuevoCargo, setNuevoCargo] = useState('');
  const [nuevoRol, setNuevoRol] = useState<UserRole>('operador');
  const [invitando, setInvitando] = useState(false);
  const [mensajeInvitar, setMensajeInvitar] = useState<string | null>(null);
  const [restableciendoId, setRestableciendoId] = useState<string | null>(null);
  const [passwordReset, setPasswordReset] = useState('');
  const [mensajeReset, setMensajeReset] = useState<string | null>(null);
  const [guardandoReset, setGuardandoReset] = useState(false);
  const [renombrandoId, setRenombrandoId] = useState<string | null>(null);
  const [nuevoNombreUsuario, setNuevoNombreUsuario] = useState('');
  const [mensajeRenombrar, setMensajeRenombrar] = useState<string | null>(null);
  const [guardandoRenombrar, setGuardandoRenombrar] = useState(false);
  const [editandoCedulaId, setEditandoCedulaId] = useState<string | null>(null);
  const [cedulaEdicion, setCedulaEdicion] = useState('');
  const [mensajeCedula, setMensajeCedula] = useState<string | null>(null);
  const [guardandoCedula, setGuardandoCedula] = useState(false);
  const [editandoCargoId, setEditandoCargoId] = useState<string | null>(null);
  const [cargoEdicion, setCargoEdicion] = useState('');
  const [mensajeCargo, setMensajeCargo] = useState<string | null>(null);
  const [guardandoCargo, setGuardandoCargo] = useState(false);
  const [editandoNombreId, setEditandoNombreId] = useState<string | null>(null);
  const [nombreEdicion, setNombreEdicion] = useState('');
  const [mensajeNombre, setMensajeNombre] = useState<string | null>(null);
  const [guardandoNombre, setGuardandoNombre] = useState(false);

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

  async function liberarDispositivo(id: string) {
    setGuardando(id);
    const { error } = await supabase.from('usuarios').update({ device_id: null }).eq('id', id);
    if (!error) setUsuarios((prev) => prev.map((u) => (u.id === id ? { ...u, device_id: null } : u)));
    else setMensaje('Error al liberar el celular.');
    setGuardando(null);
  }

  async function manejarEliminar(id: string, nombre: string) {
    const continuar = window.confirm(
      `¿Eliminar por completo la cuenta de ${nombre}? Esto no se puede deshacer.\n\n` +
        'Si esta persona ya tiene visitas registradas, no se va a poder eliminar (para no perder el historial) — en ese caso usa "Desactivar" en vez de esto.',
    );
    if (!continuar) return;
    setGuardando(id);
    setMensaje(null);
    try {
      const { data, error } = await supabase.functions.invoke('delete-user', { body: { usuario_id: id } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setUsuarios((prev) => prev.filter((u) => u.id !== id));
    } catch (err: any) {
      setMensaje(`No se pudo eliminar: ${err.message ?? err}`);
    } finally {
      setGuardando(null);
    }
  }

  async function manejarInvitar(e: FormEvent) {
    e.preventDefault();
    setInvitando(true);
    setMensajeInvitar(null);
    try {
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: {
          usuario: nuevoUsuario,
          nombre_completo: nuevoNombre,
          password: nuevaPassword,
          cedula: nuevaCedula,
          cargo: nuevoCargo,
          rol: nuevoRol,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setMensajeInvitar(`Usuario ${nuevoNombre} creado. Ya puede iniciar sesión con "${nuevoUsuario}" y la contraseña que definiste.`);
      setNuevoUsuario('');
      setNuevoNombre('');
      setNuevaPassword('');
      setNuevaCedula('');
      setNuevoCargo('');
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

  function abrirRenombrar(id: string, actual: string | null | undefined) {
    setRenombrandoId((prev) => (prev === id ? null : id));
    setNuevoNombreUsuario(actual ?? '');
    setMensajeRenombrar(null);
  }

  async function manejarRenombrar(id: string) {
    if (!/^[a-z0-9._-]{3,30}$/.test(nuevoNombreUsuario)) {
      setMensajeRenombrar('Usuario inválido: 3-30 caracteres, minúsculas, números, puntos, guiones o guiones bajos.');
      return;
    }
    setGuardandoRenombrar(true);
    setMensajeRenombrar(null);
    try {
      const { data, error } = await supabase.functions.invoke('rename-user', {
        body: { usuario_id: id, nuevo_usuario: nuevoNombreUsuario },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setUsuarios((prev) => prev.map((u) => (u.id === id ? { ...u, nombre_usuario: nuevoNombreUsuario } : u)));
      setMensajeRenombrar('Usuario actualizado. Ya puede iniciar sesión con el nuevo nombre.');
    } catch (err: any) {
      setMensajeRenombrar(`No se pudo cambiar: ${err.message ?? err}`);
    } finally {
      setGuardandoRenombrar(false);
    }
  }

  function abrirEditarCedula(id: string, actual: string | null | undefined) {
    setEditandoCedulaId((prev) => (prev === id ? null : id));
    setCedulaEdicion(actual ?? '');
    setMensajeCedula(null);
  }

  async function manejarGuardarCedula(id: string) {
    if (!/^\d{10}$/.test(cedulaEdicion)) {
      setMensajeCedula('La cédula debe tener 10 dígitos numéricos.');
      return;
    }
    setGuardandoCedula(true);
    setMensajeCedula(null);
    try {
      const { error } = await supabase.from('usuarios').update({ cedula: cedulaEdicion }).eq('id', id);
      if (error) throw error;
      setUsuarios((prev) => prev.map((u) => (u.id === id ? { ...u, cedula: cedulaEdicion } : u)));
      setMensajeCedula('Cédula actualizada.');
    } catch (err: any) {
      const duplicada = err.code === '23505';
      setMensajeCedula(duplicada ? 'Ya hay otro usuario con esa cédula.' : `No se pudo guardar: ${err.message ?? err}`);
    } finally {
      setGuardandoCedula(false);
    }
  }

  function abrirEditarCargo(id: string, actual: string | null | undefined) {
    setEditandoCargoId((prev) => (prev === id ? null : id));
    setCargoEdicion(actual ?? '');
    setMensajeCargo(null);
  }

  async function manejarGuardarCargo(id: string) {
    if (!cargoEdicion.trim()) {
      setMensajeCargo('Escribe el cargo/ocupación.');
      return;
    }
    setGuardandoCargo(true);
    setMensajeCargo(null);
    try {
      const { error } = await supabase.from('usuarios').update({ cargo: cargoEdicion.trim() }).eq('id', id);
      if (error) throw error;
      setUsuarios((prev) => prev.map((u) => (u.id === id ? { ...u, cargo: cargoEdicion.trim() } : u)));
      setMensajeCargo('Cargo actualizado.');
    } catch (err: any) {
      setMensajeCargo(`No se pudo guardar: ${err.message ?? err}`);
    } finally {
      setGuardandoCargo(false);
    }
  }

  function abrirEditarNombre(id: string, actual: string) {
    setEditandoNombreId((prev) => (prev === id ? null : id));
    setNombreEdicion(actual ?? '');
    setMensajeNombre(null);
  }

  async function manejarGuardarNombre(id: string) {
    const nombre = nombreEdicion.trim();
    if (!nombre) {
      setMensajeNombre('Escribe el nombre completo.');
      return;
    }
    setGuardandoNombre(true);
    setMensajeNombre(null);
    try {
      const { error } = await supabase.from('usuarios').update({ nombre_completo: nombre }).eq('id', id);
      if (error) throw error;
      setUsuarios((prev) => prev.map((u) => (u.id === id ? { ...u, nombre_completo: nombre } : u)));
      setMensajeNombre('Nombre actualizado.');
    } catch (err: any) {
      setMensajeNombre(`No se pudo guardar: ${err.message ?? err}`);
    } finally {
      setGuardandoNombre(false);
    }
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

  if (cargando) return <p className="text-slate-600">Cargando…</p>;

  return (
    <div className="space-y-4">
      <div className="relative flex items-center justify-center">
        <h1 className="text-2xl font-extrabold text-slate-900">Usuarios</h1>
        {esAdmin && (
          <button
            className="absolute right-0 text-sm text-gauge-ok"
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
            <label className="etiqueta">Cédula</label>
            <input
              type="text"
              required
              inputMode="numeric"
              pattern="\d{10}"
              title="10 dígitos numéricos"
              className="campo"
              value={nuevaCedula}
              onChange={(e) => setNuevaCedula(e.target.value)}
              placeholder="10 dígitos"
              maxLength={10}
            />
          </div>
          <div>
            <label className="etiqueta">Cargo/Ocupación</label>
            <input
              type="text"
              required
              className="campo"
              value={nuevoCargo}
              onChange={(e) => setNuevoCargo(e.target.value)}
              placeholder="Ej: Operador de estaciones de bombeo"
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
                <p className="font-semibold text-slate-900 truncate">{u.nombre_completo}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Usuario: <span className="text-slate-700">{u.nombre_usuario || '(sin registrar)'}</span>
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Cédula: <span className="text-slate-700">{u.cedula || '(sin registrar)'}</span>
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Cargo: <span className="text-slate-700">{u.cargo || '(sin registrar)'}</span>
                </p>
                {u.telefono && (
                  <p className="text-xs text-slate-500 mt-0.5">{u.telefono}</p>
                )}
                {u.rol === 'operador' && (
                  <p className="text-xs mt-0.5 text-slate-500">
                    {u.device_id ? '📱 Vinculado a un celular' : '📱 Sin celular vinculado'}
                  </p>
                )}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded border flex-shrink-0 ${ROL_CLASE[u.rol]}`}>
                {ROL_LABEL[u.rol]}
              </span>
            </div>

            <select
              className="campo py-1.5 text-xs w-full mt-3"
              value={u.rol}
              disabled={guardando === u.id}
              onChange={(e) => cambiarRol(u.id, e.target.value as UserRole)}
            >
              <option value="operador">Operador</option>
              <option value="supervisor">Supervisor</option>
              <option value="administrador">Administrador</option>
            </select>

            <div className="flex flex-wrap gap-2 mt-2">
              <button
                className={`text-xs px-3 py-1.5 rounded-lg border transition ${
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
                  className="text-xs px-3 py-1.5 rounded-lg border border-panel-600 text-slate-600 hover:text-slate-900"
                  onClick={() => abrirEditarNombre(u.id, u.nombre_completo)}
                >
                  📝 Nombre
                </button>
              )}

              {esAdmin && (
                <button
                  className="text-xs px-3 py-1.5 rounded-lg border border-panel-600 text-slate-600 hover:text-slate-900"
                  onClick={() => abrirReset(u.id)}
                >
                  🔑 Contraseña
                </button>
              )}

              {esAdmin && (
                <button
                  className="text-xs px-3 py-1.5 rounded-lg border border-panel-600 text-slate-600 hover:text-slate-900"
                  onClick={() => abrirRenombrar(u.id, u.nombre_usuario)}
                >
                  ✏️ Usuario
                </button>
              )}

              {esAdmin && (
                <button
                  className="text-xs px-3 py-1.5 rounded-lg border border-panel-600 text-slate-600 hover:text-slate-900"
                  onClick={() => abrirEditarCedula(u.id, u.cedula)}
                >
                  🪪 Cédula
                </button>
              )}

              {esAdmin && (
                <button
                  className="text-xs px-3 py-1.5 rounded-lg border border-panel-600 text-slate-600 hover:text-slate-900"
                  onClick={() => abrirEditarCargo(u.id, u.cargo)}
                >
                  💼 Cargo
                </button>
              )}

              {esAdmin && u.rol === 'operador' && u.device_id && (
                <button
                  className="text-xs px-3 py-1.5 rounded-lg border border-panel-600 text-slate-600 hover:text-slate-900"
                  disabled={guardando === u.id}
                  onClick={() => liberarDispositivo(u.id)}
                >
                  {guardando === u.id ? '…' : '📱 Liberar celular'}
                </button>
              )}

              {esAdmin && u.id !== usuario?.id && (
                <button
                  className="text-xs px-3 py-1.5 rounded-lg border border-gauge-danger/40 text-gauge-danger hover:bg-gauge-danger/10"
                  disabled={guardando === u.id}
                  onClick={() => manejarEliminar(u.id, u.nombre_completo)}
                >
                  {guardando === u.id ? '…' : '🗑️ Eliminar'}
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

            {esAdmin && editandoNombreId === u.id && (
              <div className="mt-3 pt-3 border-t border-panel-600/60 space-y-2">
                <label className="etiqueta">Nombre completo</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="campo flex-1"
                    placeholder="Nombre y apellido"
                    value={nombreEdicion}
                    onChange={(e) => setNombreEdicion(e.target.value)}
                  />
                  <button
                    className="boton-primario px-4 flex-shrink-0"
                    disabled={guardandoNombre || nombreEdicion.trim() === (u.nombre_completo ?? '')}
                    onClick={() => manejarGuardarNombre(u.id)}
                  >
                    {guardandoNombre ? '…' : 'Guardar'}
                  </button>
                </div>
                {mensajeNombre && (
                  <p className={`text-xs ${mensajeNombre.startsWith('No se pudo') || mensajeNombre.startsWith('Escribe') ? 'text-gauge-danger' : 'text-gauge-ok'}`}>
                    {mensajeNombre}
                  </p>
                )}
              </div>
            )}

            {esAdmin && renombrandoId === u.id && (
              <div className="mt-3 pt-3 border-t border-panel-600/60 space-y-2">
                <label className="etiqueta">Nuevo usuario para {u.nombre_completo}</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="campo flex-1"
                    pattern="[a-z0-9._-]{3,30}"
                    placeholder="jperez"
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={nuevoNombreUsuario}
                    onChange={(e) => setNuevoNombreUsuario(e.target.value)}
                  />
                  <button
                    className="boton-primario px-4 flex-shrink-0"
                    disabled={guardandoRenombrar || nuevoNombreUsuario.trim() === (u.nombre_usuario ?? '')}
                    onClick={() => manejarRenombrar(u.id)}
                  >
                    {guardandoRenombrar ? '…' : 'Guardar'}
                  </button>
                </div>
                <p className="text-xs text-slate-500">
                  Esto cambia de verdad con qué usuario entra a la app (no solo lo que se muestra acá).
                </p>
                {mensajeRenombrar && (
                  <p className={`text-xs ${mensajeRenombrar.startsWith('No se pudo') || mensajeRenombrar.startsWith('Usuario inválido') ? 'text-gauge-danger' : 'text-gauge-ok'}`}>
                    {mensajeRenombrar}
                  </p>
                )}
              </div>
            )}

            {esAdmin && editandoCedulaId === u.id && (
              <div className="mt-3 pt-3 border-t border-panel-600/60 space-y-2">
                <label className="etiqueta">Cédula de {u.nombre_completo}</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="campo flex-1"
                    inputMode="numeric"
                    pattern="\d{10}"
                    maxLength={10}
                    placeholder="10 dígitos"
                    value={cedulaEdicion}
                    onChange={(e) => setCedulaEdicion(e.target.value)}
                  />
                  <button
                    className="boton-primario px-4 flex-shrink-0"
                    disabled={guardandoCedula || cedulaEdicion.trim() === (u.cedula ?? '')}
                    onClick={() => manejarGuardarCedula(u.id)}
                  >
                    {guardandoCedula ? '…' : 'Guardar'}
                  </button>
                </div>
                {mensajeCedula && (
                  <p className={`text-xs ${mensajeCedula.startsWith('No se pudo') || mensajeCedula.startsWith('Ya hay') || mensajeCedula.startsWith('La cédula') ? 'text-gauge-danger' : 'text-gauge-ok'}`}>
                    {mensajeCedula}
                  </p>
                )}
              </div>
            )}

            {esAdmin && editandoCargoId === u.id && (
              <div className="mt-3 pt-3 border-t border-panel-600/60 space-y-2">
                <label className="etiqueta">Cargo/Ocupación de {u.nombre_completo}</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="campo flex-1"
                    placeholder="Ej: Operador de estaciones de bombeo"
                    value={cargoEdicion}
                    onChange={(e) => setCargoEdicion(e.target.value)}
                  />
                  <button
                    className="boton-primario px-4 flex-shrink-0"
                    disabled={guardandoCargo || cargoEdicion.trim() === (u.cargo ?? '')}
                    onClick={() => manejarGuardarCargo(u.id)}
                  >
                    {guardandoCargo ? '…' : 'Guardar'}
                  </button>
                </div>
                {mensajeCargo && (
                  <p className={`text-xs ${mensajeCargo.startsWith('No se pudo') || mensajeCargo.startsWith('Escribe') ? 'text-gauge-danger' : 'text-gauge-ok'}`}>
                    {mensajeCargo}
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
