import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { cobroEntrada } from '@kontiva/shared';
import Decimal from 'decimal.js';
import { sql } from 'kysely';
import { z } from 'zod';
import { enSucursal } from '../comun/alcance';
import { auditar } from '../comun/auditoria';
import { Contexto, OrigenPeticion, type Ctx, type Origen } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { conflicto, invalido, noEncontrado } from '../comun/errores';
import { siguienteNumero } from '../comun/stock';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';
import { obtenerCaja, sesionAbierta } from '../operacion/cajas.controller';

const NULO = '00000000-0000-0000-0000-000000000000';
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
const masDias = (fecha: string, dias: number) => {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};
const sucursales = (ctx: Ctx) => (ctx.esPropietario || ctx.alcance === 'empresa' ? null : ctx.sucursalIds.length ? ctx.sucursalIds : [NULO]);
/** Medios de cobro → medios de la caja (el cheque se arquea como "otro"). */
const MEDIO_CAJA = { efectivo: 'efectivo', tarjeta: 'tarjeta', transferencia: 'transferencia', cheque: 'otro', otro: 'otro' } as const;

async function obtenerCliente(tx: Tx, id: string) {
  const c = await tx.selectFrom('cliente').select(['id', 'nombre', 'documento', 'telefono', 'limite_credito', 'plazo_credito_dias']).where('id', '=', id).executeTakeFirst();
  if (!c) throw noEncontrado('Cliente');
  return c;
}

@Controller('cuentas-cobrar')
export class CuentasCobrarController {
  constructor(private readonly db: Db) {}

