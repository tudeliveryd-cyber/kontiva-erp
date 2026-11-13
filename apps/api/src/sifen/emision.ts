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

interface ItemDe {
  codigo: string;
  descripcion: string;
  unidad: string;
  cantidad: Decimal;
  precioUnitario: Decimal;
  /** Descuento total de la línea (el manual lo informa por unidad). */
  descuento: Decimal;
  tasaIva: number;
  servicio: boolean;
}

interface OpcionesDe {
  tipo: 1 | 5;
  sucursalId: string;
  punto: string;
  fecha: Date;
  cliente: Parameters<typeof receptor>[0];
  items: ItemDe[];
  /** Bloques propios del tipo: factura + condición, o nota de crédito + documento asociado. */
  extra: Record<string, unknown>;
  totalEsperado: Decimal;
  ventaId?: string;
  devolucionId?: string;
  asociadoId?: string;
  /** Corrección de un DE rechazado: mismo número y código de seguridad → mismo CDC. */
  reemplazar?: Reemplazo;
}

export interface Reemplazo {
  id: string;
  numero: number;
  codigoSeguridad: string;
  cdc: string;
}

/**
 * Genera, firma y deja en cola un documento electrónico dentro de la transacción en curso:
 * reserva el número (establecimiento + punto + tipo + timbrado), arma el XML del manual v150,
 * lo firma, agrega el QR y controla que el total coincida con la operación.
 */
