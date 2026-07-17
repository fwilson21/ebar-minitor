import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import {
  contarPendientes,
  iniciarAutoSincronizacion,
  obtenerPendientes,
  sincronizarPendientes,
  type VisitaPendiente,
} from '../lib/offline';
import { guardarCambiosDelFormularioActivo, hayCambiosSinGuardar } from '../lib/formularioActivo';

const NAV_BASE = [
  { to: '/', label: 'Inicio', icon: '📊' },
  { to: '/estaciones', label: 'Estaciones', icon: '🏭' },
  { to: '/reportes', label: 'Reportes', icon: '📄' },
];
const NAV_ADMIN = { to: '/usuarios', label: 'Usuarios', icon: '👥' };
const NAV_ADMIN_SUPERVISOR = { to: '/asignaciones', label: 'Asignar', icon: '🗺️' };

// Muestra solo nombre y apellido (no el nombre completo con 2 nombres/2 apellidos que suelen
// usarse en Ecuador) — para nombres de 4 palabras asume "Nombre1 Nombre2 Apellido1 Apellido2" y
// se queda con la 1ª y la 3ª; para 3 palabras se queda con la 1ª y la última.
function nombreCorto(nombreCompleto: string): string {
  const partes = nombreCompleto.trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 2) return partes.join(' ');
  const indiceApellido = Math.ceil(partes.length / 2);
  return `${partes[0]} ${partes[indiceApellido]}`;
}

