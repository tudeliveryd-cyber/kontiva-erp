import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { calcularItems, cerrarPedidoEntrada, ErrorCalculo, estadoPedidoEntrada, pedidoEntrada, type PedidoEntrada } from '@kontiva/shared';
import Decimal from 'decimal.js';
import { sql } from 'kysely';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { enSucursal, exigirSucursal, listaDeCliente, preciosVigentes } from '../comun/alcance';
import { auditar } from '../comun/auditoria';
import { Contexto, OrigenPeticion, tiene, type Ctx, type Origen } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { conflicto, ErrorNegocio, invalido, noEncontrado, prohibido } from '../comun/errores';
import { siguienteNumeroPedido } from '../comun/stock';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';
import type { EstadoPedido, TipoPedido } from '../db/tipos';

const ABIERTOS: Record<TipoPedido, EstadoPedido[]> = { presupuesto: ['vigente'], pedido: ['pendiente', 'preparado'] };
const NOMBRE: Record<TipoPedido, string> = { presupuesto: 'Presupuesto', pedido: 'Pedido' };

/** Presupuesto o pedido completo, para la ficha, la impresión y el PDV. */
export async function leerPedido(tx: Tx, id: string, tipo?: TipoPedido) {
  let q = tx
    .selectFrom('pedido as p')
    .innerJoin('sucursal as s', 's.id', 'p.sucursal_id')
    .innerJoin('usuario as u', 'u.id', 'p.creado_por')
    .leftJoin('cliente as c', 'c.id', 'p.cliente_id')
    .leftJoin('lista_precio as l', 'l.id', 'p.lista_precio_id')
    .leftJoin('usuario as cu', 'cu.id', 'p.cerrado_por')
    .leftJoin('pedido as o', 'o.id', 'p.origen_id')
    .leftJoin('venta as v', 'v.id', 'p.venta_id')
    .selectAll('p')
    .select([
      's.nombre as sucursal',
      'u.nombre as vendedor',
      'c.nombre as c_nombre',
      'c.documento as c_documento',
      'c.telefono as c_telefono',
      'c.email as c_email',
      'c.direccion as c_direccion',
      'l.nombre as lista',
      'cu.nombre as cerrado_por_nombre',
      'o.numero as origen_numero',
      'v.numero as venta_numero',
      sql<boolean>`p.tipo = 'presupuesto' AND p.estado = 'vigente' AND p.valido_hasta < current_date`.as('vencido'),
    ])
    .where('p.id', '=', id);
  if (tipo) q = q.where('p.tipo', '=', tipo);
  const p = await q.executeTakeFirst();
  if (!p) return null;
  const items = await tx
    .selectFrom('pedido_item as i')
    .innerJoin('variante as v', 'v.id', 'i.variante_id')
    .innerJoin('producto as pr', 'pr.id', 'v.producto_id')
    .selectAll('i')
    .select(['pr.unidad', 'v.sku'])
    .where('i.pedido_id', '=', id)
    .orderBy('i.linea')
    .execute();
  const generado =
    p.tipo === 'presupuesto' ? await tx.selectFrom('pedido').select(['id', 'numero']).where('origen_id', '=', id).executeTakeFirst() : undefined;
  return {
    id: p.id,
    tipo: p.tipo,
    numero: Number(p.numero),
    estado: p.estado,
    vencido: p.vencido,
    sucursal: { id: p.sucursal_id, nombre: p.sucursal },
    cliente: p.cliente_id
      ? { id: p.cliente_id, nombre: p.c_nombre!, documento: p.c_documento, telefono: p.c_telefono, email: p.c_email, direccion: p.c_direccion }
      : p.cliente_nombre
        ? { id: null, nombre: p.cliente_nombre, documento: null, telefono: null, email: null, direccion: null }
        : null,
    lista: p.lista_precio_id ? { id: p.lista_precio_id, nombre: p.lista } : null,
    validoHasta: p.valido_hasta,
    entregaPrevista: p.entrega_prevista,
    nota: p.nota,
    subtotal: p.subtotal,
    descuento: p.descuento,
    total: p.total,
    vendedor: p.vendedor,
    creadoEn: p.creado_en,
    actualizadoEn: p.actualizado_en,
    cierre: p.cerrado_en ? { en: p.cerrado_en, por: p.cerrado_por_nombre, motivo: p.motivo_cierre } : null,
    origen: p.origen_id ? { id: p.origen_id, numero: Number(p.origen_numero) } : null,
    pedidoGenerado: generado ? { id: generado.id, numero: Number(generado.numero) } : null,
    venta: p.venta_id ? { id: p.venta_id, numero: Number(p.venta_numero) } : null,
    items: items.map((i) => ({
      linea: i.linea,
      varianteId: i.variante_id,
      descripcion: i.descripcion,
      sku: i.sku,
      unidad: i.unidad,
      cantidad: i.cantidad,
      precioUnitario: i.precio_unitario,
      descuento: i.descuento,
      total: i.total,
      tasaIva: Number(i.tasa_iva) as 0 | 5 | 10,
    })),
  };
}
export type PedidoLeido = NonNullable<Awaited<ReturnType<typeof leerPedido>>>;

