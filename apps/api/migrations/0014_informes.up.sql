-- Stock mínimo por variante (alerta de reposición en el tablero, los informes y la app del dueño).
ALTER TABLE variante ADD COLUMN stock_minimo numeric(18,4) NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0);
CREATE INDEX venta_item_variante ON venta_item (empresa_id, variante_id);
