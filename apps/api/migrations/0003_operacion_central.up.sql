-- KONTIVA ERP · Migración 0003 · Operación central (Fase 1)
-- Catálogo, depósitos y stock, clientes, cotizaciones, cajas y ventas.
--
-- Reglas (ver CLAUDE.md): empresa_id + RLS forzado en todo, claves foráneas compuestas,
-- dinero numeric(18,2), cantidades numeric(18,4), movimientos de stock y caja solo de inserción.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------

CREATE TABLE categoria (
  empresa_id  uuid NOT NULL REFERENCES empresa(id),
  id          uuid NOT NULL DEFAULT uuid_v7(),
  nombre      text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 80),
  activa      boolean NOT NULL DEFAULT true,
  creado_en   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, nombre)
);

CREATE TABLE marca (
  empresa_id  uuid NOT NULL REFERENCES empresa(id),
  id          uuid NOT NULL DEFAULT uuid_v7(),
  nombre      text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 80),
  creado_en   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, nombre)
);

CREATE TABLE producto (
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  id              uuid NOT NULL DEFAULT uuid_v7(),
  nombre          text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 200),
  descripcion     text,
  categoria_id    uuid,
  marca_id        uuid,
  tipo            text NOT NULL DEFAULT 'producto' CHECK (tipo IN ('producto', 'servicio')),
  unidad          text NOT NULL DEFAULT 'unidad'
                  CHECK (unidad IN ('unidad', 'kg', 'g', 'litro', 'ml', 'metro', 'm2', 'm3', 'caja', 'paquete')),
  -- IVA incluido en el precio (Paraguay): 10 %, 5 % o exento.
  tasa_iva        numeric(5,2) NOT NULL DEFAULT 10 CHECK (tasa_iva IN (0, 5, 10)),
  controla_stock  boolean NOT NULL DEFAULT true,
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid,
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  FOREIGN KEY (empresa_id, categoria_id) REFERENCES categoria(empresa_id, id),
  FOREIGN KEY (empresa_id, marca_id) REFERENCES marca(empresa_id, id),
  CHECK (tipo = 'producto' OR NOT controla_stock)
);
CREATE INDEX producto_nombre_trgm ON producto USING gin (nombre gin_trgm_ops);
CREATE TRIGGER producto_tocar BEFORE UPDATE ON producto FOR EACH ROW EXECUTE FUNCTION tocar_actualizado_en();

-- Todo producto tiene al menos una variante (la predeterminada, sin nombre).
CREATE TABLE variante (
  empresa_id      uuid NOT NULL,
  id              uuid NOT NULL DEFAULT uuid_v7(),
  producto_id     uuid NOT NULL,
  nombre          text,                                   -- "Talle M · Rojo"; NULL = única
  sku             text,
  costo           numeric(18,2) NOT NULL DEFAULT 0 CHECK (costo >= 0),   -- costo promedio (confidencial)
  activa          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  FOREIGN KEY (empresa_id, producto_id) REFERENCES producto(empresa_id, id)
);
CREATE UNIQUE INDEX variante_sku ON variante (empresa_id, lower(sku)) WHERE sku IS NOT NULL;
CREATE INDEX variante_producto ON variante (empresa_id, producto_id);
CREATE TRIGGER variante_tocar BEFORE UPDATE ON variante FOR EACH ROW EXECUTE FUNCTION tocar_actualizado_en();

CREATE TABLE codigo_barras (
  empresa_id   uuid NOT NULL,
  codigo       text NOT NULL CHECK (codigo ~ '^[0-9A-Za-z\-\.]{3,40}$'),
  variante_id  uuid NOT NULL,
  PRIMARY KEY (empresa_id, codigo),
  FOREIGN KEY (empresa_id, variante_id) REFERENCES variante(empresa_id, id) ON DELETE CASCADE
);
CREATE INDEX codigo_barras_variante ON codigo_barras (empresa_id, variante_id);

CREATE TABLE lista_precio (
  empresa_id        uuid NOT NULL REFERENCES empresa(id),
  id                uuid NOT NULL DEFAULT uuid_v7(),
  nombre            text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 80),
  predeterminada    boolean NOT NULL DEFAULT false,
  activa            boolean NOT NULL DEFAULT true,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, nombre)
);
CREATE UNIQUE INDEX lista_precio_una_predeterminada ON lista_precio (empresa_id) WHERE predeterminada;

