-- Restaurante: salones y mesas, cuentas (mesa, mostrador), comandas y pantalla de cocina.

-- Dónde se prepara el producto: su comanda aparece en esa pantalla. Sin estación, se sirve directo.
ALTER TABLE producto ADD COLUMN estacion text CHECK (estacion IN ('cocina', 'bar'));

CREATE TABLE salon (
  empresa_id     uuid NOT NULL REFERENCES empresa(id),
  id             uuid NOT NULL DEFAULT uuid_v7(),
  sucursal_id    uuid NOT NULL,
  nombre         text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 60),
  orden          smallint NOT NULL DEFAULT 0,
  activo         boolean NOT NULL DEFAULT true,
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  FOREIGN KEY (empresa_id, sucursal_id) REFERENCES sucursal(empresa_id, id)
);

CREATE TABLE mesa (
  empresa_id     uuid NOT NULL REFERENCES empresa(id),
  id             uuid NOT NULL DEFAULT uuid_v7(),
  salon_id       uuid NOT NULL,
  nombre         text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 20),
  capacidad      smallint NOT NULL DEFAULT 4 CHECK (capacidad BETWEEN 1 AND 50),
  forma          text NOT NULL DEFAULT 'cuadrada' CHECK (forma IN ('cuadrada', 'redonda', 'rectangular')),
  pos_x          smallint NOT NULL DEFAULT 0 CHECK (pos_x BETWEEN 0 AND 23),
  pos_y          smallint NOT NULL DEFAULT 0 CHECK (pos_y BETWEEN 0 AND 23),
  activa         boolean NOT NULL DEFAULT true,
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  FOREIGN KEY (empresa_id, salon_id) REFERENCES salon(empresa_id, id)
);
CREATE UNIQUE INDEX mesa_nombre ON mesa (empresa_id, salon_id, lower(nombre)) WHERE activa;

-- Cuenta abierta de una mesa o de un pedido de mostrador. Se cobra en el PDV, entera o por partes.
CREATE TABLE cuenta_salon (
  empresa_id     uuid NOT NULL REFERENCES empresa(id),
  id             uuid NOT NULL DEFAULT uuid_v7(),
  numero         bigint NOT NULL,
  sucursal_id    uuid NOT NULL,
  tipo           text NOT NULL CHECK (tipo IN ('mesa', 'mostrador')),
  mesa_id        uuid,
  nombre         text CHECK (length(nombre) <= 60),          -- mostrador: a nombre de quién
  comensales     smallint NOT NULL DEFAULT 1 CHECK (comensales BETWEEN 1 AND 99),
  mozo_id        uuid NOT NULL,
  estado         text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada', 'anulada')),
  propina        numeric(18,2) NOT NULL DEFAULT 0 CHECK (propina >= 0),
  nota           text CHECK (length(nota) <= 300),
  abierta_en     timestamptz NOT NULL DEFAULT now(),
  cerrada_en     timestamptz,
  anulada_por    uuid,
  motivo_anulacion text,
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, numero),
  FOREIGN KEY (empresa_id, sucursal_id) REFERENCES sucursal(empresa_id, id),
  FOREIGN KEY (empresa_id, mesa_id) REFERENCES mesa(empresa_id, id),
  CHECK ((tipo = 'mesa') = (mesa_id IS NOT NULL))
);
-- Una mesa tiene a lo sumo una cuenta abierta.
CREATE UNIQUE INDEX cuenta_mesa_abierta ON cuenta_salon (empresa_id, mesa_id) WHERE estado = 'abierta';
CREATE INDEX cuenta_estado ON cuenta_salon (empresa_id, sucursal_id, estado);

CREATE TABLE comanda (
  empresa_id     uuid NOT NULL REFERENCES empresa(id),
  id             uuid NOT NULL DEFAULT uuid_v7(),
  cuenta_id      uuid NOT NULL,
  numero         smallint NOT NULL,
  enviada_en     timestamptz NOT NULL DEFAULT now(),
  creado_por     uuid NOT NULL,
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, cuenta_id, numero),
  FOREIGN KEY (empresa_id, cuenta_id) REFERENCES cuenta_salon(empresa_id, id)
);

CREATE TABLE cuenta_salon_item (
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  id              uuid NOT NULL DEFAULT uuid_v7(),
  cuenta_id       uuid NOT NULL,
  comanda_id      uuid,                                      -- null: todavía no se envió
  variante_id     uuid NOT NULL,
  descripcion     text NOT NULL,
  cantidad        numeric(18,4) NOT NULL CHECK (cantidad > 0),
  precio_unitario numeric(18,2) NOT NULL CHECK (precio_unitario >= 0),
  nota            text CHECK (length(nota) <= 200),
  estacion        text CHECK (estacion IN ('cocina', 'bar')),
  estado          text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviado', 'preparando', 'listo', 'entregado', 'anulado')),
  venta_id        uuid,                                      -- cobrado en esta venta
  listo_en        timestamptz,
  entregado_en    timestamptz,
  anulado_por     uuid,
  motivo_anulacion text,
  creado_por      uuid NOT NULL,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  FOREIGN KEY (empresa_id, cuenta_id) REFERENCES cuenta_salon(empresa_id, id),
  FOREIGN KEY (empresa_id, comanda_id) REFERENCES comanda(empresa_id, id),
  FOREIGN KEY (empresa_id, variante_id) REFERENCES variante(empresa_id, id),
  FOREIGN KEY (empresa_id, venta_id) REFERENCES venta(empresa_id, id)
);
CREATE INDEX cuenta_salon_item_cuenta ON cuenta_salon_item (empresa_id, cuenta_id);
CREATE INDEX cuenta_salon_item_cocina ON cuenta_salon_item (empresa_id, estacion, estado) WHERE estado IN ('enviado', 'preparando', 'listo');

-- La venta que cobra (parte de) una cuenta.
ALTER TABLE venta ADD COLUMN cuenta_salon_id uuid;
ALTER TABLE venta ADD CONSTRAINT venta_cuenta_fk FOREIGN KEY (empresa_id, cuenta_salon_id) REFERENCES cuenta_salon(empresa_id, id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['salon', 'mesa', 'cuenta_salon', 'comanda', 'cuenta_salon_item']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY aislamiento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON salon, mesa, cuenta_salon, comanda TO kontiva_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON cuenta_salon_item TO kontiva_app;
