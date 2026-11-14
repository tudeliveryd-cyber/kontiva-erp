ALTER TABLE movimiento_caja DROP CONSTRAINT movimiento_caja_tipo_check;
ALTER TABLE movimiento_caja ADD CONSTRAINT movimiento_caja_tipo_check
  CHECK (tipo IN ('apertura', 'venta', 'vuelto', 'anulacion', 'devolucion', 'retiro', 'ingreso', 'pago_proveedor'));
DROP TABLE IF EXISTS cobro_aplicacion, cobro_cliente, cuenta_cobrar;
ALTER TABLE venta DROP COLUMN IF EXISTS credito;
ALTER TABLE cliente DROP COLUMN IF EXISTS limite_credito, DROP COLUMN IF EXISTS plazo_credito_dias;
