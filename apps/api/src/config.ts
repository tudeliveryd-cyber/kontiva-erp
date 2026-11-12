import { z } from 'zod';

const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().url(),
  DATABASE_OWNER_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  WEB_URL: z.string().url().default('http://localhost:5173'),
  SMTP_URL: z.string().optional().transform((v) => (v ? v : undefined)),
  MAIL_FROM: z.string().default('KONTIVA ERP <no-responder@kontiva.com.py>'),
  /** Detrás de un proxy (Nginx, balanceador): confiar en X-Forwarded-For. */
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
});

export type Config = z.infer<typeof esquema>;

let cache: Config | undefined;

export function config(): Config {
  if (!cache) {
    const r = esquema.safeParse(process.env);
    if (!r.success) {
      const detalle = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
      throw new Error(`Configuración inválida:\n  ${detalle}`);
    }
    if (r.data.NODE_ENV === 'production' && r.data.JWT_SECRET.startsWith('cambie-esto')) {
      throw new Error('JWT_SECRET de ejemplo en producción');
    }
    cache = r.data;
  }
  return cache;
}

/** Solo para pruebas. */
export function reiniciarConfig(): void {
  cache = undefined;
}
