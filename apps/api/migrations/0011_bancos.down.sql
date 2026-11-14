ALTER TABLE cobro_cliente DROP COLUMN IF EXISTS cuenta_bancaria_id;
ALTER TABLE pago_proveedor DROP COLUMN IF EXISTS cuenta_bancaria_id;
DROP TABLE IF EXISTS movimiento_bancario, cuenta_bancaria;
