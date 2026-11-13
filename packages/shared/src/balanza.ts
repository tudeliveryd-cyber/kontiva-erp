import { z } from 'zod';

/**
 * Etiquetas de balanza (Toledo, Systel, Kretz, Prix y compatibles): la balanza imprime un EAN-13 que empieza
 * con el prefijo (2 o 20–29) y lleva el código del producto (PLU) y el peso o el importe:
 *   prefijo + código + valor + dígito verificador = 13 dígitos.
 * El PLU se carga como código de barras del producto (con o sin ceros a la izquierda).
 */
export const configBalanza = z.object({
  activa: z.boolean(),
  prefijo: z.string().regex(/^2[0-9]?$/, 'Prefijo de 1 o 2 dígitos que empiece con 2'),
  digitosCodigo: z.coerce.number().int().min(4).max(6),
  contenido: z.enum(['peso', 'precio']),
  /** Peso: decimales del valor (3 = gramos). */
  decimalesPeso: z.coerce.number().int().min(0).max(3).default(3),
});
export type ConfigBalanza = z.infer<typeof configBalanza>;

export const BALANZA_PREDETERMINADA: ConfigBalanza = { activa: false, prefijo: '2', digitosCodigo: 6, contenido: 'peso', decimalesPeso: 3 };

export function digitoEan13(doce: string): number {
  const s = doce.split('').reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0);
  return (10 - (s % 10)) % 10;
}

export interface EtiquetaBalanza {
  /** Códigos a buscar entre los códigos de barras del producto. */
  candidatos: string[];
  cantidad: number | null;
  importe: number | null;
}

export function leerEtiquetaBalanza(codigo: string, c: ConfigBalanza | null | undefined): EtiquetaBalanza | null {
  if (!c?.activa || !/^[0-9]{13}$/.test(codigo) || !codigo.startsWith(c.prefijo)) return null;
  if (digitoEan13(codigo.slice(0, 12)) !== Number(codigo[12])) return null;
  const desde = c.prefijo.length;
  const plu = codigo.slice(desde, desde + c.digitosCodigo);
  const valor = Number(codigo.slice(desde + c.digitosCodigo, 12));
  if (!plu || codigo.slice(desde + c.digitosCodigo, 12).length < 4) return null;
  const sinCeros = String(Number(plu));
  return {
    candidatos: [...new Set([plu, sinCeros, c.prefijo + plu])],
    cantidad: c.contenido === 'peso' ? valor / 10 ** c.decimalesPeso : null,
    importe: c.contenido === 'precio' ? valor : null,
  };
}
