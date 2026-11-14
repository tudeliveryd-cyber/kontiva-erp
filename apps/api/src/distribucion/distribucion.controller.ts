import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { rendicionEntrada, repartoEntrada, rutaClientesEntrada, rutaEntrada } from '@kontiva/shared';
import Decimal from 'decimal.js';
import { sql } from 'kysely';
import { z } from 'zod';
import { enSucursal, exigirSucursal } from '../comun/alcance';
import { auditar } from '../comun/auditoria';
import { Contexto, type Ctx, OrigenPeticion, type Origen } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { conflicto, ErrorNegocio, invalido, noEncontrado } from '../comun/errores';
import { siguienteNumero } from '../comun/stock';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';
import { CobrosController } from '../finanzas/cobrar.controller';
import { obtenerCaja, sesionAbierta } from '../operacion/cajas.controller';
import { DevolucionesController } from '../operacion/devoluciones.controller';
import { VentasController } from '../operacion/ventas.controller';

const hoyPy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function obtenerRuta(tx: Tx, ctx: Ctx, id: string) {
  const r = await tx.selectFrom('ruta').selectAll().where('id', '=', id).executeTakeFirst();
  if (!r || !enSucursal(ctx, r.sucursal_id)) throw noEncontrado('Ruta');
  return r;
}

@Controller('rutas')
export class RutasController {
  constructor(private readonly db: Db) {}

  @Requiere('entrega', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const filas = await tx
        .selectFrom('ruta as r')
        .innerJoin('sucursal as s', 's.id', 'r.sucursal_id')
        .select(['r.id', 'r.nombre', 'r.dias', 'r.nota', 'r.activa', 'r.sucursal_id', 's.nombre as sucursal'])
        .select((eb) => eb.selectFrom('cliente as c').whereRef('c.ruta_id', '=', 'r.id').where('c.activo', '=', true).select(eb.fn.countAll<string>().as('n')).as('clientes'))
        .orderBy('r.activa', 'desc')
        .orderBy('r.nombre')
        .execute();
      return filas.filter((r) => enSucursal(ctx, r.sucursal_id)).map((r) => ({ id: r.id, nombre: r.nombre, dias: r.dias, nota: r.nota, activa: r.activa, sucursalId: r.sucursal_id, sucursal: r.sucursal, clientes: Number(r.clientes ?? 0) }));
    });
  }

  @Requiere('entrega', 'editar')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(rutaEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      exigirSucursal(ctx, d.sucursalId, 'Sucursal');
      const r = await tx
        .insertInto('ruta')
        .values({ empresa_id: ctx.empresaId, sucursal_id: d.sucursalId, nombre: d.nombre, dias: [...new Set(d.dias)].sort(), nota: d.nota ?? null, activa: d.activa })
        .returning('id')
        .executeTakeFirstOrThrow()
        .catch((e: { code?: string }) => {
          if (e.code === '23505') throw conflicto('RUTA_EXISTE', 'Ya hay una ruta con ese nombre');
          throw e;
        });
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'ruta', entidadId: r.id, despues: d });
      return { id: r.id };
    });
  }

  @Requiere('entrega', 'editar')
  @Put(':id')
  editar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(rutaEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const antes = await obtenerRuta(tx, ctx, id);
      exigirSucursal(ctx, d.sucursalId, 'Sucursal');
      await tx
        .updateTable('ruta')
        .set({ sucursal_id: d.sucursalId, nombre: d.nombre, dias: [...new Set(d.dias)].sort(), nota: d.nota ?? null, activa: d.activa })
        .where('id', '=', id)
        .execute()
        .catch((e: { code?: string }) => {
          if (e.code === '23505') throw conflicto('RUTA_EXISTE', 'Ya hay una ruta con ese nombre');
          throw e;
        });
      await auditar(tx, { ...ctx, ...o }, { accion: 'editar', entidad: 'ruta', entidadId: id, antes: { nombre: antes.nombre, dias: antes.dias, activa: antes.activa }, despues: d });
      return { id };
    });
  }

  /** Clientes de la ruta en el orden de visita, y los clientes sin ruta para agregar. */
  @Requiere('entrega', 'ver')
  @Get(':id/clientes')
  clientes(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      await obtenerRuta(tx, ctx, id);
      const filas = await tx
        .selectFrom('cliente')
        .select(['id', 'nombre', 'documento', 'direccion', 'telefono', 'orden_ruta'])
        .where('ruta_id', '=', id)
        .where('activo', '=', true)
        .orderBy('orden_ruta')
        .orderBy('nombre')
        .execute();
      return filas.map((c) => ({ id: c.id, nombre: c.nombre, documento: c.documento, direccion: c.direccion, telefono: c.telefono }));
    });
  }

  @Requiere('entrega', 'editar')
  @Put(':id/clientes')
  ordenar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(rutaClientesEntrada, body);
    if (new Set(d.clienteIds).size !== d.clienteIds.length) throw invalido('Hay clientes repetidos');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const r = await obtenerRuta(tx, ctx, id);
      if (d.clienteIds.length) {
        const n = await tx.selectFrom('cliente').select('id').where('id', 'in', d.clienteIds).where('activo', '=', true).execute();
        if (n.length !== d.clienteIds.length) throw noEncontrado('Cliente');
      }
      // Los que salen de la ruta quedan sin ruta; un cliente está en una sola ruta.
      let fuera = tx.updateTable('cliente').set({ ruta_id: null, orden_ruta: null }).where('ruta_id', '=', id);
      if (d.clienteIds.length) fuera = fuera.where('id', 'not in', d.clienteIds);
      await fuera.execute();
      for (const [i, cid] of d.clienteIds.entries()) await tx.updateTable('cliente').set({ ruta_id: id, orden_ruta: i + 1 }).where('id', '=', cid).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'editar', entidad: 'ruta', entidadId: id, despues: { ruta: r.nombre, clientes: d.clienteIds.length } });
      return { clientes: d.clienteIds.length };
    });
  }
}

