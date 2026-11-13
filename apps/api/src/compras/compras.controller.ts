import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { calcularItems, compraEntrada, cuentaPagarEntrada, ErrorCalculo, ordenCompraEntrada, pagoProveedorEntrada, proveedorEntrada } from '@kontiva/shared';
import Decimal from 'decimal.js';
import { sql } from 'kysely';
import { z } from 'zod';
import { enSucursal, exigirSucursal } from '../comun/alcance';
import { auditar } from '../comun/auditoria';
import { Contexto, OrigenPeticion, tiene, type Ctx, type Origen } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { conflicto, ErrorNegocio, invalido, noEncontrado, prohibido } from '../comun/errores';
import { moverStock, siguienteNumero } from '../comun/stock';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';
import { esperado, obtenerCaja, sesionAbierta } from '../operacion/cajas.controller';

const NULO = '00000000-0000-0000-0000-000000000000';
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
const sumarDias = (fecha: string, dias: number) => {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};
const filtroSucursales = (ctx: Ctx) => (ctx.esPropietario || ctx.alcance === 'empresa' ? null : ctx.sucursalIds.length ? ctx.sucursalIds : [NULO]);

function calcular(items: { cantidad: number; costoUnitario: number; descuento?: number; tasaIva: number }[]) {
  try {
    return calcularItems(items.map((i) => ({ cantidad: i.cantidad, precioUnitario: i.costoUnitario, descuento: i.descuento ?? 0, tasaIva: i.tasaIva as 0 | 5 | 10 })));
  } catch (e) {
    if (e instanceof ErrorCalculo) throw new ErrorNegocio(HttpStatus.BAD_REQUEST, e.codigo, e.message);
    throw e;
  }
}

async function variantesCompra(tx: Tx, ids: string[]) {
  const vs = await tx
    .selectFrom('variante as v')
    .innerJoin('producto as p', 'p.id', 'v.producto_id')
    .select(['v.id', 'v.nombre', 'v.costo', 'p.nombre as producto', 'p.tasa_iva', 'p.unidad', 'p.controla_stock', 'p.activo', 'v.activa'])
    .where('v.id', 'in', ids)
    .execute();
  if (vs.length !== new Set(ids).size || vs.some((v) => !v.activo || !v.activa)) throw invalido('Algún producto no existe o está inactivo');
  return new Map(vs.map((v) => [v.id, { ...v, descripcion: v.nombre ? `${v.producto} · ${v.nombre}` : v.producto }]));
}

async function obtenerDeposito(tx: Tx, ctx: Ctx, id: string) {
  const d = await tx.selectFrom('deposito').select(['id', 'sucursal_id', 'nombre']).where('id', '=', id).where('activo', '=', true).executeTakeFirst();
  if (!d || !enSucursal(ctx, d.sucursal_id)) throw noEncontrado('Depósito');
  return d;
}

async function obtenerProveedor(tx: Tx, id: string) {
  const p = await tx.selectFrom('proveedor').selectAll().where('id', '=', id).executeTakeFirst();
  if (!p) throw noEncontrado('Proveedor');
  return p;
}

/** Búsqueda de productos para comprar: el costo actual solo con costo_producto.ver. */
async function buscarProductos(tx: Tx, ctx: Ctx, q: string) {
  const texto = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
  const { rows } = await sql<{ id: string; producto: string; variante: string | null; sku: string | null; unidad: string; tasa_iva: string; costo: string }>`
    SELECT v.id, p.nombre AS producto, v.nombre AS variante, v.sku, p.unidad, p.tasa_iva, v.costo
    FROM variante v JOIN producto p ON p.id = v.producto_id
    WHERE p.activo AND v.activa AND p.tipo = 'producto' AND (
      EXISTS (SELECT 1 FROM codigo_barras cb WHERE cb.variante_id = v.id AND cb.codigo = ${q})
      OR lower(v.sku) = ${q.toLowerCase()} OR p.nombre ILIKE ${texto} OR v.nombre ILIKE ${texto})
    ORDER BY similarity(p.nombre, ${q}) DESC, p.nombre
    LIMIT 20`.execute(tx);
  const verCosto = tiene(ctx, 'costo_producto.ver');
  return rows.map((r) => ({
    varianteId: r.id,
    descripcion: r.variante ? `${r.producto} · ${r.variante}` : r.producto,
    sku: r.sku,
    unidad: r.unidad,
    tasaIva: Number(r.tasa_iva) as 0 | 5 | 10,
    costo: verCosto ? r.costo : null,
  }));
}

// ---------------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------------

const proveedorDto = (p: { id: string; nombre: string; ruc: string | null; telefono: string | null; email: string | null; direccion: string | null; contacto: string | null; plazo_pago_dias: number; nota: string | null; activo: boolean }) => ({
  id: p.id,
  nombre: p.nombre,
  ruc: p.ruc,
  telefono: p.telefono,
  email: p.email,
  direccion: p.direccion,
  contacto: p.contacto,
  plazoPagoDias: p.plazo_pago_dias,
  nota: p.nota,
  activo: p.activo,
});

@Controller('proveedores')
export class ProveedoresController {
  constructor(private readonly db: Db) {}

