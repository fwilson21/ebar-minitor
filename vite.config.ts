import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';

// Certificado autofirmado (.cert/) solo para probar la cámara desde el celular
// en la red local — el navegador exige un origen seguro (HTTPS) para eso.
// Generado con: openssl req -x509 -newkey rsa:2048 -keyout .cert/key.pem -out .cert/cert.pem -days 365 -nodes
const certPath = 'C:/ebar-app/.cert/cert.pem';
const keyPath = 'C:/ebar-app/.cert/key.pem';
const tieneCertLocal = fs.existsSync(certPath) && fs.existsSync(keyPath);

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