export function AppShell() {
  const { usuario, logout } = useAuth();
  const [pendientes, setPendientes] = useState(0);
  const [enLinea, setEnLinea] = useState(navigator.onLine);
  const [mostrarPanel, setMostrarPanel] = useState(false);
  const [detallePendientes, setDetallePendientes] = useState<VisitaPendiente[]>([]);
  const [sincronizando, setSincronizando] = useState(false);
  const [mensajeSync, setMensajeSync] = useState<string | null>(null);
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [mostrarConfirmarSalir, setMostrarConfirmarSalir] = useState(false);
  const [guardandoYSaliendo, setGuardandoYSaliendo] = useState(false);

  useEffect(() => {
    const detener = iniciarAutoSincronizacion((r) => {
      contarPendientes().then(setPendientes);
      if (r.ok > 0) setMensajeSync(`${r.ok} visita(s) sincronizada(s).`);
    });
    contarPendientes().then(setPendientes);

    const actualizarEstado = () => setEnLinea(navigator.onLine);
    window.addEventListener('online', actualizarEstado);
    window.addEventListener('offline', actualizarEstado);

    // El service worker sincroniza solo en segundo plano en Android (Background Sync) aunque
    // esta pestaña no haya hecho nada — cuando termina, avisa acá para refrescar el badge.
    const alMensajeSW = (event: MessageEvent) => {
      if (event.data?.tipo === 'sync-completado') {
        contarPendientes().then(setPendientes);
        if (event.data.ok > 0) setMensajeSync(`${event.data.ok} visita(s) sincronizada(s).`);
      }
    };
    navigator.serviceWorker?.addEventListener?.('message', alMensajeSW);

    return () => {
      detener();
      window.removeEventListener('online', actualizarEstado);
      window.removeEventListener('offline', actualizarEstado);
      navigator.serviceWorker?.removeEventListener?.('message', alMensajeSW);
    };
  }, []);

  async function abrirPanel() {
    const lista = await obtenerPendientes();
    setDetallePendientes(lista);
    setMensajeSync(null);
    setMostrarPanel(true);
  }

  async function manejarSincronizar() {
    setSincronizando(true);
    setMensajeSync(null);
    try {
      const { ok, fallidas } = await sincronizarPendientes();
      const nuevaLista = await obtenerPendientes();
      setDetallePendientes(nuevaLista);
      setPendientes(nuevaLista.length);
      if (fallidas === 0 && ok > 0) setMensajeSync(`${ok} visita(s) sincronizada(s) correctamente.`);
      else if (fallidas > 0) setMensajeSync(`${ok} sincronizadas, ${fallidas} con error.`);
      else setMensajeSync('No había visitas pendientes.');
    } catch {
      setMensajeSync('Error al sincronizar. Verifica tu conexión.');
    } finally {
      setSincronizando(false);
    }
  }

  function manejarClickSalir() {
    if (hayCambiosSinGuardar()) {
      setMostrarConfirmarSalir(true);
    } else if (window.confirm('¿Seguro que quieres salir de la app?')) {
      logout();
    }
  }

  async function guardarYSalir() {
    setGuardandoYSaliendo(true);
    try {
      await guardarCambiosDelFormularioActivo();
    } finally {
      setGuardandoYSaliendo(false);
      setMostrarConfirmarSalir(false);
      logout();
    }
  }

  function salirSinGuardarDesdeHeader() {
    setMostrarConfirmarSalir(false);
    logout();
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-panel-800 border-b border-panel-600/60 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-tight">EBAR<span className="text-gauge-ok">·</span>Monitor</span>
          {!enLinea && (
            <span className="text-[10px] bg-gauge-warn/15 text-gauge-warn border border-gauge-warn/30 px-2 py-0.5 rounded-full">
              Sin conexión
            </span>
          )}
          {pendientes > 0 && (
            <button
              onClick={abrirPanel}
              className="text-[10px] bg-gauge-warn/15 text-gauge-warn border border-gauge-warn/30 px-2 py-0.5 rounded-full hover:bg-gauge-warn/25 transition"
            >
              {pendientes} por sincronizar
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-400 truncate max-w-[7rem] sm:max-w-none">
            {usuario?.nombre_completo ? nombreCorto(usuario.nombre_completo) : ''}
          </span>
          <button onClick={() => setMostrarPassword(true)} className="text-sm text-slate-400 hover:text-slate-100">
            🔑
          </button>
          <button onClick={manejarClickSalir} className="text-sm text-slate-400 hover:text-slate-100">
            Salir
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 py-4 max-w-3xl w-full mx-auto pb-24">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-panel-800 border-t border-panel-600/60 flex justify-around py-2 z-10">
        {[
          ...NAV_BASE,
          ...(usuario?.rol === 'administrador' || usuario?.rol === 'supervisor' ? [NAV_ADMIN_SUPERVISOR] : []),
          ...(usuario?.rol === 'administrador' ? [NAV_ADMIN] : []),
        ].map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-lg text-xs ${
                isActive ? 'text-gauge-ok' : 'text-slate-400'
              }`
            }
          >
            <span className="text-lg leading-none">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {mostrarPanel && (
        <PanelPendientes
          pendientes={detallePendientes}
          sincronizando={sincronizando}
          mensaje={mensajeSync}
          enLinea={enLinea}
          onSincronizar={manejarSincronizar}
          onCerrar={() => setMostrarPanel(false)}
        />
      )}

      {mostrarPassword && <ModalCambiarPassword onCerrar={() => setMostrarPassword(false)} />}

      {mostrarConfirmarSalir && (
        <>
          <div className="fixed inset-0 bg-black/50 z-20" onClick={() => !guardandoYSaliendo && setMostrarConfirmarSalir(false)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-panel-800 border border-panel-600/60 rounded-xl shadow-xl w-[90vw] max-w-sm p-4 space-y-3">
            <h2 className="font-semibold text-sm">Tienes datos sin guardar</h2>
            <p className="text-xs text-slate-400">
              Tienes cambios sin guardar en esta pantalla. ¿Qué quieres hacer antes de salir?
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={guardarYSalir}
                disabled={guardandoYSaliendo}
                className="rounded-lg px-4 py-2.5 text-sm font-medium border border-gauge-ok/50 text-gauge-ok hover:bg-gauge-ok/10 transition"
              >
                {guardandoYSaliendo ? 'Guardando…' : '💾 Guardar y salir'}
              </button>
              <button
                onClick={salirSinGuardarDesdeHeader}
                disabled={guardandoYSaliendo}
                className="rounded-lg px-4 py-2.5 text-sm font-medium border border-gauge-danger/50 text-gauge-danger hover:bg-gauge-danger/10 transition"
              >
                Salir sin guardar
              </button>
              <button
                onClick={() => setMostrarConfirmarSalir(false)}
                disabled={guardandoYSaliendo}
                className="boton-secundario"
              >
                Cancelar
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ModalCambiarPassword({ onCerrar }: { onCerrar: () => void }) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetir, setRepetir] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function manejarGuardar() {
    if (nueva.length < 6) {
      setMensaje('La contraseña nueva debe tener al menos 6 caracteres.');
      return;
    }
    if (nueva !== repetir) {
      setMensaje('Las contraseñas no coinciden.');
      return;
    }
    setGuardando(true);
    setMensaje(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error('No se pudo identificar tu usuario.');

      // Se re-autentica con la contraseña actual antes de cambiarla, para
      // confirmar que quien está frente a la pantalla es realmente el dueño
      // de la cuenta (updateUser no lo exige por sí solo).
      const { error: errorLogin } = await supabase.auth.signInWithPassword({ email: user.email, password: actual });
      if (errorLogin) throw new Error('La contraseña actual no es correcta.');

      const { error: errorUpdate } = await supabase.auth.updateUser({ password: nueva });
      if (errorUpdate) throw errorUpdate;

      setMensaje('Contraseña actualizada correctamente.');
      setActual('');
      setNueva('');
      setRepetir('');
    } catch (err: any) {
      setMensaje(err.message ?? 'No se pudo cambiar la contraseña.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-20" onClick={onCerrar} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-panel-800 border border-panel-600/60 rounded-xl shadow-xl w-[90vw] max-w-sm p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm">Cambiar contraseña</h2>
          <button onClick={onCerrar} className="text-slate-400 hover:text-slate-100 text-lg leading-none">✕</button>
        </div>

        <div>
          <label className="etiqueta">Contraseña actual</label>
          <input
            type="password"
            className="campo"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
          />
        </div>
        <div>
          <label className="etiqueta">Contraseña nueva</label>
          <input
            type="password"
            className="campo"
            minLength={6}
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
          />
        </div>
        <div>
          <label className="etiqueta">Repetir contraseña nueva</label>
          <input
            type="password"
            className="campo"
            minLength={6}
            value={repetir}
            onChange={(e) => setRepetir(e.target.value)}
          />
        </div>

        {mensaje && (
          <p className={`text-xs ${mensaje.includes('correctamente') ? 'text-gauge-ok' : 'text-gauge-danger'}`}>
            {mensaje}
          </p>
        )}

        <button onClick={manejarGuardar} disabled={guardando} className="boton-primario w-full">
          {guardando ? 'Guardando…' : 'Guardar contraseña'}
        </button>
        <p className="text-xs text-slate-500">
          Si olvidaste tu contraseña actual, pídele a un administrador que te la restablezca desde Usuarios.
        </p>
      </div>
    </>
  );
}

function PanelPendientes({
  pendientes,
  sincronizando,
  mensaje,
  enLinea,
  onSincronizar,
  onCerrar,
}: {
  pendientes: VisitaPendiente[];
  sincronizando: boolean;
  mensaje: string | null;
  enLinea: boolean;
  onSincronizar: () => void;
  onCerrar: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-20" onClick={onCerrar} />
      <div className="fixed top-0 left-0 right-0 z-30 bg-panel-800 border-b border-panel-600/60 max-h-[70vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-panel-600/40">
          <h2 className="font-semibold text-sm">
            Visitas pendientes de sincronizar ({pendientes.length})
          </h2>
          <button onClick={onCerrar} className="text-slate-400 hover:text-slate-100 text-lg leading-none">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-2">
          {pendientes.length === 0 ? (
            <p className="text-sm text-gauge-ok text-center py-4">Todo sincronizado ✓</p>
          ) : (
            pendientes.map((p) => (
              <div key={p.cliente_uuid} className="tarjeta p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-300">
                    {new Date(p.creado_en).toLocaleString('es-EC', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
                    })}
                  </p>
                  {p.intentos > 0 && (
                    <span className="text-[10px] text-gauge-warn lectura">{p.intentos} intento(s)</span>
                  )}
                </div>
                <p className="text-xs text-slate-500 lectura">
                  {new Date(p.payload.fecha_hora_llegada).toLocaleString('es-EC', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
                  })} · {p.payload.bombas.length} bomba(s)
                </p>
                {p.ultimo_error && (
                  <p className="text-[10px] text-gauge-danger bg-gauge-danger/10 px-2 py-1 rounded">
                    {p.ultimo_error}
                  </p>
                )}
              </div>
            ))
          )}
        </div>

        <div className="px-4 py-3 border-t border-panel-600/40 space-y-2">
          {mensaje && (
            <p className={`text-xs text-center ${mensaje.includes('error') ? 'text-gauge-danger' : 'text-gauge-ok'}`}>
              {mensaje}
            </p>
          )}
          <button
            onClick={onSincronizar}
            disabled={sincronizando || !enLinea || pendientes.length === 0}
            className="boton-primario w-full"
          >
            {sincronizando ? 'Sincronizando…' : !enLinea ? 'Sin conexión' : 'Sincronizar ahora'}
          </button>
        </div>
      </div>
    </>
  );
}
