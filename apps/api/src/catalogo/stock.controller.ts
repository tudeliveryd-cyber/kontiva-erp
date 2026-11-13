import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ajusteStockEntrada } from '@kontiva/shared';
import Decimal from 'decimal.js';
import { sql } from 'kysely';
import { z } from 'zod';
import { booleanoQuery } from '@kontiva/shared';
import { enSucursal, exigirSucursal } from '../comun/alcance';
import { auditar } from '../comun/auditoria';
import { Contexto, OrigenPeticion, tiene, type Ctx, type Origen } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { invalido, noEncontrado } from '../comun/errores';
import { moverLotes } from '../comun/lotes';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';

async function deposito(tx: Tx, ctx: Ctx, id: string) {
  const d = await tx.selectFrom('deposito').select(['id', 'sucursal_id', 'nombre']).where('id', '=', id).executeTakeFirst();
  if (!d) throw noEncontrado('Depósito');
  exigirSucursal(ctx, d.sucursal_id, 'Depósito');
  return d;
}

const hoyPy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());

@Controller()
export class StockController {
  constructor(private readonly db: Db) {}

  @Requiere('stock', 'ver')
  @Get('depositos')
  depositos(@Contexto() ctx: Ctx) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const filas = await tx
        .selectFrom('deposito as d')
        .innerJoin('sucursal as s', 's.id', 'd.sucursal_id')
        .select(['d.id', 'd.nombre', 'd.sucursal_id', 's.nombre as sucursal', 's.codigo'])
        .where('d.activo', '=', true)
        .orderBy('s.codigo')
        .orderBy('d.nombre')
        .execute();
      return filas.filter((d) => enSucursal(ctx, d.sucursal_id)).map((d) => ({ id: d.id, nombre: d.nombre, sucursal: { id: d.sucursal_id, nombre: d.sucursal, codigo: d.codigo } }));
    });
  }

  /** Stock de un depósito: todas las variantes que controlan stock, con su saldo (0 si nunca se movió). */
  @Requiere('stock', 'ver')
  @Get('stock')
  listar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(
      z.object({
        depositoId: z.string().uuid(),
        q: z.string().trim().max(100).optional(),
        soloBajo: booleanoQuery,
        pagina: z.coerce.number().int().min(1).default(1),
        limite: z.coerce.number().int().min(1).max(500).default(100),
      }),
      query,
    );
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      await deposito(tx, ctx, f.depositoId);
      let q = tx
        .selectFrom('variante as v')
        .innerJoin('producto as p', 'p.id', 'v.producto_id')
        .leftJoin('stock as s', (j) => j.onRef('s.variante_id', '=', 'v.id').on('s.deposito_id', '=', f.depositoId))
        .select(['v.id', 'p.nombre as producto', 'v.nombre as variante', 'v.sku', 'p.unidad', 's.cantidad', 'v.costo', 'p.controla_lote'])
        .where('p.controla_stock', '=', true)
        .where('p.activo', '=', true)
        .where('v.activa', '=', true);
      if (f.q) q = q.where((eb) => eb.or([eb('p.nombre', 'ilike', `%${f.q}%`), eb('v.sku', 'ilike', `%${f.q}%`)]));
      if (f.soloBajo) q = q.where((eb) => eb.or([eb('s.cantidad', 'is', null), eb('s.cantidad', '<=', '0')]));
      const filas = await q.orderBy('p.nombre').orderBy('v.nombre').limit(f.limite).offset((f.pagina - 1) * f.limite).execute();
      const verCosto = tiene(ctx, 'costo_producto.ver');
      return filas.map((r) => ({
        varianteId: r.id,
        descripcion: r.variante ? `${r.producto} · ${r.variante}` : r.producto,
        sku: r.sku,
        unidad: r.unidad,
        cantidad: r.cantidad ?? '0.0000',
        controlaLote: r.controla_lote,
        ...(verCosto ? { costo: r.costo } : {}),
      }));
    });
  }

  /** Fija el saldo contado de cada variante. Cada diferencia queda como movimiento con motivo. */
  @Requiere('stock', 'editar')
  @Post('stock/ajustes')
  ajustar(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(ajusteStockEntrada, body);
    const clave = (i: (typeof d.items)[number]) => `${i.varianteId}|${i.loteId ?? i.lote?.codigo.trim().toUpperCase() ?? ''}`;
    if (new Set(d.items.map(clave)).size !== d.items.length) throw invalido('Hay productos repetidos en el ajuste');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      await deposito(tx, ctx, d.depositoId);
      const ids = [...new Set(d.items.map((i) => i.varianteId))].sort();
      const variantes = await tx
        .selectFrom('variante as v')
        .innerJoin('producto as p', 'p.id', 'v.producto_id')
        .select(['v.id', 'v.costo', 'p.controla_stock', 'p.controla_lote'])
        .where('v.id', 'in', ids)
        .execute();
      if (variantes.length !== ids.length) throw invalido('Algún producto no existe');
      if (variantes.some((v) => !v.controla_stock)) throw invalido('Algún producto no controla stock');
      const costo = new Map(variantes.map((v) => [v.id, v.costo]));
      const conLote = new Set(variantes.filter((v) => v.controla_lote).map((v) => v.id));
      if (d.items.some((i) => (i.loteId || i.lote) && !conLote.has(i.varianteId))) throw invalido('Algún producto no controla lotes');

      await tx
        .insertInto('stock')
        .values(ids.map((variante_id) => ({ empresa_id: ctx.empresaId, variante_id, deposito_id: d.depositoId })))
        .onConflict((oc) => oc.columns(['empresa_id', 'variante_id', 'deposito_id']).doNothing())
        .execute();
      // Bloqueo en orden fijo: dos ajustes o ventas simultáneos no se cruzan.
      const actuales = await tx
        .selectFrom('stock')
        .select(['variante_id', 'cantidad'])
        .where('deposito_id', '=', d.depositoId)
        .where('variante_id', 'in', ids)
        .orderBy('variante_id')
        .forUpdate()
        .execute();
      const saldo = new Map(actuales.map((s) => [s.variante_id, new Decimal(s.cantidad)]));

      const cambios: { varianteId: string; antes: string; despues: string }[] = [];
      for (const it of d.items) {
        const antes = saldo.get(it.varianteId)!;
        let nuevo = new Decimal(it.cantidadNueva).toDecimalPlaces(4);
        let lote: { loteId?: string; lote?: { codigo: string; vencimiento: string | null } } = {};
        if (it.loteId || it.lote) {
          // Conteo de un lote: la diferencia del lote cambia el total del producto.
          let loteId = it.loteId;
          if (it.loteId) {
            const l = await tx.selectFrom('lote').select('variante_id').where('id', '=', it.loteId).executeTakeFirst();
            if (!l || l.variante_id !== it.varianteId) throw invalido('El lote no corresponde al producto');
          } else {
            const l = await tx.selectFrom('lote').select('id').where('variante_id', '=', it.varianteId).where('codigo', '=', it.lote!.codigo.trim().toUpperCase()).executeTakeFirst();
            loteId = l?.id;
          }
          const enLote = loteId ? await tx.selectFrom('stock_lote').select('cantidad').where('lote_id', '=', loteId).where('deposito_id', '=', d.depositoId).executeTakeFirst() : undefined;
          const difLote = nuevo.minus(enLote?.cantidad ?? 0);
          nuevo = antes.plus(difLote);
          lote = loteId ? { loteId } : { lote: { codigo: it.lote!.codigo, vencimiento: it.lote!.vencimiento ?? null } };
        }
        const dif = nuevo.minus(antes);
        if (dif.isZero()) continue;
        saldo.set(it.varianteId, nuevo);
        // Sin lote indicado: lo que entra va a "sin lote" y lo que sale, por vencimiento (incluso vencidos).
        await moverLotes(tx, ctx, d.depositoId, [{ varianteId: it.varianteId, cantidad: dif, tipo: d.tipo, origenId: null, incluirVencidos: true, ...lote }], false);
        await tx.updateTable('stock').set({ cantidad: nuevo.toFixed(4), actualizado_en: new Date() }).where('variante_id', '=', it.varianteId).where('deposito_id', '=', d.depositoId).execute();
        await tx
          .insertInto('movimiento_stock')
          .values({
            empresa_id: ctx.empresaId,
            variante_id: it.varianteId,
            deposito_id: d.depositoId,
            tipo: d.tipo,
            cantidad: dif.toFixed(4),
            saldo: nuevo.toFixed(4),
            costo_unitario: costo.get(it.varianteId) ?? null,
            origen_id: null,
            motivo: d.motivo,
            creado_por: ctx.usuarioId,
          })
          .execute();
        cambios.push({ varianteId: it.varianteId, antes: antes.toFixed(4), despues: nuevo.toFixed(4), ...(it.loteId || it.lote ? { lote: it.loteId ?? it.lote!.codigo } : {}) });
      }
      if (cambios.length) {
        await auditar(tx, { ...ctx, ...o }, { accion: d.tipo === 'inicial' ? 'stock_inicial' : 'ajuste_stock', entidad: 'deposito', entidadId: d.depositoId, despues: { motivo: d.motivo, cambios } });
      }
      return { ajustados: cambios.length, cambios };
    });
  }

  /** Lotes de una variante con su saldo en cada depósito visible. */
  @Requiere('stock', 'ver')
  @Get('stock/lotes')
  lotes(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ varianteId: z.string().uuid(), depositoId: z.string().uuid().optional(), conSaldo: booleanoQuery }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      if (f.depositoId) await deposito(tx, ctx, f.depositoId);
      let q = tx
        .selectFrom('lote as l')
        .innerJoin('stock_lote as s', 's.lote_id', 'l.id')
        .innerJoin('deposito as d', 'd.id', 's.deposito_id')
        .select(['l.id', 'l.codigo', 'l.vencimiento', 's.deposito_id', 'd.nombre as deposito', 'd.sucursal_id', 's.cantidad'])
        .where('l.variante_id', '=', f.varianteId)
        .orderBy(sql`l.vencimiento NULLS LAST`)
        .orderBy('l.creado_en');
      if (f.depositoId) q = q.where('s.deposito_id', '=', f.depositoId);
      if (f.conSaldo) q = q.where('s.cantidad', '<>', '0');
      const hoy = hoyPy();
      return (await q.execute())
        .filter((x) => enSucursal(ctx, x.sucursal_id))
        .map((x) => ({ loteId: x.id, codigo: x.codigo, vencimiento: x.vencimiento, vencido: !!x.vencimiento && x.vencimiento < hoy, depositoId: x.deposito_id, deposito: x.deposito, cantidad: x.cantidad }));
    });
  }

  /** Lotes con stock vencidos o que vencen dentro de los próximos días, del que vence antes al que vence después. */
  @Requiere('stock', 'ver')
  @Get('stock/vencimientos')
  vencimientos(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ dias: z.coerce.number().int().min(0).max(730).default(60), depositoId: z.string().uuid().optional() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      if (f.depositoId) await deposito(tx, ctx, f.depositoId);
      const hoy = hoyPy();
      const limite = new Date(Date.parse(`${hoy}T12:00:00Z`) + f.dias * 86400000).toISOString().slice(0, 10);
      let q = tx
        .selectFrom('stock_lote as s')
        .innerJoin('lote as l', 'l.id', 's.lote_id')
        .innerJoin('variante as v', 'v.id', 'l.variante_id')
        .innerJoin('producto as p', 'p.id', 'v.producto_id')
        .innerJoin('deposito as d', 'd.id', 's.deposito_id')
        .select(['l.id', 'l.codigo', 'l.vencimiento', 'v.id as variante_id', 'p.nombre as producto', 'v.nombre as variante', 'p.unidad', 'v.costo', 's.deposito_id', 'd.nombre as deposito', 'd.sucursal_id', 's.cantidad'])
        .where('s.cantidad', '>', '0')
        .where('l.vencimiento', 'is not', null)
        .where('l.vencimiento', '<=', limite)
        .orderBy('l.vencimiento')
        .orderBy('p.nombre')
        .limit(1000);
      if (f.depositoId) q = q.where('s.deposito_id', '=', f.depositoId);
      const verCosto = tiene(ctx, 'costo_producto.ver');
      return (await q.execute())
        .filter((x) => enSucursal(ctx, x.sucursal_id))
        .map((x) => {
          const dias = Math.round((Date.parse(`${x.vencimiento}T12:00:00Z`) - Date.parse(`${hoy}T12:00:00Z`)) / 86400000);
          return {
            loteId: x.id,
            codigo: x.codigo,
            vencimiento: x.vencimiento,
            dias,
            vencido: dias < 0,
            varianteId: x.variante_id,
            descripcion: x.variante ? `${x.producto} · ${x.variante}` : x.producto,
            unidad: x.unidad,
            depositoId: x.deposito_id,
            deposito: x.deposito,
            cantidad: x.cantidad,
            ...(verCosto ? { valor: new Decimal(x.cantidad).mul(x.costo).toDecimalPlaces(2).toFixed(2) } : {}),
          };
        });
    });
  }

  @Requiere('stock', 'ver')
  @Get('stock/movimientos')
  movimientos(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ varianteId: z.string().uuid(), depositoId: z.string().uuid() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      await deposito(tx, ctx, f.depositoId);
      const filas = await tx
        .selectFrom('movimiento_stock as m')
        .leftJoin('usuario as u', 'u.id', 'm.creado_por')
        .select(['m.id', 'm.tipo', 'm.cantidad', 'm.saldo', 'm.motivo', 'm.origen_id', 'm.creado_en', 'u.nombre as usuario'])
        .where('m.variante_id', '=', f.varianteId)
        .where('m.deposito_id', '=', f.depositoId)
        .orderBy('m.id', 'desc')
        .limit(200)
        .execute();
      return filas.map((m) => ({ id: Number(m.id), tipo: m.tipo, cantidad: m.cantidad, saldo: m.saldo, motivo: m.motivo, origenId: m.origen_id, fecha: m.creado_en, usuario: m.usuario }));
    });
  }
}
