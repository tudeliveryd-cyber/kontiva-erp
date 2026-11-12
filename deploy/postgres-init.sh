#!/bin/sh
# Crea los roles y la base de KONTIVA en el primer arranque del contenedor de PostgreSQL.
set -e
psql -v ON_ERROR_STOP=1 -U postgres \
  -v owner="$KONTIVA_OWNER_PASSWORD" -v app="$KONTIVA_APP_PASSWORD" -v master="$KONTIVA_MASTER_PASSWORD" <<'SQL'
CREATE ROLE kontiva_owner LOGIN PASSWORD :'owner' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE kontiva_app LOGIN PASSWORD :'app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE kontiva_master LOGIN PASSWORD :'master' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE DATABASE kontiva OWNER kontiva_owner;
SQL
