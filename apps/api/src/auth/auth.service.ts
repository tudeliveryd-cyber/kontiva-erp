import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { auditar } from '../comun/auditoria';
import type { Ctx, Origen } from '../comun/contexto';
import { Correo } from '../comun/correo';
import { ErrorNegocio, invalido, noAutenticado, prohibido } from '../comun/errores';
import { config } from '../config';
import { Db } from '../db/database';
import { cargarPermisos } from './permisos';
import { hashear, requiereRehash, sha256, tokenAleatorio, verificar, verificarSenuelo } from './cripto';
import { DURACION_ACCESO_S, Tokens } from './tokens';

export const DURACION_SESION_DIAS = 30;
export const DURACION_RECUPERACION_MIN = 30;
export const DURACION_INVITACION_DIAS = 7;
const INTENTOS_ANTES_DE_BLOQUEO = 5;
const BLOQUEO_MAX_MIN = 60;
const INTENTOS_PIN = 3;
const BLOQUEO_PIN_MIN = 5;

export interface Membresia {
  empresa_id: string;
  usuario_id: string;
  empresa_nombre: string;
  empresa_estado: 'activa' | 'suspendida';
}

export interface SesionEmitida {
  tipo: 'sesion';
  accessToken: string;
  expiraEn: number;
  refreshToken: string;
  empresaId: string;
}

export interface EleccionEmpresa {
  tipo: 'elegir_empresa';
  ticket: string;
  empresas: { id: string; nombre: string }[];
}

const credencialesInvalidas = () =>
  new ErrorNegocio(HttpStatus.UNAUTHORIZED, 'CREDENCIALES_INVALIDAS', 'Correo o contraseña incorrectos');

