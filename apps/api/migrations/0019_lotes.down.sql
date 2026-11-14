ALTER TABLE compra_item DROP COLUMN lote_codigo, DROP COLUMN lote_vencimiento;
DROP TABLE movimiento_lote;
DROP TABLE stock_lote;
DROP TABLE lote;
ALTER TABLE producto DROP CONSTRAINT producto_lote_con_stock, DROP COLUMN controla_lote;
