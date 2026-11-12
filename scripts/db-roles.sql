-- Roles de base de datos de KONTIVA.
-- kontiva_owner: dueño del esquema, solo lo usan las migraciones.
-- kontiva_app:   rol con el que se conecta la API. Sin BYPASSRLS y sin ser dueño
--                de las tablas: Row-Level Security siempre se aplica.
-- Cambie las contraseñas en producción.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kontiva_owner') THEN
    CREATE ROLE kontiva_owner LOGIN PASSWORD 'kontiva_owner' NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kontiva_app') THEN
    CREATE ROLE kontiva_app LOGIN PASSWORD 'kontiva_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

SELECT 'CREATE DATABASE kontiva OWNER kontiva_owner'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'kontiva')\gexec
ALTER DATABASE kontiva OWNER TO kontiva_owner;
