import { useEffect, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { FUNCIONES_PERMISOS, CATEGORIAS_PERMISOS } from '../lib/funcionesPermisos';
import { GridEditable } from '../components/GridEditable';
import { BarraDistribucion } from '../components/BarraDistribucion';
import { PANTALLAS_EDITABLES } from '../lib/pantallasEditables';
import { useEditorDistribucion } from '../hooks/useEditorDistribucion';
import type { Usuario, UserRole } from '../lib/types';

// Roles a los que se les puede activar/desactivar funciones. El administrador siempre tiene
// todo (ver tiene_permiso() en la base) y no aparece acá — no se puede apagar a sí mismo.
const ROLES_EDITABLES: { rol: UserRole; nombre: string }[] = [
  { rol: 'supervisor', nombre: 'Supervisor' },
  { rol: 'operador', nombre: 'Operador' },
  { rol: 'digitador', nombre: 'Digitador' },
];

// 'ninguno' no es un rol real — es solo para poder "vaciar" el selector y ocultar
// la lista de usuarios / el checklist de permisos.
type RolFiltro = UserRole | 'ninguno';

type Clave = `${string}|${string}`;
const clave = (rol: string, funcion: string): Clave => `${rol}|${funcion}`;

export function Permisos() {
  const { usuario } = useAuth();
  const [rolSeleccionado, setRolSeleccionado] = useState<RolFiltro>('supervisor');
  const [habilitados, setHabilitados] = useState<Set<Clave>>(new Set());
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<Clave | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const editorDistribucion = useEditorDistribucion('permisos');

  useEffect(() => {
    cargar();
  }, []);

  async function cargar() {
    const [permisosRes, usuariosRes] = await Promise.all([
      supabase.from('permisos_rol').select('rol, funcion, habilitado'),
      supabase.from('usuarios').select('id, nombre_completo, rol, activo').order('nombre_completo'),
    ]);
    const set = new Set<Clave>();
    for (const fila of permisosRes.data ?? []) {
      if (fila.habilitado) set.add(clave(fila.rol, fila.funcion));
    }
    setHabilitados(set);
    setUsuarios((usuariosRes.data as Usuario[]) ?? []);
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
    const usuariosDelRol = rolSeleccionado === 'ninguno' ? [] : usuarios.filter((u) => u.rol === rolSeleccionado);

    return (
      <div className="space-y-4">
        <div>
          <h1 className="titulo-pantalla">Permisos por rol</h1>
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
            onChange={(e) => setRolSeleccionado(e.target.value as RolFiltro)}
          >
            {ROLES_EDITABLES.map(({ rol, nombre }) => (
              <option key={rol} value={rol}>{nombre}</option>
            ))}
            <option value="ninguno">Ninguno</option>
          </select>
        </div>

        {rolSeleccionado !== 'ninguno' && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
              Usuarios con este rol {usuariosDelRol.length > 0 && `(${usuariosDelRol.length})`}
            </p>
            {usuariosDelRol.length === 0 ? (
              <p className="text-sm text-slate-500">Nadie tiene este rol todavía.</p>
            ) : (
              <ul className="text-sm text-slate-700 space-y-0.5">
                {usuariosDelRol.map((u) => (
                  <li key={u.id} className={!u.activo ? 'opacity-50' : ''}>
                    {u.nombre_completo}
                    {!u.activo && ' (inactivo)'}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderListaFunciones(): ReactNode {
    if (cargando) return <p className="text-slate-600">Cargando…</p>;
    if (rolSeleccionado === 'ninguno') {
      return <p className="text-sm text-slate-500">Selecciona un rol para ver y editar sus permisos.</p>;
    }
    return (
      <div className="space-y-4 lg:h-full lg:overflow-auto">
        {CATEGORIAS_PERMISOS.map((categoria) => {
          const funciones = FUNCIONES_PERMISOS.filter((f) => f.categoria === categoria);
          const habilitadasEnCategoria = funciones.filter((f) => habilitados.has(clave(rolSeleccionado, f.clave))).length;
          return (
            <div key={categoria} className="tarjeta overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-panel-700/50 border-b border-panel-600/40">
                <h2 className="text-sm font-semibold text-slate-800">{categoria}</h2>
                <span className="text-xs text-slate-500 lectura">
                  {habilitadasEnCategoria}/{funciones.length}
                </span>
              </div>
              <div className="divide-y divide-panel-600/40">
                {funciones.map((f) => {
                  const k = clave(rolSeleccionado, f.clave);
                  const activo = habilitados.has(k);
                  return (
                    <label key={f.clave} className="flex items-start gap-3 p-4 pl-8 cursor-pointer select-none">
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
            </div>
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
