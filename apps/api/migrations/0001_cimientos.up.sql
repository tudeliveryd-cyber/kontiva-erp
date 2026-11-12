-- KONTIVA ERP · Migración 0001 · Cimientos (Fase 0)
-- Plataforma, identidad, permisos, sesiones y auditoría.
--
-- Reglas:
--   * Toda tabla de negocio lleva empresa_id y Row-Level Security FORZADO.
--   * La API se conecta como kontiva_app (sin BYPASSRLS, no es dueño de tablas).
--   * La empresa activa se fija por transacción: SELECT set_config('app.empresa_id', '<uuid>', true).
--   * Claves foráneas compuestas (empresa_id, id) para que nada apunte a otra empresa.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Funciones base
-- ---------------------------------------------------------------------------

-- Empresa activa de la transacción. NULL si no se fijó: ninguna política deja ver filas.
CREATE FUNCTION app_empresa_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.empresa_id', true), '')::uuid
$$;

-- UUID v7 (ordenable por tiempo): mejor localidad de índice que v4.
CREATE FUNCTION uuid_v7() RETURNS uuid
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000);
  b bytea := gen_random_bytes(16);
BEGIN
  b := set_byte(b, 0, ((ms >> 40) & 255)::int);
  b := set_byte(b, 1, ((ms >> 32) & 255)::int);
  b := set_byte(b, 2, ((ms >> 24) & 255)::int);
  b := set_byte(b, 3, ((ms >> 16) & 255)::int);
  b := set_byte(b, 4, ((ms >> 8) & 255)::int);
  b := set_byte(b, 5, (ms & 255)::int);
  b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112);  -- versión 7
  b := set_byte(b, 8, (get_byte(b, 8) & 63) | 128);  -- variante RFC 9562
  RETURN encode(b, 'hex')::uuid;
END $$;

CREATE FUNCTION tocar_actualizado_en() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- Plataforma (globales: sin datos de negocio)
-- ---------------------------------------------------------------------------

CREATE TABLE plan (
  id              uuid PRIMARY KEY DEFAULT uuid_v7(),
  codigo          text NOT NULL UNIQUE CHECK (codigo ~ '^[A-Z_]{2,30}$'),
  nombre          text NOT NULL,
  max_usuarios    integer CHECK (max_usuarios > 0),      -- NULL = ilimitado
  max_sucursales  integer CHECK (max_sucursales > 0),
  max_cajas       integer CHECK (max_cajas > 0),
  modulos         jsonb NOT NULL DEFAULT '[]'::jsonb,
  activo          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);

-- Límites iniciales propuestos en el documento de arquitectura; Araújo Tech los confirma.
INSERT INTO plan (codigo, nombre, max_usuarios, max_sucursales, max_cajas, modulos) VALUES
  ('START',      'START',      3,    1,    1,    '["nucleo","vertical:1"]'),
  ('BUSINESS',   'BUSINESS',   15,   3,    5,    '["nucleo","finanzas","rrhh"]'),
  ('ENTERPRISE', 'ENTERPRISE', NULL, NULL, NULL, '["*"]');

-- Catálogo de permisos (sincronizado desde @kontiva/shared por el ejecutor de migraciones).
CREATE TABLE permiso (
  codigo   text PRIMARY KEY CHECK (codigo ~ '^[a-z_]+\.[a-z_]+$'),
  recurso  text NOT NULL,
  accion   text NOT NULL,
  nombre   text NOT NULL,
  modulo   text NOT NULL,
  vigente  boolean NOT NULL DEFAULT true
);

-- ---------------------------------------------------------------------------
-- Empresa y sucursales
-- ---------------------------------------------------------------------------

