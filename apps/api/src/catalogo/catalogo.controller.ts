import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { nombreSimple, productoEntrada, type ProductoEntrada } from '@kontiva/shared';
import { sql } from 'kysely';
import { z } from 'zod';
import { booleanoQuery } from '@kontiva/shared';
import { listaPredeterminada } from '../comun/alcance';
import { auditar } from '../comun/auditoria';
import { Contexto, OrigenPeticion, tiene, type Ctx, type Origen } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { conflicto, invalido, noEncontrado, prohibido } from '../comun/errores';
import { conciliarLotes } from '../comun/lotes';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';

/** Producto con sus variantes, códigos y precio general. El costo solo con costo_producto.ver. */
export async function leerProducto(tx: Tx, ctx: Ctx, id: string) {
  const p = await tx
    .selectFrom('producto as p')
    .leftJoin('categoria as c', 'c.id', 'p.categoria_id')
    .leftJoin('marca as m', 'm.id', 'p.marca_id')
    .select([
      'p.id', 'p.nombre', 'p.descripcion', 'p.categoria_id', 'p.marca_id', 'p.tipo', 'p.unidad', 'p.tasa_iva',
      'p.controla_stock', 'p.controla_lote', 'p.principio_activo', 'p.concentracion', 'p.forma', 'p.registro_sanitario', 'p.condicion_venta', 'p.estacion', 'p.activo', 'p.creado_en', 'c.nombre as categoria', 'm.nombre as marca',
    ])
    .where('p.id', '=', id)
    .executeTakeFirst();
  if (!p) throw noEncontrado('Producto');
  const lista = await listaPredeterminada(tx);
  const variantes = await tx
    .selectFrom('variante as v')
    .leftJoin('precio as pr', (j) => j.onRef('pr.variante_id', '=', 'v.id').on('pr.lista_id', '=', lista).on('pr.sucursal_id', 'is', null))
    .select(['v.id', 'v.nombre', 'v.sku', 'v.costo', 'v.stock_minimo', 'v.activa', 'pr.precio'])
    .where('v.producto_id', '=', id)
    .orderBy('v.creado_en')
    .orderBy('v.id')
    .execute();
  const codigos = variantes.length
    ? await tx.selectFrom('codigo_barras').select(['codigo', 'variante_id']).where('variante_id', 'in', variantes.map((v) => v.id)).execute()
    : [];
  const verCosto = tiene(ctx, 'costo_producto.ver');
  return {
    id: p.id,
    nombre: p.nombre,
    descripcion: p.descripcion,
    categoria: p.categoria_id ? { id: p.categoria_id, nombre: p.categoria } : null,
    marca: p.marca_id ? { id: p.marca_id, nombre: p.marca } : null,
    tipo: p.tipo,
    unidad: p.unidad,
    tasaIva: Number(p.tasa_iva),
    controlaStock: p.controla_stock,
    controlaLote: p.controla_lote,
    principioActivo: p.principio_activo,
    concentracion: p.concentracion,
    forma: p.forma,
    registroSanitario: p.registro_sanitario,
    condicionVenta: p.condicion_venta,
    estacion: p.estacion,
    activo: p.activo,
    creadoEn: p.creado_en,
    variantes: variantes.map((v) => ({
      id: v.id,
      nombre: v.nombre,
      sku: v.sku,
      activa: v.activa,
      precio: v.precio ?? '0.00',
      stockMinimo: v.stock_minimo,
      ...(verCosto ? { costo: v.costo } : {}),
      codigos: codigos.filter((c) => c.variante_id === v.id).map((c) => c.codigo),
    })),
  };
}

@Controller('productos')
export class ProductosController {
  constructor(private readonly db: Db) {}

