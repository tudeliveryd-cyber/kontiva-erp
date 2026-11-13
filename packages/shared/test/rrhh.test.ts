import { describe, expect, it } from 'vitest';
import { calcularAguinaldo, calcularSueldo, diasVacaciones, PARAMETROS_RRHH_PY as P } from '../src';

const n = (d: { toFixed: (x: number) => string }) => d.toFixed(0);

describe('sueldos (Paraguay)', () => {
  it('salario mínimo mensual: IPS 9 % y 16,5 %, neto 2.770.040', () => {
    const s = calcularSueldo(P, { remuneracion: 'mensual', salario: 3044000, aseguradoIps: true, hijos: 0, dias: 30 });
    expect([n(s.imponible), n(s.ipsObrero), n(s.ipsPatronal), n(s.neto)]).toEqual(['3044000', '273960', '502260', '2770040']);
  });

  it('bonificación familiar: 5 % del mínimo por hijo, fuera de la base del IPS; no corre arriba de dos mínimos', () => {
    const s = calcularSueldo(P, { remuneracion: 'mensual', salario: 3500000, aseguradoIps: true, hijos: 2, dias: 30 });
    expect(n(s.bonificacion)).toBe('304400');
    expect(n(s.ipsObrero)).toBe('315000');
    expect(n(s.neto)).toBe(String(3500000 + 304400 - 315000));
    const alto = calcularSueldo(P, { remuneracion: 'mensual', salario: 6100000, aseguradoIps: true, hijos: 2, dias: 30 });
    expect(n(alto.bonificacion)).toBe('0');
  });

  it('horas extra, otros ingresos, mes incompleto y descuentos', () => {
    // 3.600.000 / 240 = 15.000 la hora: 10 h al 50 % = 225.000; 2 h al 100 % = 60.000.
    const s = calcularSueldo(P, { remuneracion: 'mensual', salario: 3600000, aseguradoIps: true, hijos: 0, dias: 15, horasExtra50: 10, horasExtra100: 2, otrosIngresos: 100000, descuentos: 500000 });
    expect(n(s.salarioBase)).toBe('1800000');
    expect(n(s.montoHorasExtra)).toBe('285000');
    expect(n(s.imponible)).toBe('2185000');
    expect(n(s.neto)).toBe(String(2185000 - 196650 - 500000));
  });

  it('jornalero sin IPS', () => {
    const s = calcularSueldo(P, { remuneracion: 'jornal', salario: 117077, aseguradoIps: false, hijos: 0, dias: 20 });
    expect([n(s.salarioBase), n(s.ipsObrero), n(s.neto)]).toEqual(['2341540', '0', '2341540']);
  });

  it('aguinaldo y vacaciones', () => {
    expect(n(calcularAguinaldo(36528000).monto)).toBe('3044000');
    expect(diasVacaciones('2026-03-01', '2026-11-13')).toBe(0);
    expect(diasVacaciones('2024-11-13', '2026-11-13')).toBe(12);
    expect(diasVacaciones('2019-01-10', '2026-11-13')).toBe(18);
    expect(diasVacaciones('2010-01-10', '2026-11-13')).toBe(30);
  });
});
