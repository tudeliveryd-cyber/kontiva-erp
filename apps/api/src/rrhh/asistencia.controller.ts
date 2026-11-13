import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { novedadEntrada, vacacionAjusteEntrada, vacacionesDevengadas, vacacionGoceEntrada } from '@kontiva/shared';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { enSucursal, exigirSucursal } from '../comun/alcance';
import { auditar } from '../comun/auditoria';
import { Contexto, OrigenPeticion, type Ctx, type Origen } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { conflicto, invalido, noEncontrado } from '../comun/errores';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';

export const hoyPy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
const fechaDia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sumarDias = (f: string, n: number) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const diasDelRango = (desde: string, hasta: string) => {
  const r: string[] = [];
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) r.push(f);
  return r;
};

async function obtenerFuncionario(tx: Tx, ctx: Ctx, id: string) {
  const f = await tx.selectFrom('funcionario').selectAll().where('id', '=', id).executeTakeFirst();
  if (!f) throw noEncontrado('Funcionario');
  exigirSucursal(ctx, f.sucursal_id, 'Funcionario');
  return f;
}

/** Una novedad de un mes ya liquidado (planilla confirmada) no se modifica: cambiaría lo pagado. */
async function exigirMesAbierto(tx: Tx, funcionarioId: string, fechas: string[]) {
  const meses = [...new Set(fechas.map((f) => `${f.slice(0, 7)}-01`))];
  const l = await tx
    .selectFrom('liquidacion as l')
    .innerJoin('liquidacion_item as i', 'i.liquidacion_id', 'l.id')
    .select('l.periodo')
    .where('l.tipo', '=', 'mensual')
    .where('l.estado', '=', 'confirmada')
    .where('l.periodo', 'in', meses)
    .where('i.funcionario_id', '=', funcionarioId)
    .executeTakeFirst();
  if (l) throw conflicto('MES_LIQUIDADO', `Los sueldos de ${l.periodo.slice(5, 7)}/${l.periodo.slice(0, 4)} ya están liquidados`);
}

/** Saldo de vacaciones a una fecha: días devengados por año de servicio, menos lo gozado, más los ajustes. */
export async function saldoVacaciones(tx: Tx, f: { id: string; fecha_ingreso: string }, al: string) {
  const dev = vacacionesDevengadas(f.fecha_ingreso, al);
  const regs = await tx.selectFrom('vacacion').select(['tipo', 'dias']).where('funcionario_id', '=', f.id).where('estado', '=', 'vigente').execute();
  const gozados = regs.filter((r) => r.tipo === 'goce').reduce((s, r) => s.plus(r.dias), new Decimal(0));
  const ajustes = regs.filter((r) => r.tipo === 'ajuste').reduce((s, r) => s.plus(r.dias), new Decimal(0));
  return {
    periodos: dev.periodos,
    causados: dev.causados,
    gozados: gozados.toNumber(),
    ajustes: ajustes.toNumber(),
    pendientes: new Decimal(dev.causados).minus(gozados).plus(ajustes).toNumber(),
    proporcional: dev.proporcional,
  };
}

@Controller('rrhh/novedades')
export class NovedadesController {
  constructor(private readonly db: Db) {}

