import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { email, ruc } from '@kontiva/shared';
import { sql } from 'kysely';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { auditar } from '../comun/auditoria';
import { Correo } from '../comun/correo';
import { conflicto, invalido, noEncontrado } from '../comun/errores';
import { validar } from '../comun/validar';
import { config } from '../config';
import { Db } from '../db/database';
import { ProvisionService } from '../provision/provision.service';
import { auditarMaster } from './master-auditoria';
import { ContextoMaster, type CtxMaster } from './master-auth';
import { estadoSuscripcion, hoyAsuncion, Suscripciones } from './suscripciones';

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD');
const monto = z.coerce.number().nonnegative().max(1e15).transform((n) => n.toFixed(2));
const moneda = z.enum(['PYG', 'USD', 'BRL']);

const RUBROS = ['general', 'supermercado', 'panaderia', 'restaurante', 'ropa', 'farmacia', 'ferreteria', 'distribuidora'] as const;

const esquemaSuscripcion = z.object({
  ciclo: z.enum(['mensual', 'anual']),
  precio: monto,
  moneda,
  venceEn: fecha,
  diasGracia: z.coerce.number().int().min(0).max(90).default(7),
  suspensionAutomatica: z.boolean().default(true),
  notas: z.string().trim().max(500).nullable().optional(),
});

const esquemaAlta = z.object({
  razonSocial: z.string().trim().min(2).max(200),
  nombreFantasia: z.string().trim().max(200).nullable().optional(),
  ruc: ruc.nullable().optional(),
  rubro: z.enum(RUBROS),
  planCodigo: z.string().min(2).max(30),
  propietario: z.object({ email, nombre: z.string().trim().min(2).max(120) }),
  suscripcion: esquemaSuscripcion.nullable().optional(),
});

const esquemaPago = z.object({
  monto: z.coerce.number().positive().max(1e15).transform((n) => n.toFixed(2)),
  moneda,
  fecha,
  metodo: z.enum(['transferencia', 'efectivo', 'tarjeta', 'otro']),
  referencia: z.string().trim().max(120).nullable().optional(),
  /** Hasta qué fecha cubre. Si se omite: un ciclo más desde el vencimiento actual. */
  periodoHasta: fecha.optional(),
});

interface Resumen {
  id: string;
  razon_social: string;
  nombre_fantasia: string | null;
  ruc: string | null;
  rubro: string;
  estado: 'activa' | 'suspendida';
  plan_id: string;
  plan_codigo: string;
  creado_en: Date;
  usuarios_activos: string;
  sucursales_activas: string;
  ultimo_acceso: Date | null;
  propietario_email: string | null;
  propietario_nombre: string | null;
  propietario_pendiente: boolean | null;
}

@Controller('empresas')
export class MasterEmpresasController {
  constructor(
    private readonly db: Db,
    private readonly provision: ProvisionService,
    private readonly suscripciones: Suscripciones,
    private readonly auth: AuthService,
    private readonly correo: Correo,
  ) {}

  private async resumen(): Promise<Resumen[]> {
    return (await sql<Resumen>`SELECT * FROM master.resumen_empresas()`.execute(this.db.k)).rows;
  }

  private async dto(r: Resumen, sus?: { vence_en: string; dias_gracia: number; ciclo: string; precio: string; moneda: string; suspension_automatica: boolean; motivo_suspension: string | null; notas: string | null } | null) {
    return {
      id: r.id,
      nombre: r.nombre_fantasia ?? r.razon_social,
      razonSocial: r.razon_social,
      ruc: r.ruc,
      rubro: r.rubro,
      estado: r.estado,
      plan: r.plan_codigo,
      creadoEn: r.creado_en,
      usuariosActivos: Number(r.usuarios_activos),
      sucursalesActivas: Number(r.sucursales_activas),
      ultimoAcceso: r.ultimo_acceso,
      propietario: r.propietario_email ? { email: r.propietario_email, nombre: r.propietario_nombre, pendiente: Boolean(r.propietario_pendiente) } : null,
      suscripcion: sus
        ? {
            ciclo: sus.ciclo,
            precio: sus.precio,
            moneda: sus.moneda,
            venceEn: sus.vence_en,
            diasGracia: sus.dias_gracia,
            suspensionAutomatica: sus.suspension_automatica,
            motivoSuspension: sus.motivo_suspension,
            notas: sus.notas,
            estado: estadoSuscripcion(sus),
          }
        : null,
    };
  }