  @Requiere('proveedor', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ q: z.string().trim().max(100).optional(), inactivos: z.enum(['true', 'false']).optional() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let q = tx
        .selectFrom('proveedor as p')
        .selectAll('p')
        .select(sql<string>`coalesce((SELECT sum(saldo) FROM cuenta_pagar c WHERE c.proveedor_id = p.id AND c.estado IN ('pendiente','parcial')), 0)`.as('saldo'))
        .orderBy('p.nombre')
        .limit(300);
      if (f.inactivos !== 'true') q = q.where('p.activo', '=', true);
      if (f.q) q = q.where((eb) => eb.or([eb('p.nombre', 'ilike', `%${f.q}%`), eb('p.ruc', 'ilike', `${f.q}%`)]));
      return (await q.execute()).map((p) => ({ ...proveedorDto(p), saldo: new Decimal(p.saldo).toFixed(2) }));
    });
  }

  @Requiere('proveedor', 'ver')
  @Get(':id')
  ver(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => proveedorDto(await obtenerProveedor(tx, id)));
  }

  @Requiere('proveedor', 'crear')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(proveedorEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      if (d.ruc) {
        const otro = await tx.selectFrom('proveedor').select('nombre').where('ruc', '=', d.ruc).where('activo', '=', true).executeTakeFirst();
        if (otro) throw conflicto('RUC_REPETIDO', `Ya existe el proveedor ${otro.nombre} con ese RUC`);
      }
      const p = await tx
        .insertInto('proveedor')
        .values({ empresa_id: ctx.empresaId, nombre: d.nombre, ruc: d.ruc, telefono: d.telefono ?? null, email: d.email ?? null, direccion: d.direccion ?? null, contacto: d.contacto ?? null, plazo_pago_dias: d.plazoPagoDias, nota: d.nota ?? null, creado_por: ctx.usuarioId })
        .returningAll()
        .executeTakeFirstOrThrow();
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'proveedor', entidadId: p.id, despues: proveedorDto(p) });
      return proveedorDto(p);
    });
  }

  @Requiere('proveedor', 'editar')
  @Patch(':id')
  editar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(proveedorEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const antes = await obtenerProveedor(tx, id);
      const p = await tx
        .updateTable('proveedor')
        .set({ nombre: d.nombre, ruc: d.ruc, telefono: d.telefono ?? null, email: d.email ?? null, direccion: d.direccion ?? null, contacto: d.contacto ?? null, plazo_pago_dias: d.plazoPagoDias, nota: d.nota ?? null, ...(d.activo !== undefined && { activo: d.activo }) })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await auditar(tx, { ...ctx, ...o }, { accion: 'editar', entidad: 'proveedor', entidadId: id, antes: proveedorDto(antes), despues: proveedorDto(p) });
      return proveedorDto(p);
    });
  }

  @Requiere('proveedor', 'eliminar')
  @Delete(':id')
  @HttpCode(204)
  async desactivar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @OrigenPeticion() o: Origen) {
    await this.db.enEmpresa(ctx.empresaId, async (tx) => {
      await obtenerProveedor(tx, id);
      await tx.updateTable('proveedor').set({ activo: false }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'desactivar', entidad: 'proveedor', entidadId: id });
    });
  }
}

// ---------------------------------------------------------------------------
// Órdenes de compra
// ---------------------------------------------------------------------------

async function leerOrden(tx: Tx, id: string) {
  const o = await tx
    .selectFrom('orden_compra as o')
    .innerJoin('proveedor as p', 'p.id', 'o.proveedor_id')
    .innerJoin('deposito as d', 'd.id', 'o.deposito_id')
    .innerJoin('sucursal as s', 's.id', 'o.sucursal_id')
    .innerJoin('usuario as u', 'u.id', 'o.creado_por')
    .leftJoin('usuario as a', 'a.id', 'o.aprobada_por')
    .selectAll('o')
    .select(['p.nombre as proveedor', 'p.ruc as proveedor_ruc', 'p.telefono as proveedor_telefono', 'p.email as proveedor_email', 'd.nombre as deposito', 's.nombre as sucursal', 'u.nombre as creado_por_nombre', 'a.nombre as aprobada_por_nombre'])
    .where('o.id', '=', id)
    .executeTakeFirst();
  if (!o) return null;
  const items = await tx.selectFrom('orden_compra_item').selectAll().where('orden_id', '=', id).orderBy('linea').execute();
  return {
    id: o.id,
    numero: Number(o.numero),
    estado: o.estado,
    proveedor: { id: o.proveedor_id, nombre: o.proveedor, ruc: o.proveedor_ruc, telefono: o.proveedor_telefono, email: o.proveedor_email },
    deposito: { id: o.deposito_id, nombre: o.deposito },
    sucursal: { id: o.sucursal_id, nombre: o.sucursal },
    fechaEntrega: o.fecha_entrega,
    nota: o.nota,
    total: o.total,
    creadoPor: o.creado_por_nombre,
    creadoEn: o.creado_en,
    aprobada: o.aprobada_en ? { por: o.aprobada_por_nombre, en: o.aprobada_en } : null,
    motivoCancelacion: o.motivo_cancelacion,
    items: items.map((i) => ({
      linea: i.linea,
      varianteId: i.variante_id,
      descripcion: i.descripcion,
      cantidad: i.cantidad,
      cantidadRecibida: i.cantidad_recibida,
      pendiente: Decimal.max(new Decimal(i.cantidad).minus(i.cantidad_recibida), 0).toFixed(4),
      costoUnitario: i.costo_unitario,
      tasaIva: i.tasa_iva,
      total: i.total,
    })),
  };
}

async function obtenerOrden(tx: Tx, ctx: Ctx, id: string, bloquear = false) {
  let q = tx.selectFrom('orden_compra').selectAll().where('id', '=', id);
  if (bloquear) q = q.forUpdate();
  const o = await q.executeTakeFirst();
  if (!o) throw noEncontrado('Orden de compra');
  exigirSucursal(ctx, o.sucursal_id, 'Orden de compra');
  return o;
}

async function guardarItemsOrden(tx: Tx, ctx: Ctx, ordenId: string, items: z.infer<typeof ordenCompraEntrada>['items']) {
  const vs = await variantesCompra(tx, items.map((i) => i.varianteId));
  const calc = calcular(items.map((i) => ({ ...i, tasaIva: Number(vs.get(i.varianteId)!.tasa_iva) })));
  await tx.deleteFrom('orden_compra_item').where('orden_id', '=', ordenId).execute();
  await tx
    .insertInto('orden_compra_item')
    .values(
      items.map((i, n) => {
        const v = vs.get(i.varianteId)!;
        return { empresa_id: ctx.empresaId, orden_id: ordenId, linea: n + 1, variante_id: i.varianteId, descripcion: v.descripcion, cantidad: new Decimal(i.cantidad).toFixed(4), costo_unitario: new Decimal(i.costoUnitario).toFixed(2), tasa_iva: Number(v.tasa_iva), total: calc.lineas[n]!.total.toFixed(2) };
      }),
    )
    .execute();
  return calc.total;
}

