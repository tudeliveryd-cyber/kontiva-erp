import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { cuentaBancariaEntrada, depositoCajaEntrada, movimientoBancarioEntrada, transferenciaBancariaEntrada } from '@kontiva/shared';
import Decimal from 'decimal.js';
import { sql } from 'kysely';
import { z } from 'zod';
import { auditar } from '../comun/auditoria';
import { Contexto, OrigenPeticion, type Ctx, type Origen } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { conflicto, invalido, noEncontrado } from '../comun/errores';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';
import type { TipoMovimientoBancario } from '../db/tipos';
import { esperado, obtenerCaja, sesionAbierta } from '../operacion/cajas.controller';

export async function obtenerCuentaBancaria(tx: Tx, id: string, activa = true) {
  const c = await tx.selectFrom('cuenta_bancaria').selectAll().where('id', '=', id).executeTakeFirst();
  if (!c) throw noEncontrado('Cuenta bancaria');
  if (activa && !c.activa) throw invalido('La cuenta bancaria está inactiva');
  return c;
}

/** Registra un movimiento bancario (positivo entra, negativo sale). Lo usan pagos, cobros y operaciones manuales. */
export async function movimientoBancario(
  tx: Tx,
  ctx: Ctx,
  m: { cuentaId: string; fecha: string; tipo: TipoMovimientoBancario; descripcion: string; monto: Decimal; referencia?: string | null; origenTipo?: string; origenId?: string },
) {
  if (m.monto.isZero()) return null;
  const r = await tx
    .insertInto('movimiento_bancario')
    .values({ empresa_id: ctx.empresaId, cuenta_id: m.cuentaId, fecha: m.fecha, tipo: m.tipo, descripcion: m.descripcion, monto: m.monto.toFixed(2), referencia: m.referencia ?? null, origen_tipo: m.origenTipo ?? null, origen_id: m.origenId ?? null, creado_por: ctx.usuarioId })
    .returning('id')
    .executeTakeFirstOrThrow();
  return r.id;
}

/** Anulación de un pago o cobro con banco: movimiento inverso (los movimientos no se borran). */
export async function revertirMovimientos(tx: Tx, ctx: Ctx, origenTipo: string, origenId: string, motivo: string) {
  const movs = await tx.selectFrom('movimiento_bancario').selectAll().where('origen_tipo', '=', origenTipo).where('origen_id', '=', origenId).where('tipo', '<>', 'anulacion').execute();
  const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
  for (const m of movs) {
    await movimientoBancario(tx, ctx, { cuentaId: m.cuenta_id, fecha, tipo: 'anulacion', descripcion: `Anulación: ${m.descripcion} (${motivo})`, monto: new Decimal(m.monto).neg(), referencia: m.referencia, origenTipo, origenId });
  }
}

async function saldos(tx: Tx) {
  const { rows } = await sql<{ id: string; banco: string; nombre: string; numero: string | null; activa: boolean; saldo_inicial: string; fecha_saldo_inicial: string; saldo: string; conciliado: string; pendientes: string }>`
    SELECT c.id, c.banco, c.nombre, c.numero, c.activa, c.saldo_inicial, c.fecha_saldo_inicial::text,
      c.saldo_inicial + coalesce(sum(m.monto), 0) AS saldo,
      c.saldo_inicial + coalesce(sum(m.monto) FILTER (WHERE m.conciliado), 0) AS conciliado,
      count(m.id) FILTER (WHERE NOT m.conciliado) AS pendientes
    FROM cuenta_bancaria c LEFT JOIN movimiento_bancario m ON m.cuenta_id = c.id
    GROUP BY c.empresa_id, c.id ORDER BY c.activa DESC, c.banco, c.nombre`.execute(tx);
  return rows.map((r) => ({
    id: r.id,
    banco: r.banco,
    nombre: r.nombre,
    numero: r.numero,
    activa: r.activa,
    saldoInicial: r.saldo_inicial,
    fechaSaldoInicial: r.fecha_saldo_inicial,
    saldo: new Decimal(r.saldo).toFixed(2),
    saldoConciliado: new Decimal(r.conciliado).toFixed(2),
    sinConciliar: Number(r.pendientes),
  }));
}

@Controller('cuentas-bancarias')
export class CuentasBancariasController {
  constructor(private readonly db: Db) {}

