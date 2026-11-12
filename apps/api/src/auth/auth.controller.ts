import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  PERMISOS,
  RECURSOS,
  autorizarEntrada,
  cambiarContrasenaEntrada,
  cambiarEmpresaEntrada,
  elegirEmpresaEntrada,
  loginEntrada,
  pinEntrada,
  recuperarEntrada,
  restablecerEntrada,
} from '@kontiva/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Contexto, OrigenPeticion, type Ctx, type Origen } from '../comun/contexto';
import { Publico, SoloSesion } from '../comun/decoradores';
import { noAutenticado, prohibido } from '../comun/errores';
import { validar } from '../comun/validar';
import { config } from '../config';
import { Db } from '../db/database';
import { AuthService, DURACION_SESION_DIAS, type EleccionEmpresa, type SesionEmitida } from './auth.service';

export const COOKIE_RENOVACION = 'kontiva_rt';
const RUTA_COOKIE = '/api/auth';

/**
 * Los endpoints que leen la cookie de renovación exigen el encabezado X-Kontiva: 1.
 * Un sitio ajeno no puede enviarlo sin pasar por CORS (restringido a WEB_URL), lo que
 * cierra el CSRF aunque el navegador mande la cookie.
 */
function exigirEncabezadoCsrf(req: Request): void {
  if (req.headers['x-kontiva'] !== '1') throw prohibido('Falta el encabezado X-Kontiva');
}

function responderSesion(res: Response, s: SesionEmitida) {
  res.cookie(COOKIE_RENOVACION, s.refreshToken, {
    httpOnly: true,
    secure: config().NODE_ENV === 'production',
    sameSite: 'strict',
    path: RUTA_COOKIE,
    maxAge: DURACION_SESION_DIAS * 86400000,
  });
  return { tipo: 'sesion' as const, accessToken: s.accessToken, expiraEn: s.expiraEn, empresaId: s.empresaId };
}

function borrarCookie(res: Response) {
  res.clearCookie(COOKIE_RENOVACION, { path: RUTA_COOKIE, sameSite: 'strict', httpOnly: true, secure: config().NODE_ENV === 'production' });
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Publico()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @OrigenPeticion() o: Origen, @Res({ passthrough: true }) res: Response) {
    const d = validar(loginEntrada, body);
    const r: SesionEmitida | EleccionEmpresa = await this.auth.login(d.email, d.contrasena, d.empresaId, o);
    return r.tipo === 'sesion' ? responderSesion(res, r) : r;
  }

  @Publico()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('empresa')
  @HttpCode(200)
  async elegirEmpresa(@Body() body: unknown, @OrigenPeticion() o: Origen, @Res({ passthrough: true }) res: Response) {
    const d = validar(elegirEmpresaEntrada, body);
    return responderSesion(res, await this.auth.elegirEmpresa(d.ticket, d.empresaId, o));
  }

  @Publico()
  @Post('renovar')
  @HttpCode(200)
  async renovar(@Req() req: Request, @OrigenPeticion() o: Origen, @Res({ passthrough: true }) res: Response) {
    exigirEncabezadoCsrf(req);
    const token = req.cookies?.[COOKIE_RENOVACION] as string | undefined;
    if (!token) throw noAutenticado();
    try {
      return responderSesion(res, await this.auth.renovar(token, o));
    } catch (e) {
      borrarCookie(res);
      throw e;
    }
  }

  @Publico()
  @Post('cerrar')
  @HttpCode(204)
  async cerrar(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    exigirEncabezadoCsrf(req);
    const token = req.cookies?.[COOKIE_RENOVACION] as string | undefined;
    if (token) await this.auth.cerrarPorToken(token);
    borrarCookie(res);
  }

  @Publico()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('recuperar')
  @HttpCode(204)
  async recuperar(@Body() body: unknown, @OrigenPeticion() o: Origen) {
    await this.auth.solicitarRecuperacion(validar(recuperarEntrada, body).email, o);
  }

  @Publico()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('restablecer')
  @HttpCode(204)
  async restablecer(@Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(restablecerEntrada, body);
    await this.auth.restablecer(d.token, d.contrasena, o);
  }

  @SoloSesion()
  @Get('sesiones')
  sesiones(@Contexto() ctx: Ctx) {
    return this.auth.sesiones(ctx);
  }

  @SoloSesion()
  @Delete('sesiones/:id')
  @HttpCode(204)
  async cerrarSesion(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @OrigenPeticion() o: Origen) {
    await this.auth.cerrarSesionDeCuenta(ctx, id, o);
  }

  @SoloSesion()
  @Post('cambiar-empresa')
  @HttpCode(200)
  async cambiarEmpresa(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen, @Res({ passthrough: true }) res: Response) {
    return responderSesion(res, await this.auth.cambiarEmpresa(ctx, validar(cambiarEmpresaEntrada, body).empresaId, o));
  }

  @SoloSesion()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('contrasena')
  @HttpCode(204)
  async cambiarContrasena(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(cambiarContrasenaEntrada, body);
    await this.auth.cambiarContrasena(ctx, d.actual, d.nueva, o);
  }

  @SoloSesion()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Put('pin')
  @HttpCode(204)
  async definirPin(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(pinEntrada.extend({ contrasena: z.string().min(1).max(200) }), body);
    await this.auth.definirPin(ctx, d.pin, d.contrasena, o);
  }
}

