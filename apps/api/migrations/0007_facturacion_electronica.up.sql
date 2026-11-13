-- Facturación electrónica (SIFEN / e-Kuatia).
-- Configuración fiscal por empresa (certificado y CSC cifrados con CIFRADO_CLAVE),
-- datos del establecimiento por sucursal, punto de expedición por caja,
-- numeración por establecimiento + punto + tipo + timbrado y los documentos electrónicos emitidos.

CREATE TABLE fe_configuracion (
  empresa_id              uuid PRIMARY KEY REFERENCES empresa(id),
  activa                  boolean NOT NULL DEFAULT false,
  ambiente                text NOT NULL DEFAULT 'test' CHECK (ambiente IN ('test', 'produccion')),
  tipo_contribuyente      smallint NOT NULL DEFAULT 2 CHECK (tipo_contribuyente IN (1, 2)),  -- 1 física, 2 jurídica
  tipo_regimen            smallint,
  actividad_codigo        text,
  actividad_descripcion   text,
  timbrado_numero         text CHECK (timbrado_numero ~ '^[0-9]{8}$'),
  timbrado_fecha          date,
  csc_id                  text CHECK (csc_id ~ '^[0-9]{1,4}$'),
  csc_cifrado             text,
  certificado_cifrado     text,           -- .p12 en base64, cifrado
  certificado_clave       text,           -- contraseña del .p12, cifrada
  certificado_titular     text,
  certificado_ruc         text,
  certificado_vence       timestamptz,
  actualizado_por         uuid,
  actualizado_en          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER fe_configuracion_tocar BEFORE UPDATE ON fe_configuracion FOR EACH ROW EXECUTE FUNCTION tocar_actualizado_en();

-- Ubicación del establecimiento según la codificación de la DNIT.
ALTER TABLE sucursal
  ADD COLUMN fe_numero_casa text,
  ADD COLUMN fe_departamento integer,
  ADD COLUMN fe_distrito integer,
  ADD COLUMN fe_ciudad integer,
  ADD COLUMN fe_email text;

-- Punto de expedición de cada caja (001, 002…), único por sucursal.
ALTER TABLE caja ADD COLUMN punto_expedicion text CHECK (punto_expedicion ~ '^[0-9]{3}$');
CREATE UNIQUE INDEX caja_punto_expedicion ON caja (empresa_id, sucursal_id, punto_expedicion) WHERE punto_expedicion IS NOT NULL;

CREATE TABLE fe_numeracion (
  empresa_id       uuid NOT NULL REFERENCES empresa(id),
  establecimiento  text NOT NULL,
  punto            text NOT NULL,
  tipo_documento   smallint NOT NULL,
  timbrado         text NOT NULL,
  ultimo           integer NOT NULL DEFAULT 0 CHECK (ultimo BETWEEN 0 AND 9999999),
  PRIMARY KEY (empresa_id, establecimiento, punto, tipo_documento, timbrado)
);

-- Documento electrónico. El XML firmado es la fuente de verdad del comprobante: no se borra.
-- pendiente → enviado (en un lote) → aprobado | aprobado_obs | rechazado; aprobado → cancelado (evento).
CREATE TABLE documento_electronico (
  empresa_id        uuid NOT NULL REFERENCES empresa(id),
  id                uuid NOT NULL DEFAULT uuid_v7(),
  tipo_documento    smallint NOT NULL CHECK (tipo_documento IN (1, 4, 5, 6, 7)),
  cdc               text NOT NULL CHECK (cdc ~ '^[0-9]{44}$'),
  ambiente          text NOT NULL CHECK (ambiente IN ('test', 'produccion')),
  timbrado          text NOT NULL,
  establecimiento   text NOT NULL,
  punto             text NOT NULL,
  numero            integer NOT NULL,
  fecha_emision     timestamptz NOT NULL,
  sucursal_id       uuid NOT NULL,
  venta_id          uuid,
  devolucion_id     uuid,
  documento_asociado_id uuid,             -- factura de una nota de crédito
  receptor_nombre   text NOT NULL,
  receptor_documento text,
  total             numeric(18,2) NOT NULL,
  total_iva         numeric(18,2) NOT NULL,
  estado            text NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente', 'enviado', 'aprobado', 'aprobado_obs', 'rechazado', 'cancelado')),
  xml_firmado       text NOT NULL,
  qr_url            text NOT NULL,
  lote_protocolo    text,
  enviado_en        timestamptz,
  intentos          integer NOT NULL DEFAULT 0,
  proximo_intento   timestamptz NOT NULL DEFAULT now(),
  respuesta_codigo  text,
  respuesta_mensaje text,
  protocolo_autorizacion text,
  procesado_en      timestamptz,
  cancelado_en      timestamptz,
  cancelado_por     uuid,
  motivo_cancelacion text,
  creado_por        uuid NOT NULL,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, cdc),
  UNIQUE (empresa_id, tipo_documento, timbrado, establecimiento, punto, numero),
  FOREIGN KEY (empresa_id, sucursal_id) REFERENCES sucursal(empresa_id, id),
  FOREIGN KEY (empresa_id, venta_id) REFERENCES venta(empresa_id, id),
  FOREIGN KEY (empresa_id, devolucion_id) REFERENCES devolucion(empresa_id, id),
  FOREIGN KEY (empresa_id, documento_asociado_id) REFERENCES documento_electronico(empresa_id, id)
);
CREATE INDEX documento_electronico_cola ON documento_electronico (estado, proximo_intento) WHERE estado IN ('pendiente', 'enviado');
CREATE INDEX documento_electronico_venta ON documento_electronico (empresa_id, venta_id);

ALTER TABLE venta DROP CONSTRAINT venta_comprobante_check;
ALTER TABLE venta ADD CONSTRAINT venta_comprobante_check CHECK (comprobante IN ('interno', 'factura'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fe_configuracion', 'fe_numeracion', 'documento_electronico']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY aislamiento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
  END LOOP;
END $$;

-- El emisor en segundo plano necesita saber qué empresas tienen documentos por enviar o consultar.
-- Solo devuelve identificadores de empresa; el trabajo se hace después dentro de enEmpresa (RLS).
CREATE POLICY cola_sifen ON documento_electronico FOR SELECT TO kontiva_owner USING (true);
CREATE FUNCTION fe_empresas_con_cola() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT DISTINCT empresa_id FROM documento_electronico
    WHERE estado IN ('pendiente', 'enviado') AND proximo_intento <= now()
$$;
REVOKE ALL ON FUNCTION fe_empresas_con_cola() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fe_empresas_con_cola() TO kontiva_app;

GRANT SELECT, INSERT, UPDATE ON fe_configuracion, fe_numeracion, documento_electronico TO kontiva_app;
