import { Client } from 'pg';
import { migrar } from '../src/db/migrador';

/**
 * Recrea la base kontiva_test y aplica las migraciones con el rol dueño.
 * Las pruebas corren contra PostgreSQL real con RLS activo, como en producción.
 */
export default async function setup() {
  const host = process.env.PG_HOST ?? 'localhost:5432';
  const admin = new Client({ connectionString: process.env.PG_ADMIN_URL ?? `postgresql://postgres:postgres@${host}/postgres` });
  await admin.connect();
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kontiva_owner') THEN
      CREATE ROLE kontiva_owner LOGIN PASSWORD 'kontiva_owner' NOSUPERUSER NOBYPASSRLS; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kontiva_app') THEN
      CREATE ROLE kontiva_app LOGIN PASSWORD 'kontiva_app' NOSUPERUSER NOBYPASSRLS; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kontiva_master') THEN
      CREATE ROLE kontiva_master LOGIN PASSWORD 'kontiva_master' NOSUPERUSER NOBYPASSRLS; END IF;
  END $$`);
  await admin.query('DROP DATABASE IF EXISTS kontiva_test WITH (FORCE)');
  await admin.query('CREATE DATABASE kontiva_test OWNER kontiva_owner');
  await admin.end();
  await migrar(`postgresql://kontiva_owner:kontiva_owner@${host}/kontiva_test`, () => undefined);
}
