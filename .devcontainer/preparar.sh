#!/usr/bin/env bash
# Se ejecuta una sola vez al crear el entorno: dependencias, configuración, base y usuarios de prueba.
set -euo pipefail
cd "$(dirname "$0")/.."

sudo corepack enable >/dev/null 2>&1 || corepack enable
pnpm install --frozen-lockfile

URL_WEB="http://localhost:5173"
if [ -n "${CODESPACE_NAME:-}" ]; then
  URL_WEB="https://${CODESPACE_NAME}-5173.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
fi

if [ ! -f .env ]; then
  sed \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 48)|" \
    -e "s|^JWT_MASTER_SECRET=.*|JWT_MASTER_SECRET=$(openssl rand -hex 48)|" \
    -e "s|^CIFRADO_CLAVE=.*|CIFRADO_CLAVE=$(openssl rand -base64 32)|" \
    -e "s|^WEB_URL=.*|WEB_URL=${URL_WEB}|" \
    -e "s|^MASTER_WEB_URL=.*|MASTER_WEB_URL=${URL_WEB}|" \
    .env.example > .env
fi

pnpm build

echo "Esperando a PostgreSQL..."
for _ in $(seq 1 60); do
  node -e "require('net').connect(5432,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" && break
  sleep 1
done
pnpm db:migrate

CONTRASENA="Kontiva-$(openssl rand -hex 3)"
ACCESO=.devcontainer/ACCESO.txt
{
  echo "KONTIVA ERP · datos de acceso de este entorno de prueba"
  echo
  echo "Enlace del ERP:   ${URL_WEB}"
  echo "Panel Master:     ${URL_WEB}/master.html"
  echo
  echo "Empresa de prueba (plan BUSINESS)"
  echo "  Correo:      prueba@kontiva.test"
  echo "  Contraseña:  ${CONTRASENA}"
  echo
  echo "Panel Master"
} > "$ACCESO"
pnpm --silent --filter @kontiva/api cli empresa:crear --razon "Empresa de Prueba" --plan BUSINESS \
  --email prueba@kontiva.test --nombre "Usuario de Prueba" --contrasena "$CONTRASENA" >/dev/null
pnpm --silent --filter @kontiva/api cli master:crear --email master@kontiva.test --nombre "Master de Prueba" \
  | sed -n 's/^Contraseña temporal.*: /  Correo: master@kontiva.test\n  Contraseña temporal: /p' >> "$ACCESO"
echo "  Al primer ingreso pide configurar la verificación en dos pasos (app autenticadora)." >> "$ACCESO"

cat "$ACCESO"
