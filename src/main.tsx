import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { routes } from './App'
import { AuthProvider } from './contexts/AuthContext'
import { GuardaVersion } from './components/GuardaVersion'
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

  // El chequeo de actualización "pasivo" del navegador (al registrar/navegar) puede tardar en
  // notarse si la pestaña se queda abierta un rato — se fuerza un chequeo apenas carga y cada 3
  // minutos mientras la app siga abierta, para que una planilla/reporte no se genere con el
  // código viejo por quedarse esperando la próxima recarga completa.
  navigator.serviceWorker.ready.then((registro) => {
    registro.update();
    setInterval(() => registro.update(), 3 * 60 * 1000);
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

// Se puede fallar al cargar una pantalla si esta pestaña quedó abierta desde ANTES de un
// despliegue nuevo: el código en memoria intenta bajar un archivo por su nombre viejo (Vite le
// cambia el nombre a cada archivo en cada despliegue) que el servidor ya no tiene — "Failed to
// fetch dynamically imported module", pantalla de error fea. Vite dispara este evento a propósito
// para este caso puntual; recargar la página sola (una sola vez, con el aviso guardado para no
// recargar en bucle si el problema fuera otro) baja el código nuevo y arregla solo, sin que el
// usuario tenga que entender ni describir el error.
window.addEventListener('vite:preloadError', () => {
  if (sessionStorage.getItem('recarga-por-modulo-viejo')) return;
  sessionStorage.setItem('recarga-por-modulo-viejo', '1');
  window.location.reload();
});
// Si la recarga de arriba funcionó, la app sigue andando bien pasados unos segundos — se limpia el
// aviso para que un despliegue nuevo, más adelante, en esta misma pestaña, también se pueda
// resolver solo (si no, después de la primera vez se dejaba de recargar automático el resto del
// día, aunque el motivo fuera genuinamente otro despliegue).
setTimeout(() => sessionStorage.removeItem('recarga-por-modulo-viejo'), 8000);

const router = createBrowserRouter(routes)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <GuardaVersion>
        <RouterProvider router={router} />
      </GuardaVersion>
    </AuthProvider>
  </React.StrictMode>,
)
