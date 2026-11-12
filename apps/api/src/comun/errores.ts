import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

/** Error de negocio con código estable que el frontend puede interpretar. */
export class ErrorNegocio extends HttpException {
  constructor(estado: HttpStatus, codigo: string, mensaje: string, detalle?: unknown) {
    super({ codigo, mensaje, detalle }, estado);
    this.message = mensaje;
  }
}

export const noEncontrado = (que = 'Registro') =>
  new ErrorNegocio(HttpStatus.NOT_FOUND, 'NO_ENCONTRADO', `${que} no encontrado`);
export const prohibido = (mensaje = 'No tiene permiso para esta acción') =>
  new ErrorNegocio(HttpStatus.FORBIDDEN, 'SIN_PERMISO', mensaje);
export const conflicto = (codigo: string, mensaje: string) => new ErrorNegocio(HttpStatus.CONFLICT, codigo, mensaje);
export const invalido = (mensaje: string, detalle?: unknown) =>
  new ErrorNegocio(HttpStatus.BAD_REQUEST, 'DATOS_INVALIDOS', mensaje, detalle);
export const noAutenticado = (mensaje = 'Sesión no válida o vencida') =>
  new ErrorNegocio(HttpStatus.UNAUTHORIZED, 'NO_AUTENTICADO', mensaje);

interface ErrorPg {
  code?: string;
  constraint?: string;
  detail?: string;
}

/**
 * Traduce errores a respuestas uniformes { codigo, mensaje, detalle? }.
 * Los errores de base conocidos se mapean; el resto se registra y devuelve 500 sin detalles internos.
 */
@Catch()
export class FiltroErrores implements ExceptionFilter {
  private readonly log = new Logger('Errores');

  catch(e: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (e instanceof ZodError) {
      res.status(400).json({
        codigo: 'DATOS_INVALIDOS',
        mensaje: 'Revise los datos ingresados',
        detalle: e.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })),
      });
      return;
    }

    if (e instanceof HttpException) {
      const estado = e.getStatus();
      const cuerpo = e.getResponse();
      if (typeof cuerpo === 'object' && cuerpo && 'codigo' in cuerpo) {
        res.status(estado).json(cuerpo);
        return;
      }
      const codigos: Record<number, string> = {
        400: 'DATOS_INVALIDOS',
        401: 'NO_AUTENTICADO',
        403: 'SIN_PERMISO',
        404: 'NO_ENCONTRADO',
        413: 'DEMASIADO_GRANDE',
        429: 'DEMASIADAS_PETICIONES',
      };
      const mensajes: Record<number, string> = {
        404: 'Recurso no encontrado',
        429: 'Demasiadas peticiones. Espere un momento e intente de nuevo.',
      };
      res.status(estado).json({
        codigo: codigos[estado] ?? 'ERROR',
        mensaje: mensajes[estado] ?? (typeof cuerpo === 'string' ? cuerpo : e.message),
      });
      return;
    }

    const pg = e as ErrorPg;
    switch (pg.code) {
      case '23505':
        res.status(409).json({ codigo: 'DUPLICADO', mensaje: 'Ya existe un registro con esos datos', detalle: pg.constraint });
        return;
      case '23503':
        // Clave foránea: el registro referido no existe en esta empresa (RLS lo oculta).
        res.status(400).json({ codigo: 'REFERENCIA_INVALIDA', mensaje: 'Un dato referido no existe o está en uso', detalle: pg.constraint });
        return;
      case '23514':
      case '22P02':
        res.status(400).json({ codigo: 'DATOS_INVALIDOS', mensaje: 'Datos fuera del formato permitido', detalle: pg.constraint });
        return;
      case '42501':
        this.log.error(`Violación de privilegios en base: ${(e as Error).message}`);
        res.status(403).json({ codigo: 'SIN_PERMISO', mensaje: 'Operación no permitida' });
        return;
    }

    this.log.error(e instanceof Error ? e.stack ?? e.message : String(e));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ codigo: 'ERROR_INTERNO', mensaje: 'Error interno. Intente de nuevo.' });
  }
}
