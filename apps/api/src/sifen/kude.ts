import { DOMParser, type Element } from '@xmldom/xmldom';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

/**
 * KuDE en hoja A4 (representación gráfica del documento electrónico), armado desde el XML firmado:
 * lo impreso es exactamente lo que recibió SIFEN.
 */

type Nodo = Element | null | undefined;
const hijos = (n: Nodo, tag: string): Element[] => (n ? Array.from(n.getElementsByTagName(tag)) : []);
const uno = (n: Nodo, tag: string): Element | null => hijos(n, tag)[0] ?? null;
const txt = (n: Nodo, tag: string): string => uno(n, tag)?.textContent?.trim() ?? '';

const fmt = new Intl.NumberFormat('es-PY', { maximumFractionDigits: 2 });
const gs = (v: string | number) => (v === '' ? '' : fmt.format(Number(v)));
const fecha = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}${iso.length > 10 ? ` ${iso.slice(11, 16)}` : ''}` : '');
const cdcAgrupado = (cdc: string) => cdc.replace(/(.{4})/g, '$1 ').trim();

export interface DatosKude {
  cdc: string;
  tipo: string;
  numero: string;
  timbrado: string;
  inicioTimbrado: string;
  fechaEmision: string;
  emisor: { nombre: string; ruc: string; direccion: string; telefono: string; email: string; actividad: string };
  receptor: { nombre: string; documento: string; direccion: string; email: string };
  condicion: string;
  moneda: string;
  items: { codigo: string; descripcion: string; unidad: string; cantidad: string; precio: string; descuento: string; exenta: string; iva5: string; iva10: string }[];
  totales: { exentas: string; sub5: string; sub10: string; descuento: string; total: string; iva5: string; iva10: string; iva: string };
  asociado: string | null;
  motivo: string | null;
}

export function leerXmlDe(xml: string): DatosKude {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const de = uno(doc.documentElement as unknown as Element, 'DE');
  const timb = uno(de, 'gTimb');
  const gral = uno(de, 'gDatGralOpe');
  const emis = uno(gral, 'gEmis');
  const rec = uno(gral, 'gDatRec');
  const tipoDe = uno(de, 'gDtipDE');
  const tot = uno(de, 'gTotSub');
  const est = txt(timb, 'dEst');
  const pun = txt(timb, 'dPunExp');
  const num = txt(timb, 'dNumDoc');
  const rucRec = txt(rec, 'dRucRec');
  const items = hijos(tipoDe, 'gCamItem').map((it) => {
    const valor = uno(it, 'gValorItem');
    const resta = uno(valor, 'gValorRestaItem');
    const iva = uno(it, 'gCamIVA');
    const afec = txt(iva, 'iAfecIVA');
    const tasa = txt(iva, 'dTasaIVA');
    const totalItem = txt(resta, 'dTotOpeItem') || txt(valor, 'dTotBruOpeItem');
    // Gravado (1) va a la columna de su tasa; exento (3) a exentas. Los parcialmente gravados se informan por la tasa.
    return {
      codigo: txt(it, 'dCodInt'),
      descripcion: txt(it, 'dDesProSer'),
      unidad: txt(it, 'dDesUniMed'),
      cantidad: txt(it, 'dCantProSer'),
      precio: txt(valor, 'dPUniProSer'),
      descuento: txt(resta, 'dDescItem'),
      exenta: afec === '3' ? totalItem : '',
      iva5: afec !== '3' && tasa === '5' ? totalItem : '',
      iva10: afec !== '3' && tasa === '10' ? totalItem : '',
    };
  });
  const asoc = uno(de, 'gCamDEAsoc');
  return {
    cdc: de?.getAttribute('Id') ?? '',
    tipo: txt(timb, 'dDesTiDE'),
    numero: `${est}-${pun}-${num}`,
    timbrado: txt(timb, 'dNumTim'),
    inicioTimbrado: txt(timb, 'dFeIniT'),
    fechaEmision: txt(gral, 'dFeEmiDE'),
    emisor: {
      nombre: txt(emis, 'dNomEmi'),
      ruc: `${txt(emis, 'dRucEm')}-${txt(emis, 'dDVEmi')}`,
      direccion: [txt(emis, 'dDirEmi'), txt(emis, 'dNumCas') !== '0' ? txt(emis, 'dNumCas') : '', txt(emis, 'dDesCiuEmi')].filter(Boolean).join(' · '),
      telefono: txt(emis, 'dTelEmi'),
      email: txt(emis, 'dEmailE'),
      actividad: hijos(emis, 'dDesActEco').map((a) => a.textContent ?? '').join(' · '),
    },
    receptor: {
      nombre: txt(rec, 'dNomRec'),
      documento: rucRec ? `RUC ${rucRec}-${txt(rec, 'dDVRec')}` : txt(rec, 'dNumIDRec') && txt(rec, 'dNumIDRec') !== '0' ? `${txt(rec, 'dDTipIDRec') || 'Documento'} ${txt(rec, 'dNumIDRec')}` : 'Sin documento',
      direccion: txt(rec, 'dDirRec'),
      email: txt(rec, 'dEmailRec'),
    },
    condicion: txt(uno(tipoDe, 'gCamCond'), 'dDCondOpe'),
    moneda: txt(gral, 'cMoneOpe') || 'PYG',
    items,
    totales: {
      exentas: txt(tot, 'dSubExe'),
      sub5: txt(tot, 'dSub5'),
      sub10: txt(tot, 'dSub10'),
      descuento: txt(tot, 'dTotDesc'),
      total: txt(tot, 'dTotGralOpe'),
      iva5: txt(tot, 'dIVA5'),
      iva10: txt(tot, 'dIVA10'),
      iva: txt(tot, 'dTotIVA'),
    },
    asociado: asoc ? txt(asoc, 'dCdCDERef') || `${txt(asoc, 'dEstDocAso')}-${txt(asoc, 'dPExpDocAso')}-${txt(asoc, 'dNumDocAso')}` : null,
    motivo: txt(uno(tipoDe, 'gCamNCDE'), 'dDesMotEmi') || null,
  };
}

/** Genera el PDF A4 del KuDE. */
export async function kudePdf(xml: string, qrUrl: string, opciones: { ambiente: 'test' | 'produccion'; estado: string }): Promise<Buffer> {
  const d = leerXmlDe(xml);
  const qr = await QRCode.toBuffer(qrUrl, { margin: 0, width: 220, errorCorrectionLevel: 'M' });
  const pdf = new PDFDocument({ size: 'A4', margin: 36, info: { Title: `${d.tipo} ${d.numero}`, Author: d.emisor.nombre, Creator: 'KONTIVA ERP' } });
  const partes: Buffer[] = [];
  pdf.on('data', (b: Buffer) => partes.push(b));
  const fin = new Promise<Buffer>((ok) => pdf.on('end', () => ok(Buffer.concat(partes))));

  const X = 36;
  const W = pdf.page.width - 72;
  const gris = '#555555';
  const linea = '#BBBBBB';

  // ── Cabecera: emisor (izquierda) y timbrado (derecha) ──
  const yCab = 36;
  pdf.font('Helvetica-Bold').fontSize(13).fillColor('#000').text(d.emisor.nombre, X, yCab, { width: W * 0.58 });
  pdf.font('Helvetica').fontSize(8.5).fillColor(gris);
  if (d.emisor.actividad) pdf.text(d.emisor.actividad, { width: W * 0.58 });
  pdf.text(d.emisor.direccion, { width: W * 0.58 });
  pdf.text([d.emisor.telefono && `Tel. ${d.emisor.telefono}`, d.emisor.email].filter(Boolean).join(' · '), { width: W * 0.58 });
  const yFinEmisor = pdf.y;

  const xT = X + W * 0.6;
  const wT = W * 0.4;
  pdf.rect(xT, yCab - 4, wT, 82).strokeColor(linea).lineWidth(0.8).stroke();
  pdf.fillColor('#000').font('Helvetica').fontSize(9);
  pdf.text(`RUC: ${d.emisor.ruc}`, xT + 8, yCab + 2, { width: wT - 16 });
  pdf.text(`Timbrado N.º ${d.timbrado}`, { width: wT - 16 });
  pdf.text(`Inicio de vigencia: ${fecha(d.inicioTimbrado)}`, { width: wT - 16 });
  pdf.font('Helvetica-Bold').fontSize(11).text(d.tipo.toUpperCase(), { width: wT - 16 });
  pdf.fontSize(12).text(d.numero, { width: wT - 16 });

  // ── Datos de la operación ──
  let y = Math.max(yFinEmisor, yCab + 82) + 12;
  pdf.rect(X, y, W, 58).strokeColor(linea).stroke();
  const col = (etq: string, val: string, x: number, yy: number, w: number) => {
    pdf.font('Helvetica-Bold').fontSize(8.5).fillColor('#000').text(`${etq}: `, x, yy, { continued: true, width: w }).font('Helvetica').text(val || '—');
  };
  col('Fecha de emisión', fecha(d.fechaEmision), X + 8, y + 7, W / 2 - 12);
  col('Condición de venta', d.condicion, X + W / 2, y + 7, W / 2 - 8);
  col('Nombre o razón social', d.receptor.nombre, X + 8, y + 21, W / 2 - 12);
  col('RUC / documento', d.receptor.documento, X + W / 2, y + 21, W / 2 - 8);
  col('Dirección', d.receptor.direccion, X + 8, y + 35, W / 2 - 12);
  col('Moneda', d.moneda === 'PYG' ? 'Guaraní' : d.moneda, X + W / 2, y + 35, W / 2 - 8);
  if (d.receptor.email) col('Correo', d.receptor.email, X + W / 2, y + 47, W / 2 - 8);
  y += 66;
  if (d.asociado || d.motivo) {
    pdf.font('Helvetica').fontSize(8.5).fillColor('#000').text([d.asociado && `Documento asociado: ${d.asociado}`, d.motivo && `Motivo: ${d.motivo}`].filter(Boolean).join(' · '), X, y, { width: W });
    y = pdf.y + 6;
  }

  // ── Detalle ──
  const cols = [
    { t: 'Código', w: 0.1, a: 'left' as const },
    { t: 'Descripción', w: 0.3, a: 'left' as const },
    { t: 'Cant.', w: 0.07, a: 'right' as const },
    { t: 'Precio unit.', w: 0.11, a: 'right' as const },
    { t: 'Descuento', w: 0.09, a: 'right' as const },
    { t: 'Exentas', w: 0.1, a: 'right' as const },
    { t: '5 %', w: 0.11, a: 'right' as const },
    { t: '10 %', w: 0.12, a: 'right' as const },
  ];
  const fila = (vals: string[], yy: number, negrita = false) => {
    let x = X;
    let alto = 0;
    pdf.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor('#000');
    cols.forEach((c, i) => {
      const w = c.w * W;
      pdf.text(vals[i] ?? '', x + 3, yy, { width: w - 6, align: c.a });
      alto = Math.max(alto, pdf.heightOfString(vals[i] ?? '', { width: w - 6 }));
      x += w;
    });
    return alto;
  };
  pdf.rect(X, y, W, 16).fillColor('#EEEEEE').fill();
  fila(cols.map((c) => c.t), y + 4, true);
  y += 18;
  for (const it of d.items) {
    if (y > pdf.page.height - 230) {
      pdf.addPage();
      y = 36;
    }
    const alto = fila([it.codigo, it.descripcion, gs(it.cantidad), gs(it.precio), it.descuento && Number(it.descuento) ? gs(it.descuento) : '', gs(it.exenta), gs(it.iva5), gs(it.iva10)], y);
    y += alto + 5;
    pdf.moveTo(X, y - 2).lineTo(X + W, y - 2).strokeColor('#E2E2E2').lineWidth(0.5).stroke();
  }

  // ── Totales ──
  y += 4;
  const sub = [d.totales.exentas, d.totales.sub5, d.totales.sub10];
  pdf.rect(X, y, W, 16).strokeColor(linea).lineWidth(0.8).stroke();
  fila(['', 'Subtotales', '', '', d.totales.descuento && Number(d.totales.descuento) ? gs(d.totales.descuento) : '', gs(sub[0]!), gs(sub[1]!), gs(sub[2]!)], y + 4, true);
  y += 22;
  pdf.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(`TOTAL A PAGAR: Gs. ${gs(d.totales.total)}`, X, y, { width: W, align: 'right' });
  y = pdf.y + 4;
  pdf.font('Helvetica').fontSize(9).text(`Liquidación del IVA: 5 %: ${gs(d.totales.iva5 || 0)}   ·   10 %: ${gs(d.totales.iva10 || 0)}   ·   Total IVA: ${gs(d.totales.iva || 0)}`, X, y, { width: W, align: 'right' });
  y = pdf.y + 14;

  // ── QR, CDC y leyendas ──
  if (y > pdf.page.height - 170) {
    pdf.addPage();
    y = 36;
  }
  pdf.rect(X, y, W, 128).strokeColor(linea).stroke();
  pdf.image(qr, X + 10, y + 10, { width: 108 });
  const xL = X + 132;
  const wL = W - 142;
  pdf.font('Helvetica').fontSize(8.5).fillColor('#000').text('Consulte la validez de este documento electrónico con el número de CDC impreso abajo en:', xL, y + 12, { width: wL });
  pdf.fillColor('#1F3A93').text('https://ekuatia.set.gov.py/consultas/', { width: wL, link: 'https://ekuatia.set.gov.py/consultas/' });
  pdf.moveDown(0.5).font('Helvetica-Bold').fontSize(11).fillColor('#000').text(`CDC: ${cdcAgrupado(d.cdc)}`, { width: wL });
  pdf.moveDown(0.5).font('Helvetica-Bold').fontSize(8.5).text('ESTE DOCUMENTO ES UNA REPRESENTACIÓN GRÁFICA DE UN DOCUMENTO ELECTRÓNICO (XML)', { width: wL });
  pdf.font('Helvetica').fontSize(8).fillColor(gris).text('Si su documento electrónico presenta algún error, puede solicitar la modificación dentro de las 72 horas siguientes a su emisión.', { width: wL });
  if (opciones.ambiente === 'test') pdf.moveDown(0.3).font('Helvetica-Bold').fillColor('#B00020').text('AMBIENTE DE PRUEBA · SIN VALOR COMERCIAL NI FISCAL', { width: wL });
  if (opciones.estado === 'cancelado') pdf.moveDown(0.3).font('Helvetica-Bold').fillColor('#B00020').text('DOCUMENTO CANCELADO', { width: wL });

  pdf.page.margins.bottom = 0;
  pdf.font('Helvetica').fontSize(7.5).fillColor('#888888').text('KONTIVA ERP · Desarrollado por Araújo Tech Sistemas', X, pdf.page.height - 30, { width: W, align: 'center', lineBreak: false });
  pdf.end();
  return fin;
}