@Controller('ordenes-compra')
export class OrdenesCompraController {
  constructor(private readonly db: Db) {}

  @Requiere('orden_compra', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ estado: z.string().max(20).optional(), proveedorId: z.string().uuid().optional() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let q = tx
        .selectFrom('orden_compra as o')
        .innerJoin('proveedor as p', 'p.id', 'o.proveedor_id')
        .innerJoin('sucursal as s', 's.id', 'o.sucursal_id')
        .select(['o.id', 'o.numero', 'o.estado', 'o.total', 'o.fecha_entrega', 'o.creado_en', 'p.nombre as proveedor', 's.nombre as sucursal'])
        .orderBy('o.numero', 'desc')
        .limit(300);
      const suc = filtroSucursales(ctx);
      if (suc) q = q.where('o.sucursal_id', 'in', suc);
      if (f.estado === 'abiertas') q = q.where('o.estado', 'in', ['borrador', 'enviada', 'parcial']);
      else if (f.estado) q = q.where('o.estado', '=', f.estado as 'borrador');
      if (f.proveedorId) q = q.where('o.proveedor_id', '=', f.proveedorId);
      return (await q.execute()).map((o) => ({ id: o.id, numero: Number(o.numero), estado: o.estado, total: o.total, fechaEntrega: o.fecha_entrega, creadoEn: o.creado_en, proveedor: o.proveedor, sucursal: o.sucursal }));
    });
  }

  @Requiere('orden_compra', 'crear')
  @Get('productos')
  productos(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ q: z.string().trim().min(1).max(100) }), query);
    return this.db.enEmpresa(ctx.empresaId, (tx) => buscarProductos(tx, ctx, f.q));
  }

  @Requiere('orden_compra', 'ver')
  @Get(':id')
  ver(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      await obtenerOrden(tx, ctx, id);
      return (await leerOrden(tx, id))!;
    });
  }

  @Requiere('orden_compra', 'crear')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(ordenCompraEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const prov = await obtenerProveedor(tx, d.proveedorId);
      if (!prov.activo) throw invalido('El proveedor está inactivo');
      const dep = await obtenerDeposito(tx, ctx, d.depositoId);
      const numero = await siguienteNumero(tx, 'orden_compra');
      const r = await tx
        .insertInto('orden_compra')
        .values({ empresa_id: ctx.empresaId, numero, proveedor_id: d.proveedorId, sucursal_id: dep.sucursal_id, deposito_id: dep.id, fecha_entrega: d.fechaEntrega ?? null, nota: d.nota ?? null, creado_por: ctx.usuarioId })
        .returning('id')
        .executeTakeFirstOrThrow();
      const total = await guardarItemsOrden(tx, ctx, r.id, d.items);
      await tx.updateTable('orden_compra').set({ total: total.toFixed(2) }).where('id', '=', r.id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'orden_compra', entidadId: r.id, despues: { numero, proveedor: prov.nombre, total: total.toFixed(0) } });
      return (await leerOrden(tx, r.id))!;
    });
  }

  @Requiere('orden_compra', 'editar')
  @Patch(':id')
  editar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(ordenCompraEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const orden = await obtenerOrden(tx, ctx, id, true);
      if (orden.estado !== 'borrador') throw conflicto('ORDEN_ENVIADA', 'Solo se edita una orden en borrador');
      const dep = await obtenerDeposito(tx, ctx, d.depositoId);
      await obtenerProveedor(tx, d.proveedorId);
      const total = await guardarItemsOrden(tx, ctx, id, d.items);
      await tx.updateTable('orden_compra').set({ proveedor_id: d.proveedorId, deposito_id: dep.id, sucursal_id: dep.sucursal_id, fecha_entrega: d.fechaEntrega ?? null, nota: d.nota ?? null, total: total.toFixed(2) }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'editar', entidad: 'orden_compra', entidadId: id, antes: { total: orden.total }, despues: { total: total.toFixed(2) } });
      return (await leerOrden(tx, id))!;
    });
  }

  /** Aprobada y enviada al proveedor: ya se puede recibir. */
  @Requiere('orden_compra', 'aprobar')
  @Post(':id/enviar')
  @HttpCode(200)
  enviar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @OrigenPeticion() o: Origen) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const orden = await obtenerOrden(tx, ctx, id, true);
      if (orden.estado !== 'borrador') throw conflicto('ORDEN_ENVIADA', 'La orden ya fue enviada');
      await tx.updateTable('orden_compra').set({ estado: 'enviada', aprobada_por: ctx.usuarioId, aprobada_en: new Date() }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'aprobar', entidad: 'orden_compra', entidadId: id });
      return (await leerOrden(tx, id))!;
    });
  }

  @Requiere('orden_compra', 'cancelar')
  @Post(':id/cancelar')
  @HttpCode(200)
  cancelar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ motivo: z.string().trim().min(3).max(300) }), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const orden = await obtenerOrden(tx, ctx, id, true);
      if (orden.estado === 'recibida' || orden.estado === 'cancelada') throw conflicto('ORDEN_CERRADA', 'La orden ya está cerrada');
      await tx.updateTable('orden_compra').set({ estado: 'cancelada', motivo_cancelacion: d.motivo }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'cancelar', entidad: 'orden_compra', entidadId: id, despues: { motivo: d.motivo, estadoPrevio: orden.estado } });
      return (await leerOrden(tx, id))!;
    });
  }
}

// ---------------------------------------------------------------------------
// Compras (recepción de mercadería con el documento del proveedor)
// ---------------------------------------------------------------------------

