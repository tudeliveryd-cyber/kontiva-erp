import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { PERMISOS } from '@kontiva/shared';

/**
 * Migraciones versionadas y reversibles: migrations/NNNN_nombre.up.sql / .down.sql.
 * Se ejecutan con el rol dueño del esquema, cada una en su transacción.
 * Una migración aplicada no se edita: su checksum se verifica en cada ejecución.
 */

export const DIR_MIGRACIONES = path.resolve(__dirname, '../../migrations');

interface Migracion {
  version: string;
  nombre: string;
  up: string;
  down: string | null;
  checksum: string;
}

export function leerMigraciones(dir = DIR_MIGRACIONES): Migracion[] {
  const archivos = readdirSync(dir).filter((f) => /^\d{4}_.+\.up\.sql$/.test(f)).sort();
  return archivos.map((f) => {
    const [version, ...resto] = f.replace('.up.sql', '').split('_');
    const up = readFileSync(path.join(dir, f), 'utf8');
    const archivoDown = path.join(dir, f.replace('.up.sql', '.down.sql'));
    let down: string | null = null;
    try {
      down = readFileSync(archivoDown, 'utf8');
    } catch {
      down = null;
    }
    return { version: version!, nombre: resto.join('_'), up, down, checksum: createHash('sha256').update(up).digest('hex') };
  });
}

async function asegurarTabla(c: Client): Promise<void> {
  await c.query(`CREATE TABLE IF NOT EXISTS schema_migracion (
    version text PRIMARY KEY, nombre text NOT NULL, checksum text NOT NULL,
    aplicado_en timestamptz NOT NULL DEFAULT now())`);
}

export async function sincronizarPermisos(c: Client): Promise<void> {
  const codigos = PERMISOS.map((p) => p.codigo);
  await c.query('BEGIN');
  try {
    for (const p of PERMISOS) {
      await c.query(
        `INSERT INTO permiso (codigo, recurso, accion, nombre, modulo, vigente) VALUES ($1,$2,$3,$4,$5,true)
         ON CONFLICT (codigo) DO UPDATE SET recurso = EXCLUDED.recurso, accion = EXCLUDED.accion,
           nombre = EXCLUDED.nombre, modulo = EXCLUDED.modulo, vigente = true`,
        [p.codigo, p.recurso, p.accion, p.nombre, p.modulo],
      );
    }
    // Los permisos retirados del catálogo no se borran (hay referencias): se marcan no vigentes.
    await c.query(`UPDATE permiso SET vigente = false WHERE NOT (codigo = ANY($1::text[]))`, [codigos]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  }
}

export async function migrar(url: string, log: (m: string) => void = console.log): Promise<string[]> {
  const c = new Client({ connectionString: url });
  await c.connect();
  const aplicadas: string[] = [];
  try {
    await c.query(`SELECT pg_advisory_lock(727001)`); // evita dos migradores a la vez
    await asegurarTabla(c);
    const previas = new Map(
      (await c.query<{ version: string; checksum: string }>('SELECT version, checksum FROM schema_migracion')).rows.map(
        (r) => [r.version, r.checksum],
      ),
    );
    for (const m of leerMigraciones()) {
      const previa = previas.get(m.version);
      if (previa) {
        if (previa !== m.checksum) {
          throw new Error(`La migración ${m.version}_${m.nombre} fue modificada después de aplicarse. Cree una nueva.`);
        }
        continue;
      }
      log(`Aplicando ${m.version}_${m.nombre}...`);
      await c.query('BEGIN');
      try {
        await c.query(m.up);
        await c.query('INSERT INTO schema_migracion (version, nombre, checksum) VALUES ($1, $2, $3)', [
          m.version,
          m.nombre,
          m.checksum,
        ]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`Falló ${m.version}_${m.nombre}: ${(e as Error).message}`);
      }
      aplicadas.push(m.version);
    }
    await sincronizarPermisos(c);
    log(aplicadas.length ? `Migraciones aplicadas: ${aplicadas.join(', ')}` : 'La base ya está al día.');
    return aplicadas;
  } finally {
    await c.query(`SELECT pg_advisory_unlock(727001)`).catch(() => undefined);
    await c.end();
  }
}

export async function revertirUltima(url: string, log: (m: string) => void = console.log): Promise<string | null> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await asegurarTabla(c);
    const r = await c.query<{ version: string }>('SELECT version FROM schema_migracion ORDER BY version DESC LIMIT 1');
    const ultima = r.rows[0]?.version;
    if (!ultima) {
      log('No hay migraciones aplicadas.');
      return null;
    }
    const m = leerMigraciones().find((x) => x.version === ultima);
    if (!m?.down) throw new Error(`La migración ${ultima} no tiene archivo .down.sql`);
    log(`Revirtiendo ${m.version}_${m.nombre}...`);
    await c.query('BEGIN');
    try {
      await c.query(m.down);
      await c.query('DELETE FROM schema_migracion WHERE version = $1', [ultima]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
    return ultima;
  } finally {
    await c.end();
  }
}
