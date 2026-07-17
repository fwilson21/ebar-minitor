import { Navigate, Route, createRoutesFromElements } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { AppShell } from './components/AppShell';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Stations } from './pages/Stations';
import { StationDetail } from './pages/StationDetail';
import { VisitForm } from './pages/VisitForm';
import { Reports } from './pages/Reports';
import { Users } from './pages/Users';
import { Asignaciones } from './pages/Asignaciones';

function RutaProtegida({ children }: { children: React.ReactNode }) {
  const { usuario, cargando } = useAuth();
  if (cargando) return <p className="p-6 text-slate-400">Cargando…</p>;
  if (!usuario) return <Navigate to="/login" replace />;
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
      <Route path="estaciones/:id/nueva-visita" element={<VisitForm />} />
      <Route path="estaciones/:id/visitas/:visitaId/editar" element={<VisitForm />} />
      <Route path="reportes" element={<Reports />} />
      <Route path="usuarios" element={<Users />} />
      <Route path="asignaciones" element={<Asignaciones />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </>
);