@Controller()
export class CuentaController {
  constructor(
    private readonly auth: AuthService,
    private readonly db: Db,
  ) {}

  /** Quién soy: usuario, empresa, permisos efectivos y empresas a las que puedo cambiar. */
  @SoloSesion()
  @Get('me')
  async yo(@Contexto() ctx: Ctx) {
    const datos = await this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const u = await tx
        .selectFrom('usuario as u')
        .innerJoin('perfil as p', 'p.id', 'u.perfil_id')
        .select(['u.id', 'u.nombre', 'u.hash_pin', 'p.id as perfil_id', 'p.nombre as perfil_nombre'])
        .where('u.id', '=', ctx.usuarioId)
        .executeTakeFirstOrThrow();
      const e = await tx
        .selectFrom('empresa as e')
        .innerJoin('plan', 'plan.id', 'e.plan_id')
        .select(['e.id', 'e.razon_social', 'e.nombre_fantasia', 'e.ruc', 'e.rubro', 'plan.codigo as plan'])
        .executeTakeFirstOrThrow();
      // Sucursales donde opera: las asignadas; el Propietario, todas.
      let q = tx.selectFrom('sucursal').select(['id', 'codigo', 'nombre']).where('activa', '=', true);
      if (!ctx.esPropietario) {
        if (ctx.sucursalIds.length === 0) return { u, e, sucursales: [] };
        q = q.where('id', 'in', [...ctx.sucursalIds]);
      }
      const sucursales = await q.orderBy('codigo').execute();
      return { u, e, sucursales };
    });
    const cuenta = await this.db.k.selectFrom('cuenta').select(['email']).where('id', '=', ctx.cuentaId).executeTakeFirstOrThrow();
    const empresas = (await this.auth.membresias(ctx.cuentaId))
      .filter((m) => m.empresa_estado === 'activa')
      .map((m) => ({ id: m.empresa_id, nombre: m.empresa_nombre }));
    return {
      usuario: {
        id: datos.u.id,
        nombre: datos.u.nombre,
        email: cuenta.email,
        perfil: { id: datos.u.perfil_id, nombre: datos.u.perfil_nombre },
        esPropietario: ctx.esPropietario,
        tienePin: datos.u.hash_pin !== null,
      },
      empresa: {
        id: datos.e.id,
        nombre: datos.e.nombre_fantasia ?? datos.e.razon_social,
        razonSocial: datos.e.razon_social,
        ruc: datos.e.ruc,
        rubro: datos.e.rubro,
        plan: datos.e.plan,
      },
      sucursales: datos.sucursales,
      permisos: Object.fromEntries(ctx.permisos),
      empresas,
    };
  }

  /** Catálogo de permisos (para la pantalla de perfiles). */
  @SoloSesion()
  @Get('permisos')
  catalogo() {
    return {
      recursos: Object.entries(RECURSOS).map(([clave, r]) => ({
        clave,
        nombre: r.nombre,
        modulo: r.modulo,
        confidencial: 'confidencial' in r ? r.confidencial : false,
        acciones: r.acciones,
      })),
      permisos: PERMISOS,
    };
  }

  @SoloSesion()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('autorizaciones')
  @HttpCode(200)
  autorizar(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(autorizarEntrada, body);
    return this.auth.autorizar(ctx, d.usuarioId, d.pin, d.permiso, d.motivo, o);
  }
}
