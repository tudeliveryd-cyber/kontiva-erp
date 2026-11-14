-- Compras: proveedores, órdenes de compra, compras (recepción de mercadería con el documento del
-- proveedor), cuentas a pagar y pagos a proveedores.
-- compra → movimiento_stock (tipo compra) + costo promedio + cuenta_pagar.

CREATE TABLE proveedor (
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  id              uuid NOT NULL DEFAULT uuid_v7(),
  nombre          text NOT NULL CHECK (length(nombre) BETWEEN 2 AND 200),
  ruc             text,
  telefono        text,
  email           text,
  direccion       text,
  contacto        text,
  plazo_pago_dias integer NOT NULL DEFAULT 0 CHECK (plazo_pago_dias BETWEEN 0 AND 365),
  nota            text,
  activo          boolean NOT NULL DEFAULT true,
  creado_por      uuid,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id)
);
CREATE INDEX proveedor_nombre ON proveedor USING gin (nombre gin_trgm_ops);
CREATE TRIGGER proveedor_tocar BEFORE UPDATE ON proveedor FOR EACH ROW EXECUTE FUNCTION tocar_actualizado_en();

CREATE TABLE orden_compra (
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  id              uuid NOT NULL DEFAULT uuid_v7(),
  numero          bigint NOT NULL,
  proveedor_id    uuid NOT NULL,
  sucursal_id     uuid NOT NULL,
  deposito_id     uuid NOT NULL,
  estado          text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'enviada', 'parcial', 'recibida', 'cancelada')),
  fecha_entrega   date,
  nota            text CHECK (length(nota) <= 1000),
  total           numeric(18,2) NOT NULL DEFAULT 0,
  aprobada_por    uuid,
  aprobada_en     timestamptz,
  motivo_cancelacion text,
  creado_por      uuid NOT NULL,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, numero),
  FOREIGN KEY (empresa_id, proveedor_id) REFERENCES proveedor(empresa_id, id),
  FOREIGN KEY (empresa_id, sucursal_id) REFERENCES sucursal(empresa_id, id),
  FOREIGN KEY (empresa_id, deposito_id) REFERENCES deposito(empresa_id, id)
);
CREATE TRIGGER orden_compra_tocar BEFORE UPDATE ON orden_compra FOR EACH ROW EXECUTE FUNCTION tocar_actualizado_en();

CREATE TABLE orden_compra_item (
  empresa_id         uuid NOT NULL,
  orden_id           uuid NOT NULL,
  linea              integer NOT NULL,
  variante_id        uuid NOT NULL,
  descripcion        text NOT NULL,
  cantidad           numeric(18,4) NOT NULL CHECK (cantidad > 0),
  cantidad_recibida  numeric(18,4) NOT NULL DEFAULT 0,
  costo_unitario     numeric(18,2) NOT NULL CHECK (costo_unitario >= 0),
  tasa_iva           smallint NOT NULL CHECK (tasa_iva IN (0, 5, 10)),
  total              numeric(18,2) NOT NULL,
  PRIMARY KEY (empresa_id, orden_id, linea),
  FOREIGN KEY (empresa_id, orden_id) REFERENCES orden_compra(empresa_id, id),
  FOREIGN KEY (empresa_id, variante_id) REFERENCES variante(empresa_id, id)
);

CREATE TABLE compra (
  empresa_id        uuid NOT NULL REFERENCES empresa(id),
  id                uuid NOT NULL DEFAULT uuid_v7(),
  numero            bigint NOT NULL,
  proveedor_id      uuid NOT NULL,
  orden_id          uuid,
  sucursal_id       uuid NOT NULL,
  deposito_id       uuid NOT NULL,
  documento_tipo    text NOT NULL CHECK (documento_tipo IN ('factura', 'factura_electronica', 'remision', 'otro')),
  timbrado          text,
  documento_numero  text,
  cdc               text CHECK (cdc ~ '^[0-9]{44}$'),
  fecha_documento   date NOT NULL,
  condicion         text NOT NULL CHECK (condicion IN ('contado', 'credito')),
  vencimiento       date,
  subtotal          numeric(18,2) NOT NULL,
  descuento         numeric(18,2) NOT NULL DEFAULT 0,
  total             numeric(18,2) NOT NULL CHECK (total >= 0),
  gravado10         numeric(18,2) NOT NULL DEFAULT 0,
  gravado5          numeric(18,2) NOT NULL DEFAULT 0,
  exento            numeric(18,2) NOT NULL DEFAULT 0,
  iva10             numeric(18,2) NOT NULL DEFAULT 0,
  iva5              numeric(18,2) NOT NULL DEFAULT 0,
  estado            text NOT NULL DEFAULT 'confirmada' CHECK (estado IN ('confirmada', 'anulada')),
  nota              text CHECK (length(nota) <= 1000),
  creado_por        uuid NOT NULL,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  anulada_por       uuid,
  anulada_en        timestamptz,
  motivo_anulacion  text,
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, numero),
  FOREIGN KEY (empresa_id, proveedor_id) REFERENCES proveedor(empresa_id, id),
  FOREIGN KEY (empresa_id, orden_id) REFERENCES orden_compra(empresa_id, id),
  FOREIGN KEY (empresa_id, sucursal_id) REFERENCES sucursal(empresa_id, id),
  FOREIGN KEY (empresa_id, deposito_id) REFERENCES deposito(empresa_id, id)
);
-- La misma factura del mismo proveedor no se carga dos veces.
CREATE UNIQUE INDEX compra_documento_unico ON compra (empresa_id, proveedor_id, timbrado, documento_numero)
  WHERE estado = 'confirmada' AND documento_numero IS NOT NULL AND documento_tipo IN ('factura', 'factura_electronica');
