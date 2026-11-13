import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { MAX_FILAS_IMPORTACION, validarFilaCliente, validarFilaProducto, type FilaCliente, type FilaProducto } from '@kontiva/shared';
import Decimal from 'decimal.js';
import { sql } from 'kysely';
import { z } from 'zod';
import { exigirSucursal, listaPredeterminada } from '../comun/alcance';
import { auditar } from '../comun/auditoria';
import { Contexto, OrigenPeticion, tiene, type Ctx, type Origen } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { ErrorNegocio, noEncontrado } from '../comun/errores';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';

type Accion = 'crear' | 'actualizar' | 'error';

interface ResultadoFila {
  fila: number;
  accion: Accion;
  descripcion: string;
  errores: string[];
  stock?: { antes: string; despues: string } | null;
}

const entradaProductos = z.object({
  simular: z.boolean().default(true),
  depositoId: z.string().uuid().nullable().optional(),
  tipoStock: z.enum(['inicial', 'ajuste']).default('inicial'),
  filas: z.array(z.object({ fila: z.number().int().min(1), valores: z.record(z.string(), z.unknown()) })).min(1).max(MAX_FILAS_IMPORTACION),
});

const entradaClientes = z.object({
  simular: z.boolean().default(true),
  filas: z.array(z.object({ fila: z.number().int().min(1), valores: z.record(z.string(), z.unknown()) })).min(1).max(MAX_FILAS_IMPORTACION),
});

const clave = (s: string | null) => (s ?? '').trim().toLowerCase();

/** Una fila ya validada y emparejada con lo que existe en la base. */
interface Plan {
  fila: number;
  datos: FilaProducto;
  grupo: string; // nombre normalizado: filas del mismo grupo son variantes de un producto
  productoId: string | null; // existente
  varianteId: string | null; // existente
  errores: string[];
}

@Controller('importaciones')
export class ImportacionController {
  constructor(private readonly db: Db) {}