async function obtener(tx: Tx, ctx: Ctx, id: string, tipo: TipoPedido, bloquear = false) {
  let q = tx.selectFrom('pedido').selectAll().where('id', '=', id).where('tipo', '=', tipo);
  if (bloquear) q = q.forUpdate();
  const p = await q.executeTakeFirst();
  if (!p) throw noEncontrado(NOMBRE[tipo]);
  exigirSucursal(ctx, p.sucursal_id, NOMBRE[tipo]);
  return p;
}

/**
 * Calcula y guarda cabecera e ítems. Precios de la lista del cliente para la sucursal;
 * cambiar precios exige precio.editar y los descuentos descuento.aprobar o el PIN de un supervisor.
 */
async function guardar(
  tx: Tx,
  ctx: Ctx,
  auth: AuthService,
  tipo: TipoPedido,
  d: PedidoEntrada,
  autorizacion: string | undefined,
  previo?: { id: string; numero: string },
): Promise<string> {
  const suc = await tx.selectFrom('sucursal').select(['id', 'activa']).where('id', '=', d.sucursalId).executeTakeFirst();
  if (!suc || !enSucursal(ctx, suc.id)) throw noEncontrado('Sucursal');
  if (d.clienteId) {
    const c = await tx.selectFrom('cliente').select('id').where('id', '=', d.clienteId).where('activo', '=', true).executeTakeFirst();
    if (!c) throw invalido('El cliente no existe');
  }
  if (tipo === 'pedido' && !d.clienteId && !d.clienteNombre) throw invalido('Indique el cliente del pedido');

  const ids = [...new Set(d.items.map((i) => i.varianteId))];
  const variantes = await tx
    .selectFrom('variante as v')
    .innerJoin('producto as p', 'p.id', 'v.producto_id')
    .select(['v.id', 'v.nombre', 'p.nombre as producto', 'p.tasa_iva', 'p.unidad', 'p.activo', 'v.activa'])
    .where('v.id', 'in', ids)
    .execute();
  if (variantes.length !== ids.length || variantes.some((v) => !v.activo || !v.activa)) throw invalido('Algún producto no existe o está inactivo');
  const porId = new Map(variantes.map((v) => [v.id, v]));
  const lista = await listaDeCliente(tx, d.clienteId);
  const precios = await preciosVigentes(tx, ids, d.sucursalId, lista);

  const cambiaPrecio = d.items.some((i) => i.precioUnitario !== undefined && new Decimal(i.precioUnitario).toFixed(2) !== new Decimal(precios.get(i.varianteId) ?? 0).toFixed(2));
  if (cambiaPrecio && !tiene(ctx, 'precio.editar')) throw prohibido('No tiene permiso para cambiar precios');
  let autorizadoPor: string | null = null;
  if (d.items.some((i) => (i.descuento ?? 0) > 0) && !tiene(ctx, 'descuento.aprobar')) {
    autorizadoPor = await auth.verificarAutorizacion(ctx, autorizacion, 'descuento.aprobar');
    if (!autorizadoPor) throw prohibido('El descuento requiere autorización de un supervisor');
  }

  const lineas = d.items.map((i) => {
    const v = porId.get(i.varianteId)!;
    if (v.unidad === 'unidad' && !new Decimal(i.cantidad).isInteger()) throw invalido(`${v.producto} se vende por unidad entera`);
    const precio = i.precioUnitario !== undefined && tiene(ctx, 'precio.editar') ? new Decimal(i.precioUnitario) : new Decimal(precios.get(i.varianteId) ?? 0);
    return { i, v, precio, cantidad: new Decimal(i.cantidad).toDecimalPlaces(4) };
  });
  let calc: ReturnType<typeof calcularItems>;
  try {
    calc = calcularItems(lineas.map((l) => ({ cantidad: l.cantidad, precioUnitario: l.precio, descuento: l.i.descuento ?? 0, tasaIva: Number(l.v.tasa_iva) as 0 | 5 | 10 })));
  } catch (e) {
    if (e instanceof ErrorCalculo) throw new ErrorNegocio(HttpStatus.BAD_REQUEST, e.codigo, e.message);
    throw e;
  }

  const cabecera = {
    sucursal_id: d.sucursalId,
    cliente_id: d.clienteId ?? null,
    cliente_nombre: d.clienteId ? null : (d.clienteNombre ?? null),
    lista_precio_id: lista,
    valido_hasta: tipo === 'presupuesto' ? (d.validoHasta ?? null) : null,
    entrega_prevista: tipo === 'pedido' ? (d.entregaPrevista ?? null) : null,
    nota: d.nota ?? null,
    subtotal: calc.subtotal.toFixed(2),
    descuento: calc.descuento.toFixed(2),
    total: calc.total.toFixed(2),
    autorizado_por: autorizadoPor,
  };
  let id: string;
  if (previo) {
    id = previo.id;
    await tx.updateTable('pedido').set(cabecera).where('id', '=', id).execute();
    await tx.deleteFrom('pedido_item').where('pedido_id', '=', id).execute();
  } else {
    const numero = await siguienteNumeroPedido(tx, tipo);
    const r = await tx
      .insertInto('pedido')
      .values({ empresa_id: ctx.empresaId, tipo, numero, estado: ABIERTOS[tipo][0]!, creado_por: ctx.usuarioId, ...cabecera })
      .returning('id')
      .executeTakeFirstOrThrow();
    id = r.id;
  }
  await tx
    .insertInto('pedido_item')
    .values(
      lineas.map((l, n) => ({
        empresa_id: ctx.empresaId,
        pedido_id: id,
        linea: n + 1,
        variante_id: l.v.id,
        descripcion: l.v.nombre ? `${l.v.producto} · ${l.v.nombre}` : l.v.producto,
        cantidad: l.cantidad.toFixed(4),
        precio_unitario: l.precio.toFixed(2),
        descuento: calc.lineas[n]!.descuento.toFixed(2),
        total: calc.lineas[n]!.total.toFixed(2),
        tasa_iva: Number(l.v.tasa_iva),
      })),
    )
    .execute();
  return id;
}

