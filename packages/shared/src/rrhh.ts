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

// ── Antigüedad, vacaciones y liquidación final ───────────────────────────────

const partes = (f: string) => f.split('-').map(Number) as [number, number, number];
const diasDelMes = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();
const fechaIso = (a: number, m: number, d: number) => `${a}-${String(m).padStart(2, '0')}-${String(Math.min(d, diasDelMes(a, m))).padStart(2, '0')}`;

/** Antigüedad entre el ingreso y una fecha, en años, meses y días cumplidos. */
export function antiguedad(ingreso: string, al: string): { anios: number; meses: number; dias: number } {
  const [ai, mi, di] = partes(ingreso);
  const [aa, ma, da] = partes(al);
  let anios = aa - ai;
  let meses = ma - mi;
  let dias = da - di;
  if (dias < 0) {
    meses--;
    dias += diasDelMes(aa, ma - 1 || 12);
  }
  if (meses < 0) {
    anios--;
    meses += 12;
  }
  if (anios < 0) return { anios: 0, meses: 0, dias: 0 };
  return { anios, meses, dias };
}

const masDe = (a: { anios: number; meses: number; dias: number }, n: number) => a.anios > n || (a.anios === n && (a.meses > 0 || a.dias > 0));

/** Preaviso (art. 87): hasta 1 año, 30 días; más de 1 y hasta 5, 45; más de 5 y hasta 10, 60; más de 10, 90. */
export function diasPreaviso(ingreso: string, egreso: string): number {
  const a = antiguedad(ingreso, egreso);
  if (!masDe(a, 1)) return 30;
  if (!masDe(a, 5)) return 45;
  if (!masDe(a, 10)) return 60;
  return 90;
}

/** Años que cuentan para la indemnización (art. 91): cada año de servicio o fracción de seis meses. */
export function aniosIndemnizacion(ingreso: string, egreso: string): number {
  const a = antiguedad(ingreso, egreso);
  return a.anios + (a.meses >= 6 ? 1 : 0);
}

/** Días de vacaciones del año de servicio número n (art. 218). */
export const diasVacacionesAnio = (n: number) => (n <= 5 ? 12 : n <= 10 ? 18 : 30);

export interface VacacionesDevengadas {
  /** Un período por año de servicio cumplido, con la fecha en que se cumplió. */
  periodos: { anio: number; desde: string; dias: number }[];
  causados: number;
  /** Fracción del año de servicio en curso: meses cumplidos desde el último aniversario. */
  proporcional: { meses: number; dias: number };
}

export function vacacionesDevengadas(ingreso: string, al: string): VacacionesDevengadas {
  const [ai, mi, di] = partes(ingreso);
  const a = antiguedad(ingreso, al);
  const periodos = Array.from({ length: a.anios }, (_, k) => ({ anio: k + 1, desde: fechaIso(ai + k + 1, mi, di), dias: diasVacacionesAnio(k + 1) }));
  const proporcional = new Decimal(diasVacacionesAnio(a.anios + 1)).mul(a.meses).div(12).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
  return { periodos, causados: periodos.reduce((s, p) => s + p.dias, 0), proporcional: { meses: a.meses, dias: proporcional } };
}

export const MOTIVOS_EGRESO = {
  renuncia: 'Renuncia',
  despido_injustificado: 'Despido sin justa causa',
  despido_justificado: 'Despido con justa causa',
  mutuo_acuerdo: 'Mutuo acuerdo',
  fin_contrato: 'Fin de contrato',
} as const;
export type MotivoEgreso = keyof typeof MOTIVOS_EGRESO;

export const CONCEPTOS_FINIQUITO = {
  dias_trabajados: 'Salario de días trabajados',
  bonificacion: 'Bonificación familiar',
  otros_ingresos: 'Otros ingresos',
  aguinaldo: 'Aguinaldo proporcional',
  vacaciones_causadas: 'Vacaciones causadas no gozadas',
  vacaciones_proporcionales: 'Vacaciones proporcionales',
  preaviso: 'Preaviso no otorgado',
  indemnizacion: 'Indemnización por despido',
} as const;
export type ConceptoFiniquito = keyof typeof CONCEPTOS_FINIQUITO;

/** Opciones que cambian según el motivo; la empresa puede ajustarlas en el borrador. */
export interface OpcionesFiniquito {
  diasTrabajados: number | string;
  preavisoOtorgado: number | string;
  vacacionesPendientes: number | string;
  vacacionesProporcionales: boolean;
  ipsPreaviso: boolean;
  ipsVacaciones: boolean;
  otrosIngresos: number | string;
  descuentos: number | string;
}

/**
 * Valores iniciales. IPS: los días trabajados y las vacaciones llevan aporte; el preaviso pagado en dinero,
 * la indemnización y el aguinaldo no (criterio más difundido; la empresa puede cambiarlo con su contador).
 */
export const opcionesFiniquitoIniciales = (motivo: MotivoEgreso, diasTrabajados: number, vacacionesPendientes: number): OpcionesFiniquito => ({
  diasTrabajados,
  preavisoOtorgado: 0,
  vacacionesPendientes,
  vacacionesProporcionales: motivo === 'despido_injustificado',
  ipsPreaviso: false,
  ipsVacaciones: true,
  otrosIngresos: 0,
  descuentos: 0,
});