@Injectable()
export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly tokens: Tokens,
    private readonly correo: Correo,
  ) {}

  // -------------------------------------------------------------------------
  // Inicio de sesión
  // -------------------------------------------------------------------------

  async login(email: string, contrasena: string, empresaId: string | undefined, o: Origen): Promise<SesionEmitida | EleccionEmpresa> {
    const cuenta = await this.db.k.selectFrom('cuenta').selectAll().where('email', '=', email).executeTakeFirst();

    if (!cuenta || !cuenta.hash_contrasena) {
      await verificarSenuelo(contrasena);
      await this.registrarIntento(email, cuenta?.id ?? null, false, cuenta ? 'sin_contrasena' : 'cuenta_inexistente', o);
      throw credencialesInvalidas();
    }

    if (cuenta.bloqueada_hasta && cuenta.bloqueada_hasta > new Date()) {
      await this.registrarIntento(email, cuenta.id, false, 'bloqueada', o);
      const minutos = Math.ceil((cuenta.bloqueada_hasta.getTime() - Date.now()) / 60000);
      throw new ErrorNegocio(
        HttpStatus.TOO_MANY_REQUESTS,
        'CUENTA_BLOQUEADA',
        `Demasiados intentos fallidos. Intente de nuevo en ${minutos} minuto${minutos === 1 ? '' : 's'}.`,
      );
    }

    if (!(await verificar(cuenta.hash_contrasena, contrasena))) {
      // Bloqueo progresivo: a partir del 5.º fallo, 1, 2, 4... minutos, hasta 60.
      const intentos = cuenta.intentos_fallidos + 1;
      const bloqueo =
        intentos >= INTENTOS_ANTES_DE_BLOQUEO
          ? new Date(Date.now() + Math.min(2 ** (intentos - INTENTOS_ANTES_DE_BLOQUEO), BLOQUEO_MAX_MIN) * 60000)
          : null;
      await this.db.k
        .updateTable('cuenta')
        .set({ intentos_fallidos: intentos, bloqueada_hasta: bloqueo })
        .where('id', '=', cuenta.id)
        .execute();
      await this.registrarIntento(email, cuenta.id, false, 'contrasena_incorrecta', o);
      throw credencialesInvalidas();
    }

    await this.db.k
      .updateTable('cuenta')
      .set({
        intentos_fallidos: 0,
        bloqueada_hasta: null,
        ...(requiereRehash(cuenta.hash_contrasena) ? { hash_contrasena: await hashear(contrasena) } : {}),
      })
      .where('id', '=', cuenta.id)
      .execute();

    const membresias = (await this.membresias(cuenta.id)).filter((m) => m.empresa_estado === 'activa');
    if (membresias.length === 0) {
      await this.registrarIntento(email, cuenta.id, false, 'sin_empresa', o);
      throw prohibido('Su usuario no tiene acceso a ninguna empresa activa');
    }

    let elegida: Membresia | undefined;
    if (empresaId) {
      elegida = membresias.find((m) => m.empresa_id === empresaId);
      if (!elegida) throw prohibido('No tiene acceso a esa empresa');
    } else if (membresias.length === 1) {
      elegida = membresias[0];
    }

    await this.registrarIntento(email, cuenta.id, true, 'ok', o);

    if (!elegida) {
      return {
        tipo: 'elegir_empresa',
        ticket: await this.tokens.firmarPreauth({ cta: cuenta.id }),
        empresas: membresias.map((m) => ({ id: m.empresa_id, nombre: m.empresa_nombre })),
      };
    }
    return this.crearSesion(cuenta.id, elegida, o);
  }

  /** Segundo paso cuando la cuenta pertenece a varias empresas. */
  async elegirEmpresa(ticket: string, empresaId: string, o: Origen): Promise<SesionEmitida> {
    const claims = await this.tokens.leerPreauth(ticket);
    if (!claims) throw noAutenticado('El tiempo para elegir empresa venció. Inicie sesión de nuevo.');
    const m = (await this.membresias(claims.cta)).find((x) => x.empresa_id === empresaId && x.empresa_estado === 'activa');
    if (!m) throw prohibido('No tiene acceso a esa empresa');
    return this.crearSesion(claims.cta, m, o);
  }

  async cambiarEmpresa(ctx: Ctx, empresaId: string, o: Origen): Promise<SesionEmitida> {
    const m = (await this.membresias(ctx.cuentaId)).find((x) => x.empresa_id === empresaId && x.empresa_estado === 'activa');
    if (!m) throw prohibido('No tiene acceso a esa empresa');
    await this.revocarSesion(ctx.sesionId, 'cambio_empresa');
    return this.crearSesion(ctx.cuentaId, m, o);
  }

  async membresias(cuentaId: string): Promise<Membresia[]> {
    const { rows } = await sql<Membresia>`SELECT * FROM auth_membresias(${cuentaId}::uuid)`.execute(this.db.k);
    return rows;
  }

  private async crearSesion(cuentaId: string, m: Membresia, o: Origen): Promise<SesionEmitida> {
    const refreshToken = tokenAleatorio();
    const sesion = await this.db.k
      .insertInto('sesion')
      .values({
        cuenta_id: cuentaId,
        empresa_id: m.empresa_id,
        usuario_id: m.usuario_id,
        hash_token: sha256(refreshToken),
        ip: o.ip,
        agente: o.agente,
        expira_en: new Date(Date.now() + DURACION_SESION_DIAS * 86400000),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await this.db.enEmpresa(m.empresa_id, (tx) =>
      auditar(tx, { empresaId: m.empresa_id, usuarioId: m.usuario_id, cuentaId, ...o }, {
        accion: 'inicio_sesion',
        entidad: 'sesion',
        entidadId: sesion.id,
      }),
    );

    return {
      tipo: 'sesion',
      accessToken: await this.tokens.firmarAcceso({ sub: m.usuario_id, cta: cuentaId, emp: m.empresa_id, sid: sesion.id }),
      expiraEn: DURACION_ACCESO_S,
      refreshToken,
      empresaId: m.empresa_id,
    };
  }

  // -------------------------------------------------------------------------
  // Renovación rotativa
  // -------------------------------------------------------------------------

  /**
   * Cada renovación entrega un token nuevo e invalida el anterior. Si alguien presenta un
   * token ya rotado, se asume robo y se cierra la sesión completa.
   */
  async renovar(refreshToken: string, o: Origen): Promise<SesionEmitida> {
    const hash = sha256(refreshToken);
    const nuevo = tokenAleatorio();

    const rotada = await this.db.k
      .updateTable('sesion')
      .set({ hash_token: sha256(nuevo), hash_token_anterior: hash, ultimo_uso_en: new Date(), ip: o.ip, agente: o.agente })
      .where('hash_token', '=', hash)
      .where('revocada_en', 'is', null)
      .where('expira_en', '>', new Date())
      .returning(['id', 'cuenta_id', 'empresa_id', 'usuario_id'])
      .executeTakeFirst();

    if (!rotada) {
      const reutilizada = await this.db.k
        .updateTable('sesion')
        .set({ revocada_en: new Date(), motivo_revocacion: 'reutilizacion_token' })
        .where('hash_token_anterior', '=', hash)
        .where('revocada_en', 'is', null)
        .returning(['id', 'empresa_id', 'usuario_id', 'cuenta_id'])
        .executeTakeFirst();
      if (reutilizada) {
        await this.db.enEmpresa(reutilizada.empresa_id, (tx) =>
          auditar(tx, { empresaId: reutilizada.empresa_id, usuarioId: reutilizada.usuario_id, cuentaId: reutilizada.cuenta_id, ...o }, {
            accion: 'sesion_revocada_por_reutilizacion',
            entidad: 'sesion',
            entidadId: reutilizada.id,
          }),
        );
      }
      throw noAutenticado();
    }

    const { rows } = await sql<{ sesion_activa: boolean; usuario_activo: boolean; empresa_activa: boolean }>`
      SELECT * FROM auth_estado_sesion(${rotada.id}::uuid)`.execute(this.db.k);
    const estado = rows[0];
    if (!estado?.usuario_activo || !estado.empresa_activa) {
      await this.revocarSesion(rotada.id, 'usuario_o_empresa_inactivo');
      throw noAutenticado();
    }

    return {
      tipo: 'sesion',
      accessToken: await this.tokens.firmarAcceso({
        sub: rotada.usuario_id,
        cta: rotada.cuenta_id,
        emp: rotada.empresa_id,
        sid: rotada.id,
      }),
      expiraEn: DURACION_ACCESO_S,
      refreshToken: nuevo,
      empresaId: rotada.empresa_id,
    };
  }

  async cerrarPorToken(refreshToken: string): Promise<void> {
    await this.db.k
      .updateTable('sesion')
      .set({ revocada_en: new Date(), motivo_revocacion: 'cierre' })
      .where('hash_token', '=', sha256(refreshToken))
      .where('revocada_en', 'is', null)
      .execute();
  }

  async revocarSesion(sesionId: string, motivo: string): Promise<void> {
    await this.db.k
      .updateTable('sesion')
      .set({ revocada_en: new Date(), motivo_revocacion: motivo })
      .where('id', '=', sesionId)
      .where('revocada_en', 'is', null)
      .execute();
  }

  async revocarTodas(cuentaId: string, motivo: string, salvo?: string): Promise<void> {
    let q = this.db.k
      .updateTable('sesion')
      .set({ revocada_en: new Date(), motivo_revocacion: motivo })
      .where('cuenta_id', '=', cuentaId)
      .where('revocada_en', 'is', null);
    if (salvo) q = q.where('id', '!=', salvo);
    await q.execute();
  }

  // -------------------------------------------------------------------------
  // Sesiones activas
  // -------------------------------------------------------------------------

  async sesiones(ctx: Ctx) {
    const nombres = new Map((await this.membresias(ctx.cuentaId)).map((m) => [m.empresa_id, m.empresa_nombre]));
    const filas = await this.db.k
      .selectFrom('sesion')
      .select(['id', 'empresa_id', 'ip', 'agente', 'creado_en', 'ultimo_uso_en', 'expira_en'])
      .where('cuenta_id', '=', ctx.cuentaId)
      .where('revocada_en', 'is', null)
      .where('expira_en', '>', new Date())
      .orderBy('ultimo_uso_en', 'desc')
      .execute();
    return filas.map((s) => ({
      id: s.id,
      empresa: nombres.get(s.empresa_id) ?? null,
      ip: s.ip,
      agente: s.agente,
      creadoEn: s.creado_en,
      ultimoUsoEn: s.ultimo_uso_en,
      actual: s.id === ctx.sesionId,
    }));
  }

  async cerrarSesionDeCuenta(ctx: Ctx, sesionId: string, o: Origen): Promise<void> {
    const r = await this.db.k
      .updateTable('sesion')
      .set({ revocada_en: new Date(), motivo_revocacion: 'cierre_remoto' })
      .where('id', '=', sesionId)
      .where('cuenta_id', '=', ctx.cuentaId)
      .where('revocada_en', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (!r) throw new ErrorNegocio(HttpStatus.NOT_FOUND, 'NO_ENCONTRADO', 'Sesión no encontrada');
    await this.db.enEmpresa(ctx.empresaId, (tx) =>
      auditar(tx, { ...ctx, ...o }, { accion: 'cierre_remoto', entidad: 'sesion', entidadId: sesionId }),
    );
  }

  // -------------------------------------------------------------------------
  // Contraseñas
  // -------------------------------------------------------------------------

  async cambiarContrasena(ctx: Ctx, actual: string, nueva: string, o: Origen): Promise<void> {
    const cuenta = await this.db.k
      .selectFrom('cuenta')
      .select(['hash_contrasena'])
      .where('id', '=', ctx.cuentaId)
      .executeTakeFirstOrThrow();
    if (!cuenta.hash_contrasena || !(await verificar(cuenta.hash_contrasena, actual))) {
      throw invalido('La contraseña actual no es correcta');
    }
    await this.db.k.updateTable('cuenta').set({ hash_contrasena: await hashear(nueva) }).where('id', '=', ctx.cuentaId).execute();
    await this.revocarTodas(ctx.cuentaId, 'cambio_contrasena', ctx.sesionId);
    await this.db.enEmpresa(ctx.empresaId, (tx) =>
      auditar(tx, { ...ctx, ...o }, { accion: 'cambio_contrasena', entidad: 'cuenta', entidadId: ctx.cuentaId }),
    );
  }

  /** Siempre responde igual, exista o no la cuenta. */
  async solicitarRecuperacion(email: string, o: Origen): Promise<void> {
    const cuenta = await this.db.k.selectFrom('cuenta').select(['id', 'nombre']).where('email', '=', email).executeTakeFirst();
    await this.registrarIntento(email, cuenta?.id ?? null, true, 'recuperacion_solicitada', o);
    if (!cuenta) return;
    const token = await this.emitirTokenCuenta(cuenta.id, 'recuperacion');
    await this.correo.enviar({
      para: email,
      asunto: 'KONTIVA ERP · Restablecer contraseña',
      texto:
        `Hola ${cuenta.nombre}:\n\nPara crear una contraseña nueva, abra este enlace (válido ${DURACION_RECUPERACION_MIN} minutos):\n` +
        `${config().WEB_URL}/restablecer?token=${token}\n\nSi no lo pidió, ignore este mensaje: su contraseña no cambia.\n\n` +
        `KONTIVA ERP · Desarrollado por Araújo Tech Sistemas`,
    });
  }

  async emitirTokenCuenta(cuentaId: string, tipo: 'recuperacion' | 'invitacion'): Promise<string> {
    const token = tokenAleatorio();
    const vence =
      tipo === 'recuperacion'
        ? new Date(Date.now() + DURACION_RECUPERACION_MIN * 60000)
        : new Date(Date.now() + DURACION_INVITACION_DIAS * 86400000);
    // Un token nuevo invalida los anteriores del mismo tipo.
    await this.db.k
      .updateTable('token_cuenta')
      .set({ usado_en: new Date() })
      .where('cuenta_id', '=', cuentaId)
      .where('tipo', '=', tipo)
      .where('usado_en', 'is', null)
      .execute();
    await this.db.k
      .insertInto('token_cuenta')
      .values({ cuenta_id: cuentaId, tipo, hash_token: sha256(token), expira_en: vence })
      .execute();
    return token;
  }

  /** Restablecer contraseña o aceptar invitación. Cierra todas las sesiones de la cuenta. */
  async restablecer(token: string, contrasena: string, o: Origen): Promise<void> {
    const usado = await this.db.k
      .updateTable('token_cuenta')
      .set({ usado_en: new Date() })
      .where('hash_token', '=', sha256(token))
      .where('usado_en', 'is', null)
      .where('expira_en', '>', new Date())
      .returning(['cuenta_id', 'tipo'])
      .executeTakeFirst();
    if (!usado) {
      throw new ErrorNegocio(HttpStatus.BAD_REQUEST, 'ENLACE_INVALIDO', 'El enlace no es válido o ya venció. Solicite uno nuevo.');
    }
    await this.db.k
      .updateTable('cuenta')
      .set({ hash_contrasena: await hashear(contrasena), intentos_fallidos: 0, bloqueada_hasta: null })
      .where('id', '=', usado.cuenta_id)
      .execute();
    await this.revocarTodas(usado.cuenta_id, 'restablecimiento');
    await this.registrarIntento(null, usado.cuenta_id, true, usado.tipo === 'invitacion' ? 'invitacion_aceptada' : 'contrasena_restablecida', o);
  }

  // -------------------------------------------------------------------------
  // PIN y autorización en el momento (PDV)
  // -------------------------------------------------------------------------

  async definirPin(ctx: Ctx, pin: string, contrasena: string, o: Origen): Promise<void> {
    const cuenta = await this.db.k.selectFrom('cuenta').select('hash_contrasena').where('id', '=', ctx.cuentaId).executeTakeFirstOrThrow();
    if (!cuenta.hash_contrasena || !(await verificar(cuenta.hash_contrasena, contrasena))) {
      throw invalido('La contraseña no es correcta');
    }
    await this.db.enEmpresa(ctx.empresaId, async (tx) => {
      await tx
        .updateTable('usuario')
        .set({ hash_pin: await hashear(pin), intentos_pin: 0, pin_bloqueado_hasta: null })
        .where('id', '=', ctx.usuarioId)
        .execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'definir_pin', entidad: 'usuario', entidadId: ctx.usuarioId });
    });
  }

  /**
   * Un supervisor autoriza con su PIN una acción del cajero sin cerrar la sesión del cajero.
   * Devuelve un token de un solo propósito (2 min) que el endpoint protegido verificará.
   */
  async autorizar(ctx: Ctx, supervisorId: string, pin: string, permiso: string, motivo: string | undefined, o: Origen) {
    // Los rechazos se devuelven (no se lanzan) dentro de la transacción: así el contador de
    // intentos y el registro de auditoría se confirman aunque la autorización falle.
    type Resultado =
      | { tipo: 'ok'; supervisor: { id: string; nombre: string } }
      | { tipo: 'rechazo' }
      | { tipo: 'bloqueado' };

    const r = await this.db.enEmpresa(ctx.empresaId, async (tx): Promise<Resultado> => {
      const sup = await tx
        .selectFrom('usuario')
        .select(['id', 'nombre', 'activo', 'hash_pin', 'intentos_pin', 'pin_bloqueado_hasta'])
        .where('id', '=', supervisorId)
        .forUpdate()
        .executeTakeFirst();
      if (!sup || !sup.activo || !sup.hash_pin) return { tipo: 'rechazo' };
      if (sup.pin_bloqueado_hasta && sup.pin_bloqueado_hasta > new Date()) return { tipo: 'bloqueado' };

      if (!(await verificar(sup.hash_pin, pin))) {
        const intentos = sup.intentos_pin + 1;
        const bloquear = intentos >= INTENTOS_PIN;
        await tx
          .updateTable('usuario')
          .set({
            intentos_pin: bloquear ? 0 : intentos,
            pin_bloqueado_hasta: bloquear ? new Date(Date.now() + BLOQUEO_PIN_MIN * 60000) : null,
          })
          .where('id', '=', sup.id)
          .execute();
        await auditar(tx, { ...ctx, ...o }, {
          accion: 'autorizacion_rechazada',
          entidad: 'permiso',
          entidadId: permiso,
          despues: { supervisor: sup.id, motivo: bloquear ? 'pin_incorrecto_bloqueado' : 'pin_incorrecto' },
        });
        return { tipo: 'rechazo' };
      }

      const efectivos = await cargarPermisos(tx, sup.id);
      if (!efectivos?.permisos.has(permiso)) {
        await auditar(tx, { ...ctx, ...o }, {
          accion: 'autorizacion_rechazada',
          entidad: 'permiso',
          entidadId: permiso,
          despues: { supervisor: sup.id, motivo: 'sin_permiso' },
        });
        return { tipo: 'rechazo' };
      }

      await tx.updateTable('usuario').set({ intentos_pin: 0, pin_bloqueado_hasta: null }).where('id', '=', sup.id).execute();
      await auditar(tx, { ...ctx, ...o }, {
        accion: 'autorizacion_concedida',
        entidad: 'permiso',
        entidadId: permiso,
        autorizadoPor: sup.id,
        despues: { motivo: motivo ?? null },
      });
      return { tipo: 'ok', supervisor: { id: sup.id, nombre: sup.nombre } };
    });

    if (r.tipo === 'bloqueado') {
      throw new ErrorNegocio(HttpStatus.TOO_MANY_REQUESTS, 'PIN_BLOQUEADO', 'PIN bloqueado temporalmente por intentos fallidos');
    }
    if (r.tipo === 'rechazo') throw new ErrorNegocio(HttpStatus.FORBIDDEN, 'AUTORIZACION_RECHAZADA', 'Autorización rechazada');
    return {
      autorizacion: await this.tokens.firmarAutorizacion({ emp: ctx.empresaId, perm: permiso, sup: r.supervisor.id, sol: ctx.usuarioId }),
      autorizadoPor: r.supervisor,
    };
  }

  /** Para endpoints que aceptan autorización de supervisor (ej. cancelar venta en Fase 1). */
  async verificarAutorizacion(ctx: Ctx, token: string | undefined, permiso: string): Promise<string | null> {
    if (!token) return null;
    const c = await this.tokens.leerAutorizacion(token);
    if (!c || c.emp !== ctx.empresaId || c.perm !== permiso || c.sol !== ctx.usuarioId) return null;
    return c.sup;
  }

  // -------------------------------------------------------------------------

  private async registrarIntento(email: string | null, cuentaId: string | null, exito: boolean, motivo: string, o: Origen) {
    await this.db.k
      .insertInto('intento_acceso')
      .values({ email, cuenta_id: cuentaId, exito, motivo, ip: o.ip, agente: o.agente })
      .execute();
  }
}