  /** Planilla de asistencia de un rango (hasta 62 días): funcionarios vigentes, novedades y vacaciones gozadas. */
  @Requiere('asistencia', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ desde: fechaDia, hasta: fechaDia, funcionarioId: z.string().uuid().optional() }), query);
    if (f.hasta < f.desde || diasDelRango(f.desde, f.hasta).length > 62) throw invalido('Elija un rango de hasta 62 días');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let q = tx
        .selectFrom('funcionario as f')
        .innerJoin('sucursal as s', 's.id', 'f.sucursal_id')
        .select(['f.id', 'f.nombre', 'f.cargo', 'f.sucursal_id', 's.nombre as sucursal', 'f.fecha_ingreso', 'f.fecha_egreso', 'f.remuneracion'])
        .where('f.fecha_ingreso', '<=', f.hasta)
        .where((eb) => eb.or([eb('f.fecha_egreso', 'is', null), eb('f.fecha_egreso', '>=', f.desde)]))
        .orderBy('f.nombre');
      if (f.funcionarioId) q = q.where('f.id', '=', f.funcionarioId);
      const funcs = (await q.execute()).filter((x) => enSucursal(ctx, x.sucursal_id));
      const ids = funcs.map((x) => x.id);
      const novedades = ids.length
        ? await tx.selectFrom('novedad').selectAll().where('funcionario_id', 'in', ids).where('fecha', '>=', f.desde).where('fecha', '<=', f.hasta).orderBy('fecha').orderBy('creado_en').execute()
        : [];
      const vacaciones = ids.length
        ? await tx
            .selectFrom('vacacion')
            .select(['id', 'funcionario_id', 'desde', 'hasta', 'dias'])
            .where('funcionario_id', 'in', ids)
            .where('tipo', '=', 'goce')
            .where('estado', '=', 'vigente')
            .where('desde', '<=', f.hasta)
            .where('hasta', '>=', f.desde)
            .execute()
        : [];
      return {
        funcionarios: funcs.map((x) => ({ id: x.id, nombre: x.nombre, cargo: x.cargo, sucursal: x.sucursal, fechaIngreso: x.fecha_ingreso, fechaEgreso: x.fecha_egreso, remuneracion: x.remuneracion })),
        novedades: novedades.map((n) => ({ id: n.id, funcionarioId: n.funcionario_id, fecha: n.fecha, tipo: n.tipo, horas: n.horas, recargo: n.recargo, observacion: n.observacion })),
        vacaciones: vacaciones.map((v) => ({ id: v.id, funcionarioId: v.funcionario_id, desde: v.desde, hasta: v.hasta, dias: v.dias })),
      };
    });
  }

  /** Registra la novedad de un día o de cada día de un rango (por ejemplo, un reposo). */
  @Requiere('asistencia', 'editar')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(novedadEntrada, body);
    const fechas = diasDelRango(d.fecha, d.hasta ?? d.fecha);
    if (fechas.length > 62) throw invalido('El rango no puede superar 62 días');
    if (d.tipo === 'horas_extra' && fechas.length > 1) throw invalido('Las horas extra se cargan por día');
    if (fechas[fechas.length - 1]! > sumarDias(hoyPy(), 31)) throw invalido('No se cargan novedades con más de un mes de anticipación');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const f = await obtenerFuncionario(tx, ctx, d.funcionarioId);
      if (d.fecha < f.fecha_ingreso || (f.fecha_egreso && fechas[fechas.length - 1]! > f.fecha_egreso)) throw invalido('Las fechas están fuera del período en que trabajó el funcionario');
      await exigirMesAbierto(tx, f.id, fechas);
      const recargo = d.tipo === 'horas_extra' ? d.recargo! : null;
      const existentes = await tx
        .selectFrom('novedad')
        .select('fecha')
        .where('funcionario_id', '=', f.id)
        .where('tipo', '=', d.tipo)
        .where('fecha', 'in', fechas)
        .where((eb) => (recargo ? eb('recargo', '=', recargo) : eb('recargo', 'is', null)))
        .execute();
      if (existentes.length) throw conflicto('NOVEDAD_EXISTENTE', `Ya está cargada para el ${existentes[0]!.fecha.split('-').reverse().join('/')}`);
      // Una ausencia excluye otra ausencia o reposo el mismo día.
      if (['ausencia', 'ausencia_justificada', 'reposo'].includes(d.tipo)) {
        const choque = await tx.selectFrom('novedad').select('fecha').where('funcionario_id', '=', f.id).where('tipo', 'in', ['ausencia', 'ausencia_justificada', 'reposo']).where('fecha', 'in', fechas).executeTakeFirst();
        if (choque) throw conflicto('NOVEDAD_EXISTENTE', `El ${choque.fecha.split('-').reverse().join('/')} ya tiene una ausencia o reposo`);
      }
      const filas = await tx
        .insertInto('novedad')
        .values(
          fechas.map((fecha) => ({
            empresa_id: ctx.empresaId,
            funcionario_id: f.id,
            fecha,
            tipo: d.tipo,
            horas: new Decimal(d.horas ?? 0).toFixed(4),
            recargo,
            observacion: d.observacion ?? null,
            creado_por: ctx.usuarioId,
          })),
        )
        .returning('id')
        .execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'novedad', entidadId: filas[0]!.id, despues: { ...d, dias: fechas.length } });
      return { ids: filas.map((x) => x.id) };
    });
  }

  @Requiere('asistencia', 'editar')
  @Delete(':id')
  @HttpCode(200)
  quitar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @OrigenPeticion() o: Origen) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const n = await tx.selectFrom('novedad').selectAll().where('id', '=', id).executeTakeFirst();
      if (!n) throw noEncontrado('Novedad');
      await obtenerFuncionario(tx, ctx, n.funcionario_id);
      await exigirMesAbierto(tx, n.funcionario_id, [n.fecha]);
      await tx.deleteFrom('novedad').where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'quitar', entidad: 'novedad', entidadId: id, antes: { funcionarioId: n.funcionario_id, fecha: n.fecha, tipo: n.tipo, horas: n.horas } });
      return { ok: true };
    });
  }
}

@Controller('rrhh/vacaciones')
export class VacacionesController {
  constructor(private readonly db: Db) {}

