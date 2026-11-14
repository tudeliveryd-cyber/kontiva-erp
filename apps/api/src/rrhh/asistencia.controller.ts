import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { leerArchivoReloj, marcacionManualEntrada, novedadEntrada, vacacionAjusteEntrada, vacacionesDevengadas, vacacionGoceEntrada } from '@kontiva/shared';
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

/**
 * Valida y registra una novedad (un día o un rango). Las validaciones consultan antes de insertar, así un
 * rechazo no deja la transacción en error y el registro por lote puede seguir con las demás.
 */
export async function registrarNovedad(tx: Tx, ctx: Ctx, d: ReturnType<typeof novedadEntrada.parse>) {
  const fechas = diasDelRango(d.fecha, d.hasta ?? d.fecha);
  if (fechas.length > 62) throw invalido('El rango no puede superar 62 días');
  if (d.tipo === 'horas_extra' && fechas.length > 1) throw invalido('Las horas extra se cargan por día');
  if (fechas[fechas.length - 1]! > sumarDias(hoyPy(), 31)) throw invalido('No se cargan novedades con más de un mes de anticipación');
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
  return filas.map((x) => x.id);
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
      const marcaciones = ids.length
        ? await tx.selectFrom('marcacion').select(['id', 'funcionario_id', 'fecha', 'hora', 'origen']).where('funcionario_id', 'in', ids).where('fecha', '>=', f.desde).where('fecha', '<=', f.hasta).orderBy('fecha').orderBy('hora').execute()
        : [];
      return {
        marcaciones: marcaciones.map((m) => ({ id: m.id, funcionarioId: m.funcionario_id, fecha: m.fecha, hora: m.hora.slice(0, 5), origen: m.origen })),
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
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const ids = await registrarNovedad(tx, ctx, d);
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'novedad', entidadId: ids[0]!, despues: { ...d, dias: ids.length } });
      return { ids };
    });
  }

  /** Registra varias novedades (las propuestas por el reloj); las que no se pueden registrar se informan. */
  @Requiere('asistencia', 'editar')
  @Post('lote')
  @HttpCode(200)
  lote(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ novedades: z.array(z.unknown()).min(1).max(500) }), body);
    const novedades = d.novedades.map((n) => validar(novedadEntrada, n));
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let registradas = 0;
      const rechazadas: { indice: number; motivo: string }[] = [];
      for (const [i, n] of novedades.entries()) {
        try {
          registradas += (await registrarNovedad(tx, ctx, n)).length;
        } catch (e) {
          rechazadas.push({ indice: i, motivo: e instanceof Error ? e.message : 'No se pudo registrar' });
        }
      }
      if (registradas) await auditar(tx, { ...ctx, ...o }, { accion: 'crear_lote', entidad: 'novedad', entidadId: ctx.empresaId, despues: { registradas, rechazadas: rechazadas.length } });
      return { registradas, rechazadas };
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

const TOLERANCIA_MIN = 10;
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const diaSemana = (f: string) => new Date(`${f}T12:00:00Z`).getUTCDay();

@Controller('rrhh/marcaciones')
export class MarcacionesController {
  constructor(private readonly db: Db) {}