  private async una(id: string) {
    const r = (await this.resumen()).find((x) => x.id === id);
    if (!r) throw noEncontrado('Empresa');
    return r;
  }

  @Get()
  async listar(@Query('q') q?: string) {
    const [lista, subs] = await Promise.all([this.resumen(), this.db.k.selectFrom('master.suscripcion').selectAll().execute()]);
    const m = new Map(subs.map((s) => [s.empresa_id, s]));
    const filtro = q?.trim().toLowerCase();
    const filtradas = filtro
      ? lista.filter((r) => [r.razon_social, r.nombre_fantasia, r.ruc, r.propietario_email].some((v) => v?.toLowerCase().includes(filtro)))
      : lista;
    return Promise.all(filtradas.map((r) => this.dto(r, m.get(r.id))));
  }

  @Get('rubros')
  rubros() {
    return RUBROS;
  }

  @Get(':id')
  async ver(@Param('id', ParseUUIDPipe) id: string) {
    const r = await this.una(id);
    const sus = await this.db.k.selectFrom('master.suscripcion').selectAll().where('empresa_id', '=', id).executeTakeFirst();
    const pagos = await this.db.k
      .selectFrom('master.pago as p')
      .innerJoin('master.usuario as u', 'u.id', 'p.registrado_por')
      .select(['p.id', 'p.monto', 'p.moneda', 'p.fecha', 'p.periodo_desde', 'p.periodo_hasta', 'p.metodo', 'p.referencia', 'p.anulado_en', 'p.motivo_anulacion', 'u.nombre as registrado_por'])
      .where('p.empresa_id', '=', id)
      .orderBy('p.fecha', 'desc')
      .orderBy('p.creado_en', 'desc')
      .execute();
    return {
      ...(await this.dto(r, sus)),
      pagos: pagos.map((p) => ({
        id: p.id,
        monto: p.monto,
        moneda: p.moneda,
        fecha: p.fecha,
        periodoDesde: p.periodo_desde,
        periodoHasta: p.periodo_hasta,
        metodo: p.metodo,
        referencia: p.referencia,
        anulado: p.anulado_en !== null,
        motivoAnulacion: p.motivo_anulacion,
        registradoPor: p.registrado_por,
      })),
    };
  }

  /** Alta de empresa: empresa vacía + Propietario invitado por correo (+ suscripción opcional). */
  @Post()
  async crear(@ContextoMaster() ctx: CtxMaster, @Body() body: unknown) {
    const d = validar(esquemaAlta, body);
    const r = await this.provision.crearEmpresa({
      razonSocial: d.razonSocial,
      nombreFantasia: d.nombreFantasia ?? null,
      ruc: d.ruc ?? null,
      rubro: d.rubro,
      planCodigo: d.planCodigo,
      propietario: d.propietario,
    });
    if (d.suscripcion) await this.guardarSuscripcion(r.empresaId, d.suscripcion);
    await auditarMaster(this.db.k, ctx, {
      accion: 'alta_empresa',
      entidad: 'empresa',
      entidadId: r.empresaId,
      despues: { razonSocial: d.razonSocial, plan: d.planCodigo, propietario: d.propietario.email, suscripcion: d.suscripcion ?? null },
    });
    return { empresaId: r.empresaId, enlaceInvitacion: r.enlaceInvitacion };
  }

