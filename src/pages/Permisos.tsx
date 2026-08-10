import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { FUNCIONES_PERMISOS } from '../lib/funcionesPermisos';
import type { UserRole } from '../lib/types';

// Roles a los que se les puede activar/desactivar funciones. El administrador siempre tiene
// todo (ver tiene_permiso() en la base) y no aparece acá — no se puede apagar a sí mismo.
const ROLES_EDITABLES: { rol: UserRole; nombre: string }[] = [
  { rol: 'supervisor', nombre: 'Supervisor' },
  { rol: 'operador', nombre: 'Operador' },
];

type Clave = `${string}|${string}`;
const clave = (rol: string, funcion: string): Clave => `${rol}|${funcion}`;

export function Permisos() {
  const { usuario } = useAuth();
  const [habilitados, setHabilitados] = useState<Set<Clave>>(new Set());
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<Clave | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    const { data } = await supabase.from('permisos_rol').select('rol, funcion, habilitado');
    const set = new Set<Clave>();
    for (const fila of data ?? []) {
      if (fila.habilitado) set.add(clave(fila.rol, fila.funcion));
    }
    setHabilitados(set);
    setCargando(false);
  }

  async function alternar(rol: UserRole, funcion: string) {
    const k = clave(rol, funcion);
    const nuevoValor = !habilitados.has(k);
    setGuardando(k);
    setMensaje(null);
    const { error } = await supabase
      .from('permisos_rol')
      .upsert({ rol, funcion, habilitado: nuevoValor, actualizado_por: usuario?.id }, { onConflict: 'rol,funcion' });
    if (error) {
      setMensaje(`No se pudo guardar: ${error.message}`);
    } else {
      setHabilitados((prev) => {
        const next = new Set(prev);
        if (nuevoValor) next.add(k);
        else next.delete(k);
        return next;
      });
    }
    setGuardando(null);
  }

  if (!usuario) return null;
  if (usuario.rol !== 'administrador') return <Navigate to="/" replace />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">Permisos por rol</h1>
        <p className="text-sm text-slate-600">
          Activa o desactiva funciones puntuales para Supervisor y Operador, sin cambiarles el rol. El Administrador
          siempre tiene acceso a todo — eso no se puede desactivar.
        </p>
      </div>

      {mensaje && <p className="text-sm text-gauge-danger">{mensaje}</p>}

      {cargando ? (
        <p className="text-slate-600">Cargando…</p>
      ) : (
        <div className="space-y-3">
          {FUNCIONES_PERMISOS.map((f) => (
            <div key={f.clave} className="tarjeta p-4 space-y-3">
              <div>
                <p className="font-semibold text-slate-900">{f.nombre}</p>
                <p className="text-xs text-slate-500 mt-0.5">{f.descripcion}</p>
              </div>
              <div className="flex flex-wrap gap-4">
                {ROLES_EDITABLES.map(({ rol, nombre }) => {
                  const k = clave(rol, f.clave);
                  const activo = habilitados.has(k);
                  return (
                    <label key={rol} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-gauge-ok"
                        checked={activo}
                        disabled={guardando === k}
                        onChange={() => alternar(rol, f.clave)}
                      />
                      {nombre}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