-- Precio en guaraníes (IVA incluido). sucursal_id NULL = precio general de la lista.
CREATE TABLE precio (
  empresa_id   uuid NOT NULL,
  lista_id     uuid NOT NULL,
  variante_id  uuid NOT NULL,
  sucursal_id  uuid,
  precio       numeric(18,2) NOT NULL CHECK (precio >= 0),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (empresa_id, lista_id) REFERENCES lista_precio(empresa_id, id),
  FOREIGN KEY (empresa_id, variante_id) REFERENCES variante(empresa_id, id) ON DELETE CASCADE,
  FOREIGN KEY (empresa_id, sucursal_id) REFERENCES sucursal(empresa_id, id)
);
CREATE UNIQUE INDEX precio_unico ON precio (empresa_id, lista_id, variante_id, coalesce(sucursal_id, '00000000-0000-0000-0000-000000000000'));

-- ---------------------------------------------------------------------------
-- Depósitos y stock
-- ---------------------------------------------------------------------------

CREATE TABLE deposito (
  empresa_id   uuid NOT NULL,
  id           uuid NOT NULL DEFAULT uuid_v7(),
  sucursal_id  uuid NOT NULL,
  nombre       text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 80),
  activo       boolean NOT NULL DEFAULT true,
  creado_en    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, sucursal_id, nombre),
  FOREIGN KEY (empresa_id, sucursal_id) REFERENCES sucursal(empresa_id, id)
);

-- Saldo materializado: se actualiza en la misma transacción que el movimiento.
CREATE TABLE stock (
  empresa_id   uuid NOT NULL,
  variante_id  uuid NOT NULL,
  deposito_id  uuid NOT NULL,
  cantidad     numeric(18,4) NOT NULL DEFAULT 0,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, variante_id, deposito_id),
  FOREIGN KEY (empresa_id, variante_id) REFERENCES variante(empresa_id, id),
  FOREIGN KEY (empresa_id, deposito_id) REFERENCES deposito(empresa_id, id)
);

-- Fuente de verdad del inventario: cada cambio de stock es una fila (solo inserción).
CREATE TABLE movimiento_stock (
  empresa_id     uuid NOT NULL,
  id             bigint GENERATED ALWAYS AS IDENTITY,
  variante_id    uuid NOT NULL,
  deposito_id    uuid NOT NULL,
  tipo           text NOT NULL CHECK (tipo IN ('inicial', 'ajuste', 'venta', 'anulacion_venta', 'compra', 'transferencia')),
  cantidad       numeric(18,4) NOT NULL CHECK (cantidad <> 0),   -- con signo
  saldo          numeric(18,4) NOT NULL,                          -- saldo después del movimiento
  costo_unitario numeric(18,2),
  origen_id      uuid,                                            -- venta, ajuste...
  motivo         text,
  creado_por     uuid,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  FOREIGN KEY (empresa_id, variante_id) REFERENCES variante(empresa_id, id),
  FOREIGN KEY (empresa_id, deposito_id) REFERENCES deposito(empresa_id, id)
);
CREATE INDEX movimiento_stock_variante ON movimiento_stock (empresa_id, variante_id, creado_en DESC);

-- ---------------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------------

CREATE TABLE cliente (
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  id              uuid NOT NULL DEFAULT uuid_v7(),
  nombre          text NOT NULL CHECK (length(nombre) BETWEEN 2 AND 200),
  documento       text,                 -- RUC (80012345-6) o cédula
  telefono        text,
  email           citext,
  direccion       text,
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid,
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id)
);
CREATE UNIQUE INDEX cliente_documento ON cliente (empresa_id, documento) WHERE documento IS NOT NULL;
CREATE INDEX cliente_nombre_trgm ON cliente USING gin (nombre gin_trgm_ops);
CREATE TRIGGER cliente_tocar BEFORE UPDATE ON cliente FOR EACH ROW EXECUTE FUNCTION tocar_actualizado_en();

-- ---------------------------------------------------------------------------
-- Monedas: cotización del día por sucursal (guaraníes por unidad de moneda extranjera)
-- ---------------------------------------------------------------------------

CREATE TABLE cotizacion (
  empresa_id    uuid NOT NULL,
  id            uuid NOT NULL DEFAULT uuid_v7(),
  sucursal_id   uuid NOT NULL,
  moneda        text NOT NULL CHECK (moneda IN ('USD', 'BRL')),
  compra        numeric(18,4) NOT NULL CHECK (compra > 0),   -- cuando el cliente paga en esa moneda
  venta         numeric(18,4) NOT NULL CHECK (venta > 0),    -- cuando se da vuelto en esa moneda
  creado_por    uuid,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  FOREIGN KEY (empresa_id, sucursal_id) REFERENCES sucursal(empresa_id, id)
);
CREATE INDEX cotizacion_vigente ON cotizacion (empresa_id, sucursal_id, moneda, creado_en DESC);

-- ---------------------------------------------------------------------------
-- Cajas
-- ---------------------------------------------------------------------------

