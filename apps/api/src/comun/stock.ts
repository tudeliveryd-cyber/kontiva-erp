import { HttpStatus } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { Tx } from '../db/database';
import type { TipoMovimientoStock } from '../db/tipos';
import type { Ctx } from './contexto';
import { ErrorNegocio } from './errores';

export interface Movimiento {
  varianteId: string;
  cantidad: Decimal; // con signo: negativa = salida
  tipo: TipoMovimientoStock;
  origenId?: string | null;
  motivo?: string | null;
  costo?: string | null;
}

export async function permiteStockNegativo(tx: Tx): Promise<boolean> {
  const e = await tx.selectFrom('empresa').select('configuracion').executeTakeFirstOrThrow();
  return (e.configuracion as { permiteStockNegativo?: boolean }).permiteStockNegativo === true;
}

/**
 * Aplica movimientos de stock en un depósito: crea las filas que falten, las bloquea en orden de
 * id (sin interbloqueos con ventas o ajustes simultáneos), valida salidas si la empresa no admite
 * stock negativo, y escribe saldo + movimiento. Debe correr dentro de Db.enEmpresa.
 */
export async function moverStock(tx: Tx, ctx: Pick<Ctx, 'empresaId' | 'usuarioId'>, depositoId: string, movimientos: Movimiento[], validarSalidas = true) {
  if (!movimientos.length) return new Map<string, Decimal>();
  const ids = [...new Set(movimientos.map((m) => m.varianteId))].sort();
  await tx
    .insertInto('stock')
    .values(ids.map((variante_id) => ({ empresa_id: ctx.empresaId, variante_id, deposito_id: depositoId })))
    .onConflict((oc) => oc.columns(['empresa_id', 'variante_id', 'deposito_id']).doNothing())
    .execute();
  const filas = await tx.selectFrom('stock').select(['variante_id', 'cantidad']).where('deposito_id', '=', depositoId).where('variante_id', 'in', ids).orderBy('variante_id').forUpdate().execute();
  const saldo = new Map(filas.map((f) => [f.variante_id, new Decimal(f.cantidad)]));

  if (validarSalidas && !(await permiteStockNegativo(tx))) {
    const neto = new Map<string, Decimal>();
    for (const m of movimientos) neto.set(m.varianteId, (neto.get(m.varianteId) ?? new Decimal(0)).plus(m.cantidad));
    const faltan = [...neto].filter(([id, d]) => d.isNegative() && saldo.get(id)!.plus(d).isNegative());
    if (faltan.length) {
      const nombres = await tx
        .selectFrom('variante as v')
        .innerJoin('producto as p', 'p.id', 'v.producto_id')
        .select(['v.id', 'p.nombre', 'v.nombre as variante'])
        .where('v.id', 'in', faltan.map(([id]) => id))
        .execute();
      const detalle = faltan.map(([id, d]) => {
        const n = nombres.find((x) => x.id === id)!;
        return { varianteId: id, descripcion: n.variante ? `${n.nombre} · ${n.variante}` : n.nombre, disponible: saldo.get(id)!.toFixed(4), pedido: d.neg().toFixed(4) };
      });
      throw new ErrorNegocio(HttpStatus.CONFLICT, 'STOCK_INSUFICIENTE', `Stock insuficiente: ${detalle.map((x) => x.descripcion).join(', ')}`, detalle);
    }
  }

  for (const m of movimientos) {
    const nuevo = saldo.get(m.varianteId)!.plus(m.cantidad);
    saldo.set(m.varianteId, nuevo);
    await tx
      .insertInto('movimiento_stock')
      .values({
        empresa_id: ctx.empresaId,
        variante_id: m.varianteId,
        deposito_id: depositoId,
        tipo: m.tipo,
        cantidad: m.cantidad.toFixed(4),
        saldo: nuevo.toFixed(4),
        costo_unitario: m.costo ?? null,
        origen_id: m.origenId ?? null,
        motivo: m.motivo ?? null,
        creado_por: ctx.usuarioId,
      })
      .execute();
  }
  for (const id of ids) {
    await tx.updateTable('stock').set({ cantidad: saldo.get(id)!.toFixed(4), actualizado_en: new Date() }).where('variante_id', '=', id).where('deposito_id', '=', depositoId).execute();
  }
  return saldo;
}

/** Próximo número correlativo de un documento (bloquea la empresa: sin huecos ni repetidos). */
export async function siguienteNumero(tx: Tx, tabla: 'transferencia' | 'devolucion'): Promise<number> {
  await tx.selectFrom('empresa').select('id').forUpdate().executeTakeFirstOrThrow();
  const r = await tx.selectFrom(tabla).select((eb) => eb.fn.max<string>('numero').as('n')).executeTakeFirstOrThrow();
  return Number(r.n ?? 0) + 1;
}

/** Numeración propia de presupuestos y de pedidos. */
export async function siguienteNumeroPedido(tx: Tx, tipo: 'presupuesto' | 'pedido'): Promise<number> {
  await tx.selectFrom('empresa').select('id').forUpdate().executeTakeFirstOrThrow();
  const r = await tx.selectFrom('pedido').select((eb) => eb.fn.max<string>('numero').as('n')).where('tipo', '=', tipo).executeTakeFirstOrThrow();
  return Number(r.n ?? 0) + 1;
}
