import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { PERMISOS, perfilCrear, perfilEditar } from '@kontiva/shared';
import { auditar } from '../comun/auditoria';
import { Contexto, OrigenPeticion, type Ctx, type Origen } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { verificarSinEscalada } from '../comun/escalada';
import { conflicto, noEncontrado, prohibido } from '../comun/errores';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';

const TODOS = PERMISOS.map((p) => p.codigo);

export async function leerPerfil(tx: Tx, id: string) {
  const p = await tx.selectFrom('perfil').selectAll().where('id', '=', id).executeTakeFirst();
  if (!p) throw noEncontrado('Perfil');
  const permisos = p.es_propietario
    ? TODOS
    : (await tx.selectFrom('perfil_permiso').select('permiso').where('perfil_id', '=', id).orderBy('permiso').execute()).map((x) => x.permiso);
  const usuarios = await tx.selectFrom('usuario').select((eb) => eb.fn.countAll<string>().as('n')).where('perfil_id', '=', id).executeTakeFirstOrThrow();
  return {
    id: p.id,
    clave: p.clave,
    nombre: p.nombre,
    descripcion: p.descripcion,
    alcance: p.alcance,
    esPropietario: p.es_propietario,
    sistema: p.sistema,
    usuarios: Number(usuarios.n),
    permisos,
  };
}

@Controller('perfiles')
export class PerfilesController {
  constructor(private readonly db: Db) {}

  @Requiere('perfil', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const ids = await tx.selectFrom('perfil').select('id').orderBy('es_propietario', 'desc').orderBy('nombre').execute();
      return Promise.all(ids.map((p) => leerPerfil(tx, p.id)));
    });
  }

  @Requiere('perfil', 'ver')
  @Get(':id')
  ver(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, (tx) => leerPerfil(tx, id));
  }

  @Requiere('perfil', 'crear')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(perfilCrear, body);
    verificarSinEscalada(ctx, d.permisos, d.alcance);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const p = await tx
        .insertInto('perfil')
        .values({ empresa_id: ctx.empresaId, nombre: d.nombre, descripcion: d.descripcion ?? null, alcance: d.alcance, clave: null, creado_por: ctx.usuarioId })
        .returning('id')
        .executeTakeFirstOrThrow();
      const codigos = [...new Set(d.permisos)];
      if (codigos.length) {
        await tx.insertInto('perfil_permiso').values(codigos.map((permiso) => ({ empresa_id: ctx.empresaId, perfil_id: p.id, permiso }))).execute();
      }
      const despues = await leerPerfil(tx, p.id);
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'perfil', entidadId: p.id, despues });
      return despues;
    });
  }

  @Requiere('perfil', 'editar')
  @Patch(':id')
  editar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(perfilEditar, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const antes = await leerPerfil(tx, id);
      if (antes.esPropietario) throw prohibido('El perfil Propietario no se puede modificar');
      const alcance = d.alcance ?? antes.alcance;
      const permisos = d.permisos ? [...new Set(d.permisos)] : antes.permisos;
      // Quien edita debe tener todo lo que el perfil termina dando, y también lo que quita
      // (así nadie baja permisos de un perfil superior al suyo).
      verificarSinEscalada(ctx, [...new Set([...permisos, ...antes.permisos])], alcance);
      await tx
        .updateTable('perfil')
        .set({
          ...(d.nombre !== undefined && { nombre: d.nombre }),
          ...(d.descripcion !== undefined && { descripcion: d.descripcion ?? null }),
          alcance,
        })
        .where('id', '=', id)
        .execute();
      if (d.permisos) {
        await tx.deleteFrom('perfil_permiso').where('perfil_id', '=', id).execute();
        if (permisos.length) {
          await tx.insertInto('perfil_permiso').values(permisos.map((permiso) => ({ empresa_id: ctx.empresaId, perfil_id: id, permiso }))).execute();
        }
      }
      const despues = await leerPerfil(tx, id);
      await auditar(tx, { ...ctx, ...o }, { accion: 'editar', entidad: 'perfil', entidadId: id, antes, despues });
      return despues;
    });
  }

  @Requiere('perfil', 'eliminar')
  @Delete(':id')
  @HttpCode(204)
  async eliminar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @OrigenPeticion() o: Origen) {
    await this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const antes = await leerPerfil(tx, id);
      if (antes.sistema) throw prohibido('Los perfiles del sistema no se eliminan; puede editarlos');
      if (antes.usuarios > 0) throw conflicto('PERFIL_EN_USO', `El perfil tiene ${antes.usuarios} usuario(s) asignado(s)`);
      verificarSinEscalada(ctx, antes.permisos, antes.alcance);
      await tx.deleteFrom('perfil').where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'eliminar', entidad: 'perfil', entidadId: id, antes });
    });
  }
}
