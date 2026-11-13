import type { DocumentoTicket } from '@kontiva/shared';
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pulsoCajon, renderizar } from './escpos';
import { describir, enviar, type ConfigImpresora } from './impresora';

export const VERSION = '0.1.0';

export interface ConfigAgente {
  puerto: number;
  /** Clave que se carga en el PDV para emparejarlo con este equipo. */
  token: string;
  /** Orígenes permitidos (la dirección del ERP). Vacío: cualquiera con la clave. */
  origenes: string[];
  impresora: ConfigImpresora;
  /** Columnas del papel: 48 para 80 mm, 32 para 58 mm. */
  ancho: number;
}

const LIMITE = 256 * 1024;

function leerCuerpo(req: IncomingMessage): Promise<unknown> {
  return new Promise((ok, mal) => {
    let largo = 0;
    const partes: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      largo += c.length;
      if (largo > LIMITE) {
        mal(new Error('El documento es demasiado grande'));
        req.destroy();
      } else partes.push(c);
    });
    req.on('end', () => {
      try {
        ok(partes.length ? JSON.parse(Buffer.concat(partes).toString('utf8')) : {});
      } catch {
        mal(new Error('JSON inválido'));
      }
    });
    req.on('error', mal);
  });
}

const igual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function documentoValido(d: unknown): d is DocumentoTicket {
  if (!d || typeof d !== 'object' || !Array.isArray((d as DocumentoTicket).bloques)) return false;
  const tipos = new Set(['texto', 'fila', 'linea', 'qr', 'espacio']);
  return (d as DocumentoTicket).bloques.length <= 2000 && (d as DocumentoTicket).bloques.every((b) => b && typeof b === 'object' && tipos.has((b as { t: string }).t));
}

/**
 * Servidor local (solo 127.0.0.1). La web del PDV lo llama con la clave del equipo.
 * Responde la verificación de "red privada" de Chrome para que una página https pueda usarlo.
 */
export function crearServidor(config: ConfigAgente): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const origen = req.headers.origin;
    const permitido = !origen || !config.origenes.length || config.origenes.includes(origen);
    const responder = (estado: number, cuerpo: unknown) => {
      if (origen && permitido) {
        res.setHeader('Access-Control-Allow-Origin', origen);
        res.setHeader('Vary', 'Origin');
      }
      res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(cuerpo));
    };
    if (req.method === 'OPTIONS') {
      if (origen && permitido) {
        res.setHeader('Access-Control-Allow-Origin', origen);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Agente-Token');
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        res.setHeader('Access-Control-Max-Age', '600');
      }
      res.writeHead(permitido ? 204 : 403).end();
      return;
    }
    if (!permitido) return responder(403, { codigo: 'ORIGEN', mensaje: 'Origen no autorizado en este agente' });
    const ruta = (req.url ?? '/').split('?')[0];
    if (req.method === 'GET' && ruta === '/salud') return responder(200, { ok: true, agente: 'kontiva', version: VERSION });
    const token = req.headers['x-agente-token'];
    if (typeof token !== 'string' || !igual(token, config.token)) return responder(401, { codigo: 'CLAVE', mensaje: 'Clave del agente incorrecta' });

    void (async () => {
      try {
        if (req.method === 'GET' && ruta === '/estado') return responder(200, { version: VERSION, impresora: describir(config.impresora), ancho: config.ancho });
        if (req.method === 'POST' && ruta === '/imprimir') {
          const cuerpo = (await leerCuerpo(req)) as { documento?: unknown };
          if (!documentoValido(cuerpo.documento)) return responder(400, { codigo: 'DOCUMENTO', mensaje: 'Documento de ticket inválido' });
          await enviar(config.impresora, renderizar(cuerpo.documento, config.ancho));
          return responder(200, { ok: true });
        }
        if (req.method === 'POST' && ruta === '/cajon') {
          await enviar(config.impresora, pulsoCajon());
          return responder(200, { ok: true });
        }
        if (req.method === 'POST' && ruta === '/prueba') {
          await enviar(
            config.impresora,
            renderizar(
              {
                bloques: [
                  { t: 'texto', v: 'KONTIVA ERP', alinear: 'centro', negrita: true, grande: true },
                  { t: 'texto', v: 'Prueba de impresión', alinear: 'centro' },
                  { t: 'linea' },
                  { t: 'fila', izq: 'Tildes y eñes: áéíóú ñ Ñ ¿?', der: 'OK' },
                  { t: 'fila', izq: 'Ancho del papel', der: `${config.ancho} col.` },
                  { t: 'linea' },
                  { t: 'qr', v: 'https://araujotechsistemas.com' },
                  { t: 'texto', v: 'KONTIVA ERP · Desarrollado por Araújo Tech Sistemas', alinear: 'centro' },
                ],
              },
              config.ancho,
            ),
          );
          return responder(200, { ok: true });
        }
        return responder(404, { codigo: 'RUTA', mensaje: 'Ruta inexistente' });
      } catch (e) {
        return responder(502, { codigo: 'IMPRESORA', mensaje: (e as Error).message });
      }
    })();
  });
}
