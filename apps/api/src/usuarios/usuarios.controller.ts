import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { usuarioCrear, usuarioEditar, usuarioPermisosEntrada } from '@kontiva/shared';
import { AuthService } from '../auth/auth.service';
import { auditar } from '../comun/auditoria';
import { Contexto, OrigenPeticion, type Ctx, type Origen } from '../comun/contexto';
import { Correo } from '../comun/correo';
import { Requiere } from '../comun/decoradores';
import { verificarSinEscalada } from '../comun/escalada';
import { conflicto, invalido, noEncontrado, prohibido } from '../comun/errores';
import { validar } from '../comun/validar';
import { config } from '../config';
import { Db, type Tx } from '../db/database';
import { leerPerfil } from '../perfiles/perfiles.controller';

async function leerUsuario(tx: Tx, id: string) {
  const u = await tx
    .selectFrom('usuario as u')
    .innerJoin('perfil as p', 'p.id', 'u.perfil_id')
    .select([
      'u.id', 'u.nombre', 'u.activo', 'u.cuenta_id', 'u.creado_en', 'u.creado_por', 'u.hash_pin',
      'p.id as perfil_id', 'p.nombre as perfil_nombre', 'p.es_propietario',
    ])
    .where('u.id', '=', id)
    .executeTakeFirst();
  if (!u) return null;
  const [sucursales, individuales] = await Promise.all([
    tx.selectFrom('usuario_sucursal').select('sucursal_id').where('usuario_id', '=', id).execute(),
    tx.selectFrom('usuario_permiso').select(['permiso', 'tipo', 'alcance']).where('usuario_id', '=', id).orderBy('permiso').execute(),
  ]);
  return {
    id: u.id,
    nombre: u.nombre,
    activo: u.activo,
    cuentaId: u.cuenta_id,
    creadoPor: u.creado_por,
    creadoEn: u.creado_en,
    tienePin: u.hash_pin !== null,
    esPropietario: u.es_propietario,
    perfil: { id: u.perfil_id, nombre: u.perfil_nombre },
    sucursalIds: sucursales.map((s) => s.sucursal_id),
    permisosIndividuales: individuales,
  };
}
type UsuarioDto = NonNullable<Awaited<ReturnType<typeof leerUsuario>>>;

/** propia: los que creó y él mismo · sucursal: los que comparten alguna sucursal · empresa: todos. */
function enAlcance(ctx: Ctx, u: UsuarioDto): boolean {
  if (u.id === ctx.usuarioId || ctx.alcance === 'empresa') return true;
  if (ctx.alcance === 'sucursal') return u.sucursalIds.some((s) => ctx.sucursalIds.includes(s));
  return u.creadoPor === ctx.usuarioId;
}

@Controller('usuarios')
export class UsuariosController {
  constructor(
    private readonly db: Db,
    private readonly auth: AuthService,
    private readonly correo: Correo,
  ) {}

  private async obtener(tx: Tx, ctx: Ctx, id: string): Promise<UsuarioDto> {
    const u = await leerUsuario(tx, id);
    if (!u || !enAlcance(ctx, u)) throw noEncontrado('Usuario');
    return u;
  }

  private async conEmail<T extends { cuentaId: string }>(lista: T[]): Promise<(T & { email: string; invitacionPendiente: boolean })[]> {
    if (!lista.length) return [];
    const cuentas = await this.db.k.selectFrom('cuenta').select(['id', 'email', 'hash_contrasena']).where('id', 'in', lista.map((u) => u.cuentaId)).execute();
    const m = new Map(cuentas.map((c) => [c.id, c]));
    return lista.map((u) => ({ ...u, email: m.get(u.cuentaId)?.email ?? '', invitacionPendiente: !m.get(u.cuentaId)?.hash_contrasena }));
  }

