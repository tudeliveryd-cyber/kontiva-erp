import { describe, expect, it } from 'vitest';
import { COLUMNAS_PRODUCTOS, mapearFilas, numeroLocal, tasaIvaLocal, unidadLocal, validarFilaCliente, validarFilaProducto } from '../src';

describe('importación', () => {
  it('entiende los formatos de número de una planilla paraguaya', () => {
    expect(numeroLocal('13.500')).toBe(13500);
    expect(numeroLocal('1.234.567')).toBe(1234567);
    expect(numeroLocal('1,5')).toBe(1.5);
    expect(numeroLocal('1.234,56')).toBe(1234.56);
    expect(numeroLocal('1,234.56')).toBe(1234.56);
    expect(numeroLocal('Gs. 9.500')).toBe(9500);
    expect(numeroLocal(18000)).toBe(18000);
    expect(numeroLocal('0.375')).toBe(0.375);
    expect(numeroLocal('abc')).toBeNaN();
  });

  it('IVA y unidades con sus variantes habituales', () => {
    expect([tasaIvaLocal('10%'), tasaIvaLocal('5'), tasaIvaLocal('Exento'), tasaIvaLocal(''), tasaIvaLocal('7')]).toEqual([10, 5, 0, 10, null]);
    expect([unidadLocal('Kilo'), unidadLocal('UN'), unidadLocal('m²'), unidadLocal(''), unidadLocal('docena')]).toEqual(['kg', 'unidad', 'm2', 'unidad', null]);
  });

  it('reconoce encabezados con acentos y sinónimos, e informa los faltantes', () => {
    const r = mapearFilas([['Descripción', 'Código de Barras', 'Importe', 'Observación'], ['Arroz', '7840118210011', '9.500', 'x'], ['', '', '', '']], COLUMNAS_PRODUCTOS);
    expect(r.reconocidas.sort()).toEqual(['codigo', 'nombre']);
    expect(r.faltantes).toEqual(['Precio']);
    expect(r.ignoradas).toEqual(['Importe', 'Observación']);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]!.fila).toBe(2);
  });

  it('valida cada fila con mensajes claros', () => {
    expect(validarFilaProducto({ nombre: 'Arroz', precio: '9.500', iva: '10%', stock: '24', codigo: 7840118210011 })).toEqual({
      ok: { nombre: 'Arroz', variante: null, codigos: ['7840118210011'], sku: null, categoria: null, precio: 9500, costo: null, tasaIva: 10, unidad: 'unidad', stock: 24 },
    });
    expect(validarFilaProducto({ nombre: '', precio: 'gratis', iva: '7', stock: '1,5' })).toEqual({
      errores: ['Falta el nombre', 'Precio inválido: "gratis"', 'IVA inválido: "7" (use 10, 5 o Exento)', 'El stock de un producto por unidad debe ser entero'],
    });
    expect(validarFilaCliente({ nombre: 'Ana', documento: '1234567-8' })).toEqual({ errores: ['RUC con dígito verificador incorrecto: 1234567-8'] });
    expect(validarFilaCliente({ nombre: 'Ana', documento: '4.512.336' })).toMatchObject({ ok: { documento: '4512336' } });
  });
});
