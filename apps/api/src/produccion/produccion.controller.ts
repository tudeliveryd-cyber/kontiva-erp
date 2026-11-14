import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { mermaEntrada, ordenProduccionEntrada, recetaProduccionEntrada, terminarProduccionEntrada } from '@kontiva/shared';
import Decimal from 'decimal.js';
import { sql } from 'kysely';
import { z } from 'zod';
import { enSucursal, exigirSucursal, preciosVigentes } from '../comun/alcance';
import { auditar } from '../comun/auditoria';
import { Contexto, OrigenPeticion, tiene, type Ctx, type Origen } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { conflicto, invalido, noEncontrado } from '../comun/errores';
import { moverStock } from '../comun/stock';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';

const fechaDia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hoyPy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());

async function obtenerDeposito(tx: Tx, ctx: Ctx, id: string) {
  const d = await tx.selectFrom('deposito').select(['id', 'nombre', 'sucursal_id']).where('id', '=', id).executeTakeFirst();
  if (!d) throw noEncontrado('Depósito');
  exigirSucursal(ctx, d.sucursal_id, 'Depósito');
  return d;
}

/** Datos de variantes para recetas y órdenes. */
async function variantes(tx: Tx, ids: string[]) {
  if (!ids.length) return new Map<string, { id: string; descripcion: string; unidad: string; costo: string; controla_stock: boolean; tipo: string; activo: boolean }>();
  const r = await tx
    .selectFrom('variante as v')
    .innerJoin('producto as p', 'p.id', 'v.producto_id')
    .select(['v.id', 'v.nombre', 'p.nombre as producto', 'p.unidad', 'v.costo', 'p.controla_stock', 'p.tipo', 'p.activo', 'v.activa'])
    .where('v.id', 'in', ids)
    .execute();
  return new Map(r.map((x) => [x.id, { id: x.id, descripcion: x.nombre ? `${x.producto} · ${x.nombre}` : x.producto, unidad: x.unidad, costo: x.costo, controla_stock: x.controla_stock, tipo: x.tipo, activo: x.activo && x.activa }]));
}

/** Receta con sus insumos y el costo teórico (si el usuario ve costos) y el margen contra el precio. */
async function leerReceta(tx: Tx, ctx: Ctx, id: string, sucursalId?: string) {
  const r = await tx.selectFrom('receta_produccion').selectAll().where('id', '=', id).executeTakeFirst();
  if (!r) throw noEncontrado('Receta');
  const ins = await tx.selectFrom('receta_produccion_insumo').selectAll().where('receta_id', '=', id).orderBy('linea').execute();
  const vs = await variantes(tx, [r.variante_id, ...ins.map((i) => i.variante_id)]);
  const verCosto = tiene(ctx, 'costo_producto.ver');
  const costoTanda = ins.reduce((s, i) => s.plus(new Decimal(i.cantidad).mul(vs.get(i.variante_id)!.costo)), new Decimal(0));
  const costoUnitario = costoTanda.div(r.rendimiento);
  const precio = sucursalId ? (await preciosVigentes(tx, [r.variante_id], sucursalId)).get(r.variante_id) : undefined;
  const p = vs.get(r.variante_id)!;
  return {
    id: r.id,
    varianteId: r.variante_id,
    descripcion: p.descripcion,
    unidad: p.unidad,
    rendimiento: r.rendimiento,
    minutos: r.minutos,
    nota: r.nota,
    activa: r.activa,
    actualizadoEn: r.actualizado_en,
    insumos: ins.map((i) => {
      const v = vs.get(i.variante_id)!;
      return { linea: i.linea, varianteId: i.variante_id, descripcion: v.descripcion, unidad: v.unidad, cantidad: i.cantidad, ...(verCosto ? { costo: v.costo, subtotal: new Decimal(i.cantidad).mul(v.costo).toFixed(2) } : {}) };
    }),
    ...(verCosto
      ? {
          costoTanda: costoTanda.toFixed(2),
          costoUnitario: costoUnitario.toFixed(2),
          ...(precio && Number(precio) > 0 ? { precio, margen: new Decimal(precio).minus(costoUnitario).div(precio).mul(100).toFixed(1) } : {}),
        }
      : {}),
  };
}

