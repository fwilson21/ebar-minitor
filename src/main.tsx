import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { routes } from './App'
import { AuthProvider } from './contexts/AuthContext'
import { supabase } from './lib/supabase'
import './index.css'

// El service worker (PWA offline) puede quedar activo de una visita anterior mientras esta
// pestaña sigue corriendo el código viejo en memoria. Sin este listener, hacía falta recargar
// dos veces para que una actualización se notara — acá se recarga sola en cuanto el navegador
// termina de instalar la versión nueva en segundo plano.
if ('serviceWorker' in navigator) {
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargando) return;
    recargando = true;
    window.location.reload();
  });

  // El service worker sincroniza en segundo plano (Background Sync, Android) usando su propia
  // copia del token de sesión — si tuvo que renovarlo (venció mientras la app estaba cerrada),
  // avisa acá para que supabase-js en esta pestaña use el mismo token nuevo, en vez de quedarse
  // con uno vencido o intentar renovarlo por su cuenta al mismo tiempo.
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.tipo === 'sesion-renovada') {
      supabase.auth.setSession({
        access_token: event.data.access_token,
        refresh_token: event.data.refresh_token,
      });
    }
  });
}

const router = createBrowserRouter(routes)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>,
)