CREATE TABLE empresa (
  id               uuid PRIMARY KEY DEFAULT uuid_v7(),
  razon_social     text NOT NULL CHECK (length(razon_social) BETWEEN 2 AND 200),
  nombre_fantasia  text,
  ruc              text CHECK (ruc ~ '^[0-9A-Z]{1,12}-[0-9]$'),
  rubro            text NOT NULL DEFAULT 'general',
  plan_id          uuid NOT NULL REFERENCES plan(id),
  estado           text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'suspendida')),
  telefono         text,
  email            citext,
  direccion        text,
  moneda_base      text NOT NULL DEFAULT 'PYG' CHECK (moneda_base IN ('PYG')),
  zona_horaria     text NOT NULL DEFAULT 'America/Asuncion',
  configuracion    jsonb NOT NULL DEFAULT '{}'::jsonb,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now()
);
-- El RUC no es único entre empresas: una persona física puede tener dos negocios con el
-- mismo RUC, y un índice global revelaría a una empresa que otra usa ese RUC.
CREATE INDEX empresa_ruc ON empresa (ruc) WHERE ruc IS NOT NULL;

CREATE TABLE sucursal (
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  id              uuid NOT NULL DEFAULT uuid_v7(),
  codigo          text NOT NULL CHECK (codigo ~ '^[0-9]{3}$'),  -- establecimiento SIFEN
  nombre          text NOT NULL CHECK (length(nombre) BETWEEN 2 AND 120),
  direccion       text,
  telefono        text,
  activa          boolean NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid,
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, codigo)
);

-- ---------------------------------------------------------------------------
-- Identidad
-- ---------------------------------------------------------------------------

-- Cuenta = persona que inicia sesión. Una cuenta puede pertenecer a varias empresas
-- (ej. un contador). No contiene datos de negocio; solo credenciales.
CREATE TABLE cuenta (
  id                 uuid PRIMARY KEY DEFAULT uuid_v7(),
  email              citext NOT NULL UNIQUE,
  nombre             text NOT NULL,
  hash_contrasena    text,                      -- NULL hasta que acepta la invitación
  intentos_fallidos  integer NOT NULL DEFAULT 0,
  bloqueada_hasta    timestamptz,
  totp_secreto       text,                      -- segundo factor (cifrado; se usa desde Fase 0.1)
  creado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_en     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE perfil (
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  id              uuid NOT NULL DEFAULT uuid_v7(),
  clave           text,                         -- plantilla de origen (propietario, cajero...)
  nombre          text NOT NULL CHECK (length(nombre) BETWEEN 2 AND 80),
  descripcion     text,
  alcance         text NOT NULL CHECK (alcance IN ('propia', 'sucursal', 'empresa')),
  es_propietario  boolean NOT NULL DEFAULT false,
  sistema         boolean NOT NULL DEFAULT false,  -- creado en el alta; no se elimina
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid,
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, nombre)
);
-- Un solo perfil Propietario por empresa.
CREATE UNIQUE INDEX perfil_un_propietario ON perfil (empresa_id) WHERE es_propietario;

CREATE TABLE perfil_permiso (
  empresa_id  uuid NOT NULL,
  perfil_id   uuid NOT NULL,
  permiso     text NOT NULL REFERENCES permiso(codigo),
  PRIMARY KEY (empresa_id, perfil_id, permiso),
  FOREIGN KEY (empresa_id, perfil_id) REFERENCES perfil(empresa_id, id) ON DELETE CASCADE
);

CREATE TABLE usuario (
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  id              uuid NOT NULL DEFAULT uuid_v7(),
  cuenta_id       uuid NOT NULL REFERENCES cuenta(id),
  perfil_id       uuid NOT NULL,
  nombre          text NOT NULL CHECK (length(nombre) BETWEEN 2 AND 120),
  activo          boolean NOT NULL DEFAULT true,
  hash_pin        text,                         -- PIN de autorización en el PDV
  intentos_pin    integer NOT NULL DEFAULT 0,
  pin_bloqueado_hasta timestamptz,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  creado_por      uuid,
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id),
  UNIQUE (id),
  UNIQUE (empresa_id, cuenta_id),
  FOREIGN KEY (empresa_id, perfil_id) REFERENCES perfil(empresa_id, id)
);
CREATE INDEX usuario_cuenta ON usuario (cuenta_id);

CREATE TABLE usuario_permiso (
  empresa_id  uuid NOT NULL,
  usuario_id  uuid NOT NULL,
  permiso     text NOT NULL REFERENCES permiso(codigo),
  tipo        text NOT NULL CHECK (tipo IN ('conceder', 'denegar')),
  alcance     text NOT NULL DEFAULT 'empresa' CHECK (alcance IN ('propia', 'sucursal', 'empresa')),
  PRIMARY KEY (empresa_id, usuario_id, permiso),
  FOREIGN KEY (empresa_id, usuario_id) REFERENCES usuario(empresa_id, id) ON DELETE CASCADE
);

