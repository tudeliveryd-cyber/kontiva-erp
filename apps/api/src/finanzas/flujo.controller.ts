import { Controller, Get, Query } from '@nestjs/common';
import Decimal from 'decimal.js';
import { sql } from 'kysely';
import { z } from 'zod';
import { Contexto, type Ctx } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { invalido, prohibido } from '../comun/errores';
import { validar } from '../comun/validar';
import { Db } from '../db/database';

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const CONCEPTOS = ['ventas', 'cobros', 'ingresos', 'pagos', 'devoluciones', 'gastos'] as const;
type Concepto = (typeof CONCEPTOS)[number];

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());

/**
 * Flujo de caja de la empresa.
 * Real: lo que entró y salió en el período (ventas al contado, cobros, pagos a proveedores,
 * reintegros de devoluciones, gastos e ingresos bancarios). Los traspasos internos
 * (depósitos de caja, transferencias entre cuentas) no son flujo y no se cuentan.
 * Proyectado: saldos pendientes de cuentas a cobrar y a pagar por fecha de vencimiento.
 */
@Controller('finanzas')
export class FlujoCajaController {
  constructor(private readonly db: Db) {}

  @Requiere('flujo_caja', 'ver')
  @Get('flujo')
  flujo(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ desde: dia, hasta: dia, dias: z.coerce.number().int().min(7).max(180).default(30) }), query);
    if (f.desde > f.hasta) throw invalido('La fecha inicial es posterior a la final');
    if (!ctx.esPropietario && ctx.alcance !== 'empresa') throw prohibido('El flujo de caja abarca toda la empresa: requiere alcance de empresa');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const { rows } = await sql<{ fecha: string; concepto: Concepto; monto: string }>`
        WITH dev AS (
          SELECT d.id, (d.creado_en AT TIME ZONE 'America/Asuncion')::date AS fecha,
                 d.total - coalesce((SELECT sum(a.monto) FROM cobro_aplicacion a WHERE a.devolucion_id = d.id), 0) AS reintegrado
          FROM devolucion d
        )
        SELECT fecha::text, concepto, sum(monto)::text AS monto FROM (
          SELECT (v.creado_en AT TIME ZONE 'America/Asuncion')::date AS fecha, 'ventas' AS concepto, v.total - v.credito AS monto
            FROM venta v WHERE v.estado = 'confirmada'
          UNION ALL
          SELECT c.fecha, 'cobros', c.monto FROM cobro_cliente c WHERE c.estado = 'confirmado'
          UNION ALL
          SELECT m.fecha, 'ingresos', m.monto FROM movimiento_bancario m WHERE m.tipo = 'ingreso'
          UNION ALL
          SELECT p.fecha, 'pagos', -p.monto FROM pago_proveedor p WHERE p.estado = 'confirmado'
          UNION ALL
          SELECT dev.fecha, 'devoluciones', -dev.reintegrado FROM dev WHERE dev.reintegrado > 0
          UNION ALL
          SELECT m.fecha, 'gastos', m.monto FROM movimiento_bancario m WHERE m.tipo = 'gasto'
        ) x
        WHERE fecha BETWEEN ${f.desde}::date AND ${f.hasta}::date
        GROUP BY fecha, concepto ORDER BY fecha`.execute(tx);

      const porDia = new Map<string, Record<Concepto, Decimal>>();
      const totales = Object.fromEntries(CONCEPTOS.map((c) => [c, new Decimal(0)])) as Record<Concepto, Decimal>;
      for (const r of rows) {
        const d = porDia.get(r.fecha) ?? (Object.fromEntries(CONCEPTOS.map((c) => [c, new Decimal(0)])) as Record<Concepto, Decimal>);
        d[r.concepto] = d[r.concepto].plus(r.monto);
        totales[r.concepto] = totales[r.concepto].plus(r.monto);
        porDia.set(r.fecha, d);
      }
      const resumir = (t: Record<Concepto, Decimal>) => {
        const entradas = t.ventas.plus(t.cobros).plus(t.ingresos);
        const salidas = t.pagos.plus(t.devoluciones).plus(t.gastos).neg();
        return { ...Object.fromEntries(CONCEPTOS.map((c) => [c, t[c].abs().toFixed(2)])), entradas: entradas.toFixed(2), salidas: salidas.toFixed(2), neto: entradas.minus(salidas).toFixed(2) };
      };
      const real = { totales: resumir(totales), dias: [...porDia.entries()].map(([fecha, t]) => ({ fecha, ...resumir(t) })) };

      // Proyección: lo pendiente, agrupado por vencimiento (lo vencido aparte).
      const desde = hoy();
      const { rows: pend } = await sql<{ lado: 'cobrar' | 'pagar'; fecha: string | null; monto: string }>`
        SELECT lado, CASE WHEN vencimiento < ${desde}::date THEN NULL ELSE vencimiento::text END AS fecha, sum(saldo)::text AS monto FROM (
          SELECT 'cobrar' AS lado, vencimiento, saldo FROM cuenta_cobrar WHERE estado IN ('pendiente', 'parcial')
          UNION ALL
          SELECT 'pagar', vencimiento, saldo FROM cuenta_pagar WHERE estado IN ('pendiente', 'parcial')
        ) x
        WHERE vencimiento <= ${desde}::date + ${f.dias}::int
        GROUP BY 1, 2 ORDER BY 2 NULLS FIRST`.execute(tx);
      const vencido = { cobrar: new Decimal(0), pagar: new Decimal(0) };
      const futuro = new Map<string, { cobrar: Decimal; pagar: Decimal }>();
      for (const p of pend) {
        if (p.fecha === null) vencido[p.lado] = vencido[p.lado].plus(p.monto);
        else {
          const x = futuro.get(p.fecha) ?? { cobrar: new Decimal(0), pagar: new Decimal(0) };
          x[p.lado] = x[p.lado].plus(p.monto);
          futuro.set(p.fecha, x);
        }
      }
      const { rows: bancos } = await sql<{ s: string | null }>`
        SELECT sum(c.saldo_inicial + coalesce((SELECT sum(m.monto) FROM movimiento_bancario m WHERE m.cuenta_id = c.id), 0))::text AS s
        FROM cuenta_bancaria c WHERE c.activa`.execute(tx);
      const saldoBancos = new Decimal(bancos[0]?.s ?? 0);
      let acumulado = saldoBancos.plus(vencido.cobrar).minus(vencido.pagar);
      const proyeccion = {
        desde,
        dias: f.dias,
        saldoBancos: saldoBancos.toFixed(2),
        vencido: { cobrar: vencido.cobrar.toFixed(2), pagar: vencido.pagar.toFixed(2) },
        items: [...futuro.entries()].map(([fecha, x]) => {
          acumulado = acumulado.plus(x.cobrar).minus(x.pagar);
          return { fecha, cobrar: x.cobrar.toFixed(2), pagar: x.pagar.toFixed(2), acumulado: acumulado.toFixed(2) };
        }),
        saldoProyectado: acumulado.toFixed(2),
      };
      return { desde: f.desde, hasta: f.hasta, real, proyeccion };
    });
  }
}
