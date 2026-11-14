import { Controller, Get, StreamableFile } from '@nestjs/common';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { sql } from 'kysely';
import { auditar } from '../comun/auditoria';
import { Contexto, type Ctx, OrigenPeticion, type Origen } from '../comun/contexto';
import { SoloSesion } from '../comun/decoradores';
import { prohibido } from '../comun/errores';
import { Db } from '../db/database';

/** Tablas que no son datos del negocio sino de acceso (sesiones, enlaces de recuperación). */
const TABLAS_EXCLUIDAS = new Set(['sesion', 'token_cuenta', 'codigo_respaldo', 'cuenta']);
/** Columnas con secretos: nunca salen, ni cifradas. */
const COLUMNA_SECRETA = /(hash|cifrad|secreto|totp|certificado_clave|clave_idempotencia)/;

/** Un valor de PostgreSQL como texto de CSV (RFC 4180): fechas en ISO, JSON y listas en JSON. */
function celda(v: unknown): string {
  if (v === null || v === undefined) return '';
  let t: string;
  if (v instanceof Date) t = v.toISOString();
  else if (typeof v === 'object') t = JSON.stringify(v);
  else t = String(v);
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function aCsv(columnas: string[], filas: Record<string, unknown>[]): string {
  const lineas = [columnas.join(','), ...filas.map((f) => columnas.map((c) => celda(f[c])).join(','))];
  return `﻿${lineas.join('\r\n')}\r\n`;
}

const LEEME = (empresa: string, fecha: string) => `KONTIVA ERP · Exportación de datos
Empresa: ${empresa}
Generada: ${fecha}

Contenido
- Un archivo CSV por tabla (UTF-8, separado por comas, primera fila con los nombres de columna).
  Se abre con Excel, LibreOffice o Google Sheets, o se importa en otra base de datos.
- manifiesto.json: lista de tablas, columnas y cantidad de filas.

Notas
- Fechas y horas en ISO 8601 (UTC). Importes con punto decimal.
- Los identificadores (id, *_id) relacionan las tablas entre sí: por ejemplo venta_item.venta_id = venta.id.
- No se incluyen contraseñas, PIN, segundos factores, certificados ni claves (ni siquiera cifrados).
- Los documentos electrónicos (XML firmados) están en documento_electronico.

KONTIVA ERP · Desarrollado por Araújo Tech Sistemas
`;

@Controller('empresa')
export class ExportacionController {
  constructor(private readonly db: Db) {}

  /**
   * Exporta todos los datos de la empresa en un ZIP de CSV (portabilidad: la empresa es dueña de sus datos).
   * Solo el propietario. Cada tabla se lee con el aislamiento por empresa activo.
   */
  @SoloSesion()
  @Get('exportar')
  exportar(@Contexto() ctx: Ctx, @OrigenPeticion() o: Origen) {
    if (!ctx.esPropietario) throw prohibido('Solo el propietario puede exportar los datos de la empresa');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const columnas = await sql<{ tabla: string; columna: string }>`
        select c.table_name as tabla, c.column_name as columna
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name in (select table_name from information_schema.columns where table_schema = 'public' and column_name = 'empresa_id')
          and c.table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')
        order by c.table_name, c.ordinal_position`.execute(tx);
      const porTabla = new Map<string, string[]>();
      for (const r of columnas.rows) {
        if (TABLAS_EXCLUIDAS.has(r.tabla) || COLUMNA_SECRETA.test(r.columna)) continue;
        porTabla.set(r.tabla, [...(porTabla.get(r.tabla) ?? []), r.columna]);
      }
      const empresa = await tx.selectFrom('empresa').select(['razon_social', 'ruc']).where('id', '=', ctx.empresaId).executeTakeFirstOrThrow();
      const archivos: Zippable = {};
      const manifiesto: { tabla: string; filas: number; columnas: string[] }[] = [];
      const datosEmpresa = (await sql<Record<string, unknown>>`select * from empresa where id = ${ctx.empresaId}`.execute(tx)).rows;
      const colsEmpresa = Object.keys(datosEmpresa[0] ?? {}).filter((c) => !COLUMNA_SECRETA.test(c));
      archivos['empresa.csv'] = strToU8(aCsv(colsEmpresa, datosEmpresa));
      manifiesto.push({ tabla: 'empresa', filas: datosEmpresa.length, columnas: colsEmpresa });
      for (const [tabla, cols] of porTabla) {
        // Nombres de tabla y columna salen del catálogo de PostgreSQL (no del usuario).
        const lista = sql.join(cols.map((c) => sql.ref(c)));
        const orden = cols.includes('id') ? sql`order by id` : sql``;
        const filas = (await sql<Record<string, unknown>>`select ${lista} from ${sql.table(tabla)} where empresa_id = ${ctx.empresaId} ${orden}`.execute(tx)).rows;
        archivos[`${tabla}.csv`] = strToU8(aCsv(cols, filas));
        manifiesto.push({ tabla, filas: filas.length, columnas: cols });
      }
      const fecha = new Date();
      archivos['manifiesto.json'] = strToU8(JSON.stringify({ empresa: empresa.razon_social, ruc: empresa.ruc, generada: fecha.toISOString(), tablas: manifiesto }, null, 2));
      archivos['LEEME.txt'] = strToU8(LEEME(empresa.razon_social, fecha.toISOString()));
      const zip = zipSync(archivos, { level: 6 });
      await auditar(tx, { ...ctx, ...o }, { accion: 'exportar', entidad: 'empresa', entidadId: ctx.empresaId, despues: { tablas: manifiesto.length, filas: manifiesto.reduce((a, m) => a + m.filas, 0), bytes: zip.length } });
      const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(fecha).replace(/-/g, '');
      const nombre = `kontiva-${(empresa.ruc ?? empresa.razon_social).normalize('NFD').replace(/[^0-9A-Za-z-]+/g, '-').slice(0, 40)}-${dia}.zip`;
      return new StreamableFile(Buffer.from(zip), { type: 'application/zip', disposition: `attachment; filename="${nombre}"` });
    });
  }
}
