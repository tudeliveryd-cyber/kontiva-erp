import {
  Body,
  CanActivate,
  Controller,
  createParamDecorator,
  ExecutionContext,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Throttle } from '@nestjs/throttler';
import { contrasena as esquemaContrasena, email as esquemaEmail } from '@kontiva/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { hashear, sha256, tokenAleatorio, verificar, verificarSenuelo } from '../auth/cripto';
import { nuevoSecreto, verificarTotp } from '../auth/segundo-factor';
import { DURACION_ACCESO_S, Tokens } from '../auth/tokens';
import { origenDe, OrigenPeticion, type Origen } from '../comun/contexto';
import { META_PUBLICO, Publico } from '../comun/decoradores';
import { ErrorNegocio, invalido, noAutenticado, prohibido } from '../comun/errores';
import { validar } from '../comun/validar';
import { config } from '../config';
import { Db } from '../db/database';
import { auditarMaster } from './master-auditoria';

/** Quién opera en el Panel Master. */
export interface CtxMaster {
  usuarioId: string;
  sesionId: string;
  nombre: string;
  ip: string | null;
  agente: string | null;
}

type RequestMaster = Request & { master?: CtxMaster };

export const ContextoMaster = createParamDecorator((_: unknown, ec: ExecutionContext): CtxMaster => {
  const req = ec.switchToHttp().getRequest<RequestMaster>();
  if (!req.master) throw new Error('Contexto master no disponible');
  return req.master;
});

const DURACION_SESION_H = 12;
const COOKIE = 'kontiva_mrt';
const RUTA_COOKIE = '/api/master/auth';

/**
 * Guard del Panel Master: token firmado con el secreto master, sesión viva y usuario activo.
 * Las sesiones solo se crean después del segundo factor.
 */
@Injectable()
export class MasterGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: Tokens,
    private readonly db: Db,
  ) {}

  async canActivate(ec: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(META_PUBLICO, [ec.getHandler(), ec.getClass()])) return true;
    const req = ec.switchToHttp().getRequest<RequestMaster>();
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw noAutenticado();
    const c = await this.tokens.leerMaster(h.slice(7));
    if (!c) throw noAutenticado();
    const s = await this.db.k
      .selectFrom('master.sesion as s')
      .innerJoin('master.usuario as u', 'u.id', 's.usuario_id')
      .select(['u.nombre', 'u.activo'])
      .where('s.id', '=', c.sid)
      .where('s.usuario_id', '=', c.sub)
      .where('s.revocada_en', 'is', null)
      .where('s.expira_en', '>', new Date())
      .executeTakeFirst();
    if (!s?.activo) throw noAutenticado();
    req.master = { usuarioId: c.sub, sesionId: c.sid, nombre: s.nombre, ...origenDe(req) };
    return true;
  }
}

interface Ticket {
  cta: string;
  fase: 'mfa' | 'enrolar' | 'empresa';
}

@Injectable()
export class MasterAuthService {
  constructor(
    private readonly db: Db,
    private readonly tokens: Tokens,
  ) {}

  /** La contraseña sola nunca abre sesión: siempre sigue el segundo factor (o su alta). */
  async login(email: string, clave: string, o: Origen) {
    const u = await this.db.k.selectFrom('master.usuario').selectAll().where('email', '=', email).executeTakeFirst();
    const invalidas = () => new ErrorNegocio(HttpStatus.UNAUTHORIZED, 'CREDENCIALES_INVALIDAS', 'Correo o contraseña incorrectos');
    if (!u || !u.activo) {
      await verificarSenuelo(clave);
      throw invalidas();
    }
    if (u.bloqueada_hasta && u.bloqueada_hasta > new Date()) {
      throw new ErrorNegocio(HttpStatus.TOO_MANY_REQUESTS, 'CUENTA_BLOQUEADA', 'Demasiados intentos fallidos. Intente más tarde.');
    }
    if (!(await verificar(u.hash_contrasena, clave))) {
      await this.fallo(u.id, u.intentos_fallidos);
      await auditarMaster(this.db.k, { usuarioId: u.id, ...o }, { accion: 'login_fallido', entidad: 'usuario_master', entidadId: u.id });
      throw invalidas();
    }
    await this.db.k.updateTable('master.usuario').set({ intentos_fallidos: 0, bloqueada_hasta: null }).where('id', '=', u.id).execute();
    const fase = u.totp_activo ? 'mfa' : 'enrolar';
    return {
      tipo: u.totp_activo ? ('segundo_factor' as const) : ('configurar_segundo_factor' as const),
      ticket: await this.tokens.firmarPreauth({ cta: u.id, fase }),
    };
  }

  private async ticket(t: string, fase: Ticket['fase']): Promise<Ticket> {
    const c = await this.tokens.leerPreauth(t);
    if (!c || c.fase !== fase) throw noAutenticado('El tiempo para completar el ingreso venció. Inicie sesión de nuevo.');
    return c;
  }

