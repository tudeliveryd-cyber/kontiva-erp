import { validarRuc } from '@kontiva/shared';
import Decimal from 'decimal.js';
import xmlgen from 'facturacionelectronicapy-xmlgen';
import { randomInt } from 'node:crypto';
import { sql } from 'kysely';
import { descifrar } from '../auth/segundo-factor';
import type { Ctx } from '../comun/contexto';
import { invalido } from '../comun/errores';
import type { Tx } from '../db/database';
import { leerP12, type Certificado } from './certificado';
import { firmarDE, valor } from './firma';
import { agregarQr, urlQr } from './qr';

/** Configuración fiscal activa con el certificado y el CSC ya descifrados. */
export interface FeActiva {
  empresaId: string;
  ambiente: 'test' | 'produccion';
  tipoContribuyente: number;
  tipoRegimen: number | null;
  actividad: { codigo: string; descripcion: string };
  timbrado: { numero: string; fecha: string };
  cscId: string;
  csc: string;
  cert: Certificado;
}

// Certificados abiertos en memoria por empresa (abrir un .p12 cuesta ~50 ms).
const cache = new Map<string, { clave: string; fe: FeActiva }>();

/** Configuración de facturación electrónica de la empresa actual, o null si no está activa. */
export async function cargarFe(tx: Tx, aunInactiva = false): Promise<FeActiva | null> {
  const c = await tx.selectFrom('fe_configuracion').selectAll().executeTakeFirst();
  if (!c || (!c.activa && !aunInactiva)) return null;
  if (!c.certificado_cifrado || !c.certificado_clave || !c.csc_cifrado || !c.csc_id || !c.timbrado_numero || !c.timbrado_fecha || !c.actividad_codigo) return null;
  const marca = `${c.actualizado_en.toISOString()}`;
  const previa = cache.get(c.empresa_id);
  if (previa && previa.clave === marca) return previa.fe;
  const fe: FeActiva = {
    empresaId: c.empresa_id,
    ambiente: c.ambiente,
    tipoContribuyente: c.tipo_contribuyente,
    tipoRegimen: c.tipo_regimen,
    actividad: { codigo: c.actividad_codigo, descripcion: c.actividad_descripcion ?? '' },
    timbrado: { numero: c.timbrado_numero, fecha: c.timbrado_fecha },
    cscId: c.csc_id,
    csc: descifrar(c.csc_cifrado),
    cert: leerP12(descifrar(c.certificado_cifrado), descifrar(c.certificado_clave)),
  };
  cache.set(c.empresa_id, { clave: marca, fe });
  return fe;
}

export const NOMBRE_PRUEBA = 'DE generado en ambiente de prueba - sin valor comercial ni fiscal';

/** Unidad de medida de KONTIVA → código de la DNIT. */
const UNIDADES: Record<string, number> = { unidad: 77, kg: 83, g: 86, litro: 89, ml: 88, metro: 87, m2: 109, m3: 110, caja: 131, paquete: 133 };

/** Fecha y hora en Paraguay, formato del manual: 2026-11-12T10:11:00. */
export function fechaSifen(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .format(d)
    .replace(' ', 'T');
}

/** Receptor según el documento del cliente: RUC válido = contribuyente; cédula; o innominado. */
export function receptor(cliente: { nombre: string; documento: string | null; telefono: string | null; email: string | null; direccion: string | null } | null) {
  const base = { pais: 'PRY', paisDescripcion: 'Paraguay' };
  const doc = cliente?.documento?.trim() ?? '';
  if (cliente && doc.includes('-') && !validarRuc(doc)) throw invalido(`El RUC del cliente ${cliente.nombre} (${doc}) no es válido: corríjalo en Clientes`);
  if (cliente && doc && validarRuc(doc)) {
    const numero = Number(doc.split('-')[0]);
    return {
      ...base,
      contribuyente: true,
      ruc: doc,
      razonSocial: cliente.nombre,
      tipoOperacion: 1,
      // RUC de 80.000.000 en adelante: persona jurídica.
      tipoContribuyente: numero >= 80000000 ? 2 : 1,
      ...(cliente.email && { email: cliente.email }),
      ...(cliente.telefono && cliente.telefono.replace(/\D/g, '').length >= 6 && { telefono: cliente.telefono }),
    };
  }
  if (cliente && /^[0-9]{3,15}$/.test(doc)) {
    return { ...base, contribuyente: false, razonSocial: cliente.nombre, tipoOperacion: 2, documentoTipo: 1, documentoNumero: doc };
  }
  return { ...base, contribuyente: false, razonSocial: 'Sin Nombre', tipoOperacion: 2, documentoTipo: 5, documentoNumero: '0' };
}

const MEDIOS: Record<string, number> = { efectivo: 1, tarjeta: 3, transferencia: 5, otro: 99 };

