import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs';

// Certificado autofirmado (.cert/) solo para probar la cámara desde el celular
// en la red local — el navegador exige un origen seguro (HTTPS) para eso.
// Generado con: openssl req -x509 -newkey rsa:2048 -keyout .cert/key.pem -out .cert/cert.pem -days 365 -nodes
//   -subj "/CN=<IP-de-la-PC>" -addext "subjectAltName=IP:<IP-de-la-PC>,IP:127.0.0.1,DNS:localhost"
// (en Git Bash hay que anteponer MSYS_NO_PATHCONV=1 para que no rompa el "/CN=...")
//
// Si algún router/red bloquea las conexiones HTTPS con certificado autofirmado (pasó el
// 2026-07-13: TCP conectaba bien pero el celular recibía ERR_EMPTY_RESPONSE solo en HTTPS),
// se puede correr `EBAR_HTTP_LOCAL=1 npm run dev` para servir en HTTP plano. En ese caso, para
// que la cámara siga funcionando desde el celular, hay que agregar la URL en el celular en
// chrome://flags/#unsafely-treat-insecure-origin-as-secure (ej. http://192.168.200.14:5173) y
// reiniciar Chrome — Chrome tratará ese origen como seguro sin necesitar HTTPS real.
const certPath = 'C:/ebar-app/.cert/cert.pem';
const keyPath = 'C:/ebar-app/.cert/key.pem';
const tieneCertLocal = !process.env.EBAR_HTTP_LOCAL && fs.existsSync(certPath) && fs.existsSync(keyPath);

export default defineConfig({
  // "Editar distribución" (mover/agrandar bloques, ver GridEditable.tsx) usa la librería
  // react-grid-layout, que trae un log interno escrito para Node (lee `process.env.NODE_ENV`).
  // El navegador no tiene esa variable global, así que apenas se agarraba un bloque para
  // arrastrarlo tronaba con "process is not defined" y cortaba todo el arrastre/cambio de
  // tamaño antes de que pasara nada. Esto la rellena en el código que corre en el navegador.
  // (Bug real, sin relación con ningún rediseño visual — si vuelve a desaparecer de acá, es que
  // se revirtió por error junto con otra cosa.)
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
    // Sello de versión del build: el momento exacto (Date.now(), en ms) en que se compiló esta
    // copia de la app. Cada despliegue en Vercel genera uno nuevo y más alto. Lo usa el "candado
    // de versión" (src/lib/versionApp.ts + GuardaVersion.tsx): si el administrador exige una
    // versión mínima, todo cliente cuyo __BUILD_TIME__ sea menor queda bloqueado con la pantalla
    // "Actualiza la app" hasta que baje la nueva. En `npm run dev` es la hora de arranque del
    // servidor, sin efecto práctico.
    __BUILD_TIME__: JSON.stringify(Date.now()),
  },
  plugins: [
    react(),
    // Permite que la app se ABRA sin ninguna señal (no solo que la visita se guarde offline a
    // medio llenar, que ya funcionaba vía IndexedDB): el service worker deja en el celular una
    // copia de la app (JS/CSS/HTML) la primera vez que carga con señal, para poder abrirla luego
    // sin conexión — importante para las EBAR sin señal de datos.
    VitePWA({
      // Service worker escrito a mano (src/sw.ts) en vez de autogenerado — necesario para poder
      // agregar el listener de Background Sync (sincronizar visitas pendientes en segundo plano
      // en Android, ver src/lib/syncMotor.ts).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: {
        // Solo cachea los archivos propios de la app (el "cascarón"); las llamadas a Supabase
        // no pasan por acá, siguen su propio manejo offline ya existente en offline.ts. El
        // bundle principal pasa los 2 MiB por defecto (incluye pdfmake, para generar los
        // reportes) — hay que subir el límite o ese archivo se queda sin cachear y la app no
        // podría abrir sin conexión.
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        name: 'EBAR Monitor',
        short_name: 'EBAR Monitor',
        description: 'Monitoreo de estaciones de bombeo de aguas residuales',
        lang: 'es',
        theme_color: '#0B1521',
        background_color: '#0B1521',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    https: tieneCertLocal ? { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) } : undefined,
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
  },
});
