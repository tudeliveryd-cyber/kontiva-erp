import { HttpStatus } from '@nestjs/common';
import Decimal from 'decimal.js';
import { sql } from 'kysely';
import type { Tx } from '../db/database';
import type { TipoMovimientoStock } from '../db/tipos';
import type { Ctx } from './contexto';
import { ErrorNegocio } from './errores';

/**
 * Lotes y vencimientos. Para los productos que controlan lote, cada movimiento de stock se reparte entre lotes:
 * - una entrada va al lote indicado (código y vencimiento), al mismo lote del que salió (anulaciones,
 *   devoluciones, transferencias) o, si no se informa, al lote "S/L" (sin lote);
 * - una salida toma primero el lote que vence antes (FEFO) y nunca un lote vencido, salvo que se indique
 *   el lote o se pida expresamente (ajustes, bajas de vencidos).
 * El saldo total sigue en `stock`; `stock_lote` lo reparte. Debe correr en la misma transacción.
 */
export const SIN_LOTE = 'S/L';

export interface MovimientoLote {
  varianteId: string;
  cantidad: Decimal; // con signo
  tipo: TipoMovimientoStock;
  origenId?: string | null;
  /** Entrada a este lote (se crea si no existe). */
  lote?: { codigo: string; vencimiento: string | null };
  /** Salida o entrada de un lote ya existente. */
  loteId?: string;
  /** Replica los lotes de movimientos anteriores (por ejemplo, devolver al lote del que salió). */
  deOrigen?: { origenIds: string[]; tipos: TipoMovimientoStock[]; descontar?: { origenIds: string[]; tipos: TipoMovimientoStock[] } };
  /** Una salida sin lote puede tomar lotes vencidos (ajustes). */
  incluirVencidos?: boolean;
}

const hoyPy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());

export async function variantesConLote(tx: Tx, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const r = await tx.selectFrom('variante as v').innerJoin('producto as p', 'p.id', 'v.producto_id').select('v.id').where('v.id', 'in', ids).where('p.controla_lote', '=', true).execute();
  return new Set(r.map((x) => x.id));
}

export async function obtenerLote(tx: Tx, ctx: Pick<Ctx, 'empresaId'>, varianteId: string, codigo: string, vencimiento: string | null) {
  const c = codigo.trim().toUpperCase();
  const existente = await tx.selectFrom('lote').select(['id', 'vencimiento']).where('variante_id', '=', varianteId).where('codigo', '=', c).executeTakeFirst();
  if (existente) {
    if (vencimiento && existente.vencimiento && existente.vencimiento !== vencimiento)
      throw new ErrorNegocio(HttpStatus.CONFLICT, 'LOTE_VENCIMIENTO_DISTINTO', `El lote ${c} ya está registrado con vencimiento ${existente.vencimiento.split('-').reverse().join('/')}`);
    if (vencimiento && !existente.vencimiento) await tx.updateTable('lote').set({ vencimiento }).where('id', '=', existente.id).execute();
    return existente.id;
  }
  const r = await tx.insertInto('lote').values({ empresa_id: ctx.empresaId, variante_id: varianteId, codigo: c, vencimiento }).returning('id').executeTakeFirstOrThrow();
  return r.id;
}

/** Cantidad neta por lote de movimientos anteriores (positiva = entró, negativa = salió). */
async function netoPorLote(tx: Tx, varianteId: string, origenIds: string[], tipos: TipoMovimientoStock[]) {
  if (!origenIds.length) return new Map<string, Decimal>();
  const r = await tx
    .selectFrom('movimiento_lote as m')
    .innerJoin('lote as l', 'l.id', 'm.lote_id')
    .select(['m.lote_id', (eb) => eb.fn.sum<string>('m.cantidad').as('neto')])
    .where('m.variante_id', '=', varianteId)
    .where('m.origen_id', 'in', origenIds)
    .where('m.tipo', 'in', tipos)
    .groupBy(['m.lote_id', 'l.vencimiento', 'l.creado_en'])
    .orderBy(sql`l.vencimiento NULLS LAST`)
    .orderBy('l.creado_en')
    .execute();
  return new Map(r.map((x) => [x.lote_id, new Decimal(x.neto)]));
}

