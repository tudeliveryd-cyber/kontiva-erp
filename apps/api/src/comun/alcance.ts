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

/** Precio vigente por variante: el de la sucursal si existe, si no el general de la lista predeterminada. */
export async function preciosVigentes(tx: Tx, varianteIds: string[], sucursalId: string | null): Promise<Map<string, string>> {
  if (!varianteIds.length) return new Map();
  const { rows } = await sql<{ variante_id: string; precio: string }>`
    SELECT DISTINCT ON (p.variante_id) p.variante_id, p.precio
    FROM precio p JOIN lista_precio l ON l.empresa_id = p.empresa_id AND l.id = p.lista_id AND l.predeterminada
    WHERE p.variante_id = ANY(${varianteIds}::uuid[])
      AND (p.sucursal_id IS NULL ${sucursalId ? sql`OR p.sucursal_id = ${sucursalId}::uuid` : sql``})
    ORDER BY p.variante_id, p.sucursal_id NULLS LAST`.execute(tx);
  return new Map(rows.map((r) => [r.variante_id, r.precio]));
}
