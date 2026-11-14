import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { anularVentaEntrada, BALANZA_PREDETERMINADA, compararTalles, lineaPresentacion, precioPresentacion, calcularItems, leerEtiquetaBalanza, type ConfigBalanza, calcularPagos, ErrorCalculo, ventaEntrada, type Cotizaciones } from '@kontiva/shared';
import Decimal from 'decimal.js';
import { sql } from 'kysely';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { enSucursal, exigirSucursal, listaDeCliente, preciosVigentes } from '../comun/alcance';
import { auditar } from '../comun/auditoria';
import { Contexto, OrigenPeticion, tiene, type Ctx, type Origen } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { moverLotes } from '../comun/lotes';
import { cerrarSiPagada } from '../restaurante/restaurante.controller';
import { reintegrarVales, usarVales } from './vales.controller';
import { conflicto, ErrorNegocio, invalido, noEncontrado, prohibido } from '../comun/errores';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';
import { cotizacionesVigentes, obtenerCaja, sesionAbierta } from './cajas.controller';
import { devueltoPorLinea } from './devoluciones.controller';
import { leerPedido } from './pedidos.controller';
import { cargarFe, emitirFactura, numeroComprobante } from '../sifen/emision';
import { cancelarEnSifen } from '../sifen/emisor.service';
import { saldoCliente } from '../catalogo/clientes.controller';
import { HttpStatus } from '@nestjs/common';
import QRCode from 'qrcode';

function aCotizaciones(filas: { moneda: 'USD' | 'BRL'; compra: string; venta: string }[]): Cotizaciones {
  return Object.fromEntries(filas.map((c) => [c.moneda, { compra: c.compra, venta: c.venta }]));
}

/** Venta completa para mostrar o imprimir el comprobante interno. */
export async function leerVenta(tx: Tx, id: string) {
  const v = await tx
    .selectFrom('venta as v')
    .innerJoin('caja as c', 'c.id', 'v.caja_id')
    .innerJoin('sucursal as s', 's.id', 'v.sucursal_id')
    .innerJoin('usuario as u', 'u.id', 'v.creado_por')
    .leftJoin('cliente as cl', 'cl.id', 'v.cliente_id')
    .leftJoin('usuario as an', 'an.id', 'v.anulada_por')
    .selectAll('v')
    .select(['c.nombre as caja', 's.nombre as sucursal', 's.codigo as sucursal_codigo', 's.direccion as sucursal_direccion', 'u.nombre as vendedor', 'cl.nombre as cliente_nombre', 'cl.documento as cliente_documento', 'an.nombre as anulada_por_nombre'])
    .where('v.id', '=', id)
    .executeTakeFirst();
  if (!v) return null;
  const [items, pagos] = await Promise.all([
    tx.selectFrom('venta_item').selectAll().where('venta_id', '=', id).orderBy('linea').execute(),
    tx.selectFrom('venta_pago').selectAll().where('venta_id', '=', id).orderBy('linea').execute(),
  ]);
  const devuelto = await devueltoPorLinea(tx, id);
  const receta = await tx.selectFrom('receta').selectAll().where('venta_id', '=', id).executeTakeFirst();
  // Lotes de los que salió cada producto (trazabilidad).
  const lotes = await tx
    .selectFrom('movimiento_lote as m')
    .innerJoin('lote as l', 'l.id', 'm.lote_id')
    .select(['m.variante_id', 'l.codigo', 'l.vencimiento', (eb) => eb.fn.sum<string>('m.cantidad').as('cantidad')])
    .where('m.origen_id', '=', id)
    .where('m.tipo', '=', 'venta')
    .groupBy(['m.variante_id', 'l.codigo', 'l.vencimiento'])
    .execute();
  const de = await tx
    .selectFrom('documento_electronico')
    .select(['id', 'cdc', 'establecimiento', 'punto', 'numero', 'timbrado', 'estado', 'qr_url', 'ambiente', 'total_iva', 'respuesta_mensaje'])
    .where('venta_id', '=', id)
    .where('tipo_documento', '=', 1)
    .executeTakeFirst();
  const feConf = de ? await tx.selectFrom('fe_configuracion').select('timbrado_fecha').executeTakeFirst() : undefined;
  const qrImagen = de ? `data:image/svg+xml;base64,${Buffer.from(await QRCode.toString(de.qr_url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })).toString('base64')}` : null;
  const devoluciones = await tx.selectFrom('devolucion').select(['id', 'numero', 'total', 'medio', 'creado_en']).where('venta_id', '=', id).orderBy('numero').execute();
  const vuelto = await tx
    .selectFrom('movimiento_caja')
    .select(['moneda', 'monto'])
    .where('venta_id', '=', id)
    .where('tipo', '=', 'vuelto')
    .execute();
  return {
    id: v.id,
    numero: Number(v.numero),
    estado: v.estado,
    comprobante: v.comprobante,
    fecha: v.creado_en,
    caja: { id: v.caja_id, nombre: v.caja },
    sucursal: { id: v.sucursal_id, nombre: v.sucursal, codigo: v.sucursal_codigo, direccion: v.sucursal_direccion },
    vendedor: { id: v.creado_por, nombre: v.vendedor },
    cliente: v.cliente_id ? { id: v.cliente_id, nombre: v.cliente_nombre, documento: v.cliente_documento } : null,
    pedidoId: v.pedido_id,
    credito: v.credito,
    registradaOfflineEn: v.registrada_offline_en,
    cuentaCobrar: Number(v.credito) > 0 ? ((await tx.selectFrom('cuenta_cobrar').select(['id', 'saldo', 'vencimiento', 'estado']).where('venta_id', '=', v.id).executeTakeFirst()) ?? null) : null,
    documentoElectronico: de
      ? { id: de.id, cdc: de.cdc, numero: numeroComprobante(de), timbrado: de.timbrado, timbradoInicio: feConf?.timbrado_fecha ?? null, estado: de.estado, qr: de.qr_url, qrImagen, ambiente: de.ambiente, totalIva: de.total_iva, mensaje: de.respuesta_mensaje }
      : null,
    subtotal: v.subtotal,
    descuento: v.descuento,
    total: v.total,
    gravado10: v.gravado10,
    gravado5: v.gravado5,
    exento: v.exento,
    iva10: v.iva10,
    iva5: v.iva5,
    vuelto: vuelto.map((x) => ({ moneda: x.moneda, monto: new Decimal(x.monto).neg().toFixed(2) })),
    items: items.map((i) => ({
      linea: i.linea,
      varianteId: i.variante_id,
      descripcion: i.descripcion,
      cantidad: i.cantidad,
      precioUnitario: precio4(i.precio_unitario),
      descuento: i.descuento,
      total: i.total,
      tasaIva: Number(i.tasa_iva),
      cantidadDevuelta: (devuelto.get(i.linea)?.cantidad ?? new Decimal(0)).toFixed(4),
      condicionVenta: i.condicion_venta,
      presentacion: i.presentacion,
      lotes: lotes.filter((l) => l.variante_id === i.variante_id).map((l) => ({ codigo: l.codigo, vencimiento: l.vencimiento, cantidad: new Decimal(l.cantidad).neg().toFixed(4) })),
    })),
    receta: receta
      ? { medico: receta.medico, matricula: receta.matricula, paciente: receta.paciente, pacienteDocumento: receta.paciente_documento, fecha: receta.fecha, numero: receta.numero, retenida: receta.retenida }
      : null,
    devoluciones: devoluciones.map((d) => ({ id: d.id, numero: Number(d.numero), total: d.total, medio: d.medio, fecha: d.creado_en })),
    pagos: pagos.map((p) => ({ medio: p.medio, moneda: p.moneda, monto: p.monto, cotizacion: p.cotizacion, montoPyg: p.monto_pyg, referencia: p.referencia })),
    autorizadoPor: v.autorizado_por,
    anulacion: v.anulada_en ? { fecha: v.anulada_en, por: v.anulada_por_nombre, motivo: v.motivo_anulacion, autorizadaPor: v.anulacion_autorizada_por } : null,
  };
}
export type VentaDto = NonNullable<Awaited<ReturnType<typeof leerVenta>>>;

/** Precio con dos decimales, o cuatro si una presentación los necesita (caja de 12 a 10.000 = 833,3333). */
export const precio4 = (v: string) => {
  const d = new Decimal(v);
  return d.decimalPlaces() <= 2 ? d.toFixed(2) : d.toFixed(4);
};