export async function moverLotes(tx: Tx, ctx: Pick<Ctx, 'empresaId' | 'usuarioId'>, depositoId: string, movimientos: MovimientoLote[], validarSalidas: boolean) {
  const conLote = await variantesConLote(tx, [...new Set(movimientos.map((m) => m.varianteId))]);
  const movs = movimientos.filter((m) => conLote.has(m.varianteId) && !m.cantidad.isZero());
  if (!movs.length) return [];
  const hoy = hoyPy();
  const asignaciones: { varianteId: string; loteId: string; cantidad: Decimal; tipo: TipoMovimientoStock; origenId: string | null }[] = [];
  // Saldo por lote en este depósito, bloqueado en orden, para repartir varias salidas del mismo documento.
  const saldos = new Map<string, Decimal>();
  const saldoDe = async (loteId: string) => {
    if (!saldos.has(loteId)) {
      await tx.insertInto('stock_lote').values({ empresa_id: ctx.empresaId, lote_id: loteId, deposito_id: depositoId }).onConflict((oc) => oc.columns(['empresa_id', 'lote_id', 'deposito_id']).doNothing()).execute();
      const f = await tx.selectFrom('stock_lote').select('cantidad').where('lote_id', '=', loteId).where('deposito_id', '=', depositoId).forUpdate().executeTakeFirstOrThrow();
      saldos.set(loteId, new Decimal(f.cantidad));
    }
    return saldos.get(loteId)!;
  };
  const asignar = async (m: MovimientoLote, loteId: string, cantidad: Decimal) => {
    saldos.set(loteId, (await saldoDe(loteId)).plus(cantidad));
    asignaciones.push({ varianteId: m.varianteId, loteId, cantidad, tipo: m.tipo, origenId: m.origenId ?? null });
  };

  for (const m of movs) {
    const entrada = m.cantidad.isPositive();
    let resto = m.cantidad.abs();
    if (m.loteId) {
      if (!entrada && validarSalidas && (await saldoDe(m.loteId)).lt(resto)) throw await faltaEnLote(tx, m.loteId, await saldoDe(m.loteId));
      await asignar(m, m.loteId, m.cantidad);
      continue;
    }
    if (m.lote) {
      if (!entrada) throw new ErrorNegocio(HttpStatus.BAD_REQUEST, 'LOTE_INVALIDO', 'Para una salida indique un lote existente');
      await asignar(m, await obtenerLote(tx, ctx, m.varianteId, m.lote.codigo, m.lote.vencimiento), m.cantidad);
      continue;
    }
    if (m.deOrigen) {
      const base = await netoPorLote(tx, m.varianteId, m.deOrigen.origenIds, m.deOrigen.tipos);
      const ya = m.deOrigen.descontar ? await netoPorLote(tx, m.varianteId, m.deOrigen.descontar.origenIds, m.deOrigen.descontar.tipos) : new Map<string, Decimal>();
      for (const [loteId, neto] of base) {
        if (resto.isZero()) break;
        // Lo que salió (neto negativo) puede volver; lo que entró (neto positivo) puede salir. Se descuenta lo ya revertido.
        const disponible = neto.abs().minus(ya.get(loteId)?.abs() ?? 0);
        const toma = Decimal.min(disponible, resto);
        if (toma.lte(0)) continue;
        if (!entrada && validarSalidas && (await saldoDe(loteId)).lt(toma)) throw await faltaEnLote(tx, loteId, await saldoDe(loteId));
        await asignar(m, loteId, entrada ? toma : toma.neg());
        resto = resto.minus(toma);
      }
      if (resto.isZero()) continue;
    }
    if (entrada) {
      await asignar(m, await obtenerLote(tx, ctx, m.varianteId, SIN_LOTE, null), resto);
      continue;
    }
    // Salida: primero el lote que vence antes (FEFO); los vencidos no se venden.
    const candidatos = await tx
      .selectFrom('stock_lote as s')
      .innerJoin('lote as l', 'l.id', 's.lote_id')
      .select(['l.id', 'l.vencimiento'])
      .where('l.variante_id', '=', m.varianteId)
      .where('s.deposito_id', '=', depositoId)
      .orderBy(sql`l.vencimiento NULLS LAST`)
      .orderBy('l.creado_en')
      .execute();
    const vigentes = candidatos.filter((c) => m.incluirVencidos || !c.vencimiento || c.vencimiento >= hoy);
    for (const c of vigentes) {
      if (resto.isZero()) break;
      const disp = await saldoDe(c.id);
      const toma = Decimal.min(disp, resto);
      if (toma.lte(0)) continue;
      await asignar(m, c.id, toma.neg());
      resto = resto.minus(toma);
    }
    if (resto.gt(0)) {
      if (validarSalidas) {
        const vencidos = candidatos.filter((c) => c.vencimiento && c.vencimiento < hoy);
        let cantVencida = new Decimal(0);
        for (const c of vencidos) cantVencida = cantVencida.plus(Decimal.max(0, await saldoDe(c.id)));
        const nombre = await nombreVariante(tx, m.varianteId);
        if (cantVencida.gt(0))
          throw new ErrorNegocio(HttpStatus.CONFLICT, 'LOTE_VENCIDO', `${nombre}: solo quedan unidades de lotes vencidos. Retírelas con un ajuste.`, [{ varianteId: m.varianteId, descripcion: nombre, vencido: cantVencida.toFixed(4), pedido: m.cantidad.abs().toFixed(4) }]);
        throw new ErrorNegocio(HttpStatus.CONFLICT, 'STOCK_INSUFICIENTE', `Stock insuficiente: ${nombre}`, [{ varianteId: m.varianteId, descripcion: nombre, pedido: m.cantidad.abs().toFixed(4) }]);
      }
      // Stock negativo permitido (o venta sin conexión): el faltante queda en el primer lote vigente o en "sin lote".
      const destino = vigentes[0]?.id ?? (await obtenerLote(tx, ctx, m.varianteId, SIN_LOTE, null));
      await asignar(m, destino, resto.neg());
    }
  }

  for (const a of asignaciones) {
    await tx
      .insertInto('movimiento_lote')
      .values({ empresa_id: ctx.empresaId, lote_id: a.loteId, variante_id: a.varianteId, deposito_id: depositoId, tipo: a.tipo, cantidad: a.cantidad.toFixed(4), origen_id: a.origenId, creado_por: ctx.usuarioId })
      .execute();
  }
  for (const [loteId, cantidad] of saldos) {
    await tx.updateTable('stock_lote').set({ cantidad: cantidad.toFixed(4) }).where('lote_id', '=', loteId).where('deposito_id', '=', depositoId).execute();
  }
  return asignaciones;
}

