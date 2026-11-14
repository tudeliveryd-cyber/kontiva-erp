-- Distribuidora: rutas de visita, repartos (hoja de carga y de ruta) y rendición del repartidor.
-- Ferretería: presentaciones de venta y compra (caja x 100, rollo de 50 m) sobre la unidad base del stock.

CREATE TABLE ruta (
  empresa_id   uuid NOT NULL REFERENCES empresa(id),
  id           uuid NOT NULL DEFAULT uuid_v7(),
  sucursal_id  uuid NOT NULL,
  nombre       text NOT NULL CHECK (length(nombre) BETWEEN 2 AND 80),
  dias         smallint[] NOT NULL DEFAULT '{}' CHECK (dias <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  nota         text CHECK (length(nota) <= 500),
  activa       boolean NOT NULL DEFAULT true,
  creado_en    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  FOREIGN KEY (empresa_id, sucursal_id) REFERENCES sucursal(empresa_id, id)
);
CREATE UNIQUE INDEX ruta_nombre ON ruta (empresa_id, lower(nombre)) WHERE activa;

ALTER TABLE cliente
  ADD COLUMN ruta_id uuid,
  ADD COLUMN orden_ruta integer CHECK (orden_ruta IS NULL OR orden_ruta >= 0),
  ADD FOREIGN KEY (empresa_id, ruta_id) REFERENCES ruta(empresa_id, id);
CREATE INDEX cliente_ruta ON cliente (empresa_id, ruta_id, orden_ruta) WHERE ruta_id IS NOT NULL;

CREATE TABLE reparto (
  empresa_id         uuid NOT NULL REFERENCES empresa(id),
  id                 uuid NOT NULL DEFAULT uuid_v7(),
  numero             bigint NOT NULL,
  sucursal_id        uuid NOT NULL,
  caja_id            uuid NOT NULL,           -- caja donde se facturan los pedidos y se rinde el dinero
  ruta_id            uuid,
  fecha              date NOT NULL,
  repartidor         text NOT NULL CHECK (length(repartidor) BETWEEN 2 AND 120),
  funcionario_id     uuid,
  vehiculo           text CHECK (length(vehiculo) <= 60),
  nota               text CHECK (length(nota) <= 500),
  estado             text NOT NULL DEFAULT 'preparacion' CHECK (estado IN ('preparacion', 'en_ruta', 'rendido', 'anulado')),
  despachado_en      timestamptz,
  despachado_por     uuid,
  rendido_en         timestamptz,
  rendido_por        uuid,
  efectivo_esperado  numeric(18,2),
  efectivo_entregado numeric(18,2),
  creado_por         uuid NOT NULL,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, numero),
  FOREIGN KEY (empresa_id, sucursal_id) REFERENCES sucursal(empresa_id, id),
  FOREIGN KEY (empresa_id, caja_id) REFERENCES caja(empresa_id, id),
  FOREIGN KEY (empresa_id, ruta_id) REFERENCES ruta(empresa_id, id),
  FOREIGN KEY (empresa_id, funcionario_id) REFERENCES funcionario(empresa_id, id)
);
CREATE INDEX reparto_fecha ON reparto (empresa_id, fecha DESC);

CREATE TABLE reparto_pedido (
  empresa_id     uuid NOT NULL,
  reparto_id     uuid NOT NULL,
  pedido_id      uuid NOT NULL,
  orden          integer NOT NULL,
  estado         text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'entregado', 'parcial', 'rechazado')),
  venta_id       uuid,
  devolucion_id  uuid,
  cobro_id       uuid,
  cobrado        numeric(18,2) NOT NULL DEFAULT 0 CHECK (cobrado >= 0),
  medio          text CHECK (medio IN ('efectivo', 'transferencia', 'cheque', 'otro')),
  motivo         text CHECK (length(motivo) <= 300),
  PRIMARY KEY (empresa_id, reparto_id, pedido_id),
  FOREIGN KEY (empresa_id, reparto_id) REFERENCES reparto(empresa_id, id),
  FOREIGN KEY (empresa_id, pedido_id) REFERENCES pedido(empresa_id, id),
  FOREIGN KEY (empresa_id, venta_id) REFERENCES venta(empresa_id, id),
  FOREIGN KEY (empresa_id, devolucion_id) REFERENCES devolucion(empresa_id, id),
  FOREIGN KEY (empresa_id, cobro_id) REFERENCES cobro_cliente(empresa_id, id)
);
CREATE INDEX reparto_pedido_pedido ON reparto_pedido (empresa_id, pedido_id);

-- Presentaciones: se venden y se compran en "cajas" o "rollos"; el stock y el costo siguen en la unidad base.
CREATE TABLE presentacion (
  empresa_id   uuid NOT NULL REFERENCES empresa(id),
  id           uuid NOT NULL DEFAULT uuid_v7(),
  variante_id  uuid NOT NULL,
  nombre       text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 40),
  factor       numeric(18,4) NOT NULL CHECK (factor > 0 AND factor <> 1),
  precio       numeric(18,2) CHECK (precio IS NULL OR precio >= 0),   -- sin precio: factor × precio de la unidad
  activa       boolean NOT NULL DEFAULT true,
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  FOREIGN KEY (empresa_id, variante_id) REFERENCES variante(empresa_id, id)
);
CREATE INDEX presentacion_variante ON presentacion (empresa_id, variante_id) WHERE activa;
CREATE UNIQUE INDEX presentacion_nombre ON presentacion (empresa_id, variante_id, lower(nombre)) WHERE activa;

ALTER TABLE codigo_barras ADD COLUMN presentacion_id uuid,
  ADD FOREIGN KEY (empresa_id, presentacion_id) REFERENCES presentacion(empresa_id, id) ON DELETE CASCADE;

-- Precio y costo por unidad base con cuatro decimales: una caja de 12 a 10.000 es 833,3333 por unidad.
ALTER TABLE venta_item ALTER COLUMN precio_unitario TYPE numeric(18,4);
ALTER TABLE compra_item ALTER COLUMN costo_unitario TYPE numeric(18,4);
ALTER TABLE venta_item ADD COLUMN presentacion text CHECK (length(presentacion) <= 60);
ALTER TABLE compra_item ADD COLUMN presentacion text CHECK (length(presentacion) <= 60);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ruta', 'reparto', 'reparto_pedido', 'presentacion']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY aislamiento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON ruta, reparto, reparto_pedido, presentacion TO kontiva_app;
GRANT DELETE ON reparto_pedido TO kontiva_app;
