import { PERMISOS, alcanceMayor } from '@kontiva/shared';
import type { Tx } from '../db/database';
import type { Alcance } from '../db/tipos';

export interface PermisosEfectivos {
  usuarioId: string;
  activo: boolean;
  esPropietario: boolean;
  perfilId: string;
  permisos: Map<string, Alcance>;
  sucursalIds: string[];
}

/**
 * Permisos efectivos = permisos del perfil (con su alcance)
 *   + concesiones individuales (con su alcance)
 *   − denegaciones individuales.
 * El Propietario tiene todo con alcance empresa y no admite restricciones.
 * Debe llamarse dentro de Db.enEmpresa (RLS).
 */
export async function cargarPermisos(tx: Tx, usuarioId: string): Promise<PermisosEfectivos | null> {
  const u = await tx
    .selectFrom('usuario as u')
    .innerJoin('perfil as p', (j) => j.onRef('p.empresa_id', '=', 'u.empresa_id').onRef('p.id', '=', 'u.perfil_id'))
    .select(['u.id', 'u.activo', 'u.perfil_id', 'p.es_propietario', 'p.alcance'])
    .where('u.id', '=', usuarioId)
    .executeTakeFirst();
  if (!u) return null;

  const sucursales = await tx
    .selectFrom('usuario_sucursal')
    .select('sucursal_id')
    .where('usuario_id', '=', usuarioId)
    .execute();

  const permisos = new Map<string, Alcance>();
  if (u.es_propietario) {
    for (const p of PERMISOS) permisos.set(p.codigo, 'empresa');
  } else {
    const [delPerfil, individuales, vigentes] = await Promise.all([
      tx.selectFrom('perfil_permiso').select('permiso').where('perfil_id', '=', u.perfil_id).execute(),
      tx.selectFrom('usuario_permiso').select(['permiso', 'tipo', 'alcance']).where('usuario_id', '=', usuarioId).execute(),
      tx.selectFrom('permiso').select('codigo').where('vigente', '=', true).execute(),
    ]);
    const vigente = new Set(vigentes.map((v) => v.codigo));
    for (const p of delPerfil) permisos.set(p.permiso, u.alcance);
    for (const i of individuales) {
      if (i.tipo === 'conceder') {
        const previo = permisos.get(i.permiso);
        permisos.set(i.permiso, previo ? alcanceMayor(previo, i.alcance) : i.alcance);
      }
    }
    for (const i of individuales) if (i.tipo === 'denegar') permisos.delete(i.permiso);
    for (const codigo of [...permisos.keys()]) if (!vigente.has(codigo)) permisos.delete(codigo);
  }

  return {
    usuarioId: u.id,
    activo: u.activo,
    esPropietario: u.es_propietario,
    perfilId: u.perfil_id,
    permisos,
    sucursalIds: sucursales.map((s) => s.sucursal_id),
  };
}