const filtroProductos = z.object({ sucursalId: z.string().uuid(), clienteId: z.string().uuid().optional(), q: z.string().trim().min(1).max(100) });

/** Búsqueda de productos con el precio que tendría el cliente en esa sucursal y el stock disponible allí. */
async function buscarProductos(tx: Tx, ctx: Ctx, f: z.infer<typeof filtroProductos>) {
  if (!enSucursal(ctx, f.sucursalId)) throw noEncontrado('Sucursal');
  const texto = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`;
  const { rows } = await sql<{ id: string; producto: string; variante: string | null; sku: string | null; unidad: string; tasa_iva: string; controla_stock: boolean; stock: string | null }>`
    SELECT v.id, p.nombre AS producto, v.nombre AS variante, v.sku, p.unidad, p.tasa_iva, p.controla_stock,
      (SELECT sum(s.cantidad) FROM stock s JOIN deposito d ON d.id = s.deposito_id WHERE s.variante_id = v.id AND d.sucursal_id = ${f.sucursalId}::uuid) AS stock
    FROM variante v JOIN producto p ON p.id = v.producto_id
    WHERE p.activo AND v.activa AND (
      EXISTS (SELECT 1 FROM codigo_barras cb WHERE cb.variante_id = v.id AND cb.codigo = ${f.q})
      OR lower(v.sku) = ${f.q.toLowerCase()} OR p.nombre ILIKE ${texto} OR v.nombre ILIKE ${texto})
    ORDER BY similarity(p.nombre, ${f.q}) DESC, p.nombre
    LIMIT 20`.execute(tx);
  const lista = await listaDeCliente(tx, f.clienteId);
  const precios = await preciosVigentes(tx, rows.map((r) => r.id), f.sucursalId, lista);
  return rows.map((r) => ({
    varianteId: r.id,
    descripcion: r.variante ? `${r.producto} · ${r.variante}` : r.producto,
    sku: r.sku,
    unidad: r.unidad,
    tasaIva: Number(r.tasa_iva) as 0 | 5 | 10,
    precio: precios.get(r.id) ?? '0.00',
    stock: r.controla_stock ? (r.stock ?? '0.0000') : null,
  }));
}

const filtroListado = z.object({
  estado: z.string().max(20).optional(),
  q: z.string().trim().max(100).optional(),
  limite: z.coerce.number().int().min(1).max(500).default(200),
});

async function listar(tx: Tx, ctx: Ctx, tipo: TipoPedido, f: z.infer<typeof filtroListado>) {
  let q = tx
    .selectFrom('pedido as p')
    .innerJoin('sucursal as s', 's.id', 'p.sucursal_id')
    .leftJoin('cliente as c', 'c.id', 'p.cliente_id')
    .innerJoin('usuario as u', 'u.id', 'p.creado_por')
    .select([
      'p.id',
      'p.numero',
      'p.estado',
      'p.total',
      'p.valido_hasta',
      'p.entrega_prevista',
      'p.creado_en',
      's.nombre as sucursal',
      'u.nombre as vendedor',
      sql<string | null>`coalesce(c.nombre, p.cliente_nombre)`.as('cliente'),
      sql<boolean>`p.estado = 'vigente' AND p.valido_hasta < current_date`.as('vencido'),
      sql<string>`(SELECT count(*) FROM pedido_item i WHERE i.pedido_id = p.id)`.as('items'),
    ])
    .where('p.tipo', '=', tipo);
  if (!(ctx.esPropietario || ctx.alcance === 'empresa')) q = q.where('p.sucursal_id', 'in', ctx.sucursalIds.length ? ctx.sucursalIds : ['00000000-0000-0000-0000-000000000000']);
  if (f.estado === 'abiertos') q = q.where('p.estado', 'in', ABIERTOS[tipo]);
  else if (f.estado) q = q.where('p.estado', '=', f.estado as EstadoPedido);
  if (f.q) {
    const t = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`;
    const n = /^\d+$/.test(f.q) ? Number(f.q) : null;
    q = q.where((eb) => eb.or([eb('c.nombre', 'ilike', t), eb('p.cliente_nombre', 'ilike', t), ...(n !== null ? [eb('p.numero', '=', String(n))] : [])]));
  }
  const filas = await q.orderBy('p.creado_en', 'desc').limit(f.limite).execute();
  return filas.map((r) => ({
    id: r.id,
    numero: Number(r.numero),
    estado: r.estado,
    vencido: r.vencido,
    total: r.total,
    cliente: r.cliente,
    sucursal: r.sucursal,
    vendedor: r.vendedor,
    validoHasta: r.valido_hasta,
    entregaPrevista: r.entrega_prevista,
    items: Number(r.items),
    creadoEn: r.creado_en,
  }));
}

