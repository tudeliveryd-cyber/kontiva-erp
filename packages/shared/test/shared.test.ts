import { describe, expect, it } from 'vitest';
import { PERMISOS, PLANTILLAS_PERFIL, calcularDvRuc, esPermisoValido, expandirPermisos, validarRuc } from '../src';

describe('catálogo de permisos', () => {
  it('no tiene códigos duplicados', () => {
    const codigos = PERMISOS.map((p) => p.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
  });
  it('incluye los permisos confidenciales separados', () => {
    expect(esPermisoValido('costo_producto.ver')).toBe(true);
    expect(esPermisoValido('venta.cancelar')).toBe(true);
    expect(esPermisoValido('venta.volar')).toBe(false);
  });
});

describe('plantillas de perfil', () => {
  it('todas se expanden a permisos existentes', () => {
    for (const p of PLANTILLAS_PERFIL) expect(() => expandirPermisos(p.permisos)).not.toThrow();
  });
  it('el vendedor no ve costos', () => {
    const v = PLANTILLAS_PERFIL.find((p) => p.clave === 'vendedor')!;
    expect(expandirPermisos(v.permisos)).not.toContain('costo_producto.ver');
  });
  it('rechaza comodines de recursos desconocidos', () => {
    expect(() => expandirPermisos(['nave.*'])).toThrow();
  });
});

describe('RUC', () => {
  it('calcula el dígito verificador con módulo 11', () => {
    // 7·2 + 6·3 + 5·4 + 4·5 + 3·6 + 2·7 + 1·8 = 112; 112 mod 11 = 2; 11 − 2 = 9
    expect(calcularDvRuc('1234567')).toBe(9);
    expect(validarRuc('1234567-9')).toBe(true);
    expect(validarRuc('1234567-8')).toBe(false);
    expect(validarRuc('sin-guion')).toBe(false);
  });
  it("devuelve 0 cuando el resto es 0 o 1", () => {
    expect(calcularDvRuc('0')).toBe(0);
  });
});
