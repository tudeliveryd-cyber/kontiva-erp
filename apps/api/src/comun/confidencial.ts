import type { Ctx } from './contexto';

/**
 * Quita de una respuesta los campos confidenciales que el usuario no puede ver.
 * Ej.: filtrarCampos(producto, ctx, { costo: 'costo_producto.ver', margen: 'costo_producto.ver' })
 */
export function filtrarCampos<T extends Record<string, unknown>>(
  obj: T,
  ctx: Pick<Ctx, 'permisos'>,
  mapa: Partial<Record<keyof T, string>>,
): Partial<T> {
  const out: Partial<T> = { ...obj };
  for (const campo of Object.keys(mapa) as (keyof T)[]) {
    const permiso = mapa[campo];
    if (permiso && !ctx.permisos.has(permiso)) delete out[campo];
  }
  return out;
}
