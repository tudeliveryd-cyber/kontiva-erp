-- Presupuestos y pedidos de clientes.
-- Misma estructura, numeración propia por tipo. Un presupuesto aceptado genera un pedido;
-- un pedido se cobra en el PDV y queda entregado (la venta guarda pedido_id).
-- Ninguno mueve stock ni dinero: eso lo hace la venta.

CREATE TABLE pedido (
  empresa_id        uuid NOT NULL REFERENCES empresa(id),
  id                uuid NOT NULL DEFAULT uuid_v7(),
  tipo              text NOT NULL CHECK (tipo IN ('presupuesto', 'pedido')),
  numero            bigint NOT NULL,
  sucursal_id       uuid NOT NULL,
  cliente_id        uuid,
  cliente_nombre    text CHECK (length(cliente_nombre) <= 200),   -- presupuesto a alguien no registrado
  lista_precio_id   uuid,
  estado            text NOT NULL CHECK (
    (tipo = 'presupuesto' AND estado IN ('vigente', 'aceptado', 'rechazado', 'anulado')) OR
    (tipo = 'pedido' AND estado IN ('pendiente', 'preparado', 'entregado', 'cancelado'))),
  valido_hasta      date,
  entrega_prevista  date,
  nota              text CHECK (length(nota) <= 1000),
  subtotal          numeric(18,2) NOT NULL DEFAULT 0,
  descuento         numeric(18,2) NOT NULL DEFAULT 0,
  total             numeric(18,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  origen_id         uuid,                 -- presupuesto del que salió el pedido
  venta_id          uuid,                 -- venta con la que se entregó
  autorizado_por    uuid,                 -- supervisor que autorizó descuentos
  motivo_cierre     text,                 -- rechazo, anulación o cancelación
  cerrado_por       uuid,
  cerrado_en        timestamptz,
  creado_por        uuid NOT NULL,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, tipo, numero),
  CHECK (cliente_id IS NOT NULL OR cliente_nombre IS NOT NULL OR tipo = 'presupuesto'),
  FOREIGN KEY (empresa_id, sucursal_id) REFERENCES sucursal(empresa_id, id),
  FOREIGN KEY (empresa_id, cliente_id) REFERENCES cliente(empresa_id, id),
  FOREIGN KEY (empresa_id, lista_precio_id) REFERENCES lista_precio(empresa_id, id),
  FOREIGN KEY (empresa_id, origen_id) REFERENCES pedido(empresa_id, id),
  FOREIGN KEY (empresa_id, venta_id) REFERENCES venta(empresa_id, id)
);
CREATE INDEX pedido_listado ON pedido (empresa_id, tipo, estado, creado_en DESC);
CREATE TRIGGER pedido_tocar BEFORE UPDATE ON pedido FOR EACH ROW EXECUTE FUNCTION tocar_actualizado_en();

CREATE TABLE pedido_item (
  empresa_id       uuid NOT NULL,
  pedido_id        uuid NOT NULL,
  linea            integer NOT NULL,
  variante_id      uuid NOT NULL,
  descripcion      text NOT NULL,
  cantidad         numeric(18,4) NOT NULL CHECK (cantidad > 0),
  precio_unitario  numeric(18,2) NOT NULL CHECK (precio_unitario >= 0),
  descuento        numeric(18,2) NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  total            numeric(18,2) NOT NULL CHECK (total >= 0),
  tasa_iva         smallint NOT NULL CHECK (tasa_iva IN (0, 5, 10)),
  PRIMARY KEY (empresa_id, pedido_id, linea),
  FOREIGN KEY (empresa_id, pedido_id) REFERENCES pedido(empresa_id, id),
  FOREIGN KEY (empresa_id, variante_id) REFERENCES variante(empresa_id, id)
);

ALTER TABLE venta ADD COLUMN pedido_id uuid;
ALTER TABLE venta ADD CONSTRAINT venta_pedido_fk FOREIGN KEY (empresa_id, pedido_id) REFERENCES pedido(empresa_id, id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pedido', 'pedido_item']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY aislamiento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON pedido TO kontiva_app;
-- Mientras están abiertos, los ítems se reemplazan al editar.
GRANT SELECT, INSERT, DELETE ON pedido_item TO kontiva_app;
