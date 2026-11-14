import { describe, expect, it } from 'vitest';
import { digitoEan13, leerEtiquetaBalanza } from '../src';

const ean = (doce: string) => doce + digitoEan13(doce);

describe('etiquetas de balanza', () => {
  it('peso en gramos: 2 + PLU de 6 + 5 dígitos de peso', () => {
    const c = { activa: true, prefijo: '2', digitosCodigo: 6, contenido: 'peso' as const, decimalesPeso: 3 };
    const r = leerEtiquetaBalanza(ean('200012301250'), c);
    expect(r).toEqual({ candidatos: ['000123', '123', '2000123'], cantidad: 1.25, importe: null });
  });

  it('importe: 20 + PLU de 5 + 5 dígitos de precio', () => {
    const c = { activa: true, prefijo: '20', digitosCodigo: 5, contenido: 'precio' as const, decimalesPeso: 3 };
    expect(leerEtiquetaBalanza(ean('200045623500'), c)).toMatchObject({ candidatos: ['00456', '456', '2000456'], importe: 23500, cantidad: null });
  });

  it('ignora códigos comunes, dígito verificador errado o balanza desactivada', () => {
    const c = { activa: true, prefijo: '2', digitosCodigo: 6, contenido: 'peso' as const, decimalesPeso: 3 };
    expect(leerEtiquetaBalanza('7891234567895', c)).toBeNull();
    expect(leerEtiquetaBalanza('2000123012509', c)).toBeNull();
    expect(leerEtiquetaBalanza(ean('200012301250'), { ...c, activa: false })).toBeNull();
  });
});
