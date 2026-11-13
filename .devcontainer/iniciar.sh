#!/usr/bin/env bash
# Se ejecuta cada vez que el entorno arranca: API, Panel Master y la web en el puerto 5173.
set -uo pipefail
cd "$(dirname "$0")/.."
pkill -f "dist/main.js" 2>/dev/null; pkill -f "dist/main-master.js" 2>/dev/null; pkill -f "vite preview" 2>/dev/null
(cd apps/api && nohup node dist/main.js > /tmp/kontiva-api.log 2>&1 &)
(cd apps/api && nohup node dist/main-master.js > /tmp/kontiva-master.log 2>&1 &)
(cd apps/web && nohup npx vite preview --port 5173 --strictPort > /tmp/kontiva-web.log 2>&1 &)
sleep 3
echo
echo "KONTIVA ERP en marcha. Abra la pestaña PORTS y el puerto 5173 (KONTIVA ERP)."
[ -f .devcontainer/ACCESO.txt ] && cat .devcontainer/ACCESO.txt
