import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  contarPendientes,
  iniciarAutoSincronizacion,
  obtenerPendientes,
  sincronizarPendientes,
  type VisitaPendiente,
} from '../lib/offline';

const NAV_BASE = [
  { to: '/', label: 'Inicio', icon: '📊' },
  { to: '/estaciones', label: 'Estaciones', icon: '🏭' },
  { to: '/reportes', label: 'Reportes', icon: '📄' },
];
const NAV_ADMIN = { to: '/usuarios', label: 'Usuarios', icon: '👥' };

export function AppShell() {
  const { usuario, logout } = useAuth();
  const [pendientes, setPendientes] = useState(0);
  const [enLinea, setEnLinea] = useState(navigator.onLine);
  const [mostrarPanel, setMostrarPanel] = useState(false);
  const [detallePendientes, setDetallePendientes] = useState<VisitaPendiente[]>([]);
  const [sincronizando, setSincronizando] = useState(false);
  const [mensajeSync, setMensajeSync] = useState<string | null>(null);

  useEffect(() => {
    const detener = iniciarAutoSincronizacion((r) => {
      contarPendientes().then(setPendientes);
      if (r.ok > 0) setMensajeSync(`${r.ok} visita(s) sincronizada(s).`);
    });
    contarPendientes().then(setPendientes);

    const actualizarEstado = () => setEnLinea(navigator.onLine);
    window.addEventListener('online', actualizarEstado);
    window.addEventListener('offline', actualizarEstado);

    return () => {
      detener();
      window.removeEventListener('online', actualizarEstado);
      window.removeEventListener('offline', actualizarEstado);
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
          <span className="text-sm text-slate-400 hidden sm:inline">{usuario?.nombre_completo}</span>
          <button onClick={logout} className="text-sm text-slate-400 hover:text-slate-100">
            Salir
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 py-4 max-w-3xl w-full mx-auto pb-24">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-panel-800 border-t border-panel-600/60 flex justify-around py-2 z-10">
        {[...NAV_BASE, ...(usuario?.rol === 'administrador' ? [NAV_ADMIN] : [])].map((item) => (
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
    </div>
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
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </p>
                  {p.intentos > 0 && (
                    <span className="text-[10px] text-gauge-warn lectura">{p.intentos} intento(s)</span>
                  )}
                </div>
                <p className="text-xs text-slate-500 lectura">
                  {new Date(p.payload.fecha_hora_llegada).toLocaleString('es-EC', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
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