  /**
   * Importa el archivo del reloj. Cada línea se asigna al funcionario cuyo código del reloj (o cédula) aparece
   * antes de la fecha; las marcaciones repetidas se ignoran, así el mismo archivo se puede importar de nuevo.
   */
  @Requiere('asistencia', 'editar')
  @Post('importar')
  @HttpCode(200)
  importar(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ contenido: z.string().min(1, 'El archivo está vacío').max(3_000_000, 'El archivo supera los 3 MB'), nombreArchivo: z.string().max(200).optional() }), body);
    const { lineas, ignoradas } = leerArchivoReloj(d.contenido);
    if (!lineas.length) throw invalido('No se encontraron marcaciones con código, fecha y hora en el archivo');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const funcs = (await tx.selectFrom('funcionario').select(['id', 'sucursal_id', 'codigo_reloj', 'documento', 'fecha_ingreso', 'fecha_egreso']).execute()).filter((f) => enSucursal(ctx, f.sucursal_id));
      const porClave = new Map<string, (typeof funcs)[number]>();
      for (const f of funcs) {
        porClave.set(f.documento, f);
        if (f.codigo_reloj) porClave.set(f.codigo_reloj.toLowerCase(), f);
      }
      const sinFuncionario = new Set<string>();
      let fueraDePeriodo = 0;
      const filas: { funcionario_id: string; fecha: string; hora: string }[] = [];
      const meses = new Set<string>();
      for (const l of lineas) {
        const f = l.claves.map((c) => porClave.get(c.toLowerCase()) ?? porClave.get(c)).find(Boolean);
        if (!f) {
          sinFuncionario.add(l.claves[0]!);
          continue;
        }
        if (l.fecha < f.fecha_ingreso || (f.fecha_egreso && l.fecha > f.fecha_egreso) || l.fecha > hoyPy()) {
          fueraDePeriodo++;
          continue;
        }
        filas.push({ funcionario_id: f.id, fecha: l.fecha, hora: l.hora });
        meses.add(l.fecha.slice(0, 7));
      }
      let importadas = 0;
      for (let i = 0; i < filas.length; i += 1000) {
        const r = await tx
          .insertInto('marcacion')
          .values(filas.slice(i, i + 1000).map((x) => ({ empresa_id: ctx.empresaId, ...x, origen: 'reloj' as const, creado_por: ctx.usuarioId })))
          .onConflict((oc) => oc.doNothing())
          .returning('id')
          .execute();
        importadas += r.length;
      }
      const desde = filas.reduce((m, x) => (x.fecha < m ? x.fecha : m), '9999-12-31');
      const hasta = filas.reduce((m, x) => (x.fecha > m ? x.fecha : m), '0000-01-01');
      await auditar(tx, { ...ctx, ...o }, { accion: 'importar', entidad: 'marcacion', entidadId: ctx.empresaId, despues: { archivo: d.nombreArchivo, lineas: lineas.length, importadas } });
      return {
        lineas: lineas.length,
        importadas,
        repetidas: filas.length - importadas,
        ignoradas,
        fueraDePeriodo,
        sinFuncionario: [...sinFuncionario].sort().slice(0, 50),
        desde: filas.length ? desde : null,
        hasta: filas.length ? hasta : null,
      };
    });
  }

  /** Marcación cargada a mano (olvido del funcionario, reloj fuera de servicio). */
  @Requiere('asistencia', 'editar')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(marcacionManualEntrada, body);
    if (d.fecha > hoyPy()) throw invalido('No se cargan marcaciones futuras');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const f = await obtenerFuncionario(tx, ctx, d.funcionarioId);
      if (d.fecha < f.fecha_ingreso || (f.fecha_egreso && d.fecha > f.fecha_egreso)) throw invalido('La fecha está fuera del período en que trabajó el funcionario');
      const dup = await tx.selectFrom('marcacion').select('id').where('funcionario_id', '=', f.id).where('fecha', '=', d.fecha).where('hora', '=', `${d.hora}:00`).executeTakeFirst();
      if (dup) throw conflicto('MARCACION_EXISTENTE', 'Esa marcación ya está registrada');
      const r = await tx
        .insertInto('marcacion')
        .values({ empresa_id: ctx.empresaId, funcionario_id: f.id, fecha: d.fecha, hora: `${d.hora}:00`, origen: 'manual', creado_por: ctx.usuarioId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'marcacion', entidadId: r.id, despues: d });
      return { id: r.id };
    });
  }

  @Requiere('asistencia', 'editar')
  @Delete(':id')
  @HttpCode(200)
  quitar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @OrigenPeticion() o: Origen) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const m = await tx.selectFrom('marcacion').selectAll().where('id', '=', id).executeTakeFirst();
      if (!m) throw noEncontrado('Marcación');
      await obtenerFuncionario(tx, ctx, m.funcionario_id);
      await tx.deleteFrom('marcacion').where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'quitar', entidad: 'marcacion', entidadId: id, antes: { funcionarioId: m.funcionario_id, fecha: m.fecha, hora: m.hora, origen: m.origen } });
      return { ok: true };
    });
  }

  /**
   * Compara las marcaciones con el horario de cada funcionario y propone novedades: ausencia si un día laborable
   * no tiene marcaciones, llegada tardía pasados 10 minutos de tolerancia, y horas extra por cada media hora
   * cumplida después de la salida (al 100 % los domingos). No registra nada: la empresa revisa y confirma,
   * porque el reloj no sabe de feriados ni de permisos.
   */
  @Requiere('asistencia', 'ver')
  @Get('propuestas')
  propuestas(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const q = validar(z.object({ desde: fechaDia, hasta: fechaDia }), query);
    const ayer = sumarDias(hoyPy(), -1);
    const hasta = q.hasta > ayer ? ayer : q.hasta;
    if (hasta < q.desde || diasDelRango(q.desde, hasta).length > 62) throw invalido('Elija un rango cerrado de hasta 62 días');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const funcs = (
        await tx
          .selectFrom('funcionario')
          .selectAll()
          .where('fecha_ingreso', '<=', hasta)
          .where((eb) => eb.or([eb('fecha_egreso', 'is', null), eb('fecha_egreso', '>=', q.desde)]))
          .orderBy('nombre')
          .execute()
      ).filter((f) => enSucursal(ctx, f.sucursal_id));
      const ids = funcs.map((f) => f.id);
      if (!ids.length) return { propuestas: [], incompletas: [], sinHorario: [] };
      const marcas = await tx.selectFrom('marcacion').select(['funcionario_id', 'fecha', 'hora']).where('funcionario_id', 'in', ids).where('fecha', '>=', q.desde).where('fecha', '<=', hasta).orderBy('hora').execute();
      const novs = await tx.selectFrom('novedad').select(['funcionario_id', 'fecha', 'tipo', 'recargo']).where('funcionario_id', 'in', ids).where('fecha', '>=', q.desde).where('fecha', '<=', hasta).execute();
      const vacs = await tx.selectFrom('vacacion').select(['funcionario_id', 'desde', 'hasta']).where('funcionario_id', 'in', ids).where('tipo', '=', 'goce').where('estado', '=', 'vigente').where('desde', '<=', hasta).where('hasta', '>=', q.desde).execute();
      const propuestas: { funcionarioId: string; nombre: string; fecha: string; tipo: 'ausencia' | 'llegada_tardia' | 'horas_extra'; horas?: number; recargo?: 50 | 100; detalle: string }[] = [];
      const incompletas: { funcionarioId: string; nombre: string; fecha: string; hora: string }[] = [];
      const sinHorario: string[] = [];
      for (const f of funcs) {
        if (!f.horario_entrada || !f.horario_salida) {
          if (marcas.some((m) => m.funcionario_id === f.id)) sinHorario.push(f.nombre);
          continue;
        }
        for (const fecha of diasDelRango(q.desde, hasta)) {
          if (fecha < f.fecha_ingreso || (f.fecha_egreso && fecha > f.fecha_egreso)) continue;
          if (vacs.some((v) => v.funcionario_id === f.id && v.desde! <= fecha && v.hasta! >= fecha)) continue;
          const delDia = novs.filter((n) => n.funcionario_id === f.id && n.fecha === fecha);
          if (delDia.some((n) => n.tipo === 'ausencia' || n.tipo === 'ausencia_justificada' || n.tipo === 'reposo')) continue;
          const dia = diaSemana(fecha);
          const laborable = dia !== 0 && (dia !== 6 || f.trabaja_sabado);
          const hs = marcas.filter((m) => m.funcionario_id === f.id && m.fecha === fecha).map((m) => m.hora.slice(0, 5));
          if (!hs.length) {
            if (laborable) propuestas.push({ funcionarioId: f.id, nombre: f.nombre, fecha, tipo: 'ausencia', detalle: 'Sin marcaciones' });
            continue;
          }
          if (hs.length === 1) {
            incompletas.push({ funcionarioId: f.id, nombre: f.nombre, fecha, hora: hs[0]! });
            continue;
          }
          const entrada = hs[0]!;
          const salida = hs[hs.length - 1]!;
          if (!laborable) {
            // Día no laborable trabajado: todas las horas son extra al 100 %.
            const h = Math.floor((minutos(salida) - minutos(entrada)) / 30) / 2;
            if (h > 0 && !delDia.some((n) => n.tipo === 'horas_extra' && n.recargo === 100))
              propuestas.push({ funcionarioId: f.id, nombre: f.nombre, fecha, tipo: 'horas_extra', horas: h, recargo: 100, detalle: `${dia === 0 ? 'Domingo' : 'Día no laborable'}: ${entrada} a ${salida}` });
            continue;
          }
          const tarde = minutos(entrada) - minutos(f.horario_entrada);
          if (tarde > TOLERANCIA_MIN && !delDia.some((n) => n.tipo === 'llegada_tardia' || n.tipo === 'permiso'))
            propuestas.push({ funcionarioId: f.id, nombre: f.nombre, fecha, tipo: 'llegada_tardia', horas: Math.round((tarde / 60) * 100) / 100, detalle: `Entró ${entrada}, horario ${f.horario_entrada.slice(0, 5)}` });
          const fin = dia === 6 && f.sabado_salida ? f.sabado_salida : f.horario_salida;
          const extra = Math.floor((minutos(salida) - minutos(fin)) / 30) / 2;
          if (extra > 0 && !delDia.some((n) => n.tipo === 'horas_extra' && n.recargo === 50))
            propuestas.push({ funcionarioId: f.id, nombre: f.nombre, fecha, tipo: 'horas_extra', horas: extra, recargo: 50, detalle: `Salió ${salida}, horario ${fin.slice(0, 5)}` });
        }
      }
      return { desde: q.desde, hasta, propuestas, incompletas, sinHorario };
    });
  }
}
