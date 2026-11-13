import type { BloqueTicket, DocumentoTicket } from '@kontiva/shared';
import { fechaHora } from './formato';
import { cantidad, NOMBRE_MEDIO, numero, type Venta } from './operacion';

/**
 * Impresora térmica por el agente local (programa instalado en la computadora de la caja).
 * La configuración es de cada equipo: se guarda en el navegador.
 */
export interface ConfigAgente {
  url: string;
  token: string;
  /** Imprimir solo al confirmar cada venta. */
  automatico: boolean;
  /** Abrir el cajón en las ventas con efectivo. */
  cajon: boolean;
}

const CLAVE = 'kontiva.agente';

export function leerAgente(): ConfigAgente | null {
  try {
    const c = JSON.parse(localStorage.getItem(CLAVE) ?? 'null') as ConfigAgente | null;
    return c?.url && c.token ? c : null;
  } catch {
    return null;
  }
}
export function guardarAgente(c: ConfigAgente | null) {
  try {
    if (c) localStorage.setItem(CLAVE, JSON.stringify(c));
    else localStorage.removeItem(CLAVE);
  } catch {
    /* sin almacenamiento: no se recuerda */
  }
}

async function llamar<T>(c: ConfigAgente, ruta: string, cuerpo?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${c.url.replace(/\/$/, '')}${ruta}`, {
      method: cuerpo === undefined && ruta !== '/cajon' && ruta !== '/prueba' ? 'GET' : 'POST',
      headers: { 'X-Agente-Token': c.token, ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error('No se encontró el agente de impresión en este equipo. Verifique que esté abierto.');
  }
  const datos = (await r.json().catch(() => ({}))) as { mensaje?: string };
  if (!r.ok) throw new Error(datos.mensaje ?? `El agente respondió ${r.status}`);
  return datos as T;
}

export const estadoAgente = (c: ConfigAgente) => llamar<{ version: string; impresora: string; ancho: number }>(c, '/estado');
export const pruebaAgente = (c: ConfigAgente) => llamar(c, '/prueba');
export const imprimirEnAgente = (c: ConfigAgente, documento: DocumentoTicket) => llamar(c, '/imprimir', { documento });

const cdcAgrupado = (cdc: string) => cdc.match(/.{1,4}/g)!.join(' ');

/** Ticket de la venta (KuDE en formato ticket si tiene factura electrónica), igual que el impreso por el navegador. */
export function ticketDeVenta(venta: Venta, empresa: { nombre: string; razonSocial: string; ruc: string | null }): DocumentoTicket {
  const de = venta.documentoElectronico;
  const b: BloqueTicket[] = [
    { t: 'texto', v: empresa.nombre, alinear: 'centro', negrita: true, grande: true },
    { t: 'texto', v: empresa.razonSocial, alinear: 'centro' },
  ];
  if (empresa.ruc) b.push({ t: 'texto', v: `RUC ${empresa.ruc}`, alinear: 'centro' });
  b.push({ t: 'texto', v: `${venta.sucursal.nombre}${venta.sucursal.direccion ? ` · ${venta.sucursal.direccion}` : ''}`, alinear: 'centro' }, { t: 'linea' });
  if (de) {
    b.push({ t: 'texto', v: `Timbrado N.º ${de.timbrado}` });
    if (de.timbradoInicio) b.push({ t: 'texto', v: `Inicio de vigencia: ${de.timbradoInicio.split('-').reverse().join('/')}` });
    b.push({ t: 'texto', v: 'FACTURA ELECTRÓNICA', alinear: 'centro', negrita: true }, { t: 'texto', v: `N.º ${de.numero}`, alinear: 'centro', negrita: true });
    b.push({ t: 'texto', v: `Condición de venta: ${Number(venta.credito) > 0 ? 'Crédito' : 'Contado'}` });
    if (de.ambiente === 'test') b.push({ t: 'texto', v: 'AMBIENTE DE PRUEBA · SIN VALOR FISCAL', alinear: 'centro', negrita: true });
  } else {
    b.push({ t: 'texto', v: 'COMPROBANTE INTERNO', alinear: 'centro', negrita: true }, { t: 'texto', v: 'NO VÁLIDO COMO FACTURA', alinear: 'centro' });
    b.push({ t: 'texto', v: `N.º ${venta.sucursal.codigo}-${venta.caja.nombre}-${String(venta.numero).padStart(7, '0')}` });
  }
  b.push({ t: 'texto', v: fechaHora(venta.fecha) }, { t: 'texto', v: `Atendió: ${venta.vendedor.nombre}` });
  if (venta.cliente) b.push({ t: 'texto', v: `Cliente: ${venta.cliente.nombre}${venta.cliente.documento ? ` · ${venta.cliente.documento.includes('-') ? 'RUC' : 'CI'} ${venta.cliente.documento}` : ''}` });
  else if (de) b.push({ t: 'texto', v: 'Cliente: Sin nombre' });
  if (venta.estado === 'anulada') b.push({ t: 'texto', v: '*** ANULADA ***', alinear: 'centro', negrita: true });
  b.push({ t: 'linea' });
  for (const i of venta.items) {
    b.push({ t: 'texto', v: i.descripcion });
    b.push({ t: 'fila', izq: `${cantidad(i.cantidad)} x ${numero(i.precioUnitario)}${i.tasaIva === 0 ? ' Ex' : ` ${i.tasaIva}%`}`, der: numero(i.total) });
    if (Number(i.descuento) > 0) b.push({ t: 'fila', izq: '  Descuento', der: `-${numero(i.descuento)}` });
  }
  b.push({ t: 'linea' }, { t: 'fila', izq: 'TOTAL', der: `Gs. ${numero(venta.total)}`, negrita: true, grande: true });
  for (const p of venta.pagos) b.push({ t: 'fila', izq: `${NOMBRE_MEDIO[p.medio]}${p.moneda !== 'PYG' ? ` ${p.moneda} ${numero(p.monto, 2)} @ ${numero(p.cotizacion)}` : ''}`, der: numero(p.montoPyg) });
  if (Number(venta.credito) > 0) b.push({ t: 'fila', izq: `A crédito${venta.cuentaCobrar ? ` · vence ${venta.cuentaCobrar.vencimiento.split('-').reverse().join('/')}` : ''}`, der: numero(venta.credito) });
  for (const v of venta.vuelto) b.push({ t: 'fila', izq: 'Vuelto', der: `${v.moneda === 'PYG' ? 'Gs.' : v.moneda} ${numero(v.monto, v.moneda === 'PYG' ? 0 : 2)}` });
  b.push({ t: 'linea' }, { t: 'fila', izq: 'Gravado 10 %', der: numero(venta.gravado10) }, { t: 'fila', izq: 'IVA 10 %', der: numero(venta.iva10) });
  if (Number(venta.gravado5) > 0) b.push({ t: 'fila', izq: 'Gravado 5 %', der: numero(venta.gravado5) }, { t: 'fila', izq: 'IVA 5 %', der: numero(venta.iva5) });
  if (Number(venta.exento) > 0) b.push({ t: 'fila', izq: 'Exento', der: numero(venta.exento) });
  if (de) b.push({ t: 'fila', izq: 'Total IVA', der: numero(de.totalIva), negrita: true });
  b.push({ t: 'linea' });
  if (de) {
    b.push(
      { t: 'qr', v: de.qr, tamano: 5 },
      { t: 'texto', v: 'Consulte la validez de esta factura electrónica con el número de CDC en', alinear: 'centro' },
      { t: 'texto', v: `https://ekuatia.set.gov.py/consultas${de.ambiente === 'test' ? '-test' : ''}`, alinear: 'centro' },
      { t: 'texto', v: `CDC: ${cdcAgrupado(de.cdc)}`, alinear: 'centro', negrita: true },
      { t: 'texto', v: 'ESTE DOCUMENTO ES UNA REPRESENTACIÓN GRÁFICA DE UN DOCUMENTO ELECTRÓNICO (XML)', alinear: 'centro' },
    );
    if (de.estado === 'cancelado') b.push({ t: 'texto', v: '*** FACTURA CANCELADA ***', alinear: 'centro', negrita: true });
    b.push({ t: 'linea' });
  }
  b.push({ t: 'texto', v: 'Gracias por su compra', alinear: 'centro' }, { t: 'texto', v: 'KONTIVA ERP · Araújo Tech Sistemas', alinear: 'centro' });
  return { bloques: b, cortar: true };
}

