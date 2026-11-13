import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { asientoManualEntrada, cierreContableEntrada, conceptosContablesEntrada, cuentaContableEntrada, CONCEPTOS_CONTABLES, type ConceptoContable } from '@kontiva/shared';
import Decimal from 'decimal.js';
import { sql } from 'kysely';
import { z } from 'zod';
import { auditar } from '../comun/auditoria';
import { Contexto, OrigenPeticion, type Ctx, type Origen } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { conflicto, invalido, noEncontrado } from '../comun/errores';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';
import { cerradoHasta, contabilizar, hoyPy, mapaConceptos, Numerador, registrarAsiento, revertirAsiento, pendientes, validarCuentaImputable } from './motor';
import { CONCEPTOS_EXTRA, PLAN_SUGERIDO, tipoPorCodigo } from './plan';

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const periodo = z.object({ desde: dia, hasta: dia }).refine((p) => p.desde <= p.hasta, { message: 'La fecha inicial es posterior a la final' });

/** Padre de un código: el código existente más largo que lo antecede (1.1.07 → 1.1). */
function codigoPadre(codigo: string) {
  const p = codigo.split('.');
  return p.length > 1 ? p.slice(0, -1).join('.') : null;
}

async function cuentas(tx: Tx) {
  return tx.selectFrom('cuenta_contable').select(['id', 'codigo', 'nombre', 'tipo', 'imputable', 'padre_id', 'activa']).orderBy(sql`string_to_array(codigo, '.')::int[]`).execute();
}

async function leerAsiento(tx: Tx, id: string) {
  const a = await tx
    .selectFrom('asiento as a')
    .innerJoin('usuario as u', 'u.id', 'a.creado_por')
    .select(['a.id', 'a.numero', 'a.fecha', 'a.descripcion', 'a.origen_tipo', 'a.origen_id', 'a.estado', 'a.motivo_anulacion', 'a.creado_en', 'u.nombre as usuario'])
    .where('a.id', '=', id)
    .executeTakeFirst();
  if (!a) throw noEncontrado('Asiento');
  const lineas = await tx
    .selectFrom('asiento_linea as l')
    .innerJoin('cuenta_contable as c', 'c.id', 'l.cuenta_id')
    .select(['l.linea', 'l.cuenta_id', 'c.codigo', 'c.nombre', 'l.debe', 'l.haber', 'l.detalle'])
    .where('l.asiento_id', '=', id)
    .orderBy('l.linea')
    .execute();
  return formatoAsiento(a, lineas);
}

function formatoAsiento(
  a: { id: string; numero: number; fecha: string; descripcion: string; origen_tipo: string; origen_id: string | null; estado: string; motivo_anulacion?: string | null; usuario?: string },
  lineas: { cuenta_id: string; codigo: string; nombre: string; debe: string; haber: string; detalle: string | null }[],
) {
  return {
    id: a.id,
    numero: a.numero,
    fecha: a.fecha,
    descripcion: a.descripcion,
    origen: a.origen_tipo,
    origenId: a.origen_id,
    estado: a.estado,
    motivoAnulacion: a.motivo_anulacion ?? null,
    usuario: a.usuario,
    total: lineas.reduce((s, l) => s.plus(l.debe), new Decimal(0)).toFixed(2),
    lineas: lineas.map((l) => ({ cuentaId: l.cuenta_id, codigo: l.codigo, cuenta: l.nombre, debe: l.debe, haber: l.haber, detalle: l.detalle })),
  };
}

@Controller('contabilidad')
export class ContabilidadController {
  constructor(private readonly db: Db) {}

  // ── Plan de cuentas y configuración ──

