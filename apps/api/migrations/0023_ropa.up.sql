-- Tienda de ropa: grade talle × color en las variantes y vales de cambio
-- (la devolución deja un saldo a favor del cliente en vez de reintegrar dinero).

ALTER TABLE variante
  ADD COLUMN talle text CHECK (talle IS NULL OR length(talle) BETWEEN 1 AND 20),
  ADD COLUMN color text CHECK (color IS NULL OR length(color) BETWEEN 1 AND 40);
CREATE UNIQUE INDEX variante_grade ON variante (empresa_id, producto_id, lower(coalesce(talle, '')), lower(coalesce(color, '')))
  WHERE activa AND (talle IS NOT NULL OR color IS NOT NULL);

CREATE TABLE vale (
  empresa_id     uuid NOT NULL REFERENCES empresa(id),
  id             uuid NOT NULL DEFAULT uuid_v7(),
  numero         bigint NOT NULL,
  codigo         text NOT NULL CHECK (codigo ~ '^[0-9A-Z]{8,16}$'),
  sucursal_id    uuid NOT NULL,
  cliente_id     uuid,
  devolucion_id  uuid,
  monto          numeric(18,2) NOT NULL CHECK (monto > 0),
  saldo          numeric(18,2) NOT NULL CHECK (saldo >= 0 AND saldo <= monto),
  vence          date,
  creado_por     uuid NOT NULL,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, numero),
  UNIQUE (empresa_id, codigo),
  FOREIGN KEY (empresa_id, sucursal_id) REFERENCES sucursal(empresa_id, id),
  FOREIGN KEY (empresa_id, cliente_id) REFERENCES cliente(empresa_id, id),
  FOREIGN KEY (empresa_id, devolucion_id) REFERENCES devolucion(empresa_id, id)
);
CREATE INDEX vale_cliente ON vale (empresa_id, cliente_id) WHERE cliente_id IS NOT NULL;

-- Historial del saldo: emisión, uso en una venta y reintegro al anular esa venta.
CREATE TABLE vale_movimiento (
  empresa_id   uuid NOT NULL,
  id           uuid NOT NULL DEFAULT uuid_v7(),
  vale_id      uuid NOT NULL,
  tipo         text NOT NULL CHECK (tipo IN ('emision', 'uso', 'reintegro')),
  monto        numeric(18,2) NOT NULL,
  saldo        numeric(18,2) NOT NULL,
  venta_id     uuid,
  creado_por   uuid NOT NULL,
  creado_en    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  FOREIGN KEY (empresa_id, vale_id) REFERENCES vale(empresa_id, id),
  FOREIGN KEY (empresa_id, venta_id) REFERENCES venta(empresa_id, id)
);
CREATE INDEX vale_movimiento_vale ON vale_movimiento (empresa_id, vale_id, creado_en);
CREATE INDEX vale_movimiento_venta ON vale_movimiento (empresa_id, venta_id) WHERE venta_id IS NOT NULL;

-- El vale es un medio de pago de la venta (no entra a la caja) y un medio de reintegro de la devolución.
ALTER TABLE venta_pago DROP CONSTRAINT venta_pago_medio_check;
ALTER TABLE venta_pago ADD CONSTRAINT venta_pago_medio_check CHECK (medio IN ('efectivo', 'tarjeta', 'transferencia', 'otro', 'vale'));
ALTER TABLE devolucion DROP CONSTRAINT devolucion_medio_check;
ALTER TABLE devolucion ADD CONSTRAINT devolucion_medio_check CHECK (medio IN ('efectivo', 'tarjeta', 'transferencia', 'otro', 'vale'));

-- Concepto contable: vales a canjear (pasivo).
ALTER TABLE cuenta_concepto DROP CONSTRAINT cuenta_concepto_concepto_check;
ALTER TABLE cuenta_concepto ADD CONSTRAINT cuenta_concepto_concepto_check CHECK (concepto IN ('caja', 'valores', 'bancos', 'transferencias',
  'deudores', 'iva_credito', 'mercaderias', 'proveedores', 'iva_debito', 'ventas', 'devoluciones_ventas', 'costo_ventas',
  'gastos_generales', 'gastos_bancarios', 'ingresos_financieros', 'deposito_manual', 'extraccion_manual',
  'sueldos', 'aportes_patronales', 'sueldos_pagar', 'ips_pagar', 'anticipos_personal', 'vales'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vale', 'vale_movimiento']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY aislamiento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON vale TO kontiva_app;
GRANT SELECT, INSERT ON vale_movimiento TO kontiva_app;
