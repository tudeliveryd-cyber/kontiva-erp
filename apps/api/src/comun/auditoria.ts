import type { Tx } from '../db/database';
import type { Origen } from './contexto';

export interface EventoAuditoria {
  accion: string;
  entidad: string;
  entidadId?: string | null;
  antes?: unknown;
  despues?: unknown;
  autorizadoPor?: string | null;
}

const OCULTOS = new Set(['hash_contrasena', 'hash_pin', 'hash_token', 'hash_token_anterior', 'totp_secreto']);

function limpiar(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  return JSON.stringify(v, (k, val) => (OCULTOS.has(k) ? '[oculto]' : val));
}

/**
 * Registra un evento en la misma transacción que el cambio: si el cambio se revierte,
 * el registro también; si se confirma, el registro es inmutable.
 */
export async function auditar(
  tx: Tx,
  quien: { empresaId: string; usuarioId: string | null; cuentaId: string | null } & Partial<Origen>,
  ev: EventoAuditoria,
): Promise<void> {
  await tx
    .insertInto('auditoria')
    .values({
      empresa_id: quien.empresaId,
      usuario_id: quien.usuarioId,
      cuenta_id: quien.cuentaId,
      autorizado_por: ev.autorizadoPor ?? null,
      accion: ev.accion,
      entidad: ev.entidad,
      entidad_id: ev.entidadId ?? null,
      antes: limpiar(ev.antes),
      despues: limpiar(ev.despues),
      ip: quien.ip ?? null,
      agente: quien.agente ?? null,
    })
    .execute();
}
