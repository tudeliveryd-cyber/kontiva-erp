ALTER TABLE movimiento_stock DROP CONSTRAINT movimiento_stock_tipo_check;
ALTER TABLE movimiento_stock ADD CONSTRAINT movimiento_stock_tipo_check
  CHECK (tipo IN ('inicial', 'ajuste', 'venta', 'anulacion_venta', 'devolucion', 'compra', 'transferencia_salida', 'transferencia_entrada', 'transferencia'));
ALTER TABLE movimiento_caja DROP CONSTRAINT movimiento_caja_tipo_check;
ALTER TABLE movimiento_caja ADD CONSTRAINT movimiento_caja_tipo_check
  CHECK (tipo IN ('apertura', 'venta', 'vuelto', 'anulacion', 'devolucion', 'retiro', 'ingreso'));
DROP TABLE IF EXISTS pago_aplicacion, pago_proveedor, cuenta_pagar, compra_item, compra, orden_compra_item, orden_compra, proveedor;