async function emitirDocumento(tx: Tx, ctx: Ctx, fe: FeActiva, o: OpcionesDe): Promise<string> {
  const s = await tx.selectFrom('sucursal').selectAll().where('id', '=', o.sucursalId).executeTakeFirstOrThrow();
  if (!s.fe_departamento || !s.fe_distrito || !s.fe_ciudad || !s.direccion) throw invalido(`Complete la dirección fiscal de la sucursal ${s.nombre} en Facturación electrónica`);
  const empresa = await tx.selectFrom('empresa').select(['razon_social', 'nombre_fantasia', 'ruc', 'telefono', 'email']).executeTakeFirstOrThrow();
  if (!empresa.ruc || !validarRuc(empresa.ruc)) throw invalido('La empresa no tiene un RUC válido');
  const cliente = receptor(o.cliente);

  let numero: number;
  if (o.reemplazar) numero = o.reemplazar.numero;
  else {
    const { rows } = await sql<{ ultimo: number }>`
      INSERT INTO fe_numeracion (empresa_id, establecimiento, punto, tipo_documento, timbrado, ultimo)
      VALUES (${ctx.empresaId}::uuid, ${s.codigo}, ${o.punto}, ${o.tipo}, ${fe.timbrado.numero}, 1)
      ON CONFLICT (empresa_id, establecimiento, punto, tipo_documento, timbrado) DO UPDATE SET ultimo = fe_numeracion.ultimo + 1
      RETURNING ultimo`.execute(tx);
    numero = rows[0]!.ultimo;
  }

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
        codigo: s.codigo,
        direccion: s.direccion,
        numeroCasa: s.fe_numero_casa || '0',
        departamento: s.fe_departamento,
        departamentoDescripcion: geo.getDepartamento(s.fe_departamento)?.descripcion,
        distrito: s.fe_distrito,
        distritoDescripcion: geo.getDistrito(s.fe_distrito)?.descripcion,
        ciudad: s.fe_ciudad,
        ciudadDescripcion: geo.getCiudad(s.fe_ciudad)?.descripcion,
        telefono: s.telefono || empresa.telefono || '000000',
        email: s.fe_email || empresa.email || undefined,
        denominacion: s.nombre,
      },
    ],
  };
  const servicios = o.items.filter((i) => i.servicio).length;
  const data = {
    tipoDocumento: o.tipo,
    establecimiento: s.codigo,
    punto: o.punto,
    numero: String(numero).padStart(7, '0'),
    codigoSeguridadAleatorio: o.reemplazar?.codigoSeguridad ?? String(randomInt(1, 999999999)).padStart(9, '0'),
    fecha: fechaSifen(o.fecha),
    tipoEmision: 1,
    tipoTransaccion: servicios === 0 ? 1 : servicios === o.items.length ? 2 : 3,
    tipoImpuesto: 1,
    moneda: 'PYG',
    cliente,
    ...o.extra,
    items: o.items.map((i) => ({
      codigo: i.codigo,
      descripcion: i.descripcion,
      unidadMedida: UNIDADES[i.unidad] ?? 77,
      cantidad: Number(i.cantidad),
      precioUnitario: Number(i.precioUnitario),
      descuento: i.descuento.gt(0) ? Number(i.descuento.div(i.cantidad).toDecimalPlaces(8)) : 0,
      ivaTipo: i.tasaIva === 0 ? 3 : 1,
      ivaProporcion: i.tasaIva === 0 ? 0 : 100,
      iva: i.tasaIva,
    })),
  };

  let xml: string;
  try {
    xml = await (xmlgen as unknown as { generateXMLDE(p: object, d: object, c: object): Promise<string> }).generateXMLDE(params, data, {});
  } catch (e) {
    throw invalido(`No se pudo generar el documento electrónico: ${(e as Error).message}`);
  }
  const firmado = firmarDE(xml, fe.cert);
  const qr = urlQr(firmado, fe.ambiente, fe.cscId, fe.csc);
  const final = agregarQr(firmado, qr);
  const cdc = /<DE\s[^>]*Id="([0-9]{44})"/.exec(final)![1]!;
  const totalXml = new Decimal(valor(final, 'dTotGralOpe') ?? '0');
  if (!totalXml.eq(o.totalEsperado)) throw invalido(`El total del documento electrónico (${totalXml.toFixed(0)}) no coincide con el de la operación (${o.totalEsperado.toFixed(0)})`);
  const receptorDocumento = 'ruc' in cliente ? cliente.ruc : cliente.documentoTipo === 5 ? null : cliente.documentoNumero;

  if (o.reemplazar) {
    if (cdc !== o.reemplazar.cdc) throw invalido('Los datos corregidos cambian el CDC (fecha, timbrado o tipo de contribuyente): no se puede reutilizar el número; inutilícelo');
    await tx
      .updateTable('documento_electronico')
      .set({
        estado: 'pendiente',
        xml_firmado: final,
        qr_url: qr,
        receptor_nombre: cliente.razonSocial,
        receptor_documento: receptorDocumento,
        total_iva: new Decimal(valor(final, 'dTotIVA') ?? '0').toFixed(2),
        lote_protocolo: null,
        respuesta_codigo: null,
        respuesta_mensaje: 'Corregido y en cola para reenviar',
        intentos: 0,
        proximo_intento: new Date(),
      })
      .where('id', '=', o.reemplazar.id)
      .execute();
    return o.reemplazar.id;
  }

  const r = await tx
    .insertInto('documento_electronico')
    .values({
      empresa_id: ctx.empresaId,
      tipo_documento: o.tipo,
      cdc,
      ambiente: fe.ambiente,
      timbrado: fe.timbrado.numero,
      establecimiento: s.codigo,
      punto: o.punto,
      numero,
      fecha_emision: o.fecha,
      sucursal_id: o.sucursalId,
      venta_id: o.ventaId ?? null,
      devolucion_id: o.devolucionId ?? null,
      documento_asociado_id: o.asociadoId ?? null,
      receptor_nombre: cliente.razonSocial,
      receptor_documento: receptorDocumento,
      total: totalXml.toFixed(2),
      total_iva: new Decimal(valor(final, 'dTotIVA') ?? '0').toFixed(2),
      xml_firmado: final,
      qr_url: qr,
      creado_por: ctx.usuarioId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return r.id;
}

async function clienteDeVenta(tx: Tx, ventaId: string) {
  const c = await tx
    .selectFrom('venta as v')
    .innerJoin('cliente as cl', 'cl.id', 'v.cliente_id')
    .select(['cl.nombre', 'cl.documento', 'cl.telefono', 'cl.email', 'cl.direccion'])
    .where('v.id', '=', ventaId)
    .executeTakeFirst();
  return c ?? null;
}

/** Factura electrónica de una venta, en su misma transacción. El envío lo hace el emisor en segundo plano. */
export async function emitirFactura(tx: Tx, ctx: Ctx, fe: FeActiva, ventaId: string, reemplazar?: Reemplazo): Promise<string> {
  const v = await tx
    .selectFrom('venta as v')
    .innerJoin('caja as c', 'c.id', 'v.caja_id')
    .select(['v.total', 'v.vuelto', 'v.credito', 'v.creado_en', 'v.sucursal_id', 'c.punto_expedicion'])
    .where('v.id', '=', ventaId)
    .executeTakeFirstOrThrow();
  if (!v.punto_expedicion) throw invalido('La caja no tiene punto de expedición');
  const [items, pagos] = await Promise.all([
    tx
      .selectFrom('venta_item as i')
      .innerJoin('variante as va', 'va.id', 'i.variante_id')
      .innerJoin('producto as p', 'p.id', 'va.producto_id')
      .select(['i.descripcion', 'i.cantidad', 'i.precio_unitario', 'i.descuento', 'i.tasa_iva', 'va.sku', 'va.id as variante_id', 'p.unidad', 'p.tipo'])
      .where('i.venta_id', '=', ventaId)
      .orderBy('i.linea')
      .execute(),
    tx.selectFrom('venta_pago').select(['medio', 'monto_pyg']).where('venta_id', '=', ventaId).orderBy('linea').execute(),
  ]);
  // Pagos en guaraníes; el vuelto sale del efectivo para que lo informado sume el total.
  let vuelto = new Decimal(v.vuelto ?? 0);
  const entregas = pagos
    .map((p) => {
      let monto = new Decimal(p.monto_pyg);
      if (p.medio === 'efectivo' && vuelto.gt(0)) {
        const resta = Decimal.min(vuelto, monto);
        monto = monto.minus(resta);
        vuelto = vuelto.minus(resta);
      }
      const tipo = MEDIOS[p.medio] ?? 99;
      return {
        tipo,
        // Número (no texto): la librería suma las entregas para dMonEnt.
        monto: Number(monto.toFixed(0)),
        moneda: 'PYG',
        ...(tipo === 3 && { infoTarjeta: { tipo: 99, tipoDescripcion: 'Tarjeta', medioPago: 1 } }),
        ...(tipo === 99 && { tipoDescripcion: 'Otro' }),
      };
    })
    .filter((e) => e.monto > 0);
  // Venta con parte a crédito: condición crédito a plazo (lo pagado en el acto va como entrega inicial).
  const credito = new Decimal(v.credito ?? 0);
  let condicion: Record<string, unknown>;
  if (credito.gt(0)) {
    const cuenta = await tx.selectFrom('cuenta_cobrar').select(['fecha', 'vencimiento']).where('venta_id', '=', ventaId).executeTakeFirst();
    const dias = cuenta ? Math.max(1, Math.round((Date.parse(cuenta.vencimiento) - Date.parse(cuenta.fecha)) / 86400000)) : 30;
    condicion = { tipo: 2, ...(entregas.length && { entregas }), credito: { tipo: 1, plazo: `${dias} días` } };
  } else {
    condicion = { tipo: 1, entregas: entregas.length ? entregas : [{ tipo: 1, monto: Number(new Decimal(v.total).toFixed(0)), moneda: 'PYG' }] };
  }
  const id = await emitirDocumento(tx, ctx, fe, {
    tipo: 1,
    sucursalId: v.sucursal_id,
    punto: v.punto_expedicion,
    fecha: v.creado_en,
    cliente: await clienteDeVenta(tx, ventaId),
    items: items.map((i) => ({
      codigo: i.sku || i.variante_id.slice(-12),
      descripcion: i.descripcion,
      unidad: i.unidad,
      cantidad: new Decimal(i.cantidad),
      precioUnitario: new Decimal(i.precio_unitario),
      descuento: new Decimal(i.descuento),
      tasaIva: Number(i.tasa_iva),
      servicio: i.tipo === 'servicio',
    })),
    extra: {
      factura: { presencia: 1 },
      condicion,
    },
    totalEsperado: new Decimal(v.total),
    ventaId,
    reemplazar,
  });
  await tx.updateTable('venta').set({ comprobante: 'factura' }).where('id', '=', ventaId).execute();
  return id;
}

/**
 * Nota de crédito electrónica (motivo devolución) por los ítems devueltos, asociada a la factura.
 * La emite el punto de expedición de la caja donde se hace la devolución.
 */
export async function emitirNotaCredito(
  tx: Tx,
  ctx: Ctx,
  fe: FeActiva,
  a: { devolucionId: string; ventaId: string; facturaId: string; facturaCdc: string; sucursalId: string; punto: string; total: Decimal; lineas: { linea: number; cantidad: Decimal; total: Decimal }[]; fecha?: Date },
  reemplazar?: Reemplazo,
): Promise<string> {
  const items = await tx
    .selectFrom('venta_item as i')
    .innerJoin('variante as va', 'va.id', 'i.variante_id')
    .innerJoin('producto as p', 'p.id', 'va.producto_id')
    .select(['i.linea', 'i.descripcion', 'i.precio_unitario', 'i.tasa_iva', 'va.sku', 'va.id as variante_id', 'p.unidad', 'p.tipo'])
    .where('i.venta_id', '=', a.ventaId)
    .execute();
  const porLinea = new Map(items.map((i) => [i.linea, i]));
  return emitirDocumento(tx, ctx, fe, {
    tipo: 5,
    sucursalId: a.sucursalId,
    punto: a.punto,
    fecha: a.fecha ?? new Date(),
    cliente: await clienteDeVenta(tx, a.ventaId),
    items: a.lineas.map((l) => {
      const i = porLinea.get(l.linea)!;
      const precio = new Decimal(i.precio_unitario);
      return {
        codigo: i.sku || i.variante_id.slice(-12),
        descripcion: i.descripcion,
        unidad: i.unidad,
        cantidad: l.cantidad,
        precioUnitario: precio,
        // Lo que se reintegra es proporcional a lo cobrado: la diferencia con el precio de lista va como descuento.
        descuento: Decimal.max(precio.mul(l.cantidad).minus(l.total), 0),
        tasaIva: Number(i.tasa_iva),
        servicio: i.tipo === 'servicio',
      };
    }),
    extra: { notaCreditoDebito: { motivo: 2 }, documentoAsociado: { formato: 1, cdc: a.facturaCdc } },
    totalEsperado: a.total,
    devolucionId: a.devolucionId,
    asociadoId: a.facturaId,
    reemplazar,
  });
}

/** Número de comprobante para mostrar: 001-001-0000001. */
export const numeroComprobante = (d: { establecimiento: string; punto: string; numero: number }) => `${d.establecimiento}-${d.punto}-${String(d.numero).padStart(7, '0')}`;
