import { Controller, Get, Query } from '@nestjs/common';
import { booleanoQuery } from '@kontiva/shared';
import Decimal from 'decimal.js';
import { sql } from 'kysely';
import { z } from 'zod';
import { enSucursal } from '../comun/alcance';
import { Contexto, type Ctx } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { invalido } from '../comun/errores';
import { validar } from '../comun/validar';
import { Db } from '../db/database';

const fechaDia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Libro recetario: cada venta de medicamentos bajo receta con los datos de la receta, los productos y sus lotes.
 * Las de receta archivada (psicotrópicos y estupefacientes) llevan la receta retenida y la cédula del paciente.
 */
@Controller('recetas')
export class RecetarioController {
  constructor(private readonly db: Db) {}

  @Requiere('receta', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ desde: fechaDia, hasta: fechaDia, sucursalId: z.string().uuid().optional(), soloArchivadas: booleanoQuery, buscar: z.string().trim().max(80).optional() }), query);
    if (f.hasta < f.desde) throw invalido('El rango de fechas es inválido');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let q = tx
        .selectFrom('receta as r')
        .innerJoin('venta as v', 'v.id', 'r.venta_id')
        .innerJoin('sucursal as s', 's.id', 'v.sucursal_id')
        .innerJoin('usuario as u', 'u.id', 'v.creado_por')
        .select(['r.id', 'r.venta_id', 'r.medico', 'r.matricula', 'r.paciente', 'r.paciente_documento', 'r.fecha', 'r.numero', 'r.retenida', 'v.numero as venta_numero', 'v.comprobante', 'v.creado_en', 'v.estado', 'v.sucursal_id', 's.nombre as sucursal', 'u.nombre as vendedor'])
        .where(sql`(v.creado_en AT TIME ZONE 'America/Asuncion')::date`, '>=', f.desde)
        .where(sql`(v.creado_en AT TIME ZONE 'America/Asuncion')::date`, '<=', f.hasta)
        .orderBy('v.creado_en');
      if (f.sucursalId) q = q.where('v.sucursal_id', '=', f.sucursalId);
      if (f.buscar) q = q.where((eb) => eb.or([eb('r.paciente', 'ilike', `%${f.buscar}%`), eb('r.medico', 'ilike', `%${f.buscar}%`), eb('r.matricula', 'ilike', `%${f.buscar}%`), eb('r.paciente_documento', 'ilike', `%${f.buscar}%`)]));
      const recetas = (await q.limit(2000).execute()).filter((r) => enSucursal(ctx, r.sucursal_id));
      const ventas = recetas.map((r) => r.venta_id);
      const items = ventas.length
        ? await tx.selectFrom('venta_item').select(['venta_id', 'linea', 'variante_id', 'descripcion', 'cantidad', 'condicion_venta']).where('venta_id', 'in', ventas).where('condicion_venta', 'is not', null).orderBy('linea').execute()
        : [];
      const lotes = ventas.length
        ? await tx
            .selectFrom('movimiento_lote as m')
            .innerJoin('lote as l', 'l.id', 'm.lote_id')
            .select(['m.origen_id', 'm.variante_id', 'l.codigo', 'l.vencimiento'])
            .where('m.origen_id', 'in', ventas)
            .where('m.tipo', '=', 'venta')
            .execute()
        : [];
      return recetas
        .map((r) => {
          const its = items.filter((i) => i.venta_id === r.venta_id);
          return {
            id: r.id,
            ventaId: r.venta_id,
            ventaNumero: Number(r.venta_numero),
            comprobante: r.comprobante,
            fecha: r.creado_en,
            anulada: r.estado === 'anulada',
            sucursal: r.sucursal,
            vendedor: r.vendedor,
            medico: r.medico,
            matricula: r.matricula,
            paciente: r.paciente,
            pacienteDocumento: r.paciente_documento,
            fechaReceta: r.fecha,
            numero: r.numero,
            retenida: r.retenida,
            archivada: its.some((i) => i.condicion_venta === 'receta_archivada'),
            items: its.map((i) => ({
              descripcion: i.descripcion,
              cantidad: new Decimal(i.cantidad).toString(),
              condicionVenta: i.condicion_venta,
              lotes: [...new Set(lotes.filter((l) => l.origen_id === r.venta_id && l.variante_id === i.variante_id).map((l) => l.codigo))],
            })),
          };
        })
        .filter((r) => !f.soloArchivadas || r.archivada);
    });
  }
}