async function leerCompra(tx: Tx, id: string, verCosto: boolean) {
  const c = await tx
    .selectFrom('compra as c')
    .innerJoin('proveedor as p', 'p.id', 'c.proveedor_id')
    .innerJoin('deposito as d', 'd.id', 'c.deposito_id')
    .innerJoin('sucursal as s', 's.id', 'c.sucursal_id')
    .innerJoin('usuario as u', 'u.id', 'c.creado_por')
    .leftJoin('orden_compra as o', 'o.id', 'c.orden_id')
    .leftJoin('usuario as an', 'an.id', 'c.anulada_por')
    .selectAll('c')
    .select(['p.nombre as proveedor', 'p.ruc as proveedor_ruc', 'd.nombre as deposito', 's.nombre as sucursal', 'u.nombre as creado_por_nombre', 'o.numero as orden_numero', 'an.nombre as anulada_por_nombre'])
    .where('c.id', '=', id)
    .executeTakeFirst();
  if (!c) return null;
  const [items, cuenta] = await Promise.all([
    tx.selectFrom('compra_item').selectAll().where('compra_id', '=', id).orderBy('linea').execute(),
    tx.selectFrom('cuenta_pagar').select(['id', 'saldo', 'estado', 'vencimiento']).where('compra_id', '=', id).executeTakeFirst(),
  ]);
  const ocultar = (v: string) => (verCosto ? v : null);
  return {
    id: c.id,
    numero: Number(c.numero),
    estado: c.estado,
    proveedor: { id: c.proveedor_id, nombre: c.proveedor, ruc: c.proveedor_ruc },
    orden: c.orden_id ? { id: c.orden_id, numero: Number(c.orden_numero) } : null,
    deposito: { id: c.deposito_id, nombre: c.deposito },
    sucursal: { id: c.sucursal_id, nombre: c.sucursal },
    documento: { tipo: c.documento_tipo, timbrado: c.timbrado, numero: c.documento_numero, cdc: c.cdc, fecha: c.fecha_documento },
    condicion: c.condicion,
    vencimiento: c.vencimiento,
    subtotal: ocultar(c.subtotal),
    descuento: ocultar(c.descuento),
    total: ocultar(c.total),
    gravado10: ocultar(c.gravado10),
    gravado5: ocultar(c.gravado5),
    exento: ocultar(c.exento),
    iva10: ocultar(c.iva10),
    iva5: ocultar(c.iva5),
    cuenta: cuenta ? { id: cuenta.id, saldo: ocultar(cuenta.saldo), estado: cuenta.estado, vencimiento: cuenta.vencimiento } : null,
    nota: c.nota,
    creadoPor: c.creado_por_nombre,
    creadoEn: c.creado_en,
    anulacion: c.anulada_en ? { por: c.anulada_por_nombre, en: c.anulada_en, motivo: c.motivo_anulacion } : null,
    items: items.map((i) => ({ linea: i.linea, varianteId: i.variante_id, descripcion: i.descripcion, cantidad: i.cantidad, costoUnitario: ocultar(i.costo_unitario), descuento: ocultar(i.descuento), tasaIva: i.tasa_iva, total: ocultar(i.total) })),
  };
}

/** Pago de cuentas de un proveedor dentro de una transacción (lo usan la compra al contado y el pago manual). */
async function registrarPago(
  tx: Tx,
  ctx: Ctx,
  d: { proveedorId: string; fecha: string; medio: 'efectivo' | 'transferencia' | 'cheque' | 'tarjeta' | 'otro'; cajaId?: string | null; referencia?: string | null; nota?: string | null; aplicaciones: { cuentaId: string; monto: number | Decimal }[] },
) {
  const ids = d.aplicaciones.map((a) => a.cuentaId);
  if (new Set(ids).size !== ids.length) throw invalido('Hay cuentas repetidas');
  const cuentas = await tx.selectFrom('cuenta_pagar').selectAll().where('id', 'in', ids).orderBy('id').forUpdate().execute();
  if (cuentas.length !== ids.length) throw noEncontrado('Cuenta a pagar');
  let total = new Decimal(0);
  for (const a of d.aplicaciones) {
    const c = cuentas.find((x) => x.id === a.cuentaId)!;
    if (c.proveedor_id !== d.proveedorId) throw invalido('Todas las cuentas deben ser del mismo proveedor');
    if (c.estado === 'pagada' || c.estado === 'anulada') throw conflicto('CUENTA_CERRADA', `La cuenta "${c.descripcion}" ya está ${c.estado}`);
    const monto = new Decimal(a.monto).toDecimalPlaces(2);
    if (monto.gt(c.saldo)) throw invalido(`El pago supera el saldo de "${c.descripcion}" (${new Decimal(c.saldo).toFixed(0)})`);
    total = total.plus(monto);
  }
  let sesionId: string | null = null;
  if (d.medio === 'efectivo' && d.cajaId) {
    const caja = await obtenerCaja(tx, ctx, d.cajaId, true);
    const sesion = await sesionAbierta(tx, caja.id);
    if (!sesion || sesion.usuario_id !== ctx.usuarioId) throw conflicto('CAJA_CERRADA', 'Para pagar en efectivo desde la caja, ábrala con su usuario');
    const disponible = (await esperado(tx, sesion.id)).find((e) => e.moneda === 'PYG' && e.medio === 'efectivo');
    if (new Decimal(disponible?.monto ?? 0).lt(total)) throw conflicto('SALDO_INSUFICIENTE', 'No hay suficiente efectivo en la caja');
    sesionId = sesion.id;
  }
  const numero = await siguienteNumero(tx, 'pago_proveedor');
  const pago = await tx
    .insertInto('pago_proveedor')
    .values({ empresa_id: ctx.empresaId, numero, proveedor_id: d.proveedorId, fecha: d.fecha, medio: d.medio, sesion_caja_id: sesionId, monto: total.toFixed(2), referencia: d.referencia ?? null, nota: d.nota ?? null, creado_por: ctx.usuarioId })
    .returning('id')
    .executeTakeFirstOrThrow();
  for (const a of d.aplicaciones) {
    const c = cuentas.find((x) => x.id === a.cuentaId)!;
    const monto = new Decimal(a.monto).toDecimalPlaces(2);
    const saldo = new Decimal(c.saldo).minus(monto);
    await tx.insertInto('pago_aplicacion').values({ empresa_id: ctx.empresaId, pago_id: pago.id, cuenta_pagar_id: c.id, monto: monto.toFixed(2) }).execute();
    await tx.updateTable('cuenta_pagar').set({ saldo: saldo.toFixed(2), estado: saldo.isZero() ? 'pagada' : 'parcial' }).where('id', '=', c.id).execute();
  }
  if (sesionId) {
    await tx
      .insertInto('movimiento_caja')
      .values({ empresa_id: ctx.empresaId, sesion_id: sesionId, tipo: 'pago_proveedor', medio: 'efectivo', moneda: 'PYG', monto: total.neg().toFixed(2), venta_id: null, motivo: `Pago N.º ${numero} a proveedor`, autorizado_por: null, creado_por: ctx.usuarioId })
      .execute();
  }
  return { id: pago.id, numero, total };
}