CREATE TABLE caja (
  empresa_id     uuid NOT NULL,
  id             uuid NOT NULL DEFAULT uuid_v7(),
  sucursal_id    uuid NOT NULL,
  deposito_id    uuid NOT NULL,               -- de dónde descuenta el stock
  nombre         text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 60),
  ultimo_numero  bigint NOT NULL DEFAULT 0,   -- numeración interna de comprobantes
  activa         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, sucursal_id, nombre),
  FOREIGN KEY (empresa_id, sucursal_id) REFERENCES sucursal(empresa_id, id),
  FOREIGN KEY (empresa_id, deposito_id) REFERENCES deposito(empresa_id, id)
);

CREATE TABLE sesion_caja (
  empresa_id   uuid NOT NULL,
  id           uuid NOT NULL DEFAULT uuid_v7(),
  caja_id      uuid NOT NULL,
  usuario_id   uuid NOT NULL,                 -- quien la abrió y opera
  estado       text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada')),
  abierta_en   timestamptz NOT NULL DEFAULT now(),
  cerrada_en   timestamptz,
  cerrada_por  uuid,
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  FOREIGN KEY (empresa_id, caja_id) REFERENCES caja(empresa_id, id),
  FOREIGN KEY (empresa_id, usuario_id) REFERENCES usuario(empresa_id, id)
);
-- Una sola sesión abierta por caja.
CREATE UNIQUE INDEX sesion_caja_abierta ON sesion_caja (empresa_id, caja_id) WHERE estado = 'abierta';

-- Todo movimiento de dinero de la sesión (solo inserción). Monto con signo, en su moneda.
CREATE TABLE movimiento_caja (
  empresa_id   uuid NOT NULL,
  id           bigint GENERATED ALWAYS AS IDENTITY,
  sesion_id    uuid NOT NULL,
  tipo         text NOT NULL CHECK (tipo IN ('apertura', 'venta', 'vuelto', 'anulacion', 'retiro', 'ingreso')),
  medio        text NOT NULL CHECK (medio IN ('efectivo', 'tarjeta', 'transferencia', 'otro')),
  moneda       text NOT NULL CHECK (moneda IN ('PYG', 'USD', 'BRL')),
  monto        numeric(18,2) NOT NULL,
  venta_id     uuid,
  motivo       text,
  autorizado_por uuid,
  creado_por   uuid NOT NULL,
  creado_en    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  FOREIGN KEY (empresa_id, sesion_id) REFERENCES sesion_caja(empresa_id, id)
);
CREATE INDEX movimiento_caja_sesion ON movimiento_caja (empresa_id, sesion_id);

-- Cierre: lo esperado según los movimientos contra lo contado, por moneda y medio.
CREATE TABLE arqueo (
  empresa_id  uuid NOT NULL,
  sesion_id   uuid NOT NULL,
  moneda      text NOT NULL CHECK (moneda IN ('PYG', 'USD', 'BRL')),
  medio       text NOT NULL CHECK (medio IN ('efectivo', 'tarjeta', 'transferencia', 'otro')),
  esperado    numeric(18,2) NOT NULL,
  contado     numeric(18,2) NOT NULL,
  diferencia  numeric(18,2) GENERATED ALWAYS AS (contado - esperado) STORED,
  PRIMARY KEY (empresa_id, sesion_id, moneda, medio),
  FOREIGN KEY (empresa_id, sesion_id) REFERENCES sesion_caja(empresa_id, id)
);

-- ---------------------------------------------------------------------------
-- Ventas
-- ---------------------------------------------------------------------------

CREATE TABLE venta (
  empresa_id          uuid NOT NULL,
  id                  uuid NOT NULL DEFAULT uuid_v7(),
  sucursal_id         uuid NOT NULL,
  caja_id             uuid NOT NULL,
  sesion_caja_id      uuid NOT NULL,
  numero              bigint NOT NULL,           -- correlativo interno por caja
  clave_idempotencia  text NOT NULL,
  cliente_id          uuid,
  estado              text NOT NULL DEFAULT 'confirmada' CHECK (estado IN ('confirmada', 'anulada')),
  -- Sin certificado y CSC cargados no hay factura electrónica: comprobante interno no fiscal.
  comprobante         text NOT NULL DEFAULT 'interno' CHECK (comprobante IN ('interno')),
  subtotal            numeric(18,2) NOT NULL,    -- antes de descuentos
  descuento           numeric(18,2) NOT NULL DEFAULT 0,
  total               numeric(18,2) NOT NULL CHECK (total >= 0),
  gravado10           numeric(18,2) NOT NULL DEFAULT 0,
  gravado5            numeric(18,2) NOT NULL DEFAULT 0,
  exento              numeric(18,2) NOT NULL DEFAULT 0,
  iva10               numeric(18,2) NOT NULL DEFAULT 0,
  iva5                numeric(18,2) NOT NULL DEFAULT 0,
  vuelto              numeric(18,2) NOT NULL DEFAULT 0,
  vuelto_moneda       text NOT NULL DEFAULT 'PYG' CHECK (vuelto_moneda IN ('PYG', 'USD', 'BRL')),
  autorizado_por      uuid,                      -- descuento autorizado con PIN
  creado_por          uuid NOT NULL,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  anulada_en          timestamptz,
  anulada_por         uuid,
  anulacion_autorizada_por uuid,
  motivo_anulacion    text,
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, clave_idempotencia),
  UNIQUE (empresa_id, caja_id, numero),
  FOREIGN KEY (empresa_id, sucursal_id) REFERENCES sucursal(empresa_id, id),
  FOREIGN KEY (empresa_id, caja_id) REFERENCES caja(empresa_id, id),
  FOREIGN KEY (empresa_id, sesion_caja_id) REFERENCES sesion_caja(empresa_id, id),
  FOREIGN KEY (empresa_id, cliente_id) REFERENCES cliente(empresa_id, id)
);
CREATE INDEX venta_fecha ON venta (empresa_id, creado_en DESC);
CREATE INDEX venta_sesion ON venta (empresa_id, sesion_caja_id);