/** Presentaciones activas de las variantes con su precio efectivo (el propio o factor × precio de la unidad). */
export async function presentacionesDe(tx: Tx, varianteIds: string[], precios: Map<string, string>) {
  const r = new Map<string, { id: string; nombre: string; factor: string; precio: string }[]>();
  if (!varianteIds.length) return r;
  const filas = await tx.selectFrom('presentacion').select(['id', 'variante_id', 'nombre', 'factor', 'precio']).where('variante_id', 'in', varianteIds).where('activa', '=', true).orderBy('factor').execute();
  for (const p of filas) {
    const lista = r.get(p.variante_id) ?? [];
    lista.push({ id: p.id, nombre: p.nombre, factor: p.factor, precio: precioPresentacion(precios.get(p.variante_id) ?? 0, p.factor, p.precio).toFixed(2) });
    r.set(p.variante_id, lista);
  }
  return r;
}

@Controller('pdv')
export class PdvController {
  constructor(private readonly db: Db) {}

  /** Lo que el PDV necesita al abrir: caja, sesión propia, cotizaciones y configuración. */
  @Requiere('venta', 'crear')
  @Get('contexto')
  contexto(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const { cajaId } = validar(z.object({ cajaId: z.string().uuid() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const caja = await obtenerCaja(tx, ctx, cajaId);
      const sesion = await sesionAbierta(tx, cajaId);
      const empresa = await tx.selectFrom('empresa').select(['razon_social', 'nombre_fantasia', 'ruc', 'configuracion']).executeTakeFirstOrThrow();
      const sucursal = await tx.selectFrom('sucursal').select(['nombre', 'codigo', 'direccion']).where('id', '=', caja.sucursal_id).executeTakeFirstOrThrow();
      return {
        caja: { id: caja.id, nombre: caja.nombre },
        sucursal: { id: caja.sucursal_id, ...sucursal },
        empresa: { nombre: empresa.nombre_fantasia ?? empresa.razon_social, razonSocial: empresa.razon_social, ruc: empresa.ruc },
        sesion: sesion ? { id: sesion.id, propia: sesion.usuario_id === ctx.usuarioId, abiertaEn: sesion.abierta_en } : null,
        cotizaciones: await cotizacionesVigentes(tx, caja.sucursal_id),
        permiteStockNegativo: (empresa.configuracion as { permiteStockNegativo?: boolean }).permiteStockNegativo === true,
        balanza: { ...BALANZA_PREDETERMINADA, ...((empresa.configuracion as { balanza?: Partial<ConfigBalanza> }).balanza ?? {}) },
        puede: {
          descuento: tiene(ctx, 'descuento.aprobar'),
          cambiarPrecio: tiene(ctx, 'precio.editar'),
          anular: tiene(ctx, 'venta.cancelar'),
        },
      };
    });
  }

  /**
   * Catálogo completo de la caja para vender sin conexión: productos activos con sus códigos de barras,
   * el precio de la sucursal (lista general) y el stock del depósito. La caja lo guarda y lo renueva.
   */
  @Requiere('venta', 'crear')
  @Get('catalogo')
  catalogo(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const { cajaId } = validar(z.object({ cajaId: z.string().uuid() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const caja = await obtenerCaja(tx, ctx, cajaId);
      const filas = await tx
        .selectFrom('variante as v')
        .innerJoin('producto as p', 'p.id', 'v.producto_id')
        .leftJoin('stock as s', (j) => j.onRef('s.variante_id', '=', 'v.id').on('s.deposito_id', '=', caja.deposito_id))
        .select(['v.id', 'p.nombre as producto', 'v.nombre as variante', 'v.sku', 'p.unidad', 'p.tasa_iva', 'p.controla_stock', 's.cantidad', 'p.principio_activo', 'p.concentracion', 'p.condicion_venta'])
        .select((eb) => eb.selectFrom('codigo_barras as cb').whereRef('cb.variante_id', '=', 'v.id').where('cb.presentacion_id', 'is', null).select(sql<string[]>`coalesce(array_agg(cb.codigo), '{}')`.as('c')).as('codigos'))
        .where('p.activo', '=', true)
        .where('v.activa', '=', true)
        .orderBy('p.nombre')
        .limit(50000)
        .execute();
      const precios = await preciosVigentes(tx, filas.map((r) => r.id), caja.sucursal_id, null);
      return {
        generado: new Date().toISOString(),
        items: filas.map((r) => ({
          varianteId: r.id,
          descripcion: r.variante ? `${r.producto} · ${r.variante}` : r.producto,
          sku: r.sku,
          codigos: r.codigos ?? [],
          unidad: r.unidad,
          tasaIva: Number(r.tasa_iva) as 0 | 5 | 10,
          precio: precios.get(r.id) ?? '0.00',
          controlaStock: r.controla_stock,
          stock: r.controla_stock ? (r.cantidad ?? '0.0000') : null,
          principioActivo: r.principio_activo,
          concentracion: r.concentracion,
          condicionVenta: r.condicion_venta,
        })),
      };
    });
  }

  /**
   * Búsqueda para la caja: código de barras exacto primero (lector), luego SKU y nombre.
   * Devuelve precio de la sucursal y stock del depósito de la caja.
   */
  @Requiere('venta', 'crear')
  @Get('buscar')
  buscar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ cajaId: z.string().uuid(), q: z.string().trim().min(1).max(100), clienteId: z.string().uuid().optional() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const caja = await obtenerCaja(tx, ctx, f.cajaId);
      const lista = await listaDeCliente(tx, f.clienteId);
      const base = () =>
        tx
          .selectFrom('variante as v')
          .innerJoin('producto as p', 'p.id', 'v.producto_id')
          .leftJoin('stock as s', (j) => j.onRef('s.variante_id', '=', 'v.id').on('s.deposito_id', '=', caja.deposito_id))
          .select(['v.id', 'p.id as producto_id', 'p.nombre as producto', 'v.nombre as variante', 'v.sku', 'v.talle', 'v.color', 'p.unidad', 'p.tasa_iva', 'p.controla_stock', 's.cantidad', 'p.principio_activo', 'p.concentracion', 'p.condicion_venta'])
          .where('p.activo', '=', true)
          .where('v.activa', '=', true);

      // Etiqueta de balanza: el código trae el PLU y el peso (o el importe).
      const empresa = await tx.selectFrom('empresa').select('configuracion').executeTakeFirstOrThrow();
      const etiqueta = leerEtiquetaBalanza(f.q, (empresa.configuracion as { balanza?: ConfigBalanza }).balanza);
      const porCodigoFilas = await base()
        .innerJoin('codigo_barras as cb', 'cb.variante_id', 'v.id')
        .select('cb.presentacion_id')
        .where('cb.codigo', 'in', etiqueta ? etiqueta.candidatos : [f.q])
        .execute();
      // Código de una presentación (la caja, el rollo): se agrega esa presentación.
      const presentacionLeida = new Map(porCodigoFilas.filter((r) => r.presentacion_id).map((r) => [r.id, r.presentacion_id!]));
      let filas: Omit<(typeof porCodigoFilas)[number], 'presentacion_id'>[] = porCodigoFilas;
      if (etiqueta && filas.length > 1) filas = filas.slice(0, 1);
      const porCodigo = filas.length > 0;
      if (!porCodigo) {
        filas = await base()
          .where((eb) => eb.or([eb(sql`lower(v.sku)`, '=', f.q.toLowerCase()), eb('p.nombre', 'ilike', `%${f.q.replace(/[%_\\]/g, '\\$&')}%`), eb('p.principio_activo', 'ilike', `%${f.q.replace(/[%_\\]/g, '\\$&')}%`)]))
          .orderBy(sql`greatest(similarity(p.nombre, ${f.q}), similarity(coalesce(p.principio_activo, ''), ${f.q}))`, 'desc')
          .orderBy('p.nombre')
          .limit(20)
          .execute();
      }
      const precios = await preciosVigentes(tx, filas.map((r) => r.id), caja.sucursal_id, lista);
      const presentaciones = await presentacionesDe(tx, filas.map((r) => r.id), precios);
      const cantidadEtiqueta = (id: string) => {
        if (!etiqueta) return undefined;
        if (etiqueta.cantidad !== null) return etiqueta.cantidad.toFixed(3);
        const precio = Number(precios.get(id) ?? 0);
        return precio > 0 ? (etiqueta.importe! / precio).toFixed(3) : undefined;
      };
      return {
        porCodigo,
        items: filas.map((r) => ({
          cantidad: porCodigo ? cantidadEtiqueta(r.id) : undefined,
          varianteId: r.id,
          productoId: r.producto_id,
          talle: r.talle,
          color: r.color,
          descripcion: r.variante ? `${r.producto} · ${r.variante}` : r.producto,
          sku: r.sku,
          unidad: r.unidad,
          tasaIva: Number(r.tasa_iva) as 0 | 5 | 10,
          precio: precios.get(r.id) ?? '0.00',
          controlaStock: r.controla_stock,
          stock: r.controla_stock ? (r.cantidad ?? '0.0000') : null,
          principioActivo: r.principio_activo,
          concentracion: r.concentracion,
          condicionVenta: r.condicion_venta,
          presentaciones: presentaciones.get(r.id) ?? [],
          presentacionId: presentacionLeida.get(r.id) ?? null,
        })),
      };
    });
  }

  /**
   * Cambio desde la caja: ventas confirmadas de la sucursal de la caja con ese número (una por caja),
   * con lo que todavía se puede devolver. El cajero puede cambiar lo vendido por otro.
   */
  @Requiere('venta', 'crear')
  @Get('venta-cambio')
  ventaCambio(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ cajaId: z.string().uuid(), numero: z.coerce.number().int().positive().max(1e12) }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const caja = await obtenerCaja(tx, ctx, f.cajaId);
      const ids = await tx
        .selectFrom('venta')
        .select('id')
        .where('sucursal_id', '=', caja.sucursal_id)
        .where('numero', '=', String(f.numero))
        .where('estado', '=', 'confirmada')
        .orderBy('creado_en', 'desc')
        .limit(10)
        .execute();
      const ventas = await Promise.all(ids.map((r) => leerVenta(tx, r.id)));
      return ventas.filter((v) => v && v.items.some((i) => Number(i.cantidad) > Number(i.cantidadDevuelta)));
    });
  }

  /** Grade de un producto (talle × color) con precio y stock del depósito de la caja, para elegir la variante. */
  @Requiere('venta', 'crear')
  @Get('grade')
  grade(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ cajaId: z.string().uuid(), productoId: z.string().uuid(), clienteId: z.string().uuid().optional() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const caja = await obtenerCaja(tx, ctx, f.cajaId);
      const p = await tx.selectFrom('producto').select(['id', 'nombre', 'unidad', 'tasa_iva', 'controla_stock']).where('id', '=', f.productoId).where('activo', '=', true).executeTakeFirst();
      if (!p) throw noEncontrado('Producto');
      const filas = await tx
        .selectFrom('variante as v')
        .leftJoin('stock as s', (j) => j.onRef('s.variante_id', '=', 'v.id').on('s.deposito_id', '=', caja.deposito_id))
        .select(['v.id', 'v.nombre', 'v.sku', 'v.talle', 'v.color', 's.cantidad'])
        .where('v.producto_id', '=', p.id)
        .where('v.activa', '=', true)
        .execute();
      const precios = await preciosVigentes(tx, filas.map((r) => r.id), caja.sucursal_id, await listaDeCliente(tx, f.clienteId));
      const talles = [...new Set(filas.map((r) => r.talle ?? ''))].sort(compararTalles);
      const colores = [...new Set(filas.map((r) => r.color ?? ''))].sort((a, b) => a.localeCompare(b, 'es'));
      return {
        producto: { id: p.id, nombre: p.nombre },
        talles,
        colores,
        items: filas.map((r) => ({
          varianteId: r.id,
          productoId: p.id,
          descripcion: r.nombre ? `${p.nombre} · ${r.nombre}` : p.nombre,
          sku: r.sku,
          talle: r.talle ?? '',
          color: r.color ?? '',
          unidad: p.unidad,
          tasaIva: Number(p.tasa_iva) as 0 | 5 | 10,
          precio: precios.get(r.id) ?? '0.00',
          controlaStock: p.controla_stock,
          stock: p.controla_stock ? (r.cantidad ?? '0.0000') : null,
          principioActivo: null,
          concentracion: null,
          condicionVenta: 'libre' as const,
        })),
      };
    });
  }

  /** Productos con el mismo principio activo (y concentración, si la tiene): alternativas para ofrecer. */
  @Requiere('venta', 'crear')
  @Get('equivalentes')
  equivalentes(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ cajaId: z.string().uuid(), varianteId: z.string().uuid() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const caja = await obtenerCaja(tx, ctx, f.cajaId);
      const base = await tx.selectFrom('variante as v').innerJoin('producto as p', 'p.id', 'v.producto_id').select(['p.id', 'p.principio_activo', 'p.concentracion']).where('v.id', '=', f.varianteId).executeTakeFirst();
      if (!base) throw noEncontrado('Producto');
      if (!base.principio_activo) return { principioActivo: null, items: [] };
      let q = tx
        .selectFrom('variante as v')
        .innerJoin('producto as p', 'p.id', 'v.producto_id')
        .leftJoin('stock as s', (j) => j.onRef('s.variante_id', '=', 'v.id').on('s.deposito_id', '=', caja.deposito_id))
        .select(['v.id', 'p.nombre as producto', 'v.nombre as variante', 'v.sku', 'p.unidad', 'p.tasa_iva', 'p.controla_stock', 's.cantidad', 'p.principio_activo', 'p.concentracion', 'p.condicion_venta'])
        .where('p.activo', '=', true)
        .where('v.activa', '=', true)
        .where('v.id', '<>', f.varianteId)
        .where(sql`lower(p.principio_activo)`, '=', base.principio_activo.toLowerCase());
      if (base.concentracion) q = q.where(sql`lower(coalesce(p.concentracion, ''))`, '=', base.concentracion.toLowerCase());
      const filas = await q.orderBy(sql`coalesce(s.cantidad, 0) > 0`, 'desc').orderBy('p.nombre').limit(30).execute();
      const precios = await preciosVigentes(tx, filas.map((r) => r.id), caja.sucursal_id, null);
      return {
        principioActivo: base.principio_activo,
        concentracion: base.concentracion,
        items: filas.map((r) => ({
          varianteId: r.id,
          descripcion: r.variante ? `${r.producto} · ${r.variante}` : r.producto,
          sku: r.sku,
          unidad: r.unidad,
          tasaIva: Number(r.tasa_iva) as 0 | 5 | 10,
          precio: precios.get(r.id) ?? '0.00',
          controlaStock: r.controla_stock,
          stock: r.controla_stock ? (r.cantidad ?? '0.0000') : null,
          principioActivo: r.principio_activo,
          concentracion: r.concentracion,
          condicionVenta: r.condicion_venta,
        })),
      };
    });
  }
}

