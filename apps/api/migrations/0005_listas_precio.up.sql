-- Listas de precios adicionales (mayorista, revendedor…) asignables a clientes.
-- La lista predeterminada sigue siendo el precio de venta del producto.

ALTER TABLE cliente ADD COLUMN lista_precio_id uuid;
ALTER TABLE cliente ADD CONSTRAINT cliente_lista_precio_fk
  FOREIGN KEY (empresa_id, lista_precio_id) REFERENCES lista_precio(empresa_id, id);

-- Lista con la que se cobró cada venta (NULL = predeterminada).
ALTER TABLE venta ADD COLUMN lista_precio_id uuid;
ALTER TABLE venta ADD CONSTRAINT venta_lista_precio_fk
  FOREIGN KEY (empresa_id, lista_precio_id) REFERENCES lista_precio(empresa_id, id);

-- Quitar un precio especial de una lista (vuelve a regir el precio general).
GRANT DELETE ON precio TO kontiva_app;