@Controller('compras')
export class ComprasController {
  constructor(private readonly db: Db) {}

  @Requiere('recepcion', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ q: z.string().trim().max(100).optional(), proveedorId: z.string().uuid().optional(), desde: z.string().optional(), hasta: z.string().optional() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let q = tx
        .selectFrom('compra as c')
        .innerJoin('proveedor as p', 'p.id', 'c.proveedor_id')
        .innerJoin('sucursal as s', 's.id', 'c.sucursal_id')
        .select(['c.id', 'c.numero', 'c.estado', 'c.total', 'c.condicion', 'c.documento_tipo', 'c.documento_numero', 'c.fecha_documento', 'c.creado_en', 'p.nombre as proveedor', 's.nombre as sucursal'])
        .orderBy('c.numero', 'desc')
        .limit(300);
      const suc = filtroSucursales(ctx);
      if (suc) q = q.where('c.sucursal_id', 'in', suc);
      if (f.proveedorId) q = q.where('c.proveedor_id', '=', f.proveedorId);
      if (f.desde) q = q.where('c.fecha_documento', '>=', f.desde);
      if (f.hasta) q = q.where('c.fecha_documento', '<=', f.hasta);
      if (f.q) q = q.where((eb) => eb.or([eb('p.nombre', 'ilike', `%${f.q}%`), eb('c.documento_numero', 'like', `%${f.q}%`)]));
      const verCosto = tiene(ctx, 'costo_producto.ver') || tiene(ctx, 'cuenta_pagar.ver');
      return (await q.execute()).map((c) => ({
        id: c.id,
        numero: Number(c.numero),
        estado: c.estado,
        total: verCosto ? c.total : null,
        condicion: c.condicion,
        documento: { tipo: c.documento_tipo, numero: c.documento_numero, fecha: c.fecha_documento },
        creadoEn: c.creado_en,
        proveedor: c.proveedor,
        sucursal: c.sucursal,
      }));
    });
  }

  @Requiere('recepcion', 'crear')
  @Get('productos')
  productos(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ q: z.string().trim().min(1).max(100) }), query);
    return this.db.enEmpresa(ctx.empresaId, (tx) => buscarProductos(tx, ctx, f.q));
  }

  @Requiere('recepcion', 'ver')
  @Get(':id')
  ver(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const c = await leerCompra(tx, id, tiene(ctx, 'costo_producto.ver') || tiene(ctx, 'cuenta_pagar.ver'));
      if (!c || !enSucursal(ctx, c.sucursal.id)) throw noEncontrado('Compra');
      return c;
    });
  }

  /**
   * Compra confirmada en una transacción: stock al depósito, costo promedio ponderado,
   * avance de la orden de compra, cuenta a pagar y, si fue al contado, el pago.
   */
  @Requiere('recepcion', 'crear')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(compraEntrada, body);
    if (d.pago && !tiene(ctx, 'cuenta_pagar.aprobar')) throw prohibido('Registrar el pago requiere el permiso de pagos a proveedores');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const prov = await obtenerProveedor(tx, d.proveedorId);
      if (!prov.activo) throw invalido('El proveedor está inactivo');
      const dep = await obtenerDeposito(tx, ctx, d.depositoId);
      const vs = await variantesCompra(tx, d.items.map((i) => i.varianteId));

      // Orden de compra: mismo proveedor, enviada o parcial, sin recibir más de lo pedido.
      let orden: Awaited<ReturnType<typeof obtenerOrden>> | null = null;
      const lineasOrden = new Map<number, { varianteId: string; pendiente: Decimal }>();
      if (d.ordenId) {
        orden = await obtenerOrden(tx, ctx, d.ordenId, true);
        if (orden.proveedor_id !== d.proveedorId) throw invalido('La orden es de otro proveedor');
        if (orden.estado !== 'enviada' && orden.estado !== 'parcial') throw conflicto('ORDEN_NO_RECIBIBLE', 'La orden debe estar enviada para recibirla');
        const its = await tx.selectFrom('orden_compra_item').selectAll().where('orden_id', '=', orden.id).execute();
        for (const i of its) lineasOrden.set(i.linea, { varianteId: i.variante_id, pendiente: new Decimal(i.cantidad).minus(i.cantidad_recibida) });
        for (const i of d.items) {
          if (!i.ordenLinea) continue;
          const l = lineasOrden.get(i.ordenLinea);
          if (!l || l.varianteId !== i.varianteId) throw invalido(`La línea ${i.ordenLinea} no corresponde a la orden`);
          if (new Decimal(i.cantidad).gt(l.pendiente)) throw invalido(`${vs.get(i.varianteId)!.descripcion}: la orden tiene pendiente ${l.pendiente.toString()}`);
        }
      }

      const calc = calcular(d.items.map((i) => ({ ...i, tasaIva: Number(vs.get(i.varianteId)!.tasa_iva) })));
      const vencimiento = d.condicion === 'credito' ? (d.vencimiento ?? sumarDias(d.fechaDocumento, prov.plazo_pago_dias || 30)) : null;
      if (vencimiento && vencimiento < d.fechaDocumento) throw invalido('El vencimiento no puede ser anterior a la fecha de la factura');
      const numero = await siguienteNumero(tx, 'compra');
      let compra: { id: string };
      try {
        compra = await tx
          .insertInto('compra')
          .values({
            empresa_id: ctx.empresaId,
            numero,
            proveedor_id: d.proveedorId,
            orden_id: orden?.id ?? null,
            sucursal_id: dep.sucursal_id,
            deposito_id: dep.id,
            documento_tipo: d.documentoTipo,
            timbrado: d.timbrado ?? null,
            documento_numero: d.documentoNumero ?? null,
            cdc: d.cdc ?? null,
            fecha_documento: d.fechaDocumento,
            condicion: d.condicion,
            vencimiento,
            subtotal: calc.subtotal.toFixed(2),
            descuento: calc.descuento.toFixed(2),
            total: calc.total.toFixed(2),
            gravado10: calc.gravado10.toFixed(2),
            gravado5: calc.gravado5.toFixed(2),
            exento: calc.exento.toFixed(2),
            iva10: calc.iva10.toFixed(2),
            iva5: calc.iva5.toFixed(2),
            nota: d.nota ?? null,
            creado_por: ctx.usuarioId,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
      } catch (e) {
        if ((e as { constraint?: string }).constraint === 'compra_documento_unico') throw conflicto('FACTURA_REPETIDA', `La factura ${d.documentoNumero} de ${prov.nombre} ya está cargada`);
        throw e;
      }
      await tx
        .insertInto('compra_item')
        .values(
          d.items.map((i, n) => ({
            empresa_id: ctx.empresaId,
            compra_id: compra.id,
            linea: n + 1,
            variante_id: i.varianteId,
            descripcion: vs.get(i.varianteId)!.descripcion,
            cantidad: new Decimal(i.cantidad).toFixed(4),
            costo_unitario: new Decimal(i.costoUnitario).toFixed(2),
            descuento: calc.lineas[n]!.descuento.toFixed(2),
            tasa_iva: Number(vs.get(i.varianteId)!.tasa_iva),
            total: calc.lineas[n]!.total.toFixed(2),
            orden_linea: i.ordenLinea ?? null,
          })),
        )
        .execute();

      // Costo promedio ponderado (IVA incluido, como los precios de venta) con el stock de toda la empresa.
      const porVariante = new Map<string, { cantidad: Decimal; total: Decimal }>();
      d.items.forEach((i, n) => {
        const a = porVariante.get(i.varianteId) ?? { cantidad: new Decimal(0), total: new Decimal(0) };
        porVariante.set(i.varianteId, { cantidad: a.cantidad.plus(i.cantidad), total: a.total.plus(calc.lineas[n]!.total) });
      });
      const stocks = await tx
        .selectFrom('stock')
        .select(['variante_id', (eb) => eb.fn.sum<string>('cantidad').as('cantidad')])
        .where('variante_id', 'in', [...porVariante.keys()])
        .groupBy('variante_id')
        .execute();
      const stockAntes = new Map(stocks.map((s) => [s.variante_id, new Decimal(s.cantidad)]));
      for (const [varianteId, c] of porVariante) {
        const v = vs.get(varianteId)!;
        const antes = Decimal.max(stockAntes.get(varianteId) ?? 0, 0);
        const unitario = c.total.div(c.cantidad);
        const nuevo = antes.isZero() || !v.controla_stock ? unitario : antes.mul(v.costo).plus(c.total).div(antes.plus(c.cantidad));
        await tx.updateTable('variante').set({ costo: nuevo.toDecimalPlaces(2).toFixed(2) }).where('id', '=', varianteId).execute();
      }
      await moverStock(
        tx,
        ctx,
        dep.id,
        d.items
          .map((i, n) => ({ i, n }))
          .filter(({ i }) => vs.get(i.varianteId)!.controla_stock)
          .map(({ i, n }) => ({ varianteId: i.varianteId, cantidad: new Decimal(i.cantidad), tipo: 'compra' as const, origenId: compra.id, motivo: `Compra N.º ${numero}`, costo: calc.lineas[n]!.total.div(i.cantidad).toDecimalPlaces(2).toFixed(2) })),
        false,
      );

      if (orden) {
        for (const i of d.items) {
          if (!i.ordenLinea) continue;
          await tx
            .updateTable('orden_compra_item')
            .set((eb) => ({ cantidad_recibida: eb('cantidad_recibida', '+', new Decimal(i.cantidad).toFixed(4)) }))
            .where('orden_id', '=', orden.id)
            .where('linea', '=', i.ordenLinea)
            .execute();
        }
        const pend = await tx.selectFrom('orden_compra_item').select(sql<string>`sum(greatest(cantidad - cantidad_recibida, 0))`.as('p')).where('orden_id', '=', orden.id).executeTakeFirstOrThrow();
        await tx.updateTable('orden_compra').set({ estado: new Decimal(pend.p ?? 0).gt(0) ? 'parcial' : 'recibida' }).where('id', '=', orden.id).execute();
      }

      if (calc.total.gt(0)) {
        const cuenta = await tx
          .insertInto('cuenta_pagar')
          .values({
            empresa_id: ctx.empresaId,
            proveedor_id: d.proveedorId,
            compra_id: compra.id,
            descripcion: `${d.documentoTipo === 'remision' ? 'Remisión' : d.documentoTipo === 'otro' ? 'Compra' : 'Factura'} ${d.documentoNumero ?? `compra N.º ${numero}`}`,
            fecha: d.fechaDocumento,
            vencimiento: vencimiento ?? d.fechaDocumento,
            monto: calc.total.toFixed(2),
            saldo: calc.total.toFixed(2),
            creado_por: ctx.usuarioId,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        if (d.condicion === 'contado' && d.pago) {
          await registrarPago(tx, ctx, { proveedorId: d.proveedorId, fecha: d.fechaDocumento, medio: d.pago.medio, cajaId: d.pago.cajaId, referencia: d.pago.referencia, aplicaciones: [{ cuentaId: cuenta.id, monto: calc.total }] });
        }
      }
      await auditar(tx, { ...ctx, ...o }, { accion: 'compra', entidad: 'compra', entidadId: compra.id, despues: { numero, proveedor: prov.nombre, documento: d.documentoNumero, total: calc.total.toFixed(0), condicion: d.condicion } });
      return (await leerCompra(tx, compra.id, true))!;
    });
  }

  /** Anula una compra sin pagos: revierte el stock (si alcanza) y la orden; la cuenta queda anulada. */
  @Requiere('recepcion', 'cancelar')
  @Post(':id/anular')
  @HttpCode(200)
  anular(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ motivo: z.string().trim().min(3).max(300) }), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const c = await tx.selectFrom('compra').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!c || !enSucursal(ctx, c.sucursal_id)) throw noEncontrado('Compra');
      if (c.estado === 'anulada') throw conflicto('YA_ANULADA', 'La compra ya está anulada');
      const cuenta = await tx.selectFrom('cuenta_pagar').select(['id', 'monto', 'saldo']).where('compra_id', '=', id).executeTakeFirst();
      if (cuenta && !new Decimal(cuenta.saldo).eq(cuenta.monto)) throw conflicto('COMPRA_CON_PAGOS', 'La compra tiene pagos registrados: anule primero los pagos');
      const items = await tx
        .selectFrom('compra_item as i')
        .innerJoin('variante as v', 'v.id', 'i.variante_id')
        .innerJoin('producto as p', 'p.id', 'v.producto_id')
        .select(['i.variante_id', 'i.cantidad', 'i.orden_linea', 'i.costo_unitario', 'p.controla_stock'])
        .where('i.compra_id', '=', id)
        .execute();
      await moverStock(
        tx,
        ctx,
        c.deposito_id,
        items.filter((i) => i.controla_stock).map((i) => ({ varianteId: i.variante_id, cantidad: new Decimal(i.cantidad).neg(), tipo: 'anulacion_compra' as const, origenId: id, motivo: d.motivo, costo: i.costo_unitario })),
        true,
      );
      if (c.orden_id) {
        for (const i of items.filter((x) => x.orden_linea)) {
          await tx
            .updateTable('orden_compra_item')
            .set((eb) => ({ cantidad_recibida: eb('cantidad_recibida', '-', new Decimal(i.cantidad).toFixed(4)) }))
            .where('orden_id', '=', c.orden_id)
            .where('linea', '=', i.orden_linea!)
            .execute();
        }
        const rec = await tx.selectFrom('orden_compra_item').select(sql<string>`sum(cantidad_recibida)`.as('r')).where('orden_id', '=', c.orden_id).executeTakeFirstOrThrow();
        await tx.updateTable('orden_compra').set({ estado: new Decimal(rec.r ?? 0).gt(0) ? 'parcial' : 'enviada' }).where('id', '=', c.orden_id).where('estado', '<>', 'cancelada').execute();
      }
      if (cuenta) await tx.updateTable('cuenta_pagar').set({ estado: 'anulada', saldo: '0' }).where('id', '=', cuenta.id).execute();
      await tx.updateTable('compra').set({ estado: 'anulada', anulada_por: ctx.usuarioId, anulada_en: new Date(), motivo_anulacion: d.motivo }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'anular', entidad: 'compra', entidadId: id, despues: { numero: Number(c.numero), motivo: d.motivo } });
      return (await leerCompra(tx, id, true))!;
    });
  }
}

