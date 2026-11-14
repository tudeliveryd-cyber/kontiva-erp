DELETE FROM cuenta_concepto WHERE concepto = 'vales';
ALTER TABLE cuenta_concepto DROP CONSTRAINT cuenta_concepto_concepto_check;
ALTER TABLE cuenta_concepto ADD CONSTRAINT cuenta_concepto_concepto_check CHECK (concepto IN ('caja', 'valores', 'bancos', 'transferencias',
  'deudores', 'iva_credito', 'mercaderias', 'proveedores', 'iva_debito', 'ventas', 'devoluciones_ventas', 'costo_ventas',
  'gastos_generales', 'gastos_bancarios', 'ingresos_financieros', 'deposito_manual', 'extraccion_manual',
  'sueldos', 'aportes_patronales', 'sueldos_pagar', 'ips_pagar', 'anticipos_personal'));
ALTER TABLE devolucion DROP CONSTRAINT devolucion_medio_check;
ALTER TABLE devolucion ADD CONSTRAINT devolucion_medio_check CHECK (medio IN ('efectivo', 'tarjeta', 'transferencia', 'otro'));
ALTER TABLE venta_pago DROP CONSTRAINT venta_pago_medio_check;
ALTER TABLE venta_pago ADD CONSTRAINT venta_pago_medio_check CHECK (medio IN ('efectivo', 'tarjeta', 'transferencia', 'otro'));
DROP TABLE vale_movimiento;
DROP TABLE vale;
DROP INDEX variante_grade;
ALTER TABLE variante DROP COLUMN color, DROP COLUMN talle;
