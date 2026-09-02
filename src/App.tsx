import { Link, Navigate, Route, createRoutesFromElements } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { AppShell } from './components/AppShell';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Stations } from './pages/Stations';
import { StationDetail } from './pages/StationDetail';
import { VisitForm } from './pages/VisitForm';
import { VisitaDetalle } from './pages/VisitaDetalle';
import { Reports } from './pages/Reports';
import { InformeSemanal } from './pages/InformeSemanal';
import { Users } from './pages/Users';
import { Asignaciones } from './pages/Asignaciones';
import { CalendarioTurnos } from './pages/CalendarioTurnos';
import { Permisos } from './pages/Permisos';

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
