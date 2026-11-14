import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { sucursalCrear, sucursalEditar } from '@kontiva/shared';
import { auditar } from '../comun/auditoria';
import { Contexto, OrigenPeticion, type Ctx, type Origen } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { conflicto, noEncontrado, prohibido } from '../comun/errores';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';
import type { Sucursal } from '../db/tipos';

const aDto = (s: Sucursal) => ({
  id: s.id,
  codigo: s.codigo,
  nombre: s.nombre,
  direccion: s.direccion,
  telefono: s.telefono,
  activa: s.activa,
  creadoEn: s.creado_en,
});

/** Con alcance menor a empresa, solo las sucursales asignadas al usuario. */
function enAlcance(ctx: Ctx, id: string): boolean {
  return ctx.alcance === 'empresa' || ctx.sucursalIds.includes(id);
}

async function obtener(tx: Tx, ctx: Ctx, id: string): Promise<Sucursal> {
  const s = await tx.selectFrom('sucursal').selectAll().where('id', '=', id).executeTakeFirst();
  if (!s || !enAlcance(ctx, id)) throw noEncontrado('Sucursal');
  return s;
}

@Controller('sucursales')
export class SucursalesController {
  constructor(private readonly db: Db) {}

  @Requiere('sucursal', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let q = tx.selectFrom('sucursal').selectAll().orderBy('codigo');
      if (ctx.alcance !== 'empresa') {
        if (!ctx.sucursalIds.length) return [];
        q = q.where('id', 'in', [...ctx.sucursalIds]);
      }
      return (await q.execute()).map(aDto);
    });
  }

  @Requiere('sucursal', 'ver')
  @Get(':id')
  ver(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => aDto(await obtener(tx, ctx, id)));
  }

  @Requiere('sucursal', 'crear')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    if (ctx.alcance !== 'empresa') throw prohibido('Crear sucursales requiere alcance de empresa');
    const d = validar(sucursalCrear, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      // Bloquea la empresa: dos altas simultáneas no pueden pasar el límite del plan.
      const lim = await tx
        .selectFrom('empresa as e')
        .innerJoin('plan as p', 'p.id', 'e.plan_id')
        .select(['p.max_sucursales', 'p.codigo'])
        .forUpdate('e')
        .executeTakeFirstOrThrow();
      const activas = await tx.selectFrom('sucursal').select((eb) => eb.fn.countAll<string>().as('n')).where('activa', '=', true).executeTakeFirstOrThrow();
      if (lim.max_sucursales !== null && Number(activas.n) >= lim.max_sucursales) {
        throw conflicto('LIMITE_PLAN', `El plan ${lim.codigo} permite ${lim.max_sucursales} sucursal(es). Cambie de plan para agregar más.`);
      }
      const s = await tx
        .insertInto('sucursal')
        .values({ empresa_id: ctx.empresaId, nombre: d.nombre, codigo: d.codigo, direccion: d.direccion ?? null, telefono: d.telefono ?? null, creado_por: ctx.usuarioId })
        .returningAll()
        .executeTakeFirstOrThrow();
      // Cada sucursal nace con su depósito, para poder recibir stock y abrir cajas.
      await tx.insertInto('deposito').values({ empresa_id: ctx.empresaId, sucursal_id: s.id, nombre: 'Depósito principal' }).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'sucursal', entidadId: s.id, despues: aDto(s) });
      return aDto(s);
    });
  }

  @Requiere('sucursal', 'editar')
  @Patch(':id')
  editar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(sucursalEditar, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const antes = await obtener(tx, ctx, id);
      if (d.activa === true && !antes.activa) {
        const lim = await tx.selectFrom('empresa as e').innerJoin('plan as p', 'p.id', 'e.plan_id').select(['p.max_sucursales', 'p.codigo']).forUpdate('e').executeTakeFirstOrThrow();
        const activas = await tx.selectFrom('sucursal').select((eb) => eb.fn.countAll<string>().as('n')).where('activa', '=', true).executeTakeFirstOrThrow();
        if (lim.max_sucursales !== null && Number(activas.n) >= lim.max_sucursales) {
          throw conflicto('LIMITE_PLAN', `El plan ${lim.codigo} permite ${lim.max_sucursales} sucursal(es).`);
        }
      }
      if (d.activa === false && antes.activa) await this.verificarNoEsUltima(tx);
      const s = await tx
        .updateTable('sucursal')
        .set({
          ...(d.nombre !== undefined && { nombre: d.nombre }),
          ...(d.codigo !== undefined && { codigo: d.codigo }),
          ...(d.direccion !== undefined && { direccion: d.direccion || null }),
          ...(d.telefono !== undefined && { telefono: d.telefono || null }),
          ...(d.activa !== undefined && { activa: d.activa }),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await auditar(tx, { ...ctx, ...o }, { accion: 'editar', entidad: 'sucursal', entidadId: id, antes: aDto(antes), despues: aDto(s) });
      return aDto(s);
    });
  }

  /** No se borran sucursales (tienen historia): se desactivan. */
  @Requiere('sucursal', 'eliminar')
  @Delete(':id')
  @HttpCode(204)
  async desactivar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @OrigenPeticion() o: Origen) {
    await this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const antes = await obtener(tx, ctx, id);
      if (!antes.activa) return;
      await this.verificarNoEsUltima(tx);
      await tx.updateTable('sucursal').set({ activa: false }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'desactivar', entidad: 'sucursal', entidadId: id, antes: aDto(antes) });
    });
  }

  private async verificarNoEsUltima(tx: Tx) {
    const activas = await tx.selectFrom('sucursal').select((eb) => eb.fn.countAll<string>().as('n')).where('activa', '=', true).executeTakeFirstOrThrow();
    if (Number(activas.n) <= 1) throw conflicto('ULTIMA_SUCURSAL', 'La empresa debe tener al menos una sucursal activa');
  }
}
