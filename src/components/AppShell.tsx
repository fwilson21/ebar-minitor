import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
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
import { iniciarPrecargaOffline } from '../lib/precargaOffline';
import { guardarCambiosDelFormularioActivo, hayCambiosSinGuardar } from '../lib/formularioActivo';
import { nombreCorto } from '../lib/nombres';
import { estaImpersonando, volverAAdministrador } from '../lib/impersonar';
import { ROL_LABEL } from '../lib/roles';
import { PieVersion } from './PieVersion';

// Digitador solo tiene Reportes y Turnos — nada de estaciones/monitoreo, que no es su trabajo.
const NAV_INICIO = { to: '/', label: 'Inicio', icon: '📊' };
const NAV_ESTACIONES = { to: '/estaciones', label: 'Estaciones', icon: '🏭' };
const NAV_REPORTES = { to: '/reportes', label: 'Reportes', icon: '📄' };
const NAV_ADMIN = { to: '/usuarios', label: 'Usuarios', icon: '👥' };
const NAV_ADMIN_SUPERVISOR = { to: '/asignaciones', label: 'Asignar', icon: '🗺️' };
const NAV_TURNOS = { to: '/calendario-turnos', label: 'Turnos', icon: '📅' };
const NAV_PERMISOS = { to: '/permisos', label: 'Permisos', icon: '🔐' };

// Qué pantalla (id usado en pantallasEditables.ts / layouts_admin / configuracion_ancho_contenido)
// corresponde a cada ruta — así AppShell sabe qué ancho guardado aplicarle al contenido de la
// pantalla que está activa. Las rutas que no están acá (ej. detalle de una estación) no tienen
// "Editar distribución" propio y usan el ancho de respaldo ('global').
const PANTALLA_POR_RUTA: Record<string, string> = {
  '/': 'dashboard',
  '/estaciones': 'estaciones',
  '/reportes': 'reportes',
  '/usuarios': 'usuarios',
  '/asignaciones': 'asignaciones',
  '/calendario-turnos': 'turnos',
  '/permisos': 'permisos',
};

// Formulario de visita (nueva o editar) y detalle de estación: la ruta real trae :id/:visitaId de
// por medio (estaciones/abc123/nueva-visita, estaciones/abc123/visitas/xyz/editar,
// estaciones/abc123 a secas), así que no calzan con una clave fija de PANTALLA_POR_RUTA — se
// resuelven aparte por patrón.
const RUTA_VISITA_FORMULARIO = /^\/estaciones\/[^/]+\/(nueva-visita|visitas\/[^/]+\/editar)$/;
const RUTA_ESTACION_DETALLE = /^\/estaciones\/[^/]+$/;

function pantallaPorRuta(pathname: string): string {
  if (PANTALLA_POR_RUTA[pathname]) return PANTALLA_POR_RUTA[pathname];
  if (RUTA_VISITA_FORMULARIO.test(pathname)) return 'visita_formulario';
  if (RUTA_ESTACION_DETALLE.test(pathname)) return 'estacion_detalle';
  // No entra a PANTALLA_POR_RUTA a propósito: no es un ítem del menú principal (se entra desde el
  // botón de Reportes), así que mantiene el "← Volver" de más abajo en vez de perderlo.
  if (pathname === '/informe-semanal') return 'informe_semanal';
  return 'global';
}

// true solo en las pantallas de entrada directa del menú lateral (las claves de
// PANTALLA_POR_RUTA) — en cualquier otra ruta (detalle de estación, formulario de visita, ver
// visita del historial, etc.) se muestra el botón "← Volver" de más abajo, para no depender del
// botón de atrás del navegador/celular.
function esPantallaPrincipal(pathname: string): boolean {
  return pathname in PANTALLA_POR_RUTA;
}