  @Patch(':id/plan')
  async cambiarPlan(@ContextoMaster() ctx: CtxMaster, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { planCodigo } = validar(z.object({ planCodigo: z.string().min(2).max(30) }), body);
    const antes = await this.una(id);
    const plan = await this.db.k.selectFrom('plan').select(['id', 'codigo']).where('codigo', '=', planCodigo).where('activo', '=', true).executeTakeFirst();
    if (!plan) throw invalido('Plan inexistente o inactivo');
    if (plan.id === antes.plan_id) return this.ver(id);
    await this.db.enEmpresa(id, async (tx) => {
      await tx.updateTable('empresa').set({ plan_id: plan.id }).where('id', '=', id).execute();
      await auditar(tx, { empresaId: id, usuarioId: null, cuentaId: null }, {
        accion: 'cambio_plan',
        entidad: 'empresa',
        entidadId: id,
        antes: { plan: antes.plan_codigo },
        despues: { plan: plan.codigo, por: 'Araújo Tech Sistemas' },
      });
      await auditarMaster(tx, ctx, { accion: 'cambio_plan', entidad: 'empresa', entidadId: id, antes: { plan: antes.plan_codigo }, despues: { plan: plan.codigo } });
    });
    return this.ver(id);
  }

  @Post(':id/suspender')
  @HttpCode(200)
  async suspender(@ContextoMaster() ctx: CtxMaster, @Param('id', ParseUUIDPipe) id: string) {
    const e = await this.una(id);
    if (e.estado === 'suspendida') throw conflicto('YA_SUSPENDIDA', 'La empresa ya está suspendida');
    await this.suscripciones.cambiarEstado(id, 'suspendida', 'manual', ctx);
    return this.ver(id);
  }

  @Post(':id/reactivar')
  @HttpCode(200)
  async reactivar(@ContextoMaster() ctx: CtxMaster, @Param('id', ParseUUIDPipe) id: string) {
    const e = await this.una(id);
    if (e.estado === 'activa') throw conflicto('YA_ACTIVA', 'La empresa ya está activa');
    await this.suscripciones.cambiarEstado(id, 'activa', null, ctx);
    return this.ver(id);
  }

  private async guardarSuscripcion(empresaId: string, s: z.infer<typeof esquemaSuscripcion>) {
    const valores = {
      ciclo: s.ciclo,
      precio: s.precio,
      moneda: s.moneda,
      vence_en: s.venceEn,
      dias_gracia: s.diasGracia,
      suspension_automatica: s.suspensionAutomatica,
      notas: s.notas ?? null,
    };
    await this.db.k
      .insertInto('master.suscripcion')
      .values({ empresa_id: empresaId, motivo_suspension: null, ...valores })
      .onConflict((oc) => oc.column('empresa_id').doUpdateSet(valores))
      .execute();
  }

  @Put(':id/suscripcion')
  async suscripcion(@ContextoMaster() ctx: CtxMaster, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = validar(esquemaSuscripcion, body);
    await this.una(id);
    const antes = await this.db.k.selectFrom('master.suscripcion').selectAll().where('empresa_id', '=', id).executeTakeFirst();
    await this.guardarSuscripcion(id, d);
    await auditarMaster(this.db.k, ctx, { accion: antes ? 'editar_suscripcion' : 'crear_suscripcion', entidad: 'suscripcion', entidadId: id, antes, despues: d });
    await this.suscripciones.procesar();
    return this.ver(id);
  }

