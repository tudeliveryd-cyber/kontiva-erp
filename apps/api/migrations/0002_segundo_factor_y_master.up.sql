-- KONTIVA ERP · Migración 0002 · Segundo factor (TOTP) y Panel Master
--
-- El Panel Master usa su propio rol (kontiva_master) y su propio esquema (master).
-- La API de empresas (kontiva_app) no tiene acceso al esquema master.

-- ---------------------------------------------------------------------------
-- Segundo factor para cuentas de empresas
-- ---------------------------------------------------------------------------

-- cuenta.totp_secreto (creado en 0001) guarda el secreto CIFRADO con AES-256-GCM;
-- la clave vive fuera de la base (CIFRADO_CLAVE).
ALTER TABLE cuenta
  ADD COLUMN totp_activo boolean NOT NULL DEFAULT false,
  ADD COLUMN totp_pendiente text,          -- secreto cifrado durante el alta, antes de confirmar
  ADD COLUMN totp_ultimo_paso bigint;      -- impide reutilizar un código ya usado

CREATE TABLE codigo_respaldo (
  id         uuid PRIMARY KEY DEFAULT uuid_v7(),
  cuenta_id  uuid NOT NULL REFERENCES cuenta(id),
  hash       text NOT NULL UNIQUE,
  usado_en   timestamptz,
  creado_en  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX codigo_respaldo_cuenta ON codigo_respaldo (cuenta_id) WHERE usado_en IS NULL;

-- Qué planes exigen segundo factor al Propietario (editable desde el Panel Master).
ALTER TABLE plan
  ADD COLUMN exige_2fa_propietario boolean NOT NULL DEFAULT false,
  ADD COLUMN precio_mensual numeric(18,2) CHECK (precio_mensual >= 0),
  ADD COLUMN precio_anual numeric(18,2) CHECK (precio_anual >= 0);
UPDATE plan SET exige_2fa_propietario = true WHERE codigo = 'ENTERPRISE';

-- Lectura para las funciones SECURITY DEFINER (corren como kontiva_owner).
CREATE POLICY lectura_auth ON perfil FOR SELECT TO kontiva_owner USING (true);
CREATE POLICY lectura_auth ON sucursal FOR SELECT TO kontiva_owner USING (true);

CREATE FUNCTION auth_requiere_2fa(p_cuenta_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuario u
    JOIN perfil p ON p.empresa_id = u.empresa_id AND p.id = u.perfil_id
    JOIN empresa e ON e.id = u.empresa_id
    JOIN plan pl ON pl.id = e.plan_id
    WHERE u.cuenta_id = p_cuenta_id AND u.activo AND p.es_propietario
      AND pl.exige_2fa_propietario AND e.estado = 'activa')
$$;
REVOKE ALL ON FUNCTION auth_requiere_2fa(uuid) FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE ON codigo_respaldo TO kontiva_app;
GRANT EXECUTE ON FUNCTION auth_requiere_2fa(uuid) TO kontiva_app;

-- ---------------------------------------------------------------------------
-- Panel Master
-- ---------------------------------------------------------------------------

CREATE SCHEMA master;
REVOKE ALL ON SCHEMA master FROM PUBLIC;

CREATE TABLE master.usuario (
  id                 uuid PRIMARY KEY DEFAULT uuid_v7(),
  email              citext NOT NULL UNIQUE,
  nombre             text NOT NULL,
  hash_contrasena    text NOT NULL,
  totp_secreto       text,                  -- cifrado
  totp_pendiente     text,
  totp_activo        boolean NOT NULL DEFAULT false,
  totp_ultimo_paso   bigint,
  intentos_fallidos  integer NOT NULL DEFAULT 0,
  bloqueada_hasta    timestamptz,
  activo             boolean NOT NULL DEFAULT true,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_en     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER usuario_tocar BEFORE UPDATE ON master.usuario FOR EACH ROW EXECUTE FUNCTION tocar_actualizado_en();

CREATE TABLE master.sesion (
  id                   uuid PRIMARY KEY DEFAULT uuid_v7(),
  usuario_id           uuid NOT NULL REFERENCES master.usuario(id),
  hash_token           text NOT NULL UNIQUE,
  hash_token_anterior  text,
  ip                   inet,
  agente               text,
  creado_en            timestamptz NOT NULL DEFAULT now(),
  ultimo_uso_en        timestamptz NOT NULL DEFAULT now(),
  expira_en            timestamptz NOT NULL,
  revocada_en          timestamptz
);
CREATE INDEX sesion_anterior ON master.sesion (hash_token_anterior) WHERE hash_token_anterior IS NOT NULL;

-- Suscripción de cada empresa. Sin fila = empresa sin control de vencimiento (ej. cortesía).
CREATE TABLE master.suscripcion (
  empresa_id          uuid PRIMARY KEY REFERENCES public.empresa(id),
  ciclo               text NOT NULL DEFAULT 'mensual' CHECK (ciclo IN ('mensual', 'anual')),
  precio              numeric(18,2) NOT NULL DEFAULT 0 CHECK (precio >= 0),
  moneda              text NOT NULL DEFAULT 'PYG' CHECK (moneda IN ('PYG', 'USD', 'BRL')),
  vence_en            date NOT NULL,
  dias_gracia         integer NOT NULL DEFAULT 7 CHECK (dias_gracia BETWEEN 0 AND 90),
  suspension_automatica boolean NOT NULL DEFAULT true,
  motivo_suspension   text CHECK (motivo_suspension IN ('falta_pago', 'manual')),
  notas               text,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER suscripcion_tocar BEFORE UPDATE ON master.suscripcion FOR EACH ROW EXECUTE FUNCTION tocar_actualizado_en();

CREATE TABLE master.pago (
  id              uuid PRIMARY KEY DEFAULT uuid_v7(),
  empresa_id      uuid NOT NULL REFERENCES public.empresa(id),
  monto           numeric(18,2) NOT NULL CHECK (monto > 0),
  moneda          text NOT NULL CHECK (moneda IN ('PYG', 'USD', 'BRL')),
  fecha           date NOT NULL,
  periodo_desde   date NOT NULL,
  periodo_hasta   date NOT NULL CHECK (periodo_hasta >= periodo_desde),
  metodo          text NOT NULL CHECK (metodo IN ('transferencia', 'efectivo', 'tarjeta', 'otro')),
  referencia      text,
  registrado_por  uuid NOT NULL REFERENCES master.usuario(id),
  anulado_en      timestamptz,
  anulado_por     uuid REFERENCES master.usuario(id),
  motivo_anulacion text,
  creado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pago_empresa ON master.pago (empresa_id, fecha DESC);

CREATE TABLE master.auditoria (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id  uuid,
  accion      text NOT NULL,
  entidad     text NOT NULL,
  entidad_id  text,
  antes       jsonb,
  despues     jsonb,
  ip          inet,
  agente      text,
  creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auditoria_fecha ON master.auditoria (creado_en DESC);
CREATE TRIGGER auditoria_sin_cambios BEFORE UPDATE OR DELETE OR TRUNCATE ON master.auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION auditoria_inmutable();

-- Resumen por empresa SIN datos de negocio: solo conteos y estado técnico.
CREATE FUNCTION master.resumen_empresas()
RETURNS TABLE (
  id uuid, razon_social text, nombre_fantasia text, ruc text, rubro text, estado text,
  plan_id uuid, plan_codigo text, creado_en timestamptz,
  usuarios_activos bigint, sucursales_activas bigint, ultimo_acceso timestamptz,
  propietario_email citext, propietario_nombre text, propietario_pendiente boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.id, e.razon_social, e.nombre_fantasia, e.ruc, e.rubro, e.estado,
         e.plan_id, pl.codigo, e.creado_en,
         (SELECT count(*) FROM usuario u WHERE u.empresa_id = e.id AND u.activo),
         (SELECT count(*) FROM sucursal s WHERE s.empresa_id = e.id AND s.activa),
         (SELECT max(se.ultimo_uso_en) FROM sesion se WHERE se.empresa_id = e.id),
         c.email, c.nombre, c.hash_contrasena IS NULL
  FROM empresa e
  JOIN plan pl ON pl.id = e.plan_id
  LEFT JOIN LATERAL (
    SELECT cu.email, cu.nombre, cu.hash_contrasena
    FROM usuario u JOIN perfil p ON p.empresa_id = u.empresa_id AND p.id = u.perfil_id
    JOIN cuenta cu ON cu.id = u.cuenta_id
    WHERE u.empresa_id = e.id AND p.es_propietario LIMIT 1) c ON true
  ORDER BY e.creado_en DESC
$$;
CREATE POLICY lectura_auth ON sesion FOR SELECT TO kontiva_owner USING (true);
REVOKE ALL ON FUNCTION master.resumen_empresas() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Privilegios del rol del Panel Master
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO kontiva_master;
GRANT USAGE ON SCHEMA master TO kontiva_master;

GRANT SELECT, UPDATE ON plan TO kontiva_master;
GRANT SELECT ON permiso TO kontiva_master;
-- Alta de empresas (mismas tablas que usa la provisión) y cambios de plan / estado.
GRANT SELECT, INSERT, UPDATE ON empresa, sucursal, cuenta, perfil, usuario TO kontiva_master;
GRANT SELECT, INSERT ON perfil_permiso, usuario_sucursal TO kontiva_master;
GRANT SELECT, INSERT, UPDATE ON token_cuenta TO kontiva_master;
GRANT INSERT ON auditoria TO kontiva_master;
GRANT EXECUTE ON FUNCTION app_empresa_id(), uuid_v7() TO kontiva_master;

GRANT SELECT, INSERT, UPDATE ON master.usuario, master.sesion, master.suscripcion TO kontiva_master;
GRANT SELECT, INSERT ON master.pago TO kontiva_master;
GRANT UPDATE (anulado_en, anulado_por, motivo_anulacion) ON master.pago TO kontiva_master;
GRANT SELECT, INSERT ON master.auditoria TO kontiva_master;
GRANT EXECUTE ON FUNCTION master.resumen_empresas() TO kontiva_master;