async function leerOrden(tx: Tx, ctx: Ctx, id: string) {
  const o = await tx
    .selectFrom('orden_produccion as o')
    .innerJoin('deposito as d', 'd.id', 'o.deposito_id')
    .innerJoin('sucursal as s', 's.id', 'd.sucursal_id')
    .innerJoin('usuario as u', 'u.id', 'o.creado_por')
    .selectAll('o')
    .select(['d.nombre as deposito', 'd.sucursal_id', 's.nombre as sucursal', 'u.nombre as creador'])
    .where('o.id', '=', id)
    .executeTakeFirst();
  if (!o) throw noEncontrado('Orden de producción');
  exigirSucursal(ctx, o.sucursal_id, 'Orden de producción');
  const ins = await tx.selectFrom('orden_produccion_insumo').selectAll().where('orden_id', '=', id).orderBy('linea').execute();
  const vs = await variantes(tx, [o.variante_id, ...ins.map((i) => i.variante_id)]);
  const stocks = await tx.selectFrom('stock').select(['variante_id', 'cantidad']).where('deposito_id', '=', o.deposito_id).where('variante_id', 'in', ins.map((i) => i.variante_id).concat(o.variante_id)).execute();
  const stock = new Map(stocks.map((s) => [s.variante_id, s.cantidad]));
  const verCosto = tiene(ctx, 'costo_producto.ver');
  const prod = await tx.selectFrom('variante as v').innerJoin('producto as p', 'p.id', 'v.producto_id').select('p.controla_lote').where('v.id', '=', o.variante_id).executeTakeFirstOrThrow();
  return {
    id: o.id,
    numero: Number(o.numero),
    controlaLote: prod.controla_lote,
    estado: o.estado,
    fecha: o.fecha,
    varianteId: o.variante_id,
    descripcion: vs.get(o.variante_id)!.descripcion,
    unidad: vs.get(o.variante_id)!.unidad,
    depositoId: o.deposito_id,
    deposito: o.deposito,
    sucursal: o.sucursal,
    cantidadPlanificada: o.cantidad_planificada,
    cantidadProducida: o.cantidad_producida,
    lote: o.lote_codigo ? { codigo: o.lote_codigo, vencimiento: o.lote_vencimiento } : null,
    nota: o.nota,
    creador: o.creador,
    creadoEn: o.creado_en,
    terminadaEn: o.terminada_en,
    motivoAnulacion: o.motivo_anulacion,
    ...(verCosto ? { costoTotal: o.costo_total, costoUnitario: o.costo_unitario } : {}),
    insumos: ins.map((i) => {
      const v = vs.get(i.variante_id)!;
      return {
        linea: i.linea,
        varianteId: i.variante_id,
        descripcion: v.descripcion,
        unidad: v.unidad,
        cantidadTeorica: i.cantidad_teorica,
        cantidadReal: i.cantidad_real,
        stock: v.controla_stock ? (stock.get(i.variante_id) ?? '0.0000') : null,
        ...(verCosto ? { costoUnitario: i.costo_unitario ?? v.costo } : {}),
      };
    }),
  };
}

@Controller('produccion/recetas')
export class RecetasProduccionController {
  constructor(private readonly db: Db) {}