  @Requiere('banco', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx) {
    return this.db.enEmpresa(ctx.empresaId, (tx) => saldos(tx));
  }

  @Requiere('banco', 'crear')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(cuentaBancariaEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const c = await tx
        .insertInto('cuenta_bancaria')
        .values({ empresa_id: ctx.empresaId, banco: d.banco, nombre: d.nombre, numero: d.numero ?? null, saldo_inicial: new Decimal(d.saldoInicial).toFixed(2), fecha_saldo_inicial: d.fechaSaldoInicial, creado_por: ctx.usuarioId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'cuenta_bancaria', entidadId: c.id, despues: d });
      return (await saldos(tx)).find((x) => x.id === c.id)!;
    });
  }

  @Requiere('banco', 'editar')
  @Patch(':id')
  editar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(cuentaBancariaEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const antes = await obtenerCuentaBancaria(tx, id, false);
      await tx
        .updateTable('cuenta_bancaria')
        .set({ banco: d.banco, nombre: d.nombre, numero: d.numero ?? null, saldo_inicial: new Decimal(d.saldoInicial).toFixed(2), fecha_saldo_inicial: d.fechaSaldoInicial, ...(d.activa !== undefined && { activa: d.activa }) })
        .where('id', '=', id)
        .execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'editar', entidad: 'cuenta_bancaria', entidadId: id, antes: { banco: antes.banco, nombre: antes.nombre, saldoInicial: antes.saldo_inicial, activa: antes.activa }, despues: d });
      return (await saldos(tx)).find((x) => x.id === id)!;
    });
  }

  /** Extracto: movimientos del período con saldo corrido. */
  @Requiere('banco', 'ver')
  @Get(':id/movimientos')
  movimientos(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Query() query: unknown) {
    const f = validar(z.object({ desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), sinConciliar: z.enum(['true', 'false']).optional() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const c = await obtenerCuentaBancaria(tx, id, false);
      const desde = f.desde ?? '1900-01-01';
      const previo = await tx.selectFrom('movimiento_bancario').select((eb) => eb.fn.coalesce(eb.fn.sum<string>('monto'), eb.val('0')).as('s')).where('cuenta_id', '=', id).where('fecha', '<', desde).executeTakeFirstOrThrow();
      let q = tx
        .selectFrom('movimiento_bancario as m')
        .innerJoin('usuario as u', 'u.id', 'm.creado_por')
        .select(['m.id', 'm.fecha', 'm.tipo', 'm.descripcion', 'm.monto', 'm.referencia', 'm.conciliado', 'm.origen_tipo', 'u.nombre as usuario'])
        .where('m.cuenta_id', '=', id)
        .where('m.fecha', '>=', desde)
        .orderBy('m.fecha')
        .orderBy('m.id');
      if (f.hasta) q = q.where('m.fecha', '<=', f.hasta);
      const filas = await q.execute();
      let saldo = new Decimal(c.saldo_inicial).plus(previo.s);
      const inicial = saldo.toFixed(2);
      const items = filas.map((m) => {
        saldo = saldo.plus(m.monto);
        return { id: m.id, fecha: m.fecha, tipo: m.tipo, descripcion: m.descripcion, monto: m.monto, referencia: m.referencia, conciliado: m.conciliado, origen: m.origen_tipo, usuario: m.usuario, saldo: saldo.toFixed(2) };
      });
      return { saldoInicial: inicial, saldoFinal: saldo.toFixed(2), items: f.sinConciliar === 'true' ? items.filter((i) => !i.conciliado) : items };
    });
  }

  /** Movimiento manual: depósito, extracción, gasto bancario (comisiones, impuestos) o ingreso (intereses). */
  @Requiere('banco', 'crear')
  @Post(':id/movimientos')
  manual(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(movimientoBancarioEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      await obtenerCuentaBancaria(tx, id);
      const signo = d.tipo === 'deposito' || d.tipo === 'ingreso' ? 1 : -1;
      const mid = await movimientoBancario(tx, ctx, { cuentaId: id, fecha: d.fecha, tipo: d.tipo, descripcion: d.descripcion, monto: new Decimal(d.monto).mul(signo), referencia: d.referencia, origenTipo: 'manual' });
      await auditar(tx, { ...ctx, ...o }, { accion: 'movimiento', entidad: 'cuenta_bancaria', entidadId: id, despues: d });
      return { id: mid };
    });
  }

  @Requiere('banco', 'crear')
  @Post(':id/transferencia')
  transferencia(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(transferenciaBancariaEntrada, body);
    if (d.destinoId === id) throw invalido('Elija otra cuenta de destino');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const origen = await obtenerCuentaBancaria(tx, id);
      const destino = await obtenerCuentaBancaria(tx, d.destinoId);
      const monto = new Decimal(d.monto);
      await movimientoBancario(tx, ctx, { cuentaId: id, fecha: d.fecha, tipo: 'transferencia_salida', descripcion: `Transferencia a ${destino.banco} · ${destino.nombre}`, monto: monto.neg(), referencia: d.referencia, origenTipo: 'transferencia' });
      await movimientoBancario(tx, ctx, { cuentaId: d.destinoId, fecha: d.fecha, tipo: 'transferencia_entrada', descripcion: `Transferencia desde ${origen.banco} · ${origen.nombre}`, monto, referencia: d.referencia, origenTipo: 'transferencia' });
      await auditar(tx, { ...ctx, ...o }, { accion: 'transferencia', entidad: 'cuenta_bancaria', entidadId: id, despues: d });
      return { ok: true };
    });
  }

  /** Depósito del efectivo de una caja abierta (propia) en la cuenta: sale de la caja y entra al banco. */
  @Requiere('banco', 'crear')
  @Post(':id/deposito-caja')
  depositoCaja(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(depositoCajaEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const cuenta = await obtenerCuentaBancaria(tx, id);
      const caja = await obtenerCaja(tx, ctx, d.cajaId, true);
      const sesion = await sesionAbierta(tx, caja.id);
      if (!sesion || sesion.usuario_id !== ctx.usuarioId) throw conflicto('CAJA_CERRADA', 'Para depositar el efectivo, la caja debe estar abierta con su usuario');
      const monto = new Decimal(d.monto);
      const efectivo = (await esperado(tx, sesion.id)).find((e) => e.moneda === 'PYG' && e.medio === 'efectivo');
      if (new Decimal(efectivo?.monto ?? 0).lt(monto)) throw conflicto('SALDO_INSUFICIENTE', 'No hay suficiente efectivo en la caja');
      await tx
        .insertInto('movimiento_caja')
        .values({ empresa_id: ctx.empresaId, sesion_id: sesion.id, tipo: 'retiro', medio: 'efectivo', moneda: 'PYG', monto: monto.neg().toFixed(2), venta_id: null, motivo: `Depósito en ${cuenta.banco} · ${cuenta.nombre}${d.referencia ? ` (${d.referencia})` : ''}`, autorizado_por: null, creado_por: ctx.usuarioId })
        .execute();
      await movimientoBancario(tx, ctx, { cuentaId: id, fecha: d.fecha, tipo: 'deposito_caja', descripcion: `Depósito del efectivo de ${caja.nombre}`, monto, referencia: d.referencia, origenTipo: 'caja', origenId: sesion.id });
      await auditar(tx, { ...ctx, ...o }, { accion: 'deposito_caja', entidad: 'cuenta_bancaria', entidadId: id, despues: { caja: caja.nombre, monto: monto.toFixed(0) } });
      return { ok: true };
    });
  }
}

@Controller('movimientos-bancarios')
export class MovimientosBancariosController {
  constructor(private readonly db: Db) {}

  /** Marca o desmarca movimientos como conciliados con el extracto del banco. */
  @Requiere('banco', 'editar')
  @Post('conciliar')
  @HttpCode(200)
  conciliar(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ ids: z.array(z.string().uuid()).min(1).max(500), conciliado: z.boolean() }), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const r = await tx
        .updateTable('movimiento_bancario')
        .set(d.conciliado ? { conciliado: true, conciliado_en: new Date(), conciliado_por: ctx.usuarioId } : { conciliado: false, conciliado_en: null, conciliado_por: null })
        .where('id', 'in', d.ids)
        .executeTakeFirst();
      if (Number(r.numUpdatedRows) !== new Set(d.ids).size) throw noEncontrado('Movimiento bancario');
      await auditar(tx, { ...ctx, ...o }, { accion: d.conciliado ? 'conciliar' : 'desconciliar', entidad: 'movimiento_bancario', entidadId: d.ids[0]!, despues: { cantidad: d.ids.length } });
      return { actualizados: d.ids.length };
    });
  }
}