  /**
   * Productos (con variantes, códigos, precio, costo y stock) desde una planilla.
   * Empareja por código de barras, luego SKU, luego nombre + variante: reimportar la misma
   * planilla actualiza en lugar de duplicar. Con simular=true no escribe nada.
   * Con simular=false escribe todo en una transacción, o nada si alguna fila tiene errores.
   */
  @Requiere('producto', 'crear')
  @Post('productos')
  @HttpCode(200)
  productos(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(entradaProductos, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const globales: string[] = [];
      let deposito: { id: string; sucursal_id: string } | undefined;
      if (d.depositoId) {
        deposito = await tx.selectFrom('deposito').select(['id', 'sucursal_id']).where('id', '=', d.depositoId).executeTakeFirst();
        if (!deposito) throw noEncontrado('Depósito');
        exigirSucursal(ctx, deposito.sucursal_id, 'Depósito');
      }

      // 1. Validación de cada fila.
      const planes: Plan[] = d.filas.map((f) => {
        const r = validarFilaProducto(f.valores);
        return 'ok' in r
          ? { fila: f.fila, datos: r.ok, grupo: clave(r.ok.nombre), productoId: null, varianteId: null, errores: [] }
          : { fila: f.fila, datos: null as unknown as FilaProducto, grupo: '', productoId: null, varianteId: null, errores: r.errores };
      });
      const validos = planes.filter((p) => !p.errores.length);

      if (validos.some((p) => p.datos.costo !== null) && !tiene(ctx, 'costo_producto.editar')) globales.push('La planilla trae costos y usted no tiene permiso para cargarlos (quite la columna Costo)');
      if (validos.some((p) => p.datos.stock !== null)) {
        if (!tiene(ctx, 'stock.editar')) globales.push('La planilla trae stock y usted no tiene permiso para ajustarlo (quite la columna Stock)');
        else if (!deposito) globales.push('Elija el depósito donde cargar el stock');
      }

      // 2. Repetidos dentro de la planilla.
      const vistosCodigo = new Map<string, number>();
      const vistosSku = new Map<string, number>();
      const vistosNombre = new Map<string, number>();
      for (const p of validos) {
        for (const c of p.datos.codigos) {
          if (vistosCodigo.has(c)) p.errores.push(`Código ${c} repetido (fila ${vistosCodigo.get(c)})`);
          else vistosCodigo.set(c, p.fila);
        }
        if (p.datos.sku) {
          const s = clave(p.datos.sku);
          if (vistosSku.has(s)) p.errores.push(`SKU ${p.datos.sku} repetido (fila ${vistosSku.get(s)})`);
          else vistosSku.set(s, p.fila);
        }
        const n = `${p.grupo}|${clave(p.datos.variante)}`;
        if (vistosNombre.has(n)) p.errores.push(`Producto repetido (fila ${vistosNombre.get(n)})`);
        else vistosNombre.set(n, p.fila);
      }

      // 3. Emparejar con lo existente (consultas en lote).
      const codigos = [...vistosCodigo.keys()];
      const skus = [...vistosSku.keys()];
      const nombres = [...new Set(validos.map((p) => p.grupo))];
      const porCodigo = new Map(
        (codigos.length
          ? await tx.selectFrom('codigo_barras as c').innerJoin('variante as v', 'v.id', 'c.variante_id').select(['c.codigo', 'v.id', 'v.producto_id']).where('c.codigo', 'in', codigos).execute()
          : []
        ).map((r) => [r.codigo, r]),
      );
      const porSku = new Map(
        (skus.length ? await tx.selectFrom('variante').select(['id', 'producto_id', sql<string>`lower(sku)`.as('s')]).where(sql`lower(sku)`, 'in', skus).execute() : []).map((r) => [r.s, r]),
      );
      const existentesPorNombre = nombres.length
        ? await tx
            .selectFrom('producto as p')
            .innerJoin('variante as v', 'v.producto_id', 'p.id')
            .select(['p.id as producto_id', sql<string>`lower(p.nombre)`.as('n'), 'v.id', 'v.nombre as variante'])
            .where(sql`lower(p.nombre)`, 'in', nombres)
            .where('p.activo', '=', true)
            .execute()
        : [];

      for (const p of validos) {
        let m = p.datos.codigos.map((c) => porCodigo.get(c)).find(Boolean) as { id: string; producto_id: string } | undefined;
        if (!m && p.datos.sku) m = porSku.get(clave(p.datos.sku));
        if (!m) {
          const e = existentesPorNombre.find((x) => x.n === p.grupo && clave(x.variante) === clave(p.datos.variante));
          if (e) m = { id: e.id, producto_id: e.producto_id };
        }
        // Código o SKU apuntan a una variante, pero el nombre coincide con otra: ambiguo, no se adivina.
        const porNombre = existentesPorNombre.find((x) => x.n === p.grupo && clave(x.variante) === clave(p.datos.variante));
        if (m && porNombre && porNombre.id !== m.id) {
          p.errores.push(`El código o SKU pertenece a otro producto que el nombre "${p.datos.nombre}${p.datos.variante ? ' · ' + p.datos.variante : ''}"`);
          continue;
        }
        if (m) {
          p.varianteId = m.id;
          p.productoId = m.producto_id;
          for (const c of p.datos.codigos) {
            const otro = porCodigo.get(c);
            if (otro && otro.id !== m.id) p.errores.push(`El código ${c} ya pertenece a otro producto`);
          }
        } else {
          // Variante nueva de un producto existente con ese nombre.
          const e = existentesPorNombre.find((x) => x.n === p.grupo);
          if (e && p.datos.variante) p.productoId = e.producto_id;
        }
      }
      // Todas las filas de un mismo grupo apuntan al mismo producto.
      for (const g of nombres) {
        const ids = new Set(validos.filter((p) => p.grupo === g && p.productoId).map((p) => p.productoId));
        if (ids.size > 1) for (const p of validos.filter((x) => x.grupo === g)) p.errores.push('Filas con el mismo nombre coinciden con productos distintos');
        const id = [...ids][0];
        if (id) for (const p of validos.filter((x) => x.grupo === g)) p.productoId ??= id;
      }

      const actualiza = validos.some((p) => p.varianteId);
      if (actualiza && !tiene(ctx, 'producto.editar')) globales.push('La planilla actualiza productos existentes y usted no tiene permiso para editarlos');
      if (actualiza && !tiene(ctx, 'precio.editar')) globales.push('La planilla cambia precios de productos existentes y usted no tiene permiso para hacerlo');

      const resultado: ResultadoFila[] = planes.map((p) => ({
        fila: p.fila,
        accion: p.errores.length ? 'error' : p.varianteId ? 'actualizar' : 'crear',
        descripcion: p.datos ? (p.datos.variante ? `${p.datos.nombre} · ${p.datos.variante}` : p.datos.nombre) : String(d.filas.find((f) => f.fila === p.fila)?.valores.nombre ?? '').trim(),
        errores: p.errores,
      }));
      const resumen = {
        crear: resultado.filter((r) => r.accion === 'crear').length,
        actualizar: resultado.filter((r) => r.accion === 'actualizar').length,
        errores: resultado.filter((r) => r.accion === 'error').length,
        stock: validos.filter((p) => p.datos.stock !== null).length,
      };

      if (d.simular) return { simulado: true, globales, resumen, filas: resultado };
      if (globales.length || resumen.errores) {
        throw new ErrorNegocio(HttpStatus.BAD_REQUEST, 'IMPORTACION_CON_ERRORES', 'Corrija los errores de la planilla: no se importó nada', { globales, resumen, filas: resultado });
      }

      // 4. Escritura.
      const lista = await listaPredeterminada(tx);
      const categorias = new Map((await tx.selectFrom('categoria').select(['id', 'nombre']).execute()).map((c) => [clave(c.nombre), c.id]));
      for (const p of validos) {
        const c = p.datos.categoria;
        if (c && !categorias.has(clave(c))) {
          const nueva = await tx.insertInto('categoria').values({ empresa_id: ctx.empresaId, nombre: c }).returning('id').executeTakeFirstOrThrow();
          categorias.set(clave(c), nueva.id);
        }
      }

      // En una actualización solo cambia lo que la planilla trae completado:
      // una columna ausente o vacía no borra la categoría ni vuelve el IVA a 10 %.
      const crudo = new Map(d.filas.map((f) => [f.fila, f.valores]));
      const tiene_ = (fila: number, k: string) => {
        const v = crudo.get(fila)?.[k];
        return v !== null && v !== undefined && String(v).trim() !== '';
      };
      const productoDeGrupo = new Map<string, string>();
      for (const p of validos) {
        const atributos = {
          nombre: p.datos.nombre,
          categoria_id: p.datos.categoria ? categorias.get(clave(p.datos.categoria))! : null,
          tasa_iva: p.datos.tasaIva,
          unidad: p.datos.unidad,
        };
        const cambios = {
          nombre: p.datos.nombre,
          ...(tiene_(p.fila, 'categoria') && { categoria_id: atributos.categoria_id }),
          ...(tiene_(p.fila, 'iva') && { tasa_iva: p.datos.tasaIva }),
          ...(tiene_(p.fila, 'unidad') && { unidad: p.datos.unidad }),
        };
        let productoId = p.productoId ?? productoDeGrupo.get(p.grupo);
        if (!productoId) {
          productoId = (
            await tx
              .insertInto('producto')
              .values({ empresa_id: ctx.empresaId, ...atributos, descripcion: null, marca_id: null, creado_por: ctx.usuarioId })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;
        } else if (!productoDeGrupo.has(p.grupo)) {
          await tx.updateTable('producto').set({ ...cambios, activo: true }).where('id', '=', productoId).execute();
        }
        productoDeGrupo.set(p.grupo, productoId);

        let varianteId = p.varianteId;
        if (varianteId) {
          await tx
            .updateTable('variante')
            .set({ nombre: p.datos.variante, activa: true, ...(p.datos.sku ? { sku: p.datos.sku } : {}), ...(p.datos.costo !== null ? { costo: p.datos.costo } : {}) })
            .where('id', '=', varianteId)
            .execute();
        } else {
          varianteId = (
            await tx
              .insertInto('variante')
              .values({ empresa_id: ctx.empresaId, producto_id: productoId, nombre: p.datos.variante, sku: p.datos.sku, costo: p.datos.costo ?? 0 })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;
        }
        const nuevos = p.datos.codigos.filter((c) => !porCodigo.has(c));
        if (nuevos.length) await tx.insertInto('codigo_barras').values(nuevos.map((codigo) => ({ empresa_id: ctx.empresaId, codigo, variante_id: varianteId! }))).execute();
        await sql`
          INSERT INTO precio (empresa_id, lista_id, variante_id, sucursal_id, precio)
          VALUES (${ctx.empresaId}::uuid, ${lista}::uuid, ${varianteId}::uuid, NULL, ${p.datos.precio})
          ON CONFLICT (empresa_id, lista_id, variante_id, coalesce(sucursal_id, '00000000-0000-0000-0000-000000000000'))
          DO UPDATE SET precio = EXCLUDED.precio, actualizado_en = now() WHERE precio.precio IS DISTINCT FROM EXCLUDED.precio`.execute(tx);
        p.varianteId = varianteId;
      }

      // Stock: fija el saldo de cada fila con la columna Stock, con su movimiento.
      const conStock = validos.filter((p) => p.datos.stock !== null).sort((a, b) => (a.varianteId! < b.varianteId! ? -1 : 1));
      if (conStock.length && deposito) {
        const ids = conStock.map((p) => p.varianteId!);
        await tx
          .insertInto('stock')
          .values(ids.map((variante_id) => ({ empresa_id: ctx.empresaId, variante_id, deposito_id: deposito!.id })))
          .onConflict((oc) => oc.columns(['empresa_id', 'variante_id', 'deposito_id']).doNothing())
          .execute();
        const saldos = new Map(
          (await tx.selectFrom('stock').select(['variante_id', 'cantidad']).where('deposito_id', '=', deposito.id).where('variante_id', 'in', ids).orderBy('variante_id').forUpdate().execute()).map((s) => [s.variante_id, new Decimal(s.cantidad)]),
        );
        for (const p of conStock) {
          const antes = saldos.get(p.varianteId!)!;
          const nuevo = new Decimal(p.datos.stock!);
          const r = resultado.find((x) => x.fila === p.fila)!;
          r.stock = { antes: antes.toFixed(4), despues: nuevo.toFixed(4) };
          if (nuevo.eq(antes)) continue;
          await tx.updateTable('stock').set({ cantidad: nuevo.toFixed(4), actualizado_en: new Date() }).where('variante_id', '=', p.varianteId!).where('deposito_id', '=', deposito.id).execute();
          await tx
            .insertInto('movimiento_stock')
            .values({ empresa_id: ctx.empresaId, variante_id: p.varianteId!, deposito_id: deposito.id, tipo: d.tipoStock, cantidad: nuevo.minus(antes).toFixed(4), saldo: nuevo.toFixed(4), costo_unitario: null, origen_id: null, motivo: 'Importación desde planilla', creado_por: ctx.usuarioId })
            .execute();
        }
      }

      await auditar(tx, { ...ctx, ...o }, { accion: 'importacion', entidad: 'producto', despues: { resumen, depositoId: deposito?.id ?? null } });
      return { simulado: false, globales, resumen, filas: resultado };
    });
  }

  /** Clientes: empareja por RUC o cédula, luego por nombre exacto. */
  @Requiere('cliente', 'crear')
  @Post('clientes')
  @HttpCode(200)
  clientes(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(entradaClientes, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const planes = d.filas.map((f) => {
        const r = validarFilaCliente(f.valores);
        return 'ok' in r ? { fila: f.fila, datos: r.ok as FilaCliente, id: null as string | null, errores: [] as string[] } : { fila: f.fila, datos: null as unknown as FilaCliente, id: null, errores: r.errores };
      });
      const validos = planes.filter((p) => !p.errores.length);
      const vistos = new Map<string, number>();
      for (const p of validos) {
        const k = p.datos.documento ?? `n:${clave(p.datos.nombre)}`;
        if (vistos.has(k)) p.errores.push(`Cliente repetido (fila ${vistos.get(k)})`);
        else vistos.set(k, p.fila);
      }
      const documentos = validos.map((p) => p.datos.documento).filter((x): x is string => Boolean(x));
      const nombres = validos.filter((p) => !p.datos.documento).map((p) => clave(p.datos.nombre));
      const porDoc = new Map((documentos.length ? await tx.selectFrom('cliente').select(['id', 'documento']).where('documento', 'in', documentos).execute() : []).map((c) => [c.documento!, c.id]));
      const porNombre = new Map(
        (nombres.length ? await tx.selectFrom('cliente').select(['id', sql<string>`lower(nombre)`.as('n')]).where(sql`lower(nombre)`, 'in', nombres).where('documento', 'is', null).execute() : []).map((c) => [c.n, c.id]),
      );
      for (const p of validos) p.id = p.datos.documento ? (porDoc.get(p.datos.documento) ?? null) : (porNombre.get(clave(p.datos.nombre)) ?? null);

      const globales: string[] = [];
      if (validos.some((p) => p.id && !p.errores.length) && !tiene(ctx, 'cliente.editar')) globales.push('La planilla actualiza clientes existentes y usted no tiene permiso para editarlos');
      const filas: ResultadoFila[] = planes.map((p) => ({
        fila: p.fila,
        accion: p.errores.length ? 'error' : p.id ? 'actualizar' : 'crear',
        descripcion: p.datos?.nombre ?? String(d.filas.find((f) => f.fila === p.fila)?.valores.nombre ?? '').trim(),
        errores: p.errores,
      }));
      const resumen = { crear: filas.filter((f) => f.accion === 'crear').length, actualizar: filas.filter((f) => f.accion === 'actualizar').length, errores: filas.filter((f) => f.accion === 'error').length, stock: 0 };
      if (d.simular) return { simulado: true, globales, resumen, filas };
      if (globales.length || resumen.errores) throw new ErrorNegocio(HttpStatus.BAD_REQUEST, 'IMPORTACION_CON_ERRORES', 'Corrija los errores de la planilla: no se importó nada', { globales, resumen, filas });

      for (const p of validos) {
        const v = { nombre: p.datos.nombre, documento: p.datos.documento, telefono: p.datos.telefono, email: p.datos.email, direccion: p.datos.direccion };
        // Al actualizar, una celda vacía no borra el dato que ya existe.
        const cambios = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null));
        if (p.id) await tx.updateTable('cliente').set({ ...cambios, activo: true }).where('id', '=', p.id).execute();
        else await tx.insertInto('cliente').values({ empresa_id: ctx.empresaId, ...v, creado_por: ctx.usuarioId }).execute();
      }
      await auditar(tx, { ...ctx, ...o }, { accion: 'importacion', entidad: 'cliente', despues: { resumen } });
      return { simulado: false, globales, resumen, filas };
    });
  }
}
