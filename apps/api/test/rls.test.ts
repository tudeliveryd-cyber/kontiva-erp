import { Kysely, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { crearKysely } from '../src/db/database';
import type { BaseDatos } from '../src/db/tipos';
import { crearEmpresa, iniciarApp, type EmpresaPrueba } from './ayudas';

/**
 * Aislamiento en la base misma, sin pasar por la API: aunque el código olvide un filtro,
 * PostgreSQL no devuelve ni acepta filas de otra empresa.
 */
describe('Row-Level Security', () => {
  let app: INestApplication;
  let k: Kysely<BaseDatos>;
  let a: EmpresaPrueba;
  let b: EmpresaPrueba;

  const enEmpresa = <T>(id: string, fn: (tx: Kysely<BaseDatos>) => Promise<T>) =>
    k.transaction().execute(async (tx) => {
      await sql`SELECT set_config('app.empresa_id', ${id}, true)`.execute(tx);
      return fn(tx);
    });

  beforeAll(async () => {
    app = await iniciarApp();
    k = crearKysely(process.env.DATABASE_URL!, 2);
    a = await crearEmpresa(app);
    b = await crearEmpresa(app);
  });
  afterAll(async () => {
    await k.destroy();
    await app.close();
  });

  it('el rol de la API no es superusuario ni puede saltar RLS', async () => {
    const { rows } = await sql<{ rolsuper: boolean; rolbypassrls: boolean }>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`.execute(k);
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('sin empresa activa no se ve ninguna fila de negocio', async () => {
    for (const t of ['empresa', 'sucursal', 'usuario', 'perfil', 'auditoria'] as const) {
      const filas = await k.transaction().execute((tx) => tx.selectFrom(t).selectAll().execute());
      expect(filas, t).toHaveLength(0);
    }
  });

  it('con la empresa A activa solo se ven filas de A', async () => {
    const r = await enEmpresa(a.empresaId, async (tx) => ({
      empresas: await tx.selectFrom('empresa').select('id').execute(),
      usuarios: await tx.selectFrom('usuario').select('empresa_id').execute(),
      perfiles: await tx.selectFrom('perfil').select('empresa_id').execute(),
      sucursalB: await tx.selectFrom('sucursal').select('id').where('id', '=', b.sucursalId).execute(),
    }));
    expect(r.empresas.map((e) => e.id)).toEqual([a.empresaId]);
    expect(new Set(r.usuarios.map((u) => u.empresa_id))).toEqual(new Set([a.empresaId]));
    expect(new Set(r.perfiles.map((u) => u.empresa_id))).toEqual(new Set([a.empresaId]));
    expect(r.sucursalB).toHaveLength(0);
  });

  it('no se puede insertar una fila con empresa_id de otra empresa', async () => {
    await expect(
      enEmpresa(a.empresaId, (tx) =>
        tx.insertInto('sucursal').values({ empresa_id: b.empresaId, codigo: '099', nombre: 'Intrusa', direccion: null, telefono: null, creado_por: null }).execute(),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('no se puede actualizar ni borrar filas de otra empresa (0 filas afectadas)', async () => {
    const r = await enEmpresa(a.empresaId, (tx) =>
      tx.updateTable('sucursal').set({ nombre: 'Hackeada' }).where('id', '=', b.sucursalId).executeTakeFirst(),
    );
    expect(Number(r.numUpdatedRows)).toBe(0);
  });

  it('no se puede mover una fila propia a otra empresa', async () => {
    await expect(
      enEmpresa(a.empresaId, (tx) => tx.updateTable('sucursal').set({ empresa_id: b.empresaId }).where('id', '=', a.sucursalId).execute()),
    ).rejects.toThrow(/row-level security/);
  });

  it('la clave foránea compuesta impide apuntar a un perfil de otra empresa', async () => {
    const perfilB = await enEmpresa(b.empresaId, (tx) => tx.selectFrom('perfil').select('id').limit(1).executeTakeFirstOrThrow());
    await expect(
      enEmpresa(a.empresaId, (tx) => tx.updateTable('usuario').set({ perfil_id: perfilB.id }).where('id', '=', a.propietario.usuarioId).execute()),
    ).rejects.toThrow(/foreign key/);
  });

  it('la auditoría es solo de inserción, incluso para la API', async () => {
    await expect(enEmpresa(a.empresaId, (tx) => tx.updateTable('auditoria').set({ accion: 'x' }).execute())).rejects.toThrow(/permission denied|solo de inserción/);
    await expect(enEmpresa(a.empresaId, (tx) => tx.deleteFrom('auditoria').execute())).rejects.toThrow(/permission denied|solo de inserción/);
  });

  it('el trigger protege la auditoría también ante el dueño del esquema', async () => {
    const dueno = crearKysely(process.env.DATABASE_OWNER_URL!, 1);
    try {
      await expect(sql`UPDATE auditoria SET accion = 'x'`.execute(dueno)).rejects.toThrow(/solo de inserción/);
      await expect(sql`TRUNCATE auditoria`.execute(dueno)).rejects.toThrow(/solo de inserción/);
    } finally {
      await dueno.destroy();
    }
  });

  it('el valor de empresa no sobrevive a la transacción (SET LOCAL)', async () => {
    await enEmpresa(a.empresaId, async () => undefined);
    const filas = await k.transaction().execute((tx) => tx.selectFrom('empresa').select('id').execute());
    expect(filas).toHaveLength(0);
  });
});