@Controller('pdv')
export class PdvPreciosController {
  constructor(private readonly db: Db) {}

  /** Precios de las líneas del carrito al elegir o quitar el cliente (su lista de precios). */
  @Requiere('venta', 'crear')
  @Post('precios')
  @HttpCode(200)
  precios(@Contexto() ctx: Ctx, @Body() body: unknown) {
    const d = validar(z.object({ cajaId: z.string().uuid(), clienteId: z.string().uuid().nullable().optional(), varianteIds: z.array(z.string().uuid()).max(500) }), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const caja = await obtenerCaja(tx, ctx, d.cajaId);
      const lista = await listaDeCliente(tx, d.clienteId);
      const precios = await preciosVigentes(tx, [...new Set(d.varianteIds)], caja.sucursal_id, lista);
      const nombre = lista ? (await tx.selectFrom('lista_precio').select('nombre').where('id', '=', lista).executeTakeFirstOrThrow()).nombre : null;
      return { lista: lista ? { id: lista, nombre } : null, precios: Object.fromEntries(precios) };
    });
  }

  /** Pedidos abiertos de la sucursal de la caja, para cargarlos en el carrito y cobrarlos. */
  @Requiere('venta', 'crear')
  @Get('pedidos')
  pedidos(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ cajaId: z.string().uuid(), q: z.string().trim().max(100).optional() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const caja = await obtenerCaja(tx, ctx, f.cajaId);
      let q = tx
        .selectFrom('pedido as p')
        .leftJoin('cliente as c', 'c.id', 'p.cliente_id')
        .select('p.id')
        .where('p.tipo', '=', 'pedido')
        .where('p.estado', 'in', ['pendiente', 'preparado'])
        .where('p.sucursal_id', '=', caja.sucursal_id);
      if (f.q) {
        const n = /^\d+$/.test(f.q) ? f.q : null;
        q = q.where((eb) => eb.or([eb('c.nombre', 'ilike', `%${f.q}%`), eb('p.cliente_nombre', 'ilike', `%${f.q}%`), ...(n ? [eb('p.numero', '=', n)] : [])]));
      }
      const ids = await q.orderBy('p.estado', 'desc').orderBy('p.creado_en').limit(50).execute();
      return Promise.all(ids.map(async (r) => (await leerPedido(tx, r.id))!));
    });
  }
}

