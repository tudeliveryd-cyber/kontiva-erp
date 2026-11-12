import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { auditar } from '../comun/auditoria';
import type { Ctx, Origen } from '../comun/contexto';
import { Correo } from '../comun/correo';
import { ErrorNegocio, conflicto as conflictoNegocio, invalido, noAutenticado, prohibido } from '../comun/errores';
import { config } from '../config';
import { Db } from '../db/database';
import { cargarPermisos } from './permisos';
import { hashear, requiereRehash, sha256, tokenAleatorio, verificar, verificarSenuelo } from './cripto';
import { hashRespaldo, nuevoSecreto, nuevosCodigosRespaldo, pareceCodigoRespaldo, verificarTotp } from './segundo-factor';
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

export interface PasoSegundoFactor {
  tipo: 'segundo_factor' | 'configurar_segundo_factor';
  ticket: string;
}

export type RespuestaLogin = SesionEmitida | EleccionEmpresa | PasoSegundoFactor;

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

  async login(email: string, contrasena: string, empresaId: string | undefined, o: Origen): Promise<RespuestaLogin> {
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
    if (empresaId && !membresias.some((m) => m.empresa_id === empresaId)) throw prohibido('No tiene acceso a esa empresa');

    // Segundo factor: si la cuenta lo tiene, se pide el código; si su plan lo exige y no
    // lo configuró, debe configurarlo antes de entrar.
    if (cuenta.totp_activo) {
      await this.registrarIntento(email, cuenta.id, true, 'contrasena_ok_falta_2fa', o);
      return { tipo: 'segundo_factor', ticket: await this.tokens.firmarPreauth({ cta: cuenta.id, fase: 'mfa', emp: empresaId }) };
    }
    if (await this.requiere2fa(cuenta.id)) {
      await this.registrarIntento(email, cuenta.id, true, 'contrasena_ok_debe_configurar_2fa', o);
      return { tipo: 'configurar_segundo_factor', ticket: await this.tokens.firmarPreauth({ cta: cuenta.id, fase: 'enrolar', emp: empresaId }) };
    }

    await this.registrarIntento(email, cuenta.id, true, 'ok', o);
    return this.continuarLogin(cuenta.id, empresaId, o);
  }

  /** Credenciales completas: abre la sesión o pide elegir empresa. */
  private async continuarLogin(cuentaId: string, empresaId: string | undefined, o: Origen): Promise<SesionEmitida | EleccionEmpresa> {
    const membresias = (await this.membresias(cuentaId)).filter((m) => m.empresa_estado === 'activa');
    if (membresias.length === 0) throw prohibido('Su usuario no tiene acceso a ninguna empresa activa');
    let elegida: Membresia | undefined;
    if (empresaId) {
      elegida = membresias.find((m) => m.empresa_id === empresaId);
      if (!elegida) throw prohibido('No tiene acceso a esa empresa');
    } else if (membresias.length === 1) {
      elegida = membresias[0];
    }
    if (!elegida) {
      return {
        tipo: 'elegir_empresa',
        ticket: await this.tokens.firmarPreauth({ cta: cuentaId, fase: 'empresa' }),
        empresas: membresias.map((m) => ({ id: m.empresa_id, nombre: m.empresa_nombre })),
      };
    }
    return this.crearSesion(cuentaId, elegida, o);
  }

  async requiere2fa(cuentaId: string): Promise<boolean> {
    const { rows } = await sql<{ r: boolean }>`SELECT auth_requiere_2fa(${cuentaId}::uuid) AS r`.execute(this.db.k);
    return rows[0]?.r === true;
  }

  // -------------------------------------------------------------------------
  // Segundo factor durante el inicio de sesión
  // -------------------------------------------------------------------------

  private async leerTicket(ticket: string, fase: 'mfa' | 'enrolar' | 'empresa') {
    const c = await this.tokens.leerPreauth(ticket);
    if (!c || c.fase !== fase) throw noAutenticado('El tiempo para completar el ingreso venció. Inicie sesión de nuevo.');
    return c;
  }

  async verificarSegundoFactor(ticket: string, codigo: string, o: Origen): Promise<SesionEmitida | EleccionEmpresa> {
    const c = await this.leerTicket(ticket, 'mfa');
    const cuenta = await this.db.k
      .selectFrom('cuenta')
      .select(['id', 'email', 'totp_secreto', 'totp_activo', 'totp_ultimo_paso', 'intentos_fallidos', 'bloqueada_hasta'])
      .where('id', '=', c.cta)
      .executeTakeFirstOrThrow();
    if (cuenta.bloqueada_hasta && cuenta.bloqueada_hasta > new Date()) {
      throw new ErrorNegocio(HttpStatus.TOO_MANY_REQUESTS, 'CUENTA_BLOQUEADA', 'Demasiados intentos fallidos. Intente más tarde.');
    }
    if (!(await this.comprobarCodigo(cuenta, codigo))) {
      await this.registrarFallo(cuenta.id, cuenta.intentos_fallidos);
      await this.registrarIntento(cuenta.email, cuenta.id, false, 'codigo_2fa_incorrecto', o);
      throw new ErrorNegocio(HttpStatus.UNAUTHORIZED, 'CODIGO_INCORRECTO', 'Código incorrecto o vencido');
    }
    await this.db.k.updateTable('cuenta').set({ intentos_fallidos: 0, bloqueada_hasta: null }).where('id', '=', cuenta.id).execute();
    await this.registrarIntento(cuenta.email, cuenta.id, true, 'ok_2fa', o);
    return this.continuarLogin(cuenta.id, c.emp, o);
  }

  /** Alta del segundo factor obligatorio durante el inicio de sesión. */
  async iniciarEnrolamiento(ticket: string) {
    const c = await this.leerTicket(ticket, 'enrolar');
    return this.prepararSecreto(c.cta);
  }

  async confirmarEnrolamiento(ticket: string, codigo: string, o: Origen) {
    const c = await this.leerTicket(ticket, 'enrolar');
    const codigosRespaldo = await this.activarSecreto(c.cta, codigo);
    await this.registrarIntento(null, c.cta, true, 'ok_2fa_configurado', o);
    return { codigosRespaldo, siguiente: await this.continuarLogin(c.cta, c.emp, o) };
  }

  private async prepararSecreto(cuentaId: string) {
    const cuenta = await this.db.k.selectFrom('cuenta').select(['email', 'totp_activo']).where('id', '=', cuentaId).executeTakeFirstOrThrow();
    if (cuenta.totp_activo) throw conflictoNegocio('2FA_ACTIVO', 'El segundo factor ya está activo');
    const s = await nuevoSecreto(cuenta.email);
    await this.db.k.updateTable('cuenta').set({ totp_pendiente: s.cifrado }).where('id', '=', cuentaId).execute();
    return { secreto: s.secreto, uri: s.uri, qr: s.qr };
  }

  private async activarSecreto(cuentaId: string, codigo: string): Promise<string[]> {
    const cuenta = await this.db.k.selectFrom('cuenta').select(['totp_pendiente', 'totp_activo']).where('id', '=', cuentaId).executeTakeFirstOrThrow();
    if (cuenta.totp_activo) throw conflictoNegocio('2FA_ACTIVO', 'El segundo factor ya está activo');
    if (!cuenta.totp_pendiente) throw invalido('Primero genere el código QR');
    const paso = verificarTotp(cuenta.totp_pendiente, codigo, null);
    if (paso === null) throw invalido('Código incorrecto. Revise que la hora del teléfono sea automática.');
    await this.db.k
      .updateTable('cuenta')
      .set({ totp_secreto: cuenta.totp_pendiente, totp_pendiente: null, totp_activo: true, totp_ultimo_paso: paso })
      .where('id', '=', cuentaId)
      .execute();
    return this.reemplazarCodigosRespaldo(cuentaId);
  }

  private async reemplazarCodigosRespaldo(cuentaId: string): Promise<string[]> {
    await this.db.k.updateTable('codigo_respaldo').set({ usado_en: new Date() }).where('cuenta_id', '=', cuentaId).where('usado_en', 'is', null).execute();
    const { codigos, hashes } = nuevosCodigosRespaldo();
    await this.db.k.insertInto('codigo_respaldo').values(hashes.map((hash) => ({ cuenta_id: cuentaId, hash }))).execute();
    return codigos;
  }

  /** Acepta un código TOTP (no reutilizable) o un código de respaldo (de un solo uso). */
  private async comprobarCodigo(
    cuenta: { id: string; totp_secreto: string | null; totp_activo: boolean; totp_ultimo_paso: string | null },
    codigo: string,
  ): Promise<boolean> {
    if (!cuenta.totp_activo || !cuenta.totp_secreto) return false;
    if (pareceCodigoRespaldo(codigo)) {
      const usado = await this.db.k
        .updateTable('codigo_respaldo')
        .set({ usado_en: new Date() })
        .where('cuenta_id', '=', cuenta.id)
        .where('hash', '=', hashRespaldo(codigo))
        .where('usado_en', 'is', null)
        .returning('id')
        .executeTakeFirst();
      return Boolean(usado);
    }
    const paso = verificarTotp(cuenta.totp_secreto, codigo, cuenta.totp_ultimo_paso === null ? null : Number(cuenta.totp_ultimo_paso));
    if (paso === null) return false;
    // Condición en el UPDATE: dos peticiones simultáneas con el mismo código no pasan ambas.
    const r = await this.db.k
      .updateTable('cuenta')
      .set({ totp_ultimo_paso: paso })
      .where('id', '=', cuenta.id)
      .where((eb) => eb.or([eb('totp_ultimo_paso', 'is', null), eb('totp_ultimo_paso', '<', paso as unknown as string)]))
      .returning('id')
      .executeTakeFirst();
    return Boolean(r);
  }

  private async registrarFallo(cuentaId: string, previos: number) {
    const intentos = previos + 1;
    const bloqueo =
      intentos >= INTENTOS_ANTES_DE_BLOQUEO
        ? new Date(Date.now() + Math.min(2 ** (intentos - INTENTOS_ANTES_DE_BLOQUEO), BLOQUEO_MAX_MIN) * 60000)
        : null;
    await this.db.k.updateTable('cuenta').set({ intentos_fallidos: intentos, bloqueada_hasta: bloqueo }).where('id', '=', cuentaId).execute();
  }

  // -------------------------------------------------------------------------
  // Segundo factor con la sesión iniciada (Mi cuenta)
  // -------------------------------------------------------------------------

  async estado2fa(ctx: Ctx) {
    const c = await this.db.k.selectFrom('cuenta').select(['totp_activo']).where('id', '=', ctx.cuentaId).executeTakeFirstOrThrow();
    const restantes = await this.db.k
      .selectFrom('codigo_respaldo')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('cuenta_id', '=', ctx.cuentaId)
      .where('usado_en', 'is', null)
      .executeTakeFirstOrThrow();
    return { activo: c.totp_activo, obligatorio: await this.requiere2fa(ctx.cuentaId), codigosRestantes: c.totp_activo ? Number(restantes.n) : 0 };
  }

  private async exigirContrasena(cuentaId: string, contrasena: string) {
    const c = await this.db.k.selectFrom('cuenta').select('hash_contrasena').where('id', '=', cuentaId).executeTakeFirstOrThrow();
    if (!c.hash_contrasena || !(await verificar(c.hash_contrasena, contrasena))) throw invalido('La contraseña no es correcta');
  }

  async iniciar2fa(ctx: Ctx, contrasena: string) {
    await this.exigirContrasena(ctx.cuentaId, contrasena);
    return this.prepararSecreto(ctx.cuentaId);
  }

  async activar2fa(ctx: Ctx, codigo: string, o: Origen) {
    const codigos = await this.activarSecreto(ctx.cuentaId, codigo);
    await this.db.enEmpresa(ctx.empresaId, (tx) => auditar(tx, { ...ctx, ...o }, { accion: 'activar_2fa', entidad: 'cuenta', entidadId: ctx.cuentaId }));
    return { codigosRespaldo: codigos };
  }

  async desactivar2fa(ctx: Ctx, contrasena: string, codigo: string, o: Origen) {
    await this.exigirContrasena(ctx.cuentaId, contrasena);
    if (await this.requiere2fa(ctx.cuentaId)) throw prohibido('Su plan exige el segundo factor para el Propietario');
    const cuenta = await this.db.k
      .selectFrom('cuenta')
      .select(['id', 'totp_secreto', 'totp_activo', 'totp_ultimo_paso'])
      .where('id', '=', ctx.cuentaId)
      .executeTakeFirstOrThrow();
    if (!(await this.comprobarCodigo(cuenta, codigo))) throw invalido('Código incorrecto');
    await this.db.k
      .updateTable('cuenta')
      .set({ totp_activo: false, totp_secreto: null, totp_pendiente: null, totp_ultimo_paso: null })
      .where('id', '=', ctx.cuentaId)
      .execute();
    await this.db.k.updateTable('codigo_respaldo').set({ usado_en: new Date() }).where('cuenta_id', '=', ctx.cuentaId).where('usado_en', 'is', null).execute();
    await this.db.enEmpresa(ctx.empresaId, (tx) => auditar(tx, { ...ctx, ...o }, { accion: 'desactivar_2fa', entidad: 'cuenta', entidadId: ctx.cuentaId }));
  }

  async regenerarCodigos(ctx: Ctx, contrasena: string, o: Origen) {
    await this.exigirContrasena(ctx.cuentaId, contrasena);
    const c = await this.db.k.selectFrom('cuenta').select('totp_activo').where('id', '=', ctx.cuentaId).executeTakeFirstOrThrow();
    if (!c.totp_activo) throw invalido('El segundo factor no está activo');
    const codigos = await this.reemplazarCodigosRespaldo(ctx.cuentaId);
    await this.db.enEmpresa(ctx.empresaId, (tx) => auditar(tx, { ...ctx, ...o }, { accion: 'regenerar_codigos_2fa', entidad: 'cuenta', entidadId: ctx.cuentaId }));
    return { codigosRespaldo: codigos };
  }

  /** Segundo paso cuando la cuenta pertenece a varias empresas. */
  async elegirEmpresa(ticket: string, empresaId: string, o: Origen): Promise<SesionEmitida> {
    const claims = await this.leerTicket(ticket, 'empresa');
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