  @Requiere('producto', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(
      z.object({
        q: z.string().trim().max(100).optional(),
        categoriaId: z.string().uuid().optional(),
        inactivos: booleanoQuery,
        pagina: z.coerce.number().int().min(1).default(1),
        limite: z.coerce.number().int().min(1).max(200).default(50),
      }),
      query,
    );
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let q = tx.selectFrom('producto as p').select('p.id');
      if (!f.inactivos) q = q.where('p.activo', '=', true);
      if (f.categoriaId) q = q.where('p.categoria_id', '=', f.categoriaId);
      if (f.q) {
        const patron = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`;
        q = q.where((eb) =>
          eb.or([
            eb('p.nombre', 'ilike', patron),
            eb('p.principio_activo', 'ilike', patron),
            eb.exists(eb.selectFrom('variante as v').select('v.id').whereRef('v.producto_id', '=', 'p.id').where('v.sku', 'ilike', patron)),
            eb.exists(
              eb.selectFrom('codigo_barras as cb').innerJoin('variante as v2', 'v2.id', 'cb.variante_id').select('cb.codigo').whereRef('v2.producto_id', '=', 'p.id').where('cb.codigo', '=', f.q!),
            ),
          ]),
        );
      }
      const total = await q.clearSelect().select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
      const ids = await q.orderBy('p.nombre').limit(f.limite).offset((f.pagina - 1) * f.limite).execute();
      return { total: Number(total.n), items: await Promise.all(ids.map((r) => leerProducto(tx, ctx, r.id))) };
    });
  }

  @Requiere('producto', 'ver')
  @Get(':id')
  ver(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, (tx) => leerProducto(tx, ctx, id));
  }

  @Requiere('producto', 'crear')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(productoEntrada, body);
    if (d.variantes.some((v) => v.costo !== undefined && v.costo > 0) && !tiene(ctx, 'costo_producto.editar')) {
      throw prohibido('No tiene permiso para cargar costos');
    }
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const p = await tx
        .insertInto('producto')
        .values({ empresa_id: ctx.empresaId, ...this.columnas(d), creado_por: ctx.usuarioId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.guardarVariantes(tx, ctx, p.id, d, true);
      const despues = await leerProducto(tx, ctx, p.id);
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'producto', entidadId: p.id, despues });
      return despues;
    });
  }

  @Requiere('producto', 'editar')
  @Patch(':id')
  editar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(productoEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const antes = await leerProducto(tx, ctx, id);
      await tx.updateTable('producto').set(this.columnas(d)).where('id', '=', id).execute();
      await this.guardarVariantes(tx, ctx, id, d, false, antes);
      // Al activar el control por lote, el stock existente queda en el lote "sin lote" de cada depósito.
      if (!antes.controlaLote && this.columnas(d).controla_lote) await conciliarLotes(tx, ctx, antes.variantes.map((v) => v.id));
      const despues = await leerProducto(tx, ctx, id);
      await auditar(tx, { ...ctx, ...o }, { accion: 'editar', entidad: 'producto', entidadId: id, antes, despues });
      return despues;
    });
  }

  /** Los productos con historia no se borran: se desactivan. */
  @Requiere('producto', 'eliminar')
  @Delete(':id')
  @HttpCode(204)
  async desactivar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @OrigenPeticion() o: Origen) {
    await this.db.enEmpresa(ctx.empresaId, async (tx) => {
      await leerProducto(tx, ctx, id);
      await tx.updateTable('producto').set({ activo: false }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'desactivar', entidad: 'producto', entidadId: id });
    });
  }

  private columnas(d: ProductoEntrada) {
    return {
      nombre: d.nombre,
      descripcion: d.descripcion ?? null,
      categoria_id: d.categoriaId ?? null,
      marca_id: d.marcaId ?? null,
      tipo: d.tipo,
      unidad: d.unidad,
      tasa_iva: d.tasaIva,
      controla_stock: d.tipo === 'servicio' ? false : d.controlaStock,
      controla_lote: d.tipo !== 'servicio' && d.controlaStock && d.controlaLote,
      principio_activo: d.principioActivo ?? null,
      concentracion: d.concentracion ?? null,
      forma: d.forma ?? null,
      registro_sanitario: d.registroSanitario ?? null,
      condicion_venta: d.condicionVenta,
      estacion: d.tipo === 'servicio' ? null : d.estacion,
      activo: d.activo,
    };
  }

  private async guardarVariantes(tx: Tx, ctx: Ctx, productoId: string, d: ProductoEntrada, nuevo: boolean, antes?: Awaited<ReturnType<typeof leerProducto>>) {
    const lista = await listaPredeterminada(tx);
    const puedeCosto = tiene(ctx, 'costo_producto.editar');
    const puedePrecio = nuevo || tiene(ctx, 'precio.editar');
    const todosCodigos = d.variantes.flatMap((v) => v.codigos);
    if (new Set(todosCodigos).size !== todosCodigos.length) throw invalido('Hay códigos de barras repetidos');
    const recibidas = new Set<string>();
    // Los códigos del producto se reescriben completos (permite mover un código entre variantes).
    if (antes?.variantes.length) await tx.deleteFrom('codigo_barras').where('variante_id', 'in', antes.variantes.map((v) => v.id)).execute();

    for (const v of d.variantes) {
      let varianteId = v.id;
      const previa = v.id ? antes?.variantes.find((x) => x.id === v.id) : undefined;
      if (v.id && !previa) throw invalido('Variante inexistente en este producto');
      if (!puedeCosto && previa && v.costo !== undefined && 'costo' in previa && String(v.costo.toFixed(2)) !== previa.costo) {
        throw prohibido('No tiene permiso para cambiar costos');
      }
      if (!puedePrecio && previa && v.precio.toFixed(2) !== Number(previa.precio).toFixed(2)) throw prohibido('No tiene permiso para cambiar precios');
      if (!puedePrecio && !previa) throw prohibido('No tiene permiso para cargar precios');

      if (varianteId) {
        await tx
          .updateTable('variante')
          .set({ nombre: v.nombre ?? null, sku: v.sku ?? null, activa: v.activa, ...(v.stockMinimo !== undefined ? { stock_minimo: v.stockMinimo } : {}), ...(puedeCosto && v.costo !== undefined ? { costo: v.costo } : {}) })
          .where('id', '=', varianteId)
          .execute();
      } else {
        varianteId = (
          await tx
            .insertInto('variante')
            .values({ empresa_id: ctx.empresaId, producto_id: productoId, nombre: v.nombre ?? null, sku: v.sku ?? null, activa: v.activa, stock_minimo: v.stockMinimo ?? 0, costo: puedeCosto ? (v.costo ?? 0) : 0 })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      }
      recibidas.add(varianteId);

      // Un código ya usado por otro producto → 409.
      if (v.codigos.length) {
        const usados = await tx.selectFrom('codigo_barras').select('codigo').where('codigo', 'in', v.codigos).execute();
        if (usados.length) throw conflicto('CODIGO_EN_USO', `El código ${usados[0]!.codigo} ya está asignado a otro producto`);
        await tx.insertInto('codigo_barras').values(v.codigos.map((codigo) => ({ empresa_id: ctx.empresaId, codigo, variante_id: varianteId! }))).execute();
      }

      if (puedePrecio) {
        await sql`
          INSERT INTO precio (empresa_id, lista_id, variante_id, sucursal_id, precio)
          VALUES (${ctx.empresaId}::uuid, ${lista}::uuid, ${varianteId}::uuid, NULL, ${v.precio.toFixed(2)})
          ON CONFLICT (empresa_id, lista_id, variante_id, coalesce(sucursal_id, '00000000-0000-0000-0000-000000000000'))
          DO UPDATE SET precio = EXCLUDED.precio, actualizado_en = now() WHERE precio.precio IS DISTINCT FROM EXCLUDED.precio`.execute(tx);
      }
    }
    // Las variantes que ya no vienen se desactivan (tienen historia de ventas y stock).
    for (const v of antes?.variantes ?? []) {
      if (!recibidas.has(v.id)) await tx.updateTable('variante').set({ activa: false }).where('id', '=', v.id).execute();
    }
  }
}

@Controller('categorias')
export class CategoriasController {
  constructor(private readonly db: Db) {}

  @Requiere('producto', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx) {
    return this.db.enEmpresa(ctx.empresaId, (tx) => tx.selectFrom('categoria').select(['id', 'nombre']).where('activa', '=', true).orderBy('nombre').execute());
  }

  @Requiere('producto', 'crear')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(nombreSimple, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const c = await tx.insertInto('categoria').values({ empresa_id: ctx.empresaId, nombre: d.nombre }).returning(['id', 'nombre']).executeTakeFirstOrThrow();
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'categoria', entidadId: c.id, despues: c });
      return c;
    });
  }
}

@Controller('marcas')
export class MarcasController {
  constructor(private readonly db: Db) {}

  @Requiere('producto', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx) {
    return this.db.enEmpresa(ctx.empresaId, (tx) => tx.selectFrom('marca').select(['id', 'nombre']).orderBy('nombre').execute());
  }

  @Requiere('producto', 'crear')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(nombreSimple, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const m = await tx.insertInto('marca').values({ empresa_id: ctx.empresaId, nombre: d.nombre }).returning(['id', 'nombre']).executeTakeFirstOrThrow();
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'marca', entidadId: m.id, despues: m });
      return m;
    });
  }
}
