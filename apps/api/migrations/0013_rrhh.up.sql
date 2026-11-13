-- RRHH: funcionarios, parámetros laborales, liquidaciones de sueldos y aguinaldo (con su pago y su asiento).

CREATE TABLE rrhh_configuracion (
  empresa_id          uuid PRIMARY KEY REFERENCES empresa(id),
  salario_minimo      numeric(18,2) NOT NULL CHECK (salario_minimo > 0),
  ips_obrero          numeric(5,2) NOT NULL CHECK (ips_obrero BETWEEN 0 AND 100),
  ips_patronal        numeric(5,2) NOT NULL CHECK (ips_patronal BETWEEN 0 AND 100),
  bonificacion_pct    numeric(5,2) NOT NULL CHECK (bonificacion_pct BETWEEN 0 AND 100),
  bonificacion_tope   numeric(5,2) NOT NULL CHECK (bonificacion_tope > 0),   -- en salarios mínimos
  actualizado_por     uuid,
  actualizado_en      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE funcionario (
  empresa_id          uuid NOT NULL REFERENCES empresa(id),
  id                  uuid NOT NULL DEFAULT uuid_v7(),
  sucursal_id         uuid NOT NULL,
  nombre              text NOT NULL CHECK (length(nombre) BETWEEN 3 AND 160),
  documento           text NOT NULL CHECK (length(documento) BETWEEN 3 AND 20),
  fecha_nacimiento    date,
  telefono            text,
  email               text,
  direccion           text,
  cargo               text NOT NULL CHECK (length(cargo) BETWEEN 2 AND 80),
  fecha_ingreso       date NOT NULL,
  fecha_egreso        date,
  motivo_egreso       text,
  remuneracion        text NOT NULL CHECK (remuneracion IN ('mensual', 'jornal')),
  salario             numeric(18,2) NOT NULL CHECK (salario >= 0),   -- mensual o por jornal
  hijos               integer NOT NULL DEFAULT 0 CHECK (hijos BETWEEN 0 AND 30),
  asegurado_ips       boolean NOT NULL DEFAULT true,
  numero_ips          text,
  banco               text,
  cuenta_bancaria     text,
  usuario_id          uuid,
  nota                text,
  creado_por          uuid NOT NULL,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, documento),
  FOREIGN KEY (empresa_id, sucursal_id) REFERENCES sucursal(empresa_id, id),
  CHECK (fecha_egreso IS NULL OR fecha_egreso >= fecha_ingreso)
);

CREATE TABLE liquidacion (
  empresa_id          uuid NOT NULL REFERENCES empresa(id),
  id                  uuid NOT NULL DEFAULT uuid_v7(),
  tipo                text NOT NULL CHECK (tipo IN ('mensual', 'aguinaldo')),
  periodo             date NOT NULL,                 -- primer día del mes; aguinaldo: 1 de enero del año
  estado              text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'confirmada', 'anulada')),
  salario_minimo      numeric(18,2) NOT NULL,
  ips_obrero_pct      numeric(5,2) NOT NULL,
  ips_patronal_pct    numeric(5,2) NOT NULL,
  bruto               numeric(18,2) NOT NULL DEFAULT 0,
  ips_obrero          numeric(18,2) NOT NULL DEFAULT 0,
  ips_patronal        numeric(18,2) NOT NULL DEFAULT 0,
  descuentos          numeric(18,2) NOT NULL DEFAULT 0,
  neto                numeric(18,2) NOT NULL DEFAULT 0,
  confirmada_por      uuid,
  confirmada_en       timestamptz,
  pago_fecha          date,
  pago_medio          text CHECK (pago_medio IN ('banco', 'efectivo')),
  pago_cuenta_id      uuid,
  pago_sesion_caja_id uuid,
  pagada_por          uuid,
  anulada_por         uuid,
  anulada_en          timestamptz,
  motivo_anulacion    text,
  creado_por          uuid NOT NULL,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  FOREIGN KEY (empresa_id, pago_cuenta_id) REFERENCES cuenta_bancaria(empresa_id, id)
);
CREATE UNIQUE INDEX liquidacion_periodo ON liquidacion (empresa_id, tipo, periodo) WHERE estado <> 'anulada';

CREATE TABLE liquidacion_item (
  empresa_id          uuid NOT NULL REFERENCES empresa(id),
  liquidacion_id      uuid NOT NULL,
  funcionario_id      uuid NOT NULL,
  dias                numeric(18,4) NOT NULL DEFAULT 30,
  salario_base        numeric(18,2) NOT NULL DEFAULT 0,
  horas_extra_50      numeric(18,4) NOT NULL DEFAULT 0,
  horas_extra_100     numeric(18,4) NOT NULL DEFAULT 0,
  monto_horas_extra   numeric(18,2) NOT NULL DEFAULT 0,
  otros_ingresos      numeric(18,2) NOT NULL DEFAULT 0,     -- comisiones, premios (imponibles)
  bonificacion        numeric(18,2) NOT NULL DEFAULT 0,     -- bonificación familiar (no imponible)
  imponible           numeric(18,2) NOT NULL DEFAULT 0,
  bruto               numeric(18,2) NOT NULL DEFAULT 0,
  ips_obrero          numeric(18,2) NOT NULL DEFAULT 0,
  ips_patronal        numeric(18,2) NOT NULL DEFAULT 0,
  descuentos          numeric(18,2) NOT NULL DEFAULT 0,     -- adelantos, faltas, otros
  detalle_descuentos  text,
  neto                numeric(18,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (empresa_id, liquidacion_id, funcionario_id),
  FOREIGN KEY (empresa_id, liquidacion_id) REFERENCES liquidacion(empresa_id, id),
  FOREIGN KEY (empresa_id, funcionario_id) REFERENCES funcionario(empresa_id, id)
);

-- Pago de sueldos desde el banco.
ALTER TABLE movimiento_bancario DROP CONSTRAINT movimiento_bancario_tipo_check;
ALTER TABLE movimiento_bancario ADD CONSTRAINT movimiento_bancario_tipo_check CHECK (tipo IN ('deposito', 'extraccion', 'transferencia_entrada',
  'transferencia_salida', 'pago_proveedor', 'cobro', 'deposito_caja', 'gasto', 'ingreso', 'anulacion', 'sueldos'));

-- Conceptos contables de sueldos.
ALTER TABLE cuenta_concepto DROP CONSTRAINT cuenta_concepto_concepto_check;
ALTER TABLE cuenta_concepto ADD CONSTRAINT cuenta_concepto_concepto_check CHECK (concepto IN ('caja', 'valores', 'bancos', 'transferencias',
  'deudores', 'iva_credito', 'mercaderias', 'proveedores', 'iva_debito', 'ventas', 'devoluciones_ventas', 'costo_ventas',
  'gastos_generales', 'gastos_bancarios', 'ingresos_financieros', 'deposito_manual', 'extraccion_manual',
  'sueldos', 'aportes_patronales', 'sueldos_pagar', 'ips_pagar', 'anticipos_personal'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rrhh_configuracion', 'funcionario', 'liquidacion', 'liquidacion_item']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY aislamiento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON rrhh_configuracion, funcionario, liquidacion TO kontiva_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON liquidacion_item TO kontiva_app;
