import { useEffect, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { FUNCIONES_PERMISOS } from '../lib/funcionesPermisos';
import { GridEditable } from '../components/GridEditable';
import { BarraDistribucion } from '../components/BarraDistribucion';
import { PANTALLAS_EDITABLES } from '../lib/pantallasEditables';
import { useEditorDistribucion } from '../hooks/useEditorDistribucion';
import type { UserRole } from '../lib/types';

// Roles a los que se les puede activar/desactivar funciones. El administrador siempre tiene
// todo (ver tiene_permiso() en la base) y no aparece acá — no se puede apagar a sí mismo.
const ROLES_EDITABLES: { rol: UserRole; nombre: string }[] = [
  { rol: 'supervisor', nombre: 'Supervisor' },
  { rol: 'operador', nombre: 'Operador' },
  { rol: 'digitador', nombre: 'Digitador' },
];

type Clave = `${string}|${string}`;
const clave = (rol: string, funcion: string): Clave => `${rol}|${funcion}`;

export function Permisos() {
  const { usuario } = useAuth();
  const [rolSeleccionado, setRolSeleccionado] = useState<UserRole>('supervisor');
  const [habilitados, setHabilitados] = useState<Set<Clave>>(new Set());
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<Clave | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const editorDistribucion = useEditorDistribucion('permisos');

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

  function renderEncabezadoSelector(): ReactNode {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-lg font-bold">Permisos por rol</h1>
          <p className="text-sm text-slate-600">
            Activa o desactiva funciones puntuales para Supervisor y Operador, sin cambiarles el rol. El Administrador
            siempre tiene acceso a todo — eso no se puede desactivar.
          </p>
        </div>

        {mensaje && <p className="text-sm text-gauge-danger">{mensaje}</p>}

        <div>
          <label className="etiqueta">Rol</label>
          <select
            className="campo max-w-xs"
            value={rolSeleccionado}
            onChange={(e) => setRolSeleccionado(e.target.value as UserRole)}
          >
            {ROLES_EDITABLES.map(({ rol, nombre }) => (
              <option key={rol} value={rol}>{nombre}</option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  function renderListaFunciones(): ReactNode {
    if (cargando) return <p className="text-slate-600">Cargando…</p>;
    return (
      <div className="tarjeta divide-y divide-panel-600/40 lg:h-full lg:overflow-auto">
        {FUNCIONES_PERMISOS.map((f) => {
          const k = clave(rolSeleccionado, f.clave);
          const activo = habilitados.has(k);
          return (
            <label key={f.clave} className="flex items-start gap-3 p-4 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4 mt-0.5 accent-gauge-ok flex-shrink-0"
                checked={activo}
                disabled={guardando === k}
                onChange={() => alternar(rolSeleccionado, f.clave)}
              />
              <div>
                <p className="font-semibold text-slate-900 text-sm">{f.nombre}</p>
                <p className="text-xs text-slate-500 mt-0.5">{f.descripcion}</p>
              </div>
            </label>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Celular: exactamente el mismo apilado de siempre, sin GridEditable. */}
      <div className="lg:hidden space-y-5">
        {renderEncabezadoSelector()}
        {renderListaFunciones()}
      </div>

      {/* Escritorio (lg+): mismos bloques, acomodados según lo guardado (o el acomodo por
          defecto) — botón "Editar distribución" abajo. */}
      <div className="hidden lg:block space-y-3">
        <BarraDistribucion editor={editorDistribucion} />
        <GridEditable
          pantallaId="permisos"
          bloques={PANTALLAS_EDITABLES.find((p) => p.id === 'permisos')!.bloques}
          modoEdicion={editorDistribucion.modoEdicion}
          resetSignal={editorDistribucion.resetSignal}
          objetivoEdicion={editorDistribucion.objetivoActivo}
          onGuardar={editorDistribucion.guardar}
          renderBloque={(bloqueId) => {
            switch (bloqueId) {
              case 'encabezado_selector':
                return renderEncabezadoSelector();
              case 'lista_funciones':
                return renderListaFunciones();
              default:
                return null;
            }
          }}
        />
        {editorDistribucion.guardando && <p className="text-xs text-slate-500">Guardando…</p>}
      </div>
    </div>
  );
}