  @Requiere('contabilidad', 'ver')
  @Get('cuentas')
  plan(@Contexto() ctx: Ctx) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const lista = await cuentas(tx);
      const usadas = new Set((await tx.selectFrom('asiento_linea').select('cuenta_id').distinct().execute()).map((x) => x.cuenta_id));
      const { m } = await mapaConceptos(tx);
      const bancos = await tx.selectFrom('cuenta_bancaria').select(['id', 'banco', 'nombre', 'cuenta_contable_id', 'activa']).orderBy('banco').execute();
      return {
        cuentas: lista.map((c) => ({ id: c.id, codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, imputable: c.imputable, padreId: c.padre_id, activa: c.activa, conMovimientos: usadas.has(c.id) })),
        conceptos: (Object.keys(CONCEPTOS_CONTABLES) as ConceptoContable[]).map((k) => ({ concepto: k, nombre: CONCEPTOS_CONTABLES[k], cuentaId: m.get(k) ?? null })),
        bancos: bancos.map((b) => ({ id: b.id, banco: b.banco, nombre: b.nombre, activa: b.activa, cuentaContableId: b.cuenta_contable_id })),
      };
    });
  }

  @Requiere('contabilidad', 'aprobar')
  @Post('cuentas/plan-sugerido')
  planSugerido(@Contexto() ctx: Ctx, @OrigenPeticion() o: Origen) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const existe = await tx.selectFrom('cuenta_contable').select('id').limit(1).executeTakeFirst();
      if (existe) throw conflicto('PLAN_EXISTENTE', 'La empresa ya tiene un plan de cuentas');
      const ids = new Map<string, string>();
      for (const c of PLAN_SUGERIDO) {
        const padre = codigoPadre(c.codigo);
        const r = await tx
          .insertInto('cuenta_contable')
          .values({ empresa_id: ctx.empresaId, codigo: c.codigo, nombre: c.nombre, tipo: tipoPorCodigo(c.codigo), imputable: c.imputable, padre_id: padre ? ids.get(padre)! : null })
          .returning('id')
          .executeTakeFirstOrThrow();
        ids.set(c.codigo, r.id);
      }
      const conceptos = [
        ...PLAN_SUGERIDO.filter((c) => c.concepto).map((c) => ({ concepto: c.concepto!, cuenta_id: ids.get(c.codigo)! })),
        ...Object.entries(CONCEPTOS_EXTRA).map(([k, codigo]) => ({ concepto: k, cuenta_id: ids.get(codigo!)! })),
      ];
      await tx.insertInto('cuenta_concepto').values(conceptos.map((c) => ({ empresa_id: ctx.empresaId, ...c }))).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'plan_sugerido', entidad: 'cuenta_contable', entidadId: ids.get('1')!, despues: { cuentas: PLAN_SUGERIDO.length } });
      return { cuentas: PLAN_SUGERIDO.length };
    });
  }

  /** Agrega al plan las cuentas sugeridas que falten (por ejemplo, las de sueldos) y asigna los conceptos sin cuenta. No cambia lo existente. */
  @Requiere('contabilidad', 'aprobar')
  @Post('cuentas/completar-sugerido')
  @HttpCode(200)
  completarSugerido(@Contexto() ctx: Ctx, @OrigenPeticion() o: Origen) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const existentes = new Map((await cuentas(tx)).map((c) => [c.codigo, c]));
      if (!existentes.size) throw invalido('Primero cree el plan de cuentas');
      let creadas = 0;
      for (const c of PLAN_SUGERIDO) {
        if (existentes.has(c.codigo)) continue;
        const padre = codigoPadre(c.codigo);
        const p = padre ? existentes.get(padre) : null;
        if (padre && (!p || p.imputable)) continue;
        const r = await tx
          .insertInto('cuenta_contable')
          .values({ empresa_id: ctx.empresaId, codigo: c.codigo, nombre: c.nombre, tipo: tipoPorCodigo(c.codigo), imputable: c.imputable, padre_id: p?.id ?? null })
          .returning(['id', 'codigo', 'nombre', 'tipo', 'imputable', 'padre_id', 'activa'])
          .executeTakeFirstOrThrow();
        existentes.set(c.codigo, r);
        creadas++;
      }
      const { m } = await mapaConceptos(tx);
      const asignados: string[] = [];
      const sugeridos = [...PLAN_SUGERIDO.filter((c) => c.concepto).map((c) => [c.concepto!, c.codigo] as const), ...Object.entries(CONCEPTOS_EXTRA).map(([k, v]) => [k as ConceptoContable, v!] as const)];
      for (const [concepto, codigo] of sugeridos) {
        if (m.has(concepto)) continue;
        const cta = existentes.get(codigo);
        if (!cta || !cta.imputable || !cta.activa) continue;
        await tx.insertInto('cuenta_concepto').values({ empresa_id: ctx.empresaId, concepto, cuenta_id: cta.id }).execute();
        asignados.push(concepto);
      }
      await auditar(tx, { ...ctx, ...o }, { accion: 'completar_plan', entidad: 'cuenta_contable', entidadId: ctx.empresaId, despues: { creadas, asignados } });
      return { creadas, asignados: asignados.length };
    });
  }

  @Requiere('contabilidad', 'aprobar')
  @Post('cuentas')
  crearCuenta(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(cuentaContableEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const codPadre = codigoPadre(d.codigo);
      let padreId: string | null = null;
      if (codPadre) {
        const padre = await tx.selectFrom('cuenta_contable').selectAll().where('codigo', '=', codPadre).executeTakeFirst();
        if (!padre) throw invalido(`Primero cree la cuenta ${codPadre}`);
        if (padre.imputable) throw invalido(`La cuenta ${codPadre} es imputable: no puede tener subcuentas`);
        padreId = padre.id;
      }
      const dup = await tx.selectFrom('cuenta_contable').select('id').where('codigo', '=', d.codigo).executeTakeFirst();
      if (dup) throw conflicto('CODIGO_DUPLICADO', `Ya existe la cuenta ${d.codigo}`);
      const r = await tx
        .insertInto('cuenta_contable')
        .values({ empresa_id: ctx.empresaId, codigo: d.codigo, nombre: d.nombre, tipo: tipoPorCodigo(d.codigo), imputable: d.imputable, padre_id: padreId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'cuenta_contable', entidadId: r.id, despues: d });
      return { id: r.id };
    });
  }

  @Requiere('contabilidad', 'aprobar')
  @Patch('cuentas/:id')
  editarCuenta(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(cuentaContableEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const c = await tx.selectFrom('cuenta_contable').selectAll().where('id', '=', id).executeTakeFirst();
      if (!c) throw noEncontrado('Cuenta contable');
      if (d.codigo !== c.codigo) throw invalido('El código de una cuenta no se cambia: cree una nueva');
      if (d.imputable !== c.imputable) {
        const conLineas = await tx.selectFrom('asiento_linea').select('linea').where('cuenta_id', '=', id).limit(1).executeTakeFirst();
        const hijas = await tx.selectFrom('cuenta_contable').select('id').where('padre_id', '=', id).limit(1).executeTakeFirst();
        if (conLineas || hijas) throw conflicto('CUENTA_EN_USO', 'La cuenta ya tiene movimientos o subcuentas: no puede cambiar si es imputable');
      }
      const activa = d.activa ?? c.activa;
      if (!activa || !d.imputable) {
        const enUso = await tx.selectFrom('cuenta_concepto').select('concepto').where('cuenta_id', '=', id).executeTakeFirst();
        const banco = await tx.selectFrom('cuenta_bancaria').select('id').where('cuenta_contable_id', '=', id).executeTakeFirst();
        if (enUso || banco) throw conflicto('CUENTA_EN_USO', 'La cuenta está asignada en la configuración de asientos automáticos');
      }
      await tx.updateTable('cuenta_contable').set({ nombre: d.nombre, imputable: d.imputable, activa }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'editar', entidad: 'cuenta_contable', entidadId: id, antes: { nombre: c.nombre, imputable: c.imputable, activa: c.activa }, despues: d });
      return { ok: true };
    });
  }

  @Requiere('contabilidad', 'aprobar')
  @Put('conceptos')
  conceptos(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(conceptosContablesEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const todas = new Map((await cuentas(tx)).map((c) => [c.id, c]));
      for (const [concepto, cuentaId] of Object.entries(d.conceptos)) {
        validarCuentaImputable(todas.get(cuentaId!));
        await tx
          .insertInto('cuenta_concepto')
          .values({ empresa_id: ctx.empresaId, concepto, cuenta_id: cuentaId! })
          .onConflict((oc) => oc.columns(['empresa_id', 'concepto']).doUpdateSet({ cuenta_id: cuentaId! }))
          .execute();
      }
      for (const [bancoId, cuentaId] of Object.entries(d.bancos)) {
        if (cuentaId) validarCuentaImputable(todas.get(cuentaId));
        const r = await tx.updateTable('cuenta_bancaria').set({ cuenta_contable_id: cuentaId }).where('id', '=', bancoId).executeTakeFirst();
        if (!Number(r.numUpdatedRows)) throw noEncontrado('Cuenta bancaria');
      }
      await auditar(tx, { ...ctx, ...o }, { accion: 'configurar', entidad: 'cuenta_concepto', entidadId: ctx.empresaId, despues: d });
      return { ok: true };
    });
  }

  // ── Contabilización y cierres ──

  @Requiere('contabilidad', 'ver')
  @Get('estado')
  estado(@Contexto() ctx: Ctx) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const { faltan, faltanRrhh } = await mapaConceptos(tx);
      const plan = await tx.selectFrom('cuenta_contable').select('id').limit(1).executeTakeFirst();
      const cierres = await tx
        .selectFrom('cierre_contable as c')
        .innerJoin('usuario as u', 'u.id', 'c.usuario_id')
        .select(['c.accion', 'c.hasta', 'c.motivo', 'c.creado_en', 'u.nombre as usuario'])
        .orderBy('c.creado_en', 'desc')
        .limit(10)
        .execute();
      return {
        tienePlan: !!plan,
        faltanConceptos: faltan.map((f) => CONCEPTOS_CONTABLES[f]),
        faltanConceptosSueldos: faltanRrhh.map((f) => CONCEPTOS_CONTABLES[f]),
        cerradoHasta: await cerradoHasta(tx),
        pendientes: await pendientes(tx, hoyPy()),
        cierres: cierres.map((c) => ({ accion: c.accion, hasta: c.hasta, motivo: c.motivo, fecha: c.creado_en, usuario: c.usuario })),
      };
    });
  }

  @Requiere('contabilidad', 'crear')
  @Post('contabilizar')
  @HttpCode(200)
  contabilizar(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ hasta: dia.optional() }), body ?? {});
    const hasta = d.hasta ?? hoyPy();
    if (hasta > hoyPy()) throw invalido('No se contabiliza a futuro');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const r = await contabilizar(tx, ctx, hasta);
      if (r.generados) await auditar(tx, { ...ctx, ...o }, { accion: 'contabilizar', entidad: 'asiento', entidadId: ctx.empresaId, despues: { hasta, ...r } });
      return r;
    });
  }

  @Requiere('contabilidad', 'aprobar')
  @Post('cierre')
  @HttpCode(200)
  cerrar(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(cierreContableEntrada, body);
    if (d.hasta >= hoyPy()) throw invalido('Solo se cierran períodos terminados (hasta ayer como máximo)');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const actual = await cerradoHasta(tx);
      if (actual && d.hasta <= actual) throw invalido(`El período ya está cerrado hasta ${actual.split('-').reverse().join('/')}`);
      // Todo lo del período queda contabilizado antes de cerrarlo.
      const r = await contabilizar(tx, ctx, d.hasta);
      await tx.insertInto('cierre_contable').values({ empresa_id: ctx.empresaId, accion: 'cierre', hasta: d.hasta, motivo: d.motivo ?? null, usuario_id: ctx.usuarioId }).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'cierre', entidad: 'cierre_contable', entidadId: ctx.empresaId, antes: { cerradoHasta: actual }, despues: { cerradoHasta: d.hasta, asientosGenerados: r.generados } });
      return { cerradoHasta: d.hasta, generados: r.generados };
    });
  }

  @Requiere('contabilidad', 'aprobar')
  @Post('cierre/reabrir')
  @HttpCode(200)
  reabrir(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ hasta: dia.nullable(), motivo: z.string().trim().min(5, 'Indique el motivo de la reapertura').max(300) }), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const actual = await cerradoHasta(tx);
      if (!actual) throw invalido('No hay ningún período cerrado');
      if (d.hasta && d.hasta >= actual) throw invalido('Para reabrir, elija una fecha anterior al cierre actual');
      await tx.insertInto('cierre_contable').values({ empresa_id: ctx.empresaId, accion: 'reapertura', hasta: d.hasta, motivo: d.motivo, usuario_id: ctx.usuarioId }).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'reapertura', entidad: 'cierre_contable', entidadId: ctx.empresaId, antes: { cerradoHasta: actual }, despues: d });
      return { cerradoHasta: d.hasta };
    });
  }

  // ── Asientos ──

  /** Libro diario. */
  @Requiere('contabilidad', 'ver')
  @Get('asientos')
  diario(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ desde: dia, hasta: dia, origen: z.enum(['manual', 'automatico']).optional(), pagina: z.coerce.number().int().min(1).default(1) }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let q = tx.selectFrom('asiento as a').where('a.fecha', '>=', f.desde).where('a.fecha', '<=', f.hasta);
      if (f.origen === 'manual') q = q.where('a.origen_tipo', 'in', ['manual', 'reversion']);
      if (f.origen === 'automatico') q = q.where('a.origen_tipo', 'not in', ['manual', 'reversion']);
      const { n } = await q.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
      const por = 100;
      const filas = await q
        .select(['a.id', 'a.numero', 'a.fecha', 'a.descripcion', 'a.origen_tipo', 'a.origen_id', 'a.estado', 'a.motivo_anulacion'])
        .orderBy('a.fecha')
        .orderBy('a.numero')
        .limit(por)
        .offset((f.pagina - 1) * por)
        .execute();
      const lineas = filas.length
        ? await tx
            .selectFrom('asiento_linea as l')
            .innerJoin('cuenta_contable as c', 'c.id', 'l.cuenta_id')
            .select(['l.asiento_id', 'l.linea', 'l.cuenta_id', 'c.codigo', 'c.nombre', 'l.debe', 'l.haber', 'l.detalle'])
            .where('l.asiento_id', 'in', filas.map((x) => x.id))
            .orderBy('l.linea')
            .execute()
        : [];
      const tot = await sql<{ d: string | null }>`SELECT sum(l.debe)::text AS d FROM asiento_linea l JOIN asiento a ON a.id = l.asiento_id WHERE a.fecha BETWEEN ${f.desde}::date AND ${f.hasta}::date`.execute(tx);
      return {
        total: Number(n),
        pagina: f.pagina,
        paginas: Math.max(1, Math.ceil(Number(n) / por)),
        sumaPeriodo: new Decimal(tot.rows[0]?.d ?? 0).toFixed(2),
        items: filas.map((a) => formatoAsiento(a, lineas.filter((l) => l.asiento_id === a.id))),
      };
    });
  }

  @Requiere('contabilidad', 'ver')
  @Get('asientos/:id')
  asiento(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, (tx) => leerAsiento(tx, id));
  }

  @Requiere('contabilidad', 'crear')
  @Post('asientos')
  manual(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(asientoManualEntrada, body);
    if (d.fecha > hoyPy()) throw invalido('La fecha del asiento no puede ser futura');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const cierre = await cerradoHasta(tx);
      if (cierre && d.fecha <= cierre) throw conflicto('PERIODO_CERRADO', `El período está cerrado hasta ${cierre.split('-').reverse().join('/')}`);
      const todas = new Map((await cuentas(tx)).map((c) => [c.id, c]));
      for (const l of d.lineas) validarCuentaImputable(todas.get(l.cuentaId));
      const r = await registrarAsiento(tx, ctx, new Numerador(), cierre, {
        fecha: d.fecha,
        descripcion: d.descripcion,
        origenTipo: 'manual',
        origenId: null,
        lineas: d.lineas.map((l) => ({ cuentaId: l.cuentaId, monto: new Decimal(l.debe).minus(l.haber), detalle: l.detalle })),
      });
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'asiento', entidadId: r!.id, despues: d });
      return leerAsiento(tx, r!.id);
    });
  }

  /** Solo los asientos manuales se anulan: se registra el asiento inverso. Los automáticos siguen a su documento. */
  @Requiere('contabilidad', 'crear')
  @Post('asientos/:id/anular')
  @HttpCode(200)
  anular(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ motivo: z.string().trim().min(5, 'Indique el motivo').max(300) }), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const a = await tx.selectFrom('asiento').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!a) throw noEncontrado('Asiento');
      if (a.origen_tipo !== 'manual') throw invalido('Los asientos automáticos se corrigen anulando el documento que los generó');
      if (a.estado === 'anulado') throw conflicto('YA_ANULADO', 'El asiento ya está anulado');
      const cierre = await cerradoHasta(tx);
      const hoy = hoyPy();
      const r = await revertirAsiento(tx, ctx, new Numerador(), cierre, { id: a.id, numero: a.numero }, { fecha: hoy, descripcion: `Anulación del asiento N.º ${a.numero}: ${d.motivo}`, origenTipo: 'reversion', origenId: a.id });
      await tx.updateTable('asiento').set({ estado: 'anulado', anulado_por: ctx.usuarioId, anulado_en: new Date(), motivo_anulacion: d.motivo }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'anular', entidad: 'asiento', entidadId: id, despues: { motivo: d.motivo, reversion: r?.numero } });
      return leerAsiento(tx, id);
    });
  }

  // ── Informes ──

  /** Libro mayor de una cuenta (si es un grupo, incluye todas sus subcuentas). */
  @Requiere('contabilidad', 'ver')
  @Get('mayor')
  mayor(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ cuentaId: z.string().uuid(), desde: dia, hasta: dia }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const c = await tx.selectFrom('cuenta_contable').selectAll().where('id', '=', f.cuentaId).executeTakeFirst();
      if (!c) throw noEncontrado('Cuenta contable');
      const filtro = sql`(c.codigo = ${c.codigo} OR c.codigo LIKE ${c.codigo + '.%'})`;
      const prev = await sql<{ s: string | null }>`
        SELECT sum(l.debe - l.haber)::text AS s FROM asiento_linea l JOIN asiento a ON a.id = l.asiento_id JOIN cuenta_contable c ON c.id = l.cuenta_id
        WHERE ${filtro} AND a.fecha < ${f.desde}::date`.execute(tx);
      const movs = await sql<{ asiento_id: string; numero: number; fecha: string; descripcion: string; codigo: string; debe: string; haber: string; detalle: string | null }>`
        SELECT a.id AS asiento_id, a.numero, a.fecha::text AS fecha, a.descripcion, c.codigo, l.debe, l.haber, l.detalle
        FROM asiento_linea l JOIN asiento a ON a.id = l.asiento_id JOIN cuenta_contable c ON c.id = l.cuenta_id
        WHERE ${filtro} AND a.fecha BETWEEN ${f.desde}::date AND ${f.hasta}::date
        ORDER BY a.fecha, a.numero, l.linea LIMIT 5000`.execute(tx);
      let saldo = new Decimal(prev.rows[0]?.s ?? 0);
      const inicial = saldo.toFixed(2);
      let debe = new Decimal(0);
      let haber = new Decimal(0);
      const items = movs.rows.map((m) => {
        saldo = saldo.plus(m.debe).minus(m.haber);
        debe = debe.plus(m.debe);
        haber = haber.plus(m.haber);
        return { asientoId: m.asiento_id, numero: m.numero, fecha: m.fecha, descripcion: m.detalle ? `${m.descripcion} · ${m.detalle}` : m.descripcion, codigo: m.codigo, debe: m.debe, haber: m.haber, saldo: saldo.toFixed(2) };
      });
      return { cuenta: { id: c.id, codigo: c.codigo, nombre: c.nombre, tipo: c.tipo }, saldoInicial: inicial, debe: debe.toFixed(2), haber: haber.toFixed(2), saldoFinal: saldo.toFixed(2), items };
    });
  }

  /**
   * Balance de sumas y saldos del período, con los grupos acumulados.
   * Saldo = debe − haber (positivo deudor, negativo acreedor). Sirve también para el balance general
   * (activo, pasivo, patrimonio al cierre) y el estado de resultados (ingresos y egresos del período).
   */
  @Requiere('contabilidad', 'ver')
  @Get('balance')
  balance(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(periodo, query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const lista = await cuentas(tx);
      const { rows } = await sql<{ cuenta_id: string; previo: string; debe: string; haber: string }>`
        SELECT l.cuenta_id,
          coalesce(sum(l.debe - l.haber) FILTER (WHERE a.fecha < ${f.desde}::date), 0)::text AS previo,
          coalesce(sum(l.debe) FILTER (WHERE a.fecha >= ${f.desde}::date), 0)::text AS debe,
          coalesce(sum(l.haber) FILTER (WHERE a.fecha >= ${f.desde}::date), 0)::text AS haber
        FROM asiento_linea l JOIN asiento a ON a.id = l.asiento_id
        WHERE a.fecha <= ${f.hasta}::date GROUP BY l.cuenta_id`.execute(tx);
      const porCuenta = new Map(rows.map((r) => [r.cuenta_id, r]));
      const filas = lista.map((c) => {
        const propias = lista.filter((x) => x.imputable && (x.codigo === c.codigo || x.codigo.startsWith(`${c.codigo}.`)));
        let previo = new Decimal(0);
        let debe = new Decimal(0);
        let haber = new Decimal(0);
        for (const x of propias) {
          const r = porCuenta.get(x.id);
          if (!r) continue;
          previo = previo.plus(r.previo);
          debe = debe.plus(r.debe);
          haber = haber.plus(r.haber);
        }
        return {
          id: c.id,
          codigo: c.codigo,
          nombre: c.nombre,
          tipo: c.tipo,
          imputable: c.imputable,
          nivel: c.codigo.split('.').length,
          saldoAnterior: previo.toFixed(2),
          debe: debe.toFixed(2),
          haber: haber.toFixed(2),
          saldo: previo.plus(debe).minus(haber).toFixed(2),
        };
      });
      const imput = filas.filter((x) => x.imputable);
      const suma = (k: 'debe' | 'haber') => imput.reduce((s, x) => s.plus(x[k]), new Decimal(0));
      const delTipo = (t: string, k: 'saldo') => imput.filter((x) => x.tipo === t).reduce((s, x) => s.plus(x[k]), new Decimal(0));
      // Resultado del período: ingresos (saldo acreedor) − egresos (saldo deudor), solo movimientos del período.
      const mov = (t: string) => imput.filter((x) => x.tipo === t).reduce((s, x) => s.plus(x.haber).minus(x.debe), new Decimal(0));
      const resultado = mov('ingreso').plus(mov('gasto'));
      return {
        desde: f.desde,
        hasta: f.hasta,
        filas,
        totales: { debe: suma('debe').toFixed(2), haber: suma('haber').toFixed(2) },
        activo: delTipo('activo', 'saldo').toFixed(2),
        pasivo: delTipo('pasivo', 'saldo').neg().toFixed(2),
        patrimonio: delTipo('patrimonio', 'saldo').neg().toFixed(2),
        resultadoAcumulado: delTipo('ingreso', 'saldo').plus(delTipo('gasto', 'saldo')).neg().toFixed(2),
        resultadoPeriodo: resultado.toFixed(2),
      };
    });
  }
}
