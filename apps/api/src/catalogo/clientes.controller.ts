import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { clienteEntrada } from '@kontiva/shared';
import { z } from 'zod';
import { auditar } from '../comun/auditoria';
import { Contexto, OrigenPeticion, type Ctx, type Origen } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { invalido, noEncontrado } from '../comun/errores';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';
import type { ClienteTabla } from '../db/tipos';
import type { Selectable } from 'kysely';
import Decimal from 'decimal.js';
import { tiene } from '../comun/contexto';

const aDto = (c: Selectable<ClienteTabla>) => ({
  id: c.id,
  nombre: c.nombre,
  documento: c.documento,
  telefono: c.telefono,
  email: c.email,
  direccion: c.direccion,
  listaPrecioId: c.lista_precio_id,
  limiteCredito: c.limite_credito,
  plazoCreditoDias: c.plazo_credito_dias,
  activo: c.activo,
});

/** Deuda abierta del cliente (cuentas a cobrar pendientes). */
export async function saldoCliente(tx: Tx, clienteId: string) {
  const r = await tx.selectFrom('cuenta_cobrar').select((eb) => eb.fn.coalesce(eb.fn.sum<string>('saldo'), eb.val('0')).as('s')).where('cliente_id', '=', clienteId).where('estado', 'in', ['pendiente', 'parcial']).executeTakeFirstOrThrow();
  return new Decimal(r.s);
}

/** Lista especial del cliente: debe existir y estar activa; la predeterminada equivale a ninguna. */
async function listaValida(tx: Tx, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const l = await tx.selectFrom('lista_precio').select(['id', 'predeterminada', 'activa']).where('id', '=', id).executeTakeFirst();
  if (!l || !l.activa) throw invalido('La lista de precios no existe o está inactiva');
  return l.predeterminada ? null : l.id;
}

/** Límite y plazo de crédito: solo los cambia quien tiene credito_cliente.editar. */
function credito(ctx: Ctx, d: { limiteCredito?: number; plazoCreditoDias?: number }) {
  if ((d.limiteCredito !== undefined || d.plazoCreditoDias !== undefined) && !tiene(ctx, 'credito_cliente.editar')) return {};
  return {
    ...(d.limiteCredito !== undefined && { limite_credito: new Decimal(d.limiteCredito).toFixed(2) }),
    ...(d.plazoCreditoDias !== undefined && { plazo_credito_dias: d.plazoCreditoDias }),
  };
}

async function obtener(tx: Tx, id: string) {
  const c = await tx.selectFrom('cliente').selectAll().where('id', '=', id).executeTakeFirst();
  if (!c) throw noEncontrado('Cliente');
  return c;
}

@Controller('clientes')
export class ClientesController {
  constructor(private readonly db: Db) {}

  @Requiere('cliente', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ q: z.string().trim().max(100).optional(), limite: z.coerce.number().int().min(1).max(200).default(50) }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let q = tx.selectFrom('cliente').selectAll().where('activo', '=', true);
      if (f.q) q = q.where((eb) => eb.or([eb('nombre', 'ilike', `%${f.q}%`), eb('documento', 'ilike', `${f.q}%`), eb('telefono', 'ilike', `%${f.q}%`)]));
      const filas = await q.orderBy('nombre').limit(f.limite).execute();
      const conCredito = filas.filter((c) => Number(c.limite_credito) > 0).map((c) => c.id);
      const saldos = conCredito.length
        ? new Map(
            (await tx.selectFrom('cuenta_cobrar').select(['cliente_id', (eb) => eb.fn.sum<string>('saldo').as('s')]).where('cliente_id', 'in', conCredito).where('estado', 'in', ['pendiente', 'parcial']).groupBy('cliente_id').execute()).map((r) => [r.cliente_id, r.s]),
          )
        : new Map<string, string>();
      return filas.map((c) => ({ ...aDto(c), saldo: new Decimal(saldos.get(c.id) ?? 0).toFixed(2) }));
    });
  }

  @Requiere('cliente', 'ver')
  @Get(':id')
  ver(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => ({ ...aDto(await obtener(tx, id)), saldo: (await saldoCliente(tx, id)).toFixed(2) }));
  }

  @Requiere('cliente', 'crear')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(clienteEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const c = await tx
        .insertInto('cliente')
        .values({ empresa_id: ctx.empresaId, nombre: d.nombre, documento: d.documento, telefono: d.telefono ?? null, email: d.email ?? null, direccion: d.direccion ?? null, lista_precio_id: await listaValida(tx, d.listaPrecioId), ...credito(ctx, d), creado_por: ctx.usuarioId })
        .returningAll()
        .executeTakeFirstOrThrow();
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'cliente', entidadId: c.id, despues: aDto(c) });
      return aDto(c);
    });
  }

  @Requiere('cliente', 'editar')
  @Patch(':id')
  editar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(clienteEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const antes = await obtener(tx, id);
      const lista = d.listaPrecioId === undefined ? antes.lista_precio_id : await listaValida(tx, d.listaPrecioId);
      const c = await tx
        .updateTable('cliente')
        .set({ nombre: d.nombre, documento: d.documento, telefono: d.telefono ?? null, email: d.email ?? null, direccion: d.direccion ?? null, lista_precio_id: lista, ...credito(ctx, d), ...(d.activo !== undefined && { activo: d.activo }) })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await auditar(tx, { ...ctx, ...o }, { accion: 'editar', entidad: 'cliente', entidadId: id, antes: aDto(antes), despues: aDto(c) });
      return aDto(c);
    });
  }

  @Requiere('cliente', 'eliminar')
  @Delete(':id')
  @HttpCode(204)
  async desactivar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @OrigenPeticion() o: Origen) {
    await this.db.enEmpresa(ctx.empresaId, async (tx) => {
      await obtener(tx, id);
      await tx.updateTable('cliente').set({ activo: false }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'desactivar', entidad: 'cliente', entidadId: id });
    });
  }
}
