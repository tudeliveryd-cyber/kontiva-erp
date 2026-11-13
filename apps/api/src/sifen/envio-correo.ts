import { sql } from 'kysely';
import type { Correo } from '../comun/correo';
import type { Tx } from '../db/database';
import { numeroComprobante } from './emision';
import { kudePdf, leerXmlDe } from './kude';

const fmt = new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 });

/** Correo del receptor según la venta (o la venta devuelta) del documento. */
export async function correoReceptor(tx: Tx, documentoId: string): Promise<string | null> {
  const { rows } = await sql<{ e: string | null }>`SELECT fe_correo_receptor(d) AS e FROM documento_electronico d WHERE d.id = ${documentoId}`.execute(tx);
  return rows[0]?.e ?? null;
}

/** Arma el KuDE en PDF y el XML del documento y los envía por correo. Registra el envío en el documento. */
export async function enviarDocumentoPorCorreo(tx: Tx, correo: Correo, documentoId: string, para: string) {
  const d = await tx.selectFrom('documento_electronico').selectAll().where('id', '=', documentoId).executeTakeFirstOrThrow();
  const empresa = await tx.selectFrom('empresa').select(['nombre_fantasia', 'razon_social']).executeTakeFirstOrThrow();
  const datos = leerXmlDe(d.xml_firmado);
  const numero = numeroComprobante(d);
  const nombre = empresa.nombre_fantasia || empresa.razon_social;
  const pdf = await kudePdf(d.xml_firmado, d.qr_url, { ambiente: d.ambiente, estado: d.estado });
  const fecha = datos.fechaEmision ? `${datos.fechaEmision.slice(8, 10)}/${datos.fechaEmision.slice(5, 7)}/${datos.fechaEmision.slice(0, 4)}` : '';
  await correo.enviar({
    para,
    asunto: `${datos.tipo} N.º ${numero} · ${nombre}`,
    texto: [
      `Estimado/a ${d.receptor_nombre}:`,
      '',
      `Le enviamos su ${datos.tipo.toLowerCase()} N.º ${numero} del ${fecha} por Gs. ${fmt.format(Number(d.total))}.`,
      '',
      `CDC: ${d.cdc}`,
      'Puede verificar su validez en https://ekuatia.set.gov.py/consultas/',
      '',
      'Adjuntos: la representación gráfica (KuDE, en PDF) y el documento electrónico (XML).',
      d.ambiente === 'test' ? '\nDocumento emitido en ambiente de prueba, sin valor comercial ni fiscal.' : '',
      '',
      nombre,
      '',
      'KONTIVA ERP · Desarrollado por Araújo Tech Sistemas',
    ].join('\n'),
    adjuntos: [
      { nombre: `${numero}.pdf`, contenido: pdf, tipo: 'application/pdf' },
      { nombre: `${d.cdc}.xml`, contenido: d.xml_firmado, tipo: 'application/xml' },
    ],
  });
  await tx.updateTable('documento_electronico').set({ correo_enviado_a: para, correo_enviado_en: new Date(), correo_error: null }).where('id', '=', documentoId).execute();
}
