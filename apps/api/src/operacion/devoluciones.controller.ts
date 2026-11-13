import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { devolucionEntrada } from '@kontiva/shared';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { enSucursal } from '../comun/alcance';
import { auditar } from '../comun/auditoria';
import { Contexto, OrigenPeticion, tiene, type Ctx, type Origen } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { conflicto, invalido, noEncontrado, prohibido } from '../comun/errores';
import { moverStock, siguienteNumero } from '../comun/stock';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';
import { esperado, obtenerCaja, sesionAbierta } from './cajas.controller';
import QRCode from 'qrcode';
import { cargarFe, emitirNotaCredito, numeroComprobante } from '../sifen/emision';

/** Cantidad ya devuelta por línea de una venta. */
export async function devueltoPorLinea(tx: Tx, ventaId: string) {
  const filas = await tx
    .selectFrom('devolucion_item as i')
    .innerJoin('devolucion as d', (j) => j.onRef('d.id', '=', 'i.devolucion_id'))
    .select(['i.linea_venta', (eb) => eb.fn.sum<string>('i.cantidad').as('cantidad'), (eb) => eb.fn.sum<string>('i.total').as('total')])
    .where('d.venta_id', '=', ventaId)
    .groupBy('i.linea_venta')
    .execute();
  return new Map(filas.map((f) => [f.linea_venta, { cantidad: new Decimal(f.cantidad), total: new Decimal(f.total) }]));
}

export async function leerDevolucion(tx: Tx, id: string) {
  const d = await tx
    .selectFrom('devolucion as d')
    .innerJoin('venta as v', 'v.id', 'd.venta_id')
    .innerJoin('usuario as u', 'u.id', 'd.creado_por')
    .leftJoin('usuario as a', 'a.id', 'd.autorizado_por')
    .select(['d.id', 'd.numero', 'd.venta_id', 'v.numero as venta_numero', 'v.sucursal_id', 'd.medio', 'd.total', 'd.motivo', 'd.creado_en', 'u.nombre as usuario', 'a.nombre as autorizado_por'])
    .where('d.id', '=', id)
    .executeTakeFirst();
  if (!d) return null;
  const items = await tx
    .selectFrom('devolucion_item as i')
    .innerJoin('venta_item as vi', (j) => j.on('vi.venta_id', '=', d.venta_id).onRef('vi.linea', '=', 'i.linea_venta'))
    .select(['i.linea_venta', 'vi.descripcion', 'i.cantidad', 'i.total'])
    .where('i.devolucion_id', '=', id)
    .orderBy('i.linea_venta')
    .execute();
  const nc = await tx
    .selectFrom('documento_electronico as n')
    .leftJoin('documento_electronico as f', 'f.id', 'n.documento_asociado_id')
    .select(['n.id', 'n.cdc', 'n.establecimiento', 'n.punto', 'n.numero', 'n.timbrado', 'n.estado', 'n.qr_url', 'n.ambiente', 'n.total_iva', 'n.respuesta_mensaje', 'n.receptor_nombre', 'n.receptor_documento', 'f.cdc as f_cdc', 'f.establecimiento as f_est', 'f.punto as f_punto', 'f.numero as f_numero'])
    .where('n.devolucion_id', '=', id)
    .executeTakeFirst();
  const feConf = nc ? await tx.selectFrom('fe_configuracion').select('timbrado_fecha').executeTakeFirst() : undefined;
  const aplicado = await tx.selectFrom('cobro_aplicacion').select((eb) => eb.fn.sum<string>('monto').as('m')).where('devolucion_id', '=', id).executeTakeFirst();
  return {
    id: d.id,
    numero: Number(d.numero),
    notaCredito: nc
      ? {
          id: nc.id,
          cdc: nc.cdc,
          numero: numeroComprobante(nc),
          timbrado: nc.timbrado,
          timbradoInicio: feConf?.timbrado_fecha ?? null,
          estado: nc.estado,
          qr: nc.qr_url,
          qrImagen: `data:image/svg+xml;base64,${Buffer.from(await QRCode.toString(nc.qr_url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })).toString('base64')}`,
          ambiente: nc.ambiente,
          totalIva: nc.total_iva,
          mensaje: nc.respuesta_mensaje,
          receptor: nc.receptor_nombre,
          receptorDocumento: nc.receptor_documento,
          factura: nc.f_cdc ? { cdc: nc.f_cdc, numero: numeroComprobante({ establecimiento: nc.f_est!, punto: nc.f_punto!, numero: nc.f_numero! }) } : null,
        }
      : null,
    venta: { id: d.venta_id, numero: Number(d.venta_numero) },
    sucursalId: d.sucursal_id,
    medio: d.medio,
    total: d.total,
    descontadoDeuda: new Decimal(aplicado?.m ?? 0).toFixed(2),
    reintegrado: new Decimal(d.total).minus(aplicado?.m ?? 0).toFixed(2),
    motivo: d.motivo,
    fecha: d.creado_en,
    usuario: d.usuario,
    autorizadoPor: d.autorizado_por,
    items: items.map((i) => ({ linea: i.linea_venta, descripcion: i.descripcion, cantidad: i.cantidad, total: i.total })),
  };
}

