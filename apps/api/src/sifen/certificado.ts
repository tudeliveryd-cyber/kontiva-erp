import forge from 'node-forge';

/** Certificado de firma (.p12 / .pfx) listo para firmar y para el TLS mutuo con la DNIT. */
export interface Certificado {
  clavePem: string;
  certPem: string;
  /** Certificado en base64 (DER), sin encabezados: va en X509Certificate. */
  certBase64: string;
  titular: string;
  ruc: string | null;
  emitido: Date;
  vence: Date;
  pfx: Buffer;
  clave: string;
}

export class ErrorCertificado extends Error {}

/** Lee un .p12 en base64 con su contraseña. Toma el certificado que corresponde a la clave privada. */
export function leerP12(p12Base64: string, clave: string): Certificado {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.decode64(p12Base64));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, clave);
  } catch {
    throw new ErrorCertificado('No se pudo abrir el certificado: archivo inválido o contraseña incorrecta');
  }
  const oidClave = forge.pki.oids.pkcs8ShroudedKeyBag as string;
  const oidClaveSimple = forge.pki.oids.keyBag as string;
  const oidCert = forge.pki.oids.certBag as string;
  const claves: forge.pkcs12.Bag[] = [...(p12.getBags({ bagType: oidClave })[oidClave] ?? []), ...(p12.getBags({ bagType: oidClaveSimple })[oidClaveSimple] ?? [])];
  const privada = claves.find((b) => b.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!privada) throw new ErrorCertificado('El archivo no contiene la clave privada');
  const bolsas: forge.pkcs12.Bag[] = p12.getBags({ bagType: oidCert })[oidCert] ?? [];
  const certs = bolsas.map((b) => b.cert).filter((c): c is forge.pki.Certificate => !!c);
  const propio = certs.find((c: forge.pki.Certificate) => {
    const pub = c.publicKey as forge.pki.rsa.PublicKey;
    return pub.n && pub.n.equals(privada.n);
  });
  if (!propio) throw new ErrorCertificado('El archivo no contiene el certificado de la clave privada');

  const atributos = propio.subject.attributes.map((a: forge.pki.CertificateField) => `${a.shortName ?? a.name ?? a.type}=${String(a.value)}`);
  const cn = propio.subject.getField('CN')?.value as string | undefined;
  const ruc = atributos.join(' ').match(/(\d{5,8}-\d)/)?.[1] ?? null;
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(propio)).getBytes();
  return {
    clavePem: forge.pki.privateKeyToPem(privada),
    certPem: forge.pki.certificateToPem(propio),
    certBase64: forge.util.encode64(der),
    titular: cn ?? atributos.join(', '),
    ruc,
    emitido: propio.validity.notBefore,
    vence: propio.validity.notAfter,
    pfx: Buffer.from(p12Base64, 'base64'),
    clave,
  };
}

/** Solo para pruebas: genera un .p12 autofirmado (RSA 2048) con el RUC en el sujeto. */
export function generarP12DePrueba(ruc: string, clave: string, titular = 'EMPRESA DE PRUEBA'): string {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(8));
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const sujeto = [
    { name: 'commonName', value: titular },
    { name: 'serialNumber', value: `RUC${ruc}` },
    { name: 'countryName', value: 'PY' },
  ];
  cert.setSubject(sujeto);
  cert.setIssuer(sujeto);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], clave, { algorithm: '3des' });
  return forge.util.encode64(forge.asn1.toDer(p12).getBytes());
}
