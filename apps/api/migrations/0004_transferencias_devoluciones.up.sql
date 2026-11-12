-- KONTIVA ERP · Migración 0004 · Transferencias entre depósitos y devoluciones de ventas

-- ---------------------------------------------------------------------------
-- Transferencias
-- ---------------------------------------------------------------------------

CREATE TABLE transferencia (
  empresa_id           uuid NOT NULL REFERENCES empresa(id),
  id                   uuid NOT NULL DEFAULT uuid_v7(),
  numero               bigint NOT NULL,
  origen_id            uuid NOT NULL,
  destino_id           uuid NOT NULL,
  -- directa: sale y entra en la misma transacción. en_transito: espera la confirmación del destino.
  estado               text NOT NULL CHECK (estado IN ('en_transito', 'recibida', 'cancelada')),
  nota                 text,
  creado_por           uuid NOT NULL,
  creado_en            timestamptz NOT NULL DEFAULT now(),
  recibida_por         uuid,
  recibida_en          timestamptz,
  cancelada_por        uuid,
  cancelada_en         timestamptz,
  motivo_cancelacion   text,
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, numero),
  CHECK (origen_id <> destino_id),
  FOREIGN KEY (empresa_id, origen_id) REFERENCES deposito(empresa_id, id),
  FOREIGN KEY (empresa_id, destino_id) REFERENCES deposito(empresa_id, id)
);
CREATE INDEX transferencia_estado ON transferencia (empresa_id, estado, creado_en DESC);

CREATE TABLE transferencia_item (
  empresa_id         uuid NOT NULL,
  transferencia_id   uuid NOT NULL,
  linea              integer NOT NULL,
  variante_id        uuid NOT NULL,
  cantidad           numeric(18,4) NOT NULL CHECK (cantidad > 0),
  cantidad_recibida  numeric(18,4) CHECK (cantidad_recibida >= 0),   -- NULL hasta la recepción
  PRIMARY KEY (empresa_id, transferencia_id, linea),
  FOREIGN KEY (empresa_id, transferencia_id) REFERENCES transferencia(empresa_id, id),
  FOREIGN KEY (empresa_id, variante_id) REFERENCES variante(empresa_id, id)
);

-- ---------------------------------------------------------------------------
-- Devoluciones (ventas de cualquier sesión, parciales o totales)
-- ---------------------------------------------------------------------------

CREATE TABLE devolucion (
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  id              uuid NOT NULL DEFAULT uuid_v7(),
  numero          bigint NOT NULL,
  venta_id        uuid NOT NULL,
  sesion_caja_id  uuid NOT NULL,          -- caja abierta desde la que se reintegra el dinero
  deposito_id     uuid NOT NULL,          -- donde vuelve la mercadería
  medio           text NOT NULL CHECK (medio IN ('efectivo', 'tarjeta', 'transferencia', 'otro')),
  total           numeric(18,2) NOT NULL CHECK (total >= 0),
  motivo          text NOT NULL,
  autorizado_por  uuid,
  creado_por      uuid NOT NULL,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, numero),
  FOREIGN KEY (empresa_id, venta_id) REFERENCES venta(empresa_id, id),
  FOREIGN KEY (empresa_id, sesion_caja_id) REFERENCES sesion_caja(empresa_id, id),
  FOREIGN KEY (empresa_id, deposito_id) REFERENCES deposito(empresa_id, id)
);
CREATE INDEX devolucion_venta ON devolucion (empresa_id, venta_id);

CREATE TABLE devolucion_item (
  empresa_id      uuid NOT NULL,
  devolucion_id   uuid NOT NULL,
  linea_venta     integer NOT NULL,
  variante_id     uuid NOT NULL,
  cantidad        numeric(18,4) NOT NULL CHECK (cantidad > 0),
  total           numeric(18,2) NOT NULL CHECK (total >= 0),
  PRIMARY KEY (empresa_id, devolucion_id, linea_venta),
  FOREIGN KEY (empresa_id, devolucion_id) REFERENCES devolucion(empresa_id, id),
  FOREIGN KEY (empresa_id, variante_id) REFERENCES variante(empresa_id, id)
);

-- Nuevos tipos de movimiento.
ALTER TABLE movimiento_stock DROP CONSTRAINT movimiento_stock_tipo_check;
ALTER TABLE movimiento_stock ADD CONSTRAINT movimiento_stock_tipo_check
  CHECK (tipo IN ('inicial', 'ajuste', 'venta', 'anulacion_venta', 'devolucion', 'compra', 'transferencia_salida', 'transferencia_entrada', 'transferencia'));
ALTER TABLE movimiento_caja DROP CONSTRAINT movimiento_caja_tipo_check;
ALTER TABLE movimiento_caja ADD CONSTRAINT movimiento_caja_tipo_check
  CHECK (tipo IN ('apertura', 'venta', 'vuelto', 'anulacion', 'devolucion', 'retiro', 'ingreso'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['transferencia', 'transferencia_item', 'devolucion', 'devolucion_item']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY aislamiento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON transferencia, transferencia_item TO kontiva_app;
GRANT SELECT, INSERT ON devolucion, devolucion_item TO kontiva_app;
