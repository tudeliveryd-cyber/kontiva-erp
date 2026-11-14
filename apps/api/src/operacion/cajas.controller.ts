import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { aperturaCajaEntrada, cajaEntrada, cierreCajaEntrada, cotizacionEntrada, movimientoCajaEntrada } from '@kontiva/shared';
import Decimal from 'decimal.js';
import { sql } from 'kysely';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { enSucursal, exigirSucursal } from '../comun/alcance';
import { auditar } from '../comun/auditoria';
import { Contexto, OrigenPeticion, tiene, type Ctx, type Origen } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { conflicto, invalido, noEncontrado, prohibido } from '../comun/errores';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';
import type { Medio, Moneda } from '../db/tipos';

export async function obtenerCaja(tx: Tx, ctx: Ctx, id: string, bloquear = false) {
  let q = tx.selectFrom('caja').selectAll().where('id', '=', id);
  if (bloquear) q = q.forUpdate();
  const c = await q.executeTakeFirst();
  if (!c) throw noEncontrado('Caja');
  exigirSucursal(ctx, c.sucursal_id, 'Caja');
  return c;
}

export async function sesionAbierta(tx: Tx, cajaId: string) {
  return tx.selectFrom('sesion_caja').selectAll().where('caja_id', '=', cajaId).where('estado', '=', 'abierta').executeTakeFirst();
}

/** Cotización vigente (la última cargada) de cada moneda en la sucursal. */
export async function cotizacionesVigentes(tx: Tx, sucursalId: string) {
  const { rows } = await sql<{ moneda: 'USD' | 'BRL'; compra: string; venta: string; creado_en: Date }>`
    SELECT DISTINCT ON (moneda) moneda, compra, venta, creado_en FROM cotizacion
    WHERE sucursal_id = ${sucursalId}::uuid ORDER BY moneda, creado_en DESC`.execute(tx);
  return rows;
}

/** Saldo esperado de la sesión por moneda y medio, a partir de sus movimientos. */
export async function esperado(tx: Tx, sesionId: string) {
  const filas = await tx
    .selectFrom('movimiento_caja')
    .select(['moneda', 'medio', (eb) => eb.fn.sum<string>('monto').as('total')])
    .where('sesion_id', '=', sesionId)
    .groupBy(['moneda', 'medio'])
    .execute();
  return filas.map((f) => ({ moneda: f.moneda, medio: f.medio, monto: new Decimal(f.total).toFixed(2) }));
}

async function resumenSesion(tx: Tx, sesionId: string) {
  const s = await tx
    .selectFrom('sesion_caja as s')
    .innerJoin('usuario as u', 'u.id', 's.usuario_id')
    .select(['s.id', 's.caja_id', 's.estado', 's.abierta_en', 's.cerrada_en', 's.usuario_id', 'u.nombre as usuario'])
    .where('s.id', '=', sesionId)
    .executeTakeFirstOrThrow();
  const ventas = await tx
    .selectFrom('venta')
    .select([(eb) => eb.fn.countAll<string>().as('n'), (eb) => eb.fn.sum<string>('total').as('total')])
    .where('sesion_caja_id', '=', sesionId)
    .where('estado', '=', 'confirmada')
    .executeTakeFirstOrThrow();
  const anuladas = await tx.selectFrom('venta').select((eb) => eb.fn.countAll<string>().as('n')).where('sesion_caja_id', '=', sesionId).where('estado', '=', 'anulada').executeTakeFirstOrThrow();
  const arqueo = await tx.selectFrom('arqueo').select(['moneda', 'medio', 'esperado', 'contado', 'diferencia']).where('sesion_id', '=', sesionId).execute();
  const movimientos = await tx
    .selectFrom('movimiento_caja')
    .select(['tipo', 'medio', 'moneda', 'monto', 'motivo', 'creado_en'])
    .where('sesion_id', '=', sesionId)
    .where('tipo', 'in', ['apertura', 'retiro', 'ingreso', 'cobro', 'pago_proveedor'])
    .orderBy('id')
    .execute();
  return {
    id: s.id,
    cajaId: s.caja_id,
    estado: s.estado,
    abiertaEn: s.abierta_en,
    cerradaEn: s.cerrada_en,
    usuario: { id: s.usuario_id, nombre: s.usuario },
    ventas: { cantidad: Number(ventas.n), total: new Decimal(ventas.total ?? 0).toFixed(2), anuladas: Number(anuladas.n) },
    esperado: await esperado(tx, sesionId),
    movimientos,
    arqueo,
  };
}