// ── Repartos ─────────────────────────────────────────────────────────────────

async function leerReparto(tx: Tx, ctx: Ctx, id: string) {
  const r = await tx
    .selectFrom('reparto as r')
    .innerJoin('caja as c', 'c.id', 'r.caja_id')
    .innerJoin('sucursal as s', 's.id', 'r.sucursal_id')
    .leftJoin('ruta as ru', 'ru.id', 'r.ruta_id')
    .leftJoin('usuario as ud', 'ud.id', 'r.despachado_por')
    .leftJoin('usuario as ur', 'ur.id', 'r.rendido_por')
    .selectAll('r')
    .select(['c.nombre as caja', 'c.deposito_id', 's.nombre as sucursal', 'ru.nombre as ruta', 'ud.nombre as despachador', 'ur.nombre as rendidor'])
    .where('r.id', '=', id)
    .executeTakeFirst();
  if (!r || !enSucursal(ctx, r.sucursal_id)) return null;
  const pedidos = await tx
    .selectFrom('reparto_pedido as rp')
    .innerJoin('pedido as p', 'p.id', 'rp.pedido_id')
    .leftJoin('cliente as cl', 'cl.id', 'p.cliente_id')
    .leftJoin('venta as v', 'v.id', 'rp.venta_id')
    .leftJoin('cuenta_cobrar as cc', 'cc.venta_id', 'rp.venta_id')
    .leftJoin('devolucion as d', 'd.id', 'rp.devolucion_id')
    .select([
      'rp.pedido_id', 'rp.orden', 'rp.estado', 'rp.venta_id', 'rp.cobrado', 'rp.medio', 'rp.motivo',
      'p.numero', 'p.total', 'p.estado as estado_pedido', 'p.cliente_id', 'p.nota',
      'cl.nombre as cliente', 'cl.documento', 'cl.direccion', 'cl.telefono',
      'v.numero as venta', 'v.total as total_venta', 'v.comprobante', 'cc.id as cuenta_id', 'cc.saldo', 'cc.vencimiento', 'd.total as devuelto',
    ])
    .where('rp.reparto_id', '=', id)
    .orderBy('rp.orden')
    .execute();
  // Hoja de carga: lo que se sube al vehículo, sumado por producto.
  const carga = pedidos.length
    ? await tx
        .selectFrom('pedido_item as i')
        .innerJoin('variante as v', 'v.id', 'i.variante_id')
        .innerJoin('producto as p', 'p.id', 'v.producto_id')
        .select(['i.variante_id', 'p.nombre as producto', 'v.nombre as variante', 'v.sku', 'p.unidad', (eb) => eb.fn.sum<string>('i.cantidad').as('cantidad')])
        .where('i.pedido_id', 'in', pedidos.map((p) => p.pedido_id))
        .groupBy(['i.variante_id', 'p.nombre', 'v.nombre', 'v.sku', 'p.unidad'])
        .orderBy('p.nombre')
        .execute()
    : [];
  return {
    id: r.id,
    numero: Number(r.numero),
    fecha: r.fecha,
    estado: r.estado,
    sucursalId: r.sucursal_id,
    sucursal: r.sucursal,
    caja: { id: r.caja_id, nombre: r.caja },
    ruta: r.ruta_id ? { id: r.ruta_id, nombre: r.ruta! } : null,
    repartidor: r.repartidor,
    funcionarioId: r.funcionario_id,
    vehiculo: r.vehiculo,
    nota: r.nota,
    despachadoEn: r.despachado_en,
    despachador: r.despachador,
    rendidoEn: r.rendido_en,
    rendidor: r.rendidor,
    efectivoEsperado: r.efectivo_esperado,
    efectivoEntregado: r.efectivo_entregado,
    diferencia: r.efectivo_entregado !== null && r.efectivo_esperado !== null ? new Decimal(r.efectivo_entregado).minus(r.efectivo_esperado).toFixed(2) : null,
    total: pedidos.reduce((a, p) => a.plus(p.total_venta ?? p.total), new Decimal(0)).toFixed(2),
    cobrado: pedidos.reduce((a, p) => a.plus(p.cobrado), new Decimal(0)).toFixed(2),
    pedidos: pedidos.map((p) => ({
      pedidoId: p.pedido_id,
      numero: Number(p.numero),
      orden: p.orden,
      estado: p.estado,
      estadoPedido: p.estado_pedido,
      cliente: p.cliente_id ? { id: p.cliente_id, nombre: p.cliente!, documento: p.documento, direccion: p.direccion, telefono: p.telefono } : null,
      nota: p.nota,
      total: p.total_venta ?? p.total,
      venta: p.venta_id ? { id: p.venta_id, numero: Number(p.venta), comprobante: p.comprobante } : null,
      cuenta: p.cuenta_id ? { id: p.cuenta_id, saldo: p.saldo!, vencimiento: p.vencimiento } : null,
      devuelto: p.devuelto,
      cobrado: p.cobrado,
      medio: p.medio,
      motivo: p.motivo,
    })),
    carga: carga.map((c) => ({ varianteId: c.variante_id, descripcion: c.variante ? `${c.producto} · ${c.variante}` : c.producto, sku: c.sku, unidad: c.unidad, cantidad: c.cantidad })),
  };
}