// ---------------------------------------------------------------------------
// Cuentas a pagar y pagos a proveedores
// ---------------------------------------------------------------------------

@Controller('cuentas-pagar')
export class CuentasPagarController {
  constructor(private readonly db: Db) {}

  @Requiere('cuenta_pagar', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ estado: z.enum(['abiertas', 'vencidas', 'pagadas', 'todas']).default('abiertas'), proveedorId: z.string().uuid().optional() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let q = tx
        .selectFrom('cuenta_pagar as c')
        .innerJoin('proveedor as p', 'p.id', 'c.proveedor_id')
        .leftJoin('compra as co', 'co.id', 'c.compra_id')
        .select(['c.id', 'c.descripcion', 'c.fecha', 'c.vencimiento', 'c.monto', 'c.saldo', 'c.estado', 'c.compra_id', 'co.numero as compra_numero', 'p.id as proveedor_id', 'p.nombre as proveedor'])
        .orderBy('c.vencimiento')
        .limit(500);
      if (f.estado === 'abiertas') q = q.where('c.estado', 'in', ['pendiente', 'parcial']);
      if (f.estado === 'vencidas') q = q.where('c.estado', 'in', ['pendiente', 'parcial']).where('c.vencimiento', '<', hoy());
      if (f.estado === 'pagadas') q = q.where('c.estado', '=', 'pagada');
      if (f.proveedorId) q = q.where('c.proveedor_id', '=', f.proveedorId);
      const h = hoy();
      return (await q.execute()).map((c) => ({
        id: c.id,
        descripcion: c.descripcion,
        fecha: c.fecha,
        vencimiento: c.vencimiento,
        vencida: (c.estado === 'pendiente' || c.estado === 'parcial') && c.vencimiento < h,
        monto: c.monto,
        saldo: c.saldo,
        estado: c.estado,
        compra: c.compra_id ? { id: c.compra_id, numero: Number(c.compra_numero) } : null,
        proveedor: { id: c.proveedor_id, nombre: c.proveedor },
      }));
    });
  }

  /** Totales para el tablero: abierto, vencido y a vencer en 7 días. */
  @Requiere('cuenta_pagar', 'ver')
  @Get('resumen')
  resumen(@Contexto() ctx: Ctx) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const h = hoy();
      const r = await tx
        .selectFrom('cuenta_pagar')
        .select([
          sql<string>`coalesce(sum(saldo), 0)`.as('abierto'),
          sql<string>`coalesce(sum(saldo) FILTER (WHERE vencimiento < ${h}::date), 0)`.as('vencido'),
          sql<string>`coalesce(sum(saldo) FILTER (WHERE vencimiento BETWEEN ${h}::date AND ${sumarDias(h, 7)}::date), 0)`.as('semana'),
          sql<string>`count(*)`.as('cuentas'),
        ])
        .where('estado', 'in', ['pendiente', 'parcial'])
        .executeTakeFirstOrThrow();
      return { abierto: new Decimal(r.abierto).toFixed(2), vencido: new Decimal(r.vencido).toFixed(2), proximos7Dias: new Decimal(r.semana).toFixed(2), cuentas: Number(r.cuentas) };
    });
  }

  /** Cuenta manual (servicios, alquiler, fletes…) a un proveedor. */
  @Requiere('cuenta_pagar', 'crear')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(cuentaPagarEntrada, body);
    if (d.vencimiento < d.fecha) throw invalido('El vencimiento no puede ser anterior a la fecha');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      await obtenerProveedor(tx, d.proveedorId);
      const c = await tx
        .insertInto('cuenta_pagar')
        .values({ empresa_id: ctx.empresaId, proveedor_id: d.proveedorId, compra_id: null, descripcion: d.descripcion, fecha: d.fecha, vencimiento: d.vencimiento, monto: new Decimal(d.monto).toFixed(2), saldo: new Decimal(d.monto).toFixed(2), creado_por: ctx.usuarioId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'cuenta_pagar', entidadId: c.id, despues: d });
      return { id: c.id };
    });
  }

  /** Anula una cuenta manual sin pagos. */
  @Requiere('cuenta_pagar', 'cancelar')
  @Post(':id/anular')
  @HttpCode(200)
  anular(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @OrigenPeticion() o: Origen) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const c = await tx.selectFrom('cuenta_pagar').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!c) throw noEncontrado('Cuenta a pagar');
      if (c.compra_id) throw conflicto('CUENTA_DE_COMPRA', 'La cuenta es de una compra: anule la compra');
      if (c.estado === 'anulada') throw conflicto('YA_ANULADA', 'La cuenta ya está anulada');
      if (!new Decimal(c.saldo).eq(c.monto)) throw conflicto('CUENTA_CON_PAGOS', 'La cuenta tiene pagos: anule primero los pagos');
      await tx.updateTable('cuenta_pagar').set({ estado: 'anulada', saldo: '0' }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'anular', entidad: 'cuenta_pagar', entidadId: id });
      return { ok: true };
    });
  }
}

