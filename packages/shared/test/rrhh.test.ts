import { describe, expect, it } from 'vitest';
import { aniosIndemnizacion, antiguedad, calcularFiniquito, diasPreaviso, opcionesFiniquitoIniciales, vacacionesDevengadas, calcularAguinaldo, calcularSueldo, diasVacaciones, PARAMETROS_RRHH_PY as P } from '../src';

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

describe('Liquidación final', () => {
  it('cuenta la antigüedad, el preaviso y los años de indemnización', () => {
    expect(antiguedad('2021-03-15', '2026-11-10')).toEqual({ anios: 5, meses: 7, dias: 26 });
    expect(diasPreaviso('2025-01-01', '2026-01-01')).toBe(30);
    expect(diasPreaviso('2025-01-01', '2026-01-02')).toBe(45);
    expect(diasPreaviso('2021-03-15', '2026-11-10')).toBe(60);
    expect(diasPreaviso('2010-03-15', '2026-11-10')).toBe(90);
    expect(aniosIndemnizacion('2021-03-15', '2026-11-10')).toBe(6);
    expect(aniosIndemnizacion('2026-01-10', '2026-06-20')).toBe(0);
    expect(aniosIndemnizacion('2026-01-10', '2026-07-10')).toBe(1);
  });

  it('devenga vacaciones por año de servicio y la fracción del año en curso', () => {
    const v = vacacionesDevengadas('2021-03-15', '2026-11-10');
    expect(v.periodos).toHaveLength(5);
    expect(v.periodos[0]).toEqual({ anio: 1, desde: '2022-03-15', dias: 12 });
    expect(v.causados).toBe(60);
    expect(v.proporcional).toEqual({ meses: 7, dias: 10.5 });
    expect(vacacionesDevengadas('2015-02-01', '2026-02-01').periodos.map((p) => p.dias)).toEqual([12, 12, 12, 12, 12, 18, 18, 18, 18, 18, 30]);
  });

  const base = {
    remuneracion: 'mensual' as const,
    salario: 4500000,
    aseguradoIps: true,
    hijos: 0,
    fechaIngreso: '2021-03-15',
    fechaEgreso: '2026-11-10',
    promedioMensual: null,
    cobradoEnElAnio: 45000000,
  };

  it('despido sin causa: preaviso, indemnización, aguinaldo y vacaciones', () => {
    const f = calcularFiniquito(P, { ...base, motivo: 'despido_injustificado', ...opcionesFiniquitoIniciales('despido_injustificado', 10, 12) });
    const m = Object.fromEntries(f.lineas.map((l) => [l.concepto, l.monto.toNumber()]));
    expect(m).toEqual({
      dias_trabajados: 1500000,
      aguinaldo: 3875000,
      vacaciones_causadas: 1800000,
      vacaciones_proporcionales: 1575000,
      preaviso: 9000000,
      indemnizacion: 13500000,
    });
    expect(f.imponible.toNumber()).toBe(4875000);
    expect(f.ipsObrero.toNumber()).toBe(438750);
    expect(f.ipsPatronal.toNumber()).toBe(804375);
    expect(f.bruto.toNumber()).toBe(31250000);
    expect(f.neto.toNumber()).toBe(30811250);
  });

  it('renuncia: sin preaviso ni indemnización; la base de despido usa el promedio de seis meses', () => {
    const r = calcularFiniquito(P, { ...base, motivo: 'renuncia', ...opcionesFiniquitoIniciales('renuncia', 10, 0) });
    expect(r.lineas.map((l) => l.concepto)).toEqual(['dias_trabajados', 'aguinaldo']);
    const d = calcularFiniquito(P, { ...base, promedioMensual: 6000000, motivo: 'despido_injustificado', ...opcionesFiniquitoIniciales('despido_injustificado', 0, 0), preavisoOtorgado: 20 });
    expect(d.lineas.find((l) => l.concepto === 'preaviso')!.monto.toNumber()).toBe(8000000); // 40 días × 200.000
    expect(d.lineas.find((l) => l.concepto === 'indemnizacion')!.monto.toNumber()).toBe(18000000);
  });

  it('con 10 años o más el despido sin causa se indemniza doble', () => {
    const f = calcularFiniquito(P, { ...base, fechaIngreso: '2015-01-01', fechaEgreso: '2026-06-30', motivo: 'despido_injustificado', ...opcionesFiniquitoIniciales('despido_injustificado', 0, 0) });
    expect(f.estabilidad).toBe(true);
    expect(f.lineas.find((l) => l.concepto === 'indemnizacion')!.dias.toNumber()).toBe(330);
  });
});
