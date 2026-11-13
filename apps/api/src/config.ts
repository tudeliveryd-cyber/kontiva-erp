import { z } from 'zod';

const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().url(),
  DATABASE_OWNER_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  /** Clave AES-256 en base64 (32 bytes) para cifrar secretos TOTP y certificados. Fuera de la base. */
  CIFRADO_CLAVE: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'CIFRADO_CLAVE debe ser 32 bytes en base64 (openssl rand -base64 32)'),
  // Panel Master (servicio separado)
  DATABASE_MASTER_URL: z.string().url().optional(),
  JWT_MASTER_SECRET: z.string().min(32).optional(),
  MASTER_PORT: z.coerce.number().int().default(3001),
  MASTER_WEB_URL: z.string().url().default('http://localhost:5173'),
  /** Carpeta con la web compilada (apps/web/dist) para servirla desde la API en producción. */
  WEB_DIST: z.string().optional(),
  WEB_URL: z.string().url().default('http://localhost:5173'),
  SMTP_URL: z.string().optional().transform((v) => (v ? v : undefined)),
  MAIL_FROM: z.string().default('KONTIVA ERP <no-responder@kontiva.com.py>'),
  /** Detrás de un proxy (Nginx, balanceador): confiar en X-Forwarded-For. */
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  // Facturación electrónica (SIFEN)
  /** Emisor en segundo plano (envío de lotes y consulta de resultados). */
  SIFEN_EMISOR: z.enum(['activo', 'inactivo']).default('activo'),
  SIFEN_INTERVALO_MS: z.coerce.number().int().min(1000).default(15000),
  SIFEN_URL_TEST: z.string().url().default('https://sifen-test.set.gov.py'),
  SIFEN_URL_PRODUCCION: z.string().url().default('https://sifen.set.gov.py'),
  /** Certificados raíz adicionales (PEM) para validar el servidor de la DNIT, si hiciera falta. */
  SIFEN_CA: z.string().optional(),
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
    if (r.data.NODE_ENV === 'production' && (r.data.JWT_SECRET.startsWith('cambie-esto') || r.data.JWT_MASTER_SECRET?.startsWith('cambie-esto'))) {
      throw new Error('Secreto JWT de ejemplo en producción');
    }
    if (r.data.JWT_MASTER_SECRET && r.data.JWT_MASTER_SECRET === r.data.JWT_SECRET) {
      throw new Error('JWT_MASTER_SECRET debe ser distinto de JWT_SECRET');
    }
    cache = r.data;
  }
  return cache;
}

/** Solo para pruebas. */
export function reiniciarConfig(): void {
  cache = undefined;
}
