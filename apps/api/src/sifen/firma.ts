import { DOMParser } from '@xmldom/xmldom';
import { createHash } from 'node:crypto';
import { SignedXml } from 'xml-crypto';
import type { Certificado } from './certificado';

/**
 * Firma XMLDSig según el Manual Técnico SIFEN v150:
 *  - Signature como hijo de rDE, inmediatamente después de DE.
 *  - Reference URI="#<CDC>" (atributo Id de DE), transformaciones enveloped-signature + exc-c14n.
 *  - CanonicalizationMethod c14n, RSA-SHA256, digest SHA-256.
 *  - KeyInfo solo con X509Data/X509Certificate.
 */
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

function firmar(xml: string, nodo: string, cert: Certificado): string {
  const sig = new SignedXml({
    privateKey: cert.clavePem,
    publicCert: cert.certPem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: C14N,
    getKeyInfoContent: () => `<X509Data><X509Certificate>${cert.certBase64}</X509Certificate></X509Data>`,
  });
  sig.addReference({
    xpath: `//*[local-name(.)='${nodo}']`,
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: [ENVELOPED, EXC_C14N],
  });
  sig.computeSignature(xml, { location: { reference: `//*[local-name(.)='${nodo}']`, action: 'after' } });
  return sig.getSignedXml();
}

/** Firma el documento electrónico (nodo DE). */
export const firmarDE = (xml: string, cert: Certificado) => firmar(xml, 'DE', cert);
/** Firma un evento (nodo rEve). */
export const firmarEvento = (xml: string, cert: Certificado) => firmar(xml, 'rEve', cert);

/** Verifica la firma con el certificado embebido (pruebas y control antes de enviar). */
export function verificarFirma(xmlFirmado: string): boolean {
  const doc = new DOMParser().parseFromString(xmlFirmado, 'text/xml');
  const firma = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0];
  if (!firma) return false;
  const certB64 = firma.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'X509Certificate')[0]?.textContent ?? '';
  const pem = `-----BEGIN CERTIFICATE-----\n${certB64.match(/.{1,64}/g)?.join('\n')}\n-----END CERTIFICATE-----\n`;
  const sig = new SignedXml({ publicCert: pem });
  sig.loadSignature(firma);
  try {
    return sig.checkSignature(xmlFirmado);
  } catch {
    return false;
  }
}

/** Valor de un elemento simple del XML (primer aparición, sin prefijo). */
export function valor(xml: string, etiqueta: string): string | null {
  const m = new RegExp(`<(?:\\w+:)?${etiqueta}(?:\\s[^>]*)?>([^<]*)</(?:\\w+:)?${etiqueta}>`).exec(xml);
  return m ? m[1]! : null;
}

export const sha256Hex = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');
