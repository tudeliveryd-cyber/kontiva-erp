import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ajusteListaEntrada, listaPrecioEntrada, preciosListaEntrada } from '@kontiva/shared';
import Decimal from 'decimal.js';
import { sql } from 'kysely';
import { z } from 'zod';
import { exigirSucursal } from '../comun/alcance';
import { auditar } from '../comun/auditoria';
import { Contexto, OrigenPeticion, type Ctx, type Origen } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { conflicto, invalido, noEncontrado } from '../comun/errores';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';

const NULO = '00000000-0000-0000-0000-000000000000';

async function obtener(tx: Tx, id: string) {
  const l = await tx.selectFrom('lista_precio').selectAll().where('id', '=', id).executeTakeFirst();
  if (!l) throw noEncontrado('Lista de precios');
  return l;
}

const aDto = (l: { id: string; nombre: string; predeterminada: boolean; activa: boolean }) => ({
  id: l.id,
  nombre: l.nombre,
  predeterminada: l.predeterminada,
  activa: l.activa,
});

async function exigirSucursalExistente(tx: Tx, ctx: Ctx, sucursalId: string) {
  const s = await tx.selectFrom('sucursal').select('id').where('id', '=', sucursalId).executeTakeFirst();
  if (!s) throw noEncontrado('Sucursal');
  exigirSucursal(ctx, sucursalId, 'Sucursal');
}

/**
 * Listas de precios. La predeterminada es el precio de venta normal (se edita también desde Productos);
 * las adicionales (mayorista, revendedor…) se asignan a clientes. Cualquier lista admite precio por sucursal.
 */
@Controller('listas-precio')
export class ListasPrecioController {
  constructor(private readonly db: Db) {}

