import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { cancelarEntrada, recepcionEntrada, transferenciaEntrada } from '@kontiva/shared';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { enSucursal } from '../comun/alcance';
import { auditar } from '../comun/auditoria';
import { Contexto, OrigenPeticion, type Ctx, type Origen } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { conflicto, invalido, noEncontrado, prohibido } from '../comun/errores';
import { moverStock, siguienteNumero } from '../comun/stock';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';

async function depositoDe(tx: Tx, id: string) {
  const d = await tx
    .selectFrom('deposito as d')
    .innerJoin('sucursal as s', 's.id', 'd.sucursal_id')
    .select(['d.id', 'd.nombre', 'd.sucursal_id', 'd.activo', 's.nombre as sucursal'])
    .where('d.id', '=', id)
    .executeTakeFirst();
  if (!d) throw invalido('Depósito inexistente');
  return d;
}

async function leerTransferencia(tx: Tx, id: string) {
  return (await leerTransferencias(tx, [id]))[0] ?? null;
}

/** Varias transferencias en un número fijo de consultas (el listado no consulta una por una). */
async function leerTransferencias(tx: Tx, ids: string[]) {
  if (!ids.length) return [];
  const ts = await tx.selectFrom('transferencia').selectAll().where('id', 'in', ids).execute();
  if (!ts.length) return [];
  const depositos = await tx
    .selectFrom('deposito as d')
    .innerJoin('sucursal as s', 's.id', 'd.sucursal_id')
    .select(['d.id', 'd.nombre', 'd.sucursal_id', 's.nombre as sucursal'])
    .where('d.id', 'in', [...new Set(ts.flatMap((t) => [t.origen_id, t.destino_id]))])
    .execute();
  const items = await tx
    .selectFrom('transferencia_item as i')
    .innerJoin('variante as v', 'v.id', 'i.variante_id')
    .innerJoin('producto as p', 'p.id', 'v.producto_id')
    .select(['i.transferencia_id', 'i.linea', 'i.variante_id', 'i.cantidad', 'i.cantidad_recibida', 'p.nombre', 'v.nombre as variante', 'p.unidad'])
    .where('i.transferencia_id', 'in', ts.map((t) => t.id))
    .orderBy('i.linea')
    .execute();
  const usuarioIds = [...new Set(ts.flatMap((t) => [t.creado_por, t.recibida_por, t.cancelada_por]).filter((x): x is string => !!x))];
  const usuarios = usuarioIds.length ? await tx.selectFrom('usuario').select(['id', 'nombre']).where('id', 'in', usuarioIds).execute() : [];
  const nombre = (id: string | null) => (id ? (usuarios.find((u) => u.id === id)?.nombre ?? null) : null);
  const deposito = (id: string) => {
    const d = depositos.find((x) => x.id === id)!;
    return { id: d.id, nombre: d.nombre, sucursal: d.sucursal, sucursalId: d.sucursal_id };
  };
  const porId = new Map(ts.map((t) => [t.id, t]));
  return ids.flatMap((id) => {
    const t = porId.get(id);
    if (!t) return [];
    return [
      {
        id: t.id,
        numero: Number(t.numero),
        estado: t.estado,
        nota: t.nota,
        origen: deposito(t.origen_id),
        destino: deposito(t.destino_id),
        creadoEn: t.creado_en,
        creadoPor: nombre(t.creado_por),
        recibidaEn: t.recibida_en,
        recibidaPor: nombre(t.recibida_por),
        canceladaEn: t.cancelada_en,
        canceladaPor: nombre(t.cancelada_por),
        motivoCancelacion: t.motivo_cancelacion,
        items: items
          .filter((i) => i.transferencia_id === id)
          .map((i) => ({
            linea: i.linea,
            varianteId: i.variante_id,
            descripcion: i.variante ? `${i.nombre} · ${i.variante}` : i.nombre,
            unidad: i.unidad,
            cantidad: i.cantidad,
            cantidadRecibida: i.cantidad_recibida,
            faltante: i.cantidad_recibida === null ? null : new Decimal(i.cantidad).minus(i.cantidad_recibida).toFixed(4),
          })),
      },
    ];
  });
}
type TransferenciaDto = NonNullable<Awaited<ReturnType<typeof leerTransferencia>>>;

