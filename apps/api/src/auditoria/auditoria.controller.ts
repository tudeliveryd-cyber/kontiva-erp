import { Controller, Get, Query } from '@nestjs/common';
import { auditoriaFiltro } from '@kontiva/shared';
import { Contexto, type Ctx } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { validar } from '../comun/validar';
import { Db } from '../db/database';

@Controller('auditoria')
export class AuditoriaController {
  constructor(private readonly db: Db) {}

  /** Registro de auditoría, del más reciente al más antiguo, paginado por cursor (id). */
  @Requiere('auditoria', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(auditoriaFiltro, query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let q = tx
        .selectFrom('auditoria as a')
        .leftJoin('usuario as u', 'u.id', 'a.usuario_id')
        .leftJoin('usuario as s', 's.id', 'a.autorizado_por')
        .select([
          'a.id', 'a.creado_en', 'a.accion', 'a.entidad', 'a.entidad_id', 'a.antes', 'a.despues', 'a.ip', 'a.agente',
          'a.usuario_id', 'u.nombre as usuario_nombre', 'a.autorizado_por', 's.nombre as autorizado_por_nombre',
        ])
        .orderBy('a.id', 'desc')
        .limit(f.limite + 1);
      // Alcance "propia": solo sus propias acciones.
      if (ctx.alcance === 'propia') q = q.where('a.usuario_id', '=', ctx.usuarioId);
      if (f.desde) q = q.where('a.creado_en', '>=', f.desde);
      if (f.hasta) q = q.where('a.creado_en', '<=', f.hasta);
      if (f.usuarioId) q = q.where('a.usuario_id', '=', f.usuarioId);
      if (f.entidad) q = q.where('a.entidad', '=', f.entidad);
      if (f.accion) q = q.where('a.accion', '=', f.accion);
      if (f.cursor) q = q.where('a.id', '<', String(f.cursor));
      const filas = await q.execute();
      const hayMas = filas.length > f.limite;
      const pagina = filas.slice(0, f.limite);
      return {
        items: pagina.map((a) => ({
          id: Number(a.id),
          fecha: a.creado_en,
          accion: a.accion,
          entidad: a.entidad,
          entidadId: a.entidad_id,
          usuario: a.usuario_id ? { id: a.usuario_id, nombre: a.usuario_nombre } : null,
          autorizadoPor: a.autorizado_por ? { id: a.autorizado_por, nombre: a.autorizado_por_nombre } : null,
          antes: a.antes,
          despues: a.despues,
          ip: a.ip,
          agente: a.agente,
        })),
        siguiente: hayMas ? Number(pagina[pagina.length - 1]!.id) : null,
      };
    });
  }
}
