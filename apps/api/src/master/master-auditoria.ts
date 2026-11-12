import type { Kysely, Transaction } from 'kysely';
import type { BaseDatos } from '../db/tipos';

export interface QuienMaster {
  usuarioId: string | null;
  ip?: string | null;
  agente?: string | null;
}

/** Auditoría del Panel Master (esquema master, solo inserción). */
export async function auditarMaster(
  db: Kysely<BaseDatos> | Transaction<BaseDatos>,
  quien: QuienMaster,
  ev: { accion: string; entidad: string; entidadId?: string | null; antes?: unknown; despues?: unknown },
): Promise<void> {
  await db
    .insertInto('master.auditoria')
    .values({
      usuario_id: quien.usuarioId,
      accion: ev.accion,
      entidad: ev.entidad,
      entidad_id: ev.entidadId ?? null,
      antes: ev.antes === undefined ? null : JSON.stringify(ev.antes),
      despues: ev.despues === undefined ? null : JSON.stringify(ev.despues),
      ip: quien.ip ?? null,
      agente: quien.agente ?? null,
    })
    .execute();
}
