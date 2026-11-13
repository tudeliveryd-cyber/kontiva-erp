-- Farmacia: datos del medicamento, condición de venta (DNVS) y recetas de las ventas.

ALTER TABLE producto
  ADD COLUMN principio_activo   text CHECK (length(principio_activo) BETWEEN 2 AND 200),
  ADD COLUMN concentracion      text CHECK (length(concentracion) <= 60),
  ADD COLUMN forma              text CHECK (length(forma) <= 60),
  ADD COLUMN registro_sanitario text CHECK (length(registro_sanitario) <= 40),
  ADD COLUMN condicion_venta    text NOT NULL DEFAULT 'libre' CHECK (condicion_venta IN ('libre', 'receta', 'receta_archivada'));
CREATE INDEX producto_principio_trgm ON producto USING gin (principio_activo gin_trgm_ops) WHERE principio_activo IS NOT NULL;

-- Condición de venta de cada línea al momento de vender (el producto puede cambiar después).
ALTER TABLE venta_item ADD COLUMN condicion_venta text CHECK (condicion_venta IN ('receta', 'receta_archivada'));

CREATE TABLE receta (
  empresa_id          uuid NOT NULL REFERENCES empresa(id),
  id                  uuid NOT NULL DEFAULT uuid_v7(),
  venta_id            uuid NOT NULL,
  medico              text NOT NULL CHECK (length(medico) BETWEEN 3 AND 120),
  matricula           text NOT NULL CHECK (length(matricula) BETWEEN 1 AND 30),
  paciente            text NOT NULL CHECK (length(paciente) BETWEEN 3 AND 120),
  paciente_documento  text CHECK (length(paciente_documento) BETWEEN 3 AND 20),
  fecha               date NOT NULL,
  numero              text CHECK (length(numero) <= 30),
  retenida            boolean NOT NULL DEFAULT false,
  creado_por          uuid NOT NULL,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, venta_id),
  FOREIGN KEY (empresa_id, venta_id) REFERENCES venta(empresa_id, id)
);
CREATE INDEX receta_fecha ON receta (empresa_id, creado_en);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['receta']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY aislamiento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON receta TO kontiva_app;
