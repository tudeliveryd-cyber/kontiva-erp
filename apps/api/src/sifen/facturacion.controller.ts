import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { feCertificadoEntrada, feConfiguracionEntrada, feEstablecimientoEntrada, fePuntoEntrada, validarRuc } from '@kontiva/shared';
import xmlgen from 'facturacionelectronicapy-xmlgen';
import { z } from 'zod';
import { cifrar } from '../auth/segundo-factor';
import { exigirSucursal } from '../comun/alcance';
import { auditar } from '../comun/auditoria';
import { Contexto, OrigenPeticion, type Ctx, type Origen } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { conflicto, invalido, noEncontrado } from '../comun/errores';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';
import { ErrorCertificado, leerP12 } from './certificado';
import { cargarFe, numeroComprobante } from './emision';
import { EmisorSifen } from './emisor.service';

interface Geo {
  consultarDepartamentos(): Promise<{ codigo: number; descripcion: string }[]>;
  consultarDistritos(d: number | null): Promise<{ codigo: number; descripcion: string; departamento: number }[]>;
  consultarCiudades(d: number | null): Promise<{ codigo: number; descripcion: string; distrito: number }[]>;
  getDistrito(n: number): { departamento: number } | undefined;
  getCiudad(n: number): { distrito: number } | undefined;
}
const geo = xmlgen as unknown as Geo;

/** Estado de la configuración: qué falta para poder activar. */
async function estado(tx: Tx, ctx: Ctx) {
  const [c, empresa, sucursales, cajas] = await Promise.all([
    tx.selectFrom('fe_configuracion').selectAll().executeTakeFirst(),
    tx.selectFrom('empresa').select(['razon_social', 'ruc', 'email', 'telefono']).executeTakeFirstOrThrow(),
    tx.selectFrom('sucursal').selectAll().where('activa', '=', true).orderBy('codigo').execute(),
    tx.selectFrom('caja as c').innerJoin('sucursal as s', 's.id', 'c.sucursal_id').select(['c.id', 'c.nombre', 'c.punto_expedicion', 'c.sucursal_id', 's.nombre as sucursal']).where('c.activa', '=', true).orderBy('s.codigo').orderBy('c.nombre').execute(),
  ]);
  const visibles = sucursales.filter((s) => ctx.esPropietario || ctx.alcance === 'empresa' || ctx.sucursalIds.includes(s.id));
  const establecimientos = visibles.map((s) => ({
    id: s.id,
    codigo: s.codigo,
    nombre: s.nombre,
    direccion: s.direccion,
    numeroCasa: s.fe_numero_casa,
    departamento: s.fe_departamento,
    distrito: s.fe_distrito,
    ciudad: s.fe_ciudad,
    telefono: s.telefono,
    email: s.fe_email,
    completo: !!(s.direccion && s.fe_departamento && s.fe_distrito && s.fe_ciudad && s.telefono),
  }));
  const pendientes: string[] = [];
  if (!empresa.ruc || !validarRuc(empresa.ruc)) pendientes.push('Cargar el RUC de la empresa (Empresa)');
  if (!c?.timbrado_numero || !c.timbrado_fecha) pendientes.push('Timbrado y fecha de inicio de vigencia');
  if (!c?.actividad_codigo) pendientes.push('Actividad económica principal');
  if (!c?.csc_cifrado || !c.csc_id) pendientes.push('Código de seguridad del contribuyente (CSC)');
  if (!c?.certificado_cifrado) pendientes.push('Certificado digital (.p12)');
  else if (c.certificado_vence && c.certificado_vence < new Date()) pendientes.push('El certificado digital está vencido');
  if (!establecimientos.some((e) => e.completo)) pendientes.push('Dirección fiscal de al menos una sucursal');
  if (!cajas.some((k) => k.punto_expedicion)) pendientes.push('Punto de expedición de al menos una caja');
  return {
    activa: c?.activa ?? false,
    ambiente: c?.ambiente ?? 'test',
    tipoContribuyente: c?.tipo_contribuyente ?? 2,
    tipoRegimen: c?.tipo_regimen ?? null,
    actividadCodigo: c?.actividad_codigo ?? '',
    actividadDescripcion: c?.actividad_descripcion ?? '',
    timbradoNumero: c?.timbrado_numero ?? '',
    timbradoFecha: c?.timbrado_fecha ?? '',
    cscId: c?.csc_id ?? '',
    cscCargado: !!c?.csc_cifrado,
    certificado: c?.certificado_cifrado ? { titular: c.certificado_titular, ruc: c.certificado_ruc, vence: c.certificado_vence } : null,
    empresa: { razonSocial: empresa.razon_social, ruc: empresa.ruc },
    establecimientos,
    puntos: cajas
      .filter((k) => visibles.some((s) => s.id === k.sucursal_id))
      .map((k) => ({ id: k.id, nombre: k.nombre, sucursalId: k.sucursal_id, sucursal: k.sucursal, punto: k.punto_expedicion })),
    pendientes,
  };
}

