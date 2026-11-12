import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { sql } from 'kysely';
import { origenDe, type RequestKontiva } from '../comun/contexto';
import { META_PERMISO, META_PUBLICO } from '../comun/decoradores';
import { noAutenticado, prohibido } from '../comun/errores';
import { Db } from '../db/database';
import { cargarPermisos } from './permisos';
import { Tokens } from './tokens';

/**
 * Guard global. Todo endpoint es privado salvo @Publico, y todo endpoint privado
 * debe declarar @Requiere(recurso, accion) o @SoloSesion: si no declara nada, se rechaza.
 *
 * En cada petición: token válido → sesión viva, usuario y empresa activos (consulta a la base,
 * así cerrar una sesión o desactivar un usuario tiene efecto inmediato) → permisos efectivos.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly log = new Logger('AuthGuard');

  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: Tokens,
    private readonly db: Db,
  ) {}

  async canActivate(ec: ExecutionContext): Promise<boolean> {
    const objetivos = [ec.getHandler(), ec.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(META_PUBLICO, objetivos)) return true;

    const req = ec.switchToHttp().getRequest<RequestKontiva>();
    const encabezado = req.headers.authorization;
    if (!encabezado?.startsWith('Bearer ')) throw noAutenticado();
    const claims = await this.tokens.leerAcceso(encabezado.slice(7));
    if (!claims) throw noAutenticado();

    const { rows } = await sql<{ sesion_activa: boolean; usuario_activo: boolean; empresa_activa: boolean }>`
      SELECT * FROM auth_estado_sesion(${claims.sid}::uuid)`.execute(this.db.k);
    const estado = rows[0];
    if (!estado?.sesion_activa || !estado.usuario_activo) throw noAutenticado();
    if (!estado.empresa_activa) throw prohibido('La empresa está suspendida. Contacte a Araújo Tech Sistemas.');

    const efectivos = await this.db.enEmpresa(claims.emp, (tx) => cargarPermisos(tx, claims.sub));
    if (!efectivos?.activo) throw noAutenticado();

    const { ip, agente } = origenDe(req);
    req.ctx = {
      empresaId: claims.emp,
      usuarioId: claims.sub,
      cuentaId: claims.cta,
      sesionId: claims.sid,
      esPropietario: efectivos.esPropietario,
      permisos: efectivos.permisos,
      sucursalIds: efectivos.sucursalIds,
      ip,
      agente,
    };

    const exigido = this.reflector.getAllAndOverride<string | undefined>(META_PERMISO, objetivos);
    if (!exigido) {
      this.log.error(`Endpoint sin @Requiere ni @SoloSesion: ${req.method} ${req.route?.path ?? req.url}`);
      throw prohibido();
    }
    if (exigido === '__sesion__') return true;
    const alcance = efectivos.permisos.get(exigido);
    if (!alcance) throw prohibido();
    req.ctx.alcance = alcance;
    return true;
  }
}