/** Comprobante provisorio de una venta sin conexión. */
export function ticketProvisorio(
  p: { numero: number; creadaEn: string; lineas: { descripcion: string; cantidad: string; precio: string; total: number }[]; total: number; pagos: { medio: string; moneda: string; monto: number }[]; vuelto: { moneda: string; monto: number }[] },
  empresa: { nombre: string; razonSocial: string; ruc: string | null },
  caja: string,
  sucursal: string,
  cajero?: string,
): DocumentoTicket {
  const b: BloqueTicket[] = [
    { t: 'texto', v: empresa.nombre, alinear: 'centro', negrita: true, grande: true },
    { t: 'texto', v: empresa.razonSocial, alinear: 'centro' },
    ...(empresa.ruc ? [{ t: 'texto' as const, v: `RUC ${empresa.ruc}`, alinear: 'centro' as const }] : []),
    { t: 'texto', v: sucursal, alinear: 'centro' },
    { t: 'linea' },
    { t: 'texto', v: 'COMPROBANTE PROVISORIO', alinear: 'centro', negrita: true },
    { t: 'texto', v: 'VENTA REGISTRADA SIN CONEXIÓN · NO VÁLIDO COMO FACTURA', alinear: 'centro' },
    { t: 'linea' },
    { t: 'texto', v: `N.º S/C-${p.numero} · ${caja}` },
    { t: 'texto', v: fechaHora(p.creadaEn) },
    ...(cajero ? [{ t: 'texto' as const, v: `Atendió: ${cajero}` }] : []),
    { t: 'linea' },
  ];
  for (const l of p.lineas) b.push({ t: 'texto', v: l.descripcion }, { t: 'fila', izq: `${cantidad(l.cantidad)} x ${numero(l.precio)}`, der: numero(l.total) });
  b.push({ t: 'linea' }, { t: 'fila', izq: 'TOTAL', der: `Gs. ${numero(p.total)}`, negrita: true, grande: true });
  for (const x of p.pagos) b.push({ t: 'fila', izq: NOMBRE_MEDIO[x.medio as keyof typeof NOMBRE_MEDIO] ?? x.medio, der: numero(x.monto, x.moneda === 'PYG' ? 0 : 2) });
  for (const x of p.vuelto) b.push({ t: 'fila', izq: 'Vuelto', der: numero(x.monto, x.moneda === 'PYG' ? 0 : 2) });
  b.push({ t: 'linea' }, { t: 'texto', v: 'Solicite su comprobante definitivo cuando vuelva la conexión.', alinear: 'centro' }, { t: 'texto', v: 'KONTIVA ERP · Araújo Tech Sistemas', alinear: 'centro' });
  return { bloques: b, cortar: true };
}
