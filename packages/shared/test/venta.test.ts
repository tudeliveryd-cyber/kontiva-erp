import { describe, expect, it } from 'vitest';
import { calcularItems, calcularPagos, ErrorCalculo } from '../src';

const cot = { USD: { compra: 7300, venta: 7450 }, BRL: { compra: 1280, venta: 1320 } };

describe('cálculo de venta', () => {
  it('IVA incluido: 10 % = total/11, 5 % = total/21, redondeo a guaraníes', () => {
    const r = calcularItems([
      { cantidad: 2, precioUnitario: 11000, tasaIva: 10 }, // 22.000 → IVA 2.000
      { cantidad: 1, precioUnitario: 21000, tasaIva: 5 }, // 21.000 → IVA 1.000
      { cantidad: 1, precioUnitario: 5000, tasaIva: 0 },
    ]);
    expect(r.total.toNumber()).toBe(48000);
    expect(r.iva10.toNumber()).toBe(2000);
    expect(r.iva5.toNumber()).toBe(1000);
    expect(r.exento.toNumber()).toBe(5000);
  });

  it('cantidades por peso con decimales y descuento por línea', () => {
    const r = calcularItems([{ cantidad: '1.375', precioUnitario: 32000, descuento: 1000, tasaIva: 5 }]);
    expect(r.subtotal.toNumber()).toBe(44000);
    expect(r.total.toNumber()).toBe(43000);
    expect(r.descuento.toNumber()).toBe(1000);
  });

  it('no acepta descuento mayor que la línea', () => {
    expect(() => calcularItems([{ cantidad: 1, precioUnitario: 1000, descuento: 2000, tasaIva: 10 }])).toThrow(ErrorCalculo);
  });

  it('pago mixto en reales y guaraníes con vuelto en guaraníes', () => {
    // total 100.000 · paga R$ 50 (64.000) + 40.000 Gs efectivo → vuelto 4.000 Gs
    const r = calcularPagos(100000, [
      { medio: 'efectivo', moneda: 'BRL', monto: 50 },
      { medio: 'efectivo', moneda: 'PYG', monto: 40000 },
    ], cot);
    expect(r.pagado.toNumber()).toBe(104000);
    expect(r.vuelto).toEqual([{ moneda: 'PYG', monto: expect.anything() }]);
    expect(r.vuelto[0]!.monto.toNumber()).toBe(4000);
  });

  it('vuelto en dólares: unidades enteras y el resto en guaraníes', () => {
    // total 50.000 · paga US$ 20 (146.000) → vuelto 96.000 = US$ 12 (89.400) + 6.600 Gs
    const r = calcularPagos(50000, [{ medio: 'efectivo', moneda: 'USD', monto: 20 }], cot, 'USD');
    expect(r.vuelto.map((v) => [v.moneda, v.monto.toNumber()])).toEqual([['USD', 12], ['PYG', 6600]]);
  });

  it('tarjeta no puede superar el total ni faltar dinero', () => {
    expect(() => calcularPagos(10000, [{ medio: 'tarjeta', moneda: 'PYG', monto: 15000 }], cot)).toThrow(/superar/);
    expect(() => calcularPagos(10000, [{ medio: 'efectivo', moneda: 'PYG', monto: 5000 }], cot)).toThrow(/Faltan 5000/);
  });

  it('sin cotización cargada no acepta esa moneda', () => {
    expect(() => calcularPagos(10000, [{ medio: 'efectivo', moneda: 'USD', monto: 5 }], {})).toThrow(/cotización/);
  });
});
