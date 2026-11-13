import type { ConceptoContable } from '@kontiva/shared';
import type { TipoCuentaContable } from '../db/tipos';

/** Plan de cuentas sugerido para un comercio en Paraguay. Se puede ampliar y renombrar después. */
export const PLAN_SUGERIDO: { codigo: string; nombre: string; imputable: boolean; concepto?: ConceptoContable }[] = [
  { codigo: '1', nombre: 'Activo', imputable: false },
  { codigo: '1.1', nombre: 'Activo corriente', imputable: false },
  { codigo: '1.1.01', nombre: 'Caja', imputable: true, concepto: 'caja' },
  { codigo: '1.1.02', nombre: 'Valores a depositar', imputable: true, concepto: 'valores' },
  { codigo: '1.1.03', nombre: 'Bancos', imputable: true, concepto: 'bancos' },
  { codigo: '1.1.04', nombre: 'Transferencias en tránsito', imputable: true, concepto: 'transferencias' },
  { codigo: '1.1.05', nombre: 'Deudores por ventas', imputable: true, concepto: 'deudores' },
  { codigo: '1.1.06', nombre: 'IVA crédito fiscal', imputable: true, concepto: 'iva_credito' },
  { codigo: '1.1.07', nombre: 'Mercaderías', imputable: true, concepto: 'mercaderias' },
  { codigo: '1.2', nombre: 'Activo no corriente', imputable: false },
  { codigo: '1.2.01', nombre: 'Muebles y útiles', imputable: true },
  { codigo: '1.2.02', nombre: 'Rodados', imputable: true },
  { codigo: '1.2.03', nombre: 'Equipos de informática', imputable: true },
  { codigo: '2', nombre: 'Pasivo', imputable: false },
  { codigo: '2.1', nombre: 'Pasivo corriente', imputable: false },
  { codigo: '2.1.01', nombre: 'Proveedores', imputable: true, concepto: 'proveedores' },
  { codigo: '2.1.02', nombre: 'IVA débito fiscal', imputable: true, concepto: 'iva_debito' },
  { codigo: '2.1.03', nombre: 'Sueldos a pagar', imputable: true },
  { codigo: '2.1.04', nombre: 'Préstamos bancarios', imputable: true },
  { codigo: '3', nombre: 'Patrimonio neto', imputable: false },
  { codigo: '3.1', nombre: 'Capital', imputable: false },
  { codigo: '3.1.01', nombre: 'Capital social', imputable: true },
  { codigo: '3.2', nombre: 'Resultados', imputable: false },
  { codigo: '3.2.01', nombre: 'Resultados acumulados', imputable: true },
  { codigo: '3.2.02', nombre: 'Resultado del ejercicio', imputable: true },
  { codigo: '4', nombre: 'Ingresos', imputable: false },
  { codigo: '4.1', nombre: 'Ingresos operativos', imputable: false },
  { codigo: '4.1.01', nombre: 'Ventas de mercaderías', imputable: true, concepto: 'ventas' },
  { codigo: '4.1.02', nombre: 'Devoluciones sobre ventas', imputable: true, concepto: 'devoluciones_ventas' },
  { codigo: '4.2', nombre: 'Otros ingresos', imputable: false },
  { codigo: '4.2.01', nombre: 'Intereses ganados', imputable: true, concepto: 'ingresos_financieros' },
  { codigo: '4.2.02', nombre: 'Ingresos varios', imputable: true },
  { codigo: '5', nombre: 'Egresos', imputable: false },
  { codigo: '5.1', nombre: 'Costo de ventas', imputable: false },
  { codigo: '5.1.01', nombre: 'Costo de mercaderías vendidas', imputable: true, concepto: 'costo_ventas' },
  { codigo: '5.2', nombre: 'Gastos operativos', imputable: false },
  { codigo: '5.2.01', nombre: 'Gastos generales', imputable: true, concepto: 'gastos_generales' },
  { codigo: '5.2.02', nombre: 'Sueldos y jornales', imputable: true },
  { codigo: '5.2.03', nombre: 'Alquileres', imputable: true },
  { codigo: '5.2.04', nombre: 'Servicios (luz, agua, internet)', imputable: true },
  { codigo: '5.3', nombre: 'Gastos financieros', imputable: false },
  { codigo: '5.3.01', nombre: 'Gastos bancarios', imputable: true, concepto: 'gastos_bancarios' },
];

/** Depósitos manuales: por defecto se asume que se depositan valores; extracciones: entran a caja. */
export const CONCEPTOS_EXTRA: Partial<Record<ConceptoContable, string>> = { deposito_manual: '1.1.02', extraccion_manual: '1.1.01' };

export function tipoPorCodigo(codigo: string): TipoCuentaContable {
  const d = codigo[0];
  return d === '1' ? 'activo' : d === '2' ? 'pasivo' : d === '3' ? 'patrimonio' : d === '4' ? 'ingreso' : 'gasto';
}
