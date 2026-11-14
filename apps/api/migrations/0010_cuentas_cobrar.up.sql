-- Ventas a crédito (cuenta corriente del cliente), cuentas a cobrar y cobros.

ALTER TABLE cliente
  ADD COLUMN limite_credito numeric(18,2) NOT NULL DEFAULT 0 CHECK (limite_credito >= 0),   -- 0 = sin crédito
  ADD COLUMN plazo_credito_dias integer NOT NULL DEFAULT 30 CHECK (plazo_credito_dias BETWEEN 1 AND 365);

-- Parte de la venta que queda en la cuenta del cliente (no pasa por la caja).
ALTER TABLE venta ADD COLUMN credito numeric(18,2) NOT NULL DEFAULT 0 CHECK (credito >= 0);

CREATE TABLE cuenta_cobrar (
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  id              uuid NOT NULL DEFAULT uuid_v7(),
  cliente_id      uuid NOT NULL,
  venta_id        uuid,
  sucursal_id     uuid NOT NULL,
  descripcion     text NOT NULL,
  fecha           date NOT NULL,
  vencimiento     date NOT NULL,
  monto           numeric(18,2) NOT NULL CHECK (monto > 0),
  saldo           numeric(18,2) NOT NULL CHECK (saldo >= 0),
  estado          text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'parcial', 'cobrada', 'anulada')),
  autorizado_por  uuid,                 -- supervisor que autorizó superar el límite
  creado_por      uuid NOT NULL,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  CHECK (saldo <= monto),
  FOREIGN KEY (empresa_id, cliente_id) REFERENCES cliente(empresa_id, id),
  FOREIGN KEY (empresa_id, venta_id) REFERENCES venta(empresa_id, id),
  FOREIGN KEY (empresa_id, sucursal_id) REFERENCES sucursal(empresa_id, id)
);
CREATE INDEX cuenta_cobrar_abiertas ON cuenta_cobrar (empresa_id, cliente_id, vencimiento) WHERE estado IN ('pendiente', 'parcial');

CREATE TABLE cobro_cliente (
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  id              uuid NOT NULL DEFAULT uuid_v7(),
  numero          bigint NOT NULL,
  cliente_id      uuid NOT NULL,
  fecha           date NOT NULL,
  medio           text NOT NULL CHECK (medio IN ('efectivo', 'tarjeta', 'transferencia', 'cheque', 'otro')),
  sesion_caja_id  uuid,                 -- cobrado en una caja abierta (el efectivo entra a la caja)
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
  FOREIGN KEY (empresa_id, cliente_id) REFERENCES cliente(empresa_id, id),
  FOREIGN KEY (empresa_id, sesion_caja_id) REFERENCES sesion_caja(empresa_id, id)
);

CREATE TABLE cobro_aplicacion (
  empresa_id        uuid NOT NULL,
  cobro_id          uuid,                 -- cobro en dinero, o
  devolucion_id     uuid,                 -- devolución que descuenta de la deuda
  cuenta_cobrar_id  uuid NOT NULL,
  monto             numeric(18,2) NOT NULL CHECK (monto > 0),
  creado_en         timestamptz NOT NULL DEFAULT now(),
  CHECK ((cobro_id IS NULL) <> (devolucion_id IS NULL)),
  FOREIGN KEY (empresa_id, cobro_id) REFERENCES cobro_cliente(empresa_id, id),
  FOREIGN KEY (empresa_id, devolucion_id) REFERENCES devolucion(empresa_id, id),
  FOREIGN KEY (empresa_id, cuenta_cobrar_id) REFERENCES cuenta_cobrar(empresa_id, id)
);
CREATE INDEX cobro_aplicacion_cuenta ON cobro_aplicacion (empresa_id, cuenta_cobrar_id);

ALTER TABLE movimiento_caja DROP CONSTRAINT movimiento_caja_tipo_check;
ALTER TABLE movimiento_caja ADD CONSTRAINT movimiento_caja_tipo_check
  CHECK (tipo IN ('apertura', 'venta', 'vuelto', 'anulacion', 'devolucion', 'retiro', 'ingreso', 'pago_proveedor', 'cobro'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cuenta_cobrar', 'cobro_cliente', 'cobro_aplicacion']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY aislamiento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON cuenta_cobrar, cobro_cliente TO kontiva_app;
GRANT SELECT, INSERT ON cobro_aplicacion TO kontiva_app;
