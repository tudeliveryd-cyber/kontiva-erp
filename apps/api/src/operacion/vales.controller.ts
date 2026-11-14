import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import Decimal from 'decimal.js';
import { sql } from 'kysely';
import { z } from 'zod';
import { enSucursal } from '../comun/alcance';
import { Contexto, type Ctx } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { conflicto, noEncontrado } from '../comun/errores';
import { siguienteNumero } from '../comun/stock';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';

const hoyPy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());

/** Días de validez de los vales (configuración de la empresa; 0 = no vencen). */
async function diasValidez(tx: Tx) {
  const e = await tx.selectFrom('empresa').select('configuracion').executeTakeFirstOrThrow();
  const d = (e.configuracion as { valeDias?: number }).valeDias;
  return typeof d === 'number' && d >= 0 ? d : 180;
}

/** Emite un vale de cambio con un código numérico de 10 dígitos (para tipear o leer del ticket). */
export async function emitirVale(tx: Tx, ctx: Ctx, d: { sucursalId: string; clienteId: string | null; devolucionId: string | null; monto: Decimal }) {
  const numero = await siguienteNumero(tx, 'vale');
  const dias = await diasValidez(tx);
  let vence: string | null = null;
  if (dias > 0) {
    const f = new Date(`${hoyPy()}T12:00:00Z`);
    f.setUTCDate(f.getUTCDate() + dias);
    vence = f.toISOString().slice(0, 10);
  }
  for (let intento = 0; intento < 8; intento++) {
    const codigo = String(randomInt(1, 10)) + Array.from({ length: 9 }, () => randomInt(0, 10)).join('');
    const existe = await tx.selectFrom('vale').select('id').where('codigo', '=', codigo).executeTakeFirst();
    if (existe) continue;
    const v = await tx
      .insertInto('vale')
      .values({ empresa_id: ctx.empresaId, numero, codigo, sucursal_id: d.sucursalId, cliente_id: d.clienteId, devolucion_id: d.devolucionId, monto: d.monto.toFixed(2), saldo: d.monto.toFixed(2), vence, creado_por: ctx.usuarioId })
      .returning(['id', 'codigo'])
      .executeTakeFirstOrThrow();
    await tx.insertInto('vale_movimiento').values({ empresa_id: ctx.empresaId, vale_id: v.id, tipo: 'emision', monto: d.monto.toFixed(2), saldo: d.monto.toFixed(2), venta_id: null, creado_por: ctx.usuarioId }).execute();
    return { id: v.id, codigo: v.codigo, numero, vence };
  }
  throw conflicto('VALE_CODIGO', 'No se pudo generar el código del vale: intente de nuevo');
}

/** Descuenta de los vales lo usado como pago de una venta (bloquea cada vale). */
export async function usarVales(tx: Tx, ctx: Ctx, ventaId: string, usos: { codigo: string; monto: Decimal }[]) {
  const porCodigo = new Map<string, Decimal>();
  for (const u of usos) porCodigo.set(u.codigo, (porCodigo.get(u.codigo) ?? new Decimal(0)).plus(u.monto));
  for (const [codigo, monto] of [...porCodigo].sort(([a], [b]) => a.localeCompare(b))) {
    const v = await tx.selectFrom('vale').select(['id', 'numero', 'saldo', 'vence']).where('codigo', '=', codigo).forUpdate().executeTakeFirst();
    if (!v) throw noEncontrado(`Vale ${codigo}`);
    if (v.vence && v.vence < hoyPy()) throw conflicto('VALE_VENCIDO', `El vale N.º ${v.numero} venció el ${v.vence.split('-').reverse().join('/')}`);
    const saldo = new Decimal(v.saldo);
    if (monto.gt(saldo)) throw conflicto('VALE_SIN_SALDO', `El vale N.º ${v.numero} tiene ${saldo.toFixed(0)} guaraníes de saldo`);
    const nuevo = saldo.minus(monto);
    await tx.updateTable('vale').set({ saldo: nuevo.toFixed(2) }).where('id', '=', v.id).execute();
    await tx.insertInto('vale_movimiento').values({ empresa_id: ctx.empresaId, vale_id: v.id, tipo: 'uso', monto: monto.neg().toFixed(2), saldo: nuevo.toFixed(2), venta_id: ventaId, creado_por: ctx.usuarioId }).execute();
  }
}

/** Al anular una venta pagada con vales, el saldo vuelve a cada vale. */
export async function reintegrarVales(tx: Tx, ctx: Ctx, ventaId: string) {
  const usos = await tx.selectFrom('vale_movimiento').select(['vale_id', 'monto']).where('venta_id', '=', ventaId).where('tipo', '=', 'uso').orderBy('vale_id').execute();
  for (const u of usos) {
    const v = await tx.selectFrom('vale').select(['saldo']).where('id', '=', u.vale_id).forUpdate().executeTakeFirstOrThrow();
    const nuevo = new Decimal(v.saldo).minus(u.monto);
    await tx.updateTable('vale').set({ saldo: nuevo.toFixed(2) }).where('id', '=', u.vale_id).execute();
    await tx.insertInto('vale_movimiento').values({ empresa_id: ctx.empresaId, vale_id: u.vale_id, tipo: 'reintegro', monto: new Decimal(u.monto).neg().toFixed(2), saldo: nuevo.toFixed(2), venta_id: ventaId, creado_por: ctx.usuarioId }).execute();
  }
}

function estado(v: { saldo: string; vence: string | null }) {
  if (new Decimal(v.saldo).isZero()) return 'usado' as const;
  if (v.vence && v.vence < hoyPy()) return 'vencido' as const;
  return 'vigente' as const;
}

