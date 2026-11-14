-- Reloj de asistencia: código del funcionario en el reloj, horario y marcaciones importadas.

ALTER TABLE funcionario
  ADD COLUMN codigo_reloj     text CHECK (codigo_reloj ~ '^[0-9A-Za-z]{1,20}$'),
  ADD COLUMN horario_entrada  time,
  ADD COLUMN horario_salida   time,
  ADD COLUMN trabaja_sabado   boolean NOT NULL DEFAULT true,
  ADD COLUMN sabado_salida    time,
  ADD CONSTRAINT funcionario_horario CHECK ((horario_entrada IS NULL) = (horario_salida IS NULL) AND (horario_salida IS NULL OR horario_salida > horario_entrada));
CREATE UNIQUE INDEX funcionario_codigo_reloj ON funcionario (empresa_id, codigo_reloj) WHERE codigo_reloj IS NOT NULL;

CREATE TABLE marcacion (
  empresa_id          uuid NOT NULL REFERENCES empresa(id),
  id                  uuid NOT NULL DEFAULT uuid_v7(),
  funcionario_id      uuid NOT NULL,
  fecha               date NOT NULL,
  hora                time(0) NOT NULL,
  origen              text NOT NULL CHECK (origen IN ('reloj', 'manual')),
  creado_por          uuid NOT NULL,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  FOREIGN KEY (empresa_id, funcionario_id) REFERENCES funcionario(empresa_id, id)
);
CREATE UNIQUE INDEX marcacion_unica ON marcacion (empresa_id, funcionario_id, fecha, hora);
CREATE INDEX marcacion_fecha ON marcacion (empresa_id, fecha);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['marcacion']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY aislamiento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, DELETE ON marcacion TO kontiva_app;
