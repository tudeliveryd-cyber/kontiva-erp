import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  PERMISOS,
  RECURSOS,
  autorizarEntrada,
  codigoPermiso as codigoPermisoEsquema,
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
import { auditar } from '../comun/auditoria';
import { Contexto, OrigenPeticion, type Ctx, type Origen } from '../comun/contexto';
import { Publico, SoloSesion } from '../comun/decoradores';
import { noAutenticado, prohibido } from '../comun/errores';
import { validar } from '../comun/validar';
import { config } from '../config';
import { Db } from '../db/database';
import { cargarPermisos } from './permisos';
import { AuthService, DURACION_SESION_DIAS, type RespuestaLogin, type SesionEmitida } from './auth.service';

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
    const r: RespuestaLogin = await this.auth.login(d.email, d.contrasena, d.empresaId, o);
    return r.tipo === 'sesion' ? responderSesion(res, r) : r;
  }

  // ----- Segundo factor durante el inicio de sesión -----

  @Publico()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('2fa/verificar')
  @HttpCode(200)
  async verificar2fa(@Body() body: unknown, @OrigenPeticion() o: Origen, @Res({ passthrough: true }) res: Response) {
    const d = validar(z.object({ ticket: z.string().min(1), codigo: z.string().trim().min(6).max(20) }), body);
    const r = await this.auth.verificarSegundoFactor(d.ticket, d.codigo, o);
    return r.tipo === 'sesion' ? responderSesion(res, r) : r;
  }

  @Publico()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('2fa/enrolar')
  @HttpCode(200)
  enrolar(@Body() body: unknown) {
    return this.auth.iniciarEnrolamiento(validar(z.object({ ticket: z.string().min(1) }), body).ticket);
  }

  @Publico()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('2fa/enrolar/confirmar')
  @HttpCode(200)
  async confirmarEnrolamiento(@Body() body: unknown, @OrigenPeticion() o: Origen, @Res({ passthrough: true }) res: Response) {
    const d = validar(z.object({ ticket: z.string().min(1), codigo: z.string().trim().min(6).max(10) }), body);
    const r = await this.auth.confirmarEnrolamiento(d.ticket, d.codigo, o);
    return { codigosRespaldo: r.codigosRespaldo, siguiente: r.siguiente.tipo === 'sesion' ? responderSesion(res, r.siguiente) : r.siguiente };
  }

  // ----- Segundo factor con la sesión iniciada -----

  @SoloSesion()
  @Get('2fa')
  estado2fa(@Contexto() ctx: Ctx) {
    return this.auth.estado2fa(ctx);
  }

  @SoloSesion()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('2fa/iniciar')
  @HttpCode(200)
  iniciar2fa(@Contexto() ctx: Ctx, @Body() body: unknown) {
    return this.auth.iniciar2fa(ctx, validar(z.object({ contrasena: z.string().min(1).max(200) }), body).contrasena);
  }

  @SoloSesion()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('2fa/activar')
  @HttpCode(200)
  activar2fa(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    return this.auth.activar2fa(ctx, validar(z.object({ codigo: z.string().trim().min(6).max(10) }), body).codigo, o);
  }

  @SoloSesion()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('2fa/desactivar')
  @HttpCode(204)
  async desactivar2fa(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ contrasena: z.string().min(1).max(200), codigo: z.string().trim().min(6).max(20) }), body);
    await this.auth.desactivar2fa(ctx, d.contrasena, d.codigo, o);
  }

  @SoloSesion()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('2fa/codigos')
  @HttpCode(200)
  regenerarCodigos(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    return this.auth.regenerarCodigos(ctx, validar(z.object({ contrasena: z.string().min(1).max(200) }), body).contrasena, o);
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
    const cuenta = await this.db.k.selectFrom('cuenta').select(['email', 'idioma']).where('id', '=', ctx.cuentaId).executeTakeFirstOrThrow();
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
        idioma: cuenta.idioma,
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

  /** Idioma de la interfaz de la cuenta (vale en todas sus empresas). */
  @SoloSesion()
  @Put('idioma')
  @HttpCode(204)
  async idioma(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ idioma: z.enum(['es', 'pt']) }), body);
    await this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const antes = await tx.selectFrom('cuenta').select('idioma').where('id', '=', ctx.cuentaId).executeTakeFirstOrThrow();
      if (antes.idioma === d.idioma) return;
      await tx.updateTable('cuenta').set({ idioma: d.idioma }).where('id', '=', ctx.cuentaId).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'cambiar_idioma', entidad: 'cuenta', entidadId: ctx.cuentaId, antes, despues: { idioma: d.idioma } });
    });
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

  /** Quiénes pueden autorizar una acción con su PIN (solo nombres), para el diálogo del PDV. */
  @SoloSesion()
  @Get('autorizadores')
  async autorizadores(@Contexto() ctx: Ctx, @Query('permiso') permiso: string) {
    validar(codigoPermisoEsquema, permiso);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const candidatos = await tx.selectFrom('usuario').select(['id', 'nombre']).where('activo', '=', true).where('hash_pin', 'is not', null).where('id', '!=', ctx.usuarioId).orderBy('nombre').execute();
      const out: { id: string; nombre: string }[] = [];
      for (const c of candidatos) {
        const p = await cargarPermisos(tx, c.id);
        if (p?.permisos.has(permiso)) out.push(c);
      }
      return out;
    });
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
