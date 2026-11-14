-- RRHH: novedades de asistencia, vacaciones y liquidación final (finiquito).

-- Novedades del día: ausencias, reposo, permisos, llegadas tardías y horas extra. Alimentan la planilla mensual.
CREATE TABLE novedad (
  empresa_id          uuid NOT NULL REFERENCES empresa(id),
  id                  uuid NOT NULL DEFAULT uuid_v7(),
  funcionario_id      uuid NOT NULL,
  fecha               date NOT NULL,
  tipo                text NOT NULL CHECK (tipo IN ('ausencia', 'ausencia_justificada', 'reposo', 'permiso', 'llegada_tardia', 'horas_extra')),
  horas               numeric(18,4) NOT NULL DEFAULT 0 CHECK (horas >= 0 AND horas <= 24),
  recargo             smallint CHECK (recargo IN (50, 100)),
  observacion         text,
  creado_por          uuid NOT NULL,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  FOREIGN KEY (empresa_id, funcionario_id) REFERENCES funcionario(empresa_id, id),
  CHECK ((tipo = 'horas_extra') = (recargo IS NOT NULL))
);
CREATE UNIQUE INDEX novedad_dia ON novedad (empresa_id, funcionario_id, fecha, tipo, coalesce(recargo, 0));
CREATE INDEX novedad_fecha ON novedad (empresa_id, fecha);

-- Vacaciones: goce (días hábiles tomados) y ajustes del saldo (saldo inicial, períodos prescriptos).
-- No se borran: se anulan.
CREATE TABLE vacacion (
  empresa_id          uuid NOT NULL REFERENCES empresa(id),
  id                  uuid NOT NULL DEFAULT uuid_v7(),
  funcionario_id      uuid NOT NULL,
  tipo                text NOT NULL CHECK (tipo IN ('goce', 'ajuste')),
  desde               date,
  hasta               date,
  dias                numeric(18,4) NOT NULL,
  observacion         text,
  estado              text NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente', 'anulada')),
  anulada_por         uuid,
  anulada_en          timestamptz,
  motivo_anulacion    text,
  creado_por          uuid NOT NULL,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  FOREIGN KEY (empresa_id, funcionario_id) REFERENCES funcionario(empresa_id, id),
  CHECK (tipo <> 'goce' OR (desde IS NOT NULL AND hasta >= desde AND dias > 0)),
  CHECK (dias <> 0)
);
CREATE INDEX vacacion_funcionario ON vacacion (empresa_id, funcionario_id);

-- Liquidación final: una por funcionario, con su pago y su asiento como el resto de las liquidaciones.
ALTER TABLE liquidacion DROP CONSTRAINT liquidacion_tipo_check;
ALTER TABLE liquidacion ADD CONSTRAINT liquidacion_tipo_check CHECK (tipo IN ('mensual', 'aguinaldo', 'final'));
DROP INDEX liquidacion_periodo;
CREATE UNIQUE INDEX liquidacion_periodo ON liquidacion (empresa_id, tipo, periodo) WHERE estado <> 'anulada' AND tipo <> 'final';

CREATE TABLE liquidacion_final (
  empresa_id          uuid NOT NULL REFERENCES empresa(id),
  liquidacion_id      uuid NOT NULL,
  funcionario_id      uuid NOT NULL,
  fecha_egreso        date NOT NULL,
  motivo              text NOT NULL CHECK (motivo IN ('renuncia', 'despido_injustificado', 'despido_justificado', 'mutuo_acuerdo', 'fin_contrato')),
  detalle_motivo      text,
  opciones            jsonb NOT NULL,
  promedio_mensual    numeric(18,2),
  cobrado_anio        numeric(18,2) NOT NULL DEFAULT 0,
  detalle_descuentos  text,
  -- Estado del legajo antes de confirmar, para restaurarlo si se anula.
  egreso_anterior     date,
  motivo_anterior     text,
  PRIMARY KEY (empresa_id, liquidacion_id),
  FOREIGN KEY (empresa_id, liquidacion_id) REFERENCES liquidacion(empresa_id, id),
  FOREIGN KEY (empresa_id, funcionario_id) REFERENCES funcionario(empresa_id, id)
);
CREATE INDEX liquidacion_final_funcionario ON liquidacion_final (empresa_id, funcionario_id);

CREATE TABLE liquidacion_concepto (
  empresa_id          uuid NOT NULL REFERENCES empresa(id),
  liquidacion_id      uuid NOT NULL,
  orden               smallint NOT NULL,
  concepto            text NOT NULL CHECK (concepto IN ('dias_trabajados', 'bonificacion', 'otros_ingresos', 'aguinaldo',
                        'vacaciones_causadas', 'vacaciones_proporcionales', 'preaviso', 'indemnizacion')),
  descripcion         text NOT NULL,
  dias                numeric(18,4) NOT NULL DEFAULT 0,
  base                numeric(18,2) NOT NULL DEFAULT 0,
  monto               numeric(18,2) NOT NULL,
  imponible           boolean NOT NULL,
  PRIMARY KEY (empresa_id, liquidacion_id, orden),
  FOREIGN KEY (empresa_id, liquidacion_id) REFERENCES liquidacion(empresa_id, id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['novedad', 'vacacion', 'liquidacion_final', 'liquidacion_concepto']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY aislamiento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON novedad, liquidacion_concepto TO kontiva_app;
GRANT SELECT, INSERT, UPDATE ON vacacion, liquidacion_final TO kontiva_app;
