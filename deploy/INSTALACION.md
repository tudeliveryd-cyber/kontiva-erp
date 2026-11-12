# Instalación en un servidor

Un VPS con Linux (Ubuntu 24.04), 2 vCPU y 4 GB de RAM alcanza para empezar.
Conviene un proveedor con centro de datos en São Paulo o Buenos Aires (menor latencia hacia Paraguay).

## 1. Dominios

Cree dos registros DNS tipo A apuntando a la IP del servidor:

- `app.su-dominio.com.py`  → ERP para las empresas clientes
- `master.su-dominio.com.py` → Panel Master de Araújo Tech

## 2. Servidor

```bash
# Docker
curl -fsSL https://get.docker.com | sh

# Código
git clone https://github.com/tudeliveryd-cyber/kontiva-erp.git
cd kontiva-erp/deploy
cp .env.example .env
nano .env        # dominios, contraseñas y secretos (openssl rand -base64 48)
```

`CIFRADO_CLAVE` se genera con `openssl rand -base64 32`. Guárdela en un lugar seguro fuera del
servidor: sin ella no se pueden leer los segundos factores guardados.

## 3. Arranque

```bash
docker compose up -d --build
docker compose logs -f migrar     # debe terminar con "Migraciones aplicadas"
```

Caddy obtiene los certificados HTTPS solo, en el primer acceso a cada dominio.

## 4. Primer usuario del Panel Master

```bash
docker compose exec master node dist/cli.js master:crear --email usted@araujotech.com.py --nombre "Su nombre"
```

El comando imprime una contraseña temporal. Entre en `https://master.su-dominio.com.py`,
configure la verificación en dos pasos con el teléfono y cambie la contraseña en "Mi cuenta".
Desde ahí da de alta las empresas.

## Actualizar a una versión nueva

```bash
cd kontiva-erp && git pull
cd deploy && docker compose up -d --build   # aplica migraciones nuevas antes de levantar la API
```

## Respaldos

El servicio `respaldo` guarda una copia diaria en `deploy/backups/` y conserva 14 días.
Copie esa carpeta a otro lugar (otro servidor o almacenamiento externo); una copia que vive
solo en el mismo servidor no protege contra la pérdida del servidor.

Restaurar una copia:

```bash
docker compose exec -T postgres pg_restore -U postgres -d kontiva --clean < backups/kontiva-AAAAMMDD-HHMM.dump
```

## Problemas frecuentes

| Síntoma | Causa probable |
| --- | --- |
| Caddy no obtiene el certificado | El DNS todavía no apunta al servidor, o los puertos 80/443 están cerrados |
| Los correos no llegan | `SMTP_URL` vacío: los enlaces quedan en `docker compose logs api`; el Panel Master muestra el enlace de invitación para copiarlo |
| "La empresa está suspendida" | Suscripción vencida y sin pago: registre el pago en el Panel Master |
| Perdió el teléfono del segundo factor (Master) | `docker compose exec master node dist/cli.js master:reiniciar-2fa --email ...` |