CREATE INDEX compra_fecha ON compra (empresa_id, fecha_documento DESC);

CREATE TABLE compra_item (
  empresa_id      uuid NOT NULL,
  compra_id       uuid NOT NULL,
  linea           integer NOT NULL,
  variante_id     uuid NOT NULL,
  descripcion     text NOT NULL,
  cantidad        numeric(18,4) NOT NULL CHECK (cantidad > 0),
  costo_unitario  numeric(18,2) NOT NULL CHECK (costo_unitario >= 0),
  descuento       numeric(18,2) NOT NULL DEFAULT 0,
  tasa_iva        smallint NOT NULL CHECK (tasa_iva IN (0, 5, 10)),
  total           numeric(18,2) NOT NULL,
  orden_linea     integer,
  PRIMARY KEY (empresa_id, compra_id, linea),
  FOREIGN KEY (empresa_id, compra_id) REFERENCES compra(empresa_id, id),
  FOREIGN KEY (empresa_id, variante_id) REFERENCES variante(empresa_id, id)
);

CREATE TABLE cuenta_pagar (
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  id              uuid NOT NULL DEFAULT uuid_v7(),
  proveedor_id    uuid NOT NULL,
  compra_id       uuid,
  descripcion     text NOT NULL,
  fecha           date NOT NULL,
  vencimiento     date NOT NULL,
  monto           numeric(18,2) NOT NULL CHECK (monto > 0),
  saldo           numeric(18,2) NOT NULL CHECK (saldo >= 0),
  estado          text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'parcial', 'pagada', 'anulada')),
  creado_por      uuid NOT NULL,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  CHECK (saldo <= monto),
  FOREIGN KEY (empresa_id, proveedor_id) REFERENCES proveedor(empresa_id, id),
  FOREIGN KEY (empresa_id, compra_id) REFERENCES compra(empresa_id, id)
);
CREATE INDEX cuenta_pagar_abiertas ON cuenta_pagar (empresa_id, vencimiento) WHERE estado IN ('pendiente', 'parcial');

CREATE TABLE pago_proveedor (
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  id              uuid NOT NULL DEFAULT uuid_v7(),
  numero          bigint NOT NULL,
  proveedor_id    uuid NOT NULL,
  fecha           date NOT NULL,
  medio           text NOT NULL CHECK (medio IN ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'otro')),
  sesion_caja_id  uuid,                 -- efectivo que sale de una caja abierta
  monto           numeric(18,2) NOT NULL CHECK (monto > 0),
  referencia      text,
  nota            text,
  estado          text NOT NULL DEFAULT 'confirmado' CHECK (estado IN ('confirmado', 'anulado')),
  creado_por      uuid NOT NULL,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  anulado_por     uuid,
  anulado_en      timestamptz,
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, numero),
  FOREIGN KEY (empresa_id, proveedor_id) REFERENCES proveedor(empresa_id, id),
  FOREIGN KEY (empresa_id, sesion_caja_id) REFERENCES sesion_caja(empresa_id, id)
);

CREATE TABLE pago_aplicacion (
  empresa_id       uuid NOT NULL,
  pago_id          uuid NOT NULL,
  cuenta_pagar_id  uuid NOT NULL,
  monto            numeric(18,2) NOT NULL CHECK (monto > 0),
  PRIMARY KEY (empresa_id, pago_id, cuenta_pagar_id),
  FOREIGN KEY (empresa_id, pago_id) REFERENCES pago_proveedor(empresa_id, id),
  FOREIGN KEY (empresa_id, cuenta_pagar_id) REFERENCES cuenta_pagar(empresa_id, id)
);

ALTER TABLE movimiento_stock DROP CONSTRAINT movimiento_stock_tipo_check;
ALTER TABLE movimiento_stock ADD CONSTRAINT movimiento_stock_tipo_check
  CHECK (tipo IN ('inicial', 'ajuste', 'venta', 'anulacion_venta', 'devolucion', 'compra', 'anulacion_compra', 'transferencia_salida', 'transferencia_entrada', 'transferencia'));

ALTER TABLE movimiento_caja DROP CONSTRAINT movimiento_caja_tipo_check;
ALTER TABLE movimiento_caja ADD CONSTRAINT movimiento_caja_tipo_check
  CHECK (tipo IN ('apertura', 'venta', 'vuelto', 'anulacion', 'devolucion', 'retiro', 'ingreso', 'pago_proveedor'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['proveedor', 'orden_compra', 'orden_compra_item', 'compra', 'compra_item', 'cuenta_pagar', 'pago_proveedor', 'pago_aplicacion']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY aislamiento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON proveedor, orden_compra, compra, cuenta_pagar, pago_proveedor TO kontiva_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON orden_compra_item TO kontiva_app;
GRANT SELECT, INSERT ON compra_item, pago_aplicacion TO kontiva_app;