async function cerrar(tx: Tx, ctx: Ctx, o: Origen, tipo: TipoPedido, id: string, estado: EstadoPedido, motivo: string) {
  const p = await obtener(tx, ctx, id, tipo, true);
  if (!ABIERTOS[tipo].includes(p.estado)) throw conflicto('PEDIDO_CERRADO', `El ${NOMBRE[tipo].toLowerCase()} ya está cerrado`);
  await tx.updateTable('pedido').set({ estado, motivo_cierre: motivo, cerrado_por: ctx.usuarioId, cerrado_en: new Date() }).where('id', '=', id).execute();
  await auditar(tx, { ...ctx, ...o }, { accion: estado, entidad: tipo, entidadId: id, antes: { estado: p.estado }, despues: { estado, motivo } });
  return (await leerPedido(tx, id))!;
}

@Controller('presupuestos')
export class PresupuestosController {
  constructor(
    private readonly db: Db,
    private readonly auth: AuthService,
  ) {}

  @Requiere('presupuesto', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(filtroListado, query);
    return this.db.enEmpresa(ctx.empresaId, (tx) => listar(tx, ctx, 'presupuesto', f));
  }

  @Requiere('presupuesto', 'crear')
  @Get('productos')
  productos(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(filtroProductos, query);
    return this.db.enEmpresa(ctx.empresaId, (tx) => buscarProductos(tx, ctx, f));
  }

