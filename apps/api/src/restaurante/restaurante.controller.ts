import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { cuentaAbrirEntrada, cuentaItemsEntrada, mesaEntrada, salonEntrada } from '@kontiva/shared';
import Decimal from 'decimal.js';
import { sql } from 'kysely';
import { z } from 'zod';
import { enSucursal, exigirSucursal, preciosVigentes } from '../comun/alcance';
import { auditar } from '../comun/auditoria';
import { Contexto, OrigenPeticion, tiene, type Ctx, type Origen } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { conflicto, invalido, noEncontrado, prohibido } from '../comun/errores';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';

const motivo = z.object({ motivo: z.string().trim().min(3, 'Indique el motivo').max(300) });

async function obtenerSalon(tx: Tx, ctx: Ctx, id: string) {
  const s = await tx.selectFrom('salon').selectAll().where('id', '=', id).executeTakeFirst();
  if (!s) throw noEncontrado('Salón');
  exigirSucursal(ctx, s.sucursal_id, 'Salón');
  return s;
}

async function obtenerCuenta(tx: Tx, ctx: Ctx, id: string, bloquear = false) {
  let q = tx.selectFrom('cuenta_salon').selectAll().where('id', '=', id);
  if (bloquear) q = q.forUpdate();
  const c = await q.executeTakeFirst();
  if (!c) throw noEncontrado('Cuenta');
  exigirSucursal(ctx, c.sucursal_id, 'Cuenta');
  return c;
}

const exigirAbierta = (c: { estado: string }) => {
  if (c.estado !== 'abierta') throw conflicto('CUENTA_CERRADA', 'La cuenta ya está cerrada');
};

/** Detalle de una cuenta: ítems con su estado, comanda y si ya se cobraron; totales. */
export async function leerCuenta(tx: Tx, id: string) {
  const c = await tx
    .selectFrom('cuenta_salon as c')
    .leftJoin('mesa as m', 'm.id', 'c.mesa_id')
    .innerJoin('usuario as u', 'u.id', 'c.mozo_id')
    .selectAll('c')
    .select(['m.nombre as mesa', 'u.nombre as mozo'])
    .where('c.id', '=', id)
    .executeTakeFirstOrThrow();
  const items = await tx
    .selectFrom('cuenta_salon_item as i')
    .leftJoin('comanda as k', 'k.id', 'i.comanda_id')
    .innerJoin('variante as v', 'v.id', 'i.variante_id')
    .innerJoin('producto as p', 'p.id', 'v.producto_id')
    .selectAll('i')
    .select(['k.numero as comanda', 'p.tasa_iva', 'p.unidad'])
    .where('i.cuenta_id', '=', id)
    .orderBy('i.creado_en')
    .execute();
  const vivos = items.filter((i) => i.estado !== 'anulado');
  const monto = (xs: typeof items) => xs.reduce((s, i) => s.plus(new Decimal(i.cantidad).mul(i.precio_unitario)), new Decimal(0));
  const total = monto(vivos);
  const pagado = monto(vivos.filter((i) => i.venta_id));
  return {
    id: c.id,
    numero: Number(c.numero),
    tipo: c.tipo,
    mesaId: c.mesa_id,
    mesa: c.mesa,
    nombre: c.nombre,
    sucursalId: c.sucursal_id,
    comensales: c.comensales,
    mozoId: c.mozo_id,
    mozo: c.mozo,
    estado: c.estado,
    propina: c.propina,
    nota: c.nota,
    abiertaEn: c.abierta_en,
    cerradaEn: c.cerrada_en,
    items: items.map((i) => ({
      id: i.id,
      varianteId: i.variante_id,
      descripcion: i.descripcion,
      cantidad: i.cantidad,
      precioUnitario: i.precio_unitario,
      total: new Decimal(i.cantidad).mul(i.precio_unitario).toFixed(2),
      nota: i.nota,
      estacion: i.estacion,
      tasaIva: Number(i.tasa_iva) as 0 | 5 | 10,
      unidad: i.unidad,
      estado: i.estado,
      comanda: i.comanda,
      ventaId: i.venta_id,
      motivoAnulacion: i.motivo_anulacion,
    })),
    totales: { total: total.toFixed(2), pagado: pagado.toFixed(2), pendiente: total.minus(pagado).toFixed(2) },
  };
}