@Controller('ventas')
export class VentasController {
  constructor(
    private readonly db: Db,
    private readonly auth: AuthService,
  ) {}

  /**
   * Venta atómica: todo o nada en una transacción.
   *  1. Idempotencia: la misma clave devuelve la misma venta (reintentos por cortes de red).
   *  2. Caja bloqueada (numeración) y sesión abierta del propio cajero.
   *  3. Precios desde la base; descuentos y cambios de precio solo con permiso o PIN de supervisor.
   *  4. Stock bloqueado en orden de id (sin interbloqueos) y validado.
   *  5. Venta, ítems, pagos, movimientos de stock y de caja, auditoría.
   */
  @Requiere('venta', 'crear')
  @Post()
  async crear(
    @Contexto() ctx: Ctx,
    @Body() body: unknown,
    @Headers('x-autorizacion') autorizacion: string | undefined,
    @OrigenPeticion() o: Origen,
    /** Uso interno (despacho de un reparto): todo a la cuenta del cliente, sin tope de crédito; contra entrega si no tiene crédito. */
    interno?: { reparto: number },
  ) {
    const d = validar(ventaEntrada, interno ? { ...(body as object), pagos: [], credito: 1 } : body);
    try {
      return await this.db.enEmpresa(ctx.empresaId, async (tx) => {
        const previa = await tx.selectFrom('venta').select('id').where('clave_idempotencia', '=', d.claveIdempotencia).executeTakeFirst();
        if (previa) return (await leerVenta(tx, previa.id))!;

        const caja = await obtenerCaja(tx, ctx, d.cajaId, true);
        // Releer tras el bloqueo: otra petición con la misma clave pudo confirmarse mientras esperábamos.
        const repetida = await tx.selectFrom('venta').select('id').where('clave_idempotencia', '=', d.claveIdempotencia).executeTakeFirst();
        if (repetida) return (await leerVenta(tx, repetida.id))!;

        const sesion = await sesionAbierta(tx, caja.id);
        if (!sesion) throw conflicto('CAJA_CERRADA', 'La caja no está abierta');
        if (sesion.usuario_id !== ctx.usuarioId) throw prohibido('La caja está abierta por otro usuario');
        // Venta sin conexión: debe ser de esta sesión de caja y de las últimas 72 horas.
        const registradaOffline = d.offline ? new Date(d.offline.registradaEn) : null;
        if (registradaOffline) {
          const t = registradaOffline.getTime();
          if (t < new Date(sesion.abierta_en).getTime() - 5 * 60_000 || t > Date.now() + 5 * 60_000 || t < Date.now() - 72 * 3600_000) {
            throw invalido('La venta sin conexión no corresponde a la sesión de caja abierta');
          }
        }

        if (d.clienteId) {
          const cl = await tx.selectFrom('cliente').select('id').where('id', '=', d.clienteId).where('activo', '=', true).executeTakeFirst();
          if (!cl) throw invalido('El cliente no existe');
        }

        const ids = [...new Set(d.items.map((i) => i.varianteId))];
        const variantes = await tx
          .selectFrom('variante as v')
          .innerJoin('producto as p', 'p.id', 'v.producto_id')
          .select(['v.id', 'v.nombre', 'v.costo', 'p.nombre as producto', 'p.tasa_iva', 'p.controla_stock', 'p.unidad', 'p.activo', 'v.activa', 'p.condicion_venta'])
          .where('v.id', 'in', ids)
          .execute();
        const porId = new Map(variantes.map((v) => [v.id, v]));
        if (variantes.length !== ids.length || variantes.some((v) => !v.activo || !v.activa)) throw invalido('Algún producto no existe o está inactivo');
        // Medicamentos bajo receta: la venta lleva los datos de la receta; los de receta archivada, la receta retenida.
        const conReceta = variantes.filter((v) => v.condicion_venta !== 'libre');
        if (conReceta.length) {
          if (!d.receta) throw new ErrorNegocio(HttpStatus.BAD_REQUEST, 'RECETA_REQUERIDA', `Venta bajo receta: ${conReceta.map((v) => v.producto).join(', ')}`);
          const archivada = conReceta.filter((v) => v.condicion_venta === 'receta_archivada');
          if (archivada.length && (!d.receta.retenida || !d.receta.pacienteDocumento))
            throw new ErrorNegocio(HttpStatus.BAD_REQUEST, 'RECETA_ARCHIVADA', `${archivada.map((v) => v.producto).join(', ')}: la receta queda retenida y se registra la cédula del paciente`);
          const hoyVenta = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(registradaOffline ?? new Date());
          if (d.receta.fecha > hoyVenta) throw invalido('La fecha de la receta es posterior a la venta');
        }
        const lista = await listaDeCliente(tx, d.clienteId);
        const precios = await preciosVigentes(tx, ids, caja.sucursal_id, lista);

        // Pedido que se entrega: rigen sus precios y sus descuentos (ya autorizados al tomarlo).
        let pedido: { id: string; numero: string } | null = null;
        const descuentoPedido = new Map<string, Decimal>(); // descuento por unidad
        if (d.pedidoId) {
          const p = await tx.selectFrom('pedido').select(['id', 'numero', 'estado', 'sucursal_id', 'cliente_id']).where('id', '=', d.pedidoId).where('tipo', '=', 'pedido').forUpdate().executeTakeFirst();
          if (!p) throw noEncontrado('Pedido');
          if (p.estado !== 'pendiente' && p.estado !== 'preparado') throw conflicto('PEDIDO_CERRADO', 'El pedido ya fue entregado o cancelado');
          if (p.sucursal_id !== caja.sucursal_id) throw invalido('El pedido es de otra sucursal');
          if (p.cliente_id && d.clienteId !== p.cliente_id) throw invalido('La venta debe ser al cliente del pedido');
          const its = await tx.selectFrom('pedido_item').select(['variante_id', 'cantidad', 'precio_unitario', 'descuento']).where('pedido_id', '=', p.id).execute();
          for (const it of its) {
            precios.set(it.variante_id, it.precio_unitario);
            if (Number(it.descuento) > 0) descuentoPedido.set(it.variante_id, new Decimal(it.descuento).div(it.cantidad));
          }
          pedido = p;
        }

        // Cuenta del salón: se cobra con los precios con que se cargó; entera o los ítems elegidos.
        let cuenta: { id: string; numero: string } | null = null;
        let itemsCuenta: string[] = [];
        if (d.cuentaId) {
          if (registradaOffline) throw invalido('Las cuentas del salón se cobran con conexión');
          if (d.pedidoId) throw invalido('Una venta no cobra un pedido y una cuenta a la vez');
          const cu = await tx.selectFrom('cuenta_salon').select(['id', 'numero', 'estado', 'sucursal_id']).where('id', '=', d.cuentaId).forUpdate().executeTakeFirst();
          if (!cu) throw noEncontrado('Cuenta');
          if (cu.estado !== 'abierta') throw conflicto('CUENTA_CERRADA', 'La cuenta ya está cerrada');
          if (cu.sucursal_id !== caja.sucursal_id) throw invalido('La cuenta es de otra sucursal');
          let q = tx.selectFrom('cuenta_salon_item').select(['id', 'variante_id', 'cantidad', 'precio_unitario', 'estado']).where('cuenta_id', '=', cu.id).where('venta_id', 'is', null).where('estado', '<>', 'anulado');
          if (d.cuentaItems) q = q.where('id', 'in', d.cuentaItems);
          const its = await q.forUpdate().execute();
          if (d.cuentaItems && its.length !== new Set(d.cuentaItems).size) throw conflicto('ITEM_COBRADO', 'Algún ítem ya se cobró o se anuló');
          if (!its.length) throw conflicto('CUENTA_SIN_SALDO', 'No hay nada pendiente de cobro en la cuenta');
          if (its.some((i) => i.estado === 'pendiente')) throw conflicto('ITEMS_SIN_ENVIAR', 'Hay productos sin enviar a cocina: envíelos o quítelos antes de cobrar');
          const porVar = new Map<string, { cantidad: Decimal; precio: string }>();
          for (const i of its) {
            const a = porVar.get(i.variante_id);
            if (a && new Decimal(a.precio).toFixed(2) !== new Decimal(i.precio_unitario).toFixed(2)) throw invalido('Un producto tiene dos precios en la cuenta: cóbrelos por separado');
            porVar.set(i.variante_id, { cantidad: (a?.cantidad ?? new Decimal(0)).plus(i.cantidad), precio: i.precio_unitario });
          }
          const enVenta = new Map<string, Decimal>();
          for (const i of d.items) enVenta.set(i.varianteId, (enVenta.get(i.varianteId) ?? new Decimal(0)).plus(i.cantidad));
          if (enVenta.size !== porVar.size || [...porVar].some(([v, x]) => !enVenta.get(v)?.eq(x.cantidad))) throw invalido('Los productos de la venta no coinciden con los de la cuenta');
          for (const [v, x] of porVar) precios.set(v, x.precio);
          cuenta = cu;
          itemsCuenta = its.map((i) => i.id);
        }
        if (d.propina && !d.cuentaId) throw invalido('La propina se registra al cobrar una cuenta del salón');

        // Sin conexión, la caja cobró con los precios que tenía: se respetan solo si el precio cambió
        // después de la venta (así no sirve para bajar precios a voluntad).
        const preciosOffline = new Map<string, string>();
        if (registradaOffline) {
          const distintos = d.items.filter((i) => i.precioUnitario !== undefined && new Decimal(i.precioUnitario).toFixed(2) !== new Decimal(precios.get(i.varianteId) ?? 0).toFixed(2));
          if (distintos.length) {
            const cambiados = new Set(
              (await tx.selectFrom('precio').select('variante_id').where('variante_id', 'in', distintos.map((i) => i.varianteId)).where('actualizado_en', '>', registradaOffline).execute()).map((x) => x.variante_id),
            );
            for (const i of distintos) if (cambiados.has(i.varianteId)) preciosOffline.set(i.varianteId, new Decimal(i.precioUnitario!).toFixed(2));
          }
          for (const [id, pr] of preciosOffline) precios.set(id, pr);
        }

        // Presentaciones (caja, rollo): la línea pasa a la unidad base; el precio es el de la presentación.
        const presIds = [...new Set(d.items.map((i) => i.presentacionId).filter((x): x is string => !!x))];
        const presentaciones = presIds.length ? await tx.selectFrom('presentacion').select(['id', 'variante_id', 'nombre', 'factor', 'precio']).where('id', 'in', presIds).where('activa', '=', true).execute() : [];
        const items = d.items.map((i) => {
          if (!i.presentacionId) return { ...i, presentacion: null as null | { nombre: string; cantidad: Decimal; precio: Decimal; listaPrecio: Decimal; factor: string } };
          const pr = presentaciones.find((x) => x.id === i.presentacionId && x.variante_id === i.varianteId);
          if (!pr) throw invalido('La presentación no existe o no es de ese producto');
          const listaPrecio = precioPresentacion(precios.get(i.varianteId) ?? 0, pr.factor, pr.precio);
          const precio = i.precioUnitario !== undefined ? new Decimal(i.precioUnitario) : listaPrecio;
          const base = lineaPresentacion(i.cantidad, pr.factor, precio);
          return { ...i, cantidad: base.cantidad.toNumber(), precioUnitario: undefined, presentacion: { nombre: pr.nombre, cantidad: new Decimal(i.cantidad), precio, listaPrecio, factor: pr.factor } };
        });

        // Cambios de precio y descuentos: permiso propio o PIN de supervisor.
        const cambiaPrecio = items.some((i) =>
          i.presentacion
            ? i.presentacion.precio.toFixed(2) !== i.presentacion.listaPrecio.toFixed(2)
            : i.precioUnitario !== undefined && new Decimal(i.precioUnitario).toFixed(2) !== new Decimal(precios.get(i.varianteId) ?? 0).toFixed(2),
        );
        // El descuento del pedido (proporcional a la cantidad) no vuelve a pedir autorización.
        const hayDescuento = items.some((i) => {
          const desc = new Decimal(i.descuento ?? 0);
          if (desc.lte(0)) return false;
          const permitido = (descuentoPedido.get(i.varianteId) ?? new Decimal(0)).mul(i.cantidad).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
          return desc.gt(permitido);
        });
        let autorizadoPor: string | null = null;
        if (cambiaPrecio && !tiene(ctx, 'precio.editar')) throw prohibido('No tiene permiso para cambiar precios');
        if (hayDescuento && !tiene(ctx, 'descuento.aprobar')) {
          autorizadoPor = await this.auth.verificarAutorizacion(ctx, autorizacion, 'descuento.aprobar');
          if (!autorizadoPor) throw prohibido('El descuento requiere autorización de un supervisor');
        }

        const lineas = items.map((i) => {
          const v = porId.get(i.varianteId)!;
          const precio = i.presentacion
            ? lineaPresentacion(1, i.presentacion.factor, i.presentacion.precio).precioUnitario
            : i.precioUnitario !== undefined && cambiaPrecio ? new Decimal(i.precioUnitario) : new Decimal(precios.get(i.varianteId) ?? 0);
          if (v.unidad === 'unidad' && !new Decimal(i.cantidad).isInteger()) throw invalido(`${v.producto} se vende por unidad entera`);
          return { ...i, v, precio, cantidad: new Decimal(i.cantidad).toDecimalPlaces(4) };
        });
        const calc = calcularItems(lineas.map((l) => ({ cantidad: l.cantidad, precioUnitario: l.precio, descuento: l.descuento ?? 0, tasaIva: Number(l.v.tasa_iva) as 0 | 5 | 10 })));
        const cot = aCotizaciones(await cotizacionesVigentes(tx, caja.sucursal_id));
        // Venta a crédito: la parte a crédito va a la cuenta del cliente; el resto se cobra en caja.
        const credito = interno ? calc.total : new Decimal(d.credito ?? 0).toDecimalPlaces(0);
        let creditoAutorizadoPor: string | null = null;
        let plazoCredito = 30;
        if (credito.gt(calc.total)) throw invalido('El crédito no puede superar el total de la venta');
        if (credito.gt(0) && interno) {
          if (!d.clienteId) throw invalido('El pedido no tiene un cliente registrado');
          const cl = await tx.selectFrom('cliente').select(['limite_credito', 'plazo_credito_dias']).where('id', '=', d.clienteId).executeTakeFirstOrThrow();
          plazoCredito = new Decimal(cl.limite_credito).gt(0) ? cl.plazo_credito_dias : 0;
        } else if (credito.gt(0)) {
          if (!d.clienteId) throw invalido('La venta a crédito necesita un cliente');
          const cl = await tx.selectFrom('cliente').select(['limite_credito', 'plazo_credito_dias']).where('id', '=', d.clienteId).forUpdate().executeTakeFirstOrThrow();
          plazoCredito = cl.plazo_credito_dias;
          const deuda = await saldoCliente(tx, d.clienteId);
          const disponible = Decimal.max(new Decimal(cl.limite_credito).minus(deuda), 0);
          if (credito.gt(disponible) && !tiene(ctx, 'credito_cliente.aprobar')) {
            creditoAutorizadoPor = await this.auth.verificarAutorizacion(ctx, autorizacion, 'credito_cliente.aprobar');
            if (!creditoAutorizadoPor) {
              throw new ErrorNegocio(HttpStatus.FORBIDDEN, 'CREDITO_EXCEDIDO', `El crédito supera lo disponible del cliente (${disponible.toFixed(0)}): requiere autorización de un supervisor`, { disponible: disponible.toFixed(2) });
            }
          }
        }
        const pagos = calcularPagos(calc.total.minus(credito), d.pagos, cot, d.vueltoMoneda);

        // Stock: filas existentes y bloqueadas en orden; validación según la configuración.
        const conStock = [...new Set(lineas.filter((l) => l.v.controla_stock).map((l) => l.varianteId))].sort();
        const saldo = new Map<string, Decimal>();
        let permiteStockNeg = false;
        if (conStock.length) {
          await tx
            .insertInto('stock')
            .values(conStock.map((variante_id) => ({ empresa_id: ctx.empresaId, variante_id, deposito_id: caja.deposito_id })))
            .onConflict((oc) => oc.columns(['empresa_id', 'variante_id', 'deposito_id']).doNothing())
            .execute();
          const filas = await tx
            .selectFrom('stock')
            .select(['variante_id', 'cantidad'])
            .where('deposito_id', '=', caja.deposito_id)
            .where('variante_id', 'in', conStock)
            .orderBy('variante_id')
            .forUpdate()
            .execute();
          for (const f of filas) saldo.set(f.variante_id, new Decimal(f.cantidad));
          const empresa = await tx.selectFrom('empresa').select('configuracion').executeTakeFirstOrThrow();
          permiteStockNeg = (empresa.configuracion as { permiteStockNegativo?: boolean }).permiteStockNegativo === true;
          // Lo vendido sin conexión ya salió del local: se registra aunque el stock quede negativo.
          if (!permiteStockNeg && !registradaOffline) {
            const pedido = new Map<string, Decimal>();
            for (const l of lineas.filter((x) => x.v.controla_stock)) pedido.set(l.varianteId, (pedido.get(l.varianteId) ?? new Decimal(0)).plus(l.cantidad));
            const faltantes = [...pedido].filter(([id, cant]) => saldo.get(id)!.lt(cant)).map(([id, cant]) => ({ varianteId: id, descripcion: porId.get(id)!.producto, disponible: saldo.get(id)!.toFixed(4), pedido: cant.toFixed(4) }));
            if (faltantes.length) throw new ErrorNegocio(HttpStatus.CONFLICT, 'STOCK_INSUFICIENTE', `Stock insuficiente: ${faltantes.map((x) => x.descripcion).join(', ')}`, faltantes);
          }
        }

        const numero = Number(caja.ultimo_numero) + 1;
        await tx.updateTable('caja').set({ ultimo_numero: numero }).where('id', '=', caja.id).execute();
        const vueltoPyg = pagos.vueltoPyg;
        const venta = await tx
          .insertInto('venta')
          .values({
            empresa_id: ctx.empresaId,
            sucursal_id: caja.sucursal_id,
            caja_id: caja.id,
            sesion_caja_id: sesion.id,
            numero,
            clave_idempotencia: d.claveIdempotencia,
            cliente_id: d.clienteId ?? null,
            lista_precio_id: lista,
            pedido_id: pedido?.id ?? null,
            cuenta_salon_id: cuenta?.id ?? null,
            subtotal: calc.subtotal.toFixed(2),
            descuento: calc.descuento.toFixed(2),
            total: calc.total.toFixed(2),
            gravado10: calc.gravado10.toFixed(2),
            gravado5: calc.gravado5.toFixed(2),
            exento: calc.exento.toFixed(2),
            iva10: calc.iva10.toFixed(2),
            iva5: calc.iva5.toFixed(2),
            vuelto: vueltoPyg.toFixed(2),
            vuelto_moneda: d.vueltoMoneda,
            credito: credito.toFixed(2),
            autorizado_por: autorizadoPor,
            registrada_offline_en: registradaOffline,
            creado_por: ctx.usuarioId,
            anulada_en: null,
            anulada_por: null,
            anulacion_autorizada_por: null,
            motivo_anulacion: null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        await tx
          .insertInto('venta_item')
          .values(
            lineas.map((l, i) => ({
              empresa_id: ctx.empresaId,
              venta_id: venta.id,
              linea: i + 1,
              variante_id: l.varianteId,
              descripcion: (l.v.nombre ? `${l.v.producto} · ${l.v.nombre}` : l.v.producto) + (l.presentacion ? ` · ${l.presentacion.nombre}` : ''),
              cantidad: l.cantidad.toFixed(4),
              precio_unitario: l.precio.toFixed(4),
              presentacion: l.presentacion ? `${l.presentacion.cantidad.toString()} × ${l.presentacion.nombre}` : null,
              descuento: calc.lineas[i]!.descuento.toFixed(2),
              total: calc.lineas[i]!.total.toFixed(2),
              tasa_iva: l.v.tasa_iva,
              costo_unitario: l.v.costo,
              condicion_venta: l.v.condicion_venta === 'libre' ? null : l.v.condicion_venta,
            })),
          )
          .execute();
        if (d.receta && conReceta.length) {
          const r = d.receta;
          await tx
            .insertInto('receta')
            .values({ empresa_id: ctx.empresaId, venta_id: venta.id, medico: r.medico, matricula: r.matricula, paciente: r.paciente, paciente_documento: r.pacienteDocumento ?? null, fecha: r.fecha, numero: r.numero ?? null, retenida: r.retenida, creado_por: ctx.usuarioId })
            .execute();
        }
        if (pagos.detalle.length)
          await tx
          .insertInto('venta_pago')
          .values(
            pagos.detalle.map((p, i) => ({
              empresa_id: ctx.empresaId,
              venta_id: venta.id,
              linea: i + 1,
              medio: p.medio,
              moneda: p.moneda,
              monto: p.monto.toFixed(2),
              cotizacion: p.cotizacion.toFixed(4),
              monto_pyg: p.montoPyg.toFixed(2),
              referencia: d.pagos[i]!.referencia ?? null,
            })),
          )
          .execute();

        for (const l of lineas.filter((x) => x.v.controla_stock)) {
          const nuevo = saldo.get(l.varianteId)!.minus(l.cantidad);
          saldo.set(l.varianteId, nuevo);
          await tx.insertInto('movimiento_stock').values({ empresa_id: ctx.empresaId, variante_id: l.varianteId, deposito_id: caja.deposito_id, tipo: 'venta', cantidad: l.cantidad.neg().toFixed(4), saldo: nuevo.toFixed(4), costo_unitario: l.v.costo, origen_id: venta.id, motivo: null, creado_por: ctx.usuarioId }).execute();
        }
        for (const id of conStock) {
          await tx.updateTable('stock').set({ cantidad: saldo.get(id)!.toFixed(4), actualizado_en: new Date() }).where('variante_id', '=', id).where('deposito_id', '=', caja.deposito_id).execute();
        }
        // Lotes: sale primero lo que vence antes; un lote vencido no se vende (salvo venta sin conexión ya hecha).
        await moverLotes(
          tx,
          ctx,
          caja.deposito_id,
          lineas.filter((x) => x.v.controla_stock).map((l) => ({ varianteId: l.varianteId, cantidad: l.cantidad.neg(), tipo: 'venta' as const, origenId: venta.id })),
          !permiteStockNeg && !registradaOffline,
        );

        // Vales de cambio: se descuenta su saldo; no entran a la caja.
        const usosVale = pagos.detalle.flatMap((p, i) => (p.medio === 'vale' ? [{ codigo: d.pagos[i]!.referencia!.trim().toUpperCase(), monto: p.montoPyg }] : []));
        if (usosVale.length) await usarVales(tx, ctx, venta.id, usosVale);
        const movCaja = [
          ...pagos.detalle.flatMap((p) => (p.medio === 'vale' ? [] : [{ tipo: 'venta' as const, medio: p.medio, moneda: p.moneda, monto: p.monto }])),
          ...pagos.vuelto.map((v) => ({ tipo: 'vuelto' as const, medio: 'efectivo' as const, moneda: v.moneda, monto: v.monto.neg() })),
        ];
        if (movCaja.length)
          await tx
          .insertInto('movimiento_caja')
          .values(movCaja.map((m) => ({ empresa_id: ctx.empresaId, sesion_id: sesion.id, tipo: m.tipo, medio: m.medio, moneda: m.moneda, monto: m.monto.toFixed(2), venta_id: venta.id, motivo: null, autorizado_por: null, creado_por: ctx.usuarioId })))
          .execute();

        // Factura electrónica: con la configuración activa y la caja con punto de expedición.
        const fe = caja.punto_expedicion ? await cargarFe(tx) : null;
        if (credito.gt(0)) {
          const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
          const vence = new Date(`${fecha}T12:00:00Z`);
          vence.setUTCDate(vence.getUTCDate() + plazoCredito);
          await tx
            .insertInto('cuenta_cobrar')
            .values({ empresa_id: ctx.empresaId, cliente_id: d.clienteId!, venta_id: venta.id, sucursal_id: caja.sucursal_id, descripcion: `Venta N.º ${numero} (${caja.nombre})${interno ? ` · reparto N.º ${interno.reparto}` : ''}`, fecha, vencimiento: vence.toISOString().slice(0, 10), monto: credito.toFixed(2), saldo: credito.toFixed(2), autorizado_por: creditoAutorizadoPor, creado_por: ctx.usuarioId })
            .execute();
        }
        if (fe) await emitirFactura(tx, ctx, fe, venta.id);

        await auditar(tx, { ...ctx, ...o }, {
          accion: 'venta',
          entidad: 'venta',
          entidadId: venta.id,
          autorizadoPor,
          despues: {
            numero,
            caja: caja.nombre,
            total: calc.total.toFixed(0),
            items: lineas.length,
            descuento: calc.descuento.toFixed(0),
            ...(pedido && { pedido: Number(pedido.numero) }),
            ...(registradaOffline && { sinConexion: registradaOffline.toISOString(), ...(preciosOffline.size && { preciosAnteriores: Object.fromEntries(preciosOffline) }) }),
          },
        });
        if (pedido) {
          await tx.updateTable('pedido').set({ estado: 'entregado', venta_id: venta.id, cerrado_por: ctx.usuarioId, cerrado_en: new Date() }).where('id', '=', pedido.id).execute();
          await auditar(tx, { ...ctx, ...o }, { accion: 'entregado', entidad: 'pedido', entidadId: pedido.id, despues: { ventaId: venta.id, venta: numero } });
        }
        if (cuenta) {
          await tx.updateTable('cuenta_salon_item').set({ venta_id: venta.id }).where('id', 'in', itemsCuenta).execute();
          // Propina: entra a la caja aparte de la venta (no es ingreso del local; se reparte al personal).
          if (d.propina) {
            const monto = new Decimal(d.propina.monto).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
            await tx
              .insertInto('movimiento_caja')
              .values({ empresa_id: ctx.empresaId, sesion_id: sesion.id, tipo: 'ingreso', medio: d.propina.medio, moneda: 'PYG', monto: monto.toFixed(2), venta_id: venta.id, motivo: `Propina · cuenta N.º ${Number(cuenta.numero)}`, autorizado_por: null, creado_por: ctx.usuarioId })
              .execute();
            await tx.updateTable('cuenta_salon').set({ propina: sql`propina + ${monto.toFixed(2)}::numeric` }).where('id', '=', cuenta.id).execute();
          }
          await cerrarSiPagada(tx, cuenta.id);
          await auditar(tx, { ...ctx, ...o }, { accion: 'cobro', entidad: 'cuenta_salon', entidadId: cuenta.id, despues: { ventaId: venta.id, venta: numero, items: itemsCuenta.length, propina: d.propina?.monto ?? 0 } });
        }
        return (await leerVenta(tx, venta.id))!;
      });
    } catch (e) {
      if (e instanceof ErrorCalculo) throw new ErrorNegocio(HttpStatus.BAD_REQUEST, e.codigo, e.message);
      // Dos peticiones con la misma clave en paralelo: la segunda choca con el índice único → devolver la primera.
      if ((e as { code?: string; constraint?: string }).code === '23505' && (e as { constraint?: string }).constraint === 'venta_empresa_id_clave_idempotencia_key') {
        return this.db.enEmpresa(ctx.empresaId, async (tx) => {
          const v = await tx.selectFrom('venta').select('id').where('clave_idempotencia', '=', d.claveIdempotencia).executeTakeFirstOrThrow();
          return (await leerVenta(tx, v.id))!;
        });
      }
      throw e;
    }
  }

  @Requiere('venta', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(
      z.object({
        desde: z.coerce.date().optional(),
        hasta: z.coerce.date().optional(),
        cajaId: z.string().uuid().optional(),
        sesionId: z.string().uuid().optional(),
        estado: z.enum(['confirmada', 'anulada']).optional(),
        cursor: z.string().uuid().optional(),
        limite: z.coerce.number().int().min(1).max(200).default(50),
      }),
      query,
    );
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let q = tx
        .selectFrom('venta as v')
        .innerJoin('caja as c', 'c.id', 'v.caja_id')
        .innerJoin('usuario as u', 'u.id', 'v.creado_por')
        .leftJoin('cliente as cl', 'cl.id', 'v.cliente_id')
        .select(['v.id', 'v.numero', 'v.creado_en', 'v.total', 'v.estado', 'v.sucursal_id', 'v.creado_por', 'v.registrada_offline_en', 'c.nombre as caja', 'u.nombre as vendedor', 'cl.nombre as cliente'])
        .orderBy('v.id', 'desc')
        .limit(f.limite + 1);
      if (ctx.alcance === 'propia') q = q.where('v.creado_por', '=', ctx.usuarioId);
      else if (ctx.alcance === 'sucursal' && !ctx.esPropietario) q = q.where('v.sucursal_id', 'in', ctx.sucursalIds.length ? [...ctx.sucursalIds] : ['00000000-0000-0000-0000-000000000000']);
      if (f.desde) q = q.where('v.creado_en', '>=', f.desde);
      if (f.hasta) q = q.where('v.creado_en', '<=', f.hasta);
      if (f.cajaId) q = q.where('v.caja_id', '=', f.cajaId);
      if (f.sesionId) q = q.where('v.sesion_caja_id', '=', f.sesionId);
      if (f.estado) q = q.where('v.estado', '=', f.estado);
      if (f.cursor) q = q.where('v.id', '<', f.cursor);
      const filas = await q.execute();
      const pagina = filas.slice(0, f.limite);
      return {
        items: pagina.map((v) => ({ id: v.id, numero: Number(v.numero), fecha: v.creado_en, total: v.total, estado: v.estado, caja: v.caja, vendedor: v.vendedor, cliente: v.cliente, sinConexion: v.registrada_offline_en })),
        siguiente: filas.length > f.limite ? pagina[pagina.length - 1]!.id : null,
      };
    });
  }

