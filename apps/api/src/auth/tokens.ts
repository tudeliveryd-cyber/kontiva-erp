import { Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify, errors } from 'jose';
import { config } from '../config';


export const DURACION_ACCESO_S = 15 * 60;
export const DURACION_PREAUTH_S = 5 * 60;
export const DURACION_AUTORIZACION_S = 2 * 60;

export interface ClaimsAcceso {
  sub: string; // usuario_id
  cta: string; // cuenta_id
  emp: string; // empresa_id
  sid: string; // sesion_id
}

/**
 * Ticket entre pasos del inicio de sesión (5 min):
 * mfa = falta el código del segundo factor · enrolar = debe configurar el segundo factor
 * empresa = credenciales completas, falta elegir empresa.
 */
export interface ClaimsPreauth {
  cta: string;
  fase: 'mfa' | 'enrolar' | 'empresa';
  emp?: string;
}

export interface ClaimsAutorizacion {
  emp: string;
  perm: string;
  sup: string; // usuario que autorizó
  sol: string; // usuario que solicitó
}

type Tipo = 'acc' | 'pre' | 'aut' | 'mst';

export interface ClaimsMaster {
  sub: string; // master.usuario.id
  sid: string; // master.sesion.id
}

/**
 * Tokens firmados (HS256). El tipo va en `typ` para que un token no sirva en lugar de otro.
 * La API de empresas y el Panel Master usan secretos y emisores distintos: un token de
 * uno nunca es válido en el otro.
 */
@Injectable()
export class Tokens {
  private readonly clave: Uint8Array;

  constructor(
    secreto: string,
    private readonly emisor: string,
  ) {
    this.clave = new TextEncoder().encode(secreto);
  }

  static empresas() {
    return new Tokens(config().JWT_SECRET, 'kontiva');
  }

  static master() {
    const secreto = config().JWT_MASTER_SECRET;
    if (!secreto) throw new Error('Falta JWT_MASTER_SECRET para el Panel Master');
    return new Tokens(secreto, 'kontiva-master');
  }

  private async firmar(tipo: Tipo, datos: Record<string, string>, segundos: number): Promise<string> {
    return new SignJWT({ ...datos, typ: tipo })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(this.emisor)
      .setIssuedAt()
      .setExpirationTime(`${segundos}s`)
      .sign(this.clave);
  }

  private async leer<T>(tipo: Tipo, token: string): Promise<T | null> {
    try {
      const { payload } = await jwtVerify(token, this.clave, { issuer: this.emisor, algorithms: ['HS256'] });
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
    return this.firmar('pre', { cta: c.cta, fase: c.fase, ...(c.emp ? { emp: c.emp } : {}) }, DURACION_PREAUTH_S);
  }
  leerPreauth(t: string) {
    return this.leer<ClaimsPreauth>('pre', t);
  }
  firmarMaster(c: ClaimsMaster) {
    return this.firmar('mst', { ...c }, DURACION_ACCESO_S);
  }
  leerMaster(t: string) {
    return this.leer<ClaimsMaster>('mst', t);
  }
  firmarAutorizacion(c: ClaimsAutorizacion) {
    return this.firmar('aut', { ...c }, DURACION_AUTORIZACION_S);
  }
  leerAutorizacion(t: string) {
    return this.leer<ClaimsAutorizacion>('aut', t);
  }
}