  private async fallo(id: string, previos: number) {
    const n = previos + 1;
    await this.db.k
      .updateTable('master.usuario')
      .set({ intentos_fallidos: n, bloqueada_hasta: n >= 5 ? new Date(Date.now() + Math.min(2 ** (n - 5), 60) * 60000) : null })
      .where('id', '=', id)
      .execute();
  }

  async enrolar(t: string) {
    const c = await this.ticket(t, 'enrolar');
    const u = await this.db.k.selectFrom('master.usuario').select(['email']).where('id', '=', c.cta).executeTakeFirstOrThrow();
    const s = await nuevoSecreto(u.email, 'KONTIVA Master');
    await this.db.k.updateTable('master.usuario').set({ totp_pendiente: s.cifrado }).where('id', '=', c.cta).execute();
    return { secreto: s.secreto, uri: s.uri, qr: s.qr };
  }

  async confirmarEnrolamiento(t: string, codigo: string, o: Origen) {
    const c = await this.ticket(t, 'enrolar');
    const u = await this.db.k.selectFrom('master.usuario').select(['totp_pendiente']).where('id', '=', c.cta).executeTakeFirstOrThrow();
    if (!u.totp_pendiente) throw invalido('Primero genere el código QR');
    const paso = verificarTotp(u.totp_pendiente, codigo, null);
    if (paso === null) throw invalido('Código incorrecto. Revise que la hora del teléfono sea automática.');
    await this.db.k
      .updateTable('master.usuario')
      .set({ totp_secreto: u.totp_pendiente, totp_pendiente: null, totp_activo: true, totp_ultimo_paso: paso })
      .where('id', '=', c.cta)
      .execute();
    await auditarMaster(this.db.k, { usuarioId: c.cta, ...o }, { accion: 'activar_2fa', entidad: 'usuario_master', entidadId: c.cta });
    return this.crearSesion(c.cta, o);
  }

  async verificar(t: string, codigo: string, o: Origen) {
    const c = await this.ticket(t, 'mfa');
    const u = await this.db.k
      .selectFrom('master.usuario')
      .select(['id', 'totp_secreto', 'totp_ultimo_paso', 'intentos_fallidos', 'bloqueada_hasta'])
      .where('id', '=', c.cta)
      .executeTakeFirstOrThrow();
    if (u.bloqueada_hasta && u.bloqueada_hasta > new Date()) {
      throw new ErrorNegocio(HttpStatus.TOO_MANY_REQUESTS, 'CUENTA_BLOQUEADA', 'Demasiados intentos fallidos. Intente más tarde.');
    }
    const paso = u.totp_secreto ? verificarTotp(u.totp_secreto, codigo, u.totp_ultimo_paso === null ? null : Number(u.totp_ultimo_paso)) : null;
    const ok =
      paso !== null &&
      (await this.db.k
        .updateTable('master.usuario')
        .set({ totp_ultimo_paso: paso, intentos_fallidos: 0, bloqueada_hasta: null })
        .where('id', '=', u.id)
        .where((eb) => eb.or([eb('totp_ultimo_paso', 'is', null), eb('totp_ultimo_paso', '<', paso as unknown as string)]))
        .returning('id')
        .executeTakeFirst());
    if (!ok) {
      await this.fallo(u.id, u.intentos_fallidos);
      throw new ErrorNegocio(HttpStatus.UNAUTHORIZED, 'CODIGO_INCORRECTO', 'Código incorrecto o vencido');
    }
    return this.crearSesion(u.id, o);
  }

  private async crearSesion(usuarioId: string, o: Origen) {
    const refresh = tokenAleatorio();
    const s = await this.db.k
      .insertInto('master.sesion')
      .values({ usuario_id: usuarioId, hash_token: sha256(refresh), ip: o.ip, agente: o.agente, expira_en: new Date(Date.now() + DURACION_SESION_H * 3600000) })
      .returning('id')
      .executeTakeFirstOrThrow();
    await auditarMaster(this.db.k, { usuarioId, ...o }, { accion: 'inicio_sesion', entidad: 'sesion_master', entidadId: s.id });
    return { accessToken: await this.tokens.firmarMaster({ sub: usuarioId, sid: s.id }), expiraEn: DURACION_ACCESO_S, refresh };
  }

  async renovar(refresh: string, o: Origen) {
    const h = sha256(refresh);
    const nuevo = tokenAleatorio();
    const s = await this.db.k
      .updateTable('master.sesion')
      .set({ hash_token: sha256(nuevo), hash_token_anterior: h, ultimo_uso_en: new Date(), ip: o.ip, agente: o.agente })
      .where('hash_token', '=', h)
      .where('revocada_en', 'is', null)
      .where('expira_en', '>', new Date())
      .returning(['id', 'usuario_id'])
      .executeTakeFirst();
    if (!s) {
      await this.db.k.updateTable('master.sesion').set({ revocada_en: new Date() }).where('hash_token_anterior', '=', h).where('revocada_en', 'is', null).execute();
      throw noAutenticado();
    }
    const u = await this.db.k.selectFrom('master.usuario').select('activo').where('id', '=', s.usuario_id).executeTakeFirstOrThrow();
    if (!u.activo) throw noAutenticado();
    return { accessToken: await this.tokens.firmarMaster({ sub: s.usuario_id, sid: s.id }), expiraEn: DURACION_ACCESO_S, refresh: nuevo };
  }

