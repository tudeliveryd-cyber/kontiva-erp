REVOKE DELETE ON precio FROM kontiva_app;
ALTER TABLE venta DROP COLUMN IF EXISTS lista_precio_id;
ALTER TABLE cliente DROP COLUMN IF EXISTS lista_precio_id;
