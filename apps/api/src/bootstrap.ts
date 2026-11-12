import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { config } from './config';

/** Crea la aplicación con toda la configuración de seguridad (la usan main.ts y las pruebas). */
export async function crearApp(): Promise<INestApplication> {
  const c = config();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: c.NODE_ENV === 'test' ? ['error'] : ['log', 'warn', 'error'],
    bodyParser: false,
  });
  app.set('trust proxy', c.TRUST_PROXY);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '1mb' });
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: c.WEB_URL, credentials: true, allowedHeaders: ['Content-Type', 'Authorization', 'X-Kontiva', 'X-Autorizacion'] });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  return app;
}
