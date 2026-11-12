# KONTIVA ERP

**Gestión inteligente para tu empresa.**

Sistema integral de gestión empresarial multiempresa y multisectorial.
Producto comercial de **Araújo Tech Sistemas**.

> Repositorio privado. Código propietario. Todos los derechos reservados.

## Estado

| Fase | Contenido | Estado |
| --- | --- | --- |
| 0 | Cimientos: autenticación, multiempresa con RLS, permisos, auditoría | Núcleo listo · ver pendientes abajo |
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
- **Pruebas**: 118 pruebas contra PostgreSQL real, incluida una suite generada desde los decoradores
  que verifica 401 / 403 / 404 (otra empresa) en cada endpoint.

### Fase 0 · pendiente
- Segundo factor (TOTP): obligatorio para propietarios ENTERPRISE y para el Panel Master.
- Panel Master (aplicación separada). Mientras tanto, el alta de empresas se hace por CLI.
- Interfaz en portugués (hoy solo español).
- Documentación OpenAPI, imagen Docker de producción, monitoreo y backups (definir proveedor de hosting).

## Estructura

```
apps/api         API NestJS + Kysely + PostgreSQL (migrations/ = SQL versionado)
apps/web         Panel web React + Vite
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
pnpm --filter @kontiva/api cli empresa:crear \
  --razon "Mi Empresa S.A." --plan BUSINESS --email dueno@correo.com --nombre "Nombre Apellido"
# El comando imprime el enlace para crear la contraseña (sin SMTP, el correo va al log)
pnpm dev:api                         # http://localhost:3000/api
pnpm dev:web                         # http://localhost:5173
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
