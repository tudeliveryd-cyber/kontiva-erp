DROP TABLE IF EXISTS devolucion_item, devolucion, transferencia_item, transferencia;
ALTER TABLE movimiento_stock DROP CONSTRAINT movimiento_stock_tipo_check;
ALTER TABLE movimiento_stock ADD CONSTRAINT movimiento_stock_tipo_check
  CHECK (tipo IN ('inicial', 'ajuste', 'venta', 'anulacion_venta', 'compra', 'transferencia'));
ALTER TABLE movimiento_caja DROP CONSTRAINT movimiento_caja_tipo_check;
ALTER TABLE movimiento_caja ADD CONSTRAINT movimiento_caja_tipo_check
  CHECK (tipo IN ('apertura', 'venta', 'vuelto', 'anulacion', 'retiro', 'ingreso'));
