import Decimal from 'decimal.js';

/**
 * Cálculo de una venta. Lo usan la API (fuente de verdad) y el PDV (vista previa):
 * el servidor siempre recalcula y nunca acepta el total del navegador.
 *
 * Paraguay: precios con IVA incluido. Base gravada 10 % → IVA = total / 11; 5 % → total / 21.
 * Guaraníes sin decimales.
 */

export type Moneda = 'PYG' | 'USD' | 'BRL';
export type Medio = 'efectivo' | 'tarjeta' | 'transferencia' | 'otro';
export const MONEDAS: readonly Moneda[] = ['PYG', 'USD', 'BRL'];
export const MEDIOS: readonly Medio[] = ['efectivo', 'tarjeta', 'transferencia', 'otro'];

export interface ItemCalculo {
  cantidad: Decimal.Value;
  precioUnitario: Decimal.Value; // guaraníes, IVA incluido
  descuento?: Decimal.Value; // guaraníes, sobre el total de la línea
  tasaIva: 0 | 5 | 10;
}

export interface PagoCalculo {
  medio: Medio | 'vale';
  moneda: Moneda;
  monto: Decimal.Value; // en su moneda
}

/** Guaraníes por unidad: compra = cuando el cliente paga en esa moneda; venta = vuelto en esa moneda. */
export type Cotizaciones = Partial<Record<'USD' | 'BRL', { compra: Decimal.Value; venta: Decimal.Value }>>;

const gs = (v: Decimal.Value) => new Decimal(v).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

export class ErrorCalculo extends Error {
  constructor(
    public codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

export function calcularItems(items: readonly ItemCalculo[]) {
  let subtotal = new Decimal(0);
  let descuento = new Decimal(0);
  let gravado10 = new Decimal(0);
  let gravado5 = new Decimal(0);
  let exento = new Decimal(0);
  const lineas = items.map((it) => {
    const cantidad = new Decimal(it.cantidad);
    if (cantidad.lte(0)) throw new ErrorCalculo('CANTIDAD_INVALIDA', 'La cantidad debe ser mayor a cero');
    const bruto = gs(cantidad.mul(it.precioUnitario));
    const desc = gs(it.descuento ?? 0);
    if (desc.gt(bruto)) throw new ErrorCalculo('DESCUENTO_INVALIDO', 'El descuento no puede superar el total de la línea');
    const total = bruto.minus(desc);
    subtotal = subtotal.plus(bruto);
    descuento = descuento.plus(desc);
    if (it.tasaIva === 10) gravado10 = gravado10.plus(total);
    else if (it.tasaIva === 5) gravado5 = gravado5.plus(total);
    else exento = exento.plus(total);
    return { bruto, descuento: desc, total };
  });
  const total = gravado10.plus(gravado5).plus(exento);
  return {
    lineas,
    subtotal,
    descuento,
    total,
    gravado10,
    gravado5,
    exento,
    iva10: gs(gravado10.div(11)),
    iva5: gs(gravado5.div(21)),
  };
}

export function aGuaranies(monto: Decimal.Value, moneda: Moneda, cot: Cotizaciones, tipo: 'compra' | 'venta' = 'compra'): Decimal {
  if (moneda === 'PYG') return gs(monto);
  const c = cot[moneda];
  if (!c) throw new ErrorCalculo('SIN_COTIZACION', `No hay cotización de ${moneda} cargada para esta sucursal`);
  return gs(new Decimal(monto).mul(c[tipo]));
}

export interface VueltoParte {
  moneda: Moneda;
  monto: Decimal;
}

/**
 * Pagos y vuelto. Solo el efectivo genera vuelto: tarjeta y transferencia no pueden superar el total.
 * Vuelto en moneda extranjera: unidades enteras a la cotización de venta; el resto, en guaraníes.
 */
export function calcularPagos(total: Decimal.Value, pagos: readonly PagoCalculo[], cot: Cotizaciones, vueltoMoneda: Moneda = 'PYG') {
  const totalD = new Decimal(total);
  const detalle = pagos.map((p) => {
    const monto = new Decimal(p.monto);
    if (monto.lte(0)) throw new ErrorCalculo('PAGO_INVALIDO', 'Cada pago debe ser mayor a cero');
    const cotizacion = p.moneda === 'PYG' ? new Decimal(1) : new Decimal(cot[p.moneda]?.compra ?? 0);
    return { ...p, monto: p.moneda === 'PYG' ? gs(monto) : monto.toDecimalPlaces(2), cotizacion, montoPyg: aGuaranies(monto, p.moneda, cot, 'compra') };
  });
  const pagado = detalle.reduce((a, p) => a.plus(p.montoPyg), new Decimal(0));
  const noEfectivo = detalle.filter((p) => p.medio !== 'efectivo').reduce((a, p) => a.plus(p.montoPyg), new Decimal(0));
  if (noEfectivo.gt(totalD)) throw new ErrorCalculo('PAGO_EXCEDE', 'Tarjeta y transferencia no pueden superar el total');
  if (pagado.lt(totalD)) throw new ErrorCalculo('PAGO_INSUFICIENTE', `Faltan ${totalD.minus(pagado).toFixed(0)} guaraníes`);

  const vueltoPyg = pagado.minus(totalD);
  const vuelto: VueltoParte[] = [];
  if (vueltoPyg.gt(0)) {
    if (vueltoMoneda === 'PYG') {
      vuelto.push({ moneda: 'PYG', monto: vueltoPyg });
    } else {
      const c = cot[vueltoMoneda];
      if (!c) throw new ErrorCalculo('SIN_COTIZACION', `No hay cotización de ${vueltoMoneda} cargada para esta sucursal`);
      const enteras = vueltoPyg.div(c.venta).floor();
      const resto = vueltoPyg.minus(gs(enteras.mul(c.venta)));
      if (enteras.gt(0)) vuelto.push({ moneda: vueltoMoneda, monto: enteras });
      if (resto.gt(0)) vuelto.push({ moneda: 'PYG', monto: resto });
    }
  }
  return { detalle, pagado, vueltoPyg, vuelto };
}
