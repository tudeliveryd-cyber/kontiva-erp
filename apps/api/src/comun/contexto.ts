import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Alcance } from '../db/tipos';

/** Identidad y permisos de quien hace la petición. Lo arma AuthGuard. */
export interface Ctx {
  empresaId: string;
  usuarioId: string;
  cuentaId: string;
  sesionId: string;
  esPropietario: boolean;
  /** código de permiso → alcance efectivo */
  permisos: ReadonlyMap<string, Alcance>;
  sucursalIds: readonly string[];
  ip: string | null;
  agente: string | null;
  /** Alcance del permiso exigido por el endpoint (@Requiere). */
  alcance?: Alcance;
}

export interface Origen {
  ip: string | null;
  agente: string | null;
}

export type RequestKontiva = Request & { ctx?: Ctx };

export function origenDe(req: Request): Origen {
  const agente = req.headers['user-agent'];
  return { ip: req.ip ?? null, agente: agente ? agente.slice(0, 300) : null };
}

export const Contexto = createParamDecorator((_: unknown, ec: ExecutionContext): Ctx => {
  const req = ec.switchToHttp().getRequest<RequestKontiva>();
  if (!req.ctx) throw new Error('Contexto no disponible: endpoint público usando @Contexto');
  return req.ctx;
});

export const OrigenPeticion = createParamDecorator((_: unknown, ec: ExecutionContext): Origen => {
  return origenDe(ec.switchToHttp().getRequest<Request>());
});

export function tiene(ctx: Ctx, permiso: string): boolean {
  return ctx.permisos.has(permiso);
}