  @Requiere('produccion', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ sucursalId: z.string().uuid().optional() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const ids = (await tx.selectFrom('receta_produccion as r').innerJoin('variante as v', 'v.id', 'r.variante_id').innerJoin('producto as p', 'p.id', 'v.producto_id').select('r.id').orderBy('p.nombre').execute()).map((x) => x.id);
      const r = [];
      for (const id of ids) r.push(await leerReceta(tx, ctx, id, f.sucursalId));
      return r;
    });
  }

  @Requiere('produccion', 'ver')
  @Get(':id')
  detalle(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Query() query: unknown) {
    const f = validar(z.object({ sucursalId: z.string().uuid().optional() }), query);
    return this.db.enEmpresa(ctx.empresaId, (tx) => leerReceta(tx, ctx, id, f.sucursalId));
  }

  @Requiere('produccion', 'editar')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(recetaProduccionEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      await this.validarVariantes(tx, d);
      const dup = await tx.selectFrom('receta_produccion').select('id').where('variante_id', '=', d.varianteId).executeTakeFirst();
      if (dup) throw conflicto('RECETA_EXISTENTE', 'El producto ya tiene receta: edítela');
      const r = await tx
        .insertInto('receta_produccion')
        .values({ empresa_id: ctx.empresaId, variante_id: d.varianteId, rendimiento: new Decimal(d.rendimiento).toFixed(4), minutos: d.minutos ?? null, nota: d.nota ?? null, activa: d.activa, creado_por: ctx.usuarioId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.guardarInsumos(tx, ctx, r.id, d.insumos);
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'receta_produccion', entidadId: r.id, despues: d });
      return leerReceta(tx, ctx, r.id);
    });
  }

  @Requiere('produccion', 'editar')
  @Put(':id')
  editar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(recetaProduccionEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const antes = await leerReceta(tx, ctx, id);
      if (antes.varianteId !== d.varianteId) throw invalido('El producto de una receta no se cambia');
      await this.validarVariantes(tx, d);
      await tx.updateTable('receta_produccion').set({ rendimiento: new Decimal(d.rendimiento).toFixed(4), minutos: d.minutos ?? null, nota: d.nota ?? null, activa: d.activa }).where('id', '=', id).execute();
      await tx.deleteFrom('receta_produccion_insumo').where('receta_id', '=', id).execute();
      await this.guardarInsumos(tx, ctx, id, d.insumos);
      await auditar(tx, { ...ctx, ...o }, { accion: 'editar', entidad: 'receta_produccion', entidadId: id, antes: { rendimiento: antes.rendimiento, insumos: antes.insumos.map((i) => ({ varianteId: i.varianteId, cantidad: i.cantidad })) }, despues: d });
      return leerReceta(tx, ctx, id);
    });
  }

  private async validarVariantes(tx: Tx, d: { varianteId: string; insumos: { varianteId: string }[] }) {
    const vs = await variantes(tx, [d.varianteId, ...d.insumos.map((i) => i.varianteId)]);
    const p = vs.get(d.varianteId);
    if (!p || !p.activo) throw noEncontrado('Producto');
    if (p.tipo !== 'producto' || !p.controla_stock) throw invalido('El producto de una receta debe controlar stock');
    if (d.insumos.some((i) => !vs.get(i.varianteId) || vs.get(i.varianteId)!.tipo !== 'producto')) throw invalido('Algún insumo no existe o es un servicio');
  }

  private async guardarInsumos(tx: Tx, ctx: Ctx, recetaId: string, insumos: { varianteId: string; cantidad: number }[]) {
    await tx
      .insertInto('receta_produccion_insumo')
      .values(insumos.map((i, n) => ({ empresa_id: ctx.empresaId, receta_id: recetaId, linea: n + 1, variante_id: i.varianteId, cantidad: new Decimal(i.cantidad).toFixed(4) })))
      .execute();
  }
}

@Controller('produccion')
export class ProduccionController {
  constructor(private readonly db: Db) {}