  /** Sucursales a asignar: deben existir y, si el alcance no es empresa, ser propias. */
  private async validarSucursales(tx: Tx, ctx: Ctx, ids: string[]) {
    if (!ids.length) return;
    const existentes = await tx.selectFrom('sucursal').select('id').where('id', 'in', ids).where('activa', '=', true).execute();
    if (existentes.length !== new Set(ids).size) throw invalido('Alguna sucursal no existe o está inactiva');
    if (ctx.alcance !== 'empresa' && !ctx.esPropietario && ids.some((s) => !ctx.sucursalIds.includes(s))) {
      throw prohibido('Solo puede asignar sus propias sucursales');
    }
  }

  private async validarPerfilAsignable(tx: Tx, ctx: Ctx, perfilId: string) {
    const perfil = await leerPerfil(tx, perfilId).catch(() => null);
    if (!perfil) throw invalido('El perfil no existe');
    if (perfil.esPropietario) throw prohibido('El perfil Propietario no se asigna desde aquí');
    verificarSinEscalada(ctx, perfil.permisos, perfil.alcance);
    return perfil;
  }

  private async verificarLimiteUsuarios(tx: Tx) {
    const lim = await tx
      .selectFrom('empresa as e')
      .innerJoin('plan as p', 'p.id', 'e.plan_id')
      .select(['p.max_usuarios', 'p.codigo'])
      .forUpdate('e')
      .executeTakeFirstOrThrow();
    const activos = await tx.selectFrom('usuario').select((eb) => eb.fn.countAll<string>().as('n')).where('activo', '=', true).executeTakeFirstOrThrow();
    if (lim.max_usuarios !== null && Number(activos.n) >= lim.max_usuarios) {
      throw conflicto('LIMITE_PLAN', `El plan ${lim.codigo} permite ${lim.max_usuarios} usuarios activos. Cambie de plan para agregar más.`);
    }
  }

