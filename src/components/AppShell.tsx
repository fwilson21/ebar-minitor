import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { contarPendientes, iniciarAutoSincronizacion } from '../lib/offline';

const NAV_ITEMS = [
  { to: '/', label: 'Inicio', icon: '📊' },
  { to: '/estaciones', label: 'Estaciones', icon: '🏭' },
  { to: '/reportes', label: 'Reportes', icon: '📄' },
];

export function AppShell() {
  const { usuario, logout } = useAuth();
  const [pendientes, setPendientes] = useState(0);
  const [enLinea, setEnLinea] = useState(navigator.onLine);

  useEffect(() => {
    const detener = iniciarAutoSincronizacion(() => contarPendientes().then(setPendientes));
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
            <span className="text-[10px] bg-gauge-warn/15 text-gauge-warn border border-gauge-warn/30 px-2 py-0.5 rounded-full">
              {pendientes} por sincronizar
            </span>
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
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
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
    </div>
  );
}