  @Requiere('cuenta_cobrar', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ estado: z.enum(['abiertas', 'vencidas', 'cobradas', 'todas']).default('abiertas'), clienteId: z.string().uuid().optional(), q: z.string().trim().max(100).optional() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let q = tx
        .selectFrom('cuenta_cobrar as c')
        .innerJoin('cliente as cl', 'cl.id', 'c.cliente_id')
        .leftJoin('venta as v', 'v.id', 'c.venta_id')
        .select(['c.id', 'c.descripcion', 'c.fecha', 'c.vencimiento', 'c.monto', 'c.saldo', 'c.estado', 'c.venta_id', 'v.numero as venta_numero', 'cl.id as cliente_id', 'cl.nombre as cliente', 'cl.documento', 'cl.telefono'])
        .orderBy('c.vencimiento')
        .limit(500);
      const suc = sucursales(ctx);
      if (suc) q = q.where('c.sucursal_id', 'in', suc);
      const h = hoy();
      if (f.estado === 'abiertas') q = q.where('c.estado', 'in', ['pendiente', 'parcial']);
      if (f.estado === 'vencidas') q = q.where('c.estado', 'in', ['pendiente', 'parcial']).where('c.vencimiento', '<', h);
      if (f.estado === 'cobradas') q = q.where('c.estado', '=', 'cobrada');
      if (f.clienteId) q = q.where('c.cliente_id', '=', f.clienteId);
      if (f.q) q = q.where((eb) => eb.or([eb('cl.nombre', 'ilike', `%${f.q}%`), eb('cl.documento', 'ilike', `${f.q}%`)]));
      return (await q.execute()).map((c) => ({
        id: c.id,
        descripcion: c.descripcion,
        fecha: c.fecha,
        vencimiento: c.vencimiento,
        vencida: (c.estado === 'pendiente' || c.estado === 'parcial') && c.vencimiento < h,
        diasAtraso: (c.estado === 'pendiente' || c.estado === 'parcial') && c.vencimiento < h ? Math.round((Date.parse(h) - Date.parse(c.vencimiento)) / 86400000) : 0,
        monto: c.monto,
        saldo: c.saldo,
        estado: c.estado,
        venta: c.venta_id ? { id: c.venta_id, numero: Number(c.venta_numero) } : null,
        cliente: { id: c.cliente_id, nombre: c.cliente, documento: c.documento, telefono: c.telefono },
      }));
    });
  }

  @Requiere('cuenta_cobrar', 'ver')
  @Get('resumen')
  resumen(@Contexto() ctx: Ctx) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const h = hoy();
      const suc = sucursales(ctx);
      let q = tx
        .selectFrom('cuenta_cobrar')
        .select([
          sql<string>`coalesce(sum(saldo), 0)`.as('abierto'),
          sql<string>`coalesce(sum(saldo) FILTER (WHERE vencimiento < ${h}::date), 0)`.as('vencido'),
          sql<string>`coalesce(sum(saldo) FILTER (WHERE vencimiento BETWEEN ${h}::date AND ${masDias(h, 7)}::date), 0)`.as('semana'),
          sql<string>`count(DISTINCT cliente_id)`.as('clientes'),
        ])
        .where('estado', 'in', ['pendiente', 'parcial']);
      if (suc) q = q.where('sucursal_id', 'in', suc);
      const r = await q.executeTakeFirstOrThrow();
      return { abierto: new Decimal(r.abierto).toFixed(2), vencido: new Decimal(r.vencido).toFixed(2), proximos7Dias: new Decimal(r.semana).toFixed(2), clientes: Number(r.clientes) };
    });
  }

  /** Estado de cuenta del cliente: crédito, deuda, cuentas y movimientos (ventas a crédito, cobros, devoluciones). */
  @Requiere('cuenta_cobrar', 'ver')
  @Get('cliente/:id')
  estadoCuenta(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const c = await obtenerCliente(tx, id);
      const cuentas = await tx.selectFrom('cuenta_cobrar').selectAll().where('cliente_id', '=', id).where('estado', '<>', 'anulada').orderBy('fecha').execute();
      const { rows: movimientos } = await sql<{ fecha: string; tipo: string; detalle: string; debe: string; haber: string; creado_en: Date }>`
        SELECT c.fecha::text AS fecha, 'venta' AS tipo, c.descripcion AS detalle, c.monto AS debe, 0 AS haber, c.creado_en
        FROM cuenta_cobrar c WHERE c.cliente_id = ${id}::uuid AND c.estado <> 'anulada'
        UNION ALL
        SELECT k.fecha::text, 'cobro', 'Cobro N.º ' || k.numero || ' · ' || k.medio, 0, k.monto, k.creado_en
        FROM cobro_cliente k WHERE k.cliente_id = ${id}::uuid AND k.estado = 'confirmado'
        UNION ALL
        SELECT (d.creado_en AT TIME ZONE 'America/Asuncion')::date::text, 'devolucion', 'Devolución N.º ' || d.numero, 0, a.monto, d.creado_en
        FROM cobro_aplicacion a JOIN devolucion d ON d.id = a.devolucion_id JOIN cuenta_cobrar c ON c.id = a.cuenta_cobrar_id
        WHERE c.cliente_id = ${id}::uuid
        ORDER BY creado_en`.execute(tx);
      let saldo = new Decimal(0);
      const deuda = cuentas.filter((x) => x.estado === 'pendiente' || x.estado === 'parcial').reduce((a, x) => a.plus(x.saldo), new Decimal(0));
      const h = hoy();
      return {
        cliente: { id: c.id, nombre: c.nombre, documento: c.documento, telefono: c.telefono },
        limiteCredito: c.limite_credito,
        plazoCreditoDias: c.plazo_credito_dias,
        deuda: deuda.toFixed(2),
        disponible: Decimal.max(new Decimal(c.limite_credito).minus(deuda), 0).toFixed(2),
        vencido: cuentas.filter((x) => (x.estado === 'pendiente' || x.estado === 'parcial') && x.vencimiento < h).reduce((a, x) => a.plus(x.saldo), new Decimal(0)).toFixed(2),
        cuentas: cuentas.filter((x) => x.estado === 'pendiente' || x.estado === 'parcial').map((x) => ({ id: x.id, descripcion: x.descripcion, fecha: x.fecha, vencimiento: x.vencimiento, vencida: x.vencimiento < h, monto: x.monto, saldo: x.saldo, estado: x.estado })),
        movimientos: movimientos.map((m) => {
          saldo = saldo.plus(m.debe).minus(m.haber);
          return { fecha: m.fecha, tipo: m.tipo, detalle: m.detalle, debe: new Decimal(m.debe).toFixed(2), haber: new Decimal(m.haber).toFixed(2), saldo: saldo.toFixed(2) };
        }),
      };
    });
  }
}