  @Requiere('usuario', 'ver')
  @Get()
  async listar(@Contexto() ctx: Ctx) {
    const lista = await this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const ids = await tx.selectFrom('usuario').select('id').orderBy('nombre').execute();
      const todos = await Promise.all(ids.map((u) => leerUsuario(tx, u.id)));
      return todos.filter((u): u is UsuarioDto => u !== null && enAlcance(ctx, u));
    });
    return this.conEmail(lista);
  }

  @Requiere('usuario', 'ver')
  @Get(':id')
  async ver(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    const u = await this.db.enEmpresa(ctx.empresaId, (tx) => this.obtener(tx, ctx, id));
    return (await this.conEmail([u]))[0];
  }

  @Requiere('usuario', 'crear')
  @Post()
  async crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(usuarioCrear, body);
    if (ctx.alcance !== 'empresa' && !ctx.esPropietario && d.sucursalIds.length === 0) {
      throw invalido('Asigne al menos una sucursal');
    }

    const r = await this.db.enEmpresa(ctx.empresaId, async (tx) => {
      await this.verificarLimiteUsuarios(tx);
      await this.validarPerfilAsignable(tx, ctx, d.perfilId);
      await this.validarSucursales(tx, ctx, d.sucursalIds);

      // La cuenta es global (una persona puede estar en varias empresas). Se crea en la misma
      // transacción: si el alta falla, no queda una cuenta huérfana.
      let cuenta = await tx.selectFrom('cuenta').select(['id', 'hash_contrasena']).where('email', '=', d.email).executeTakeFirst();
      const cuentaNueva = !cuenta;
      if (!cuenta) {
        cuenta = await tx.insertInto('cuenta').values({ email: d.email, nombre: d.nombre }).returning(['id', 'hash_contrasena']).executeTakeFirstOrThrow();
      }
      const cuentaId = cuenta.id;
      const existe = await tx.selectFrom('usuario').select('id').where('cuenta_id', '=', cuentaId).executeTakeFirst();
      if (existe) throw conflicto('USUARIO_EXISTENTE', 'Esa persona ya es usuario de esta empresa');

      const nuevo = await tx
        .insertInto('usuario')
        .values({ empresa_id: ctx.empresaId, cuenta_id: cuentaId, perfil_id: d.perfilId, nombre: d.nombre, hash_pin: null, pin_bloqueado_hasta: null, creado_por: ctx.usuarioId })
        .returning('id')
        .executeTakeFirstOrThrow();
      const sucursales = [...new Set(d.sucursalIds)];
      if (sucursales.length) {
        await tx.insertInto('usuario_sucursal').values(sucursales.map((s) => ({ empresa_id: ctx.empresaId, usuario_id: nuevo.id, sucursal_id: s }))).execute();
      }
      const despues = await leerUsuario(tx, nuevo.id);
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'usuario', entidadId: nuevo.id, despues: { ...despues, email: d.email } });
      const empresa = await tx.selectFrom('empresa').select(['razon_social', 'nombre_fantasia']).executeTakeFirstOrThrow();
      return {
        usuario: despues!,
        empresaNombre: empresa.nombre_fantasia ?? empresa.razon_social,
        cuentaId,
        necesitaContrasena: cuentaNueva || !cuenta.hash_contrasena,
      };
    });

    const token = r.necesitaContrasena ? await this.auth.emitirTokenCuenta(r.cuentaId, 'invitacion') : null;
    await this.correo.enviar({
      para: d.email,
      asunto: `KONTIVA ERP · Acceso a ${r.empresaNombre}`,
      texto:
        `Hola ${d.nombre}:\n\nLe dieron acceso a "${r.empresaNombre}" en KONTIVA ERP.\n\n` +
        (token
          ? `Cree su contraseña con este enlace (válido 7 días):\n${config().WEB_URL}/restablecer?token=${token}&invitacion=1\n\n`
          : `Ingrese con su correo y contraseña de siempre en ${config().WEB_URL}\n\n`) +
        `KONTIVA ERP · Desarrollado por Araújo Tech Sistemas`,
    });

    return (await this.conEmail([r.usuario]))[0];
  }

  @Requiere('usuario', 'editar')
  @Patch(':id')
  async editar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(usuarioEditar, body);
    const u = await this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const antes = await this.obtener(tx, ctx, id);
      if (antes.esPropietario && !ctx.esPropietario) throw prohibido('Solo el Propietario puede modificar su propio usuario');
      if (antes.esPropietario && (d.perfilId !== undefined || d.activo === false)) {
        throw prohibido('El Propietario no se puede desactivar ni cambiar de perfil');
      }
      if (id === ctx.usuarioId && d.activo === false) throw prohibido('No puede desactivar su propio usuario');
      if (id === ctx.usuarioId && d.perfilId !== undefined && !ctx.esPropietario) throw prohibido('No puede cambiar su propio perfil');

      // Quien edita debe poder otorgar el perfil actual (no se modifica a alguien con más permisos).
      if (!antes.esPropietario) {
        const perfilActual = await leerPerfil(tx, antes.perfil.id);
        verificarSinEscalada(ctx, perfilActual.permisos, perfilActual.alcance);
      }
      if (d.perfilId !== undefined) await this.validarPerfilAsignable(tx, ctx, d.perfilId);
      if (d.sucursalIds !== undefined) await this.validarSucursales(tx, ctx, d.sucursalIds);
      if (d.activo === true && !antes.activo) await this.verificarLimiteUsuarios(tx);

      await tx
        .updateTable('usuario')
        .set({
          ...(d.nombre !== undefined && { nombre: d.nombre }),
          ...(d.perfilId !== undefined && { perfil_id: d.perfilId }),
          ...(d.activo !== undefined && { activo: d.activo }),
        })
        .where('id', '=', id)
        .execute();
      if (d.sucursalIds !== undefined) {
        await tx.deleteFrom('usuario_sucursal').where('usuario_id', '=', id).execute();
        const s = [...new Set(d.sucursalIds)];
        if (s.length) await tx.insertInto('usuario_sucursal').values(s.map((x) => ({ empresa_id: ctx.empresaId, usuario_id: id, sucursal_id: x }))).execute();
      }
      const despues = (await leerUsuario(tx, id))!;
      await auditar(tx, { ...ctx, ...o }, { accion: d.activo === false ? 'desactivar' : 'editar', entidad: 'usuario', entidadId: id, antes, despues });
      return despues;
    });
    if (d.activo === false) await this.revocarSesionesDeUsuario(id);
    return (await this.conEmail([u]))[0];
  }

  /** No se borran usuarios (firman operaciones): se desactivan y se cierran sus sesiones. */
  @Requiere('usuario', 'eliminar')
  @Delete(':id')
  @HttpCode(204)
  async desactivar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @OrigenPeticion() o: Origen) {
    await this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const antes = await this.obtener(tx, ctx, id);
      if (antes.esPropietario) throw prohibido('El Propietario no se puede desactivar');
      if (id === ctx.usuarioId) throw prohibido('No puede desactivar su propio usuario');
      const perfil = await leerPerfil(tx, antes.perfil.id);
      verificarSinEscalada(ctx, perfil.permisos, perfil.alcance);
      if (!antes.activo) return;
      await tx.updateTable('usuario').set({ activo: false }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'desactivar', entidad: 'usuario', entidadId: id, antes });
    });
    await this.revocarSesionesDeUsuario(id);
  }

  /** Reemplaza las concesiones y restricciones individuales del usuario. */
  @Requiere('usuario', 'editar')
  @Put(':id/permisos')
  async permisos(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(usuarioPermisosEntrada, body);
    const u = await this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const antes = await this.obtener(tx, ctx, id);
      if (antes.esPropietario) throw prohibido('El Propietario no admite restricciones');
      if (id === ctx.usuarioId) throw prohibido('No puede modificar sus propios permisos');
      const perfil = await leerPerfil(tx, antes.perfil.id);
      verificarSinEscalada(ctx, perfil.permisos, perfil.alcance);
      for (const p of d.permisos) verificarSinEscalada(ctx, [p.permiso], p.tipo === 'conceder' ? p.alcance : 'propia');
      for (const p of antes.permisosIndividuales) verificarSinEscalada(ctx, [p.permiso], 'propia');

      await tx.deleteFrom('usuario_permiso').where('usuario_id', '=', id).execute();
      const unicos = new Map(d.permisos.map((p) => [p.permiso, p]));
      if (unicos.size) {
        await tx
          .insertInto('usuario_permiso')
          .values([...unicos.values()].map((p) => ({ empresa_id: ctx.empresaId, usuario_id: id, permiso: p.permiso, tipo: p.tipo, alcance: p.alcance })))
          .execute();
      }
      const despues = (await leerUsuario(tx, id))!;
      await auditar(tx, { ...ctx, ...o }, {
        accion: 'editar_permisos',
        entidad: 'usuario',
        entidadId: id,
        antes: antes.permisosIndividuales,
        despues: despues.permisosIndividuales,
      });
      return despues;
    });
    return (await this.conEmail([u]))[0];
  }

  /** Reenvía la invitación a quien todavía no creó su contraseña. */
  @Requiere('usuario', 'crear')
  @Post(':id/invitacion')
  @HttpCode(204)
  async reenviarInvitacion(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    const u = await this.db.enEmpresa(ctx.empresaId, (tx) => this.obtener(tx, ctx, id));
    const cuenta = await this.db.k.selectFrom('cuenta').select(['email', 'hash_contrasena']).where('id', '=', u.cuentaId).executeTakeFirstOrThrow();
    if (cuenta.hash_contrasena) throw conflicto('YA_ACTIVO', 'El usuario ya creó su contraseña');
    const token = await this.auth.emitirTokenCuenta(u.cuentaId, 'invitacion');
    await this.correo.enviar({
      para: cuenta.email,
      asunto: 'KONTIVA ERP · Invitación',
      texto: `Hola ${u.nombre}:\n\nCree su contraseña con este enlace (válido 7 días):\n${config().WEB_URL}/restablecer?token=${token}&invitacion=1\n\nKONTIVA ERP · Desarrollado por Araújo Tech Sistemas`,
    });
  }

  private async revocarSesionesDeUsuario(usuarioId: string) {
    await this.db.k
      .updateTable('sesion')
      .set({ revocada_en: new Date(), motivo_revocacion: 'usuario_desactivado' })
      .where('usuario_id', '=', usuarioId)
      .where('revocada_en', 'is', null)
      .execute();
  }
}
