DROP TABLE receta;
ALTER TABLE venta_item DROP COLUMN condicion_venta;
DROP INDEX producto_principio_trgm;
ALTER TABLE producto DROP COLUMN principio_activo, DROP COLUMN concentracion, DROP COLUMN forma, DROP COLUMN registro_sanitario, DROP COLUMN condicion_venta;