  @Requiere('presupuesto', 'ver')
  @Get(':id')
  ver(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      await obtener(tx, ctx, id, 'presupuesto');
      return (await leerPedido(tx, id))!;
    });
  }

  @Requiere('presupuesto', 'crear')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @Headers('x-autorizacion') autorizacion: string | undefined, @OrigenPeticion() o: Origen) {
    const d = validar(pedidoEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const id = await guardar(tx, ctx, this.auth, 'presupuesto', d, autorizacion);
      const p = (await leerPedido(tx, id))!;
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'presupuesto', entidadId: id, despues: { numero: p.numero, total: p.total } });
      return p;
    });
  }

  @Requiere('presupuesto', 'editar')
  @Patch(':id')
  editar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Headers('x-autorizacion') autorizacion: string | undefined, @OrigenPeticion() o: Origen) {
    const d = validar(pedidoEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const previo = await obtener(tx, ctx, id, 'presupuesto', true);
      if (previo.estado !== 'vigente') throw conflicto('PEDIDO_CERRADO', 'Solo se edita un presupuesto vigente');
      await guardar(tx, ctx, this.auth, 'presupuesto', d, autorizacion, previo);
      const p = (await leerPedido(tx, id))!;
      await auditar(tx, { ...ctx, ...o }, { accion: 'editar', entidad: 'presupuesto', entidadId: id, antes: { total: previo.total }, despues: { total: p.total } });
      return p;
    });
  }

  /** El cliente aceptó: se genera el pedido con los mismos precios cotizados. */
  @Requiere('pedido', 'crear')
  @Post(':id/aceptar')
  aceptar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ clienteId: z.string().uuid().nullable().optional(), clienteNombre: z.string().trim().max(200).nullable().optional(), entregaPrevista: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }), body ?? {});
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const pr = await obtener(tx, ctx, id, 'presupuesto', true);
      if (pr.estado !== 'vigente') throw conflicto('PEDIDO_CERRADO', 'El presupuesto ya está cerrado');
      const vencido = await sql<{ v: boolean }>`SELECT ${pr.valido_hasta}::date < current_date AS v`.execute(tx);
      if (pr.valido_hasta && vencido.rows[0]!.v) throw conflicto('PRESUPUESTO_VENCIDO', 'El presupuesto venció: actualice la validez y los precios antes de aceptarlo');
      let clienteId = pr.cliente_id;
      let clienteNombre = pr.cliente_nombre;
      if (!clienteId && d.clienteId) {
        const c = await tx.selectFrom('cliente').select('id').where('id', '=', d.clienteId).where('activo', '=', true).executeTakeFirst();
        if (!c) throw invalido('El cliente no existe');
        clienteId = c.id;
        clienteNombre = null;
      } else if (!clienteId && !clienteNombre && d.clienteNombre) clienteNombre = d.clienteNombre;
      if (!clienteId && !clienteNombre) throw invalido('Indique el cliente del pedido');

      const numero = await siguienteNumeroPedido(tx, 'pedido');
      const nuevo = await tx
        .insertInto('pedido')
        .values({
          empresa_id: ctx.empresaId,
          tipo: 'pedido',
          numero,
          estado: 'pendiente',
          sucursal_id: pr.sucursal_id,
          cliente_id: clienteId,
          cliente_nombre: clienteId ? null : clienteNombre,
          lista_precio_id: pr.lista_precio_id,
          entrega_prevista: d.entregaPrevista ?? null,
          nota: pr.nota,
          subtotal: pr.subtotal,
          descuento: pr.descuento,
          total: pr.total,
          origen_id: pr.id,
          autorizado_por: pr.autorizado_por,
          creado_por: ctx.usuarioId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await sql`
        INSERT INTO pedido_item (empresa_id, pedido_id, linea, variante_id, descripcion, cantidad, precio_unitario, descuento, total, tasa_iva)
        SELECT empresa_id, ${nuevo.id}::uuid, linea, variante_id, descripcion, cantidad, precio_unitario, descuento, total, tasa_iva
        FROM pedido_item WHERE pedido_id = ${pr.id}::uuid`.execute(tx);
      await tx.updateTable('pedido').set({ estado: 'aceptado', cerrado_por: ctx.usuarioId, cerrado_en: new Date() }).where('id', '=', pr.id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'aceptar', entidad: 'presupuesto', entidadId: pr.id, despues: { pedidoId: nuevo.id, pedido: numero } });
      return (await leerPedido(tx, nuevo.id))!;
    });
  }

  @Requiere('presupuesto', 'editar')
  @Post(':id/rechazar')
  @HttpCode(200)
  rechazar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(cerrarPedidoEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, (tx) => cerrar(tx, ctx, o, 'presupuesto', id, 'rechazado', d.motivo));
  }

  @Requiere('presupuesto', 'editar')
  @Post(':id/anular')
  @HttpCode(200)
  anular(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(cerrarPedidoEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, (tx) => cerrar(tx, ctx, o, 'presupuesto', id, 'anulado', d.motivo));
  }
}