@Controller('restaurante')
export class SalonController {
  constructor(private readonly db: Db) {}

  /** Plano de la sucursal: salones con sus mesas y la cuenta abierta de cada una; cuentas de mostrador. */
  @Requiere('salon', 'ver')
  @Get('plano')
  plano(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ sucursalId: z.string().uuid() }), query);
    exigirSucursal(ctx, f.sucursalId, 'Sucursal');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const salones = await tx.selectFrom('salon').selectAll().where('sucursal_id', '=', f.sucursalId).where('activo', '=', true).orderBy('orden').orderBy('nombre').execute();
      const mesas = salones.length
        ? await tx.selectFrom('mesa').selectAll().where('salon_id', 'in', salones.map((s) => s.id)).where('activa', '=', true).orderBy('pos_y').orderBy('pos_x').execute()
        : [];
      const { rows: cuentas } = await sql<{ id: string; numero: string; tipo: string; mesa_id: string | null; nombre: string | null; comensales: number; abierta_en: Date; mozo: string; total: string; pendiente: string; por_enviar: string; listos: string; en_cocina: string }>`
        SELECT c.id, c.numero, c.tipo, c.mesa_id, c.nombre, c.comensales, c.abierta_en, u.nombre AS mozo,
          coalesce(sum(i.cantidad * i.precio_unitario) FILTER (WHERE i.estado <> 'anulado'), 0) AS total,
          coalesce(sum(i.cantidad * i.precio_unitario) FILTER (WHERE i.estado <> 'anulado' AND i.venta_id IS NULL), 0) AS pendiente,
          count(i.id) FILTER (WHERE i.estado = 'pendiente') AS por_enviar,
          count(i.id) FILTER (WHERE i.estado = 'listo') AS listos,
          count(i.id) FILTER (WHERE i.estado IN ('enviado', 'preparando')) AS en_cocina
        FROM cuenta_salon c JOIN usuario u ON u.id = c.mozo_id LEFT JOIN cuenta_salon_item i ON i.cuenta_id = c.id
        WHERE c.sucursal_id = ${f.sucursalId}::uuid AND c.estado = 'abierta'
        GROUP BY c.empresa_id, c.id, u.nombre ORDER BY c.abierta_en`.execute(tx);
      const resumen = (c: (typeof cuentas)[number]) => ({
        id: c.id,
        numero: Number(c.numero),
        nombre: c.nombre,
        comensales: c.comensales,
        abiertaEn: c.abierta_en,
        mozo: c.mozo,
        total: new Decimal(c.total).toFixed(2),
        pendiente: new Decimal(c.pendiente).toFixed(2),
        porEnviar: Number(c.por_enviar),
        enCocina: Number(c.en_cocina),
        listos: Number(c.listos),
      });
      return {
        salones: salones.map((s) => ({
          id: s.id,
          nombre: s.nombre,
          orden: s.orden,
          mesas: mesas
            .filter((m) => m.salon_id === s.id)
            .map((m) => {
              const c = cuentas.find((x) => x.mesa_id === m.id);
              return { id: m.id, nombre: m.nombre, capacidad: m.capacidad, forma: m.forma, posX: m.pos_x, posY: m.pos_y, cuenta: c ? resumen(c) : null };
            }),
        })),
        mostrador: cuentas.filter((c) => c.tipo === 'mostrador').map(resumen),
      };
    });
  }

  /** Carta: productos activos con el precio de la sucursal, por categoría (sin los de venta bajo receta). */
  @Requiere('salon', 'ver')
  @Get('carta')
  carta(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ sucursalId: z.string().uuid() }), query);
    exigirSucursal(ctx, f.sucursalId, 'Sucursal');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const filas = await tx
        .selectFrom('variante as v')
        .innerJoin('producto as p', 'p.id', 'v.producto_id')
        .leftJoin('categoria as c', 'c.id', 'p.categoria_id')
        .select(['v.id', 'v.nombre', 'p.nombre as producto', 'p.unidad', 'p.estacion', 'c.nombre as categoria'])
        .where('p.activo', '=', true)
        .where('v.activa', '=', true)
        .where('p.condicion_venta', '=', 'libre')
        .orderBy('c.nombre')
        .orderBy('p.nombre')
        .limit(2000)
        .execute();
      const precios = await preciosVigentes(tx, filas.map((r) => r.id), f.sucursalId, null);
      return filas.map((r) => ({
        varianteId: r.id,
        descripcion: r.nombre ? `${r.producto} · ${r.nombre}` : r.producto,
        unidad: r.unidad,
        estacion: r.estacion,
        categoria: r.categoria ?? 'Otros',
        precio: precios.get(r.id) ?? '0.00',
      }));
    });
  }

  @Requiere('salon', 'editar')
  @Post('salones')
  crearSalon(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(salonEntrada, body);
    exigirSucursal(ctx, d.sucursalId, 'Sucursal');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const r = await tx.insertInto('salon').values({ empresa_id: ctx.empresaId, sucursal_id: d.sucursalId, nombre: d.nombre, orden: d.orden }).returning('id').executeTakeFirstOrThrow();
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'salon', entidadId: r.id, despues: d });
      return { id: r.id };
    });
  }

  @Requiere('salon', 'editar')
  @Patch('salones/:id')
  editarSalon(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ nombre: z.string().trim().min(1).max(60).optional(), orden: z.coerce.number().int().min(0).max(99).optional(), activo: z.boolean().optional() }), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const s = await obtenerSalon(tx, ctx, id);
      if (d.activo === false) {
        const ocupada = await tx.selectFrom('cuenta_salon as c').innerJoin('mesa as m', 'm.id', 'c.mesa_id').select('c.id').where('m.salon_id', '=', id).where('c.estado', '=', 'abierta').executeTakeFirst();
        if (ocupada) throw conflicto('SALON_OCUPADO', 'Hay mesas con cuentas abiertas en este salón');
      }
      await tx.updateTable('salon').set({ ...(d.nombre && { nombre: d.nombre }), ...(d.orden !== undefined && { orden: d.orden }), ...(d.activo !== undefined && { activo: d.activo }) }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'editar', entidad: 'salon', entidadId: id, antes: { nombre: s.nombre, orden: s.orden, activo: s.activo }, despues: d });
      return { ok: true };
    });
  }

  @Requiere('salon', 'editar')
  @Post('mesas')
  crearMesa(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(mesaEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      await obtenerSalon(tx, ctx, d.salonId);
      const dup = await tx.selectFrom('mesa').select('id').where('salon_id', '=', d.salonId).where('activa', '=', true).where(sql`lower(nombre)`, '=', d.nombre.toLowerCase()).executeTakeFirst();
      if (dup) throw conflicto('MESA_DUPLICADA', `Ya hay una mesa ${d.nombre} en este salón`);
      const r = await tx
        .insertInto('mesa')
        .values({ empresa_id: ctx.empresaId, salon_id: d.salonId, nombre: d.nombre, capacidad: d.capacidad, forma: d.forma, pos_x: d.posX, pos_y: d.posY })
        .returning('id')
        .executeTakeFirstOrThrow();
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'mesa', entidadId: r.id, despues: d });
      return { id: r.id };
    });
  }

  @Requiere('salon', 'editar')
  @Patch('mesas/:id')
  editarMesa(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(mesaEntrada.omit({ salonId: true }).partial().extend({ activa: z.boolean().optional() }), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const m = await tx.selectFrom('mesa').selectAll().where('id', '=', id).executeTakeFirst();
      if (!m) throw noEncontrado('Mesa');
      await obtenerSalon(tx, ctx, m.salon_id);
      if (d.activa === false) {
        const abierta = await tx.selectFrom('cuenta_salon').select('id').where('mesa_id', '=', id).where('estado', '=', 'abierta').executeTakeFirst();
        if (abierta) throw conflicto('MESA_OCUPADA', 'La mesa tiene una cuenta abierta');
      }
      if (d.nombre && d.nombre.toLowerCase() !== m.nombre.toLowerCase()) {
        const dup = await tx.selectFrom('mesa').select('id').where('salon_id', '=', m.salon_id).where('activa', '=', true).where('id', '<>', id).where(sql`lower(nombre)`, '=', d.nombre.toLowerCase()).executeTakeFirst();
        if (dup) throw conflicto('MESA_DUPLICADA', `Ya hay una mesa ${d.nombre} en este salón`);
      }
      await tx
        .updateTable('mesa')
        .set({
          ...(d.nombre && { nombre: d.nombre }),
          ...(d.capacidad !== undefined && { capacidad: d.capacidad }),
          ...(d.forma && { forma: d.forma }),
          ...(d.posX !== undefined && { pos_x: d.posX }),
          ...(d.posY !== undefined && { pos_y: d.posY }),
          ...(d.activa !== undefined && { activa: d.activa }),
        })
        .where('id', '=', id)
        .execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'editar', entidad: 'mesa', entidadId: id, antes: { nombre: m.nombre, posX: m.pos_x, posY: m.pos_y, activa: m.activa }, despues: d });
      return { ok: true };
    });
  }
}

