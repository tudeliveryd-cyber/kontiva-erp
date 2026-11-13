import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  bajaFuncionarioEntrada,
  calcularAguinaldo,
  calcularSueldo,
  diasVacaciones,
  funcionarioEntrada,
  liquidacionItemEntrada,
  liquidacionNuevaEntrada,
  pagoLiquidacionEntrada,
  PARAMETROS_RRHH_PY,
  rrhhConfiguracionEntrada,
  type ParametrosRrhh,
} from '@kontiva/shared';
import Decimal from 'decimal.js';
import { sql } from 'kysely';
import { z } from 'zod';
import { enSucursal, exigirSucursal } from '../comun/alcance';
import { auditar } from '../comun/auditoria';
import { Contexto, OrigenPeticion, tiene, type Ctx, type Origen } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { conflicto, invalido, noEncontrado, prohibido } from '../comun/errores';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';
import { movimientoBancario, obtenerCuentaBancaria } from '../finanzas/bancos.controller';
import { esperado, obtenerCaja, sesionAbierta } from '../operacion/cajas.controller';

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
const finDeMes = (periodo: string) => {
  const d = new Date(`${periodo}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
};
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000) + 1;

export async function parametrosRrhh(tx: Tx): Promise<ParametrosRrhh & { personalizado: boolean }> {
  const c = await tx.selectFrom('rrhh_configuracion').selectAll().executeTakeFirst();
  if (!c) return { ...PARAMETROS_RRHH_PY, personalizado: false };
  return { salarioMinimo: c.salario_minimo, ipsObrero: c.ips_obrero, ipsPatronal: c.ips_patronal, bonificacionPct: c.bonificacion_pct, bonificacionTope: c.bonificacion_tope, personalizado: true };
}

function formatoFuncionario(f: Record<string, unknown> & { salario: string; fecha_ingreso: string; fecha_egreso: string | null }, verSalario: boolean) {
  return {
    id: f.id,
    sucursalId: f.sucursal_id,
    sucursal: f.sucursal ?? undefined,
    nombre: f.nombre,
    documento: f.documento,
    fechaNacimiento: f.fecha_nacimiento,
    telefono: f.telefono,
    email: f.email,
    direccion: f.direccion,
    cargo: f.cargo,
    fechaIngreso: f.fecha_ingreso,
    fechaEgreso: f.fecha_egreso,
    motivoEgreso: f.motivo_egreso,
    activo: !f.fecha_egreso || f.fecha_egreso >= hoy(),
    remuneracion: f.remuneracion,
    salario: verSalario ? f.salario : undefined,
    hijos: f.hijos,
    aseguradoIps: f.asegurado_ips,
    numeroIps: f.numero_ips,
    banco: f.banco,
    cuentaBancaria: f.cuenta_bancaria,
    nota: f.nota,
    diasVacaciones: diasVacaciones(f.fecha_ingreso, hoy()),
  };
}

@Controller('funcionarios')
export class FuncionariosController {
  constructor(private readonly db: Db) {}

  @Requiere('funcionario', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ estado: z.enum(['activos', 'bajas', 'todos']).default('activos'), buscar: z.string().trim().max(80).optional() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let q = tx.selectFrom('funcionario as f').innerJoin('sucursal as s', 's.id', 'f.sucursal_id').selectAll('f').select('s.nombre as sucursal').orderBy('f.nombre');
      if (f.estado === 'activos') q = q.where((eb) => eb.or([eb('f.fecha_egreso', 'is', null), eb('f.fecha_egreso', '>=', hoy())]));
      if (f.estado === 'bajas') q = q.where('f.fecha_egreso', '<', hoy());
      if (f.buscar) q = q.where((eb) => eb.or([eb('f.nombre', 'ilike', `%${f.buscar}%`), eb('f.documento', 'ilike', `%${f.buscar}%`), eb('f.cargo', 'ilike', `%${f.buscar}%`)]));
      const filas = (await q.execute()).filter((x) => enSucursal(ctx, x.sucursal_id));
      return filas.map((x) => formatoFuncionario(x, tiene(ctx, 'salario.ver')));
    });
  }

  @Requiere('funcionario', 'ver')
  @Get(':id')
  leer(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const f = await tx.selectFrom('funcionario as f').innerJoin('sucursal as s', 's.id', 'f.sucursal_id').selectAll('f').select('s.nombre as sucursal').where('f.id', '=', id).executeTakeFirst();
      if (!f) throw noEncontrado('Funcionario');
      exigirSucursal(ctx, f.sucursal_id, 'Funcionario');
      const verSalario = tiene(ctx, 'salario.ver');
      const historial = verSalario
        ? await tx
            .selectFrom('liquidacion_item as i')
            .innerJoin('liquidacion as l', 'l.id', 'i.liquidacion_id')
            .select(['l.id', 'l.tipo', 'l.periodo', 'l.estado', 'l.pago_fecha', 'i.bruto', 'i.ips_obrero', 'i.descuentos', 'i.neto'])
            .where('i.funcionario_id', '=', id)
            .where('l.estado', '<>', 'anulada')
            .orderBy('l.periodo', 'desc')
            .orderBy('l.tipo')
            .limit(36)
            .execute()
        : [];
      return {
        ...formatoFuncionario(f, verSalario),
        liquidaciones: historial.map((h) => ({ id: h.id, tipo: h.tipo, periodo: h.periodo, estado: h.estado, pagada: !!h.pago_fecha, bruto: h.bruto, ipsObrero: h.ips_obrero, descuentos: h.descuentos, neto: h.neto })),
      };
    });
  }

  @Requiere('funcionario', 'crear')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(funcionarioEntrada, body);
    if (d.salario && !tiene(ctx, 'salario.editar')) throw prohibido('Cargar el salario requiere el permiso de salarios');
    exigirSucursal(ctx, d.sucursalId, 'Sucursal');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const dup = await tx.selectFrom('funcionario').select('id').where('documento', '=', d.documento).executeTakeFirst();
      if (dup) throw conflicto('DOCUMENTO_DUPLICADO', 'Ya hay un funcionario con esa cédula');
      const suc = await tx.selectFrom('sucursal').select('id').where('id', '=', d.sucursalId).executeTakeFirst();
      if (!suc) throw noEncontrado('Sucursal');
      const r = await tx
        .insertInto('funcionario')
        .values({
          empresa_id: ctx.empresaId,
          sucursal_id: d.sucursalId,
          nombre: d.nombre,
          documento: d.documento,
          fecha_nacimiento: d.fechaNacimiento ?? null,
          telefono: d.telefono ?? null,
          email: d.email ?? null,
          direccion: d.direccion ?? null,
          cargo: d.cargo,
          fecha_ingreso: d.fechaIngreso,
          remuneracion: d.remuneracion,
          salario: new Decimal(d.salario ?? 0).toFixed(2),
          hijos: d.hijos,
          asegurado_ips: d.aseguradoIps,
          numero_ips: d.numeroIps ?? null,
          banco: d.banco ?? null,
          cuenta_bancaria: d.cuentaBancaria ?? null,
          nota: d.nota ?? null,
          creado_por: ctx.usuarioId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      // El salario no queda en claro en la auditoría.
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'funcionario', entidadId: r.id, despues: { ...d, salario: d.salario ? 'cargado' : undefined } });
      return { id: r.id };
    });
  }

  @Requiere('funcionario', 'editar')
  @Patch(':id')
  editar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(funcionarioEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const f = await tx.selectFrom('funcionario').selectAll().where('id', '=', id).executeTakeFirst();
      if (!f) throw noEncontrado('Funcionario');
      exigirSucursal(ctx, f.sucursal_id, 'Funcionario');
      exigirSucursal(ctx, d.sucursalId, 'Sucursal');
      const cambiaSalario = d.salario !== undefined && !new Decimal(d.salario).eq(f.salario);
      if ((cambiaSalario || d.remuneracion !== f.remuneracion) && !tiene(ctx, 'salario.editar')) throw prohibido('Cambiar el salario requiere el permiso de salarios');
      if (d.documento !== f.documento) {
        const dup = await tx.selectFrom('funcionario').select('id').where('documento', '=', d.documento).where('id', '<>', id).executeTakeFirst();
        if (dup) throw conflicto('DOCUMENTO_DUPLICADO', 'Ya hay un funcionario con esa cédula');
      }
      await tx
        .updateTable('funcionario')
        .set({
          sucursal_id: d.sucursalId,
          nombre: d.nombre,
          documento: d.documento,
          fecha_nacimiento: d.fechaNacimiento ?? null,
          telefono: d.telefono ?? null,
          email: d.email ?? null,
          direccion: d.direccion ?? null,
          cargo: d.cargo,
          fecha_ingreso: d.fechaIngreso,
          remuneracion: d.remuneracion,
          ...(cambiaSalario && { salario: new Decimal(d.salario!).toFixed(2) }),
          hijos: d.hijos,
          asegurado_ips: d.aseguradoIps,
          numero_ips: d.numeroIps ?? null,
          banco: d.banco ?? null,
          cuenta_bancaria: d.cuentaBancaria ?? null,
          nota: d.nota ?? null,
        })
        .where('id', '=', id)
        .execute();
      await auditar(tx, { ...ctx, ...o }, {
        accion: 'editar',
        entidad: 'funcionario',
        entidadId: id,
        antes: { nombre: f.nombre, cargo: f.cargo, hijos: f.hijos, remuneracion: f.remuneracion },
        despues: { ...d, salario: cambiaSalario ? 'modificado' : undefined },
      });
      return { ok: true };
    });
  }

  /** Baja: el legajo no se borra; queda con fecha y motivo de egreso. */
  @Requiere('funcionario', 'editar')
  @Post(':id/baja')
  @HttpCode(200)
  baja(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(bajaFuncionarioEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const f = await tx.selectFrom('funcionario').selectAll().where('id', '=', id).executeTakeFirst();
      if (!f) throw noEncontrado('Funcionario');
      exigirSucursal(ctx, f.sucursal_id, 'Funcionario');
      if (f.fecha_egreso) throw conflicto('YA_DE_BAJA', 'El funcionario ya tiene fecha de egreso');
      if (d.fechaEgreso < f.fecha_ingreso) throw invalido('La fecha de egreso es anterior al ingreso');
      await tx.updateTable('funcionario').set({ fecha_egreso: d.fechaEgreso, motivo_egreso: d.motivo }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'baja', entidad: 'funcionario', entidadId: id, despues: d });
      return { ok: true };
    });
  }

  @Requiere('funcionario', 'editar')
  @Post(':id/reingreso')
  @HttpCode(200)
  reingreso(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ fechaIngreso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const f = await tx.selectFrom('funcionario').selectAll().where('id', '=', id).executeTakeFirst();
      if (!f) throw noEncontrado('Funcionario');
      exigirSucursal(ctx, f.sucursal_id, 'Funcionario');
      if (!f.fecha_egreso) throw conflicto('ACTIVO', 'El funcionario está activo');
      if (d.fechaIngreso <= f.fecha_egreso) throw invalido('El reingreso debe ser posterior al egreso');
      await tx.updateTable('funcionario').set({ fecha_ingreso: d.fechaIngreso, fecha_egreso: null, motivo_egreso: null }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'reingreso', entidad: 'funcionario', entidadId: id, antes: { ingreso: f.fecha_ingreso, egreso: f.fecha_egreso }, despues: d });
      return { ok: true };
    });
  }
}

@Controller('rrhh')
export class RrhhConfiguracionController {
  constructor(private readonly db: Db) {}

  @Requiere('salario', 'ver')
  @Get('configuracion')
  leer(@Contexto() ctx: Ctx) {
    return this.db.enEmpresa(ctx.empresaId, (tx) => parametrosRrhh(tx));
  }

  @Requiere('salario', 'editar')
  @Put('configuracion')
  guardar(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(rrhhConfiguracionEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const antes = await parametrosRrhh(tx);
      const v = { salario_minimo: d.salarioMinimo.toFixed(2), ips_obrero: d.ipsObrero.toFixed(2), ips_patronal: d.ipsPatronal.toFixed(2), bonificacion_pct: d.bonificacionPct.toFixed(2), bonificacion_tope: d.bonificacionTope.toFixed(2), actualizado_por: ctx.usuarioId, actualizado_en: new Date() };
      await tx.insertInto('rrhh_configuracion').values({ empresa_id: ctx.empresaId, ...v }).onConflict((oc) => oc.column('empresa_id').doUpdateSet(v)).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'configurar', entidad: 'rrhh_configuracion', entidadId: ctx.empresaId, antes, despues: d });
      return parametrosRrhh(tx);
    });
  }
}

async function leerLiquidacion(tx: Tx, id: string) {
  const l = await tx.selectFrom('liquidacion').selectAll().where('id', '=', id).executeTakeFirst();
  if (!l) throw noEncontrado('Liquidación');
  const items = await tx
    .selectFrom('liquidacion_item as i')
    .innerJoin('funcionario as f', 'f.id', 'i.funcionario_id')
    .selectAll('i')
    .select(['f.nombre', 'f.documento', 'f.cargo', 'f.remuneracion', 'f.salario', 'f.hijos', 'f.asegurado_ips', 'f.numero_ips', 'f.fecha_ingreso', 'f.banco', 'f.cuenta_bancaria'])
    .where('i.liquidacion_id', '=', id)
    .orderBy('f.nombre')
    .execute();
  const cuenta = l.pago_cuenta_id ? await tx.selectFrom('cuenta_bancaria').select(['banco', 'nombre']).where('id', '=', l.pago_cuenta_id).executeTakeFirst() : null;
  return {
    id: l.id,
    tipo: l.tipo,
    periodo: l.periodo,
    estado: l.estado,
    parametros: { salarioMinimo: l.salario_minimo, ipsObrero: l.ips_obrero_pct, ipsPatronal: l.ips_patronal_pct },
    totales: { bruto: l.bruto, ipsObrero: l.ips_obrero, ipsPatronal: l.ips_patronal, descuentos: l.descuentos, neto: l.neto },
    confirmadaEn: l.confirmada_en,
    pago: l.pago_fecha ? { fecha: l.pago_fecha, medio: l.pago_medio, cuenta: cuenta ? `${cuenta.banco} · ${cuenta.nombre}` : null } : null,
    motivoAnulacion: l.motivo_anulacion,
    items: items.map((i) => ({
      funcionarioId: i.funcionario_id,
      nombre: i.nombre,
      documento: i.documento,
      cargo: i.cargo,
      remuneracion: i.remuneracion,
      salario: i.salario,
      hijos: i.hijos,
      aseguradoIps: i.asegurado_ips,
      numeroIps: i.numero_ips,
      fechaIngreso: i.fecha_ingreso,
      banco: i.banco,
      cuentaBancaria: i.cuenta_bancaria,
      dias: i.dias,
      salarioBase: i.salario_base,
      horasExtra50: i.horas_extra_50,
      horasExtra100: i.horas_extra_100,
      montoHorasExtra: i.monto_horas_extra,
      otrosIngresos: i.otros_ingresos,
      bonificacion: i.bonificacion,
      imponible: i.imponible,
      bruto: i.bruto,
      ipsObrero: i.ips_obrero,
      ipsPatronal: i.ips_patronal,
      descuentos: i.descuentos,
      detalleDescuentos: i.detalle_descuentos,
      neto: i.neto,
    })),
  };
}

async function recalcularTotales(tx: Tx, id: string) {
  const t = await tx
    .selectFrom('liquidacion_item')
    .select((eb) => [
      eb.fn.coalesce(eb.fn.sum<string>('bruto'), eb.val('0')).as('bruto'),
      eb.fn.coalesce(eb.fn.sum<string>('ips_obrero'), eb.val('0')).as('ips_obrero'),
      eb.fn.coalesce(eb.fn.sum<string>('ips_patronal'), eb.val('0')).as('ips_patronal'),
      eb.fn.coalesce(eb.fn.sum<string>('descuentos'), eb.val('0')).as('descuentos'),
      eb.fn.coalesce(eb.fn.sum<string>('neto'), eb.val('0')).as('neto'),
    ])
    .where('liquidacion_id', '=', id)
    .executeTakeFirstOrThrow();
  await tx.updateTable('liquidacion').set(t).where('id', '=', id).execute();
}

@Controller('liquidaciones')
export class LiquidacionesController {
  constructor(private readonly db: Db) {}

  @Requiere('salario', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const filas = await tx
        .selectFrom('liquidacion as l')
        .select(['l.id', 'l.tipo', 'l.periodo', 'l.estado', 'l.bruto', 'l.ips_obrero', 'l.ips_patronal', 'l.descuentos', 'l.neto', 'l.pago_fecha', 'l.creado_en'])
        .select((eb) => eb.selectFrom('liquidacion_item as i').whereRef('i.liquidacion_id', '=', 'l.id').select(eb.fn.countAll<string>().as('n')).as('funcionarios'))
        .orderBy('l.periodo', 'desc')
        .orderBy('l.tipo', 'desc')
        .orderBy('l.creado_en', 'desc')
        .limit(120)
        .execute();
      return filas.map((l) => ({ id: l.id, tipo: l.tipo, periodo: l.periodo, estado: l.estado, funcionarios: Number(l.funcionarios), bruto: l.bruto, ipsObrero: l.ips_obrero, ipsPatronal: l.ips_patronal, descuentos: l.descuentos, neto: l.neto, pagada: !!l.pago_fecha }));
    });
  }

  @Requiere('salario', 'ver')
  @Get(':id')
  leer(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, (tx) => leerLiquidacion(tx, id));
  }

  /** Genera la planilla en borrador con los funcionarios del período. */
  @Requiere('salario', 'editar')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(liquidacionNuevaEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const p = await parametrosRrhh(tx);
      const periodo = d.tipo === 'mensual' ? `${d.periodo}-01` : `${d.anio}-01-01`;
      if (periodo.slice(0, 7) > hoy().slice(0, 7)) throw invalido('No se liquida un período futuro');
      const existe = await tx.selectFrom('liquidacion').select('id').where('tipo', '=', d.tipo).where('periodo', '=', periodo).where('estado', '<>', 'anulada').executeTakeFirst();
      if (existe) throw conflicto('LIQUIDACION_EXISTENTE', d.tipo === 'mensual' ? 'Ese mes ya tiene una liquidación' : 'Ese año ya tiene liquidación de aguinaldo');
      const l = await tx
        .insertInto('liquidacion')
        .values({ empresa_id: ctx.empresaId, tipo: d.tipo, periodo, salario_minimo: new Decimal(p.salarioMinimo).toFixed(2), ips_obrero_pct: new Decimal(p.ipsObrero).toFixed(2), ips_patronal_pct: new Decimal(p.ipsPatronal).toFixed(2), creado_por: ctx.usuarioId })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (d.tipo === 'mensual') {
        const fin = finDeMes(periodo);
        const funcs = await tx
          .selectFrom('funcionario')
          .selectAll()
          .where('fecha_ingreso', '<=', fin)
          .where((eb) => eb.or([eb('fecha_egreso', 'is', null), eb('fecha_egreso', '>=', periodo)]))
          .execute();
        for (const f of funcs) {
          const desde = f.fecha_ingreso > periodo ? f.fecha_ingreso : periodo;
          const hasta = f.fecha_egreso && f.fecha_egreso < fin ? f.fecha_egreso : fin;
          const completo = desde === periodo && hasta === fin;
          // Mensualizado: 30 días el mes completo; si entró o salió en el mes, los días corridos. Jornalero: se cargan los días trabajados.
          const dias = f.remuneracion === 'jornal' ? 0 : completo ? 30 : Math.min(30, diasEntre(desde, hasta));
          const s = calcularSueldo(p, { remuneracion: f.remuneracion, salario: f.salario, aseguradoIps: f.asegurado_ips, hijos: f.hijos, dias });
          await tx
            .insertInto('liquidacion_item')
            .values({ empresa_id: ctx.empresaId, liquidacion_id: l.id, funcionario_id: f.id, dias: String(dias), ...valoresItem(s) })
            .execute();
        }
      } else {
        // Aguinaldo: lo cobrado en el año (liquidaciones confirmadas, sin la bonificación familiar) / 12.
        const { rows } = await sql<{ funcionario_id: string; cobrado: string }>`
          SELECT i.funcionario_id, sum(i.imponible)::text AS cobrado
          FROM liquidacion_item i JOIN liquidacion l ON l.id = i.liquidacion_id
          WHERE l.tipo = 'mensual' AND l.estado = 'confirmada' AND extract(year FROM l.periodo) = ${d.anio}
          GROUP BY i.funcionario_id`.execute(tx);
        const cobrado = new Map(rows.map((r) => [r.funcionario_id, r.cobrado]));
        const funcs = await tx
          .selectFrom('funcionario')
          .select(['id'])
          .where('fecha_ingreso', '<=', `${d.anio}-12-31`)
          .where((eb) => eb.or([eb('fecha_egreso', 'is', null), eb('fecha_egreso', '>=', `${d.anio}-01-01`)]))
          .execute();
        for (const f of funcs) {
          const a = calcularAguinaldo(cobrado.get(f.id) ?? 0);
          await tx
            .insertInto('liquidacion_item')
            .values({ empresa_id: ctx.empresaId, liquidacion_id: l.id, funcionario_id: f.id, dias: '0', salario_base: a.monto.toFixed(2), bruto: a.monto.toFixed(2), neto: a.neto.toFixed(2), otros_ingresos: '0', imponible: '0' })
            .execute();
        }
      }
      await recalcularTotales(tx, l.id);
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'liquidacion', entidadId: l.id, despues: d });
      return leerLiquidacion(tx, l.id);
    });
  }

  /** Ajusta la línea de un funcionario en una planilla en borrador (días, horas extra, otros ingresos, descuentos). */
  @Requiere('salario', 'editar')
  @Patch(':id/items')
  item(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(liquidacionItemEntrada.extend({ funcionarioId: z.string().uuid() }), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const l = await tx.selectFrom('liquidacion').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!l) throw noEncontrado('Liquidación');
      if (l.estado !== 'borrador') throw conflicto('NO_EDITABLE', 'Solo se modifica una planilla en borrador');
      const it = await tx.selectFrom('liquidacion_item').selectAll().where('liquidacion_id', '=', id).where('funcionario_id', '=', d.funcionarioId).executeTakeFirst();
      if (!it) throw noEncontrado('Funcionario en la planilla');
      if (l.tipo === 'aguinaldo') {
        const monto = new Decimal(d.monto ?? it.salario_base);
        const descuentos = new Decimal(d.descuentos ?? it.descuentos);
        if (descuentos.gt(monto)) throw invalido('Los descuentos superan el aguinaldo');
        await tx
          .updateTable('liquidacion_item')
          .set({ salario_base: monto.toFixed(2), bruto: monto.toFixed(2), descuentos: descuentos.toFixed(2), detalle_descuentos: d.detalleDescuentos ?? it.detalle_descuentos, neto: monto.minus(descuentos).toFixed(2) })
          .where('liquidacion_id', '=', id)
          .where('funcionario_id', '=', d.funcionarioId)
          .execute();
      } else {
        const f = await tx.selectFrom('funcionario').selectAll().where('id', '=', d.funcionarioId).executeTakeFirstOrThrow();
        // Salario mínimo e IPS: los vigentes al generar la planilla.
        const params = { ...(await parametrosRrhh(tx)), salarioMinimo: l.salario_minimo, ipsObrero: l.ips_obrero_pct, ipsPatronal: l.ips_patronal_pct };
        const entrada = {
          dias: d.dias ?? it.dias,
          horasExtra50: d.horasExtra50 ?? it.horas_extra_50,
          horasExtra100: d.horasExtra100 ?? it.horas_extra_100,
          otrosIngresos: d.otrosIngresos ?? it.otros_ingresos,
          descuentos: d.descuentos ?? it.descuentos,
        };
        const s = calcularSueldo(params, { remuneracion: f.remuneracion, salario: f.salario, aseguradoIps: f.asegurado_ips, hijos: f.hijos, ...entrada });
        if (s.neto.lt(0)) throw invalido('Los descuentos superan lo que cobra el funcionario');
        await tx
          .updateTable('liquidacion_item')
          .set({
            dias: String(entrada.dias),
            horas_extra_50: String(entrada.horasExtra50),
            horas_extra_100: String(entrada.horasExtra100),
            detalle_descuentos: d.detalleDescuentos !== undefined ? d.detalleDescuentos : it.detalle_descuentos,
            ...valoresItem(s),
          })
          .where('liquidacion_id', '=', id)
          .where('funcionario_id', '=', d.funcionarioId)
          .execute();
      }
      await recalcularTotales(tx, id);
      await auditar(tx, { ...ctx, ...o }, { accion: 'ajustar', entidad: 'liquidacion', entidadId: id, despues: d });
      return leerLiquidacion(tx, id);
    });
  }

  @Requiere('salario', 'editar')
  @Post(':id/quitar')
  @HttpCode(200)
  quitar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ funcionarioId: z.string().uuid() }), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const l = await tx.selectFrom('liquidacion').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!l) throw noEncontrado('Liquidación');
      if (l.estado !== 'borrador') throw conflicto('NO_EDITABLE', 'Solo se modifica una planilla en borrador');
      const r = await tx.deleteFrom('liquidacion_item').where('liquidacion_id', '=', id).where('funcionario_id', '=', d.funcionarioId).executeTakeFirst();
      if (!Number(r.numDeletedRows)) throw noEncontrado('Funcionario en la planilla');
      await recalcularTotales(tx, id);
      await auditar(tx, { ...ctx, ...o }, { accion: 'quitar', entidad: 'liquidacion', entidadId: id, despues: d });
      return leerLiquidacion(tx, id);
    });
  }

  @Requiere('salario', 'editar')
  @Post(':id/confirmar')
  @HttpCode(200)
  confirmar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @OrigenPeticion() o: Origen) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const l = await tx.selectFrom('liquidacion').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!l) throw noEncontrado('Liquidación');
      if (l.estado !== 'borrador') throw conflicto('NO_EDITABLE', 'La planilla ya está confirmada o anulada');
      const n = await tx.selectFrom('liquidacion_item').select((eb) => eb.fn.countAll<string>().as('n')).where('liquidacion_id', '=', id).where('bruto', '>', '0').executeTakeFirstOrThrow();
      if (!Number(n.n)) throw invalido('La planilla no tiene montos para liquidar');
      // Las líneas sin monto (por ejemplo, jornaleros sin días) no se confirman.
      await tx.deleteFrom('liquidacion_item').where('liquidacion_id', '=', id).where('bruto', '=', '0').execute();
      await recalcularTotales(tx, id);
      await tx.updateTable('liquidacion').set({ estado: 'confirmada', confirmada_por: ctx.usuarioId, confirmada_en: new Date() }).where('id', '=', id).execute();
      const r = await leerLiquidacion(tx, id);
      await auditar(tx, { ...ctx, ...o }, { accion: 'confirmar', entidad: 'liquidacion', entidadId: id, despues: { periodo: l.periodo, tipo: l.tipo, funcionarios: r.items.length, neto: r.totales.neto } });
      return r;
    });
  }

  /** Pago del neto: transferencia desde una cuenta bancaria o efectivo de la caja abierta del usuario. */
  @Requiere('salario', 'editar')
  @Post(':id/pagar')
  @HttpCode(200)
  pagar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(pagoLiquidacionEntrada, body);
    if (d.fecha > hoy()) throw invalido('La fecha de pago no puede ser futura');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const l = await tx.selectFrom('liquidacion').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!l) throw noEncontrado('Liquidación');
      if (l.estado !== 'confirmada') throw conflicto('NO_CONFIRMADA', 'Confirme la planilla antes de pagarla');
      if (l.pago_fecha) throw conflicto('YA_PAGADA', 'La planilla ya está pagada');
      const neto = new Decimal(l.neto);
      const titulo = l.tipo === 'aguinaldo' ? `Aguinaldo ${l.periodo.slice(0, 4)}` : `Sueldos ${l.periodo.slice(5, 7)}/${l.periodo.slice(0, 4)}`;
      let sesionId: string | null = null;
      if (d.medio === 'banco') {
        await obtenerCuentaBancaria(tx, d.cuentaBancariaId!);
        await movimientoBancario(tx, ctx, { cuentaId: d.cuentaBancariaId!, fecha: d.fecha, tipo: 'sueldos', descripcion: `Pago de ${titulo}`, monto: neto.neg(), origenTipo: 'liquidacion', origenId: id });
      } else {
        const caja = await obtenerCaja(tx, ctx, d.cajaId!, true);
        const sesion = await sesionAbierta(tx, caja.id);
        if (!sesion || sesion.usuario_id !== ctx.usuarioId) throw conflicto('CAJA_CERRADA', 'Para pagar en efectivo, la caja debe estar abierta con su usuario');
        const ef = (await esperado(tx, sesion.id)).find((e) => e.moneda === 'PYG' && e.medio === 'efectivo');
        if (new Decimal(ef?.monto ?? 0).lt(neto)) throw conflicto('SALDO_INSUFICIENTE', 'No hay suficiente efectivo en la caja');
        await tx
          .insertInto('movimiento_caja')
          .values({ empresa_id: ctx.empresaId, sesion_id: sesion.id, tipo: 'retiro', medio: 'efectivo', moneda: 'PYG', monto: neto.neg().toFixed(2), venta_id: null, motivo: `Pago de ${titulo}`, autorizado_por: null, creado_por: ctx.usuarioId })
          .execute();
        sesionId = sesion.id;
      }
      await tx
        .updateTable('liquidacion')
        .set({ pago_fecha: d.fecha, pago_medio: d.medio, pago_cuenta_id: d.medio === 'banco' ? d.cuentaBancariaId! : null, pago_sesion_caja_id: sesionId, pagada_por: ctx.usuarioId })
        .where('id', '=', id)
        .execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'pagar', entidad: 'liquidacion', entidadId: id, despues: { ...d, neto: neto.toFixed(0) } });
      return leerLiquidacion(tx, id);
    });
  }

  /** Un borrador se descarta; una planilla confirmada y sin pagar se anula (su asiento se revierte). */
  @Requiere('salario', 'editar')
  @Post(':id/anular')
  @HttpCode(200)
  anular(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ motivo: z.string().trim().min(5, 'Indique el motivo').max(300) }), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const l = await tx.selectFrom('liquidacion').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!l) throw noEncontrado('Liquidación');
      if (l.estado === 'anulada') throw conflicto('YA_ANULADA', 'La planilla ya está anulada');
      if (l.pago_fecha) throw conflicto('PAGADA', 'Una planilla pagada no se anula');
      await tx.updateTable('liquidacion').set({ estado: 'anulada', anulada_por: ctx.usuarioId, anulada_en: new Date(), motivo_anulacion: d.motivo }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'anular', entidad: 'liquidacion', entidadId: id, despues: d });
      return leerLiquidacion(tx, id);
    });
  }
}

function valoresItem(s: ReturnType<typeof calcularSueldo>) {
  return {
    salario_base: s.salarioBase.toFixed(2),
    monto_horas_extra: s.montoHorasExtra.toFixed(2),
    otros_ingresos: s.otrosIngresos.toFixed(2),
    bonificacion: s.bonificacion.toFixed(2),
    imponible: s.imponible.toFixed(2),
    bruto: s.bruto.toFixed(2),
    ips_obrero: s.ipsObrero.toFixed(2),
    ips_patronal: s.ipsPatronal.toFixed(2),
    descuentos: s.descuentos.toFixed(2),
    neto: s.neto.toFixed(2),
  };
}
