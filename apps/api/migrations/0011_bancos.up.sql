-- Cuentas bancarias, movimientos (con conciliación) y vínculo con pagos a proveedores y cobros.
-- Los movimientos no se borran: una anulación genera el movimiento inverso.

CREATE TABLE cuenta_bancaria (
  empresa_id          uuid NOT NULL REFERENCES empresa(id),
  id                  uuid NOT NULL DEFAULT uuid_v7(),
  banco               text NOT NULL CHECK (length(banco) BETWEEN 2 AND 120),
  nombre              text NOT NULL CHECK (length(nombre) BETWEEN 2 AND 120),
  numero              text,
  moneda              text NOT NULL DEFAULT 'PYG' CHECK (moneda = 'PYG'),
  saldo_inicial       numeric(18,2) NOT NULL DEFAULT 0,
  fecha_saldo_inicial date NOT NULL,
  activa              boolean NOT NULL DEFAULT true,
  creado_por          uuid,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id)
);

CREATE TABLE movimiento_bancario (
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  id              uuid NOT NULL DEFAULT uuid_v7(),
  cuenta_id       uuid NOT NULL,
  fecha           date NOT NULL,
  tipo            text NOT NULL CHECK (tipo IN ('deposito', 'extraccion', 'transferencia_entrada', 'transferencia_salida',
                                                 'pago_proveedor', 'cobro', 'deposito_caja', 'gasto', 'ingreso', 'anulacion')),
  descripcion     text NOT NULL,
  monto           numeric(18,2) NOT NULL CHECK (monto <> 0),   -- positivo entra, negativo sale
  referencia      text,
  origen_tipo     text,
  origen_id       uuid,
  conciliado      boolean NOT NULL DEFAULT false,
  conciliado_en   timestamptz,
  conciliado_por  uuid,
  creado_por      uuid NOT NULL,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  FOREIGN KEY (empresa_id, cuenta_id) REFERENCES cuenta_bancaria(empresa_id, id)
);
CREATE INDEX movimiento_bancario_cuenta ON movimiento_bancario (empresa_id, cuenta_id, fecha);

ALTER TABLE pago_proveedor ADD COLUMN cuenta_bancaria_id uuid;
ALTER TABLE pago_proveedor ADD CONSTRAINT pago_proveedor_banco_fk FOREIGN KEY (empresa_id, cuenta_bancaria_id) REFERENCES cuenta_bancaria(empresa_id, id);
ALTER TABLE cobro_cliente ADD COLUMN cuenta_bancaria_id uuid;
ALTER TABLE cobro_cliente ADD CONSTRAINT cobro_cliente_banco_fk FOREIGN KEY (empresa_id, cuenta_bancaria_id) REFERENCES cuenta_bancaria(empresa_id, id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cuenta_bancaria', 'movimiento_bancario']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY aislamiento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON cuenta_bancaria, movimiento_bancario TO kontiva_app;