export interface EntradaFiniquito extends OpcionesFiniquito {
  motivo: MotivoEgreso;
  remuneracion: 'mensual' | 'jornal';
  salario: number | string;
  aseguradoIps: boolean;
  hijos: number;
  fechaIngreso: string;
  fechaEgreso: string;
  /** Promedio mensual de lo devengado en los últimos seis meses (base de preaviso e indemnización, art. 91). */
  promedioMensual: number | string | null;
  /** Imponible ya liquidado en el año del egreso (base del aguinaldo proporcional). */
  cobradoEnElAnio: number | string;
}

export interface LineaFiniquito {
  concepto: ConceptoFiniquito;
  descripcion: string;
  dias: Decimal;
  base: Decimal;
  monto: Decimal;
  imponible: boolean;
}

export interface Finiquito {
  antiguedad: { anios: number; meses: number; dias: number };
  aniosIndemnizacion: number;
  diasPreaviso: number;
  estabilidad: boolean;
  jornal: Decimal;
  baseDiaria: Decimal;
  lineas: LineaFiniquito[];
  imponible: Decimal;
  bruto: Decimal;
  ipsObrero: Decimal;
  ipsPatronal: Decimal;
  descuentos: Decimal;
  neto: Decimal;
}

export function calcularFiniquito(p: ParametrosRrhh, e: EntradaFiniquito): Finiquito {
  const ant = antiguedad(e.fechaIngreso, e.fechaEgreso);
  const anios = aniosIndemnizacion(e.fechaIngreso, e.fechaEgreso);
  const preavisoLegal = diasPreaviso(e.fechaIngreso, e.fechaEgreso);
  const injustificado = e.motivo === 'despido_injustificado';
  // Estabilidad (art. 94 y 97): con 10 años o más, el despido sin causa se indemniza doble.
  const estabilidad = ant.anios >= 10;
  const salario = new Decimal(e.salario);
  const jornal = e.remuneracion === 'mensual' ? salario.div(30) : salario;
  const baseDiaria = e.promedioMensual !== null && new Decimal(e.promedioMensual).gt(0) ? new Decimal(e.promedioMensual).div(30) : jornal;
  const lineas: LineaFiniquito[] = [];
  const agregar = (concepto: ConceptoFiniquito, dias: Decimal.Value, base: Decimal, monto: Decimal, imponible: boolean, descripcion?: string) => {
    if (gs(monto).gt(0)) lineas.push({ concepto, descripcion: descripcion ?? CONCEPTOS_FINIQUITO[concepto], dias: new Decimal(dias), base: gs(base), monto: gs(monto), imponible });
  };

  const dias = new Decimal(e.diasTrabajados);
  let salarioDias = new Decimal(0);
  if (dias.gt(0)) {
    const s = calcularSueldo(p, { remuneracion: e.remuneracion, salario: e.salario, aseguradoIps: false, hijos: e.hijos, dias: dias.toString() });
    salarioDias = s.salarioBase;
    agregar('dias_trabajados', dias, jornal, s.salarioBase, true);
    agregar('bonificacion', 0, new Decimal(0), s.bonificacion, false, `Bonificación familiar (${e.hijos} ${e.hijos === 1 ? 'hijo' : 'hijos'})`);
  }
  const otros = gs(e.otrosIngresos);
  agregar('otros_ingresos', 0, new Decimal(0), otros, true);
  agregar('aguinaldo', 0, new Decimal(0), new Decimal(e.cobradoEnElAnio).plus(salarioDias).plus(otros).div(12), false);
  const vac = new Decimal(e.vacacionesPendientes);
  agregar('vacaciones_causadas', vac, jornal, jornal.mul(vac), e.ipsVacaciones);
  if (e.vacacionesProporcionales) {
    const prop = vacacionesDevengadas(e.fechaIngreso, e.fechaEgreso).proporcional.dias;
    agregar('vacaciones_proporcionales', prop, jornal, jornal.mul(prop), e.ipsVacaciones);
  }
  if (injustificado) {
    const faltan = Decimal.max(0, new Decimal(preavisoLegal).minus(e.preavisoOtorgado));
    agregar('preaviso', faltan, baseDiaria, baseDiaria.mul(faltan), e.ipsPreaviso, `Preaviso no otorgado (${preavisoLegal} días legales)`);
    const diasInd = anios * 15 * (estabilidad ? 2 : 1);
    agregar('indemnizacion', diasInd, baseDiaria, baseDiaria.mul(diasInd), false, estabilidad ? 'Indemnización doble por estabilidad' : `Indemnización (${anios} ${anios === 1 ? 'año' : 'años'} × 15 días)`);
  }

  const imponible = lineas.filter((l) => l.imponible).reduce((s, l) => s.plus(l.monto), new Decimal(0));
  const bruto = lineas.reduce((s, l) => s.plus(l.monto), new Decimal(0));
  const ipsObrero = e.aseguradoIps ? gs(imponible.mul(p.ipsObrero).div(100)) : new Decimal(0);
  const ipsPatronal = e.aseguradoIps ? gs(imponible.mul(p.ipsPatronal).div(100)) : new Decimal(0);
  const descuentos = gs(e.descuentos);
  return {
    antiguedad: ant,
    aniosIndemnizacion: anios,
    diasPreaviso: preavisoLegal,
    estabilidad: injustificado && estabilidad,
    jornal: gs(jornal),
    baseDiaria: gs(baseDiaria),
    lineas,
    imponible,
    bruto,
    ipsObrero,
    ipsPatronal,
    descuentos,
    neto: bruto.minus(ipsObrero).minus(descuentos),
  };
}
