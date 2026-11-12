import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // El paquete compartido se consume desde el código fuente (mismos esquemas que la API).
    alias: { '@kontiva/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts') },
  },
  server: {
    port: 5173,
    // Mismo origen para la API: la cookie de renovación (Path=/api/auth, SameSite=Strict) funciona en desarrollo.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
