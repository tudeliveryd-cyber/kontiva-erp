import { existsSync } from 'node:fs';
import path from 'node:path';

/** Carga .env de apps/api o de la raíz del repositorio, si existe (desarrollo). */
for (const archivo of [path.resolve(process.cwd(), '.env'), path.resolve(__dirname, '../../../.env')]) {
  if (existsSync(archivo)) {
    process.loadEnvFile(archivo);
    break;
  }
}

// Fechas de los documentos electrónicos (SIFEN) en hora de Paraguay, aunque el servidor esté en UTC.
process.env.TZ ??= 'America/Asuncion';