  /** Saldo de cada funcionario vigente. */
  @Requiere('asistencia', 'ver')
  @Get('resumen')
  resumen(@Contexto() ctx: Ctx) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const hoy = hoyPy();
      const funcs = (
        await tx
          .selectFrom('funcionario')
          .select(['id', 'nombre', 'cargo', 'sucursal_id', 'fecha_ingreso'])
          .where((eb) => eb.or([eb('fecha_egreso', 'is', null), eb('fecha_egreso', '>=', hoy)]))
          .orderBy('nombre')
          .execute()
      ).filter((f) => enSucursal(ctx, f.sucursal_id));
      const r = [];
      for (const f of funcs) {
        const s = await saldoVacaciones(tx, f, hoy);
        r.push({ funcionarioId: f.id, nombre: f.nombre, cargo: f.cargo, fechaIngreso: f.fecha_ingreso, causados: s.causados, gozados: s.gozados, ajustes: s.ajustes, pendientes: s.pendientes, proporcional: s.proporcional });
      }
      return r;
    });
  }

  @Requiere('asistencia', 'ver')
  @Get()
  detalle(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const q = validar(z.object({ funcionarioId: z.string().uuid() }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const f = await obtenerFuncionario(tx, ctx, q.funcionarioId);
      const al = f.fecha_egreso && f.fecha_egreso < hoyPy() ? f.fecha_egreso : hoyPy();
      const saldo = await saldoVacaciones(tx, f, al);
      const registros = await tx.selectFrom('vacacion').selectAll().where('funcionario_id', '=', f.id).orderBy('creado_en', 'desc').execute();
      return {
        ...saldo,
        registros: registros.map((v) => ({ id: v.id, tipo: v.tipo, desde: v.desde, hasta: v.hasta, dias: v.dias, observacion: v.observacion, estado: v.estado, motivoAnulacion: v.motivo_anulacion, creadoEn: v.creado_en })),
      };
    });
  }

  /** Goce de vacaciones: días hábiles tomados, dentro del saldo. */
  @Requiere('asistencia', 'editar')
  @Post('goce')
  goce(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(vacacionGoceEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const f = await obtenerFuncionario(tx, ctx, d.funcionarioId);
      await tx.selectFrom('funcionario').select('id').where('id', '=', f.id).forUpdate().execute();
      if (d.desde < f.fecha_ingreso || (f.fecha_egreso && d.hasta > f.fecha_egreso)) throw invalido('Las fechas están fuera del período en que trabajó el funcionario');
      if (diasDelRango(d.desde, d.hasta).length > 120) throw invalido('El período es demasiado largo');
      const choque = await tx.selectFrom('vacacion').select(['desde', 'hasta']).where('funcionario_id', '=', f.id).where('tipo', '=', 'goce').where('estado', '=', 'vigente').where('desde', '<=', d.hasta).where('hasta', '>=', d.desde).executeTakeFirst();
      if (choque) throw conflicto('VACACIONES_SUPERPUESTAS', 'Ya hay vacaciones registradas en esas fechas');
      const saldo = await saldoVacaciones(tx, f, d.desde);
      if (new Decimal(d.dias).gt(saldo.pendientes)) throw conflicto('SIN_SALDO', `El saldo de vacaciones es de ${saldo.pendientes} días`);
      const r = await tx
        .insertInto('vacacion')
        .values({ empresa_id: ctx.empresaId, funcionario_id: f.id, tipo: 'goce', desde: d.desde, hasta: d.hasta, dias: new Decimal(d.dias).toFixed(4), observacion: d.observacion ?? null, creado_por: ctx.usuarioId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'vacacion', entidadId: r.id, despues: d });
      return { id: r.id };
    });
  }

  /** Ajuste del saldo: saldo inicial al empezar a usar el sistema, días ya gozados antes, períodos acordados. */
  @Requiere('asistencia', 'editar')
  @Post('ajuste')
  ajuste(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(vacacionAjusteEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const f = await obtenerFuncionario(tx, ctx, d.funcionarioId);
      const r = await tx
        .insertInto('vacacion')
        .values({ empresa_id: ctx.empresaId, funcionario_id: f.id, tipo: 'ajuste', dias: new Decimal(d.dias).toFixed(4), observacion: d.observacion, creado_por: ctx.usuarioId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await auditar(tx, { ...ctx, ...o }, { accion: 'ajustar', entidad: 'vacacion', entidadId: r.id, despues: d });
      return { id: r.id };
    });
  }

  @Requiere('asistencia', 'editar')
  @Post(':id/anular')
  @HttpCode(200)
  anular(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ motivo: z.string().trim().min(5, 'Indique el motivo').max(300) }), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const v = await tx.selectFrom('vacacion').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!v) throw noEncontrado('Registro de vacaciones');
      await obtenerFuncionario(tx, ctx, v.funcionario_id);
      if (v.estado === 'anulada') throw conflicto('YA_ANULADA', 'El registro ya está anulado');
      await tx.updateTable('vacacion').set({ estado: 'anulada', anulada_por: ctx.usuarioId, anulada_en: new Date(), motivo_anulacion: d.motivo }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'anular', entidad: 'vacacion', entidadId: id, antes: { tipo: v.tipo, desde: v.desde, hasta: v.hasta, dias: v.dias }, despues: d });
      return { ok: true };
    });
  }
}