const ESTADOS_DOC = ['pendiente', 'enviado', 'aprobado', 'aprobado_obs', 'rechazado', 'cancelado'] as const;

@Controller('facturacion')
export class FacturacionController {
  constructor(
    private readonly db: Db,
    private readonly emisor: EmisorSifen,
  ) {}

  @Requiere('config_fiscal', 'ver')
  @Get('configuracion')
  configuracion(@Contexto() ctx: Ctx) {
    return this.db.enEmpresa(ctx.empresaId, (tx) => estado(tx, ctx));
  }

  @Requiere('config_fiscal', 'editar')
  @Put('configuracion')
  guardar(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(feConfiguracionEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const previa = await tx.selectFrom('fe_configuracion').selectAll().executeTakeFirst();
      if (!d.csc && !previa?.csc_cifrado) throw invalido('Ingrese el CSC');
      if (d.csc && !/^[0-9A-Za-z]{16,64}$/.test(d.csc)) throw invalido('El CSC son 32 letras y números');
      if (previa?.activa && previa.ambiente !== d.ambiente) throw conflicto('FE_ACTIVA', 'Desactive la facturación electrónica antes de cambiar de ambiente');
      const valores = {
        ambiente: d.ambiente,
        tipo_contribuyente: d.tipoContribuyente,
        tipo_regimen: d.tipoRegimen ?? null,
        actividad_codigo: d.actividadCodigo,
        actividad_descripcion: d.actividadDescripcion,
        timbrado_numero: d.timbradoNumero,
        timbrado_fecha: d.timbradoFecha,
        csc_id: d.cscId.padStart(4, '0'),
        ...(d.csc && { csc_cifrado: cifrar(d.csc) }),
        actualizado_por: ctx.usuarioId,
        actualizado_en: new Date(),
      };
      await tx.insertInto('fe_configuracion').values({ empresa_id: ctx.empresaId, ...valores }).onConflict((oc) => oc.column('empresa_id').doUpdateSet(valores)).execute();
      await auditar(tx, { ...ctx, ...o }, {
        accion: 'editar',
        entidad: 'config_fiscal',
        entidadId: ctx.empresaId,
        despues: { ambiente: d.ambiente, timbrado: d.timbradoNumero, actividad: d.actividadCodigo, cscId: valores.csc_id, cscCambiado: !!d.csc },
      });
      return estado(tx, ctx);
    });
  }

  @Requiere('config_fiscal', 'editar')
  @Post('certificado')
  @HttpCode(200)
  certificado(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(feCertificadoEntrada, body);
    let cert: ReturnType<typeof leerP12>;
    try {
      cert = leerP12(d.archivo.replace(/^data:[^,]*,/, ''), d.clave);
    } catch (e) {
      throw invalido(e instanceof ErrorCertificado ? e.message : 'Certificado inválido');
    }
    if (cert.vence < new Date()) throw invalido(`El certificado venció el ${cert.vence.toLocaleDateString('es-PY')}`);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const empresa = await tx.selectFrom('empresa').select('ruc').executeTakeFirstOrThrow();
      if (cert.ruc && empresa.ruc && cert.ruc.split('-')[0] !== empresa.ruc.split('-')[0]) {
        throw invalido(`El certificado es del RUC ${cert.ruc} y la empresa tiene el RUC ${empresa.ruc}`);
      }
      const valores = {
        certificado_cifrado: cifrar(d.archivo.replace(/^data:[^,]*,/, '')),
        certificado_clave: cifrar(d.clave),
        certificado_titular: cert.titular,
        certificado_ruc: cert.ruc,
        certificado_vence: cert.vence,
        actualizado_por: ctx.usuarioId,
        actualizado_en: new Date(),
      };
      await tx.insertInto('fe_configuracion').values({ empresa_id: ctx.empresaId, ...valores }).onConflict((oc) => oc.column('empresa_id').doUpdateSet(valores)).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'certificado', entidad: 'config_fiscal', entidadId: ctx.empresaId, despues: { titular: cert.titular, ruc: cert.ruc, vence: cert.vence } });
      return estado(tx, ctx);
    });
  }

  @Requiere('config_fiscal', 'editar')
  @Post('activar')
  @HttpCode(200)
  activar(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(z.object({ activa: z.boolean() }), body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const e = await estado(tx, ctx);
      if (d.activa && e.pendientes.length) throw invalido(`Falta completar: ${e.pendientes.join('; ')}`);
      await tx.updateTable('fe_configuracion').set({ activa: d.activa, actualizado_por: ctx.usuarioId, actualizado_en: new Date() }).execute();
      if (d.activa && !(await cargarFe(tx))) throw invalido('No se pudo abrir el certificado con la configuración guardada');
      await auditar(tx, { ...ctx, ...o }, { accion: d.activa ? 'activar' : 'desactivar', entidad: 'config_fiscal', entidadId: ctx.empresaId, despues: { ambiente: e.ambiente } });
      return estado(tx, ctx);
    });
  }

  @Requiere('config_fiscal', 'editar')
  @Put('establecimientos/:id')
  establecimiento(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(feEstablecimientoEntrada, body);
    if (geo.getDistrito(d.distrito)?.departamento !== d.departamento) throw invalido('El distrito no corresponde al departamento');
    if (geo.getCiudad(d.ciudad)?.distrito !== d.distrito) throw invalido('La ciudad no corresponde al distrito');
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const s = await tx.selectFrom('sucursal').select('id').where('id', '=', id).executeTakeFirst();
      if (!s) throw noEncontrado('Sucursal');
      exigirSucursal(ctx, id, 'Sucursal');
      await tx
        .updateTable('sucursal')
        .set({ direccion: d.direccion, fe_numero_casa: d.numeroCasa, fe_departamento: d.departamento, fe_distrito: d.distrito, fe_ciudad: d.ciudad, telefono: d.telefono, fe_email: d.email ?? null })
        .where('id', '=', id)
        .execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'editar_fiscal', entidad: 'sucursal', entidadId: id, despues: d });
      return estado(tx, ctx);
    });
  }

  @Requiere('config_fiscal', 'editar')
  @Put('puntos/:id')
  punto(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(fePuntoEntrada, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const c = await tx.selectFrom('caja').select(['id', 'sucursal_id', 'punto_expedicion']).where('id', '=', id).executeTakeFirst();
      if (!c) throw noEncontrado('Caja');
      exigirSucursal(ctx, c.sucursal_id, 'Caja');
      if (d.punto) {
        const otra = await tx.selectFrom('caja').select('nombre').where('sucursal_id', '=', c.sucursal_id).where('punto_expedicion', '=', d.punto).where('id', '<>', id).executeTakeFirst();
        if (otra) throw conflicto('PUNTO_REPETIDO', `El punto ${d.punto} ya es de la caja ${otra.nombre}`);
      }
      await tx.updateTable('caja').set({ punto_expedicion: d.punto }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'editar_fiscal', entidad: 'caja', entidadId: id, antes: { punto: c.punto_expedicion }, despues: { punto: d.punto } });
      return estado(tx, ctx);
    });
  }

  /** Departamentos, distritos y ciudades según la codificación de la DNIT. */
  @Requiere('config_fiscal', 'ver')
  @Get('geografia')
  async geografia(@Query() query: unknown) {
    const f = validar(z.object({ departamento: z.coerce.number().int().optional(), distrito: z.coerce.number().int().optional() }), query);
    if (f.distrito) return (await geo.consultarCiudades(f.distrito)).map((c) => ({ codigo: c.codigo, nombre: c.descripcion })).sort((a, b) => a.nombre.localeCompare(b.nombre));
    if (f.departamento) return (await geo.consultarDistritos(f.departamento)).map((c) => ({ codigo: c.codigo, nombre: c.descripcion })).sort((a, b) => a.nombre.localeCompare(b.nombre));
    return (await geo.consultarDepartamentos()).map((c) => ({ codigo: c.codigo, nombre: c.descripcion })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  @Requiere('documento_fiscal', 'ver')
  @Get('documentos')
  documentos(@Contexto() ctx: Ctx, @Query() query: unknown) {
    const f = validar(z.object({ estado: z.enum(ESTADOS_DOC).optional(), q: z.string().trim().max(60).optional(), limite: z.coerce.number().int().min(1).max(500).default(200) }), query);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      let q = tx
        .selectFrom('documento_electronico as d')
        .leftJoin('venta as v', 'v.id', 'd.venta_id')
        .select(['d.id', 'd.tipo_documento', 'd.cdc', 'd.establecimiento', 'd.punto', 'd.numero', 'd.fecha_emision', 'd.receptor_nombre', 'd.receptor_documento', 'd.total', 'd.estado', 'd.respuesta_mensaje', 'd.ambiente', 'd.venta_id', 'v.numero as venta_numero'])
        .orderBy('d.creado_en', 'desc')
        .limit(f.limite);
      if (!(ctx.esPropietario || ctx.alcance === 'empresa')) q = q.where('d.sucursal_id', 'in', ctx.sucursalIds.length ? ctx.sucursalIds : ['00000000-0000-0000-0000-000000000000']);
      if (f.estado) q = q.where('d.estado', '=', f.estado);
      if (f.q) q = q.where((eb) => eb.or([eb('d.cdc', 'like', `${f.q}%`), eb('d.receptor_nombre', 'ilike', `%${f.q}%`), eb('d.receptor_documento', 'like', `${f.q}%`)]));
      const filas = await q.execute();
      return filas.map((d) => ({
        id: d.id,
        tipoDocumento: d.tipo_documento,
        cdc: d.cdc,
        numero: numeroComprobante(d),
        fecha: d.fecha_emision,
        receptor: d.receptor_nombre,
        receptorDocumento: d.receptor_documento,
        total: d.total,
        estado: d.estado,
        mensaje: d.respuesta_mensaje,
        ambiente: d.ambiente,
        venta: d.venta_id ? { id: d.venta_id, numero: Number(d.venta_numero) } : null,
      }));
    });
  }

  @Requiere('documento_fiscal', 'ver')
  @Get('documentos/:id')
  documento(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const d = await tx.selectFrom('documento_electronico').selectAll().where('id', '=', id).executeTakeFirst();
      if (!d) throw noEncontrado('Documento electrónico');
      exigirSucursal(ctx, d.sucursal_id, 'Documento electrónico');
      return {
        id: d.id,
        tipoDocumento: d.tipo_documento,
        cdc: d.cdc,
        numero: numeroComprobante(d),
        timbrado: d.timbrado,
        fecha: d.fecha_emision,
        receptor: d.receptor_nombre,
        receptorDocumento: d.receptor_documento,
        total: d.total,
        totalIva: d.total_iva,
        estado: d.estado,
        ambiente: d.ambiente,
        qr: d.qr_url,
        lote: d.lote_protocolo,
        intentos: d.intentos,
        enviadoEn: d.enviado_en,
        procesadoEn: d.procesado_en,
        respuesta: d.respuesta_codigo ? { codigo: d.respuesta_codigo, mensaje: d.respuesta_mensaje } : d.respuesta_mensaje ? { codigo: null, mensaje: d.respuesta_mensaje } : null,
        protocoloAutorizacion: d.protocolo_autorizacion,
        cancelacion: d.cancelado_en ? { en: d.cancelado_en, motivo: d.motivo_cancelacion } : null,
        ventaId: d.venta_id,
        xml: d.xml_firmado,
      };
    });
  }

  /** Vuelve a poner en cola un documento pendiente o rechazado (mismo XML, mismo CDC). */
  @Requiere('documento_fiscal', 'crear')
  @Post('documentos/:id/reenviar')
  @HttpCode(200)
  reenviar(@Contexto() ctx: Ctx, @Param('id', ParseUUIDPipe) id: string, @OrigenPeticion() o: Origen) {
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const d = await tx.selectFrom('documento_electronico').select(['id', 'estado', 'sucursal_id']).where('id', '=', id).executeTakeFirst();
      if (!d) throw noEncontrado('Documento electrónico');
      exigirSucursal(ctx, d.sucursal_id, 'Documento electrónico');
      if (d.estado !== 'pendiente' && d.estado !== 'rechazado') throw conflicto('NO_REENVIABLE', 'Solo se reenvían documentos pendientes o rechazados');
      await tx.updateTable('documento_electronico').set({ estado: 'pendiente', lote_protocolo: null, proximo_intento: new Date() }).where('id', '=', id).execute();
      await auditar(tx, { ...ctx, ...o }, { accion: 'reenviar', entidad: 'documento_electronico', entidadId: id });
      return { ok: true };
    });
  }

  /** Procesa ya la cola de la empresa (enviar pendientes y consultar lotes), sin esperar al ciclo. */
  @Requiere('documento_fiscal', 'crear')
  @Post('procesar')
  @HttpCode(200)
  procesar(@Contexto() ctx: Ctx) {
    return this.emisor.procesarEmpresa(ctx.empresaId);
  }
}