  @Requiere('produccion', 'ver')
  @Get('ordenes')
  listar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ estado: z.enum(['planificada', 'terminada', 'anulada']).optional(), desde: fechaDia.optional(), hasta: fechaDia.optional() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let q = tx
        .selectFrom('orden_produccion as o')
        .innerJoin('variante as v', 'v.id', 'o.variante_id')
        .innerJoin('producto as p', 'p.id', 'v.producto_id')
        .innerJoin('deposito as d', 'd.id', 'o.deposito_id')
        .select(['o.id', 'o.numero', 'o.estado', 'o.fecha', 'o.cantidad_planificada', 'o.cantidad_producida', 'o.costo_unitario', 'p.nombre as producto', 'v.nombre as variante', 'p.unidad', 'd.nombre as deposito', 'd.sucursal_id'])
        .orderBy('o.fecha', 'desc')
        .orderBy('o.numero', 'desc')
        .limit(500);
      if (f.estado) q = q.where('o.estado', '=', f.estado);
      if (f.desde) q = q.where('o.fecha', '>=', f.desde);
      if (f.hasta) q = q.where('o.fecha', '<=', f.hasta);
      const verCosto = tiene(ctx, 'costo_producto.ver');
      return (await q.execute())
        .filter((x) => enSucursal(ctx, x.sucursal_id))
        .map((x) => ({
          id: x.id,
          numero: Number(x.numero),
          estado: x.estado,
          fecha: x.fecha,
          descripcion: x.variante ? `${x.producto} · ${x.variante}` : x.producto,
          unidad: x.unidad,
          deposito: x.deposito,
          cantidadPlanificada: x.cantidad_planificada,
          cantidadProducida: x.cantidad_producida,
          ...(verCosto ? { costoUnitario: x.costo_unitario } : {}),
        }));
    });
  }

  @Requiere('produccion', 'ver')
  @Get('ordenes/:id')
  detalle(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, (tx) => leerOrden(tx, ctx, id));
  }

  /** Planifica una orden: los insumos teóricos salen de la receta en proporción a la cantidad. */
  @Requiere('produccion', 'crear')
  @Post('ordenes')
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(ordenProduccionEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const id = await planificar(tx, ctx, d);
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'orden_produccion', entidadId: id, despues: d });
      return leerOrden(tx, ctx, id);
    });
  }

  /**
   * Termina la orden: descuenta los insumos realmente usados, ingresa lo producido al costo real
   * (insumos / unidades producidas) y actualiza el costo promedio del producto.
   */
  @Requiere('produccion', 'crear')
  @Post('ordenes/:id/terminar')
  @HttpCode(200)
  terminar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(terminarProduccionEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const orden = await tx.selectFrom('orden_produccion').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!orden) throw noEncontrado('Orden de producción');
      await obtenerDeposito(tx, ctx, orden.deposito_id);
      if (orden.estado !== 'planificada') throw conflicto('ORDEN_CERRADA', 'La orden ya está terminada o anulada');
      const ins = await tx.selectFrom('orden_produccion_insumo').selectAll().where('orden_id', '=', id).orderBy('linea').execute();
      const reales = new Map((d.insumos ?? []).map((i) => [i.linea, new Decimal(i.cantidadReal)]));
      if ([...reales.keys()].some((l) => !ins.some((i) => i.linea === l))) throw invalido('Algún insumo no corresponde a la orden');
      const vs = await variantes(tx, [orden.variante_id, ...ins.map((i) => i.variante_id)]);
      const producto = await tx.selectFrom('variante as v').innerJoin('producto as p', 'p.id', 'v.producto_id').select(['p.controla_lote', 'v.costo']).where('v.id', '=', orden.variante_id).executeTakeFirstOrThrow();
      const usos = ins.map((i) => ({ ...i, real: reales.get(i.linea) ?? new Decimal(i.cantidad_teorica), costo: vs.get(i.variante_id)!.costo }));
      const costoTotal = usos.reduce((s, u) => s.plus(u.real.mul(u.costo)), new Decimal(0)).toDecimalPlaces(2);
      const producida = new Decimal(d.cantidadProducida);
      const costoUnitario = costoTotal.div(producida).toDecimalPlaces(2);
      const numero = Number(orden.numero);
      // Lote de lo producido: el indicado o uno con el número de la orden.
      const lote = producto.controla_lote
        ? { codigo: (d.lote?.codigo?.trim().toUpperCase() || `OP-${numero}`).slice(0, 40), vencimiento: d.lote?.vencimiento ?? null }
        : null;

      // Costo promedio ponderado del producto con el stock de toda la empresa (antes de la entrada).
      const st = await tx.selectFrom('stock').select((eb) => eb.fn.sum<string>('cantidad').as('c')).where('variante_id', '=', orden.variante_id).executeTakeFirstOrThrow();
      const antes = Decimal.max(new Decimal(st.c ?? 0), 0);
      const nuevoCosto = antes.isZero() ? costoUnitario : antes.mul(producto.costo).plus(costoTotal).div(antes.plus(producida));
      await moverStock(
        tx,
        ctx,
        orden.deposito_id,
        usos.filter((u) => u.real.gt(0) && vs.get(u.variante_id)!.controla_stock).map((u) => ({ varianteId: u.variante_id, cantidad: u.real.neg(), tipo: 'produccion_consumo' as const, origenId: id, motivo: `Producción N.º ${numero}`, costo: u.costo })),
        true,
      );
      await moverStock(tx, ctx, orden.deposito_id, [{ varianteId: orden.variante_id, cantidad: producida, tipo: 'produccion' as const, origenId: id, motivo: `Producción N.º ${numero}`, costo: costoUnitario.toFixed(2), lote: lote ?? undefined }], false);
      await tx.updateTable('variante').set({ costo: nuevoCosto.toDecimalPlaces(2).toFixed(2) }).where('id', '=', orden.variante_id).execute();
      for (const u of usos) await tx.updateTable('orden_produccion_insumo').set({ cantidad_real: u.real.toFixed(4), costo_unitario: new Decimal(u.costo).toFixed(2) }).where('orden_id', '=', id).where('linea', '=', u.linea).execute();
      await tx
        .updateTable('orden_produccion')
        .set({ estado: 'terminada', cantidad_producida: producida.toFixed(4), costo_total: costoTotal.toFixed(2), costo_unitario: costoUnitario.toFixed(2), lote_codigo: lote?.codigo ?? null, lote_vencimiento: lote?.vencimiento ?? null, terminada_por: ctx.usuarioId, terminada_en: new Date() })
        .where('id', '=', id)
        .execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'terminar', entidad: 'orden_produccion', entidadId: id, despues: { ...d, costoTotal: costoTotal.toFixed(2), costoUnitario: costoUnitario.toFixed(2) } });
      return leerOrden(tx, ctx, id);
    });
  }

  /** Anula una orden planificada o, si está terminada, revierte el stock (los insumos vuelven a sus lotes). */
  @Requiere('produccion', 'cancelar')
  @Post('ordenes/:id/anular')
  @HttpCode(200)
  anular(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ motivo: z.string().trim().min(3, 'Indique el motivo').max(300) }), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const orden = await tx.selectFrom('orden_produccion').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!orden) throw noEncontrado('Orden de producción');
      await obtenerDeposito(tx, ctx, orden.deposito_id);
      if (orden.estado === 'anulada') throw conflicto('YA_ANULADA', 'La orden ya está anulada');
      if (orden.estado === 'terminada') {
        const numero = Number(orden.numero);
        // Primero sale lo producido (si ya se vendió, no se puede anular), después vuelven los insumos.
        await moverStock(tx, ctx, orden.deposito_id, [{ varianteId: orden.variante_id, cantidad: new Decimal(orden.cantidad_producida!).neg(), tipo: 'anulacion_produccion' as const, origenId: id, motivo: `Anulación de producción N.º ${numero}`, costo: orden.costo_unitario, deOrigen: { origenIds: [id], tipos: ['produccion'] } }], true);
        const ins = await tx.selectFrom('orden_produccion_insumo as i').innerJoin('variante as v', 'v.id', 'i.variante_id').innerJoin('producto as p', 'p.id', 'v.producto_id').select(['i.variante_id', 'i.cantidad_real', 'i.costo_unitario', 'p.controla_stock']).where('i.orden_id', '=', id).execute();
        await moverStock(
          tx,
          ctx,
          orden.deposito_id,
          ins.filter((i) => i.controla_stock && Number(i.cantidad_real) > 0).map((i) => ({ varianteId: i.variante_id, cantidad: new Decimal(i.cantidad_real!), tipo: 'anulacion_produccion' as const, origenId: id, motivo: `Anulación de producción N.º ${numero}`, costo: i.costo_unitario, deOrigen: { origenIds: [id], tipos: ['produccion_consumo'] } })),
          false,
        );
      }
      await tx.updateTable('orden_produccion').set({ estado: 'anulada', anulada_por: ctx.usuarioId, anulada_en: new Date(), motivo_anulacion: d.motivo }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'anular', entidad: 'orden_produccion', entidadId: id, antes: { estado: orden.estado }, despues: d });
      return leerOrden(tx, ctx, id);
    });
  }

  /**
   * Qué producir para los pedidos (encargos) pendientes con entrega en el rango: lo pedido de cada producto con
   * receta, menos el stock de la sucursal y lo ya planificado; y los insumos que hacen falta para eso.
   */
  @Requiere('produccion', 'ver')
  @Get('necesidades')
  necesidades(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ sucursalId: z.string().uuid(), desde: fechaDia, hasta: fechaDia }), query);
    exigirSucursal(ctx, f.sucursalId, 'Sucursal');
    if (f.hasta < f.desde) throw invalido('El rango de fechas es inválido');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const { rows: pedidos } = await sql<{ variante_id: string; cantidad: string; pedidos: string }>`
        SELECT i.variante_id, sum(i.cantidad) AS cantidad, count(DISTINCT p.id) AS pedidos
        FROM pedido p JOIN pedido_item i ON i.pedido_id = p.id
        JOIN receta_produccion r ON r.variante_id = i.variante_id AND r.activa
        WHERE p.tipo = 'pedido' AND p.estado = 'pendiente' AND p.sucursal_id = ${f.sucursalId}::uuid
          AND p.entrega_prevista BETWEEN ${f.desde}::date AND ${f.hasta}::date
        GROUP BY i.variante_id`.execute(tx);
      const ids = pedidos.map((p) => p.variante_id);
      if (!ids.length) return { productos: [], insumos: [] };
      const stockSuc = async (vids: string[]) => {
        if (!vids.length) return new Map<string, Decimal>();
        const r = await tx
          .selectFrom('stock as s')
          .innerJoin('deposito as d', 'd.id', 's.deposito_id')
          .select(['s.variante_id', (eb) => eb.fn.sum<string>('s.cantidad').as('c')])
          .where('d.sucursal_id', '=', f.sucursalId)
          .where('s.variante_id', 'in', vids)
          .groupBy('s.variante_id')
          .execute();
        return new Map(r.map((x) => [x.variante_id, new Decimal(x.c)]));
      };
      const stock = await stockSuc(ids);
      const plan = await tx
        .selectFrom('orden_produccion as o')
        .innerJoin('deposito as d', 'd.id', 'o.deposito_id')
        .select(['o.variante_id', (eb) => eb.fn.sum<string>('o.cantidad_planificada').as('c')])
        .where('d.sucursal_id', '=', f.sucursalId)
        .where('o.estado', '=', 'planificada')
        .where('o.fecha', '<=', f.hasta)
        .where('o.variante_id', 'in', ids)
        .groupBy('o.variante_id')
        .execute();
      const planificado = new Map(plan.map((x) => [x.variante_id, new Decimal(x.c)]));
      const recetas = await tx.selectFrom('receta_produccion').select(['id', 'variante_id', 'rendimiento']).where('variante_id', 'in', ids).execute();
      const insumos = await tx.selectFrom('receta_produccion_insumo').select(['receta_id', 'variante_id', 'cantidad']).where('receta_id', 'in', recetas.map((r) => r.id)).execute();
      const vs = await variantes(tx, [...ids, ...insumos.map((i) => i.variante_id)]);
      const productos = pedidos.map((p) => {
        const pedido = new Decimal(p.cantidad);
        const st = Decimal.max(stock.get(p.variante_id) ?? 0, 0);
        const pl = planificado.get(p.variante_id) ?? new Decimal(0);
        const sugerido = Decimal.max(pedido.minus(st).minus(pl), 0);
        return { varianteId: p.variante_id, descripcion: vs.get(p.variante_id)!.descripcion, unidad: vs.get(p.variante_id)!.unidad, pedidos: Number(p.pedidos), pedido: pedido.toFixed(4), stock: st.toFixed(4), planificado: pl.toFixed(4), sugerido: sugerido.toFixed(4) };
      });
      // Insumos para producir lo sugerido.
      const necesidad = new Map<string, Decimal>();
      for (const pr of productos) {
        const r = recetas.find((x) => x.variante_id === pr.varianteId)!;
        for (const i of insumos.filter((x) => x.receta_id === r.id)) necesidad.set(i.variante_id, (necesidad.get(i.variante_id) ?? new Decimal(0)).plus(new Decimal(i.cantidad).mul(pr.sugerido).div(r.rendimiento)));
      }
      const stockIns = await stockSuc([...necesidad.keys()]);
      return {
        productos: productos.sort((a, b) => a.descripcion.localeCompare(b.descripcion)),
        insumos: [...necesidad]
          .filter(([, n]) => n.gt(0))
          .map(([vid, n]) => {
            const st = Decimal.max(stockIns.get(vid) ?? 0, 0);
            return { varianteId: vid, descripcion: vs.get(vid)!.descripcion, unidad: vs.get(vid)!.unidad, necesario: n.toDecimalPlaces(4).toFixed(4), stock: st.toFixed(4), faltante: Decimal.max(n.minus(st), 0).toDecimalPlaces(4).toFixed(4) };
          })
          .sort((a, b) => a.descripcion.localeCompare(b.descripcion)),
      };
    });
  }

  /** Crea de una vez las órdenes sugeridas para los pedidos. */
  @Requiere('produccion', 'crear')
  @Post('ordenes/lote')
  lote(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ depositoId: z.string().uuid(), fecha: fechaDia, items: z.array(z.object({ varianteId: z.string().uuid(), cantidad: z.coerce.number().positive().max(1e9) })).min(1).max(200) }), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const ids: string[] = [];
      for (const i of d.items) ids.push(await planificar(tx, ctx, { varianteId: i.varianteId, depositoId: d.depositoId, cantidad: i.cantidad, fecha: d.fecha, nota: 'Para pedidos' }));
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear_lote', entidad: 'orden_produccion', entidadId: ids[0]!, despues: d });
      return { ids };
    });
  }

  /** Mermas: producto vencido, roto o que no se vendió en el día; sale del stock con su costo. */
  @Requiere('produccion', 'crear')
  @Post('mermas')
  merma(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(mermaEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      await obtenerDeposito(tx, ctx, d.depositoId);
      const vs = await variantes(tx, d.items.map((i) => i.varianteId));
      if (d.items.some((i) => !vs.get(i.varianteId)?.controla_stock)) throw invalido('Algún producto no controla stock');
      await moverStock(
        tx,
        ctx,
        d.depositoId,
        d.items.map((i) => ({ varianteId: i.varianteId, cantidad: new Decimal(i.cantidad).neg(), tipo: 'merma' as const, origenId: null, motivo: d.motivo, costo: vs.get(i.varianteId)!.costo, incluirVencidos: true, ...(i.loteId ? { loteId: i.loteId } : {}) })),
        true,
      );
      const valor = d.items.reduce((s, i) => s.plus(new Decimal(i.cantidad).mul(vs.get(i.varianteId)!.costo)), new Decimal(0));
      await auditar(tx, { ...ctx, ...o }, { accion: 'merma', entidad: 'stock', entidadId: d.depositoId, despues: { ...d, valor: valor.toFixed(2) } });
      return { items: d.items.length, ...(tiene(ctx, 'costo_producto.ver') ? { valor: valor.toFixed(2) } : {}) };
    });
  }

  @Requiere('produccion', 'ver')
  @Get('mermas')
  mermas(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ desde: fechaDia, hasta: fechaDia }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const r = await tx
        .selectFrom('movimiento_stock as m')
        .innerJoin('variante as v', 'v.id', 'm.variante_id')
        .innerJoin('producto as p', 'p.id', 'v.producto_id')
        .innerJoin('deposito as d', 'd.id', 'm.deposito_id')
        .leftJoin('usuario as u', 'u.id', 'm.creado_por')
        .select(['m.id', 'm.creado_en', 'm.cantidad', 'm.costo_unitario', 'm.motivo', 'p.nombre as producto', 'v.nombre as variante', 'p.unidad', 'd.nombre as deposito', 'd.sucursal_id', 'u.nombre as usuario'])
        .where('m.tipo', '=', 'merma')
        .where(sql`(m.creado_en AT TIME ZONE 'America/Asuncion')::date`, '>=', f.desde)
        .where(sql`(m.creado_en AT TIME ZONE 'America/Asuncion')::date`, '<=', f.hasta)
        .orderBy('m.creado_en', 'desc')
        .limit(2000)
        .execute();
      const verCosto = tiene(ctx, 'costo_producto.ver');
      return r
        .filter((x) => enSucursal(ctx, x.sucursal_id))
        .map((x) => ({
          id: String(x.id),
          fecha: x.creado_en,
          descripcion: x.variante ? `${x.producto} · ${x.variante}` : x.producto,
          unidad: x.unidad,
          deposito: x.deposito,
          cantidad: new Decimal(x.cantidad).neg().toFixed(4),
          motivo: x.motivo,
          usuario: x.usuario,
          ...(verCosto && x.costo_unitario ? { valor: new Decimal(x.cantidad).neg().mul(x.costo_unitario).toFixed(2) } : {}),
        }));
    });
  }
}

