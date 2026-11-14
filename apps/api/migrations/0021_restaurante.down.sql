ALTER TABLE venta DROP CONSTRAINT venta_cuenta_fk, DROP COLUMN cuenta_salon_id;
DROP TABLE cuenta_salon_item;
DROP TABLE comanda;
DROP TABLE cuenta_salon;
DROP TABLE mesa;
DROP TABLE salon;
ALTER TABLE producto DROP COLUMN estacion;