CREATE TABLE usuario_sucursal (
  empresa_id   uuid NOT NULL,
  usuario_id   uuid NOT NULL,
  sucursal_id  uuid NOT NULL,
  PRIMARY KEY (empresa_id, usuario_id, sucursal_id),
  FOREIGN KEY (empresa_id, usuario_id) REFERENCES usuario(empresa_id, id) ON DELETE CASCADE,
  FOREIGN KEY (empresa_id, sucursal_id) REFERENCES sucursal(empresa_id, id)
);

-- ---------------------------------------------------------------------------
-- Sesiones, recuperación y accesos (globales, solo credenciales)
-- ---------------------------------------------------------------------------

CREATE TABLE sesion (
  id                      uuid PRIMARY KEY DEFAULT uuid_v7(),
  cuenta_id               uuid NOT NULL REFERENCES cuenta(id),
  empresa_id              uuid NOT NULL REFERENCES empresa(id),
  usuario_id              uuid NOT NULL REFERENCES usuario(id),
  hash_token              text NOT NULL UNIQUE,       -- SHA-256 del token de renovación vigente
  hash_token_anterior     text,                       -- para detectar reutilización
  ip                      inet,
  agente                  text,
  creado_en               timestamptz NOT NULL DEFAULT now(),
  ultimo_uso_en           timestamptz NOT NULL DEFAULT now(),
  expira_en               timestamptz NOT NULL,
  revocada_en             timestamptz,
  motivo_revocacion       text
);
CREATE INDEX sesion_cuenta ON sesion (cuenta_id) WHERE revocada_en IS NULL;
CREATE INDEX sesion_token_anterior ON sesion (hash_token_anterior) WHERE hash_token_anterior IS NOT NULL;

