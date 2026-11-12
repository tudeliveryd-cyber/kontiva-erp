import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Base de pruebas: se recrea en cada ejecución (test/global-setup.ts).
const HOST = process.env.PG_HOST ?? 'localhost:5432';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: { alias: { '@kontiva/shared': path.resolve(__dirname, '../../packages/shared/src') } },
  test: {
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: `postgresql://kontiva_app:kontiva_app@${HOST}/kontiva_test`,
      DATABASE_OWNER_URL: `postgresql://kontiva_owner:kontiva_owner@${HOST}/kontiva_test`,
      PG_ADMIN_URL: process.env.PG_ADMIN_URL ?? `postgresql://postgres:postgres@${HOST}/postgres`,
      JWT_SECRET: 'secreto-de-pruebas-solo-para-tests-0123456789abcdef',
      WEB_URL: 'http://localhost:5173',
      CIFRADO_CLAVE: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
      DATABASE_MASTER_URL: `postgresql://kontiva_master:kontiva_master@${HOST}/kontiva_test`,
      JWT_MASTER_SECRET: 'secreto-master-de-pruebas-distinto-0123456789abcdef',
    },
  },
});