@Controller('cajas')
export class CajasController {
  constructor(
    private readonly db: Db,
    private readonly auth: AuthService,
  ) {}

  @Requiere('caja', 'ver')
  @Get()
  listar(@Contexto() ctx: Ctx) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const cajas = await tx
        .selectFrom('caja as c')
        .innerJoin('sucursal as s', 's.id', 'c.sucursal_id')
        .innerJoin('deposito as d', 'd.id', 'c.deposito_id')
        .leftJoin('sesion_caja as se', (j) => j.onRef('se.caja_id', '=', 'c.id').on('se.estado', '=', 'abierta'))
        .leftJoin('usuario as u', 'u.id', 'se.usuario_id')
        .select([
          'c.id', 'c.nombre', 'c.activa', 'c.sucursal_id', 'c.deposito_id', 's.nombre as sucursal', 'd.nombre as deposito',
          'se.id as sesion_id', 'se.abierta_en', 'se.usuario_id', 'u.nombre as usuario',
        ])
        .orderBy('s.codigo')
        .orderBy('c.nombre')
        .execute();
      return cajas
        .filter((c) => enSucursal(ctx, c.sucursal_id))
        .map((c) => ({
          id: c.id,
          nombre: c.nombre,
          activa: c.activa,
          sucursal: { id: c.sucursal_id, nombre: c.sucursal },
          deposito: { id: c.deposito_id, nombre: c.deposito },
          sesion: c.sesion_id ? { id: c.sesion_id, abiertaEn: c.abierta_en, usuario: { id: c.usuario_id, nombre: c.usuario }, propia: c.usuario_id === ctx.usuarioId } : null,
        }));
    });
  }

  @Requiere('caja', 'editar')
  @Post()
  crear(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(cajaEntrada, body);
    exigirSucursal(ctx, d.sucursalId, 'Sucursal');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const lim = await tx.selectFrom('empresa as e').innerJoin('plan as p', 'p.id', 'e.plan_id').select(['p.max_cajas', 'p.codigo']).forUpdate('e').executeTakeFirstOrThrow();
      const activas = await tx.selectFrom('caja').select((eb) => eb.fn.countAll<string>().as('n')).where('activa', '=', true).executeTakeFirstOrThrow();
      if (lim.max_cajas !== null && Number(activas.n) >= lim.max_cajas) {
        throw conflicto('LIMITE_PLAN', `El plan ${lim.codigo} permite ${lim.max_cajas} caja(s). Cambie de plan para agregar más.`);
      }
      await this.validarDeposito(tx, d.depositoId, d.sucursalId);
      const c = await tx.insertInto('caja').values({ empresa_id: ctx.empresaId, nombre: d.nombre, sucursal_id: d.sucursalId, deposito_id: d.depositoId }).returningAll().executeTakeFirstOrThrow();
      await auditar(tx, { ...ctx, ...o }, { accion: 'crear', entidad: 'caja', entidadId: c.id, despues: c });
      return { id: c.id, nombre: c.nombre };
    });
  }

  @Requiere('caja', 'editar')
  @Patch(':id')
  editar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(cajaEntrada.partial(), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const antes = await obtenerCaja(tx, ctx, id, true);
      if (d.sucursalId && d.sucursalId !== antes.sucursal_id) throw invalido('Una caja no se cambia de sucursal: cree una nueva');
      if (d.depositoId) await this.validarDeposito(tx, d.depositoId, antes.sucursal_id);
      if (d.activa === false && (await sesionAbierta(tx, id))) throw conflicto('CAJA_ABIERTA', 'Cierre la caja antes de desactivarla');
      const c = await tx
        .updateTable('caja')
        .set({ ...(d.nombre && { nombre: d.nombre }), ...(d.depositoId && { deposito_id: d.depositoId }), ...(d.activa !== undefined && { activa: d.activa }) })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await auditar(tx, { ...ctx, ...o }, { accion: 'editar', entidad: 'caja', entidadId: id, antes, despues: c });
      return { id: c.id, nombre: c.nombre };
    });
  }

  private async validarDeposito(tx: Tx, depositoId: string, sucursalId: string) {
    const dep = await tx.selectFrom('deposito').select('sucursal_id').where('id', '=', depositoId).executeTakeFirst();
    if (!dep || dep.sucursal_id !== sucursalId) throw invalido('El depósito debe ser de la misma sucursal');
  }

  @Requiere('caja', 'crear')
  @Post(':id/abrir')
  abrir(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(aperturaCajaEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const caja = await obtenerCaja(tx, ctx, id, true);
      if (!caja.activa) throw conflicto('CAJA_INACTIVA', 'La caja está desactivada');
      if (await sesionAbierta(tx, id)) throw conflicto('CAJA_ABIERTA', 'La caja ya está abierta');
      const propia = await tx.selectFrom('sesion_caja').select('caja_id').where('usuario_id', '=', ctx.usuarioId).where('estado', '=', 'abierta').executeTakeFirst();
      if (propia) throw conflicto('USUARIO_CON_CAJA', 'Usted ya tiene otra caja abierta');
      const s = await tx.insertInto('sesion_caja').values({ empresa_id: ctx.empresaId, caja_id: id, usuario_id: ctx.usuarioId, cerrada_en: null, cerrada_por: null }).returning('id').executeTakeFirstOrThrow();
      const fondos = d.fondos.filter((f) => f.monto > 0);
      for (const f of fondos) {
        await tx
          .insertInto('movimiento_caja')
          .values({ empresa_id: ctx.empresaId, sesion_id: s.id, tipo: 'apertura', medio: 'efectivo', moneda: f.moneda, monto: f.monto.toFixed(2), venta_id: null, motivo: 'Fondo inicial', autorizado_por: null, creado_por: ctx.usuarioId })
          .execute();
      }
      await auditar(tx, { ...ctx, ...o }, { accion: 'abrir_caja', entidad: 'caja', entidadId: id, despues: { sesionId: s.id, fondos } });
      return resumenSesion(tx, s.id);
    });
  }

  @Requiere('caja', 'ver')
  @Get(':id/sesion')
  sesion(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      await obtenerCaja(tx, ctx, id);
      const s = await sesionAbierta(tx, id);
      return s ? resumenSesion(tx, s.id) : null;
    });
  }

  /** Retiro (sangría) o ingreso de efectivo. Requiere caja.aprobar o la autorización con PIN de un supervisor. */
  @Requiere('caja', 'crear')
  @Post(':id/movimientos')
  movimiento(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Headers('x-autorizacion') autorizacion: string | undefined, @OrigenPeticion() o: Origen) {
    const d = validar(movimientoCajaEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      await obtenerCaja(tx, ctx, id, true);
      const s = await sesionAbierta(tx, id);
      if (!s) throw conflicto('CAJA_CERRADA', 'La caja no está abierta');
      let autorizadoPor: string | null = null;
      if (!tiene(ctx, 'caja.aprobar')) {
        autorizadoPor = await this.auth.verificarAutorizacion(ctx, autorizacion, 'caja.aprobar');
        if (!autorizadoPor) throw prohibido('Retiros e ingresos requieren autorización de un supervisor');
      }
      if (d.tipo === 'retiro') {
        const disp = (await esperado(tx, s.id)).find((e) => e.moneda === d.moneda && e.medio === 'efectivo');
        if (new Decimal(disp?.monto ?? 0).lt(d.monto)) throw conflicto('SALDO_INSUFICIENTE', `No hay suficiente efectivo en ${d.moneda} en la caja`);
      }
      await tx
        .insertInto('movimiento_caja')
        .values({
          empresa_id: ctx.empresaId,
          sesion_id: s.id,
          tipo: d.tipo,
          medio: 'efectivo',
          moneda: d.moneda,
          monto: (d.tipo === 'retiro' ? -d.monto : d.monto).toFixed(2),
          venta_id: null,
          motivo: d.motivo,
          autorizado_por: autorizadoPor,
          creado_por: ctx.usuarioId,
        })
        .execute();
      await auditar(tx, { ...ctx, ...o }, { accion: d.tipo === 'retiro' ? 'retiro_caja' : 'ingreso_caja', entidad: 'caja', entidadId: id, autorizadoPor, despues: d });
      return resumenSesion(tx, s.id);
    });
  }

  /** Cierre con arqueo: lo contado contra lo esperado, por moneda y medio. La diferencia queda registrada. */
  @Requiere('arqueo', 'crear')
  @Post(':id/cerrar')
  @HttpCode(200)
  cerrar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(cierreCajaEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      await obtenerCaja(tx, ctx, id, true);
      const s = await sesionAbierta(tx, id);
      if (!s) throw conflicto('CAJA_CERRADA', 'La caja no está abierta');
      if (s.usuario_id !== ctx.usuarioId && !tiene(ctx, 'caja.aprobar')) throw prohibido('Solo quien abrió la caja o un supervisor puede cerrarla');

      const esp = await esperado(tx, s.id);
      const clave = (m: string, me: string) => `${m}|${me}`;
      const contado = new Map(d.contado.map((c) => [clave(c.moneda, c.medio), c.monto]));
      const claves = new Set([...esp.map((e) => clave(e.moneda, e.medio)), ...contado.keys()]);
      for (const k of claves) {
        const [moneda, medio] = k.split('|') as [Moneda, Medio];
        const e = esp.find((x) => x.moneda === moneda && x.medio === medio)?.monto ?? '0';
        // Lo no contado se toma como 0: la diferencia queda a la vista.
        const c = contado.get(k) ?? 0;
        await tx.insertInto('arqueo').values({ empresa_id: ctx.empresaId, sesion_id: s.id, moneda, medio, esperado: e, contado: c.toFixed(2) }).execute();
      }
      await tx.updateTable('sesion_caja').set({ estado: 'cerrada', cerrada_en: new Date(), cerrada_por: ctx.usuarioId }).where('id', '=', s.id).execute();
      const resumen = await resumenSesion(tx, s.id);
      await auditar(tx, { ...ctx, ...o }, { accion: 'cerrar_caja', entidad: 'caja', entidadId: id, despues: { sesionId: s.id, arqueo: resumen.arqueo } });
      return resumen;
    });
  }

  @Requiere('arqueo', 'ver')
  @Get(':id/sesiones')
  historial(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      await obtenerCaja(tx, ctx, id);
      const sesiones = await tx.selectFrom('sesion_caja').select('id').where('caja_id', '=', id).orderBy('abierta_en', 'desc').limit(30).execute();
      return Promise.all(sesiones.map((s) => resumenSesion(tx, s.id)));
    });
  }
}