  /** Registrar un pago extiende el vencimiento y, si estaba suspendida por falta de pago, la reactiva. */
  @Post(':id/pagos')
  async pago(@ContextoMaster() ctx: CtxMaster, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const d = validar(esquemaPago, body);
    await this.una(id);
    const sus = await this.db.k.selectFrom('master.suscripcion').selectAll().where('empresa_id', '=', id).executeTakeFirst();
    if (!sus) throw conflicto('SIN_SUSCRIPCION', 'Configure primero la suscripción de la empresa');

    // El período empieza al día siguiente del vencimiento actual (o hoy, si venció hace mucho).
    const desde = sus.vence_en >= hoyAsuncion() ? sus.vence_en : hoyAsuncion();
    let hasta = d.periodoHasta;
    if (!hasta) {
      const { rows } = await sql<{ h: string }>`SELECT (${desde}::date + ${sus.ciclo === 'anual' ? sql`interval '1 year'` : sql`interval '1 month'`})::date::text AS h`.execute(this.db.k);
      hasta = rows[0]!.h;
    }
    if (hasta < desde) throw invalido('El período pagado debe terminar después del vencimiento actual');

    await this.db.k.transaction().execute(async (tx) => {
      const p = await tx
        .insertInto('master.pago')
        .values({ empresa_id: id, monto: d.monto, moneda: d.moneda, fecha: d.fecha, periodo_desde: desde, periodo_hasta: hasta!, metodo: d.metodo, referencia: d.referencia ?? null, registrado_por: ctx.usuarioId, anulado_en: null, anulado_por: null, motivo_anulacion: null })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx.updateTable('master.suscripcion').set({ vence_en: hasta! }).where('empresa_id', '=', id).execute();
      await auditarMaster(tx, ctx, { accion: 'registrar_pago', entidad: 'pago', entidadId: p.id, despues: { empresaId: id, ...d, periodoDesde: desde, periodoHasta: hasta, venceAntes: sus.vence_en } });
    });
    await this.suscripciones.procesar();
    return this.ver(id);
  }

  /** Un pago no se borra: se anula. El vencimiento no se recalcula solo (se ajusta en la suscripción). */
  @Post(':id/pagos/:pagoId/anular')
  @HttpCode(200)
  async anularPago(@ContextoMaster() ctx: CtxMaster, @Param('id', ParseUUIDPipe) id: string, @Param('pagoId', ParseUUIDPipe) pagoId: string, @Body() body: unknown) {
    const { motivo } = validar(z.object({ motivo: z.string().trim().min(3).max(300) }), body);
    const r = await this.db.k
      .updateTable('master.pago')
      .set({ anulado_en: new Date(), anulado_por: ctx.usuarioId, motivo_anulacion: motivo })
      .where('id', '=', pagoId)
      .where('empresa_id', '=', id)
      .where('anulado_en', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (!r) throw noEncontrado('Pago');
    await auditarMaster(this.db.k, ctx, { accion: 'anular_pago', entidad: 'pago', entidadId: pagoId, despues: { motivo } });
    return this.ver(id);
  }

  @Post(':id/invitacion')
  @HttpCode(200)
  async reenviarInvitacion(@ContextoMaster() ctx: CtxMaster, @Param('id', ParseUUIDPipe) id: string) {
    const e = await this.una(id);
    if (!e.propietario_email || !e.propietario_pendiente) throw conflicto('YA_ACTIVO', 'El Propietario ya creó su contraseña');
    const cuenta = await this.db.k.selectFrom('cuenta').select(['id', 'nombre']).where('email', '=', e.propietario_email).executeTakeFirstOrThrow();
    const token = await this.auth.emitirTokenCuenta(cuenta.id, 'invitacion');
    const enlace = `${config().WEB_URL}/restablecer?token=${token}&invitacion=1`;
    await this.correo.enviar({
      para: e.propietario_email,
      asunto: 'Bienvenido a KONTIVA ERP',
      texto: `Hola ${cuenta.nombre}:\n\nSu empresa "${e.nombre_fantasia ?? e.razon_social}" está lista en KONTIVA ERP.\n\nCree su contraseña con este enlace (válido 7 días):\n${enlace}\n\nKONTIVA ERP · Desarrollado por Araújo Tech Sistemas`,
    });
    await auditarMaster(this.db.k, ctx, { accion: 'reenviar_invitacion', entidad: 'empresa', entidadId: id });
    return { enlaceInvitacion: enlace };
  }
}

@Controller('planes')
export class MasterPlanesController {
  constructor(private readonly db: Db) {}