@Controller('cobros')
export class CobrosController {
  constructor(private readonly db: Db) {}

  @Requiere('cuenta_cobrar', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ clienteId: z.string().uuid().optional() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let q = tx
        .selectFrom('cobro_cliente as k')
        .innerJoin('cliente as c', 'c.id', 'k.cliente_id')
        .innerJoin('usuario as u', 'u.id', 'k.creado_por')
        .select(['k.id', 'k.numero', 'k.fecha', 'k.medio', 'k.monto', 'k.referencia', 'k.estado', 'k.sesion_caja_id', 'c.nombre as cliente', 'u.nombre as usuario'])
        .orderBy('k.numero', 'desc')
        .limit(300);
      if (f.clienteId) q = q.where('k.cliente_id', '=', f.clienteId);
      return (await q.execute()).map((k) => ({ id: k.id, numero: Number(k.numero), fecha: k.fecha, medio: k.medio, monto: k.monto, referencia: k.referencia, estado: k.estado, enCaja: !!k.sesion_caja_id, cliente: k.cliente, usuario: k.usuario }));
    });
  }

  /** Cobro de una o varias cuentas del cliente. En caja: el dinero entra a la sesión abierta del cajero. */
  @Requiere('cuenta_cobrar', 'crear')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(cobroEntrada, body);
    if (d.medio === 'efectivo' && !d.cajaId) throw invalido('El cobro en efectivo entra a una caja: indique la caja');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const cliente = await obtenerCliente(tx, d.clienteId);
      const ids = d.aplicaciones.map((a) => a.cuentaId);
      if (new Set(ids).size !== ids.length) throw invalido('Hay cuentas repetidas');
      const cuentas = await tx.selectFrom('cuenta_cobrar').selectAll().where('id', 'in', ids).orderBy('id').forUpdate().execute();
      if (cuentas.length !== ids.length) throw noEncontrado('Cuenta a cobrar');
      let total = new Decimal(0);
      for (const a of d.aplicaciones) {
        const c = cuentas.find((x) => x.id === a.cuentaId)!;
        if (!enSucursal(ctx, c.sucursal_id)) throw noEncontrado('Cuenta a cobrar');
        if (c.cliente_id !== d.clienteId) throw invalido('Todas las cuentas deben ser del mismo cliente');
        if (c.estado === 'cobrada' || c.estado === 'anulada') throw conflicto('CUENTA_CERRADA', `La cuenta "${c.descripcion}" ya está ${c.estado}`);
        const monto = new Decimal(a.monto).toDecimalPlaces(2);
        if (monto.gt(c.saldo)) throw invalido(`El cobro supera el saldo de "${c.descripcion}" (${new Decimal(c.saldo).toFixed(0)})`);
        total = total.plus(monto);
      }
      let sesionId: string | null = null;
      if (d.cajaId) {
        const caja = await obtenerCaja(tx, ctx, d.cajaId);
        const sesion = await sesionAbierta(tx, caja.id);
        if (!sesion || sesion.usuario_id !== ctx.usuarioId) throw conflicto('CAJA_CERRADA', 'Para cobrar en caja, ábrala con su usuario');
        sesionId = sesion.id;
      }
      const numero = await siguienteNumero(tx, 'cobro_cliente');
      const cobro = await tx
        .insertInto('cobro_cliente')
        .values({ empresa_id: ctx.empresaId, numero, cliente_id: d.clienteId, fecha: d.fecha, medio: d.medio, sesion_caja_id: sesionId, monto: total.toFixed(2), referencia: d.referencia ?? null, nota: d.nota ?? null, creado_por: ctx.usuarioId })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const a of d.aplicaciones) {
        const c = cuentas.find((x) => x.id === a.cuentaId)!;
        const monto = new Decimal(a.monto).toDecimalPlaces(2);
        const saldo = new Decimal(c.saldo).minus(monto);
        await tx.insertInto('cobro_aplicacion').values({ empresa_id: ctx.empresaId, cobro_id: cobro.id, devolucion_id: null, cuenta_cobrar_id: c.id, monto: monto.toFixed(2) }).execute();
        await tx.updateTable('cuenta_cobrar').set({ saldo: saldo.toFixed(2), estado: saldo.isZero() ? 'cobrada' : 'parcial' }).where('id', '=', c.id).execute();
      }
      if (sesionId) {
        await tx
          .insertInto('movimiento_caja')
          .values({ empresa_id: ctx.empresaId, sesion_id: sesionId, tipo: 'cobro', medio: MEDIO_CAJA[d.medio], moneda: 'PYG', monto: total.toFixed(2), venta_id: null, motivo: `Cobro N.º ${numero} · ${cliente.nombre}`, autorizado_por: null, creado_por: ctx.usuarioId })
          .execute();
      }
      await auditar(tx, { ...ctx, ...o }, { accion: 'cobro', entidad: 'cliente', entidadId: d.clienteId, despues: { numero, cliente: cliente.nombre, total: total.toFixed(0), medio: d.medio } });
      return { id: cobro.id, numero, total: total.toFixed(2), cliente: cliente.nombre, fecha: d.fecha, medio: d.medio };
    });
  }

  /** Anula un cobro: devuelve la deuda a las cuentas y, si entró a una caja todavía abierta, saca el dinero. */
  @Requiere('cuenta_cobrar', 'cancelar')
  @Post(':id/anular')
  @HttpCode(200)
  anular(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ motivo: z.string().trim().min(3).max(300) }), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const k = await tx.selectFrom('cobro_cliente').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!k) throw noEncontrado('Cobro');
      if (k.estado === 'anulado') throw conflicto('YA_ANULADO', 'El cobro ya está anulado');
      if (k.sesion_caja_id) {
        const s = await tx.selectFrom('sesion_caja').select('estado').where('id', '=', k.sesion_caja_id).executeTakeFirstOrThrow();
        if (s.estado !== 'abierta') throw conflicto('SESION_CERRADA', 'El cobro entró a una caja ya cerrada: registre la devolución del dinero como retiro de caja');
        await tx
          .insertInto('movimiento_caja')
          .values({ empresa_id: ctx.empresaId, sesion_id: k.sesion_caja_id, tipo: 'cobro', medio: MEDIO_CAJA[k.medio], moneda: 'PYG', monto: new Decimal(k.monto).neg().toFixed(2), venta_id: null, motivo: `Anulación del cobro N.º ${Number(k.numero)}: ${d.motivo}`, autorizado_por: null, creado_por: ctx.usuarioId })
          .execute();
      }
      const apps = await tx.selectFrom('cobro_aplicacion').select(['cuenta_cobrar_id', 'monto']).where('cobro_id', '=', id).execute();
      for (const a of apps) {
        const c = await tx.selectFrom('cuenta_cobrar').select(['monto', 'saldo', 'estado']).where('id', '=', a.cuenta_cobrar_id).forUpdate().executeTakeFirstOrThrow();
        if (c.estado === 'anulada') continue;
        const saldo = new Decimal(c.saldo).plus(a.monto);
        await tx.updateTable('cuenta_cobrar').set({ saldo: saldo.toFixed(2), estado: saldo.eq(c.monto) ? 'pendiente' : 'parcial' }).where('id', '=', a.cuenta_cobrar_id).execute();
      }
      await tx.updateTable('cobro_cliente').set({ estado: 'anulado', anulado_por: ctx.usuarioId, anulado_en: new Date(), nota: k.nota ? `${k.nota} · Anulado: ${d.motivo}` : `Anulado: ${d.motivo}` }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'anular', entidad: 'cobro_cliente', entidadId: id, despues: { numero: Number(k.numero), motivo: d.motivo } });
      return { ok: true };
    });
  }
}