@Controller('restaurante/cuentas')
export class CuentasController {
  constructor(private readonly db: Db) {}

  /** Cuentas abiertas de una sucursal (el PDV las lista para cobrar). */
  @Requiere('salon', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ sucursalId: z.string().uuid() }), query);
    exigirSucursal(ctx, f.sucursalId, 'Sucursal');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const ids = (await tx.selectFrom('cuenta_salon').select('id').where('sucursal_id', '=', f.sucursalId).where('estado', '=', 'abierta').orderBy('abierta_en').execute()).map((c) => c.id);
      const r = [];
      for (const id of ids) r.push(await leerCuenta(tx, id));
      return r;
    });
  }

  @Requiere('salon', 'ver')
  @Get(':id')
  detalle(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      await obtenerCuenta(tx, ctx, id);
      return leerCuenta(tx, id);
    });
  }

  /** Abre la cuenta de una mesa libre o una de mostrador (para llevar). */
  @Requiere('salon', 'crear')
  @Post()
  abrir(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(cuentaAbrirEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let sucursalId = d.sucursalId ?? null;
      if (d.mesaId) {
        const m = await tx.selectFrom('mesa as m').innerJoin('salon as s', 's.id', 'm.salon_id').select(['m.id', 'm.activa', 's.sucursal_id', 's.activo']).where('m.id', '=', d.mesaId).forUpdate().executeTakeFirst();
        if (!m || !m.activa || !m.activo) throw noEncontrado('Mesa');
        sucursalId = m.sucursal_id;
        const abierta = await tx.selectFrom('cuenta_salon').select('numero').where('mesa_id', '=', d.mesaId).where('estado', '=', 'abierta').executeTakeFirst();
        if (abierta) throw conflicto('MESA_OCUPADA', `La mesa ya tiene la cuenta N.º ${Number(abierta.numero)}`);
      }
      exigirSucursal(ctx, sucursalId!, 'Sucursal');
      await tx.selectFrom('empresa').select('id').forUpdate().executeTakeFirstOrThrow();
      const n = await tx.selectFrom('cuenta_salon').select((eb) => eb.fn.max<string>('numero').as('n')).executeTakeFirstOrThrow();
      const r = await tx
        .insertInto('cuenta_salon')
        .values({ empresa_id: ctx.empresaId, numero: Number(n.n ?? 0) + 1, sucursal_id: sucursalId!, tipo: d.mesaId ? 'mesa' : 'mostrador', mesa_id: d.mesaId ?? null, nombre: d.nombre ?? null, comensales: d.comensales, mozo_id: ctx.usuarioId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await auditar(tx, { ...ctx, ...o }, { accion: 'abrir', entidad: 'cuenta_salon', entidadId: r.id, despues: d });
      return leerCuenta(tx, r.id);
    });
  }

  @Requiere('salon', 'crear')
  @Patch(':id')
  editar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ comensales: z.coerce.number().int().min(1).max(99).optional(), nombre: z.string().trim().max(60).nullable().optional(), nota: z.string().trim().max(300).nullable().optional() }), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const c = await obtenerCuenta(tx, ctx, id, true);
      exigirAbierta(c);
      await tx
        .updateTable('cuenta_salon')
        .set({ ...(d.comensales !== undefined && { comensales: d.comensales }), ...(d.nombre !== undefined && { nombre: d.nombre || null }), ...(d.nota !== undefined && { nota: d.nota || null }) })
        .where('id', '=', id)
        .execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'editar', entidad: 'cuenta_salon', entidadId: id, despues: d });
      return leerCuenta(tx, id);
    });
  }

  /** Agrega productos a la cuenta, con el precio vigente de la sucursal. Quedan por enviar a cocina. */
  @Requiere('salon', 'crear')
  @Post(':id/items')
  agregar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(cuentaItemsEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const c = await obtenerCuenta(tx, ctx, id, true);
      exigirAbierta(c);
      const ids = [...new Set(d.items.map((i) => i.varianteId))];
      const vs = await tx
        .selectFrom('variante as v')
        .innerJoin('producto as p', 'p.id', 'v.producto_id')
        .select(['v.id', 'v.nombre', 'p.nombre as producto', 'p.unidad', 'p.estacion', 'p.activo', 'v.activa', 'p.condicion_venta'])
        .where('v.id', 'in', ids)
        .execute();
      if (vs.length !== ids.length || vs.some((v) => !v.activo || !v.activa)) throw invalido('Algún producto no existe o está inactivo');
      if (vs.some((v) => v.condicion_venta !== 'libre')) throw invalido('Los productos bajo receta no se cargan en una cuenta');
      const porId = new Map(vs.map((v) => [v.id, v]));
      for (const i of d.items) if (porId.get(i.varianteId)!.unidad === 'unidad' && !Number.isInteger(i.cantidad)) throw invalido('La cantidad debe ser entera');
      const precios = await preciosVigentes(tx, ids, c.sucursal_id, null);
      await tx
        .insertInto('cuenta_salon_item')
        .values(
          d.items.map((i) => {
            const v = porId.get(i.varianteId)!;
            return {
              empresa_id: ctx.empresaId,
              cuenta_id: id,
              variante_id: i.varianteId,
              descripcion: v.nombre ? `${v.producto} · ${v.nombre}` : v.producto,
              cantidad: new Decimal(i.cantidad).toFixed(4),
              precio_unitario: new Decimal(precios.get(i.varianteId) ?? 0).toFixed(2),
              nota: i.nota ?? null,
              estacion: v.estacion,
              creado_por: ctx.usuarioId,
            };
          }),
        )
        .execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'agregar', entidad: 'cuenta_salon', entidadId: id, despues: d });
      return leerCuenta(tx, id);
    });
  }

  /** Quita un ítem todavía no enviado a cocina. */
  @Requiere('salon', 'crear')
  @Delete(':id/items/:item')
  @HttpCode(200)
  quitar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Param('item', ParseUUIDPipe) item: string, @OrigenPeticion() o: Origen) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const c = await obtenerCuenta(tx, ctx, id, true);
      exigirAbierta(c);
      const it = await tx.selectFrom('cuenta_salon_item').selectAll().where('id', '=', item).where('cuenta_id', '=', id).executeTakeFirst();
      if (!it) throw noEncontrado('Ítem');
      if (it.estado !== 'pendiente') throw conflicto('ITEM_ENVIADO', 'El ítem ya se envió: para quitarlo, anúlelo con el motivo');
      await tx.deleteFrom('cuenta_salon_item').where('id', '=', item).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'quitar', entidad: 'cuenta_salon', entidadId: id, antes: { descripcion: it.descripcion, cantidad: it.cantidad } });
      return leerCuenta(tx, id);
    });
  }

  /** Anula un ítem ya enviado (devuelto, error de carga): requiere permiso y motivo. */
  @Requiere('salon', 'cancelar')
  @Post(':id/items/:item/anular')
  @HttpCode(200)
  anularItem(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Param('item', ParseUUIDPipe) item: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(motivo, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const c = await obtenerCuenta(tx, ctx, id, true);
      exigirAbierta(c);
      const it = await tx.selectFrom('cuenta_salon_item').selectAll().where('id', '=', item).where('cuenta_id', '=', id).executeTakeFirst();
      if (!it) throw noEncontrado('Ítem');
      if (it.venta_id) throw conflicto('ITEM_COBRADO', 'El ítem ya se cobró: anule la venta');
      if (it.estado === 'anulado') throw conflicto('YA_ANULADO', 'El ítem ya está anulado');
      await tx.updateTable('cuenta_salon_item').set({ estado: 'anulado', anulado_por: ctx.usuarioId, motivo_anulacion: d.motivo }).where('id', '=', item).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'anular_item', entidad: 'cuenta_salon', entidadId: id, antes: { descripcion: it.descripcion, cantidad: it.cantidad, estado: it.estado }, despues: d });
      await cerrarSiPagada(tx, id);
      return leerCuenta(tx, id);
    });
  }

  /** Separa parte de un ítem (por ejemplo, 1 de 3 cervezas) para cobrarla aparte. */
  @Requiere('salon', 'crear')
  @Post(':id/items/:item/dividir')
  @HttpCode(200)
  dividir(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Param('item', ParseUUIDPipe) item: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ cantidad: z.coerce.number().positive() }), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const c = await obtenerCuenta(tx, ctx, id, true);
      exigirAbierta(c);
      const it = await tx.selectFrom('cuenta_salon_item').selectAll().where('id', '=', item).where('cuenta_id', '=', id).forUpdate().executeTakeFirst();
      if (!it) throw noEncontrado('Ítem');
      if (it.venta_id || it.estado === 'anulado') throw conflicto('ITEM_CERRADO', 'El ítem ya se cobró o está anulado');
      const separar = new Decimal(d.cantidad);
      if (separar.gte(it.cantidad)) throw invalido('La cantidad a separar debe ser menor que la del ítem');
      await tx.updateTable('cuenta_salon_item').set({ cantidad: new Decimal(it.cantidad).minus(separar).toFixed(4) }).where('id', '=', item).execute();
      const { id: _id, creado_en: _c, ...resto } = it;
      void _id;
      void _c;
      await tx.insertInto('cuenta_salon_item').values({ ...resto, cantidad: separar.toFixed(4) }).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'dividir_item', entidad: 'cuenta_salon', entidadId: id, despues: { item, cantidad: d.cantidad } });
      return leerCuenta(tx, id);
    });
  }

  /** Envía a cocina y bar lo pendiente, como una comanda. Lo que no tiene estación queda listo para servir. */
  @Requiere('salon', 'crear')
  @Post(':id/enviar')
  @HttpCode(200)
  enviar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @OrigenPeticion() o: Origen) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const c = await obtenerCuenta(tx, ctx, id, true);
      exigirAbierta(c);
      const pend = await tx.selectFrom('cuenta_salon_item').select(['id', 'estacion']).where('cuenta_id', '=', id).where('estado', '=', 'pendiente').execute();
      if (!pend.length) throw conflicto('NADA_PARA_ENVIAR', 'No hay productos por enviar');
      const n = await tx.selectFrom('comanda').select((eb) => eb.fn.max<number>('numero').as('n')).where('cuenta_id', '=', id).executeTakeFirstOrThrow();
      const k = await tx.insertInto('comanda').values({ empresa_id: ctx.empresaId, cuenta_id: id, numero: Number(n.n ?? 0) + 1, creado_por: ctx.usuarioId }).returning(['id', 'numero']).executeTakeFirstOrThrow();
      const conEstacion = pend.filter((p) => p.estacion).map((p) => p.id);
      const directos = pend.filter((p) => !p.estacion).map((p) => p.id);
      if (conEstacion.length) await tx.updateTable('cuenta_salon_item').set({ comanda_id: k.id, estado: 'enviado' }).where('id', 'in', conEstacion).execute();
      if (directos.length) await tx.updateTable('cuenta_salon_item').set({ comanda_id: k.id, estado: 'listo', listo_en: new Date() }).where('id', 'in', directos).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'enviar', entidad: 'cuenta_salon', entidadId: id, despues: { comanda: k.numero, items: pend.length } });
      return leerCuenta(tx, id);
    });
  }

  /** El mozo sirvió lo que estaba listo. */
  @Requiere('salon', 'crear')
  @Post(':id/servido')
  @HttpCode(200)
  servido(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ items: z.array(z.string().uuid()).max(300).optional() }), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const c = await obtenerCuenta(tx, ctx, id, true);
      exigirAbierta(c);
      let q = tx.updateTable('cuenta_salon_item').set({ estado: 'entregado', entregado_en: new Date() }).where('cuenta_id', '=', id).where('estado', '=', 'listo');
      if (d.items?.length) q = q.where('id', 'in', d.items);
      const r = await q.executeTakeFirst();
      await auditar(tx, { ...ctx, ...o }, { accion: 'servido', entidad: 'cuenta_salon', entidadId: id, despues: { items: Number(r.numUpdatedRows) } });
      return leerCuenta(tx, id);
    });
  }

  /** Pasa la cuenta a otra mesa libre de la misma sucursal. */
  @Requiere('salon', 'crear')
  @Post(':id/mover')
  @HttpCode(200)
  mover(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ mesaId: z.string().uuid() }), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const c = await obtenerCuenta(tx, ctx, id, true);
      exigirAbierta(c);
      const m = await tx.selectFrom('mesa as m').innerJoin('salon as s', 's.id', 'm.salon_id').select(['m.id', 'm.nombre', 'm.activa', 's.sucursal_id']).where('m.id', '=', d.mesaId).forUpdate().executeTakeFirst();
      if (!m || !m.activa) throw noEncontrado('Mesa');
      if (m.sucursal_id !== c.sucursal_id) throw invalido('La mesa es de otra sucursal');
      const ocupada = await tx.selectFrom('cuenta_salon').select('id').where('mesa_id', '=', d.mesaId).where('estado', '=', 'abierta').executeTakeFirst();
      if (ocupada) throw conflicto('MESA_OCUPADA', `La mesa ${m.nombre} está ocupada`);
      await tx.updateTable('cuenta_salon').set({ tipo: 'mesa', mesa_id: d.mesaId }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'mover', entidad: 'cuenta_salon', entidadId: id, antes: { mesaId: c.mesa_id }, despues: d });
      return leerCuenta(tx, id);
    });
  }

  /**
   * Cierra sin cobrar: una cuenta vacía (la mesa se libera) o, con permiso de anulación y motivo,
   * una con productos enviados. Lo ya cobrado no se toca: si hay cobros, se anulan las ventas.
   */
  @Requiere('salon', 'crear')
  @Post(':id/anular')
  @HttpCode(200)
  anular(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const c = await obtenerCuenta(tx, ctx, id, true);
      exigirAbierta(c);
      const items = await tx.selectFrom('cuenta_salon_item').select(['id', 'estado', 'venta_id']).where('cuenta_id', '=', id).execute();
      if (items.some((i) => i.venta_id)) throw conflicto('CUENTA_CON_COBROS', 'La cuenta tiene cobros: anule esas ventas primero');
      const enviados = items.filter((i) => i.estado !== 'pendiente' && i.estado !== 'anulado');
      let m: string | null = null;
      if (enviados.length) {
        if (!tiene(ctx, 'salon.cancelar')) throw prohibido('Anular una cuenta con productos enviados requiere permiso');
        m = validar(motivo, body).motivo;
      }
      await tx.deleteFrom('cuenta_salon_item').where('cuenta_id', '=', id).where('estado', '=', 'pendiente').execute();
      if (enviados.length) await tx.updateTable('cuenta_salon_item').set({ estado: 'anulado', anulado_por: ctx.usuarioId, motivo_anulacion: m }).where('id', 'in', enviados.map((i) => i.id)).execute();
      await tx.updateTable('cuenta_salon').set({ estado: 'anulada', cerrada_en: new Date(), anulada_por: ctx.usuarioId, motivo_anulacion: m }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'anular', entidad: 'cuenta_salon', entidadId: id, despues: { motivo: m, enviados: enviados.length } });
      return leerCuenta(tx, id);
    });
  }
}

