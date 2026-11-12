import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';

/** Parámetros Argon2id (OWASP 2024: m=19 MiB, t=2, p=1). */
const OPCIONES = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } satisfies argon2.HashOptions;

export const hashear = (secreto: string): Promise<string> => argon2.hash(secreto, { ...OPCIONES, raw: false });

export async function verificar(hash: string, secreto: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, secreto);
  } catch {
    return false;
  }
}

export const requiereRehash = (hash: string) => argon2.needsRehash(hash, OPCIONES);

/** Hash señuelo: se verifica cuando la cuenta no existe, para igualar el tiempo de respuesta. */
let senuelo: Promise<string> | undefined;
export async function verificarSenuelo(secreto: string): Promise<void> {
  senuelo ??= hashear('kontiva-senuelo-' + randomBytes(8).toString('hex'));
  await verificar(await senuelo, secreto);
}

/** Token opaco de 256 bits (renovación, recuperación, invitación). */
export const tokenAleatorio = () => randomBytes(32).toString('base64url');

/** Los tokens opacos se guardan solo como SHA-256: un volcado de la base no permite usarlos. */
export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export function igualesSeguro(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