  @Requiere('venta', 'ver')
  @Get(':id')
  ver(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const v = await leerVenta(tx, id);
      if (!v || !this.enAlcance(ctx, v)) throw noEncontrado('Venta');
      return v;
    });
  }

  private enAlcance(ctx: Ctx, v: VentaDto) {
    if (ctx.alcance === 'propia') return v.vendedor.id === ctx.usuarioId;
    return enSucursal(ctx, v.sucursal.id);
  }

  /**
   * Anulación en la misma sesión de caja: devuelve el stock y registra la salida de dinero.
   * Requiere venta.cancelar o el PIN de un supervisor (X-Autorizacion).
   */
  @Requiere('venta', 'crear')
  @Post(':id/anular')
  @HttpCode(200)
  async anular(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Headers('x-autorizacion') autorizacion: string | undefined, @OrigenPeticion() o: Origen) {
    const d = validar(anularVentaEntrada, body);
    // Con factura electrónica aprobada: primero el evento de cancelación en SIFEN (fuera de la transacción).
    const previo = await this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const v = await tx.selectFrom('venta').select(['estado', 'sucursal_id', 'sesion_caja_id']).where('id', '=', id).executeTakeFirst();
      if (!v) throw noEncontrado('Venta');
      exigirSucursal(ctx, v.sucursal_id, 'Venta');
      const de = await tx.selectFrom('documento_electronico').select(['id', 'cdc', 'estado', 'procesado_en']).where('venta_id', '=', id).where('tipo_documento', '=', 1).executeTakeFirst();
      if (!de || de.estado === 'rechazado' || de.estado === 'cancelado' || v.estado === 'anulada') return null;
      if (!tiene(ctx, 'venta.cancelar') && !(await this.auth.verificarAutorizacion(ctx, autorizacion, 'venta.cancelar'))) return null; // el error sale abajo
      const sesion = await tx.selectFrom('sesion_caja').select(['estado']).where('id', '=', v.sesion_caja_id).executeTakeFirstOrThrow();
      if (sesion.estado !== 'abierta') return null;
      if (de.estado === 'pendiente' || de.estado === 'enviado') throw conflicto('FE_EN_PROCESO', 'La factura electrónica todavía está en proceso en SIFEN: intente anular en unos minutos');
      if (de.procesado_en && Date.now() - de.procesado_en.getTime() > 48 * 3600_000) throw conflicto('FE_PLAZO_VENCIDO', 'Pasaron más de 48 horas desde la aprobación de la factura: corresponde una devolución con nota de crédito');
      const fe = await cargarFe(tx, true);
      const emp = await tx.selectFrom('empresa').select(['ruc', 'razon_social']).executeTakeFirstOrThrow();
      if (!fe || !emp.ruc) throw conflicto('FE_SIN_CONFIGURACION', 'Falta la configuración de facturación electrónica para cancelar la factura');
      return { de, fe, emp: { ruc: emp.ruc, razonSocial: emp.razon_social } };
    });
    let cancelacion: { id: string; protocolo: string | null } | null = null;
    if (previo) {
      const motivo = d.motivo.length >= 5 ? d.motivo : `${d.motivo} (anulación)`;
      let r: Awaited<ReturnType<typeof cancelarEnSifen>>;
      try {
        r = await cancelarEnSifen(previo.fe, previo.emp, previo.de.cdc, motivo);
      } catch (e) {
        throw conflicto('SIFEN_SIN_CONEXION', `No se pudo cancelar la factura en SIFEN: ${(e as Error).message}`);
      }
      if (r.estado !== 'Aprobado') throw conflicto('CANCELACION_RECHAZADA', `SIFEN no aceptó la cancelación: ${r.mensajes.map((m) => `${m.codigo} ${m.mensaje}`).join(' · ')}`);
      cancelacion = { id: previo.de.id, protocolo: r.protocolo };
    }
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const v = await tx.selectFrom('venta').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!v) throw noEncontrado('Venta');
      exigirSucursal(ctx, v.sucursal_id, 'Venta');
      let autorizadaPor: string | null = null;
      if (!tiene(ctx, 'venta.cancelar')) {
        autorizadaPor = await this.auth.verificarAutorizacion(ctx, autorizacion, 'venta.cancelar');
        if (!autorizadaPor) throw prohibido('Anular una venta requiere autorización de un supervisor');
      }
      if (v.estado === 'anulada') throw conflicto('YA_ANULADA', 'La venta ya está anulada');
      const sesion = await tx.selectFrom('sesion_caja').select(['estado']).where('id', '=', v.sesion_caja_id).executeTakeFirstOrThrow();
      if (sesion.estado !== 'abierta') throw conflicto('SESION_CERRADA', 'La caja de esta venta ya se cerró: corresponde una devolución');

      const caja = await obtenerCaja(tx, ctx, v.caja_id);
      const items = await tx
        .selectFrom('venta_item as i')
        .innerJoin('variante as va', 'va.id', 'i.variante_id')
        .innerJoin('producto as p', 'p.id', 'va.producto_id')
        .select(['i.variante_id', 'i.cantidad', 'i.costo_unitario', 'p.controla_stock'])
        .where('i.venta_id', '=', id)
        .orderBy('i.variante_id')
        .execute();
      const conStock = items.filter((i) => i.controla_stock);
      if (conStock.length) {
        const ids = [...new Set(conStock.map((i) => i.variante_id))].sort();
        const filas = await tx.selectFrom('stock').select(['variante_id', 'cantidad']).where('deposito_id', '=', caja.deposito_id).where('variante_id', 'in', ids).orderBy('variante_id').forUpdate().execute();
        const saldo = new Map(filas.map((f) => [f.variante_id, new Decimal(f.cantidad)]));
        for (const it of conStock) {
          const nuevo = saldo.get(it.variante_id)!.plus(it.cantidad);
          saldo.set(it.variante_id, nuevo);
          await tx.insertInto('movimiento_stock').values({ empresa_id: ctx.empresaId, variante_id: it.variante_id, deposito_id: caja.deposito_id, tipo: 'anulacion_venta', cantidad: new Decimal(it.cantidad).toFixed(4), saldo: nuevo.toFixed(4), costo_unitario: it.costo_unitario, origen_id: id, motivo: d.motivo, creado_por: ctx.usuarioId }).execute();
        }
        for (const [vid, cant] of saldo) await tx.updateTable('stock').set({ cantidad: cant.toFixed(4), actualizado_en: new Date() }).where('variante_id', '=', vid).where('deposito_id', '=', caja.deposito_id).execute();
        // Vuelve a los mismos lotes de los que salió.
        await moverLotes(tx, ctx, caja.deposito_id, conStock.map((it) => ({ varianteId: it.variante_id, cantidad: new Decimal(it.cantidad), tipo: 'anulacion_venta' as const, origenId: id, deOrigen: { origenIds: [id], tipos: ['venta'] } })), false);
      }

      // Contrapartida exacta de lo que entró (pagos) y salió (vuelto) en caja por esta venta.
      const movs = await tx.selectFrom('movimiento_caja').select(['medio', 'moneda', 'monto']).where('venta_id', '=', id).where('tipo', 'in', ['venta', 'vuelto']).execute();
      // La parte a crédito: la cuenta del cliente se anula si todavía no tiene cobros.
      const cc = await tx.selectFrom('cuenta_cobrar').select(['id', 'monto', 'saldo', 'estado']).where('venta_id', '=', id).forUpdate().executeTakeFirst();
      if (cc && cc.estado !== 'anulada') {
        if (!new Decimal(cc.saldo).eq(cc.monto)) throw conflicto('VENTA_CON_COBROS', 'La venta a crédito ya tiene cobros: anule primero los cobros');
        await tx.updateTable('cuenta_cobrar').set({ estado: 'anulada', saldo: '0' }).where('id', '=', cc.id).execute();
      }
      await reintegrarVales(tx, ctx, id);
      if (movs.length)
        await tx
        .insertInto('movimiento_caja')
        .values(movs.map((m) => ({ empresa_id: ctx.empresaId, sesion_id: v.sesion_caja_id, tipo: 'anulacion' as const, medio: m.medio, moneda: m.moneda, monto: new Decimal(m.monto).neg().toFixed(2), venta_id: id, motivo: d.motivo, autorizado_por: autorizadaPor, creado_por: ctx.usuarioId })))
        .execute();
      await tx.updateTable('venta').set({ estado: 'anulada', anulada_en: new Date(), anulada_por: ctx.usuarioId, anulacion_autorizada_por: autorizadaPor, motivo_anulacion: d.motivo }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'anular_venta', entidad: 'venta', entidadId: id, autorizadoPor: autorizadaPor, despues: { numero: Number(v.numero), total: v.total, motivo: d.motivo } });
      if (cancelacion) {
        await tx
          .updateTable('documento_electronico')
          .set({ estado: 'cancelado', cancelado_en: new Date(), cancelado_por: ctx.usuarioId, motivo_cancelacion: d.motivo, respuesta_mensaje: `Cancelación aprobada${cancelacion.protocolo ? ` · protocolo ${cancelacion.protocolo}` : ''}` })
          .where('id', '=', cancelacion.id)
          .execute();
        await auditar(tx, { ...ctx, ...o }, { accion: 'cancelar', entidad: 'documento_electronico', entidadId: cancelacion.id, despues: { motivo: d.motivo, protocolo: cancelacion.protocolo } });
      }
      // Los ítems de la cuenta cobrados con esta venta vuelven a quedar por cobrar; la cuenta se reabre.
      const cuentaVenta = await tx.selectFrom('venta').select('cuenta_salon_id').where('id', '=', id).executeTakeFirstOrThrow();
      if (cuentaVenta.cuenta_salon_id) {
        await tx.updateTable('cuenta_salon_item').set({ venta_id: null }).where('venta_id', '=', id).execute();
        await tx.updateTable('cuenta_salon').set({ estado: 'abierta', cerrada_en: null }).where('id', '=', cuentaVenta.cuenta_salon_id).where('estado', '=', 'cerrada').execute();
        await auditar(tx, { ...ctx, ...o }, { accion: 'reabrir', entidad: 'cuenta_salon', entidadId: cuentaVenta.cuenta_salon_id, despues: { motivo: `Venta N.º ${Number(v.numero)} anulada` } });
      }
      // El pedido entregado con esta venta vuelve a quedar pendiente.
      if (v.pedido_id) {
        await tx.updateTable('pedido').set({ estado: 'pendiente', venta_id: null, cerrado_por: null, cerrado_en: null }).where('id', '=', v.pedido_id).execute();
        await auditar(tx, { ...ctx, ...o }, { accion: 'pendiente', entidad: 'pedido', entidadId: v.pedido_id, despues: { motivo: `Venta N.º ${Number(v.numero)} anulada` } });
      }
      return (await leerVenta(tx, id))!;
    });
  }
}
