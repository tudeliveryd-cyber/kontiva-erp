import { RANGO_ALCANCE } from '@kontiva/shared';
import type { Alcance } from '../db/tipos';
import type { Ctx } from './contexto';
import { ErrorNegocio } from './errores';
import { HttpStatus } from '@nestjs/common';

/**
 * Nadie puede dar más de lo que tiene: al asignar un perfil o conceder permisos,
 * cada permiso debe estar entre los propios con un alcance igual o mayor.
 * El Propietario no tiene límite.
 */
export function verificarSinEscalada(ctx: Ctx, permisos: readonly string[], alcance: Alcance): void {
  if (ctx.esPropietario) return;
  const faltantes = permisos.filter((p) => {
    const propio = ctx.permisos.get(p);
    return !propio || RANGO_ALCANCE[propio] < RANGO_ALCANCE[alcance];
  });
  if (faltantes.length) {
    throw new ErrorNegocio(
      HttpStatus.FORBIDDEN,
      'ESCALADA_DE_PERMISOS',
      'No puede otorgar permisos que usted no tiene (o con mayor alcance)',
      faltantes,
    );
  }
}
