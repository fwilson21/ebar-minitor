import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { routes } from './App'
import { AuthProvider } from './contexts/AuthContext'
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
}

const router = createBrowserRouter(routes)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>,
)