async function nombreVariante(tx: Tx, id: string) {
  const n = await tx.selectFrom('variante as v').innerJoin('producto as p', 'p.id', 'v.producto_id').select(['p.nombre', 'v.nombre as variante']).where('v.id', '=', id).executeTakeFirstOrThrow();
  return n.variante ? `${n.nombre} · ${n.variante}` : n.nombre;
}

async function faltaEnLote(tx: Tx, loteId: string, disponible: Decimal) {
  const l = await tx.selectFrom('lote').select(['codigo', 'variante_id']).where('id', '=', loteId).executeTakeFirstOrThrow();
  return new ErrorNegocio(HttpStatus.CONFLICT, 'STOCK_INSUFICIENTE', `${await nombreVariante(tx, l.variante_id)}: el lote ${l.codigo} tiene ${disponible.toNumber().toLocaleString('es-PY')}`);
}

/**
 * Al activar el control por lote de un producto con stock, la diferencia entre el total y lo repartido en lotes
 * pasa al lote "S/L" de cada depósito, así el sub-libro siempre suma lo mismo que el saldo.
 */
export async function conciliarLotes(tx: Tx, ctx: Pick<Ctx, 'empresaId' | 'usuarioId'>, varianteIds: string[]) {
  for (const varianteId of varianteIds) {
    const filas = await sql<{ deposito_id: string; total: string; en_lotes: string }>`
      SELECT s.deposito_id, s.cantidad AS total, coalesce((SELECT sum(sl.cantidad) FROM stock_lote sl JOIN lote l ON l.id = sl.lote_id
        WHERE l.variante_id = s.variante_id AND sl.deposito_id = s.deposito_id), 0) AS en_lotes
      FROM stock s WHERE s.variante_id = ${varianteId}::uuid`.execute(tx);
    for (const f of filas.rows) {
      const dif = new Decimal(f.total).minus(f.en_lotes);
      if (dif.isZero()) continue;
      const loteId = await obtenerLote(tx, ctx, varianteId, SIN_LOTE, null);
      await moverLotes(tx, ctx, f.deposito_id, [{ varianteId, cantidad: dif, tipo: 'ajuste', loteId }], false);
    }
  }
}
