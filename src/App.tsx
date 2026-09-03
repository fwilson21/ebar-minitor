import { lazy } from 'react';
import { Link, Navigate, Route, createRoutesFromElements } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { AppShell } from './components/AppShell';
import { Login } from './pages/Login';

// Cada pantalla se carga sola (lazy), en vez de venir todas metidas en un solo paquete que hay que
// bajar entero para ver hasta la más chica (ej. Usuarios) — el usuario reportó que la app tardaba
// mucho en cargar cada ventana (2026-09-03). La causa real: TODO se empaquetaba junto, incluida
// pdfmake (la librería de PDF, con sus fuentes embebidas — ~850 KB solo esa parte) que en realidad
// únicamente hace falta en Reportes/Informe Semanal/Turnos/Historial de estación, nunca para abrir
// Usuarios o Inicio. `Login` se deja normal (siempre es la primera pantalla, no vale la pena
// separarla) — el resto pasa por `lazy()`, y AppShell.tsx envuelve el `<Outlet>` en `<Suspense>`
// para mostrar "Cargando…" mientras se baja el trozo de esa pantalla puntual.
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Stations = lazy(() => import('./pages/Stations').then((m) => ({ default: m.Stations })));
const StationDetail = lazy(() => import('./pages/StationDetail').then((m) => ({ default: m.StationDetail })));
const VisitForm = lazy(() => import('./pages/VisitForm').then((m) => ({ default: m.VisitForm })));
const VisitaDetalle = lazy(() => import('./pages/VisitaDetalle').then((m) => ({ default: m.VisitaDetalle })));
const Reports = lazy(() => import('./pages/Reports').then((m) => ({ default: m.Reports })));
const InformeSemanal = lazy(() => import('./pages/InformeSemanal').then((m) => ({ default: m.InformeSemanal })));
const Users = lazy(() => import('./pages/Users').then((m) => ({ default: m.Users })));
const Asignaciones = lazy(() => import('./pages/Asignaciones').then((m) => ({ default: m.Asignaciones })));
const CalendarioTurnos = lazy(() => import('./pages/CalendarioTurnos').then((m) => ({ default: m.CalendarioTurnos })));
const Permisos = lazy(() => import('./pages/Permisos').then((m) => ({ default: m.Permisos })));

function RutaProtegida({ children }: { children: React.ReactNode }) {
  const { usuario, cargando } = useAuth();
  if (cargando) return <p className="p-6 text-slate-600">Cargando…</p>;
  if (!usuario) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Envuelve las pantallas que ESCRIBEN datos (registrar/editar visita). En "modo consulta"
 * (operador desde una computadora) muestra un aviso en vez del formulario — desde la compu solo
 * se puede ver y generar informes. */
function RutaSoloEscritura({ children }: { children: React.ReactNode }) {
  const { soloLectura } = useAuth();
  if (soloLectura) {
    return (
      <div className="tarjeta p-6 border-2 border-sky-500/50 bg-sky-500/10 text-center space-y-3">
        <p className="text-4xl">🖥️</p>
        <h1 className="text-lg font-bold uppercase tracking-wide text-slate-800">Modo consulta</h1>
        <p className="text-sm text-slate-700">
          Estás en una computadora, en modo consulta: puedes ver toda la información y generar
          informes, pero para registrar o editar visitas usa tu teléfono de trabajo.
        </p>
        <Link to="/estaciones" className="text-xs text-slate-600 hover:text-slate-900 underline">
          ← Volver a Estaciones
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}

export const routes = createRoutesFromElements(
  <>
    <Route path="/login" element={<Login />} />
    <Route
      path="/"
      element={
        <RutaProtegida>
          <AppShell />
        </RutaProtegida>
      }
    >
      <Route index element={<Dashboard />} />
      <Route path="estaciones" element={<Stations />} />
      <Route path="estaciones/:id" element={<StationDetail />} />
      <Route
        path="estaciones/:id/nueva-visita"
        element={
          <RutaSoloEscritura>
            <VisitForm />
          </RutaSoloEscritura>
        }
      />
      <Route
        path="estaciones/:id/visitas/:visitaId/editar"
        element={
          <RutaSoloEscritura>
            <VisitForm />
          </RutaSoloEscritura>
        }
      />
      <Route path="estaciones/:id/visitas/:visitaId/ver" element={<VisitaDetalle />} />
      <Route path="reportes" element={<Reports />} />
      <Route path="informe-semanal" element={<InformeSemanal />} />
      <Route path="usuarios" element={<Users />} />
      <Route path="asignaciones" element={<Asignaciones />} />
      <Route path="calendario-turnos" element={<CalendarioTurnos />} />
      <Route path="permisos" element={<Permisos />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </>
);
