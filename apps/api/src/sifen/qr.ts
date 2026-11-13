import { sha256Hex, valor } from './firma';

/**
 * Código QR del KuDE (gCamFuFD/dCarQR), calculado sobre el XML ya firmado.
 * cHashQR = SHA-256 (hex) de los parámetros concatenados + el CSC.
 */
export function urlQr(xmlFirmado: string, ambiente: 'test' | 'produccion', cscId: string, csc: string): string {
  const base = ambiente === 'test' ? 'https://ekuatia.set.gov.py/consultas-test/qr?' : 'https://ekuatia.set.gov.py/consultas/qr?';
  const id = /<DE\s[^>]*Id="([0-9]{44})"/.exec(xmlFirmado)?.[1];
  const digest = valor(xmlFirmado, 'DigestValue');
  if (!id || !digest) throw new Error('El XML debe estar firmado antes de generar el QR');
  const hex = (t: string) => Buffer.from(t, 'utf8').toString('hex');
  const partes: string[] = [];
  partes.push(`nVersion=${valor(xmlFirmado, 'dVerFor')}`);
  partes.push(`Id=${id}`);
  partes.push(`dFeEmiDE=${hex(valor(xmlFirmado, 'dFeEmiDE')!)}`);
  if (valor(xmlFirmado, 'iNatRec') === '1') partes.push(`dRucRec=${valor(xmlFirmado, 'dRucRec')}`);
  else partes.push(`dNumIDRec=${valor(xmlFirmado, 'dNumIDRec')}`);
  partes.push(`dTotGralOpe=${valor(xmlFirmado, 'dTotGralOpe') ?? 0}`);
  partes.push(`dTotIVA=${valor(xmlFirmado, 'dTotIVA') ?? 0}`);
  partes.push(`cItems=${(xmlFirmado.match(/<gCamItem>/g) ?? []).length}`);
  partes.push(`DigestValue=${hex(digest)}`);
  partes.push(`IdCSC=${cscId.padStart(4, '0')}`);
  const parametros = partes.join('&');
  return `${base}${parametros}&cHashQR=${sha256Hex(parametros + csc)}`;
}

const escapar = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Agrega gCamFuFD (fuera de la firma) al final de rDE. */
export function agregarQr(xmlFirmado: string, url: string): string {
  return xmlFirmado.replace(/<\/rDE>\s*$/, `<gCamFuFD><dCarQR>${escapar(url)}</dCarQR></gCamFuFD></rDE>`);
}