@Controller('cotizaciones')
export class CotizacionesController {
  constructor(private readonly db: Db) {}

  @Requiere('caja', 'ver')
  @Get()
  vigentes(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const { sucursalId } = validar(z.object({ sucursalId: z.string().uuid() }), query);
    exigirSucursal(ctx, sucursalId, 'Sucursal');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const vigentes = await cotizacionesVigentes(tx, sucursalId);
      const historial = await tx
        .selectFrom('cotizacion as c')
        .leftJoin('usuario as u', 'u.id', 'c.creado_por')
        .select(['c.moneda', 'c.compra', 'c.venta', 'c.creado_en', 'u.nombre as usuario'])
        .where('c.sucursal_id', '=', sucursalId)
        .orderBy('c.creado_en', 'desc')
        .limit(20)
        .execute();
      return { vigentes, historial };
    });
  }

  @Requiere('caja', 'editar')
  @Post()
  cargar(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(cotizacionEntrada, body);
    exigirSucursal(ctx, d.sucursalId, 'Sucursal');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      await tx.insertInto('cotizacion').values({ empresa_id: ctx.empresaId, sucursal_id: d.sucursalId, moneda: d.moneda, compra: d.compra, venta: d.venta, creado_por: ctx.usuarioId }).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'cotizacion', entidad: 'sucursal', entidadId: d.sucursalId, despues: d });
      return { vigentes: await cotizacionesVigentes(tx, d.sucursalId) };
    });
  }
}
