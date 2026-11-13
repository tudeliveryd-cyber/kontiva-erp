import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { AppModule } from './app.module';
import { config } from './config';

interface Opciones {
  modulo: unknown;
  prefijo: string;
  origen: string;
  /** Página HTML de la web a servir (index.html o master.html) si WEB_DIST está configurado. */
  pagina: string;
}

/** Crea una aplicación con toda la configuración de seguridad (la usan main, main-master y las pruebas). */
export async function crearApp(op: Opciones = { modulo: AppModule, prefijo: 'api', origen: config().WEB_URL, pagina: 'index.html' }): Promise<INestApplication> {
  const c = config();
  const app = await NestFactory.create<NestExpressApplication>(op.modulo as never, {
    logger: c.NODE_ENV === 'test' ? ['error'] : ['log', 'warn', 'error'],
    bodyParser: false,
  });
  app.set('trust proxy', c.TRUST_PROXY);
  app.disable('x-powered-by');
  // 4 MB: importaciones de hasta 5.000 filas.
  app.useBodyParser('json', { limit: '4mb' });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'img-src': ["'self'", 'data:'],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          // El PDV habla con el agente local de impresión (programa en la computadora de la caja).
          'connect-src': ["'self'", 'http://127.0.0.1:*', 'http://localhost:*'],
        },
      },
    }),
  );
  app.use(cookieParser());
  app.enableCors({ origin: op.origen, credentials: true, allowedHeaders: ['Content-Type', 'Authorization', 'X-Kontiva', 'X-Autorizacion'] });
  app.setGlobalPrefix(op.prefijo);
  app.enableShutdownHooks();

  // Producción: la misma aplicación sirve la web compilada (un solo contenedor por servicio).
  if (c.WEB_DIST && existsSync(path.join(c.WEB_DIST, op.pagina))) {
    const dist = path.resolve(c.WEB_DIST);
    app.use(
      express.static(dist, {
        index: false,
        maxAge: '1h',
        setHeaders: (res, f) => {
          if (f.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          // El service worker y el manifiesto de la app instalable se revisan siempre.
          else if (f.endsWith('sw.js') || f.endsWith('.webmanifest')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(dist, op.pagina));
    });
  }
  return app;
}