/**
 * Emite la factura electrónica de una venta dentro de su misma transacción:
 * reserva el número, genera el XML del manual v150, lo firma, agrega el QR y lo deja en cola.
 * El envío a SIFEN lo hace el emisor en segundo plano.
 */
export async function emitirFactura(tx: Tx, ctx: Ctx, fe: FeActiva, ventaId: string): Promise<string> {
  const v = await tx
    .selectFrom('venta as v')
    .innerJoin('caja as c', 'c.id', 'v.caja_id')
    .innerJoin('sucursal as s', 's.id', 'v.sucursal_id')
    .leftJoin('cliente as cl', 'cl.id', 'v.cliente_id')
    .select([
      'v.id',
      'v.total',
      'v.vuelto',
      'v.creado_en',
      'v.sucursal_id',
      'c.punto_expedicion',
      's.codigo as est',
      's.nombre as sucursal',
      's.direccion',
      's.telefono',
      's.fe_numero_casa',
      's.fe_departamento',
      's.fe_distrito',
      's.fe_ciudad',
      's.fe_email',
      'cl.nombre as cl_nombre',
      'cl.documento as cl_documento',
      'cl.telefono as cl_telefono',
      'cl.email as cl_email',
      'cl.direccion as cl_direccion',
    ])
    .where('v.id', '=', ventaId)
    .executeTakeFirstOrThrow();
  if (!v.punto_expedicion) throw invalido('La caja no tiene punto de expedición');
  if (!v.fe_departamento || !v.fe_distrito || !v.fe_ciudad || !v.direccion) throw invalido(`Complete la dirección fiscal de la sucursal ${v.sucursal} en Facturación electrónica`);
  const empresa = await tx.selectFrom('empresa').select(['razon_social', 'nombre_fantasia', 'ruc', 'telefono', 'email']).executeTakeFirstOrThrow();
  if (!empresa.ruc || !validarRuc(empresa.ruc)) throw invalido('La empresa no tiene un RUC válido');

  const [items, pagos] = await Promise.all([
    tx
      .selectFrom('venta_item as i')
      .innerJoin('variante as va', 'va.id', 'i.variante_id')
      .innerJoin('producto as p', 'p.id', 'va.producto_id')
      .select(['i.linea', 'i.descripcion', 'i.cantidad', 'i.precio_unitario', 'i.descuento', 'i.tasa_iva', 'va.sku', 'va.id as variante_id', 'p.unidad', 'p.tipo'])
      .where('i.venta_id', '=', ventaId)
      .orderBy('i.linea')
      .execute(),
    tx.selectFrom('venta_pago').select(['medio', 'monto_pyg']).where('venta_id', '=', ventaId).orderBy('linea').execute(),
  ]);

  // Número correlativo por establecimiento + punto + tipo + timbrado.
  const { rows } = await sql<{ ultimo: number }>`
    INSERT INTO fe_numeracion (empresa_id, establecimiento, punto, tipo_documento, timbrado, ultimo)
    VALUES (${ctx.empresaId}::uuid, ${v.est}, ${v.punto_expedicion}, 1, ${fe.timbrado.numero}, 1)
    ON CONFLICT (empresa_id, establecimiento, punto, tipo_documento, timbrado) DO UPDATE SET ultimo = fe_numeracion.ultimo + 1
    RETURNING ultimo`.execute(tx);
  const numero = rows[0]!.ultimo;

  const geo = xmlgen as unknown as { getDepartamento(n: number): { descripcion: string } | undefined; getDistrito(n: number): { descripcion: string } | undefined; getCiudad(n: number): { descripcion: string } | undefined };
  const params = {
    version: 150,
    ruc: empresa.ruc,
    razonSocial: fe.ambiente === 'test' ? NOMBRE_PRUEBA : empresa.razon_social,
    ...(empresa.nombre_fantasia && { nombreFantasia: empresa.nombre_fantasia }),
    actividadesEconomicas: [fe.actividad],
    timbradoNumero: fe.timbrado.numero,
    timbradoFecha: fe.timbrado.fecha,
    tipoContribuyente: fe.tipoContribuyente,
    ...(fe.tipoRegimen && { tipoRegimen: fe.tipoRegimen }),
    establecimientos: [
      {
        codigo: v.est,
        direccion: v.direccion,
        numeroCasa: v.fe_numero_casa || '0',
        departamento: v.fe_departamento,
        departamentoDescripcion: geo.getDepartamento(v.fe_departamento)?.descripcion,
        distrito: v.fe_distrito,
        distritoDescripcion: geo.getDistrito(v.fe_distrito)?.descripcion,
        ciudad: v.fe_ciudad,
        ciudadDescripcion: geo.getCiudad(v.fe_ciudad)?.descripcion,
        telefono: v.telefono || empresa.telefono || '000000',
        email: v.fe_email || empresa.email || undefined,
        denominacion: v.sucursal,
      },
    ],
  };

  // Pagos en guaraníes; el vuelto sale del efectivo para que lo informado sume el total.
  let vuelto = new Decimal(v.vuelto ?? 0);
  const entregas = pagos.map((p) => {
    let monto = new Decimal(p.monto_pyg);
    if (p.medio === 'efectivo' && vuelto.gt(0)) {
      const resta = Decimal.min(vuelto, monto);
      monto = monto.minus(resta);
      vuelto = vuelto.minus(resta);
    }
    const tipo = MEDIOS[p.medio] ?? 99;
    return {
      tipo,
      monto: monto.toFixed(0),
      moneda: 'PYG',
      ...(tipo === 3 && { infoTarjeta: { tipo: 99, tipoDescripcion: 'Tarjeta', medioPago: 1 } }),
      ...(tipo === 99 && { tipoDescripcion: 'Otro' }),
    };
  }).filter((e) => Number(e.monto) > 0);

  const servicios = items.filter((i) => i.tipo === 'servicio').length;
  const data = {
    tipoDocumento: 1,
    establecimiento: v.est,
    punto: v.punto_expedicion,
    numero: String(numero).padStart(7, '0'),
    codigoSeguridadAleatorio: String(randomInt(1, 999999999)).padStart(9, '0'),
    fecha: fechaSifen(v.creado_en),
    tipoEmision: 1,
    tipoTransaccion: servicios === 0 ? 1 : servicios === items.length ? 2 : 3,
    tipoImpuesto: 1,
    moneda: 'PYG',
    cliente: receptor(v.cl_nombre ? { nombre: v.cl_nombre, documento: v.cl_documento, telefono: v.cl_telefono, email: v.cl_email, direccion: v.cl_direccion } : null),
    factura: { presencia: 1 },
    condicion: { tipo: 1, entregas: entregas.length ? entregas : [{ tipo: 1, monto: new Decimal(v.total).toFixed(0), moneda: 'PYG' }] },
    items: items.map((i) => {
      const tasa = Number(i.tasa_iva);
      const cantidad = Number(i.cantidad);
      return {
        codigo: i.sku || i.variante_id.slice(-12),
        descripcion: i.descripcion,
        unidadMedida: UNIDADES[i.unidad] ?? 77,
        cantidad,
        precioUnitario: Number(i.precio_unitario),
        // El manual informa el descuento por unidad.
        descuento: Number(i.descuento) > 0 ? Number(new Decimal(i.descuento).div(i.cantidad).toDecimalPlaces(8)) : 0,
        ivaTipo: tasa === 0 ? 3 : 1,
        ivaProporcion: tasa === 0 ? 0 : 100,
        iva: tasa,
      };
    }),
  };

  let xml: string;
  try {
    xml = await (xmlgen as unknown as { generateXMLDE(p: object, d: object, c: object): Promise<string> }).generateXMLDE(params, data, {});
  } catch (e) {
    throw invalido(`No se pudo generar la factura electrónica: ${(e as Error).message}`);
  }
  const firmado = firmarDE(xml, fe.cert);
  const qr = urlQr(firmado, fe.ambiente, fe.cscId, fe.csc);
  const final = agregarQr(firmado, qr);
  const cdc = /<DE\s[^>]*Id="([0-9]{44})"/.exec(final)![1]!;
  const totalXml = new Decimal(valor(final, 'dTotGralOpe') ?? '0');
  if (!totalXml.eq(new Decimal(v.total))) throw invalido(`El total de la factura (${totalXml.toFixed(0)}) no coincide con el de la venta (${new Decimal(v.total).toFixed(0)})`);

  const r = await tx
    .insertInto('documento_electronico')
    .values({
      empresa_id: ctx.empresaId,
      tipo_documento: 1,
      cdc,
      ambiente: fe.ambiente,
      timbrado: fe.timbrado.numero,
      establecimiento: v.est,
      punto: v.punto_expedicion,
      numero,
      fecha_emision: v.creado_en,
      sucursal_id: v.sucursal_id,
      venta_id: ventaId,
      receptor_nombre: data.cliente.razonSocial,
      receptor_documento: 'ruc' in data.cliente ? data.cliente.ruc : data.cliente.documentoTipo === 5 ? null : data.cliente.documentoNumero,
      total: totalXml.toFixed(2),
      total_iva: new Decimal(valor(final, 'dTotIVA') ?? '0').toFixed(2),
      xml_firmado: final,
      qr_url: qr,
      creado_por: ctx.usuarioId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await tx.updateTable('venta').set({ comprobante: 'factura' }).where('id', '=', ventaId).execute();
  return r.id;
}

/** Número de comprobante para mostrar: 001-001-0000001. */
export const numeroComprobante = (d: { establecimiento: string; punto: string; numero: number }) => `${d.establecimiento}-${d.punto}-${String(d.numero).padStart(7, '0')}`;
