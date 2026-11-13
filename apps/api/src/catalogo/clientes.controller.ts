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

const aDto = (c: Selectable<ClienteTabla>) => ({
  id: c.id,
  nombre: c.nombre,
  documento: c.documento,
  telefono: c.telefono,
  email: c.email,
  direccion: c.direccion,
  listaPrecioId: c.lista_precio_id,
  activo: c.activo,
});

/** Lista especial del cliente: debe existir y estar activa; la predeterminada equivale a ninguna. */
async function listaValida(tx: Tx, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const l = await tx.selectFrom('lista_precio').select(['id', 'predeterminada', 'activa']).where('id', '=', id).executeTakeFirst();
  if (!l || !l.activa) throw invalido('La lista de precios no existe o está inactiva');
  return l.predeterminada ? null : l.id;
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
      return (await q.orderBy('nombre').limit(f.limite).execute()).map(aDto);
    });
  }

  @Requiere('cliente', 'ver')
  @Get(':id')
  ver(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => aDto(await obtener(tx, id)));
  }

  @Requiere('cliente', 'crear')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(clienteEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const c = await tx
        .insertInto('cliente')
        .values({ empresa_id: ctx.empresaId, nombre: d.nombre, documento: d.documento, telefono: d.telefono ?? null, email: d.email ?? null, direccion: d.direccion ?? null, lista_precio_id: await listaValida(tx, d.listaPrecioId), creado_por: ctx.usuarioId })
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
        .set({ nombre: d.nombre, documento: d.documento, telefono: d.telefono ?? null, email: d.email ?? null, direccion: d.direccion ?? null, lista_precio_id: lista, ...(d.activo !== undefined && { activo: d.activo }) })
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
