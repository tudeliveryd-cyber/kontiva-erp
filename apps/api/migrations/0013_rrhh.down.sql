DELETE FROM cuenta_concepto WHERE concepto IN ('sueldos', 'aportes_patronales', 'sueldos_pagar', 'ips_pagar', 'anticipos_personal');
ALTER TABLE cuenta_concepto DROP CONSTRAINT cuenta_concepto_concepto_check;
ALTER TABLE cuenta_concepto ADD CONSTRAINT cuenta_concepto_concepto_check CHECK (concepto IN ('caja', 'valores', 'bancos', 'transferencias',
  'deudores', 'iva_credito', 'mercaderias', 'proveedores', 'iva_debito', 'ventas', 'devoluciones_ventas', 'costo_ventas',
  'gastos_generales', 'gastos_bancarios', 'ingresos_financieros', 'deposito_manual', 'extraccion_manual'));
ALTER TABLE movimiento_bancario DROP CONSTRAINT movimiento_bancario_tipo_check;
ALTER TABLE movimiento_bancario ADD CONSTRAINT movimiento_bancario_tipo_check CHECK (tipo IN ('deposito', 'extraccion', 'transferencia_entrada',
  'transferencia_salida', 'pago_proveedor', 'cobro', 'deposito_caja', 'gasto', 'ingreso', 'anulacion'));
DROP TABLE IF EXISTS liquidacion_item, liquidacion, funcionario, rrhh_configuracion;
