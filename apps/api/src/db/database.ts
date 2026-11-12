import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import { Pool, types } from 'pg';
import type { BaseDatos } from './tipos';

// bigint (int8) como string para no perder precisión; numeric como string (dinero exacto).
types.setTypeParser(types.builtins.INT8, (v) => v);
types.setTypeParser(types.builtins.NUMERIC, (v) => v);
// date como 'YYYY-MM-DD' (sin conversión a la zona horaria del servidor).
types.setTypeParser(types.builtins.DATE, (v) => v);

export type Tx = Transaction<BaseDatos>;

export function crearKysely(url: string, max = 10): Kysely<BaseDatos> {
  return new Kysely<BaseDatos>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: url, max, application_name: 'kontiva-api' }),
    }),
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Acceso a datos.
 *
 * `enEmpresa` abre una transacción y fija la empresa activa con SET LOCAL:
 * PostgreSQL filtra por RLS todo lo que se lea o escriba dentro. Es la única
 * forma de tocar tablas de negocio. `global` es para las tablas sin empresa
 * (cuenta, sesion, token_cuenta, intento_acceso, plan, permiso).
 */
@Injectable()
export class Db implements OnModuleDestroy {
  readonly k: Kysely<BaseDatos>;

  /** La API de empresas usa DATABASE_URL (kontiva_app); el Panel Master, DATABASE_MASTER_URL (kontiva_master). */
  constructor(url: string) {
    this.k = crearKysely(url);
  }

  async enEmpresa<T>(empresaId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (!UUID.test(empresaId)) throw new Error('empresaId inválido');
    return this.k.transaction().execute(async (tx) => {
      await sql`SELECT set_config('app.empresa_id', ${empresaId}, true)`.execute(tx);
      return fn(tx);
    });
  }

  async global<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.k.transaction().execute(fn);
  }

  async onModuleDestroy(): Promise<void> {
    await this.k.destroy();
  }
}
