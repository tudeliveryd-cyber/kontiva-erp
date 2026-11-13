import { Controller, Get, Query } from '@nestjs/common';
import Decimal from 'decimal.js';
import { sql, type RawBuilder } from 'kysely';
import { z } from 'zod';
import { Contexto, tiene, type Ctx } from '../comun/contexto';
import { Requiere, SoloSesion } from '../comun/decoradores';
import { invalido, noEncontrado } from '../comun/errores';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';
import { esperado } from '../operacion/cajas.controller';

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hoyPy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
const masDias = (f: string, n: number) => {
  const d = new Date(`${f}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000) + 1;
const d2 = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0).toFixed(2);

const periodo = z
  .object({ desde: dia, hasta: dia, sucursalId: z.string().uuid().optional() })
  .refine((p) => p.desde <= p.hasta, { message: 'La fecha inicial es posterior a la final' })
  .refine((p) => diasEntre(p.desde, p.hasta) <= 731, { message: 'El período no puede superar dos años' });

/** Rango de fechas de Paraguay como instantes (usa el índice por creado_en). */
const rango = (col: string, desde: string, hasta: string) =>
  sql`${sql.ref(col)} >= (${desde}::date::timestamp AT TIME ZONE 'America/Asuncion') AND ${sql.ref(col)} < ((${hasta}::date + 1)::timestamp AT TIME ZONE 'America/Asuncion')`;

/**
 * Sucursales que puede ver el usuario: todas con alcance de empresa; si no, las asignadas.
 * Con sucursalId, solo esa (si le corresponde).
 */
function sucursales(ctx: Ctx, sucursalId?: string): readonly string[] | null {
  const todas = ctx.esPropietario || ctx.alcance === 'empresa';
  if (sucursalId) {
    if (!todas && !ctx.sucursalIds.includes(sucursalId)) throw noEncontrado('Sucursal');
    return [sucursalId];
  }
  return todas ? null : ctx.sucursalIds;
}
const filtroSuc = (col: string, ids: readonly string[] | null): RawBuilder<unknown> =>
  ids === null ? sql`true` : ids.length ? sql`${sql.ref(col)} IN (${sql.join(ids)})` : sql`false`;

async function resumenVentas(tx: Tx, desde: string, hasta: string, suc: readonly string[] | null) {
  const { rows } = await sql<{ n: string; total: string | null; credito: string | null }>`
    SELECT count(*) AS n, sum(v.total) AS total, sum(v.credito) AS credito FROM venta v
    WHERE v.estado = 'confirmada' AND ${rango('v.creado_en', desde, hasta)} AND ${filtroSuc('v.sucursal_id', suc)}`.execute(tx);
  const r = rows[0]!;
  const n = Number(r.n);
  const total = new Decimal(r.total ?? 0);
  return { cantidad: n, total: d2(total), credito: d2(r.credito), ticketPromedio: d2(n ? total.div(n).toDecimalPlaces(0) : 0) };
}

@Controller()
export class InformesController {
  constructor(private readonly db: Db) {}

  /**
   * Tablero del dueño: cada bloque aparece solo si el usuario tiene el permiso correspondiente.
   * Con alcance de sucursal, solo sus sucursales.
   */
  @SoloSesion()
  @Get('tablero')
  tablero(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(periodo, query);
    const suc = sucursales(ctx, f.sucursalId);
    const empresa = suc === null;
    const hoy = hoyPy();
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const r: Record<string, unknown> = { desde: f.desde, hasta: f.hasta };

      if (tiene(ctx, 'informe_ventas.ver')) {
        const n = diasEntre(f.desde, f.hasta);
        const antDesde = masDias(f.desde, -n);
        const antHasta = masDias(f.desde, -1);
        const actual = await resumenVentas(tx, f.desde, f.hasta, suc);
        const anterior = await resumenVentas(tx, antDesde, antHasta, suc);
        const porDia = await sql<{ fecha: string; n: string; total: string }>`
          SELECT (v.creado_en AT TIME ZONE 'America/Asuncion')::date::text AS fecha, count(*) AS n, sum(v.total) AS total FROM venta v
          WHERE v.estado = 'confirmada' AND ${rango('v.creado_en', f.desde, f.hasta)} AND ${filtroSuc('v.sucursal_id', suc)}
          GROUP BY 1 ORDER BY 1`.execute(tx);
        const porHora = await sql<{ hora: number; n: string; total: string }>`
          SELECT extract(hour FROM v.creado_en AT TIME ZONE 'America/Asuncion')::int AS hora, count(*) AS n, sum(v.total) AS total FROM venta v
          WHERE v.estado = 'confirmada' AND ${rango('v.creado_en', f.desde, f.hasta)} AND ${filtroSuc('v.sucursal_id', suc)}
          GROUP BY 1 ORDER BY 1`.execute(tx);
        const porSucursal = await sql<{ id: string; nombre: string; n: string; total: string }>`
          SELECT s.id, s.nombre, count(*) AS n, sum(v.total) AS total FROM venta v JOIN sucursal s ON s.id = v.sucursal_id
          WHERE v.estado = 'confirmada' AND ${rango('v.creado_en', f.desde, f.hasta)} AND ${filtroSuc('v.sucursal_id', suc)}
          GROUP BY s.id, s.nombre ORDER BY sum(v.total) DESC`.execute(tx);
        // Medios de pago: lo cobrado en el acto (el vuelto en guaraníes se descuenta del efectivo) y lo vendido a crédito.
        const porMedio = await sql<{ medio: string; total: string }>`
          SELECT medio, sum(monto) AS total FROM (
            SELECT p.medio, p.monto_pyg AS monto FROM venta_pago p JOIN venta v ON v.id = p.venta_id
              WHERE v.estado = 'confirmada' AND ${rango('v.creado_en', f.desde, f.hasta)} AND ${filtroSuc('v.sucursal_id', suc)}
            UNION ALL
            SELECT 'efectivo', -v.vuelto FROM venta v
              WHERE v.estado = 'confirmada' AND v.vuelto > 0 AND v.vuelto_moneda = 'PYG' AND ${rango('v.creado_en', f.desde, f.hasta)} AND ${filtroSuc('v.sucursal_id', suc)}
            UNION ALL
            SELECT 'credito', v.credito FROM venta v
              WHERE v.estado = 'confirmada' AND v.credito > 0 AND ${rango('v.creado_en', f.desde, f.hasta)} AND ${filtroSuc('v.sucursal_id', suc)}
          ) x GROUP BY medio HAVING sum(monto) <> 0 ORDER BY sum(monto) DESC, medio`.execute(tx);
        const verCosto = tiene(ctx, 'informe_ganancias.ver');
        const top = await sql<{ id: string; producto: string; variante: string | null; cantidad: string; total: string; costo: string }>`
          SELECT va.id, p.nombre AS producto, va.nombre AS variante, sum(i.cantidad) AS cantidad, sum(i.total) AS total, sum(i.cantidad * i.costo_unitario) AS costo
          FROM venta_item i JOIN venta v ON v.id = i.venta_id JOIN variante va ON va.id = i.variante_id JOIN producto p ON p.id = va.producto_id
          WHERE v.estado = 'confirmada' AND ${rango('v.creado_en', f.desde, f.hasta)} AND ${filtroSuc('v.sucursal_id', suc)}
          GROUP BY va.id, p.nombre, va.nombre ORDER BY sum(i.total) DESC LIMIT 10`.execute(tx);
        const porVendedor = await sql<{ id: string; nombre: string; n: string; total: string }>`
          SELECT u.id, u.nombre, count(*) AS n, sum(v.total) AS total FROM venta v JOIN usuario u ON u.id = v.creado_por
          WHERE v.estado = 'confirmada' AND ${rango('v.creado_en', f.desde, f.hasta)} AND ${filtroSuc('v.sucursal_id', suc)}
          GROUP BY u.id, u.nombre ORDER BY sum(v.total) DESC LIMIT 10`.execute(tx);
        const dev = await sql<{ n: string; total: string | null }>`
          SELECT count(*) AS n, sum(d.total) AS total FROM devolucion d JOIN venta v ON v.id = d.venta_id
          WHERE ${rango('d.creado_en', f.desde, f.hasta)} AND ${filtroSuc('v.sucursal_id', suc)}`.execute(tx);
        const anul = await sql<{ n: string; total: string | null }>`
          SELECT count(*) AS n, sum(v.total) AS total FROM venta v
          WHERE v.estado = 'anulada' AND ${rango('v.anulada_en', f.desde, f.hasta)} AND ${filtroSuc('v.sucursal_id', suc)}`.execute(tx);
        r.ventas = {
          ...actual,
          anterior: { ...anterior, desde: antDesde, hasta: antHasta },
          porDia: porDia.rows.map((x) => ({ fecha: x.fecha, cantidad: Number(x.n), total: d2(x.total) })),
          porHora: porHora.rows.map((x) => ({ hora: x.hora, cantidad: Number(x.n), total: d2(x.total) })),
          porSucursal: porSucursal.rows.map((x) => ({ id: x.id, nombre: x.nombre, cantidad: Number(x.n), total: d2(x.total) })),
          porMedio: porMedio.rows.map((x) => ({ medio: x.medio, total: d2(x.total) })),
          porVendedor: porVendedor.rows.map((x) => ({ id: x.id, nombre: x.nombre, cantidad: Number(x.n), total: d2(x.total) })),
          topProductos: top.rows.map((x) => ({
            id: x.id,
            nombre: x.variante ? `${x.producto} · ${x.variante}` : x.producto,
            cantidad: new Decimal(x.cantidad).toString(),
            total: d2(x.total),
            ...(verCosto ? { margen: d2(new Decimal(x.total).minus(x.costo)) } : {}),
          })),
          devoluciones: { cantidad: Number(dev.rows[0]!.n), total: d2(dev.rows[0]!.total) },
          anuladas: { cantidad: Number(anul.rows[0]!.n), total: d2(anul.rows[0]!.total) },
        };
        if (verCosto) {
          const g = await sql<{ total: string | null; costo: string | null }>`
            SELECT sum(v.total) AS total, sum((SELECT sum(i.cantidad * i.costo_unitario) FROM venta_item i WHERE i.venta_id = v.id)) AS costo
            FROM venta v WHERE v.estado = 'confirmada' AND ${rango('v.creado_en', f.desde, f.hasta)} AND ${filtroSuc('v.sucursal_id', suc)}`.execute(tx);
          const total = new Decimal(g.rows[0]!.total ?? 0);
          const costo = new Decimal(g.rows[0]!.costo ?? 0);
          // Precios y costos con IVA incluido, igual que en la ficha del producto.
          r.ganancia = { ventas: d2(total), costo: d2(costo), margen: d2(total.minus(costo)), porcentaje: total.isZero() ? '0.0' : total.minus(costo).div(total).mul(100).toFixed(1) };
        }
      }

      if (tiene(ctx, 'cuenta_cobrar.ver')) {
        const c = await sql<{ saldo: string | null; vencido: string | null; clientes: string }>`
          SELECT sum(saldo) AS saldo, sum(saldo) FILTER (WHERE vencimiento < ${hoy}::date) AS vencido, count(DISTINCT cliente_id) FILTER (WHERE vencimiento < ${hoy}::date) AS clientes
          FROM cuenta_cobrar WHERE estado IN ('pendiente', 'parcial') AND ${filtroSuc('sucursal_id', suc)}`.execute(tx);
        r.cobrar = { saldo: d2(c.rows[0]!.saldo), vencido: d2(c.rows[0]!.vencido), clientesVencidos: Number(c.rows[0]!.clientes) };
      }
      if (empresa && tiene(ctx, 'cuenta_pagar.ver')) {
        const p = await sql<{ saldo: string | null; vencido: string | null; semana: string | null }>`
          SELECT sum(saldo) AS saldo, sum(saldo) FILTER (WHERE vencimiento < ${hoy}::date) AS vencido,
            sum(saldo) FILTER (WHERE vencimiento BETWEEN ${hoy}::date AND ${hoy}::date + 7) AS semana
          FROM cuenta_pagar WHERE estado IN ('pendiente', 'parcial')`.execute(tx);
        r.pagar = { saldo: d2(p.rows[0]!.saldo), vencido: d2(p.rows[0]!.vencido), proximos7: d2(p.rows[0]!.semana) };
      }
      if (empresa && tiene(ctx, 'banco.ver')) {
        const b = await sql<{ s: string | null }>`
          SELECT sum(c.saldo_inicial + coalesce((SELECT sum(m.monto) FROM movimiento_bancario m WHERE m.cuenta_id = c.id), 0)) AS s
          FROM cuenta_bancaria c WHERE c.activa`.execute(tx);
        r.bancos = { saldo: d2(b.rows[0]!.s) };
      }
      if (tiene(ctx, 'caja.ver')) {
        const abiertas = await sql<{ id: string; caja: string; sucursal: string; usuario: string; abierta_en: Date }>`
          SELECT sc.id, c.nombre AS caja, s.nombre AS sucursal, u.nombre AS usuario, sc.abierta_en
          FROM sesion_caja sc JOIN caja c ON c.id = sc.caja_id JOIN sucursal s ON s.id = c.sucursal_id JOIN usuario u ON u.id = sc.usuario_id
          WHERE sc.estado = 'abierta' AND ${filtroSuc('c.sucursal_id', suc)} ORDER BY s.nombre, c.nombre`.execute(tx);
        const lista = [];
        for (const a of abiertas.rows) {
          const ef = (await esperado(tx, a.id)).find((e) => e.moneda === 'PYG' && e.medio === 'efectivo');
          lista.push({ caja: a.caja, sucursal: a.sucursal, usuario: a.usuario, abiertaEn: a.abierta_en, efectivo: d2(ef?.monto) });
        }
        r.cajas = { abiertas: lista.length, efectivo: d2(lista.reduce((s, x) => s.plus(x.efectivo), new Decimal(0))), lista };
      }
      if (tiene(ctx, 'stock.ver')) {
        const bajo = await sql<{ variante_id: string; producto: string; variante: string | null; deposito: string; cantidad: string; minimo: string }>`
          SELECT va.id AS variante_id, p.nombre AS producto, va.nombre AS variante, d.nombre AS deposito, coalesce(st.cantidad, 0) AS cantidad, va.stock_minimo AS minimo
          FROM variante va JOIN producto p ON p.id = va.producto_id
          JOIN deposito d ON d.activo AND ${filtroSuc('d.sucursal_id', suc)}
          LEFT JOIN stock st ON st.variante_id = va.id AND st.deposito_id = d.id
          WHERE va.activa AND p.activo AND p.controla_stock AND va.stock_minimo > 0 AND coalesce(st.cantidad, 0) < va.stock_minimo
          ORDER BY coalesce(st.cantidad, 0) / va.stock_minimo, p.nombre LIMIT 200`.execute(tx);
        r.stockBajo = {
          cantidad: bajo.rows.length,
          items: bajo.rows.slice(0, 10).map((x) => ({ varianteId: x.variante_id, nombre: x.variante ? `${x.producto} · ${x.variante}` : x.producto, deposito: x.deposito, cantidad: new Decimal(x.cantidad).toString(), minimo: new Decimal(x.minimo).toString() })),
        };
        // Lotes con stock vencidos o que vencen en los próximos 30 días.
        const ven = await sql<{ vencidos: string; por_vencer: string }>`
          SELECT count(*) FILTER (WHERE l.vencimiento < ${hoy}::date) AS vencidos,
                 count(*) FILTER (WHERE l.vencimiento >= ${hoy}::date AND l.vencimiento <= ${hoy}::date + 30) AS por_vencer
          FROM stock_lote sl JOIN lote l ON l.id = sl.lote_id JOIN deposito d ON d.id = sl.deposito_id AND ${filtroSuc('d.sucursal_id', suc)}
          WHERE sl.cantidad > 0 AND l.vencimiento IS NOT NULL`.execute(tx);
        r.vencimientos = { vencidos: Number(ven.rows[0]!.vencidos), porVencer: Number(ven.rows[0]!.por_vencer) };
      }
      return r;
    });
  }

  /** Ventas agrupadas. Costo y margen solo con informe_ganancias.ver. */
  @Requiere('informe_ventas', 'ver')
  @Get('informes/ventas')
  ventas(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(
      z.intersection(periodo, z.object({ agrupar: z.enum(['dia', 'mes', 'producto', 'categoria', 'marca', 'cliente', 'vendedor', 'sucursal', 'caja']).default('dia') })),
      query,
    );
    const suc = sucursales(ctx, f.sucursalId);
    const verCosto = tiene(ctx, 'informe_ganancias.ver');
    // Agrupaciones por documento (sobre la venta) o por ítem (sobre las líneas).
    const porItem = ['producto', 'categoria', 'marca'].includes(f.agrupar);
    const grupos: Record<string, { clave: string; nombre: string; join: string }> = {
      dia: { clave: `(v.creado_en AT TIME ZONE 'America/Asuncion')::date::text`, nombre: `(v.creado_en AT TIME ZONE 'America/Asuncion')::date::text`, join: '' },
      mes: { clave: `to_char(v.creado_en AT TIME ZONE 'America/Asuncion', 'YYYY-MM')`, nombre: `to_char(v.creado_en AT TIME ZONE 'America/Asuncion', 'YYYY-MM')`, join: '' },
      cliente: { clave: `coalesce(v.cliente_id::text, '')`, nombre: `coalesce(cl.nombre, 'Consumidor final')`, join: 'LEFT JOIN cliente cl ON cl.id = v.cliente_id' },
      vendedor: { clave: 'v.creado_por::text', nombre: 'u.nombre', join: 'JOIN usuario u ON u.id = v.creado_por' },
      sucursal: { clave: 'v.sucursal_id::text', nombre: 's.nombre', join: 'JOIN sucursal s ON s.id = v.sucursal_id' },
      caja: { clave: 'v.caja_id::text', nombre: `s.nombre || ' · ' || c.nombre`, join: 'JOIN caja c ON c.id = v.caja_id JOIN sucursal s ON s.id = v.sucursal_id' },
      producto: { clave: 'va.id::text', nombre: `p.nombre || coalesce(' · ' || va.nombre, '')`, join: '' },
      categoria: { clave: `coalesce(p.categoria_id::text, '')`, nombre: `coalesce(cat.nombre, 'Sin categoría')`, join: 'LEFT JOIN categoria cat ON cat.id = p.categoria_id' },
      marca: { clave: `coalesce(p.marca_id::text, '')`, nombre: `coalesce(ma.nombre, 'Sin marca')`, join: 'LEFT JOIN marca ma ON ma.id = p.marca_id' },
    };
    const g = grupos[f.agrupar]!;
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const filas = porItem
        ? await sql<{ clave: string; nombre: string; documentos: string; cantidad: string; total: string; costo: string }>`
            SELECT ${sql.raw(g.clave)} AS clave, ${sql.raw(g.nombre)} AS nombre, count(DISTINCT v.id) AS documentos,
              sum(i.cantidad) AS cantidad, sum(i.total) AS total, sum(i.cantidad * i.costo_unitario) AS costo
            FROM venta_item i JOIN venta v ON v.id = i.venta_id JOIN variante va ON va.id = i.variante_id JOIN producto p ON p.id = va.producto_id ${sql.raw(g.join)}
            WHERE v.estado = 'confirmada' AND ${rango('v.creado_en', f.desde, f.hasta)} AND ${filtroSuc('v.sucursal_id', suc)}
            GROUP BY 1, 2 ORDER BY sum(i.total) DESC LIMIT 2000`.execute(tx)
        : await sql<{ clave: string; nombre: string; documentos: string; cantidad: string; total: string; costo: string }>`
            SELECT ${sql.raw(g.clave)} AS clave, ${sql.raw(g.nombre)} AS nombre, count(*) AS documentos, count(*) AS cantidad, sum(v.total) AS total,
              sum((SELECT sum(i.cantidad * i.costo_unitario) FROM venta_item i WHERE i.venta_id = v.id)) AS costo
            FROM venta v ${sql.raw(g.join)}
            WHERE v.estado = 'confirmada' AND ${rango('v.creado_en', f.desde, f.hasta)} AND ${filtroSuc('v.sucursal_id', suc)}
            GROUP BY 1, 2 ORDER BY ${sql.raw(f.agrupar === 'dia' || f.agrupar === 'mes' ? '1' : 'sum(v.total) DESC')} LIMIT 2000`.execute(tx);
      const items = filas.rows.map((x) => {
        const total = new Decimal(x.total ?? 0);
        const costo = new Decimal(x.costo ?? 0);
        return {
          clave: x.clave,
          nombre: x.nombre,
          documentos: Number(x.documentos),
          cantidad: new Decimal(x.cantidad ?? 0).toString(),
          total: d2(total),
          ...(verCosto ? { costo: d2(costo), margen: d2(total.minus(costo)), porcentaje: total.isZero() ? '0.0' : total.minus(costo).div(total).mul(100).toFixed(1) } : {}),
        };
      });
      const total = items.reduce((s, x) => s.plus(x.total), new Decimal(0));
      const costo = verCosto ? items.reduce((s, x) => s.plus(x.costo!), new Decimal(0)) : null;
      return {
        agrupar: f.agrupar,
        items,
        totales: { total: d2(total), ...(costo ? { costo: d2(costo), margen: d2(total.minus(costo)), porcentaje: total.isZero() ? '0.0' : total.minus(costo).div(total).mul(100).toFixed(1) } : {}) },
      };
    });
  }

  /** Existencias por depósito, con valor al costo (si lo puede ver) y alerta de stock mínimo. */
  @Requiere('stock', 'ver')
  @Get('informes/stock')
  stock(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ depositoId: z.string().uuid().optional(), soloBajo: z.enum(['true', 'false']).optional(), buscar: z.string().trim().max(80).optional() }), query);
    const suc = sucursales(ctx);
    const verCosto = tiene(ctx, 'costo_producto.ver');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      if (f.depositoId) {
        const d = await tx.selectFrom('deposito').select(['id', 'sucursal_id']).where('id', '=', f.depositoId).executeTakeFirst();
        if (!d || (suc !== null && !suc.includes(d.sucursal_id))) throw noEncontrado('Depósito');
      }
      const { rows } = await sql<{ variante_id: string; producto: string; variante: string | null; sku: string | null; categoria: string | null; deposito_id: string; deposito: string; cantidad: string; minimo: string; costo: string }>`
        SELECT va.id AS variante_id, p.nombre AS producto, va.nombre AS variante, va.sku, cat.nombre AS categoria, d.id AS deposito_id, d.nombre AS deposito,
          coalesce(st.cantidad, 0) AS cantidad, va.stock_minimo AS minimo, va.costo
        FROM variante va JOIN producto p ON p.id = va.producto_id LEFT JOIN categoria cat ON cat.id = p.categoria_id
        JOIN deposito d ON d.activo AND ${filtroSuc('d.sucursal_id', suc)} ${f.depositoId ? sql`AND d.id = ${f.depositoId}` : sql``}
        LEFT JOIN stock st ON st.variante_id = va.id AND st.deposito_id = d.id
        WHERE va.activa AND p.activo AND p.controla_stock
          AND (coalesce(st.cantidad, 0) <> 0 OR va.stock_minimo > 0)
          ${f.soloBajo === 'true' ? sql`AND va.stock_minimo > 0 AND coalesce(st.cantidad, 0) < va.stock_minimo` : sql``}
          ${f.buscar ? sql`AND (p.nombre ILIKE ${'%' + f.buscar + '%'} OR va.sku ILIKE ${'%' + f.buscar + '%'})` : sql``}
        ORDER BY p.nombre, va.nombre NULLS FIRST, d.nombre LIMIT 5000`.execute(tx);
      let valor = new Decimal(0);
      const items = rows.map((x) => {
        const v = new Decimal(x.cantidad).mul(x.costo);
        if (new Decimal(x.cantidad).gt(0)) valor = valor.plus(v);
        return {
          varianteId: x.variante_id,
          nombre: x.variante ? `${x.producto} · ${x.variante}` : x.producto,
          sku: x.sku,
          categoria: x.categoria,
          depositoId: x.deposito_id,
          deposito: x.deposito,
          cantidad: new Decimal(x.cantidad).toString(),
          minimo: new Decimal(x.minimo).toString(),
          bajo: new Decimal(x.minimo).gt(0) && new Decimal(x.cantidad).lt(x.minimo),
          ...(verCosto ? { costo: d2(x.costo), valor: d2(v) } : {}),
        };
      });
      return { items, totales: { items: items.length, bajoMinimo: items.filter((i) => i.bajo).length, ...(verCosto ? { valor: d2(valor) } : {}) } };
    });
  }

  /** Compras agrupadas por proveedor, producto o mes (confirmadas). */
  @Requiere('recepcion', 'ver')
  @Get('informes/compras')
  compras(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.intersection(periodo, z.object({ agrupar: z.enum(['proveedor', 'producto', 'mes']).default('proveedor') })), query);
    if (f.sucursalId) throw invalido('El informe de compras es de toda la empresa');
    const suc = sucursales(ctx);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const filas =
        f.agrupar === 'producto'
          ? await sql<{ clave: string; nombre: string; documentos: string; cantidad: string; total: string }>`
              SELECT va.id::text AS clave, p.nombre || coalesce(' · ' || va.nombre, '') AS nombre, count(DISTINCT c.id) AS documentos, sum(i.cantidad) AS cantidad, sum(i.total) AS total
              FROM compra_item i JOIN compra c ON c.id = i.compra_id JOIN variante va ON va.id = i.variante_id JOIN producto p ON p.id = va.producto_id
              WHERE c.estado = 'confirmada' AND c.fecha_documento BETWEEN ${f.desde}::date AND ${f.hasta}::date AND ${filtroSuc('c.sucursal_id', suc)}
              GROUP BY 1, 2 ORDER BY sum(i.total) DESC LIMIT 2000`.execute(tx)
          : await sql<{ clave: string; nombre: string; documentos: string; cantidad: string; total: string }>`
              SELECT ${sql.raw(f.agrupar === 'mes' ? `to_char(c.fecha_documento, 'YYYY-MM')` : 'pr.id::text')} AS clave,
                ${sql.raw(f.agrupar === 'mes' ? `to_char(c.fecha_documento, 'YYYY-MM')` : 'pr.nombre')} AS nombre,
                count(*) AS documentos, count(*) AS cantidad, sum(c.total) AS total
              FROM compra c JOIN proveedor pr ON pr.id = c.proveedor_id
              WHERE c.estado = 'confirmada' AND c.fecha_documento BETWEEN ${f.desde}::date AND ${f.hasta}::date AND ${filtroSuc('c.sucursal_id', suc)}
              GROUP BY 1, 2 ORDER BY ${sql.raw(f.agrupar === 'mes' ? '1' : 'sum(c.total) DESC')} LIMIT 2000`.execute(tx);
      const items = filas.rows.map((x) => ({ clave: x.clave, nombre: x.nombre, documentos: Number(x.documentos), cantidad: new Decimal(x.cantidad).toString(), total: d2(x.total) }));
      return { agrupar: f.agrupar, items, totales: { total: d2(items.reduce((s, x) => s.plus(x.total), new Decimal(0))) } };
    });
  }
}
