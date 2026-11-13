import { CONCEPTOS_CONTABLES, type ConceptoContable } from '@kontiva/shared';
import Decimal from 'decimal.js';
import { sql } from 'kysely';
import type { Ctx } from '../comun/contexto';
import { conflicto, invalido } from '../comun/errores';
import type { Tx } from '../db/database';

export const hoyPy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
const fechaPy = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(d);
const diaSiguiente = (f: string) => {
  const d = new Date(`${f}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const fechaCorta = (f: string) => f.split('-').reverse().join('/');
const gs = (d: Decimal) => d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

/** Línea con monto con signo: positivo va al debe, negativo al haber. */
export interface Linea {
  cuentaId: string;
  monto: Decimal;
  detalle?: string | null;
}

export async function cerradoHasta(tx: Tx): Promise<string | null> {
  const { rows } = await sql<{ h: string | null }>`SELECT contabilidad_cerrado_hasta(app_empresa_id())::text AS h`.execute(tx);
  return rows[0]?.h ?? null;
}

/** Numeración correlativa de asientos; bloquea la empresa para que dos procesos no repitan números. */
export class Numerador {
  private n: number | null = null;
  async iniciar(tx: Tx) {
    await tx.selectFrom('empresa').select('id').forUpdate().executeTakeFirstOrThrow();
    const r = await tx.selectFrom('asiento').select((eb) => eb.fn.max<number>('numero').as('n')).executeTakeFirstOrThrow();
    this.n = Number(r.n ?? 0);
  }
  async siguiente(tx: Tx) {
    if (this.n === null) await this.iniciar(tx);
    return ++this.n!;
  }
}

/**
 * Registra un asiento balanceado. Si la fecha cae en un período cerrado, lo pasa al primer día abierto
 * (los documentos con fecha atrasada no reabren un período cerrado).
 */
export async function registrarAsiento(
  tx: Tx,
  ctx: Ctx,
  num: Numerador,
  cierre: string | null,
  a: { fecha: string; descripcion: string; origenTipo: string; origenId: string | null; lineas: Linea[] },
) {
  const lineas = a.lineas.filter((l) => !l.monto.isZero());
  const suma = lineas.reduce((s, l) => s.plus(l.monto), new Decimal(0));
  if (!suma.isZero()) throw new Error(`Asiento desbalanceado (${a.origenTipo}): diferencia ${suma.toFixed(2)}`);
  if (lineas.length < 2) return null;
  let fecha = a.fecha;
  let descripcion = a.descripcion;
  if (cierre && fecha <= cierre) {
    descripcion = `${descripcion} (fecha original ${fechaCorta(fecha)})`;
    fecha = diaSiguiente(cierre);
  }
  const numero = await num.siguiente(tx);
  const r = await tx
    .insertInto('asiento')
    .values({ empresa_id: ctx.empresaId, numero, fecha, descripcion: descripcion.slice(0, 300), origen_tipo: a.origenTipo, origen_id: a.origenId, creado_por: ctx.usuarioId })
    .returning('id')
    .executeTakeFirstOrThrow();
  await tx
    .insertInto('asiento_linea')
    .values(
      lineas.map((l, i) => ({
        empresa_id: ctx.empresaId,
        asiento_id: r.id,
        linea: i + 1,
        cuenta_id: l.cuentaId,
        debe: l.monto.gt(0) ? l.monto.toFixed(2) : '0',
        haber: l.monto.lt(0) ? l.monto.neg().toFixed(2) : '0',
        detalle: l.detalle ?? null,
      })),
    )
    .execute();
  return { id: r.id, numero, fecha };
}

/** Asiento inverso de otro (anulaciones). */
export async function revertirAsiento(tx: Tx, ctx: Ctx, num: Numerador, cierre: string | null, original: { id: string; numero: number }, a: { fecha: string; descripcion: string; origenTipo: string; origenId: string }) {
  const lineas = await tx.selectFrom('asiento_linea').selectAll().where('asiento_id', '=', original.id).orderBy('linea').execute();
  return registrarAsiento(tx, ctx, num, cierre, {
    ...a,
    lineas: lineas.map((l) => ({ cuentaId: l.cuenta_id, monto: new Decimal(l.haber).minus(l.debe), detalle: l.detalle })),
  });
}

/** Conceptos de sueldos: solo se exigen cuando hay liquidaciones para contabilizar (planes creados antes de RRHH). */
export const CONCEPTOS_RRHH: readonly ConceptoContable[] = ['sueldos', 'aportes_patronales', 'sueldos_pagar', 'ips_pagar', 'anticipos_personal'];

export async function mapaConceptos(tx: Tx) {
  const filas = await tx.selectFrom('cuenta_concepto').select(['concepto', 'cuenta_id']).execute();
  const m = new Map(filas.map((f) => [f.concepto as ConceptoContable, f.cuenta_id]));
  const todos = (Object.keys(CONCEPTOS_CONTABLES) as ConceptoContable[]).filter((c) => !m.has(c));
  return { m, faltan: todos.filter((c) => !CONCEPTOS_RRHH.includes(c)), faltanRrhh: todos.filter((c) => CONCEPTOS_RRHH.includes(c)) };
}

const TIPOS_ORIGEN = {
  venta: 'Ventas',
  devolucion: 'Devoluciones',
  compra: 'Compras',
  cuenta_pagar: 'Cuentas a pagar sin compra',
  pago_proveedor: 'Pagos a proveedores',
  cobro: 'Cobros',
  movimiento_bancario: 'Movimientos bancarios',
  liquidacion: 'Sueldos y aguinaldos',
} as const;
type Origen = keyof typeof TIPOS_ORIGEN;

/** Fecha contable de una liquidación: el último día del mes liquidado; el aguinaldo, el día de su confirmación. */
const fechaLiquidacion = (a: string) =>
  sql.raw(`(CASE WHEN ${a}.tipo = 'mensual' THEN (${a}.periodo + interval '1 month' - interval '1 day')::date ELSE (${a}.confirmada_en AT TIME ZONE 'America/Asuncion')::date END)`);

/** Cuántos documentos faltan contabilizar hasta la fecha, por tipo (originales y anulaciones). */
export async function pendientes(tx: Tx, hasta: string) {
  const { rows } = await sql<{ tipo: string; n: string }>`
    SELECT 'venta' AS tipo, count(*) AS n FROM venta v WHERE v.total > 0 AND (v.creado_en AT TIME ZONE 'America/Asuncion')::date <= ${hasta}::date
      AND NOT EXISTS (SELECT 1 FROM asiento a WHERE a.origen_tipo = 'venta' AND a.origen_id = v.id)
    UNION ALL SELECT 'venta', count(*) FROM venta v WHERE v.estado = 'anulada' AND v.total > 0 AND (v.anulada_en AT TIME ZONE 'America/Asuncion')::date <= ${hasta}::date
      AND NOT EXISTS (SELECT 1 FROM asiento a WHERE a.origen_tipo = 'venta_anulacion' AND a.origen_id = v.id)
    UNION ALL SELECT 'devolucion', count(*) FROM devolucion d WHERE d.total > 0 AND (d.creado_en AT TIME ZONE 'America/Asuncion')::date <= ${hasta}::date
      AND NOT EXISTS (SELECT 1 FROM asiento a WHERE a.origen_tipo = 'devolucion' AND a.origen_id = d.id)
    UNION ALL SELECT 'compra', count(*) FROM compra c WHERE c.total > 0 AND c.fecha_documento <= ${hasta}::date
      AND NOT EXISTS (SELECT 1 FROM asiento a WHERE a.origen_tipo = 'compra' AND a.origen_id = c.id)
    UNION ALL SELECT 'compra', count(*) FROM compra c WHERE c.estado = 'anulada' AND c.total > 0 AND (c.anulada_en AT TIME ZONE 'America/Asuncion')::date <= ${hasta}::date
      AND NOT EXISTS (SELECT 1 FROM asiento a WHERE a.origen_tipo = 'compra_anulacion' AND a.origen_id = c.id)
    UNION ALL SELECT 'cuenta_pagar', count(*) FROM cuenta_pagar k WHERE k.compra_id IS NULL AND k.fecha <= ${hasta}::date
      AND NOT EXISTS (SELECT 1 FROM asiento a WHERE a.origen_tipo = 'cuenta_pagar' AND a.origen_id = k.id)
    UNION ALL SELECT 'cuenta_pagar', count(*) FROM cuenta_pagar k WHERE k.compra_id IS NULL AND k.estado = 'anulada'
      AND NOT EXISTS (SELECT 1 FROM asiento a WHERE a.origen_tipo = 'cuenta_pagar_anulacion' AND a.origen_id = k.id)
    UNION ALL SELECT 'pago_proveedor', count(*) FROM pago_proveedor p WHERE p.fecha <= ${hasta}::date
      AND NOT EXISTS (SELECT 1 FROM asiento a WHERE a.origen_tipo = 'pago_proveedor' AND a.origen_id = p.id)
    UNION ALL SELECT 'pago_proveedor', count(*) FROM pago_proveedor p WHERE p.estado = 'anulado' AND (p.anulado_en AT TIME ZONE 'America/Asuncion')::date <= ${hasta}::date
      AND NOT EXISTS (SELECT 1 FROM asiento a WHERE a.origen_tipo = 'pago_proveedor_anulacion' AND a.origen_id = p.id)
    UNION ALL SELECT 'cobro', count(*) FROM cobro_cliente c WHERE c.fecha <= ${hasta}::date
      AND NOT EXISTS (SELECT 1 FROM asiento a WHERE a.origen_tipo = 'cobro' AND a.origen_id = c.id)
    UNION ALL SELECT 'cobro', count(*) FROM cobro_cliente c WHERE c.estado = 'anulado' AND (c.anulado_en AT TIME ZONE 'America/Asuncion')::date <= ${hasta}::date
      AND NOT EXISTS (SELECT 1 FROM asiento a WHERE a.origen_tipo = 'cobro_anulacion' AND a.origen_id = c.id)
    UNION ALL SELECT 'liquidacion', count(*) FROM liquidacion l WHERE l.confirmada_en IS NOT NULL AND ${fechaLiquidacion('l')} <= ${hasta}::date
      AND NOT EXISTS (SELECT 1 FROM asiento a WHERE a.origen_tipo = 'liquidacion' AND a.origen_id = l.id)
    UNION ALL SELECT 'liquidacion', count(*) FROM liquidacion l WHERE l.estado = 'anulada' AND l.confirmada_en IS NOT NULL
      AND greatest((l.anulada_en AT TIME ZONE 'America/Asuncion')::date, ${fechaLiquidacion('l')}) <= ${hasta}::date
      AND NOT EXISTS (SELECT 1 FROM asiento a WHERE a.origen_tipo = 'liquidacion_anulacion' AND a.origen_id = l.id)
    UNION ALL SELECT 'liquidacion', count(*) FROM liquidacion l WHERE l.pago_fecha IS NOT NULL AND l.pago_fecha <= ${hasta}::date
      AND NOT EXISTS (SELECT 1 FROM asiento a WHERE a.origen_tipo = 'pago_liquidacion' AND a.origen_id = l.id)
    UNION ALL SELECT 'movimiento_bancario', count(*) FROM movimiento_bancario m WHERE m.origen_tipo IN ('manual', 'transferencia', 'caja') AND m.fecha <= ${hasta}::date
      AND NOT EXISTS (SELECT 1 FROM asiento a WHERE a.origen_tipo = 'movimiento_bancario' AND a.origen_id = m.id)`.execute(tx);
  const r = Object.fromEntries(Object.keys(TIPOS_ORIGEN).map((k) => [k, 0])) as Record<Origen, number>;
  for (const x of rows) r[x.tipo as Origen] += Number(x.n);
  return { porTipo: (Object.keys(TIPOS_ORIGEN) as Origen[]).map((k) => ({ tipo: k, nombre: TIPOS_ORIGEN[k], cantidad: r[k] })), total: Object.values(r).reduce((a, b) => a + b, 0) };
}

/**
 * Genera los asientos de todos los documentos aún no contabilizados con fecha hasta `hasta`.
 * Idempotente: cada documento genera un asiento (y otro inverso si se anuló).
 */
export async function contabilizar(tx: Tx, ctx: Ctx, hasta: string) {
  const { m, faltan, faltanRrhh } = await mapaConceptos(tx);
  if (faltan.length) throw conflicto('CONFIGURACION_INCOMPLETA', `Asigne una cuenta a: ${faltan.map((f) => CONCEPTOS_CONTABLES[f]).join(', ')}`);
  if (faltanRrhh.length) {
    const hay = await tx.selectFrom('liquidacion').select('id').where('confirmada_en', 'is not', null).limit(1).executeTakeFirst();
    if (hay) throw conflicto('CONFIGURACION_INCOMPLETA', `Para contabilizar los sueldos, asigne una cuenta a: ${faltanRrhh.map((f) => CONCEPTOS_CONTABLES[f]).join(', ')}`);
  }
  const c = (k: ConceptoContable) => m.get(k)!;
  const num = new Numerador();
  await num.iniciar(tx);
  const cierre = await cerradoHasta(tx);
  const bancos = new Map((await tx.selectFrom('cuenta_bancaria').select(['id', 'cuenta_contable_id', 'banco', 'nombre']).execute()).map((b) => [b.id, b]));
  const cuentaBanco = (id: string) => bancos.get(id)?.cuenta_contable_id ?? c('bancos');
  const generados: Record<string, number> = {};
  const contar = (t: string) => (generados[t] = (generados[t] ?? 0) + 1);
  // Se juntan todos los documentos pendientes y se numeran en orden de fecha (las anulaciones al final del día).
  const cola: { fecha: string; orden: number; correr: () => Promise<unknown> }[] = [];
  const asiento = (a: Parameters<typeof registrarAsiento>[4]) => {
    cola.push({
      fecha: a.fecha,
      orden: 0,
      correr: async () => {
        const r = await registrarAsiento(tx, ctx, num, cierre, a);
        if (r) contar(a.origenTipo);
      },
    });
  };
  const revertir = async (origenTipo: string, id: string, fecha: string, descripcion: string) => {
    const o = await tx.selectFrom('asiento').select(['id', 'numero']).where('origen_tipo', '=', origenTipo).where('origen_id', '=', id).executeTakeFirst();
    if (!o) return;
    const r = await revertirAsiento(tx, ctx, num, cierre, o, { fecha, descripcion, origenTipo: `${origenTipo}_anulacion`, origenId: id });
    if (r) contar(origenTipo);
  };
  const noContabilizado = (tipo: string) => sql<boolean>`NOT EXISTS (SELECT 1 FROM asiento a WHERE a.origen_tipo = ${tipo} AND a.origen_id = x.id)`;

  // ── Ventas ──
  const ventas = await sql<{ id: string; numero: string; fecha: string; total: string; credito: string; iva10: string; iva5: string; comprobante: string }>`
    SELECT x.id, x.numero, (x.creado_en AT TIME ZONE 'America/Asuncion')::date::text AS fecha, x.total, x.credito, x.iva10, x.iva5, x.comprobante
    FROM venta x WHERE x.total > 0 AND (x.creado_en AT TIME ZONE 'America/Asuncion')::date <= ${hasta}::date AND ${noContabilizado('venta')} ORDER BY x.creado_en`.execute(tx);
  for (let i = 0; i < ventas.rows.length; i += 500) {
    const lote = ventas.rows.slice(i, i + 500);
    const ids = lote.map((v) => v.id);
    const pagos = await tx.selectFrom('venta_pago').select(['venta_id', 'medio', 'monto_pyg']).where('venta_id', 'in', ids).execute();
    const items = await tx.selectFrom('venta_item').select(['venta_id', 'cantidad', 'costo_unitario', 'tasa_iva']).where('venta_id', 'in', ids).execute();
    for (const v of lote) {
      const total = new Decimal(v.total);
      const credito = new Decimal(v.credito);
      const iva = new Decimal(v.iva10).plus(v.iva5);
      let efectivo = new Decimal(0);
      let otros = new Decimal(0);
      for (const p of pagos.filter((p) => p.venta_id === v.id)) {
        if (p.medio === 'efectivo') efectivo = efectivo.plus(p.monto_pyg);
        else otros = otros.plus(p.monto_pyg);
      }
      // El vuelto sale del efectivo: lo cobrado de más no es venta.
      let exceso = efectivo.plus(otros).minus(total.minus(credito));
      if (exceso.gt(0)) {
        const delEfectivo = Decimal.min(exceso, efectivo);
        efectivo = efectivo.minus(delEfectivo);
        exceso = exceso.minus(delEfectivo);
        otros = otros.minus(exceso);
      } else if (exceso.lt(0)) {
        otros = otros.minus(exceso); // diferencia por redondeo de cotización: se ajusta en valores
      }
      const costo = gs(
        items
          .filter((x) => x.venta_id === v.id)
          .reduce((s, x) => s.plus(new Decimal(x.cantidad).mul(x.costo_unitario).mul(100).div(new Decimal(100).plus(x.tasa_iva))), new Decimal(0)),
      );
      asiento({
        fecha: v.fecha,
        descripcion: `Venta N.º ${v.numero}${v.comprobante === 'factura' ? ' (factura electrónica)' : ''}`,
        origenTipo: 'venta',
        origenId: v.id,
        lineas: [
          { cuentaId: c('caja'), monto: efectivo },
          { cuentaId: c('valores'), monto: otros },
          { cuentaId: c('deudores'), monto: credito },
          { cuentaId: c('ventas'), monto: total.minus(iva).neg() },
          { cuentaId: c('iva_debito'), monto: iva.neg() },
          { cuentaId: c('costo_ventas'), monto: costo, detalle: 'Costo de lo vendido' },
          { cuentaId: c('mercaderias'), monto: costo.neg(), detalle: 'Costo de lo vendido' },
        ],
      });
    }
  }

  // ── Compras ──
  const compras = await sql<{ id: string; numero: string; fecha: string; total: string; iva10: string; iva5: string; documento: string | null; proveedor: string }>`
    SELECT x.id, x.numero, x.fecha_documento::text AS fecha, x.total, x.iva10, x.iva5, x.documento_numero AS documento, p.nombre AS proveedor
    FROM compra x JOIN proveedor p ON p.id = x.proveedor_id
    WHERE x.total > 0 AND x.fecha_documento <= ${hasta}::date AND ${noContabilizado('compra')} ORDER BY x.fecha_documento, x.numero`.execute(tx);
  for (const k of compras.rows) {
    const total = new Decimal(k.total);
    const iva = new Decimal(k.iva10).plus(k.iva5);
    asiento({
      fecha: k.fecha,
      descripcion: `Compra N.º ${k.numero} · ${k.proveedor}${k.documento ? ` · ${k.documento}` : ''}`,
      origenTipo: 'compra',
      origenId: k.id,
      lineas: [
        { cuentaId: c('mercaderias'), monto: total.minus(iva) },
        { cuentaId: c('iva_credito'), monto: iva },
        { cuentaId: c('proveedores'), monto: total.neg() },
      ],
    });
  }

  // ── Cuentas a pagar sin compra (gastos) ──
  const gastos = await sql<{ id: string; fecha: string; monto: string; descripcion: string; proveedor: string }>`
    SELECT x.id, x.fecha::text AS fecha, x.monto, x.descripcion, p.nombre AS proveedor
    FROM cuenta_pagar x JOIN proveedor p ON p.id = x.proveedor_id
    WHERE x.compra_id IS NULL AND x.fecha <= ${hasta}::date AND ${noContabilizado('cuenta_pagar')} ORDER BY x.fecha`.execute(tx);
  for (const g of gastos.rows) {
    asiento({
      fecha: g.fecha,
      descripcion: `${g.descripcion} · ${g.proveedor}`,
      origenTipo: 'cuenta_pagar',
      origenId: g.id,
      lineas: [
        { cuentaId: c('gastos_generales'), monto: new Decimal(g.monto) },
        { cuentaId: c('proveedores'), monto: new Decimal(g.monto).neg() },
      ],
    });
  }

  // ── Devoluciones ──
  const devs = await sql<{ id: string; numero: string; fecha: string; total: string; medio: string; venta: string; descontado: string }>`
    SELECT x.id, x.numero, (x.creado_en AT TIME ZONE 'America/Asuncion')::date::text AS fecha, x.total, x.medio, v.numero AS venta,
           coalesce((SELECT sum(a.monto) FROM cobro_aplicacion a WHERE a.devolucion_id = x.id), 0) AS descontado
    FROM devolucion x JOIN venta v ON v.id = x.venta_id
    WHERE x.total > 0 AND (x.creado_en AT TIME ZONE 'America/Asuncion')::date <= ${hasta}::date AND ${noContabilizado('devolucion')} ORDER BY x.creado_en`.execute(tx);
  for (const d of devs.rows) {
    const items = await sql<{ total: string; cantidad: string; tasa_iva: string; costo_unitario: string }>`
      SELECT di.total, di.cantidad, vi.tasa_iva, vi.costo_unitario
      FROM devolucion_item di JOIN devolucion x ON x.id = di.devolucion_id
      JOIN venta_item vi ON vi.venta_id = x.venta_id AND vi.linea = di.linea_venta
      WHERE di.devolucion_id = ${d.id}`.execute(tx);
    const total = new Decimal(d.total);
    const iva = items.rows.reduce((s, x) => s.plus(gs(new Decimal(x.total).mul(x.tasa_iva).div(new Decimal(100).plus(x.tasa_iva)))), new Decimal(0));
    const costo = gs(items.rows.reduce((s, x) => s.plus(new Decimal(x.cantidad).mul(x.costo_unitario).mul(100).div(new Decimal(100).plus(x.tasa_iva))), new Decimal(0)));
    const descontado = new Decimal(d.descontado);
    asiento({
      fecha: d.fecha,
      descripcion: `Devolución N.º ${d.numero} de la venta N.º ${d.venta}`,
      origenTipo: 'devolucion',
      origenId: d.id,
      lineas: [
        { cuentaId: c('devoluciones_ventas'), monto: total.minus(iva) },
        { cuentaId: c('iva_debito'), monto: iva },
        { cuentaId: c('deudores'), monto: descontado.neg() },
        { cuentaId: c(d.medio === 'efectivo' ? 'caja' : 'valores'), monto: total.minus(descontado).neg() },
        { cuentaId: c('mercaderias'), monto: costo, detalle: 'Mercadería devuelta al stock' },
        { cuentaId: c('costo_ventas'), monto: costo.neg(), detalle: 'Mercadería devuelta al stock' },
      ],
    });
  }

  // ── Pagos a proveedores ──
  const pagos = await sql<{ id: string; numero: string; fecha: string; monto: string; medio: string; cuenta_bancaria_id: string | null; proveedor: string }>`
    SELECT x.id, x.numero, x.fecha::text AS fecha, x.monto, x.medio, x.cuenta_bancaria_id, p.nombre AS proveedor
    FROM pago_proveedor x JOIN proveedor p ON p.id = x.proveedor_id
    WHERE x.fecha <= ${hasta}::date AND ${noContabilizado('pago_proveedor')} ORDER BY x.fecha, x.numero`.execute(tx);
  for (const p of pagos.rows) {
    const monto = new Decimal(p.monto);
    const sale = p.cuenta_bancaria_id ? cuentaBanco(p.cuenta_bancaria_id) : p.medio === 'efectivo' ? c('caja') : c('bancos');
    asiento({
      fecha: p.fecha,
      descripcion: `Pago N.º ${p.numero} · ${p.proveedor}`,
      origenTipo: 'pago_proveedor',
      origenId: p.id,
      lineas: [
        { cuentaId: c('proveedores'), monto },
        { cuentaId: sale, monto: monto.neg() },
      ],
    });
  }

  // ── Cobros ──
  const cobros = await sql<{ id: string; numero: string; fecha: string; monto: string; medio: string; cuenta_bancaria_id: string | null; cliente: string }>`
    SELECT x.id, x.numero, x.fecha::text AS fecha, x.monto, x.medio, x.cuenta_bancaria_id, cl.nombre AS cliente
    FROM cobro_cliente x JOIN cliente cl ON cl.id = x.cliente_id
    WHERE x.fecha <= ${hasta}::date AND ${noContabilizado('cobro')} ORDER BY x.fecha, x.numero`.execute(tx);
  for (const k of cobros.rows) {
    const monto = new Decimal(k.monto);
    const entra = k.cuenta_bancaria_id ? cuentaBanco(k.cuenta_bancaria_id) : k.medio === 'efectivo' ? c('caja') : c('valores');
    asiento({
      fecha: k.fecha,
      descripcion: `Cobro N.º ${k.numero} · ${k.cliente}`,
      origenTipo: 'cobro',
      origenId: k.id,
      lineas: [
        { cuentaId: entra, monto },
        { cuentaId: c('deudores'), monto: monto.neg() },
      ],
    });
  }

  // ── Movimientos bancarios propios (los de pagos y cobros ya están en sus asientos) ──
  const movs = await sql<{ id: string; cuenta_id: string; fecha: string; tipo: string; monto: string; descripcion: string }>`
    SELECT x.id, x.cuenta_id, x.fecha::text AS fecha, x.tipo, x.monto, x.descripcion
    FROM movimiento_bancario x
    WHERE x.origen_tipo IN ('manual', 'transferencia', 'caja') AND x.fecha <= ${hasta}::date AND ${noContabilizado('movimiento_bancario')}
    ORDER BY x.fecha, x.id`.execute(tx);
  const contrapartida: Record<string, ConceptoContable> = {
    deposito: 'deposito_manual',
    extraccion: 'extraccion_manual',
    gasto: 'gastos_bancarios',
    ingreso: 'ingresos_financieros',
    transferencia_entrada: 'transferencias',
    transferencia_salida: 'transferencias',
    deposito_caja: 'caja',
  };
  for (const mv of movs.rows) {
    const concepto = contrapartida[mv.tipo];
    if (!concepto) continue;
    const monto = new Decimal(mv.monto);
    const b = bancos.get(mv.cuenta_id);
    asiento({
      fecha: mv.fecha,
      descripcion: `${mv.descripcion}${b ? ` · ${b.banco} ${b.nombre}` : ''}`,
      origenTipo: 'movimiento_bancario',
      origenId: mv.id,
      lineas: [
        { cuentaId: cuentaBanco(mv.cuenta_id), monto },
        { cuentaId: c(concepto), monto: monto.neg() },
      ],
    });
  }

  // ── Sueldos y aguinaldos ──
  const liqs = await sql<{ id: string; tipo: string; periodo: string; fecha: string; bruto: string; ips_obrero: string; ips_patronal: string; descuentos: string; neto: string }>`
    SELECT x.id, x.tipo, x.periodo::text AS periodo, ${fechaLiquidacion('x')}::text AS fecha, x.bruto, x.ips_obrero, x.ips_patronal, x.descuentos, x.neto
    FROM liquidacion x WHERE x.confirmada_en IS NOT NULL AND ${fechaLiquidacion('x')} <= ${hasta}::date AND ${noContabilizado('liquidacion')}`.execute(tx);
  const nombreLiq = (l: { tipo: string; periodo: string }) =>
    l.tipo === 'aguinaldo' ? `Aguinaldo ${l.periodo.slice(0, 4)}` : `Sueldos de ${new Intl.DateTimeFormat('es-PY', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${l.periodo}T12:00:00Z`))}`;
  for (const l of liqs.rows) {
    const ipsO = new Decimal(l.ips_obrero);
    const ipsP = new Decimal(l.ips_patronal);
    asiento({
      fecha: l.fecha,
      descripcion: `Liquidación: ${nombreLiq(l)}`,
      origenTipo: 'liquidacion',
      origenId: l.id,
      lineas: [
        { cuentaId: c('sueldos'), monto: new Decimal(l.bruto) },
        { cuentaId: c('aportes_patronales'), monto: ipsP },
        { cuentaId: c('ips_pagar'), monto: ipsO.plus(ipsP).neg() },
        { cuentaId: c('anticipos_personal'), monto: new Decimal(l.descuentos).neg() },
        { cuentaId: c('sueldos_pagar'), monto: new Decimal(l.neto).neg() },
      ],
    });
  }
  const pagosLiq = await sql<{ id: string; tipo: string; periodo: string; fecha: string; neto: string; pago_medio: string; pago_cuenta_id: string | null }>`
    SELECT x.id, x.tipo, x.periodo::text AS periodo, x.pago_fecha::text AS fecha, x.neto, x.pago_medio, x.pago_cuenta_id
    FROM liquidacion x WHERE x.pago_fecha IS NOT NULL AND x.pago_fecha <= ${hasta}::date AND ${noContabilizado('pago_liquidacion')}`.execute(tx);
  for (const l of pagosLiq.rows) {
    const neto = new Decimal(l.neto);
    cola.push({
      fecha: l.fecha,
      orden: 0.5, // después de la liquidación del mismo día
      correr: async () => {
        const r = await registrarAsiento(tx, ctx, num, cierre, {
          fecha: l.fecha,
          descripcion: `Pago de ${nombreLiq(l).toLowerCase()}`,
          origenTipo: 'pago_liquidacion',
          origenId: l.id,
          lineas: [
            { cuentaId: c('sueldos_pagar'), monto: neto },
            { cuentaId: l.pago_medio === 'banco' && l.pago_cuenta_id ? cuentaBanco(l.pago_cuenta_id) : c('caja'), monto: neto.neg() },
          ],
        });
        if (r) contar('liquidacion');
      },
    });
  }

  // ── Anulaciones: asiento inverso con la fecha de la anulación ──
  const hoy = hoyPy();
  const tope = hasta < hoy ? hasta : hoy;
  const anuladas = await sql<{ tipo: string; id: string; fecha: string; descripcion: string }>`
    SELECT 'venta' AS tipo, x.id, (x.anulada_en AT TIME ZONE 'America/Asuncion')::date::text AS fecha, 'Anulación de la venta N.º ' || x.numero || coalesce(' · ' || x.motivo_anulacion, '') AS descripcion
      FROM venta x WHERE x.estado = 'anulada' AND x.total > 0 AND (x.anulada_en AT TIME ZONE 'America/Asuncion')::date <= ${hasta}::date AND ${noContabilizado('venta_anulacion')}
    UNION ALL
    SELECT 'compra', x.id, (x.anulada_en AT TIME ZONE 'America/Asuncion')::date::text, 'Anulación de la compra N.º ' || x.numero || coalesce(' · ' || x.motivo_anulacion, '')
      FROM compra x WHERE x.estado = 'anulada' AND x.total > 0 AND (x.anulada_en AT TIME ZONE 'America/Asuncion')::date <= ${hasta}::date AND ${noContabilizado('compra_anulacion')}
    UNION ALL
    SELECT 'cuenta_pagar', x.id, ${tope}::text, 'Anulación: ' || x.descripcion
      FROM cuenta_pagar x WHERE x.compra_id IS NULL AND x.estado = 'anulada' AND ${noContabilizado('cuenta_pagar_anulacion')}
    UNION ALL
    SELECT 'pago_proveedor', x.id, (x.anulado_en AT TIME ZONE 'America/Asuncion')::date::text, 'Anulación del pago N.º ' || x.numero
      FROM pago_proveedor x WHERE x.estado = 'anulado' AND (x.anulado_en AT TIME ZONE 'America/Asuncion')::date <= ${hasta}::date AND ${noContabilizado('pago_proveedor_anulacion')}
    UNION ALL
    SELECT 'cobro', x.id, (x.anulado_en AT TIME ZONE 'America/Asuncion')::date::text, 'Anulación del cobro N.º ' || x.numero
      FROM cobro_cliente x WHERE x.estado = 'anulado' AND (x.anulado_en AT TIME ZONE 'America/Asuncion')::date <= ${hasta}::date AND ${noContabilizado('cobro_anulacion')}
    UNION ALL
    SELECT 'liquidacion', x.id, greatest((x.anulada_en AT TIME ZONE 'America/Asuncion')::date, ${fechaLiquidacion('x')})::text, 'Anulación de la liquidación de ' || to_char(x.periodo, 'MM/YYYY') || coalesce(' · ' || x.motivo_anulacion, '')
      FROM liquidacion x WHERE x.estado = 'anulada' AND x.confirmada_en IS NOT NULL
        AND greatest((x.anulada_en AT TIME ZONE 'America/Asuncion')::date, ${fechaLiquidacion('x')}) <= ${hasta}::date AND ${noContabilizado('liquidacion_anulacion')}
    ORDER BY 3`.execute(tx);
  for (const a of anuladas.rows) cola.push({ fecha: a.fecha, orden: 1, correr: () => revertir(a.tipo, a.id, a.fecha, a.descripcion) });

  cola.sort((x, y) => (x.fecha < y.fecha ? -1 : x.fecha > y.fecha ? 1 : x.orden - y.orden));
  for (const t of cola) await t.correr();

  const total = Object.values(generados).reduce((s, n) => s + n, 0);
  return { generados: total, porTipo: generados };
}

export function validarCuentaImputable(c: { imputable: boolean; activa: boolean } | undefined) {
  if (!c) throw invalido('La cuenta contable no existe');
  if (!c.imputable) throw invalido('Elija una cuenta imputable (no un grupo)');
  if (!c.activa) throw invalido('La cuenta contable está inactiva');
}
