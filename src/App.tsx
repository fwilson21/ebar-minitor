import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { AppShell } from './components/AppShell';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Stations } from './pages/Stations';
import { StationDetail } from './pages/StationDetail';
import { VisitForm } from './pages/VisitForm';
import { Reports } from './pages/Reports';
import { Bootstrap } from './pages/Bootstrap';
import { CreateAdmin } from './pages/CreateAdmin';

function RutaProtegida({ children }: { children: React.ReactNode }) {
  const { usuario, cargando } = useAuth();
  if (cargando) return <p className="p-6 text-slate-400">Cargando…</p>;
  if (!usuario) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/bootstrap" element={<Bootstrap />} />
      <Route path="/crear-admin" element={<CreateAdmin />} />
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
        <Route path="reportes" element={<Reports />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