/** Crea una orden planificada con los insumos teóricos de la receta. */
async function planificar(tx: Tx, ctx: Ctx, d: { varianteId: string; depositoId: string; cantidad: number; fecha: string; nota?: string | null }) {
  await obtenerDeposito(tx, ctx, d.depositoId);
  const r = await tx.selectFrom('receta_produccion').selectAll().where('variante_id', '=', d.varianteId).executeTakeFirst();
  if (!r) throw conflicto('SIN_RECETA', 'El producto no tiene receta');
  if (!r.activa) throw conflicto('RECETA_INACTIVA', 'La receta del producto está inactiva');
  if (d.fecha < new Date(Date.parse(`${hoyPy()}T12:00:00Z`) - 31 * 86400000).toISOString().slice(0, 10)) throw invalido('La fecha es demasiado antigua');
  const ins = await tx.selectFrom('receta_produccion_insumo').selectAll().where('receta_id', '=', r.id).orderBy('linea').execute();
  await tx.selectFrom('empresa').select('id').forUpdate().executeTakeFirstOrThrow();
  const n = await tx.selectFrom('orden_produccion').select((eb) => eb.fn.max<string>('numero').as('n')).executeTakeFirstOrThrow();
  const o = await tx
    .insertInto('orden_produccion')
    .values({ empresa_id: ctx.empresaId, numero: Number(n.n ?? 0) + 1, deposito_id: d.depositoId, receta_id: r.id, variante_id: d.varianteId, fecha: d.fecha, cantidad_planificada: new Decimal(d.cantidad).toFixed(4), nota: d.nota ?? null, creado_por: ctx.usuarioId })
    .returning('id')
    .executeTakeFirstOrThrow();
  await tx
    .insertInto('orden_produccion_insumo')
    .values(ins.map((i) => ({ empresa_id: ctx.empresaId, orden_id: o.id, linea: i.linea, variante_id: i.variante_id, cantidad_teorica: new Decimal(i.cantidad).mul(d.cantidad).div(r.rendimiento).toDecimalPlaces(4, Decimal.ROUND_UP).toFixed(4) })))
    .execute();
  return o.id;
}