@Controller('pagos-proveedor')
export class PagosProveedorController {
  constructor(private readonly db: Db) {}

  @Requiere('cuenta_pagar', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ proveedorId: z.string().uuid().optional() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let q = tx
        .selectFrom('pago_proveedor as g')
        .innerJoin('proveedor as p', 'p.id', 'g.proveedor_id')
        .innerJoin('usuario as u', 'u.id', 'g.creado_por')
        .select(['g.id', 'g.numero', 'g.fecha', 'g.medio', 'g.monto', 'g.referencia', 'g.estado', 'g.sesion_caja_id', 'g.creado_en', 'p.nombre as proveedor', 'u.nombre as usuario'])
        .orderBy('g.numero', 'desc')
        .limit(300);
      if (f.proveedorId) q = q.where('g.proveedor_id', '=', f.proveedorId);
      return (await q.execute()).map((g) => ({ id: g.id, numero: Number(g.numero), fecha: g.fecha, medio: g.medio, monto: g.monto, referencia: g.referencia, estado: g.estado, desdeCaja: !!g.sesion_caja_id, proveedor: g.proveedor, usuario: g.usuario, creadoEn: g.creado_en }));
    });
  }

  @Requiere('cuenta_pagar', 'aprobar')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(pagoProveedorEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const prov = await obtenerProveedor(tx, d.proveedorId);
      const r = await registrarPago(tx, ctx, d);
      await auditar(tx, { ...ctx, ...o }, { accion: 'pago', entidad: 'proveedor', entidadId: d.proveedorId, despues: { numero: r.numero, proveedor: prov.nombre, total: r.total.toFixed(0), medio: d.medio } });
      return { id: r.id, numero: r.numero, total: r.total.toFixed(2) };
    });
  }

  /** Anula un pago: devuelve el saldo a las cuentas y, si salió de una caja todavía abierta, el efectivo. */
  @Requiere('cuenta_pagar', 'cancelar')
  @Post(':id/anular')
  @HttpCode(200)
  anular(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ motivo: z.string().trim().min(3).max(300) }), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const g = await tx.selectFrom('pago_proveedor').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!g) throw noEncontrado('Pago');
      if (g.estado === 'anulado') throw conflicto('YA_ANULADO', 'El pago ya está anulado');
      if (g.sesion_caja_id) {
        const s = await tx.selectFrom('sesion_caja').select('estado').where('id', '=', g.sesion_caja_id).executeTakeFirstOrThrow();
        if (s.estado !== 'abierta') throw conflicto('SESION_CERRADA', 'El pago salió de una caja ya cerrada: registre el reintegro como ingreso de caja');
        await tx
          .insertInto('movimiento_caja')
          .values({ empresa_id: ctx.empresaId, sesion_id: g.sesion_caja_id, tipo: 'pago_proveedor', medio: 'efectivo', moneda: 'PYG', monto: new Decimal(g.monto).toFixed(2), venta_id: null, motivo: `Anulación del pago N.º ${Number(g.numero)}: ${d.motivo}`, autorizado_por: null, creado_por: ctx.usuarioId })
          .execute();
      }
      const apps = await tx.selectFrom('pago_aplicacion').select(['cuenta_pagar_id', 'monto']).where('pago_id', '=', id).execute();
      for (const a of apps) {
        const c = await tx.selectFrom('cuenta_pagar').select(['monto', 'saldo', 'estado']).where('id', '=', a.cuenta_pagar_id).forUpdate().executeTakeFirstOrThrow();
        if (c.estado === 'anulada') continue;
        const saldo = new Decimal(c.saldo).plus(a.monto);
        await tx.updateTable('cuenta_pagar').set({ saldo: saldo.toFixed(2), estado: saldo.eq(c.monto) ? 'pendiente' : 'parcial' }).where('id', '=', a.cuenta_pagar_id).execute();
      }
      await tx.updateTable('pago_proveedor').set({ estado: 'anulado', anulado_por: ctx.usuarioId, anulado_en: new Date(), nota: g.nota ? `${g.nota} · Anulado: ${d.motivo}` : `Anulado: ${d.motivo}` }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'anular', entidad: 'pago_proveedor', entidadId: id, despues: { numero: Number(g.numero), motivo: d.motivo } });
      return { ok: true };
    });
  }
}