/** Ve la transferencia quien opera en la sucursal de origen o de destino. */
const visible = (ctx: Ctx, t: TransferenciaDto) => enSucursal(ctx, t.origen.sucursalId) || enSucursal(ctx, t.destino.sucursalId);

@Controller('transferencias')
export class TransferenciasController {
  constructor(private readonly db: Db) {}

  @Requiere('transferencia', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ estado: z.enum(['en_transito', 'recibida', 'cancelada']).optional() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let q = tx.selectFrom('transferencia').select('id').orderBy('numero', 'desc').limit(200);
      if (f.estado) q = q.where('estado', '=', f.estado);
      const ids = await q.execute();
      const todas = await leerTransferencias(tx, ids.map((r) => r.id));
      return todas.filter((t): t is TransferenciaDto => t !== null && visible(ctx, t));
    });
  }

  @Requiere('transferencia', 'ver')
  @Get(':id')
  ver(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const t = await leerTransferencia(tx, id);
      if (!t || !visible(ctx, t)) throw noEncontrado('Transferencia');
      return t;
    });
  }

  /** Sale del origen en el acto. Directa: entra al destino en la misma transacción. */
  @Requiere('transferencia', 'crear')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(transferenciaEntrada, body);
    if (d.origenId === d.destinoId) throw invalido('El origen y el destino deben ser distintos');
    if (new Set(d.items.map((i) => i.varianteId)).size !== d.items.length) throw invalido('Hay productos repetidos');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const [origen, destino] = await Promise.all([depositoDe(tx, d.origenId), depositoDe(tx, d.destinoId)]);
      if (!enSucursal(ctx, origen.sucursal_id)) throw noEncontrado('Depósito');
      if (!origen.activo || !destino.activo) throw invalido('Algún depósito está inactivo');
      const variantes = await tx
        .selectFrom('variante as v')
        .innerJoin('producto as p', 'p.id', 'v.producto_id')
        .select(['v.id', 'v.costo', 'p.controla_stock', 'p.unidad', 'p.nombre'])
        .where('v.id', 'in', d.items.map((i) => i.varianteId))
        .execute();
      if (variantes.length !== d.items.length) throw invalido('Algún producto no existe');
      for (const v of variantes) {
        if (!v.controla_stock) throw invalido(`${v.nombre} no controla stock`);
        const it = d.items.find((i) => i.varianteId === v.id)!;
        if (v.unidad === 'unidad' && !Number.isInteger(it.cantidad)) throw invalido(`${v.nombre} se mueve por unidad entera`);
      }
      const costo = new Map(variantes.map((v) => [v.id, v.costo]));

      const numero = await siguienteNumero(tx, 'transferencia');
      const t = await tx
        .insertInto('transferencia')
        .values({ empresa_id: ctx.empresaId, numero, origen_id: origen.id, destino_id: destino.id, estado: d.directa ? 'recibida' : 'en_transito', nota: d.nota ?? null, creado_por: ctx.usuarioId, recibida_por: d.directa ? ctx.usuarioId : null, recibida_en: d.directa ? new Date() : null, cancelada_por: null, cancelada_en: null, motivo_cancelacion: null })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('transferencia_item')
        .values(d.items.map((i, n) => ({ empresa_id: ctx.empresaId, transferencia_id: t.id, linea: n + 1, variante_id: i.varianteId, cantidad: new Decimal(i.cantidad).toFixed(4), cantidad_recibida: d.directa ? new Decimal(i.cantidad).toFixed(4) : null })))
        .execute();
      const motivo = `Transferencia N.º ${numero}`;
      await moverStock(tx, ctx, origen.id, d.items.map((i) => ({ varianteId: i.varianteId, cantidad: new Decimal(i.cantidad).neg(), tipo: 'transferencia_salida', origenId: t.id, motivo, costo: costo.get(i.varianteId) })));
      if (d.directa) {
        await moverStock(tx, ctx, destino.id, d.items.map((i) => ({ varianteId: i.varianteId, cantidad: new Decimal(i.cantidad), tipo: 'transferencia_entrada', origenId: t.id, motivo, costo: costo.get(i.varianteId), deOrigen: { origenIds: [t.id], tipos: ['transferencia_salida'] } })), false);
      }
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'transferencia', entidadId: t.id, despues: { numero, origen: origen.nombre, destino: destino.nombre, directa: d.directa, items: d.items.length } });
      return (await leerTransferencia(tx, t.id))!;
    });
  }

  /** El destino confirma lo que llegó. Lo que falte queda registrado como faltante. */
  @Requiere('transferencia', 'aprobar')
  @Post(':id/recibir')
  @HttpCode(200)
  recibir(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(recepcionEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const actual = await tx.selectFrom('transferencia').select(['id']).where('id', '=', id).forUpdate().executeTakeFirst();
      const t = actual ? await leerTransferencia(tx, id) : null;
      if (!t || !visible(ctx, t)) throw noEncontrado('Transferencia');
      if (!enSucursal(ctx, t.destino.sucursalId)) throw prohibido('Solo el destino confirma la recepción');
      if (t.estado !== 'en_transito') throw conflicto('NO_EN_TRANSITO', 'La transferencia no está en tránsito');
      const recibido = new Map(d.items.map((i) => [i.linea, new Decimal(i.cantidadRecibida)]));
      for (const [linea, cant] of recibido) {
        const it = t.items.find((x) => x.linea === linea);
        if (!it) throw invalido(`Línea ${linea} inexistente`);
        if (cant.gt(it.cantidad)) throw invalido(`No se puede recibir más de lo enviado (${it.descripcion})`);
      }
      const movimientos = [];
      for (const it of t.items) {
        const cant = recibido.get(it.linea) ?? new Decimal(it.cantidad);
        await tx.updateTable('transferencia_item').set({ cantidad_recibida: cant.toFixed(4) }).where('transferencia_id', '=', id).where('linea', '=', it.linea).execute();
        if (cant.gt(0)) movimientos.push({ varianteId: it.varianteId, cantidad: cant, tipo: 'transferencia_entrada' as const, origenId: id, motivo: `Transferencia N.º ${t.numero}`, deOrigen: { origenIds: [id], tipos: ['transferencia_salida' as const] } });
      }
      await moverStock(tx, ctx, t.destino.id, movimientos, false);
      await tx.updateTable('transferencia').set({ estado: 'recibida', recibida_por: ctx.usuarioId, recibida_en: new Date() }).where('id', '=', id).execute();
      const despues = (await leerTransferencia(tx, id))!;
      const faltantes = despues.items.filter((i) => Number(i.faltante) > 0).map((i) => ({ descripcion: i.descripcion, faltante: i.faltante }));
      await auditar(tx, { ...ctx, ...o }, { accion: 'recibir', entidad: 'transferencia', entidadId: id, despues: { numero: t.numero, faltantes } });
      return despues;
    });
  }

  /** Cancelar una transferencia en tránsito: la mercadería vuelve al origen. */
  @Requiere('transferencia', 'cancelar')
  @Post(':id/cancelar')
  @HttpCode(200)
  cancelar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(cancelarEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      await tx.selectFrom('transferencia').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
      const t = await leerTransferencia(tx, id);
      if (!t || !visible(ctx, t)) throw noEncontrado('Transferencia');
      if (t.estado !== 'en_transito') throw conflicto('NO_EN_TRANSITO', 'Solo se cancela una transferencia en tránsito');
      await moverStock(tx, ctx, t.origen.id, t.items.map((i) => ({ varianteId: i.varianteId, cantidad: new Decimal(i.cantidad), tipo: 'transferencia_entrada' as const, origenId: id, motivo: `Cancelación de transferencia N.º ${t.numero}`, deOrigen: { origenIds: [id], tipos: ['transferencia_salida' as const] } })), false);
      await tx.updateTable('transferencia').set({ estado: 'cancelada', cancelada_por: ctx.usuarioId, cancelada_en: new Date(), motivo_cancelacion: d.motivo }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'cancelar', entidad: 'transferencia', entidadId: id, despues: { numero: t.numero, motivo: d.motivo } });
      return (await leerTransferencia(tx, id))!;
    });
  }
}
