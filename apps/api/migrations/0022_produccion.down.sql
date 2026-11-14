DROP TABLE orden_produccion_insumo;
DROP TABLE orden_produccion;
DROP TABLE receta_produccion_insumo;
DROP TABLE receta_produccion;
DELETE FROM movimiento_lote WHERE tipo IN ('produccion_consumo', 'produccion', 'anulacion_produccion', 'merma');
DELETE FROM movimiento_stock WHERE tipo IN ('produccion_consumo', 'produccion', 'anulacion_produccion', 'merma');
ALTER TABLE movimiento_lote DROP CONSTRAINT movimiento_lote_tipo_check;
ALTER TABLE movimiento_lote ADD CONSTRAINT movimiento_lote_tipo_check
  CHECK (tipo IN ('inicial', 'ajuste', 'venta', 'anulacion_venta', 'devolucion', 'compra', 'anulacion_compra', 'transferencia_salida', 'transferencia_entrada', 'transferencia'));
ALTER TABLE movimiento_stock DROP CONSTRAINT movimiento_stock_tipo_check;
ALTER TABLE movimiento_stock ADD CONSTRAINT movimiento_stock_tipo_check
  CHECK (tipo IN ('inicial', 'ajuste', 'venta', 'anulacion_venta', 'devolucion', 'compra', 'anulacion_compra', 'transferencia_salida', 'transferencia_entrada', 'transferencia'));