CREATE TABLE token_cuenta (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  cuenta_id   uuid NOT NULL REFERENCES cuenta(id),
  tipo        text NOT NULL CHECK (tipo IN ('recuperacion', 'invitacion')),
  hash_token  text NOT NULL UNIQUE,
  expira_en   timestamptz NOT NULL,
  usado_en    timestamptz,
  creado_en   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE intento_acceso (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       citext,
  cuenta_id   uuid,
  exito       boolean NOT NULL,
  motivo      text NOT NULL,
  ip          inet,
  agente      text,
  creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX intento_acceso_email ON intento_acceso (email, creado_en DESC);

-- ---------------------------------------------------------------------------
-- Auditoría (solo inserción)
-- ---------------------------------------------------------------------------

CREATE TABLE auditoria (
  id           bigint GENERATED ALWAYS AS IDENTITY,
  empresa_id   uuid NOT NULL REFERENCES empresa(id),
  usuario_id   uuid,
  cuenta_id    uuid,
  autorizado_por uuid,                -- supervisor que autorizó con PIN, si aplica
  accion       text NOT NULL,         -- crear, editar, eliminar, login, autorizar...
  entidad      text NOT NULL,         -- usuario, perfil, sucursal, sesion...
  entidad_id   text,
  antes        jsonb,
  despues      jsonb,
  ip           inet,
  agente       text,
  creado_en    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, id)
);
CREATE INDEX auditoria_fecha ON auditoria (empresa_id, creado_en DESC);
CREATE INDEX auditoria_entidad ON auditoria (empresa_id, entidad, entidad_id);

CREATE FUNCTION auditoria_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La auditoría es solo de inserción: % no permitido', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;
-- A nivel de sentencia: se rechaza aunque RLS deje 0 filas visibles.
CREATE TRIGGER auditoria_sin_cambios BEFORE UPDATE OR DELETE OR TRUNCATE ON auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION auditoria_inmutable();

-- ---------------------------------------------------------------------------
-- actualizado_en automático
-- ---------------------------------------------------------------------------

CREATE TRIGGER plan_tocar BEFORE UPDATE ON plan FOR EACH ROW EXECUTE FUNCTION tocar_actualizado_en();
CREATE TRIGGER empresa_tocar BEFORE UPDATE ON empresa FOR EACH ROW EXECUTE FUNCTION tocar_actualizado_en();
CREATE TRIGGER sucursal_tocar BEFORE UPDATE ON sucursal FOR EACH ROW EXECUTE FUNCTION tocar_actualizado_en();
CREATE TRIGGER cuenta_tocar BEFORE UPDATE ON cuenta FOR EACH ROW EXECUTE FUNCTION tocar_actualizado_en();
CREATE TRIGGER perfil_tocar BEFORE UPDATE ON perfil FOR EACH ROW EXECUTE FUNCTION tocar_actualizado_en();
CREATE TRIGGER usuario_tocar BEFORE UPDATE ON usuario FOR EACH ROW EXECUTE FUNCTION tocar_actualizado_en();

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE empresa ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresa FORCE ROW LEVEL SECURITY;
CREATE POLICY aislamiento ON empresa
  USING (id = app_empresa_id()) WITH CHECK (id = app_empresa_id());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sucursal', 'perfil', 'perfil_permiso', 'usuario', 'usuario_permiso', 'usuario_sucursal', 'auditoria']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY aislamiento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
  END LOOP;
END $$;

-- Las funciones de autenticación de abajo corren como kontiva_owner, al que FORCE RLS
-- también filtra. Esta política le permite SOLO LEER usuario y empresa; sus escrituras
-- siguen sujetas al aislamiento. kontiva_app no la recibe.
CREATE POLICY lectura_auth ON usuario FOR SELECT TO kontiva_owner USING (true);
CREATE POLICY lectura_auth ON empresa FOR SELECT TO kontiva_owner USING (true);

-- ---------------------------------------------------------------------------
-- Funciones de autenticación (SECURITY DEFINER, alcance mínimo)
-- Antes de elegir empresa, la API necesita saber a qué empresas pertenece una cuenta.
-- Estas funciones devuelven solo eso, sin abrir las tablas.
-- ---------------------------------------------------------------------------

CREATE FUNCTION auth_membresias(p_cuenta_id uuid)
RETURNS TABLE (empresa_id uuid, usuario_id uuid, empresa_nombre text, empresa_estado text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.empresa_id, u.id, coalesce(e.nombre_fantasia, e.razon_social), e.estado
  FROM usuario u JOIN empresa e ON e.id = u.empresa_id
  WHERE u.cuenta_id = p_cuenta_id AND u.activo
  ORDER BY 3
$$;

-- Estado de una sesión para validar cada petición: sesión viva, usuario activo, empresa activa.
CREATE FUNCTION auth_estado_sesion(p_sesion_id uuid)
RETURNS TABLE (sesion_activa boolean, usuario_activo boolean, empresa_activa boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.revocada_en IS NULL AND s.expira_en > now(), u.activo, e.estado = 'activa'
  FROM sesion s
  JOIN usuario u ON u.id = s.usuario_id
  JOIN empresa e ON e.id = s.empresa_id
  WHERE s.id = p_sesion_id
$$;

-- Las funciones definer no deben poder ejecutarlas otros roles salvo la API.
REVOKE ALL ON FUNCTION auth_membresias(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_estado_sesion(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Privilegios del rol de la API
-- ---------------------------------------------------------------------------

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO kontiva_app;

GRANT SELECT ON plan, permiso TO kontiva_app;
GRANT SELECT, INSERT, UPDATE ON empresa, sucursal, cuenta, usuario, perfil TO kontiva_app;
GRANT DELETE ON perfil TO kontiva_app;
GRANT SELECT, INSERT, DELETE ON perfil_permiso, usuario_permiso, usuario_sucursal TO kontiva_app;
GRANT SELECT, INSERT, UPDATE ON sesion, token_cuenta TO kontiva_app;
GRANT INSERT, SELECT ON intento_acceso TO kontiva_app;
GRANT INSERT, SELECT ON auditoria TO kontiva_app;
GRANT EXECUTE ON FUNCTION app_empresa_id(), uuid_v7(), auth_membresias(uuid), auth_estado_sesion(uuid) TO kontiva_app;
