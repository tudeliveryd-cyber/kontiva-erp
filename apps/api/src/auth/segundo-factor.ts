import { createCipheriv, createDecipheriv, randomBytes, randomInt } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';
import { config } from '../config';
import { sha256 } from './cripto';

/**
 * Segundo factor: TOTP (RFC 6238, 6 dígitos, 30 s), compatible con Google Authenticator,
 * Microsoft Authenticator, Authy, 1Password, etc.
 */

const PERIODO = 30;
const VENTANA = 1; // acepta el código anterior y el siguiente (desfase de reloj)

// ---------------------------------------------------------------------------
// Cifrado de secretos (AES-256-GCM). Formato: v1.<iv>.<tag>.<texto> en base64url.
// ---------------------------------------------------------------------------

const clave = () => Buffer.from(config().CIFRADO_CLAVE, 'base64');

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', clave(), iv);
  const datos = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), datos.toString('base64url')].join('.');
}

export function descifrar(cifrado: string): string {
  const [v, iv, tag, datos] = cifrado.split('.');
  if (v !== 'v1' || !iv || !tag || !datos) throw new Error('Formato de secreto cifrado desconocido');
  const d = createDecipheriv('aes-256-gcm', clave(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(datos, 'base64url')), d.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// TOTP
// ---------------------------------------------------------------------------

function totp(secretoBase32: string, etiqueta = 'KONTIVA', emisor = 'KONTIVA ERP') {
  return new TOTP({ issuer: emisor, label: etiqueta, algorithm: 'SHA1', digits: 6, period: PERIODO, secret: Secret.fromBase32(secretoBase32) });
}

export interface NuevoSecreto {
  secreto: string; // base32, para escribir a mano
  uri: string; // otpauth://
  qr: string; // data URL SVG
  cifrado: string; // para guardar
}

export async function nuevoSecreto(etiqueta: string, emisor = 'KONTIVA ERP'): Promise<NuevoSecreto> {
  const secreto = new Secret({ size: 20 }).base32;
  const uri = totp(secreto, etiqueta, emisor).toString();
  const svg = await QRCode.toString(uri, { type: 'svg', margin: 1, color: { dark: '#2A004E', light: '#FFFFFF' } });
  return { secreto, uri, qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, cifrado: cifrar(secreto) };
}

/**
 * Verifica un código y devuelve el "paso" de tiempo al que corresponde, o null.
 * Un paso igual o anterior a `ultimoPaso` se rechaza: un código no sirve dos veces.
 */
export function verificarTotp(secretoCifrado: string, codigo: string, ultimoPaso: number | null): number | null {
  const limpio = codigo.replace(/\s/g, '');
  if (!/^[0-9]{6}$/.test(limpio)) return null;
  const t = totp(descifrar(secretoCifrado));
  const delta = t.validate({ token: limpio, window: VENTANA });
  if (delta === null) return null;
  const paso = Math.floor(Date.now() / 1000 / PERIODO) + delta;
  if (ultimoPaso !== null && paso <= ultimoPaso) return null;
  return paso;
}

/** Solo para pruebas: genera el código vigente de un secreto cifrado. */
export function codigoActual(secretoCifrado: string, desplazamiento = 0): string {
  return totp(descifrar(secretoCifrado)).generate({ timestamp: Date.now() + desplazamiento * PERIODO * 1000 });
}

// ---------------------------------------------------------------------------
// Códigos de respaldo: 10 códigos de un solo uso, formato XXXXX-XXXXX.
// Se guardan como SHA-256 (tienen 50 bits de entropía y se usan una vez).
// ---------------------------------------------------------------------------

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function nuevosCodigosRespaldo(n = 10): { codigos: string[]; hashes: string[] } {
  const codigos = Array.from({ length: n }, () => {
    const c = Array.from({ length: 10 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');
    return `${c.slice(0, 5)}-${c.slice(5)}`;
  });
  return { codigos, hashes: codigos.map(hashRespaldo) };
}

export const hashRespaldo = (codigo: string) => sha256('kontiva-respaldo:' + codigo.toUpperCase().replace(/[^A-Z0-9]/g, ''));

export const pareceCodigoRespaldo = (c: string) => /^[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}$/.test(c.trim());
