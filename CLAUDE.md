# KONTIVA ERP · guía para trabajar en este repositorio

Plan completo: documento "KONTIVA ERP — Documento de Arquitectura Técnica" (Claude Docs).
Estado por fase: tabla del README.

## Reglas que no se rompen
- Toda tabla de negocio lleva `empresa_id`, RLS con `FORCE` y la política `aislamiento`.
  Se agrega a la lista del bloque `DO $$` de la migración correspondiente.
- Tablas de negocio solo dentro de `Db.enEmpresa(ctx.empresaId, tx => ...)`. Nunca `db.k` directo.
- Claves foráneas entre tablas de negocio: compuestas `(empresa_id, id)`.
- Cada endpoint declara `@Requiere(recurso, accion)`, `@SoloSesion()` o `@Publico()`.
  Sin declaración, AuthGuard lo rechaza. Registrar el controlador en `test/aislamiento.test.ts`.
- Todo cambio de datos llama a `auditar(tx, ...)` en la misma transacción.
- Dinero `numeric(18,2)`, cantidades `numeric(18,4)`. Nunca `float`.
- Documentos con valor legal o contable no se borran: se anulan / desactivan.
- Permisos nuevos: solo en `packages/shared/src/permisos.ts` (el migrador los sincroniza).
- Al asignar perfiles o permisos: `verificarSinEscalada` (nadie da lo que no tiene).
- Las migraciones aplicadas no se editan (checksum). Cambios = nueva migración `NNNN_nombre.up.sql` + `.down.sql`.
- Interfaz: español, íconos de línea (lucide), sin emojis, sin datos de ejemplo.
  Pie: "KONTIVA ERP · Desarrollado por Araújo Tech Sistemas".

## Comandos
- `pnpm install` · `pnpm build` · `pnpm test` (necesita PostgreSQL 16 en localhost:5432; ver PG_ADMIN_URL)
- `pnpm db:migrate` · `pnpm --filter @kontiva/api cli empresa:crear --razon ... --plan START --email ... --nombre ...`
- `pnpm dev:api` y `pnpm dev:web` (la web usa proxy /api → :3000)
