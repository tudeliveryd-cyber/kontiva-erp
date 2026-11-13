import { DOMParser, type Document, type Element } from '@xmldom/xmldom';
import { zipSync, strToU8 } from 'fflate';
import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { request as requestHttp } from 'node:http';
import { config } from '../config';
import type { Certificado } from './certificado';

/**
 * Cliente de los servicios web de SIFEN (SOAP 1.2 sobre TLS mutuo con el certificado de la empresa).
 * Servicios: recepción de lote (asíncrono), resultado de lote, consulta de DE por CDC,
 * consulta de RUC y recepción de eventos.
 */
export type Ambiente = 'test' | 'produccion';

const RUTAS = {
  lote: '/de/ws/async/recibe-lote.wsdl',
  resultadoLote: '/de/ws/consultas/consulta-lote.wsdl',
  consultaDe: '/de/ws/consultas/consulta.wsdl',
  consultaRuc: '/de/ws/consultas/consulta-ruc.wsdl',
  evento: '/de/ws/eventos/evento.wsdl',
} as const;

const NS = 'http://ekuatia.set.gov.py/sifen/xsd';

export class ErrorSifen extends Error {
  constructor(
    mensaje: string,
    readonly reintentable: boolean,
  ) {
    super(mensaje);
  }
}

