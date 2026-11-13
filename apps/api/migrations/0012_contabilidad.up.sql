-- Contabilidad: plan de cuentas, conceptos (qué cuenta usa cada operación automática),
-- asientos (manuales y generados desde los documentos) y cierres de período.
-- Los asientos no se editan ni se borran: un error se corrige con un asiento inverso.

CREATE TABLE cuenta_contable (
  empresa_id  uuid NOT NULL REFERENCES empresa(id),
  id          uuid NOT NULL DEFAULT uuid_v7(),
  codigo      text NOT NULL CHECK (codigo ~ '^[0-9]+(\.[0-9]+)*$'),
  nombre      text NOT NULL CHECK (length(nombre) BETWEEN 2 AND 120),
  tipo        text NOT NULL CHECK (tipo IN ('activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto')),
  imputable   boolean NOT NULL,
  padre_id    uuid,
  activa      boolean NOT NULL DEFAULT true,
  creado_en   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, codigo),
  FOREIGN KEY (empresa_id, padre_id) REFERENCES cuenta_contable(empresa_id, id)
);

CREATE TABLE cuenta_concepto (
  empresa_id  uuid NOT NULL REFERENCES empresa(id),
  concepto    text NOT NULL CHECK (concepto IN ('caja', 'valores', 'bancos', 'transferencias', 'deudores', 'iva_credito',
                                                'mercaderias', 'proveedores', 'iva_debito', 'ventas', 'devoluciones_ventas',
                                                'costo_ventas', 'gastos_generales', 'gastos_bancarios', 'ingresos_financieros',
                                                'deposito_manual', 'extraccion_manual')),
  cuenta_id   uuid NOT NULL,
  PRIMARY KEY (empresa_id, concepto),
  FOREIGN KEY (empresa_id, cuenta_id) REFERENCES cuenta_contable(empresa_id, id)
);

ALTER TABLE cuenta_bancaria ADD COLUMN cuenta_contable_id uuid;
ALTER TABLE cuenta_bancaria ADD CONSTRAINT cuenta_bancaria_contable_fk FOREIGN KEY (empresa_id, cuenta_contable_id) REFERENCES cuenta_contable(empresa_id, id);

CREATE TABLE asiento (
  empresa_id     uuid NOT NULL REFERENCES empresa(id),
  id             uuid NOT NULL DEFAULT uuid_v7(),
  numero         integer NOT NULL,
  fecha          date NOT NULL,
  descripcion    text NOT NULL CHECK (length(descripcion) BETWEEN 3 AND 300),
  origen_tipo    text NOT NULL,          -- manual, reversion, venta, venta_anulacion, compra, ...
  origen_id      uuid,
  estado         text NOT NULL DEFAULT 'confirmado' CHECK (estado IN ('confirmado', 'anulado')),
  anulado_por    uuid,
  anulado_en     timestamptz,
  motivo_anulacion text,
  creado_por     uuid NOT NULL,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, numero)
);
-- Un documento genera un solo asiento por tipo de origen (la contabilización es idempotente).
CREATE UNIQUE INDEX asiento_origen ON asiento (empresa_id, origen_tipo, origen_id) WHERE origen_id IS NOT NULL;
CREATE INDEX asiento_fecha ON asiento (empresa_id, fecha);

CREATE TABLE asiento_linea (
  empresa_id  uuid NOT NULL REFERENCES empresa(id),
  asiento_id  uuid NOT NULL,
  linea       integer NOT NULL,
  cuenta_id   uuid NOT NULL,
  debe        numeric(18,2) NOT NULL DEFAULT 0 CHECK (debe >= 0),
  haber       numeric(18,2) NOT NULL DEFAULT 0 CHECK (haber >= 0),
  detalle     text,
  PRIMARY KEY (empresa_id, asiento_id, linea),
  CHECK ((debe > 0) <> (haber > 0)),
  FOREIGN KEY (empresa_id, asiento_id) REFERENCES asiento(empresa_id, id),
  FOREIGN KEY (empresa_id, cuenta_id) REFERENCES cuenta_contable(empresa_id, id)
);
CREATE INDEX asiento_linea_cuenta ON asiento_linea (empresa_id, cuenta_id);

-- Historial de cierres y reaperturas; vale el último registro (hasta NULL = nada cerrado).
CREATE TABLE cierre_contable (
  empresa_id  uuid NOT NULL REFERENCES empresa(id),
  id          uuid NOT NULL DEFAULT uuid_v7(),
  accion      text NOT NULL CHECK (accion IN ('cierre', 'reapertura')),
  hasta       date,
  motivo      text,
  usuario_id  uuid NOT NULL,
  creado_en   timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id)
);

CREATE FUNCTION contabilidad_cerrado_hasta(e uuid) RETURNS date LANGUAGE sql STABLE AS $$
  SELECT hasta FROM cierre_contable WHERE empresa_id = e ORDER BY creado_en DESC, id DESC LIMIT 1
$$;

-- Debe = haber, verificado al final de la transacción.
CREATE FUNCTION asiento_balanceado() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric; h numeric; n int;
BEGIN
  SELECT coalesce(sum(debe), 0), coalesce(sum(haber), 0), count(*) INTO d, h, n
    FROM asiento_linea WHERE empresa_id = NEW.empresa_id AND asiento_id = NEW.id;
  IF n < 2 OR d <> h THEN
    RAISE EXCEPTION 'Asiento desbalanceado (debe %, haber %, % líneas)', d, h, n USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER asiento_balanceado AFTER INSERT ON asiento
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION asiento_balanceado();

-- No se registran asientos en un período cerrado.
CREATE FUNCTION asiento_periodo_abierto() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c date;
BEGIN
  c := contabilidad_cerrado_hasta(NEW.empresa_id);
  IF c IS NOT NULL AND NEW.fecha <= c THEN
    RAISE EXCEPTION 'El período está cerrado hasta %', c USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER asiento_periodo_abierto BEFORE INSERT ON asiento FOR EACH ROW EXECUTE FUNCTION asiento_periodo_abierto();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cuenta_contable', 'cuenta_concepto', 'asiento', 'asiento_linea', 'cierre_contable']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY aislamiento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON cuenta_contable TO kontiva_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON cuenta_concepto TO kontiva_app;
GRANT SELECT, INSERT, UPDATE ON asiento TO kontiva_app;
GRANT SELECT, INSERT ON asiento_linea, cierre_contable TO kontiva_app;
GRANT EXECUTE ON FUNCTION contabilidad_cerrado_hasta(uuid) TO kontiva_app;
