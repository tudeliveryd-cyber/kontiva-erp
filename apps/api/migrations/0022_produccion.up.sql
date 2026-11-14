-- Producción: recetas, órdenes de producción (consumen insumos y generan producto) y mermas.

ALTER TABLE movimiento_stock DROP CONSTRAINT movimiento_stock_tipo_check;
ALTER TABLE movimiento_stock ADD CONSTRAINT movimiento_stock_tipo_check
  CHECK (tipo IN ('inicial', 'ajuste', 'venta', 'anulacion_venta', 'devolucion', 'compra', 'anulacion_compra', 'transferencia_salida', 'transferencia_entrada', 'transferencia',
                  'produccion_consumo', 'produccion', 'anulacion_produccion', 'merma'));
ALTER TABLE movimiento_lote DROP CONSTRAINT movimiento_lote_tipo_check;
ALTER TABLE movimiento_lote ADD CONSTRAINT movimiento_lote_tipo_check
  CHECK (tipo IN ('inicial', 'ajuste', 'venta', 'anulacion_venta', 'devolucion', 'compra', 'anulacion_compra', 'transferencia_salida', 'transferencia_entrada', 'transferencia',
                  'produccion_consumo', 'produccion', 'anulacion_produccion', 'merma'));

-- Una receta por producto: qué insumos lleva una tanda y cuánto rinde.
CREATE TABLE receta_produccion (
  empresa_id     uuid NOT NULL REFERENCES empresa(id),
  id             uuid NOT NULL DEFAULT uuid_v7(),
  variante_id    uuid NOT NULL,
  rendimiento    numeric(18,4) NOT NULL CHECK (rendimiento > 0),
  minutos        integer CHECK (minutos BETWEEN 1 AND 10080),
  nota           text CHECK (length(nota) <= 1000),
  activa         boolean NOT NULL DEFAULT true,
  creado_por     uuid NOT NULL,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, variante_id),
  FOREIGN KEY (empresa_id, variante_id) REFERENCES variante(empresa_id, id)
);
CREATE TRIGGER receta_produccion_tocar BEFORE UPDATE ON receta_produccion FOR EACH ROW EXECUTE FUNCTION tocar_actualizado_en();

CREATE TABLE receta_produccion_insumo (
  empresa_id     uuid NOT NULL REFERENCES empresa(id),
  receta_id      uuid NOT NULL,
  linea          smallint NOT NULL,
  variante_id    uuid NOT NULL,
  cantidad       numeric(18,4) NOT NULL CHECK (cantidad > 0),
  PRIMARY KEY (empresa_id, receta_id, linea),
  FOREIGN KEY (empresa_id, receta_id) REFERENCES receta_produccion(empresa_id, id),
  FOREIGN KEY (empresa_id, variante_id) REFERENCES variante(empresa_id, id)
);

CREATE TABLE orden_produccion (
  empresa_id            uuid NOT NULL REFERENCES empresa(id),
  id                    uuid NOT NULL DEFAULT uuid_v7(),
  numero                bigint NOT NULL,
  deposito_id           uuid NOT NULL,
  receta_id             uuid NOT NULL,
  variante_id           uuid NOT NULL,
  fecha                 date NOT NULL,
  cantidad_planificada  numeric(18,4) NOT NULL CHECK (cantidad_planificada > 0),
  cantidad_producida    numeric(18,4) CHECK (cantidad_producida > 0),
  estado                text NOT NULL DEFAULT 'planificada' CHECK (estado IN ('planificada', 'terminada', 'anulada')),
  costo_total           numeric(18,2),
  costo_unitario        numeric(18,2),
  lote_codigo           text CHECK (length(lote_codigo) BETWEEN 1 AND 40),
  lote_vencimiento      date,
  nota                  text CHECK (length(nota) <= 500),
  creado_por            uuid NOT NULL,
  creado_en             timestamptz NOT NULL DEFAULT now(),
  terminada_por         uuid,
  terminada_en          timestamptz,
  anulada_por           uuid,
  anulada_en            timestamptz,
  motivo_anulacion      text,
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, numero),
  FOREIGN KEY (empresa_id, deposito_id) REFERENCES deposito(empresa_id, id),
  FOREIGN KEY (empresa_id, receta_id) REFERENCES receta_produccion(empresa_id, id),
  FOREIGN KEY (empresa_id, variante_id) REFERENCES variante(empresa_id, id),
  CHECK ((estado = 'terminada') = (cantidad_producida IS NOT NULL AND terminada_en IS NOT NULL) OR estado = 'anulada')
);
CREATE INDEX orden_produccion_fecha ON orden_produccion (empresa_id, estado, fecha);

CREATE TABLE orden_produccion_insumo (
  empresa_id       uuid NOT NULL REFERENCES empresa(id),
  orden_id         uuid NOT NULL,
  linea            smallint NOT NULL,
  variante_id      uuid NOT NULL,
  cantidad_teorica numeric(18,4) NOT NULL CHECK (cantidad_teorica > 0),
  cantidad_real    numeric(18,4) CHECK (cantidad_real >= 0),
  costo_unitario   numeric(18,2),
  PRIMARY KEY (empresa_id, orden_id, linea),
  FOREIGN KEY (empresa_id, orden_id) REFERENCES orden_produccion(empresa_id, id),
  FOREIGN KEY (empresa_id, variante_id) REFERENCES variante(empresa_id, id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['receta_produccion', 'receta_produccion_insumo', 'orden_produccion', 'orden_produccion_insumo']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY aislamiento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON receta_produccion, orden_produccion, orden_produccion_insumo TO kontiva_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON receta_produccion_insumo TO kontiva_app;