  @Get()
  async listar() {
    const planes = await this.db.k.selectFrom('plan').selectAll().orderBy('max_usuarios', 'asc').execute();
    const { rows } = await sql<{ plan_codigo: string; n: string }>`SELECT plan_codigo, count(*) AS n FROM master.resumen_empresas() GROUP BY plan_codigo`.execute(this.db.k);
    const uso = new Map(rows.map((r) => [r.plan_codigo, Number(r.n)]));
    return planes
      .sort((a, b) => (a.max_usuarios ?? Infinity) - (b.max_usuarios ?? Infinity))
      .map((p) => ({
        id: p.id,
        codigo: p.codigo,
        nombre: p.nombre,
        maxUsuarios: p.max_usuarios,
        maxSucursales: p.max_sucursales,
        maxCajas: p.max_cajas,
        precioMensual: p.precio_mensual,
        precioAnual: p.precio_anual,
        exige2faPropietario: p.exige_2fa_propietario,
        activo: p.activo,
        empresas: uso.get(p.codigo) ?? 0,
      }));
  }

  @Patch(':id')
  async editar(@ContextoMaster() ctx: CtxMaster, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const limite = z.coerce.number().int().positive().max(100000).nullable();
    const precio = z.coerce.number().nonnegative().max(1e15).transform((n) => n.toFixed(2)).nullable();
    const d = validar(
      z.object({
        nombre: z.string().trim().min(2).max(60).optional(),
        maxUsuarios: limite.optional(),
        maxSucursales: limite.optional(),
        maxCajas: limite.optional(),
        precioMensual: precio.optional(),
        precioAnual: precio.optional(),
        exige2faPropietario: z.boolean().optional(),
        activo: z.boolean().optional(),
      }),
      body,
    );
    const antes = await this.db.k.selectFrom('plan').selectAll().where('id', '=', id).executeTakeFirst();
    if (!antes) throw noEncontrado('Plan');
    await this.db.k
      .updateTable('plan')
      .set({
        ...(d.nombre !== undefined && { nombre: d.nombre }),
        ...(d.maxUsuarios !== undefined && { max_usuarios: d.maxUsuarios }),
        ...(d.maxSucursales !== undefined && { max_sucursales: d.maxSucursales }),
        ...(d.maxCajas !== undefined && { max_cajas: d.maxCajas }),
        ...(d.precioMensual !== undefined && { precio_mensual: d.precioMensual }),
        ...(d.precioAnual !== undefined && { precio_anual: d.precioAnual }),
        ...(d.exige2faPropietario !== undefined && { exige_2fa_propietario: d.exige2faPropietario }),
        ...(d.activo !== undefined && { activo: d.activo }),
      })
      .where('id', '=', id)
      .execute();
    await auditarMaster(this.db.k, ctx, { accion: 'editar_plan', entidad: 'plan', entidadId: id, antes, despues: d });
    return (await this.listar()).find((p) => p.id === id);
  }
}

@Controller('auditoria')
export class MasterAuditoriaController {
  constructor(private readonly db: Db) {}

  @Get()
  async listar(@Query('cursor') cursor?: string) {
    let q = this.db.k
      .selectFrom('master.auditoria as a')
      .leftJoin('master.usuario as u', 'u.id', 'a.usuario_id')
      .select(['a.id', 'a.creado_en', 'a.accion', 'a.entidad', 'a.entidad_id', 'a.despues', 'a.ip', 'u.nombre'])
      .orderBy('a.id', 'desc')
      .limit(51);
    if (cursor && /^\d+$/.test(cursor)) q = q.where('a.id', '<', cursor);
    const filas = await q.execute();
    const pagina = filas.slice(0, 50);
    return {
      items: pagina.map((a) => ({ id: Number(a.id), fecha: a.creado_en, accion: a.accion, entidad: a.entidad, entidadId: a.entidad_id, despues: a.despues, ip: a.ip, usuario: a.nombre ?? 'Sistema' })),
      siguiente: filas.length > 50 ? Number(pagina[pagina.length - 1]!.id) : null,
    };
  }
}
