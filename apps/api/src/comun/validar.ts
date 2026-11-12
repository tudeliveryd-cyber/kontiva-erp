import type { ZodType } from 'zod';

/** Valida la entrada con el esquema compartido; un ZodError lo traduce FiltroErrores a 400. */
export function validar<T>(esquema: ZodType<T>, datos: unknown): T {
  return esquema.parse(datos);
}