  @Requiere('precio', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const { rows } = await sql<{ id: string; nombre: string; predeterminada: boolean; activa: boolean; precios: string; clientes: string }>`
        SELECT l.id, l.nombre, l.predeterminada, l.activa,
          (SELECT count(*) FROM precio p WHERE p.lista_id = l.id) AS precios,
          (SELECT count(*) FROM cliente c WHERE c.lista_precio_id = l.id AND c.activo) AS clientes
        FROM lista_precio l
        ORDER BY l.predeterminada DESC, l.activa DESC, l.nombre`.execute(tx);
      return rows.map((r) => ({ ...aDto(r), precios: Number(r.precios), clientes: Number(r.clientes) }));
    });
  }

  @Requiere('precio', 'editar')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(listaPrecioEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const existe = await tx.selectFrom('lista_precio').select('id').where(sql`lower(nombre)`, '=', d.nombre.toLowerCase()).executeTakeFirst();
      if (existe) throw conflicto('NOMBRE_REPETIDO', 'Ya existe una lista con ese nombre');
      const l = await tx.insertInto('lista_precio').values({ empresa_id: ctx.empresaId, nombre: d.nombre }).returningAll().executeTakeFirstOrThrow();
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'lista_precio', entidadId: l.id, despues: aDto(l) });
      return aDto(l);
    });
  }

  @Requiere('precio', 'editar')
  @Patch(':id')
  editar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(listaPrecioEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const antes = await obtener(tx, id);
      if (antes.predeterminada && d.activa === false) throw invalido('La lista de precio normal no se puede desactivar');
      const repetida = await tx
        .selectFrom('lista_precio')
        .select('id')
        .where(sql`lower(nombre)`, '=', d.nombre.toLowerCase())
        .where('id', '<>', id)
        .executeTakeFirst();
      if (repetida) throw conflicto('NOMBRE_REPETIDO', 'Ya existe una lista con ese nombre');
      const l = await tx
        .updateTable('lista_precio')
        .set({ nombre: d.nombre, ...(d.activa !== undefined && { activa: d.activa }) })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await auditar(tx, { ...ctx, ...o }, { accion: 'editar', entidad: 'lista_precio', entidadId: id, antes: aDto(antes), despues: aDto(l) });
      return aDto(l);
    });
  }

  /** Productos con el precio normal y el de esta lista (en general o para una sucursal). */
  @Requiere('precio', 'ver')
  @Get(':id/precios')
  precios(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Query() query: unknown) {
    const f = validar(
      z.object({
        q: z.string().trim().max(100).optional(),
        categoriaId: z.string().uuid().optional(),
        sucursalId: z.string().uuid().optional(),
        soloEspeciales: z.enum(['true', 'false']).optional(),
        limite: z.coerce.number().int().min(1).max(500).default(100),
        desde: z.coerce.number().int().min(0).default(0),
      }),
      query,
    );
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const lista = await obtener(tx, id);
      if (f.sucursalId) await exigirSucursalExistente(tx, ctx, f.sucursalId);
      const pred = lista.predeterminada ? lista.id : (await tx.selectFrom('lista_precio').select('id').where('predeterminada', '=', true).executeTakeFirstOrThrow()).id;
      const suc = f.sucursalId ?? null;
      const texto = f.q ? `%${f.q.replace(/[%_\\]/g, '\\$&')}%` : null;
      const { rows } = await sql<{
        variante_id: string;
        producto: string;
        variante: string | null;
        sku: string | null;
        normal: string | null;
        normal_sucursal: string | null;
        general: string | null;
        especial: string | null;
        total: string;
      }>`
        SELECT v.id AS variante_id, p.nombre AS producto, v.nombre AS variante, v.sku,
          pn.precio AS normal, pns.precio AS normal_sucursal, pg.precio AS general, pe.precio AS especial,
          count(*) OVER () AS total
        FROM variante v
        JOIN producto p ON p.id = v.producto_id
        LEFT JOIN precio pn ON pn.lista_id = ${pred}::uuid AND pn.variante_id = v.id AND pn.sucursal_id IS NULL
        LEFT JOIN precio pns ON ${suc}::uuid IS NOT NULL AND pns.lista_id = ${pred}::uuid AND pns.variante_id = v.id AND pns.sucursal_id = ${suc}::uuid
        LEFT JOIN precio pg ON pg.lista_id = ${id}::uuid AND pg.variante_id = v.id AND pg.sucursal_id IS NULL
        LEFT JOIN precio pe ON pe.lista_id = ${id}::uuid AND pe.variante_id = v.id
          AND coalesce(pe.sucursal_id, ${NULO}::uuid) = coalesce(${suc}::uuid, ${NULO}::uuid)
        WHERE p.activo AND v.activa
          ${texto ? sql`AND (p.nombre ILIKE ${texto} OR v.nombre ILIKE ${texto} OR v.sku ILIKE ${texto})` : sql``}
          ${f.categoriaId ? sql`AND p.categoria_id = ${f.categoriaId}::uuid` : sql``}
          ${f.soloEspeciales === 'true' ? sql`AND pe.precio IS NOT NULL` : sql``}
        ORDER BY p.nombre, v.nombre NULLS FIRST
        LIMIT ${f.limite} OFFSET ${f.desde}`.execute(tx);
      return {
        lista: aDto(lista),
        sucursalId: suc,
        total: Number(rows[0]?.total ?? 0),
        items: rows.map((r) => ({
          varianteId: r.variante_id,
          descripcion: r.variante ? `${r.producto} · ${r.variante}` : r.producto,
          sku: r.sku,
          // Precio que se cobraría sin esta lista en ese nivel.
          normal: r.normal_sucursal ?? r.normal ?? '0.00',
          // Precio de esta lista en general (útil al ver una sucursal).
          general: lista.predeterminada ? (r.normal ?? null) : r.general,
          especial: r.especial,
        })),
      };
    });
  }

  @Requiere('precio', 'editar')
  @Put(':id/precios')
  guardarPrecios(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(preciosListaEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const lista = await obtener(tx, id);
      const suc = d.sucursalId ?? null;
      if (suc) await exigirSucursalExistente(tx, ctx, suc);
      if (lista.predeterminada && !suc && d.items.some((i) => i.precio === null)) throw invalido('El precio normal de un producto no se puede quitar');
      const ids = [...new Set(d.items.map((i) => i.varianteId))];
      if (ids.length !== d.items.length) throw invalido('Hay productos repetidos');
      const existentes = await tx.selectFrom('variante').select('id').where('id', 'in', ids).execute();
      if (existentes.length !== ids.length) throw invalido('Algún producto no existe');

      const antes = await tx
        .selectFrom('precio')
        .select(['variante_id', 'precio'])
        .where('lista_id', '=', id)
        .where('variante_id', 'in', ids)
        .where((eb) => (suc ? eb('sucursal_id', '=', suc) : eb('sucursal_id', 'is', null)))
        .execute();
      const previo = new Map(antes.map((a) => [a.variante_id, a.precio]));
      const cambios: { varianteId: string; antes: string | null; despues: string | null }[] = [];
      for (const it of d.items) {
        const nuevo = it.precio === null ? null : new Decimal(it.precio).toFixed(2);
        const viejo = previo.get(it.varianteId) ?? null;
        if (nuevo === (viejo === null ? null : new Decimal(viejo).toFixed(2))) continue;
        if (nuevo === null) {
          await tx
            .deleteFrom('precio')
            .where('lista_id', '=', id)
            .where('variante_id', '=', it.varianteId)
            .where((eb) => (suc ? eb('sucursal_id', '=', suc) : eb('sucursal_id', 'is', null)))
            .execute();
        } else {
          await sql`
            INSERT INTO precio (empresa_id, lista_id, variante_id, sucursal_id, precio)
            VALUES (${ctx.empresaId}::uuid, ${id}::uuid, ${it.varianteId}::uuid, ${suc}::uuid, ${nuevo})
            ON CONFLICT (empresa_id, lista_id, variante_id, coalesce(sucursal_id, '00000000-0000-0000-0000-000000000000'))
            DO UPDATE SET precio = EXCLUDED.precio, actualizado_en = now()`.execute(tx);
        }
        cambios.push({ varianteId: it.varianteId, antes: viejo, despues: nuevo });
      }
      if (cambios.length) {
        await auditar(tx, { ...ctx, ...o }, { accion: 'precios', entidad: 'lista_precio', entidadId: id, despues: { lista: lista.nombre, sucursalId: suc, cambios } });
      }
      return { cambiados: cambios.length };
    });
  }

  /** Carga la lista a partir del precio normal con un porcentaje y redondeo (p. ej. mayorista -10 %). */
  @Requiere('precio', 'editar')
  @Post(':id/ajuste')
  ajuste(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(ajusteListaEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const lista = await obtener(tx, id);
      if (lista.predeterminada) throw invalido('El ajuste por porcentaje se aplica a listas adicionales');
      const pred = (await tx.selectFrom('lista_precio').select('id').where('predeterminada', '=', true).executeTakeFirstOrThrow()).id;
      const factor = new Decimal(100).plus(d.porcentaje).div(100);
      const r = d.redondeo;
      // Redondeo al múltiplo más cercano (Gs.), sin bajar de cero.
      const { rows } = await sql<{ n: string }>`
        WITH base AS (
          SELECT pn.variante_id, greatest(round(pn.precio * ${factor.toString()}::numeric / ${r}::numeric) * ${r}::numeric, 0) AS nuevo
          FROM precio pn
          JOIN variante v ON v.id = pn.variante_id
          JOIN producto p ON p.id = v.producto_id
          WHERE pn.lista_id = ${pred}::uuid AND pn.sucursal_id IS NULL AND p.activo AND v.activa
            ${d.categoriaId ? sql`AND p.categoria_id = ${d.categoriaId}::uuid` : sql``}
            ${d.soloSinPrecio ? sql`AND NOT EXISTS (SELECT 1 FROM precio x WHERE x.lista_id = ${id}::uuid AND x.variante_id = pn.variante_id AND x.sucursal_id IS NULL)` : sql``}
        ), ins AS (
          INSERT INTO precio (empresa_id, lista_id, variante_id, sucursal_id, precio)
          SELECT ${ctx.empresaId}::uuid, ${id}::uuid, variante_id, NULL, nuevo FROM base
          ON CONFLICT (empresa_id, lista_id, variante_id, coalesce(sucursal_id, '00000000-0000-0000-0000-000000000000'))
          DO UPDATE SET precio = EXCLUDED.precio, actualizado_en = now()
          RETURNING 1
        )
        SELECT count(*) AS n FROM ins`.execute(tx);
      const actualizados = Number(rows[0]!.n);
      await auditar(tx, { ...ctx, ...o }, { accion: 'ajuste_precios', entidad: 'lista_precio', entidadId: id, despues: { lista: lista.nombre, ...d, actualizados } });
      return { actualizados };
    });
  }
}
