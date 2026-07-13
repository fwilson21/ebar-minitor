import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
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
  plugins: [react()],
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
