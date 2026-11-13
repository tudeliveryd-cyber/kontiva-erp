import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // El paquete compartido se consume desde el código fuente (mismos esquemas que la API).
    alias: { '@kontiva/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts') },
  },
  build: {
    // Dos páginas: el ERP (index.html) y el Panel Master (master.html), servidos en dominios distintos.
    rollupOptions: { input: { index: path.resolve(__dirname, 'index.html'), master: path.resolve(__dirname, 'master.html') } },
  },
  server: {
    port: 5173,
    // Mismo origen para la API: la cookie de renovación (Path=/api/auth, SameSite=Strict) funciona en desarrollo.
    proxy: { '/api/master': 'http://localhost:3001', '/api': 'http://localhost:3000' },
    // Enlaces de prueba en GitHub Codespaces (https://<nombre>-5173.app.github.dev).
    allowedHosts: ['.app.github.dev'],
  },
  preview: {
    port: 5173,
    proxy: { '/api/master': 'http://localhost:3001', '/api': 'http://localhost:3000' },
    allowedHosts: ['.app.github.dev'],
  },
});