async function leerVale(tx: Tx, where: { id?: string; codigo?: string }) {
  let q = tx
    .selectFrom('vale as v')
    .innerJoin('sucursal as s', 's.id', 'v.sucursal_id')
    .leftJoin('cliente as c', 'c.id', 'v.cliente_id')
    .leftJoin('devolucion as d', 'd.id', 'v.devolucion_id')
    .leftJoin('venta as ve', 've.id', 'd.venta_id')
    .leftJoin('usuario as u', 'u.id', 'v.creado_por')
    .select(['v.id', 'v.numero', 'v.codigo', 'v.sucursal_id', 's.nombre as sucursal', 'v.cliente_id', 'c.nombre as cliente', 'c.documento', 'd.numero as devolucion', 've.numero as venta', 'v.monto', 'v.saldo', 'v.vence', 'v.creado_en', 'u.nombre as usuario']);
  q = where.id ? q.where('v.id', '=', where.id) : q.where('v.codigo', '=', where.codigo!);
  const v = await q.executeTakeFirst();
  if (!v) return null;
  return {
    id: v.id,
    numero: Number(v.numero),
    codigo: v.codigo,
    sucursalId: v.sucursal_id,
    sucursal: v.sucursal,
    cliente: v.cliente_id ? { id: v.cliente_id, nombre: v.cliente!, documento: v.documento } : null,
    devolucion: v.devolucion ? Number(v.devolucion) : null,
    venta: v.venta ? Number(v.venta) : null,
    monto: v.monto,
    saldo: v.saldo,
    vence: v.vence,
    estado: estado(v),
    creadoEn: v.creado_en,
    usuario: v.usuario,
  };
}

@Controller('vales')
export class ValesController {
  constructor(private readonly db: Db) {}

  @Requiere('venta', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ estado: z.enum(['vigente', 'usado', 'vencido', '']).optional(), q: z.string().trim().max(60).optional() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let q = tx
        .selectFrom('vale as v')
        .leftJoin('cliente as c', 'c.id', 'v.cliente_id')
        .innerJoin('sucursal as s', 's.id', 'v.sucursal_id')
        .select(['v.id', 'v.numero', 'v.codigo', 'v.sucursal_id', 's.nombre as sucursal', 'c.nombre as cliente', 'v.monto', 'v.saldo', 'v.vence', 'v.creado_en'])
        .orderBy('v.numero', 'desc')
        .limit(300);
      const hoy = hoyPy();
      if (f.estado === 'usado') q = q.where('v.saldo', '=', '0');
      if (f.estado === 'vigente') q = q.where('v.saldo', '>', '0').where((eb) => eb.or([eb('v.vence', 'is', null), eb('v.vence', '>=', hoy)]));
      if (f.estado === 'vencido') q = q.where('v.saldo', '>', '0').where('v.vence', '<', hoy);
      if (f.q) {
        const t = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`;
        q = q.where((eb) => eb.or([eb('v.codigo', 'like', t), eb('c.nombre', 'ilike', t), eb('c.documento', 'like', t)]));
      }
      const filas = (await q.execute()).filter((v) => enSucursal(ctx, v.sucursal_id));
      let qv = tx
        .selectFrom('vale')
        .select(sql<string>`coalesce(sum(saldo), 0)`.as('s'))
        .where('saldo', '>', '0')
        .where((eb) => eb.or([eb('vence', 'is', null), eb('vence', '>=', hoy)]));
      if (!ctx.esPropietario && ctx.alcance !== 'empresa') qv = ctx.sucursalIds.length ? qv.where('sucursal_id', 'in', ctx.sucursalIds) : qv.where(sql<boolean>`false`);
      const vigente = await qv.executeTakeFirstOrThrow();
      return {
        saldoVigente: vigente.s,
        items: filas.map((v) => ({ id: v.id, numero: Number(v.numero), codigo: v.codigo, sucursal: v.sucursal, cliente: v.cliente, monto: v.monto, saldo: v.saldo, vence: v.vence, estado: estado(v), creadoEn: v.creado_en })),
      };
    });
  }

  /** Consulta desde la caja: saldo disponible del vale para usarlo como pago. */
  @Requiere('venta', 'crear')
  @Get('codigo/:codigo')
  porCodigo(@Contexto() ctx: Ctx, @Param('codigo') codigo: string) {
    const c = validar(z.string().trim().regex(/^[0-9A-Z]{8,16}$/, 'Código de vale inválido'), codigo.toUpperCase());
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const v = await leerVale(tx, { codigo: c });
      if (!v) throw noEncontrado('Vale');
      return v;
    });
  }

  @Requiere('venta', 'ver')
  @Get(':id')
  ver(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const v = await leerVale(tx, { id });
      if (!v || !enSucursal(ctx, v.sucursalId)) throw noEncontrado('Vale');
      const movimientos = await tx
        .selectFrom('vale_movimiento as m')
        .leftJoin('venta as ve', 've.id', 'm.venta_id')
        .leftJoin('usuario as u', 'u.id', 'm.creado_por')
        .select(['m.id', 'm.tipo', 'm.monto', 'm.saldo', 'm.creado_en', 've.numero as venta', 'u.nombre as usuario'])
        .where('m.vale_id', '=', id)
        .orderBy('m.creado_en')
        .orderBy('m.id')
        .execute();
      return { ...v, movimientos: movimientos.map((m) => ({ id: m.id, tipo: m.tipo, monto: m.monto, saldo: m.saldo, fecha: m.creado_en, venta: m.venta ? Number(m.venta) : null, usuario: m.usuario })) };
    });
  }
}