export function AppShell() {
  const { usuario, logout, tienePermiso, anchoDePantalla, soloLectura } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const anchoActivo = anchoDePantalla(pantallaPorRuta(location.pathname));
  const [pendientes, setPendientes] = useState(0);
  const [enLinea, setEnLinea] = useState(navigator.onLine);
  const [mostrarPanel, setMostrarPanel] = useState(false);
  const [detallePendientes, setDetallePendientes] = useState<VisitaPendiente[]>([]);
  const [sincronizando, setSincronizando] = useState(false);
  const [mensajeSync, setMensajeSync] = useState<string | null>(null);
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [mostrarConfirmarSalir, setMostrarConfirmarSalir] = useState(false);
  const [guardandoYSaliendo, setGuardandoYSaliendo] = useState(false);
  const [impersonando, setImpersonando] = useState(estaImpersonando());
  const [volviendo, setVolviendo] = useState(false);

  // Se re-chequea cada vez que cambia el perfil cargado (ej. justo después de "Entrar como",
  // cuando la app recién terminó de recargar con la identidad de la otra persona).
  useEffect(() => {
    setImpersonando(estaImpersonando());
  }, [usuario?.id]);

  async function manejarVolverAAdmin() {
    setVolviendo(true);
    const { error } = await volverAAdministrador();
    if (error) {
      alert(`No se pudo volver a la cuenta de administrador: ${error}`);
      setVolviendo(false);
      return;
    }
    // Navegación normal de React Router, NO window.location.href: una recarga real de página
    // pasa por el Service Worker (necesario para que la app abra sin señal), que puede servir
    // una versión vieja guardada y dejar la pantalla en blanco hasta forzar un refresco manual.
    // AuthContext ya se entera solo del cambio de sesión (onAuthStateChange) y actualiza
    // `usuario`; el <Outlet key={usuario?.id}> de abajo se encarga de refrescar cada pantalla.
    setVolviendo(false);
    navigate('/');
  }

  useEffect(() => {
    const detener = iniciarAutoSincronizacion((r) => {
      contarPendientes().then(setPendientes);
      if (r.ok > 0) setMensajeSync(`${r.ok} visita(s) sincronizada(s).`);
    });
    // Baja al dispositivo TODAS las EBAR activas + sus bombas apenas hay señal (acá y cada vez
    // que vuelve la conexión) — así cualquier estación se puede abrir sin conexión aunque nunca
    // antes se haya abierto puntualmente con señal (ver precargaOffline.ts para el detalle del
    // problema que resuelve).
    const detenerPrecarga = iniciarPrecargaOffline();
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
      detenerPrecarga();
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

  const esDigitador = usuario?.rol === 'digitador';

  const navItems = [
    // Digitador no tiene Inicio ni Estaciones — su trabajo es Turnos/Reportes, no monitoreo.
    ...(esDigitador ? [] : [NAV_INICIO, NAV_ESTACIONES]),
    NAV_REPORTES,
    ...(usuario?.rol === 'administrador' || usuario?.rol === 'supervisor' ? [NAV_ADMIN_SUPERVISOR] : []),
    ...(usuario?.rol === 'administrador' ||
    ['crear_usuarios', 'editar_usuarios', 'activar_desactivar_usuarios', 'restablecer_password_usuarios', 'eliminar_usuarios'].some(tienePermiso)
      ? [NAV_ADMIN]
      : []),
    // Turnos: administrador (pantalla completa), digitador (calendario en modo consulta +
    // planillas completas, ver CalendarioTurnos.tsx), o quien tenga marcar_turnos/
    // gestionar_feriados (ver /permisos) — Permisos exclusivo del administrador.
    ...(usuario?.rol === 'administrador' ||
    esDigitador ||
    ['marcar_turnos', 'gestionar_feriados'].some(tienePermiso)
      ? [NAV_TURNOS]
      : []),
    ...(usuario?.rol === 'administrador' ? [NAV_PERMISOS] : []),
  ];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Barra de estado de sincronización — antes solo había una burbuja chiquita pegada al
          nombre, dentro del header de la derecha (se perdía de vista al bajar la pantalla, y en
          celular quedaba escondida detrás del menú ☰). Ahora es una barra de ancho completo,
          pegada arriba de todo (igual que el aviso de "Estás viendo la app como…" de abajo), fija
          mientras se hace scroll, con acceso directo a "Sincronizar ahora" sin tener que abrir el
          panel primero. Solo aparece mientras hay algo pendiente; con 0 pendientes desaparece
          sola. Se oculta mientras el panel de detalle está abierto (`!mostrarPanel`): los dos
          quedan "pegados arriba" al mismo tiempo (ambos con `top-0`) y se superponían — el panel
          ya muestra lo mismo con más detalle, no hace falta ver la barra encima.
          Color sólido (no el tinte clarito de antes) + letra más grande + botón real (no solo
          subrayado) para "Sincronizar ahora" — pedido explícito del usuario: "más grande para que
          llame la atención y se haga la sincronización" (la sincronización automática en 2do
          plano no siempre agarra a la primera, ver [[project_offline_precarga_y_sync]] — esta
          barra es el respaldo para que el operador la note y la dispare a mano). */}
      {pendientes > 0 && !mostrarPanel && (
        <div className="w-full bg-gauge-warn text-white text-sm sm:text-base px-4 py-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-center sticky top-0 z-40 shadow-md">
          <span className="font-bold flex items-center gap-2">
            <span className="text-xl leading-none">🔄</span>
            {pendientes} visita{pendientes === 1 ? '' : 's'} por sincronizar
            {!enLinea && ' — esperando señal'}
          </span>
          <button
            onClick={manejarSincronizar}
            disabled={sincronizando || !enLinea}
            className="bg-white text-gauge-warn font-bold rounded-lg px-3 py-1.5 whitespace-nowrap disabled:opacity-50 active:scale-[0.98] transition"
          >
            {sincronizando ? 'Sincronizando…' : !enLinea ? 'Sin conexión' : 'Sincronizar ahora'}
          </button>
          <button onClick={abrirPanel} className="underline decoration-2 font-semibold whitespace-nowrap">
            Ver detalle
          </button>
        </div>
      )}
      {soloLectura && (
        <div className="w-full bg-sky-600 text-white text-xs sm:text-sm px-4 py-2 text-center sticky top-0 z-40">
          🖥️ Modo consulta (computadora) — puedes ver todo y generar informes, pero no registrar ni
          editar visitas. Para eso usa tu teléfono.
        </div>
      )}
      {impersonando && (
        <div className="bg-amber-400 text-amber-950 text-xs sm:text-sm px-4 py-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center sticky top-0 z-40">
          <span>
            🎭 Estás viendo la app como <strong>{usuario?.nombre_completo}</strong>
            {usuario ? ` (${ROL_LABEL[usuario.rol]})` : ''} — cualquier cambio que hagas es real.
          </span>
          <button
            onClick={manejarVolverAAdmin}
            disabled={volviendo}
            className="underline font-semibold whitespace-nowrap"
          >
            {volviendo ? 'Volviendo…' : 'Volver a ser administrador'}
          </button>
        </div>
      )}
      <div className="flex flex-col lg:flex-row flex-1 min-h-0">
      <aside className="hidden lg:flex lg:flex-col lg:w-[220px] lg:shrink-0 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto bg-panel-800 border-r border-panel-600/60">
        <div className="px-4 py-3 border-b border-panel-600/60">
          <span className="text-lg font-bold tracking-tight">EBAR<span className="text-gauge-ok">·</span>Monitor</span>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                  isActive ? 'bg-panel-900 text-gauge-ok' : 'text-slate-600'
                }`
              }
            >
              <span className="text-lg leading-none">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex flex-col flex-1 min-w-0">
        <header className="bg-panel-800 border-b border-panel-600/60 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold tracking-tight lg:hidden">EBAR<span className="text-gauge-ok">·</span>Monitor</span>
            {!enLinea && (
              <span className="text-[10px] bg-gauge-warn/15 text-gauge-warn border border-gauge-warn/30 px-2 py-0.5 rounded-full">
                Sin conexión
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600 truncate max-w-[7rem] sm:max-w-none">
              {usuario?.nombre_completo ? nombreCorto(usuario.nombre_completo) : ''}
            </span>
            {!soloLectura && (
              <button onClick={() => setMostrarPassword(true)} className="text-sm text-slate-600 hover:text-slate-900">
                🔑
              </button>
            )}
            <button onClick={manejarClickSalir} className="text-sm text-slate-600 hover:text-slate-900">
              Salir
            </button>
          </div>
        </header>

        {/* max-w-3xl/lg:max-w-none de antes se reemplaza por un ancho dinámico por pantalla
            (ajustable por el administrador con "Editar distribución" en cada pantalla, ver
            anchoContenido.ts): en celular el viewport ya es más angosto que cualquier valor
            configurado (900-2200px), así que no hace falta un breakpoint aparte — el mismo style
            aplica sin efecto en celular. */}
        <main
          className="flex-1 px-4 py-4 w-full mx-auto pb-24 lg:pb-4"
          style={{ maxWidth: `${anchoActivo}px` }}
        >
          {!esPantallaPrincipal(location.pathname) && (
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="boton-secundario text-sm px-3 py-1.5 mb-4"
            >
              ← Volver
            </button>
          )}

          {/* key={usuario?.id}: si cambia la identidad (Entrar como / Volver a ser
              administrador) sin cambiar de ruta (ej. ya estabas en "/"), esto fuerza a React a
              desmontar y volver a montar la pantalla activa para que recargue sus propios datos
              con la sesión nueva — si no, quedaría mostrando datos de la identidad anterior. */}
          <Outlet key={usuario?.id} />

          <PieVersion />
        </main>
      </div>
      </div>

      {/* overflow-x-auto: en celulares angostos, 6 opciones no entran todas a la vez — se
          desliza el dedo sobre la cinta para ver/tocar las que quedan fuera de pantalla (ej.
          "Usuarios" a la derecha). shrink-0 evita que el navegador las achique en vez de dejarlas
          desplazables. */}
      <nav className="fixed bottom-0 left-0 right-0 bg-panel-800 border-t border-panel-600/60 flex justify-around overflow-x-auto py-2 z-10 lg:hidden">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 shrink-0 min-w-[4.25rem] px-2 py-1.5 rounded-lg text-xs ${
                isActive ? 'text-gauge-ok' : 'text-slate-600'
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
            <p className="text-xs text-slate-600">
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
          <button onClick={onCerrar} className="text-slate-600 hover:text-slate-900 text-lg leading-none">✕</button>
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
          <button onClick={onCerrar} className="text-slate-600 hover:text-slate-900 text-lg leading-none">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-2">
          {pendientes.length === 0 ? (
            <p className="text-sm text-gauge-ok text-center py-4">Todo sincronizado ✓</p>
          ) : (
            pendientes.map((p) => (
              <div key={p.cliente_uuid} className="tarjeta p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-700">
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
