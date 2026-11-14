-- Lotes y vencimientos: sub-libro del stock para los productos que lo controlan.
-- El saldo por variante y depósito (stock) sigue siendo el total; stock_lote lo reparte por lote.

ALTER TABLE producto ADD COLUMN controla_lote boolean NOT NULL DEFAULT false;
ALTER TABLE producto ADD CONSTRAINT producto_lote_con_stock CHECK (NOT controla_lote OR controla_stock);

CREATE TABLE lote (
  empresa_id     uuid NOT NULL REFERENCES empresa(id),
  id             uuid NOT NULL DEFAULT uuid_v7(),
  variante_id    uuid NOT NULL,
  codigo         text NOT NULL CHECK (length(codigo) BETWEEN 1 AND 40),   -- 'S/L': sin lote informado
  vencimiento    date,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, variante_id, codigo),
  FOREIGN KEY (empresa_id, variante_id) REFERENCES variante(empresa_id, id)
);
CREATE INDEX lote_vencimiento ON lote (empresa_id, vencimiento);

CREATE TABLE stock_lote (
  empresa_id     uuid NOT NULL REFERENCES empresa(id),
  lote_id        uuid NOT NULL,
  deposito_id    uuid NOT NULL,
  cantidad       numeric(18,4) NOT NULL DEFAULT 0,
  PRIMARY KEY (empresa_id, lote_id, deposito_id),
  FOREIGN KEY (empresa_id, lote_id) REFERENCES lote(empresa_id, id),
  FOREIGN KEY (empresa_id, deposito_id) REFERENCES deposito(empresa_id, id)
);

-- Cada movimiento de stock de un producto con lote se reparte en uno o más movimientos de lote.
CREATE TABLE movimiento_lote (
  empresa_id     uuid NOT NULL REFERENCES empresa(id),
  id             bigint GENERATED ALWAYS AS IDENTITY,
  lote_id        uuid NOT NULL,
  variante_id    uuid NOT NULL,
  deposito_id    uuid NOT NULL,
  tipo           text NOT NULL CHECK (tipo IN ('inicial', 'ajuste', 'venta', 'anulacion_venta', 'devolucion', 'compra', 'anulacion_compra',
                   'transferencia_salida', 'transferencia_entrada', 'transferencia')),
  cantidad       numeric(18,4) NOT NULL CHECK (cantidad <> 0),
  origen_id      uuid,
  creado_por     uuid,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  FOREIGN KEY (empresa_id, lote_id) REFERENCES lote(empresa_id, id),
  FOREIGN KEY (empresa_id, deposito_id) REFERENCES deposito(empresa_id, id)
);
CREATE INDEX movimiento_lote_origen ON movimiento_lote (empresa_id, origen_id);
CREATE INDEX movimiento_lote_lote ON movimiento_lote (empresa_id, lote_id, id DESC);

-- Lote y vencimiento informados en la factura del proveedor.
ALTER TABLE compra_item ADD COLUMN lote_codigo text CHECK (length(lote_codigo) BETWEEN 1 AND 40), ADD COLUMN lote_vencimiento date;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lote', 'stock_lote', 'movimiento_lote']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY aislamiento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON lote, stock_lote TO kontiva_app;
GRANT SELECT, INSERT ON movimiento_lote TO kontiva_app;