  async cerrar(refresh: string) {
    await this.db.k.updateTable('master.sesion').set({ revocada_en: new Date() }).where('hash_token', '=', sha256(refresh)).execute();
  }

  async cambiarContrasena(ctx: CtxMaster, actual: string, nueva: string) {
    const u = await this.db.k.selectFrom('master.usuario').select('hash_contrasena').where('id', '=', ctx.usuarioId).executeTakeFirstOrThrow();
    if (!(await verificar(u.hash_contrasena, actual))) throw invalido('La contraseña actual no es correcta');
    await this.db.k.updateTable('master.usuario').set({ hash_contrasena: await hashear(nueva) }).where('id', '=', ctx.usuarioId).execute();
    await this.db.k.updateTable('master.sesion').set({ revocada_en: new Date() }).where('usuario_id', '=', ctx.usuarioId).where('id', '!=', ctx.sesionId).where('revocada_en', 'is', null).execute();
    await auditarMaster(this.db.k, ctx, { accion: 'cambio_contrasena', entidad: 'usuario_master', entidadId: ctx.usuarioId });
  }
}

function conCookie(res: Response, r: { accessToken: string; expiraEn: number; refresh: string }) {
  res.cookie(COOKIE, r.refresh, {
    httpOnly: true,
    secure: config().NODE_ENV === 'production',
    sameSite: 'strict',
    path: RUTA_COOKIE,
    maxAge: DURACION_SESION_H * 3600000,
  });
  return { tipo: 'sesion' as const, accessToken: r.accessToken, expiraEn: r.expiraEn };
}

function csrf(req: Request) {
  if (req.headers['x-kontiva'] !== '1') throw prohibido('Falta el encabezado X-Kontiva');
}

const ticketYCodigo = z.object({ ticket: z.string().min(1), codigo: z.string().trim().min(6).max(10) });

@Controller('auth')
export class MasterAuthController {
  constructor(private readonly auth: MasterAuthService) {}

  @Publico()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ email: esquemaEmail, contrasena: z.string().min(1).max(200) }), body);
    return this.auth.login(d.email, d.contrasena, o);
  }

  @Publico()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('2fa/enrolar')
  @HttpCode(200)
  enrolar(@Body() body: unknown) {
    return this.auth.enrolar(validar(z.object({ ticket: z.string().min(1) }), body).ticket);
  }

  @Publico()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('2fa/enrolar/confirmar')
  @HttpCode(200)
  async confirmar(@Body() body: unknown, @OrigenPeticion() o: Origen, @Res({ passthrough: true }) res: Response) {
    const d = validar(ticketYCodigo, body);
    return conCookie(res, await this.auth.confirmarEnrolamiento(d.ticket, d.codigo, o));
  }

  @Publico()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('2fa/verificar')
  @HttpCode(200)
  async verificar(@Body() body: unknown, @OrigenPeticion() o: Origen, @Res({ passthrough: true }) res: Response) {
    const d = validar(ticketYCodigo, body);
    return conCookie(res, await this.auth.verificar(d.ticket, d.codigo, o));
  }

  @Publico()
  @Post('renovar')
  @HttpCode(200)
  async renovar(@Req() req: Request, @OrigenPeticion() o: Origen, @Res({ passthrough: true }) res: Response) {
    csrf(req);
    const t = req.cookies?.[COOKIE] as string | undefined;
    if (!t) throw noAutenticado();
    return conCookie(res, await this.auth.renovar(t, o));
  }

  @Publico()
  @Post('cerrar')
  @HttpCode(204)
  async cerrar(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    csrf(req);
    const t = req.cookies?.[COOKIE] as string | undefined;
    if (t) await this.auth.cerrar(t);
    res.clearCookie(COOKIE, { path: RUTA_COOKIE });
  }

  @Get('me')
  me(@ContextoMaster() ctx: CtxMaster) {
    return { id: ctx.usuarioId, nombre: ctx.nombre };
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('contrasena')
  @HttpCode(204)
  async contrasena(@ContextoMaster() ctx: CtxMaster, @Body() body: unknown) {
    const d = validar(z.object({ actual: z.string().min(1).max(200), nueva: esquemaContrasena.min(12, 'Mínimo 12 caracteres en el Panel Master') }), body);
    await this.auth.cambiarContrasena(ctx, d.actual, d.nueva);
  }
}