@Controller('devoluciones')
export class DevolucionesController {
  constructor(
    private readonly db: Db,
    private readonly auth: AuthService,
  ) {}

  @Requiere('venta', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ ventaId: z.string().uuid().optional() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let q = tx.selectFrom('devolucion').select('id').orderBy('numero', 'desc').limit(200);
      if (f.ventaId) q = q.where('venta_id', '=', f.ventaId);
      const todas = await Promise.all((await q.execute()).map((r) => leerDevolucion(tx, r.id)));
      return todas.filter((d) => d && enSucursal(ctx, d.sucursalId));
    });
  }

  @Requiere('venta', 'ver')
  @Get(':id')
  ver(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const d = await leerDevolucion(tx, id);
      if (!d || !enSucursal(ctx, d.sucursalId)) throw noEncontrado('Devolución');
      return d;
    });
  }

  /**
   * Devolución parcial o total de una venta (de esta caja o de una ya cerrada).
   * El dinero sale de la caja abierta de quien atiende y la mercadería vuelve al depósito de esa caja.
   * Requiere devolucion.crear o el PIN de un supervisor (devolucion.aprobar).
   */
  @Requiere('venta', 'crear')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @Headers('x-autorizacion') autorizacion: string | undefined, @OrigenPeticion() o: Origen) {
    const d = validar(devolucionEntrada, body);
    if (new Set(d.items.map((i) => i.linea)).size !== d.items.length) throw invalido('Hay líneas repetidas');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let autorizadoPor: string | null = null;
      if (!tiene(ctx, 'devolucion.crear')) {
        autorizadoPor = await this.auth.verificarAutorizacion(ctx, autorizacion, 'devolucion.aprobar');
        if (!autorizadoPor) throw prohibido('La devolución requiere autorización de un supervisor');
      }
      const venta = await tx.selectFrom('venta').select(['id', 'numero', 'estado', 'sucursal_id', 'comprobante']).where('id', '=', d.ventaId).forUpdate().executeTakeFirst();
      if (!venta || !enSucursal(ctx, venta.sucursal_id)) throw noEncontrado('Venta');
      if (venta.estado === 'anulada') throw conflicto('VENTA_ANULADA', 'La venta está anulada: no hay nada que devolver');

      const caja = await obtenerCaja(tx, ctx, d.cajaId, true);
      // Venta con factura electrónica: la devolución emite una nota de crédito electrónica asociada.
      let fiscal: { fe: NonNullable<Awaited<ReturnType<typeof cargarFe>>>; factura: { id: string; cdc: string }; punto: string } | null = null;
      if (venta.comprobante === 'factura') {
        const factura = await tx.selectFrom('documento_electronico').select(['id', 'cdc', 'estado']).where('venta_id', '=', venta.id).where('tipo_documento', '=', 1).executeTakeFirstOrThrow();
        if (factura.estado === 'pendiente' || factura.estado === 'enviado') throw conflicto('FE_EN_PROCESO', 'La factura electrónica de la venta todavía está en proceso en SIFEN: intente en unos minutos');
        if (factura.estado === 'rechazado') throw conflicto('FACTURA_RECHAZADA', 'SIFEN rechazó la factura de esta venta: corríjala y reenvíela antes de registrar la devolución');
        if (factura.estado === 'cancelado') throw conflicto('FACTURA_CANCELADA', 'La factura de esta venta está cancelada');
        if (!caja.punto_expedicion) throw conflicto('CAJA_SIN_PUNTO', 'La devolución emite nota de crédito electrónica: asigne un punto de expedición a esta caja en Facturación electrónica');
        const fe = await cargarFe(tx, true);
        if (!fe) throw conflicto('FE_SIN_CONFIGURACION', 'Falta la configuración de facturación electrónica para emitir la nota de crédito');
        fiscal = { fe, factura, punto: caja.punto_expedicion };
      }
      const sesion = await sesionAbierta(tx, caja.id);
      if (!sesion || sesion.usuario_id !== ctx.usuarioId) throw conflicto('CAJA_CERRADA', 'Abra su caja para registrar la devolución');

      const lineas = await tx.selectFrom('venta_item').selectAll().where('venta_id', '=', venta.id).execute();
      const previo = await devueltoPorLinea(tx, venta.id);
      const productos = await tx.selectFrom('variante as v').innerJoin('producto as p', 'p.id', 'v.producto_id').select(['v.id', 'p.controla_stock']).where('v.id', 'in', lineas.map((l) => l.variante_id)).execute();
      const controla = new Map(productos.map((p) => [p.id, p.controla_stock]));

      const detalle = d.items.map((i) => {
        const l = lineas.find((x) => x.linea === i.linea);
        if (!l) throw invalido(`La venta no tiene la línea ${i.linea}`);
        const vendido = new Decimal(l.cantidad);
        const ya = previo.get(i.linea) ?? { cantidad: new Decimal(0), total: new Decimal(0) };
        const disponible = vendido.minus(ya.cantidad);
        const cant = new Decimal(i.cantidad).toDecimalPlaces(4);
        if (cant.gt(disponible)) throw invalido(`${l.descripcion}: se pueden devolver como máximo ${disponible.toString()}`);
        // Proporcional al total de la línea (con su descuento). Si se devuelve todo lo que queda,
        // se reintegra exactamente lo que falta: sin restos de redondeo.
        const total = cant.eq(disponible)
          ? new Decimal(l.total).minus(ya.total)
          : new Decimal(l.total).mul(cant).div(vendido).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
        return { linea: i.linea, varianteId: l.variante_id, cantidad: cant, total, costo: l.costo_unitario };
      });
      const total = detalle.reduce((a, x) => a.plus(x.total), new Decimal(0));

      // Venta a crédito con deuda pendiente: la devolución primero descuenta de la deuda; solo el resto se reintegra.
      const cuenta = await tx.selectFrom('cuenta_cobrar').select(['id', 'saldo']).where('venta_id', '=', venta.id).where('estado', 'in', ['pendiente', 'parcial']).forUpdate().executeTakeFirst();
      const aCuenta = cuenta ? Decimal.min(new Decimal(cuenta.saldo), total) : new Decimal(0);
      const reintegro = total.minus(aCuenta);
      if (d.medio === 'efectivo' && reintegro.gt(0)) {
        const caja_ = (await esperado(tx, sesion.id)).find((e) => e.moneda === 'PYG' && e.medio === 'efectivo');
        if (new Decimal(caja_?.monto ?? 0).lt(reintegro)) throw conflicto('SALDO_INSUFICIENTE', 'No hay suficiente efectivo en la caja para reintegrar');
      }

      const numero = await siguienteNumero(tx, 'devolucion');
      const dev = await tx
        .insertInto('devolucion')
        .values({ empresa_id: ctx.empresaId, numero, venta_id: venta.id, sesion_caja_id: sesion.id, deposito_id: caja.deposito_id, medio: d.medio, total: total.toFixed(2), motivo: d.motivo, autorizado_por: autorizadoPor, creado_por: ctx.usuarioId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('devolucion_item')
        .values(detalle.map((x) => ({ empresa_id: ctx.empresaId, devolucion_id: dev.id, linea_venta: x.linea, variante_id: x.varianteId, cantidad: x.cantidad.toFixed(4), total: x.total.toFixed(2) })))
        .execute();
      await moverStock(
        tx,
        ctx,
        caja.deposito_id,
        detalle.filter((x) => controla.get(x.varianteId)).map((x) => ({ varianteId: x.varianteId, cantidad: x.cantidad, tipo: 'devolucion' as const, origenId: dev.id, motivo: d.motivo, costo: x.costo })),
        false,
      );
      if (cuenta && aCuenta.gt(0)) {
        const nuevo = new Decimal(cuenta.saldo).minus(aCuenta);
        await tx.insertInto('cobro_aplicacion').values({ empresa_id: ctx.empresaId, cobro_id: null, devolucion_id: dev.id, cuenta_cobrar_id: cuenta.id, monto: aCuenta.toFixed(2) }).execute();
        await tx.updateTable('cuenta_cobrar').set({ saldo: nuevo.toFixed(2), estado: nuevo.isZero() ? 'cobrada' : 'parcial' }).where('id', '=', cuenta.id).execute();
      }
      if (reintegro.gt(0)) {
        await tx
          .insertInto('movimiento_caja')
          .values({ empresa_id: ctx.empresaId, sesion_id: sesion.id, tipo: 'devolucion', medio: d.medio, moneda: 'PYG', monto: reintegro.neg().toFixed(2), venta_id: venta.id, motivo: d.motivo, autorizado_por: autorizadoPor, creado_por: ctx.usuarioId })
          .execute();
      }
      if (fiscal) {
        await emitirNotaCredito(tx, ctx, fiscal.fe, {
          devolucionId: dev.id,
          ventaId: venta.id,
          facturaId: fiscal.factura.id,
          facturaCdc: fiscal.factura.cdc,
          sucursalId: caja.sucursal_id,
          punto: fiscal.punto,
          total,
          lineas: detalle.map((x) => ({ linea: x.linea, cantidad: x.cantidad, total: x.total })),
        });
      }
      await auditar(tx, { ...ctx, ...o }, { accion: 'devolucion', entidad: 'venta', entidadId: venta.id, autorizadoPor, despues: { numero, venta: Number(venta.numero), total: total.toFixed(0), motivo: d.motivo, notaCredito: !!fiscal } });
      return (await leerDevolucion(tx, dev.id))!;
    });
  }
}