CREATE TABLE venta_item (
  empresa_id       uuid NOT NULL,
  venta_id         uuid NOT NULL,
  linea            integer NOT NULL,
  variante_id      uuid NOT NULL,
  descripcion      text NOT NULL,
  cantidad         numeric(18,4) NOT NULL CHECK (cantidad > 0),
  precio_unitario  numeric(18,2) NOT NULL CHECK (precio_unitario >= 0),
  descuento        numeric(18,2) NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  total            numeric(18,2) NOT NULL CHECK (total >= 0),
  tasa_iva         numeric(5,2) NOT NULL CHECK (tasa_iva IN (0, 5, 10)),
  costo_unitario   numeric(18,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (empresa_id, venta_id, linea),
  FOREIGN KEY (empresa_id, venta_id) REFERENCES venta(empresa_id, id),
  FOREIGN KEY (empresa_id, variante_id) REFERENCES variante(empresa_id, id)
);

CREATE TABLE venta_pago (
  empresa_id    uuid NOT NULL,
  venta_id      uuid NOT NULL,
  linea         integer NOT NULL,
  medio         text NOT NULL CHECK (medio IN ('efectivo', 'tarjeta', 'transferencia', 'otro')),
  moneda        text NOT NULL CHECK (moneda IN ('PYG', 'USD', 'BRL')),
  monto         numeric(18,2) NOT NULL CHECK (monto > 0),        -- en su moneda
  cotizacion    numeric(18,4) NOT NULL DEFAULT 1,
  monto_pyg     numeric(18,2) NOT NULL CHECK (monto_pyg > 0),
  referencia    text,
  PRIMARY KEY (empresa_id, venta_id, linea),
  FOREIGN KEY (empresa_id, venta_id) REFERENCES venta(empresa_id, id)
);

-- ---------------------------------------------------------------------------
-- RLS, privilegios y datos iniciales
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['categoria', 'marca', 'producto', 'variante', 'codigo_barras', 'lista_precio', 'precio',
    'deposito', 'stock', 'movimiento_stock', 'cliente', 'cotizacion', 'caja', 'sesion_caja', 'movimiento_caja',
    'arqueo', 'venta', 'venta_item', 'venta_pago']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY aislamiento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON categoria, marca, producto, variante, lista_precio, precio, deposito, stock,
  cliente, caja, sesion_caja, venta TO kontiva_app;
GRANT SELECT, INSERT, DELETE ON codigo_barras TO kontiva_app;
GRANT SELECT, INSERT ON movimiento_stock, movimiento_caja, cotizacion, arqueo, venta_item, venta_pago TO kontiva_app;

-- El Panel Master crea el depósito y la lista de precios de cada empresa nueva.
GRANT SELECT, INSERT ON deposito, lista_precio TO kontiva_master;

-- Empresas existentes: un depósito por sucursal y la lista de precios predeterminada.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT empresa_id, id, nombre FROM sucursal LOOP
    PERFORM set_config('app.empresa_id', r.empresa_id::text, true);
    INSERT INTO deposito (empresa_id, sucursal_id, nombre) VALUES (r.empresa_id, r.id, 'Depósito principal');
  END LOOP;
  FOR r IN SELECT id FROM empresa LOOP
    PERFORM set_config('app.empresa_id', r.id::text, true);
    INSERT INTO lista_precio (empresa_id, nombre, predeterminada) VALUES (r.id, 'Precio de venta', true);
  END LOOP;
  PERFORM set_config('app.empresa_id', '', true);
END $$;
