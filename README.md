# KONTIVA ERP

**Gestión inteligente para tu empresa.**

Sistema integral de gestión empresarial multiempresa y multisectorial.
Producto comercial de **Araújo Tech Sistemas**.

> Repositorio privado. Código propietario. Todos los derechos reservados.

## Estado

| Fase | Contenido | Estado |
| --- | --- | --- |
| 0 | Cimientos: autenticación, multiempresa con RLS, permisos, auditoría, Panel Master | Lista · ver pendientes menores abajo |
| 1 | Operación central: productos, inventario, PDV, caja | Pendiente |
| 2 | Compras y finanzas | Pendiente |
| 3 | Facturación electrónica SIFEN | Pendiente |
| 4 | RRHH, informes, dashboard, app del dueño | Pendiente |
| 5 | Verticales por rubro e integraciones | Pendiente |

### Fase 0 · hecho
- **Autenticación**: Argon2id, bloqueo progresivo tras 5 intentos, token de acceso de 15 min + renovación rotativa
  en cookie httpOnly con detección de reutilización, sesiones activas con cierre remoto inmediato,
  recuperación por enlace de un solo uso (30 min), invitaciones (7 días), una cuenta en varias empresas.
- **Multiempresa**: Row-Level Security forzado en PostgreSQL, rol de la API sin `BYPASSRLS`,
  empresa activa por `SET LOCAL`, claves foráneas compuestas.
- **Permisos**: recurso + acción + alcance (propia / sucursal / empresa), 11 perfiles de plantilla,
  concesiones y denegaciones individuales, bloqueo de escalada, recursos confidenciales separados,
  autorización en el momento con PIN de supervisor.
- **Auditoría**: solo inserción (trigger a nivel de sentencia, también contra el dueño del esquema),
  antes / después, IP y dispositivo, consulta con filtros.
- **Planes**: límites de usuarios y sucursales aplicados en el backend.
- **Web**: acceso, configuración inicial, usuarios, perfiles (matriz de permisos), sucursales, empresa,
  auditoría, mi cuenta (contraseña, PIN, sesiones, cambio de empresa).
- **Segundo factor (TOTP)**: opcional para todos, obligatorio para el Propietario en los planes que lo
  exigen (ENTERPRISE) y siempre en el Panel Master. Secreto cifrado con AES-256-GCM (clave fuera de la base),
  códigos no reutilizables, 10 códigos de respaldo de un solo uso.
- **Panel Master** (servicio separado, rol de base `kontiva_master`, secreto JWT propio): alta de empresas,
  planes y precios, cambio de plan, suscripciones con vencimiento y días de gracia, registro y anulación
  de pagos, suspensión automática por falta de pago y reactivación al pagar, auditoría propia.
  No lee datos de negocio: solo conteos y estado.
- **Producción**: imagen Docker única, `deploy/docker-compose.yml` con PostgreSQL, HTTPS automático (Caddy)
  y respaldo diario. Guía: [deploy/INSTALACION.md](deploy/INSTALACION.md).
- **Pruebas**: 145 pruebas contra PostgreSQL real, incluida una suite generada desde los decoradores
  que verifica 401 / 403 / 404 (otra empresa) en cada endpoint. El CI además construye la imagen y la arranca.

### Fase 0 · pendiente menor
- Interfaz en portugués (hoy solo español).
- Documentación OpenAPI de la API.
- Exportación completa de los datos de una empresa (para empresas suspendidas o que se van).
- Monitoreo y alertas externas (depende del proveedor de hosting elegido).

## Estructura

```
apps/api         API NestJS + Kysely + PostgreSQL (migrations/ = SQL versionado)
                 src/main.ts = ERP (puerto 3000) · src/main-master.ts = Panel Master (puerto 3001)
apps/web         Web React + Vite: index.html = ERP · master.html = Panel Master
deploy/          docker-compose de producción, Caddy (HTTPS), guía de instalación
packages/shared  Catálogo de permisos, perfiles de plantilla y esquemas Zod (API y web)
scripts/         Roles de base de datos
```

## Desarrollo local

Requisitos: Node 22, pnpm 10, Docker (o PostgreSQL 16 local).

```bash
docker compose up -d                 # PostgreSQL 16 + Redis, crea roles y base
cp .env.example .env                 # y cambie JWT_SECRET
pnpm install
pnpm build
pnpm db:migrate
pnpm --filter @kontiva/api cli master:crear --email usted@correo.com --nombre "Su nombre"
pnpm dev:api                         # ERP: http://localhost:3000/api
pnpm --filter @kontiva/api exec node --watch dist/main-master.js   # Master: :3001
pnpm dev:web                         # ERP: http://localhost:5173 · Master: http://localhost:5173/master.html
# Alta de empresas desde el Panel Master, o por CLI:
pnpm --filter @kontiva/api cli empresa:crear --razon "Mi Empresa S.A." --plan BUSINESS --email dueno@correo.com --nombre "Nombre"
# Sin SMTP, los correos (invitaciones, recuperación) se escriben en el log.
```

Pruebas: `pnpm test` (recrea la base `kontiva_test` en cada ejecución).

## Decisiones técnicas respecto del documento de arquitectura

- **Kysely + migraciones SQL en lugar de Prisma.** El aislamiento depende de RLS, políticas,
  claves compuestas y `SET LOCAL` por transacción: todo eso es SQL que Prisma no modela.
  Kysely da consultas tipadas con control explícito de la transacción, y las migraciones
  son archivos `.up.sql` / `.down.sql` con checksum.
- **El RUC no es único entre empresas**: una persona física puede tener dos negocios con el mismo
  RUC, y un índice global revelaría a una empresa que otra usa ese RUC.
- **Permisos sin caché**: se cargan de la base en cada petición (3 consultas por clave primaria),
  así un cambio rige de inmediato y no hay caché que invalidar entre instancias.

Desarrollado por Araújo Tech Sistemas.
