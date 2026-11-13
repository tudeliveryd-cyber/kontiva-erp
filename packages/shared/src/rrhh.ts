import Decimal from 'decimal.js';

/**
 * Cálculo de sueldos en Paraguay. Lo usan la API (fuente de verdad) y la planilla web (vista previa).
 *
 * - Salario mínimo: Decreto 6225/2026, vigente desde el 1/7/2026. La empresa lo actualiza cada año.
 * - IPS: 9 % a cargo del trabajador y 16,5 % del empleador, sobre lo imponible
 *   (todo es salario menos la bonificación familiar y el aguinaldo).
 * - Bonificación familiar (art. 261 del Código del Trabajo): 5 % del salario mínimo por hijo menor de 17 años,
 *   para quien no gana más de dos salarios mínimos.
 * - Horas extra: 50 % de recargo las diurnas, 100 % las nocturnas y en feriados. Valor hora del mensualizado:
 *   salario / 30 / 8; del jornalero: jornal / 8.
 * - Aguinaldo: la doceava parte de lo cobrado en el año, sin aporte al IPS.
 * Guaraníes sin decimales.
 */

export const PARAMETROS_RRHH_PY = {
  salarioMinimo: 3044000,
  ipsObrero: 9,
  ipsPatronal: 16.5,
  bonificacionPct: 5,
  bonificacionTope: 2,
} as const;

export interface ParametrosRrhh {
  salarioMinimo: number | string;
  ipsObrero: number | string;
  ipsPatronal: number | string;
  bonificacionPct: number | string;
  bonificacionTope: number | string;
}

export interface EntradaSueldo {
  remuneracion: 'mensual' | 'jornal';
  salario: number | string;
  aseguradoIps: boolean;
  hijos: number;
  dias: number | string;
  horasExtra50?: number | string;
  horasExtra100?: number | string;
  otrosIngresos?: number | string;
  descuentos?: number | string;
}

export interface Sueldo {
  salarioBase: Decimal;
  montoHorasExtra: Decimal;
  otrosIngresos: Decimal;
  bonificacion: Decimal;
  imponible: Decimal;
  bruto: Decimal;
  ipsObrero: Decimal;
  ipsPatronal: Decimal;
  descuentos: Decimal;
  neto: Decimal;
}

const gs = (d: Decimal.Value) => new Decimal(d).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

export function calcularSueldo(p: ParametrosRrhh, e: EntradaSueldo): Sueldo {
  const salario = new Decimal(e.salario);
  const dias = new Decimal(e.dias);
  const salarioBase = gs(e.remuneracion === 'mensual' ? (dias.gte(30) ? salario : salario.mul(dias).div(30)) : salario.mul(dias));
  const hora = e.remuneracion === 'mensual' ? salario.div(240) : salario.div(8);
  const montoHorasExtra = gs(hora.mul(1.5).mul(e.horasExtra50 ?? 0).plus(hora.mul(2).mul(e.horasExtra100 ?? 0)));
  const otrosIngresos = gs(e.otrosIngresos ?? 0);
  const imponible = salarioBase.plus(montoHorasExtra).plus(otrosIngresos);
  const minimo = new Decimal(p.salarioMinimo);
  const bonificacion =
    e.hijos > 0 && imponible.gt(0) && imponible.lte(minimo.mul(p.bonificacionTope)) ? gs(minimo.mul(p.bonificacionPct).div(100)).mul(e.hijos) : new Decimal(0);
  const ipsObrero = e.aseguradoIps ? gs(imponible.mul(p.ipsObrero).div(100)) : new Decimal(0);
  const ipsPatronal = e.aseguradoIps ? gs(imponible.mul(p.ipsPatronal).div(100)) : new Decimal(0);
  const descuentos = gs(e.descuentos ?? 0);
  const bruto = imponible.plus(bonificacion);
  return { salarioBase, montoHorasExtra, otrosIngresos, bonificacion, imponible, bruto, ipsObrero, ipsPatronal, descuentos, neto: bruto.minus(ipsObrero).minus(descuentos) };
}

/** Aguinaldo: lo cobrado en el año (sin bonificación familiar) / 12. */
export function calcularAguinaldo(cobradoEnElAnio: Decimal.Value, descuentos: Decimal.Value = 0) {
  const monto = gs(new Decimal(cobradoEnElAnio).div(12));
  const d = gs(descuentos);
  return { monto, descuentos: d, neto: monto.minus(d) };
}

/** Días de vacaciones por antigüedad (art. 218): hasta 5 años 12, de 5 a 10 años 18, más de 10 años 30. Antes del primer año, 0. */
export function diasVacaciones(fechaIngreso: string, al: string): number {
  const [ai, mi, di] = fechaIngreso.split('-').map(Number) as [number, number, number];
  const [aa, ma, da] = al.split('-').map(Number) as [number, number, number];
  let anios = aa - ai;
  if (ma < mi || (ma === mi && da < di)) anios--;
  if (anios < 1) return 0;
  if (anios <= 5) return 12;
  if (anios <= 10) return 18;
  return 30;
}