const sobre = (cuerpo: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Header/><env:Body>${cuerpo}</env:Body></env:Envelope>`;

const sinDeclaracion = (xml: string) => xml.replace(/^\s*<\?xml[^>]*\?>\s*/, '');

function urlBase(ambiente: Ambiente) {
  return ambiente === 'test' ? config().SIFEN_URL_TEST : config().SIFEN_URL_PRODUCCION;
}

async function enviar(ambiente: Ambiente, ruta: string, cuerpo: string, cert: Certificado, tiempo = 60000, completo = false): Promise<Document> {
  const url = new URL(ruta, urlBase(ambiente));
  const datos = Buffer.from(completo ? cuerpo : sobre(cuerpo), 'utf8');
  const ca = config().SIFEN_CA ? readFileSync(config().SIFEN_CA!) : undefined;
  const texto = await new Promise<string>((resolve, reject) => {
    const opciones = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port || undefined,
      path: url.pathname,
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Length': datos.length, 'User-Agent': 'KONTIVA-ERP' },
      timeout: tiempo,
    };
    const alResponder = (res: import('node:http').IncomingMessage) => {
      const partes: Buffer[] = [];
      res.on('data', (c: Buffer) => partes.push(c));
      res.on('end', () => {
        const body = Buffer.concat(partes).toString('utf8');
        if ((res.statusCode ?? 500) >= 500 && !body.includes('Envelope')) reject(new ErrorSifen(`SIFEN respondió ${res.statusCode}`, true));
        else resolve(body);
      });
    };
    const req =
      url.protocol === 'http:'
        ? requestHttp(opciones, alResponder) // solo el simulador de pruebas
        : request({ ...opciones, pfx: cert.pfx, passphrase: cert.clave, ca }, alResponder);
    req.on('timeout', () => req.destroy(new ErrorSifen('Tiempo de espera agotado con SIFEN', true)));
    req.on('error', (e) => reject(e instanceof ErrorSifen ? e : new ErrorSifen(`Sin conexión con SIFEN: ${e.message}`, true)));
    req.end(datos);
  });
  const doc = new DOMParser().parseFromString(texto, 'text/xml');
  const falla = primero(doc, 'Fault');
  if (falla) throw new ErrorSifen(`SIFEN: ${texto_(falla, 'Text') ?? texto_(falla, 'Reason') ?? 'error SOAP'}`, false);
  return doc;
}

function primero(doc: Document | Element, nombre: string): Element | null {
  return (doc.getElementsByTagNameNS('*', nombre)[0] as Element | undefined) ?? null;
}
function todos(doc: Document | Element, nombre: string): Element[] {
  return Array.from(doc.getElementsByTagNameNS('*', nombre) as unknown as ArrayLike<Element>);
}
function texto_(doc: Document | Element, nombre: string): string | null {
  return primero(doc, nombre)?.textContent?.trim() ?? null;
}

export interface ResultadoDe {
  cdc: string;
  estado: 'Aprobado' | 'Aprobado con observación' | 'Rechazado' | string;
  protocolo: string | null;
  mensajes: { codigo: string; mensaje: string }[];
}

function resultadosDe(nodos: Element[]): ResultadoDe[] {
  return nodos.map((n) => ({
    cdc: texto_(n, 'id') ?? '',
    estado: texto_(n, 'dEstRes') ?? '',
    protocolo: texto_(n, 'dProtAut'),
    mensajes: todos(n, 'gResProc').map((g) => ({ codigo: texto_(g, 'dCodRes') ?? '', mensaje: texto_(g, 'dMsgRes') ?? '' })),
  }));
}

/** Envía hasta 50 DE firmados del mismo tipo en un lote comprimido. */
export async function enviarLote(ambiente: Ambiente, id: number, xmls: string[], cert: Certificado) {
  if (xmls.length === 0 || xmls.length > 50) throw new Error('Un lote lleva de 1 a 50 documentos');
  const lote = `<?xml version="1.0" encoding="UTF-8"?><rLoteDE>${xmls.map(sinDeclaracion).join('')}</rLoteDE>`;
  const zip = Buffer.from(zipSync({ 'lote.xml': strToU8(lote) })).toString('base64');
  const doc = await enviar(ambiente, RUTAS.lote, `<rEnvioLote xmlns="${NS}"><dId>${id}</dId><xDE>${zip}</xDE></rEnvioLote>`, cert);
  return {
    codigo: texto_(doc, 'dCodRes') ?? '',
    mensaje: texto_(doc, 'dMsgRes') ?? '',
    protocolo: texto_(doc, 'dProtConsLote'),
    tiempoProceso: Number(texto_(doc, 'dTpoProces') ?? 0),
  };
}

/** Resultado de un lote: 0360 inexistente, 0361 en procesamiento, 0362 concluido. */
export async function consultarLote(ambiente: Ambiente, id: number, protocolo: string, cert: Certificado) {
  const doc = await enviar(ambiente, RUTAS.resultadoLote, `<rEnviConsLoteDe xmlns="${NS}"><dId>${id}</dId><dProtConsLote>${protocolo}</dProtConsLote></rEnviConsLoteDe>`, cert);
  return {
    codigo: texto_(doc, 'dCodResLot') ?? '',
    mensaje: texto_(doc, 'dMsgResLot') ?? '',
    resultados: resultadosDe(todos(doc, 'gResProcLote')),
  };
}

export async function consultarDe(ambiente: Ambiente, id: number, cdc: string, cert: Certificado) {
  const doc = await enviar(ambiente, RUTAS.consultaDe, `<rEnviConsDeRequest xmlns="${NS}"><dId>${id}</dId><dCDC>${cdc}</dCDC></rEnviConsDeRequest>`, cert);
  return { codigo: texto_(doc, 'dCodRes') ?? '', mensaje: texto_(doc, 'dMsgRes') ?? '' };
}

export async function consultarRuc(ambiente: Ambiente, id: number, ruc: string, cert: Certificado) {
  const doc = await enviar(ambiente, RUTAS.consultaRuc, `<rEnviConsRUC xmlns="${NS}"><dId>${id}</dId><dRUCCons>${ruc}</dRUCCons></rEnviConsRUC>`, cert);
  return {
    codigo: texto_(doc, 'dCodRes') ?? '',
    mensaje: texto_(doc, 'dMsgRes') ?? '',
    razonSocial: texto_(doc, 'dRazCons'),
    estado: texto_(doc, 'dDesEstCons'),
    facturadorElectronico: texto_(doc, 'dRUCFactElec') === 'S',
  };
}

/** Envía un evento (cancelación, inutilización…): el sobre SOAP completo con rEve ya firmado. */
export async function enviarEvento(ambiente: Ambiente, sobreFirmado: string, cert: Certificado) {
  const doc = await enviar(ambiente, RUTAS.evento, sobreFirmado, cert, 60000, true);
  const nodos = todos(doc, 'gResProcEVe').length ? todos(doc, 'gResProcEVe') : todos(doc, 'gResProcEve');
  return resultadosDe(nodos);
}