@Controller('pedidos')
export class PedidosController {
  constructor(
    private readonly db: Db,
    private readonly auth: AuthService,
  ) {}

  @Requiere('pedido', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(filtroListado, query);
    return this.db.enEmpresa(ctx.empresaId, (tx) => listar(tx, ctx, 'pedido', f));
  }

  @Requiere('pedido', 'crear')
  @Get('productos')
  productos(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(filtroProductos, query);
    return this.db.enEmpresa(ctx.empresaId, (tx) => buscarProductos(tx, ctx, f));
  }

  @Requiere('pedido', 'ver')
  @Get(':id')
  ver(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      await obtener(tx, ctx, id, 'pedido');
      return (await leerPedido(tx, id))!;
    });
  }

  @Requiere('pedido', 'crear')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @Headers('x-autorizacion') autorizacion: string | undefined, @OrigenPeticion() o: Origen) {
    const d = validar(pedidoEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const id = await guardar(tx, ctx, this.auth, 'pedido', d, autorizacion);
      const p = (await leerPedido(tx, id))!;
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'pedido', entidadId: id, despues: { numero: p.numero, total: p.total } });
      return p;
    });
  }

  @Requiere('pedido', 'editar')
  @Patch(':id')
  editar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Headers('x-autorizacion') autorizacion: string | undefined, @OrigenPeticion() o: Origen) {
    const d = validar(pedidoEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const previo = await obtener(tx, ctx, id, 'pedido', true);
      if (!ABIERTOS.pedido.includes(previo.estado)) throw conflicto('PEDIDO_CERRADO', 'El pedido ya está cerrado');
      await guardar(tx, ctx, this.auth, 'pedido', d, autorizacion, previo);
      const p = (await leerPedido(tx, id))!;
      await auditar(tx, { ...ctx, ...o }, { accion: 'editar', entidad: 'pedido', entidadId: id, antes: { total: previo.total }, despues: { total: p.total } });
      return p;
    });
  }

  /** Pendiente ↔ preparado (armado y listo para entregar). */
  @Requiere('pedido', 'editar')
  @Post(':id/estado')
  @HttpCode(200)
  estado(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(estadoPedidoEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const p = await obtener(tx, ctx, id, 'pedido', true);
      if (!ABIERTOS.pedido.includes(p.estado)) throw conflicto('PEDIDO_CERRADO', 'El pedido ya está cerrado');
      if (p.estado !== d.estado) {
        await tx.updateTable('pedido').set({ estado: d.estado }).where('id', '=', id).execute();
        await auditar(tx, { ...ctx, ...o }, { accion: 'estado', entidad: 'pedido', entidadId: id, antes: { estado: p.estado }, despues: { estado: d.estado } });
      }
      return (await leerPedido(tx, id))!;
    });
  }

  @Requiere('pedido', 'cancelar')
  @Post(':id/cancelar')
  @HttpCode(200)
  cancelar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(cerrarPedidoEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, (tx) => cerrar(tx, ctx, o, 'pedido', id, 'cancelado', d.motivo));
  }
}