/** La cuenta se cierra sola cuando todo lo que no está anulado quedó cobrado. */
export async function cerrarSiPagada(tx: Tx, cuentaId: string) {
  const r = await tx
    .selectFrom('cuenta_salon_item')
    .select([(eb) => eb.fn.count<string>('id').filterWhere('venta_id', 'is', null).filterWhere('estado', '<>', 'anulado').as('sin_cobrar'), (eb) => eb.fn.count<string>('id').filterWhere('venta_id', 'is not', null).as('cobrados')])
    .where('cuenta_id', '=', cuentaId)
    .executeTakeFirstOrThrow();
  if (Number(r.sin_cobrar) === 0 && Number(r.cobrados) > 0) await tx.updateTable('cuenta_salon').set({ estado: 'cerrada', cerrada_en: new Date() }).where('id', '=', cuentaId).where('estado', '=', 'abierta').execute();
}

@Controller('cocina')
export class CocinaController {
  constructor(private readonly db: Db) {}

  /** Comandas de una estación: lo pendiente y en preparación, y lo listo de los últimos 15 minutos. */
  @Requiere('cocina', 'ver')
  @Get()
  pantalla(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ sucursalId: z.string().uuid(), estacion: z.enum(['cocina', 'bar']) }), query);
    exigirSucursal(ctx, f.sucursalId, 'Sucursal');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const filas = await tx
        .selectFrom('cuenta_salon_item as i')
        .innerJoin('comanda as k', 'k.id', 'i.comanda_id')
        .innerJoin('cuenta_salon as c', 'c.id', 'i.cuenta_id')
        .leftJoin('mesa as m', 'm.id', 'c.mesa_id')
        .innerJoin('usuario as u', 'u.id', 'k.creado_por')
        .select(['i.id', 'i.descripcion', 'i.cantidad', 'i.nota', 'i.estado', 'i.listo_en', 'k.id as comanda_id', 'k.numero as comanda', 'k.enviada_en', 'c.numero as cuenta', 'c.tipo', 'c.nombre', 'm.nombre as mesa', 'u.nombre as mozo'])
        .where('c.sucursal_id', '=', f.sucursalId)
        .where('i.estacion', '=', f.estacion)
        .where((eb) => eb.or([eb('i.estado', 'in', ['enviado', 'preparando']), eb.and([eb('i.estado', '=', 'listo'), eb('i.listo_en', '>', sql<Date>`now() - interval '15 minutes'`)])]))
        .orderBy('k.enviada_en')
        .orderBy('i.creado_en')
        .execute();
      const comandas = new Map<string, { comandaId: string; numero: number; cuenta: number; destino: string; mozo: string; enviadaEn: Date; items: { id: string; descripcion: string; cantidad: string; nota: string | null; estado: string }[] }>();
      for (const r of filas) {
        if (!comandas.has(r.comanda_id))
          comandas.set(r.comanda_id, { comandaId: r.comanda_id, numero: r.comanda, cuenta: Number(r.cuenta), destino: r.mesa ? `Mesa ${r.mesa}` : `Mostrador${r.nombre ? ` · ${r.nombre}` : ''}`, mozo: r.mozo, enviadaEn: r.enviada_en, items: [] });
        comandas.get(r.comanda_id)!.items.push({ id: r.id, descripcion: r.descripcion, cantidad: new Decimal(r.cantidad).toString(), nota: r.nota, estado: r.estado });
      }
      return [...comandas.values()];
    });
  }

  /** Cambia el estado de ítems de la estación: en preparación, listo, o vuelve a pendiente. */
  @Requiere('cocina', 'editar')
  @Post('items')
  @HttpCode(200)
  estado(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ items: z.array(z.string().uuid()).min(1).max(100), estado: z.enum(['enviado', 'preparando', 'listo']) }), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const its = await tx.selectFrom('cuenta_salon_item as i').innerJoin('cuenta_salon as c', 'c.id', 'i.cuenta_id').select(['i.id', 'i.estado', 'c.sucursal_id', 'c.estado as cuenta_estado']).where('i.id', 'in', d.items).forUpdate().execute();
      if (its.length !== d.items.length || its.some((i) => !enSucursal(ctx, i.sucursal_id))) throw noEncontrado('Ítem');
      if (its.some((i) => !['enviado', 'preparando', 'listo'].includes(i.estado))) throw conflicto('ITEM_CERRADO', 'Algún ítem ya se sirvió o se anuló');
      await tx
        .updateTable('cuenta_salon_item')
        .set({ estado: d.estado, listo_en: d.estado === 'listo' ? new Date() : null })
        .where('id', 'in', d.items)
        .execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'estado_cocina', entidad: 'cuenta_salon_item', entidadId: d.items[0]!, despues: d });
      return { ok: true };
    });
  }
}
