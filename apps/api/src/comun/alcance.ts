import { sql } from 'kysely';
import type { Tx } from '../db/database';
import type { Ctx } from './contexto';
import { noEncontrado } from './errores';

/** Con alcance menor a empresa, solo se opera en las sucursales asignadas. */
export function enSucursal(ctx: Ctx, sucursalId: string): boolean {
  return ctx.esPropietario || ctx.alcance === 'empresa' || ctx.sucursalIds.includes(sucursalId);
}

export function exigirSucursal(ctx: Ctx, sucursalId: string, que = 'Registro'): void {
  if (!enSucursal(ctx, sucursalId)) throw noEncontrado(que);
}

/** Lista de precios predeterminada de la empresa. */
export async function listaPredeterminada(tx: Tx): Promise<string> {
  const l = await tx.selectFrom('lista_precio').select('id').where('predeterminada', '=', true).executeTakeFirstOrThrow();
  return l.id;
}

/**
 * Precio vigente por variante, en este orden:
 *  1. lista indicada (la del cliente) para la sucursal, 2. esa lista en general,
 *  3. lista predeterminada para la sucursal, 4. predeterminada en general.
 * Un producto sin precio en la lista especial se cobra al precio normal.
 */
export async function preciosVigentes(tx: Tx, varianteIds: string[], sucursalId: string | null, listaId: string | null = null): Promise<Map<string, string>> {
  if (!varianteIds.length) return new Map();
  const { rows } = await sql<{ variante_id: string; precio: string }>`
    SELECT DISTINCT ON (p.variante_id) p.variante_id, p.precio
    FROM precio p JOIN lista_precio l ON l.empresa_id = p.empresa_id AND l.id = p.lista_id
    WHERE p.variante_id = ANY(${varianteIds}::uuid[])
      AND (l.predeterminada ${listaId ? sql`OR (l.id = ${listaId}::uuid AND l.activa)` : sql``})
      AND (p.sucursal_id IS NULL ${sucursalId ? sql`OR p.sucursal_id = ${sucursalId}::uuid` : sql``})
    ORDER BY p.variante_id, l.predeterminada, p.sucursal_id NULLS LAST`.execute(tx);
  return new Map(rows.map((r) => [r.variante_id, r.precio]));
}

/** Lista de precios del cliente (activa y no predeterminada), o null. */
export async function listaDeCliente(tx: Tx, clienteId: string | null | undefined): Promise<string | null> {
  if (!clienteId) return null;
  const r = await tx
    .selectFrom('cliente as c')
    .innerJoin('lista_precio as l', 'l.id', 'c.lista_precio_id')
    .select('l.id')
    .where('c.id', '=', clienteId)
    .where('l.activa', '=', true)
    .where('l.predeterminada', '=', false)
    .executeTakeFirst();
  return r?.id ?? null;
}
