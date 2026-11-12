import { Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify, errors } from 'jose';
import { config } from '../config';

const EMISOR = 'kontiva';

export const DURACION_ACCESO_S = 15 * 60;
export const DURACION_PREAUTH_S = 5 * 60;
export const DURACION_AUTORIZACION_S = 2 * 60;

export interface ClaimsAcceso {
  sub: string; // usuario_id
  cta: string; // cuenta_id
  emp: string; // empresa_id
  sid: string; // sesion_id
}

export interface ClaimsPreauth {
  cta: string;
}

export interface ClaimsAutorizacion {
  emp: string;
  perm: string;
  sup: string; // usuario que autorizó
  sol: string; // usuario que solicitó
}

type Tipo = 'acc' | 'pre' | 'aut';

/** Tokens firmados (HS256). El tipo va en `typ` para que un token no sirva en lugar de otro. */
@Injectable()
export class Tokens {
  private readonly clave = new TextEncoder().encode(config().JWT_SECRET);

  private async firmar(tipo: Tipo, datos: Record<string, string>, segundos: number): Promise<string> {
    return new SignJWT({ ...datos, typ: tipo })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(EMISOR)
      .setIssuedAt()
      .setExpirationTime(`${segundos}s`)
      .sign(this.clave);
  }

  private async leer<T>(tipo: Tipo, token: string): Promise<T | null> {
    try {
      const { payload } = await jwtVerify(token, this.clave, { issuer: EMISOR, algorithms: ['HS256'] });
      if (payload.typ !== tipo) return null;
      return payload as T;
    } catch (e) {
      if (e instanceof errors.JOSEError) return null;
      throw e;
    }
  }

  firmarAcceso(c: ClaimsAcceso) {
    return this.firmar('acc', { ...c }, DURACION_ACCESO_S);
  }
  leerAcceso(t: string) {
    return this.leer<ClaimsAcceso>('acc', t);
  }
  firmarPreauth(c: ClaimsPreauth) {
    return this.firmar('pre', { ...c }, DURACION_PREAUTH_S);
  }
  leerPreauth(t: string) {
    return this.leer<ClaimsPreauth>('pre', t);
  }
  firmarAutorizacion(c: ClaimsAutorizacion) {
    return this.firmar('aut', { ...c }, DURACION_AUTORIZACION_S);
  }
  leerAutorizacion(t: string) {
    return this.leer<ClaimsAutorizacion>('aut', t);
  }
}
