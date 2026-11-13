# Probar KONTIVA ERP por enlace

Este entorno se preparó solo: base de datos, empresa de prueba y Panel Master.

1. Abra la pestaña **PORTS** (abajo) y haga clic en el globo del puerto **5173 · KONTIVA ERP**.
2. Ingrese con los datos de `.devcontainer/ACCESO.txt` (también se muestran en la terminal).
3. Para abrir el enlace en el celular o pasárselo a otra persona: en **PORTS**, clic derecho sobre
   el puerto 5173 → **Port Visibility** → **Public**. Sin eso, el enlace pide iniciar sesión en GitHub.

El entorno se detiene solo tras 30 minutos sin uso; los datos se conservan. Para volver, abra el
codespace desde github.com/codespaces: la aplicación arranca sola con el mismo enlace.

Registros: `/tmp/kontiva-api.log`, `/tmp/kontiva-master.log`, `/tmp/kontiva-web.log`.
Después de cambiar código: `pnpm build && bash .devcontainer/iniciar.sh`.