/** Pedidos que se pueden cargar: pendientes o preparados, con cliente, que no están en otro reparto abierto. */
function pedidosLibres(tx: Tx) {
  return tx
    .selectFrom('pedido as p')
    .innerJoin('cliente as c', 'c.id', 'p.cliente_id')
    .where('p.tipo', '=', 'pedido')
    .where('p.estado', 'in', ['pendiente', 'preparado'])
    .where((eb) =>
      eb.not(
        eb.exists(
          eb.selectFrom('reparto_pedido as rp').innerJoin('reparto as r', 'r.id', 'rp.reparto_id').select('rp.pedido_id').whereRef('rp.pedido_id', '=', 'p.id').where('r.estado', 'in', ['preparacion', 'en_ruta']),
        ),
      ),
    );
}

@Controller('repartos')
export class RepartosController {
  constructor(
    private readonly db: Db,
    private readonly ventas: VentasController,
    private readonly cobros: CobrosController,
    private readonly devoluciones: DevolucionesController,
  ) {}

  @Requiere('entrega', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ desde: fecha.optional(), hasta: fecha.optional(), estado: z.enum(['preparacion', 'en_ruta', 'rendido', 'anulado', '']).optional() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let q = tx
        .selectFrom('reparto as r')
        .leftJoin('ruta as ru', 'ru.id', 'r.ruta_id')
        .select(['r.id', 'r.numero', 'r.fecha', 'r.estado', 'r.repartidor', 'r.vehiculo', 'r.sucursal_id', 'ru.nombre as ruta', 'r.efectivo_esperado', 'r.efectivo_entregado'])
        .select((eb) => [
          eb.selectFrom('reparto_pedido as rp').whereRef('rp.reparto_id', '=', 'r.id').select(eb.fn.countAll<string>().as('n')).as('pedidos'),
          eb.selectFrom('reparto_pedido as rp').innerJoin('pedido as p', 'p.id', 'rp.pedido_id').whereRef('rp.reparto_id', '=', 'r.id').select(sql<string>`coalesce(sum(p.total), 0)`.as('t')).as('total'),
          eb.selectFrom('reparto_pedido as rp').whereRef('rp.reparto_id', '=', 'r.id').select(sql<string>`coalesce(sum(rp.cobrado), 0)`.as('c')).as('cobrado'),
        ])
        .orderBy('r.fecha', 'desc')
        .orderBy('r.numero', 'desc')
        .limit(300);
      if (f.desde) q = q.where('r.fecha', '>=', f.desde);
      if (f.hasta) q = q.where('r.fecha', '<=', f.hasta);
      if (f.estado) q = q.where('r.estado', '=', f.estado);
      return (await q.execute())
        .filter((r) => enSucursal(ctx, r.sucursal_id))
        .map((r) => ({
          id: r.id,
          numero: Number(r.numero),
          fecha: r.fecha,
          estado: r.estado,
          repartidor: r.repartidor,
          vehiculo: r.vehiculo,
          ruta: r.ruta,
          pedidos: Number(r.pedidos ?? 0),
          total: r.total ?? '0',
          cobrado: r.cobrado ?? '0',
          diferencia: r.efectivo_entregado !== null && r.efectivo_esperado !== null ? new Decimal(r.efectivo_entregado).minus(r.efectivo_esperado).toFixed(2) : null,
        }));
    });
  }

  /** Pedidos para armar un reparto: por fecha de entrega y ruta del cliente, en el orden de visita. */
  @Requiere('entrega', 'ver')
  @Get('pedidos')
  pedidos(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ sucursalId: z.string().uuid(), hasta: fecha.optional(), rutaId: z.string().uuid().optional() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      exigirSucursal(ctx, f.sucursalId, 'Sucursal');
      let q = pedidosLibres(tx)
        .leftJoin('ruta as ru', 'ru.id', 'c.ruta_id')
        .select(['p.id', 'p.numero', 'p.entrega_prevista', 'p.total', 'p.estado', 'p.nota', 'c.id as cliente_id', 'c.nombre as cliente', 'c.direccion', 'c.ruta_id', 'c.orden_ruta', 'ru.nombre as ruta'])
        .where('p.sucursal_id', '=', f.sucursalId)
        .orderBy(sql`ru.nombre nulls last`)
        .orderBy(sql`c.orden_ruta nulls last`)
        .orderBy('c.nombre')
        .limit(500);
      if (f.hasta) q = q.where((eb) => eb.or([eb('p.entrega_prevista', 'is', null), eb('p.entrega_prevista', '<=', f.hasta!)]));
      if (f.rutaId) q = q.where('c.ruta_id', '=', f.rutaId);
      return (await q.execute()).map((p) => ({
        id: p.id,
        numero: Number(p.numero),
        entregaPrevista: p.entrega_prevista,
        total: p.total,
        estado: p.estado,
        nota: p.nota,
        cliente: { id: p.cliente_id, nombre: p.cliente, direccion: p.direccion },
        ruta: p.ruta_id ? { id: p.ruta_id, nombre: p.ruta!, orden: p.orden_ruta } : null,
      }));
    });
  }

  @Requiere('entrega', 'ver')
  @Get(':id')
  ver(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const r = await leerReparto(tx, ctx, id);
      if (!r) throw noEncontrado('Reparto');
      return r;
    });
  }

  @Requiere('entrega', 'crear')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(repartoEntrada, body);
    if (new Set(d.pedidoIds).size !== d.pedidoIds.length) throw invalido('Hay pedidos repetidos');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const caja = await obtenerCaja(tx, ctx, d.cajaId);
      if (d.rutaId) {
        const ru = await obtenerRuta(tx, ctx, d.rutaId);
        if (ru.sucursal_id !== caja.sucursal_id) throw invalido('La ruta es de otra sucursal');
      }
      if (d.funcionarioId) {
        const fu = await tx.selectFrom('funcionario').select('id').where('id', '=', d.funcionarioId).executeTakeFirst();
        if (!fu) throw noEncontrado('Funcionario');
      }
      await this.validarPedidos(tx, d.pedidoIds, caja.sucursal_id, null);
      const numero = await siguienteNumero(tx, 'reparto');
      const r = await tx
        .insertInto('reparto')
        .values({ empresa_id: ctx.empresaId, numero, sucursal_id: caja.sucursal_id, caja_id: caja.id, ruta_id: d.rutaId ?? null, fecha: d.fecha, repartidor: d.repartidor, funcionario_id: d.funcionarioId ?? null, vehiculo: d.vehiculo ?? null, nota: d.nota ?? null, creado_por: ctx.usuarioId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx.insertInto('reparto_pedido').values(d.pedidoIds.map((pid, i) => ({ empresa_id: ctx.empresaId, reparto_id: r.id, pedido_id: pid, orden: i + 1 }))).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'reparto', entidadId: r.id, despues: { numero, fecha: d.fecha, repartidor: d.repartidor, pedidos: d.pedidoIds.length } });
      return (await leerReparto(tx, ctx, r.id))!;
    });
  }

  /** Mientras se prepara: cambiar datos, pedidos y su orden. */
  @Requiere('entrega', 'crear')
  @Put(':id')
  editar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(repartoEntrada, body);
    if (new Set(d.pedidoIds).size !== d.pedidoIds.length) throw invalido('Hay pedidos repetidos');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const r = await this.bloquear(tx, ctx, id);
      if (r.estado !== 'preparacion') throw conflicto('REPARTO_DESPACHADO', 'El reparto ya salió: no se puede cambiar');
      const caja = await obtenerCaja(tx, ctx, d.cajaId);
      if (caja.sucursal_id !== r.sucursal_id) throw invalido('La caja es de otra sucursal');
      if (d.rutaId) await obtenerRuta(tx, ctx, d.rutaId);
      await this.validarPedidos(tx, d.pedidoIds, r.sucursal_id, id);
      await tx.updateTable('reparto').set({ caja_id: caja.id, ruta_id: d.rutaId ?? null, fecha: d.fecha, repartidor: d.repartidor, funcionario_id: d.funcionarioId ?? null, vehiculo: d.vehiculo ?? null, nota: d.nota ?? null }).where('id', '=', id).execute();
      await tx.deleteFrom('reparto_pedido').where('reparto_id', '=', id).execute();
      await tx.insertInto('reparto_pedido').values(d.pedidoIds.map((pid, i) => ({ empresa_id: ctx.empresaId, reparto_id: id, pedido_id: pid, orden: i + 1 }))).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'editar', entidad: 'reparto', entidadId: id, despues: { pedidos: d.pedidoIds.length, repartidor: d.repartidor } });
      return (await leerReparto(tx, ctx, id))!;
    });
  }

  @Requiere('entrega', 'cancelar')
  @Post(':id/anular')
  @HttpCode(200)
  anular(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ motivo: z.string().trim().min(3).max(300) }), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const r = await this.bloquear(tx, ctx, id);
      if (r.estado !== 'preparacion') throw conflicto('REPARTO_DESPACHADO', 'El reparto ya salió: se cierra con la rendición (lo no entregado vuelve)');
      const facturados = await tx.selectFrom('reparto_pedido').select('pedido_id').where('reparto_id', '=', id).where('venta_id', 'is not', null).execute();
      if (facturados.length) throw conflicto('REPARTO_FACTURADO', 'Hay pedidos ya facturados: termine el despacho y rinda el reparto');
      await tx.updateTable('reparto').set({ estado: 'anulado', nota: d.motivo }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'anular', entidad: 'reparto', entidadId: id, despues: { numero: Number(r.numero), motivo: d.motivo } });
      return (await leerReparto(tx, ctx, id))!;
    });
  }

  /**
   * Despacho: cada pedido se factura (la factura viaja con la mercadería) a la cuenta del cliente y la
   * mercadería sale del depósito de la caja. Si un pedido falla, los demás quedan facturados y se puede reintentar.
   */
  @Requiere('entrega', 'crear')
  @Post(':id/despachar')
  @HttpCode(200)
  async despachar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @OrigenPeticion() o: Origen) {
    const { reparto, pendientes } = await this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const r = await this.bloquear(tx, ctx, id);
      if (r.estado !== 'preparacion') throw conflicto('REPARTO_DESPACHADO', 'El reparto ya salió');
      const sesion = await sesionAbierta(tx, r.caja_id);
      if (!sesion || sesion.usuario_id !== ctx.usuarioId) throw conflicto('CAJA_CERRADA', 'Para facturar los pedidos, abra la caja del reparto con su usuario');
      const ps = await tx
        .selectFrom('reparto_pedido as rp')
        .innerJoin('pedido as p', 'p.id', 'rp.pedido_id')
        .select(['rp.pedido_id', 'p.numero', 'p.cliente_id'])
        .where('rp.reparto_id', '=', id)
        .where('rp.venta_id', 'is', null)
        .orderBy('rp.orden')
        .execute();
      const items = ps.length ? await tx.selectFrom('pedido_item').select(['pedido_id', 'variante_id', 'cantidad', 'descuento']).where('pedido_id', 'in', ps.map((p) => p.pedido_id)).orderBy('linea').execute() : [];
      return { reparto: r, pendientes: ps.map((p) => ({ ...p, items: items.filter((i) => i.pedido_id === p.pedido_id) })) };
    });
    const errores: { pedido: number; mensaje: string }[] = [];
    for (const p of pendientes) {
      try {
        const v = await this.ventas.crear(
          ctx,
          {
            claveIdempotencia: `rep:${id.slice(-12)}:${p.pedido_id}`,
            cajaId: reparto.caja_id,
            clienteId: p.cliente_id,
            pedidoId: p.pedido_id,
            items: p.items.map((i) => ({ varianteId: i.variante_id, cantidad: Number(i.cantidad), ...(Number(i.descuento) > 0 && { descuento: Number(i.descuento) }) })),
          },
          undefined,
          o,
          { reparto: Number(reparto.numero) },
        );
        await this.db.enEmpresa(ctx.empresaId, (tx) => tx.updateTable('reparto_pedido').set({ venta_id: v.id }).where('reparto_id', '=', id).where('pedido_id', '=', p.pedido_id).execute());
      } catch (e) {
        errores.push({ pedido: Number(p.numero), mensaje: e instanceof ErrorNegocio || e instanceof Error ? e.message : 'Error al facturar' });
      }
    }
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const faltan = await tx.selectFrom('reparto_pedido').select('pedido_id').where('reparto_id', '=', id).where('venta_id', 'is', null).execute();
      if (!faltan.length) {
        await tx.updateTable('reparto').set({ estado: 'en_ruta', despachado_en: new Date(), despachado_por: ctx.usuarioId }).where('id', '=', id).where('estado', '=', 'preparacion').execute();
        await auditar(tx, { ...ctx, ...o }, { accion: 'despachar', entidad: 'reparto', entidadId: id, despues: { numero: Number(reparto.numero), pedidos: pendientes.length } });
      }
      return { ...(await leerReparto(tx, ctx, id))!, errores };
    });
  }

  /**
   * Rendición: por cada pedido, lo entregado, lo que volvió (nota de crédito) y lo cobrado (entra a la caja
   * del reparto; lo no cobrado queda en la cuenta del cliente). Se compara el efectivo entregado con el cobrado.
   * Cada pedido se registra una sola vez: si algo falla, se corrige y se vuelve a enviar.
   */
  @Requiere('entrega', 'editar')
  @Post(':id/rendir')
  @HttpCode(200)
  async rendir(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(rendicionEntrada.extend({ entregas: rendicionEntrada.shape.entregas.element.extend({ reprogramar: z.boolean().default(false) }).array().min(1).max(300) }), body);
    const { reparto, filas } = await this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const r = await this.bloquear(tx, ctx, id);
      if (r.estado !== 'en_ruta') throw conflicto('REPARTO_NO_EN_RUTA', r.estado === 'rendido' ? 'El reparto ya se rindió' : 'El reparto todavía no salió');
      const sesion = await sesionAbierta(tx, r.caja_id);
      if (!sesion || sesion.usuario_id !== ctx.usuarioId) throw conflicto('CAJA_CERRADA', 'Para recibir la rendición, abra la caja del reparto con su usuario');
      const fs = await tx
        .selectFrom('reparto_pedido as rp')
        .innerJoin('pedido as p', 'p.id', 'rp.pedido_id')
        .leftJoin('cuenta_cobrar as cc', 'cc.venta_id', 'rp.venta_id')
        .select(['rp.pedido_id', 'rp.venta_id', 'rp.devolucion_id', 'rp.cobro_id', 'rp.estado', 'p.numero', 'p.cliente_id', 'cc.id as cuenta_id', 'cc.saldo'])
        .where('rp.reparto_id', '=', id)
        .execute();
      const faltan = fs.filter((f) => f.estado === 'pendiente' && !d.entregas.some((e) => e.pedidoId === f.pedido_id));
      if (faltan.length) throw invalido(`Falta indicar qué pasó con el pedido N.º ${faltan.map((f) => Number(f.numero)).join(', N.º ')}`);
      for (const e of d.entregas) {
        const f = fs.find((x) => x.pedido_id === e.pedidoId);
        if (!f) throw invalido('Un pedido no es de este reparto');
        if (e.estado === 'rechazado' && e.cobrado > 0) throw invalido(`Pedido N.º ${Number(f.numero)}: rechazado no puede tener cobro`);
        if (e.estado === 'parcial' && !e.devuelto.length) throw invalido(`Pedido N.º ${Number(f.numero)}: indique lo que volvió`);
        if (e.estado === 'rechazado' && !e.motivo) throw invalido(`Pedido N.º ${Number(f.numero)}: indique el motivo del rechazo`);
      }
      return { reparto: r, filas: fs };
    });

    for (const e of d.entregas) {
      const f = filas.find((x) => x.pedido_id === e.pedidoId)!;
      if (f.estado !== 'pendiente') continue; // ya rendido en un intento anterior
      const numero = Number(f.numero);
      try {
        // Lo que volvió: devolución sobre la venta (con factura, nota de crédito); descuenta de la cuenta del cliente.
        let devolucionId = f.devolucion_id;
        if (!devolucionId && (e.estado === 'rechazado' || e.devuelto.length)) {
          let items = e.devuelto;
          if (e.estado === 'rechazado') {
            const v = await this.db.enEmpresa(ctx.empresaId, (tx) => tx.selectFrom('venta_item').select(['linea', 'cantidad']).where('venta_id', '=', f.venta_id!).orderBy('linea').execute());
            items = v.map((i) => ({ linea: i.linea, cantidad: Number(i.cantidad) }));
          }
          const dev = await this.devoluciones.crear(ctx, { ventaId: f.venta_id, cajaId: reparto.caja_id, medio: 'efectivo', motivo: e.motivo ?? (e.estado === 'rechazado' ? 'Rechazado en el reparto' : 'Devuelto en el reparto'), items }, undefined, o);
          devolucionId = dev.id;
          await this.db.enEmpresa(ctx.empresaId, (tx) => tx.updateTable('reparto_pedido').set({ devolucion_id: dev.id }).where('reparto_id', '=', id).where('pedido_id', '=', e.pedidoId).execute());
        }
        // Lo cobrado por el repartidor entra a la caja como cobro de la cuenta de esta venta.
        let cobroId = f.cobro_id;
        if (!cobroId && e.cobrado > 0) {
          const cuenta = await this.db.enEmpresa(ctx.empresaId, (tx) => tx.selectFrom('cuenta_cobrar').select(['id', 'saldo']).where('venta_id', '=', f.venta_id!).executeTakeFirst());
          if (!cuenta || new Decimal(e.cobrado).gt(cuenta.saldo)) throw invalido(`Lo cobrado supera lo que debe el cliente por este pedido (${new Decimal(cuenta?.saldo ?? 0).toFixed(0)})`);
          const c = await this.cobros.crear(ctx, { clienteId: f.cliente_id, fecha: hoyPy(), medio: e.medio, cajaId: reparto.caja_id, referencia: `Reparto N.º ${Number(reparto.numero)}`, aplicaciones: [{ cuentaId: cuenta.id, monto: e.cobrado }] }, o);
          cobroId = c.id;
        }
        await this.db.enEmpresa(ctx.empresaId, async (tx) => {
          await tx
            .updateTable('reparto_pedido')
            .set({ estado: e.estado, cobrado: new Decimal(e.cobrado).toFixed(2), medio: e.cobrado > 0 ? e.medio : null, motivo: e.motivo ?? null, cobro_id: cobroId, devolucion_id: devolucionId })
            .where('reparto_id', '=', id)
            .where('pedido_id', '=', e.pedidoId)
            .execute();
          // Rechazado: el pedido se reprograma para otro reparto o se cancela.
          if (e.estado === 'rechazado') {
            await tx
              .updateTable('pedido')
              .set(e.reprogramar ? { estado: 'pendiente', venta_id: null, actualizado_en: new Date() } : { estado: 'cancelado', motivo_cierre: e.motivo ?? 'Rechazado en el reparto', cerrado_por: ctx.usuarioId, cerrado_en: new Date(), actualizado_en: new Date() })
              .where('id', '=', e.pedidoId)
              .execute();
          }
        });
      } catch (err) {
        const m = err instanceof Error ? err.message : 'Error';
        throw new ErrorNegocio(err instanceof ErrorNegocio ? err.getStatus() : 409, 'RENDICION_PEDIDO', `Pedido N.º ${numero}: ${m}. Los pedidos anteriores ya quedaron registrados; corrija y vuelva a enviar.`);
      }
    }

    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const rp = await tx.selectFrom('reparto_pedido').select(['estado', 'cobrado', 'medio']).where('reparto_id', '=', id).execute();
      const esperado = rp.filter((x) => x.medio === 'efectivo').reduce((a, x) => a.plus(x.cobrado), new Decimal(0));
      await tx
        .updateTable('reparto')
        .set({ estado: 'rendido', rendido_en: new Date(), rendido_por: ctx.usuarioId, efectivo_esperado: esperado.toFixed(2), efectivo_entregado: new Decimal(d.efectivoEntregado).toFixed(2), ...(d.nota && { nota: d.nota }) })
        .where('id', '=', id)
        .execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'rendir', entidad: 'reparto', entidadId: id, despues: { numero: Number(reparto.numero), esperado: esperado.toFixed(0), entregado: new Decimal(d.efectivoEntregado).toFixed(0) } });
      return (await leerReparto(tx, ctx, id))!;
    });
  }

  private async bloquear(tx: Tx, ctx: Ctx, id: string) {
    const r = await tx.selectFrom('reparto').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!r || !enSucursal(ctx, r.sucursal_id)) throw noEncontrado('Reparto');
    return r;
  }

  private async validarPedidos(tx: Tx, ids: string[], sucursalId: string, repartoId: string | null) {
    const ps = await tx.selectFrom('pedido').select(['id', 'numero', 'tipo', 'estado', 'sucursal_id', 'cliente_id']).where('id', 'in', ids).execute();
    if (ps.length !== ids.length || ps.some((p) => p.tipo !== 'pedido')) throw noEncontrado('Pedido');
    for (const p of ps) {
      if (p.sucursal_id !== sucursalId) throw invalido(`El pedido N.º ${Number(p.numero)} es de otra sucursal`);
      if (p.estado !== 'pendiente' && p.estado !== 'preparado') throw conflicto('PEDIDO_CERRADO', `El pedido N.º ${Number(p.numero)} ya fue entregado o cancelado`);
      if (!p.cliente_id) throw invalido(`El pedido N.º ${Number(p.numero)} no tiene un cliente registrado`);
    }
    let q = tx
      .selectFrom('reparto_pedido as rp')
      .innerJoin('reparto as r', 'r.id', 'rp.reparto_id')
      .innerJoin('pedido as p', 'p.id', 'rp.pedido_id')
      .select(['p.numero', 'r.numero as reparto'])
      .where('rp.pedido_id', 'in', ids)
      .where('r.estado', 'in', ['preparacion', 'en_ruta']);
    if (repartoId) q = q.where('r.id', '<>', repartoId);
    const otro = await q.executeTakeFirst();
    if (otro) throw conflicto('PEDIDO_EN_REPARTO', `El pedido N.º ${Number(otro.numero)} ya está en el reparto N.º ${Number(otro.reparto)}`);
  }
}
