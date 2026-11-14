import { execFile } from 'node:child_process';
import { createReadStream, open, write } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { isatty, ReadStream as LectorTty } from 'node:tty';
import type { Readable } from 'node:stream';

/**
 * Balanza conectada a la computadora de la caja.
 *  - serie: cable RS-232 o adaptador USB-serie (COM3 en Windows, /dev/ttyUSB0 en Linux).
 *  - red: balanza con Ethernet (dirección y puerto que indica el manual).
 *  - prueba: peso fijo, para probar el PDV sin balanza.
 * Protocolo:
 *  - pedido (por omisión): el agente envía ENQ (0x05) y la balanza responde el peso (Toledo, Filizola, Urano y la
 *    mayoría de las balanzas de mostrador en modo "comunicación con PDV").
 *  - continuo: la balanza transmite el peso todo el tiempo; se toma la primera lectura posterior al pedido.
 * Decimales: si la balanza envía el peso sin punto (por ejemplo 01234), cuántos dígitos son decimales (3: gramos).
 */
export type ConfigBalanza =
  | { tipo: 'serie'; puerto: string; baudios?: number; protocolo?: 'pedido' | 'continuo'; decimales?: number }
  | { tipo: 'red'; host: string; puerto: number; protocolo?: 'pedido' | 'continuo'; decimales?: number }
  | { tipo: 'prueba'; kg: string };

export type Lectura = { kg: string; estable: boolean };

export class ErrorBalanza extends Error {}

export function describirBalanza(c: ConfigBalanza | undefined): string | null {
  if (!c) return null;
  switch (c.tipo) {
    case 'serie':
      return `Balanza en ${c.puerto} (${c.baudios ?? 9600} baudios)`;
    case 'red':
      return `Balanza de red ${c.host}:${c.puerto}`;
    case 'prueba':
      return 'Balanza de prueba (peso fijo)';
  }
}

const ENQ = 0x05;

/**
 * Interpreta una trama de la balanza. Acepta los formatos habituales: "  1.234", "01234" (sin punto),
 * "ST,GS,+0001.234kg" / "US,GS,…" (estable / inestable), y las señales de las balanzas de PDV: IIIII (peso
 * inestable), NNNNN (negativo) y SSSSS (sobrecarga). Devuelve null si la trama no trae un peso.
 */
export function interpretarTrama(trama: string, decimales = 3): Lectura | null {
  // eslint-disable-next-line no-control-regex
  const t = trama.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (!t) return null;
  if (/I{3,}/.test(t)) throw new ErrorBalanza('El peso todavía no está estable: espere y lea de nuevo');
  if (/N{3,}/.test(t)) throw new ErrorBalanza('La balanza marca un peso negativo: revise la tara');
  if (/S{3,}/.test(t) && !/^ST\b/.test(t)) throw new ErrorBalanza('La balanza está en sobrecarga');
  const m = t.match(/([-+])?\s*(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = m[2]!;
  let kg = /[.,]/.test(n) ? Number(n.replace(',', '.')) : Number(n) / 10 ** decimales;
  if (m[1] === '-') kg = -kg;
  if (!Number.isFinite(kg)) return null;
  if (kg < 0) throw new ErrorBalanza('La balanza marca un peso negativo: revise la tara');
  return { kg: kg.toFixed(3), estable: !/^US\b/i.test(t) && !t.includes('?') };
}

const ejecutar = (cmd: string, args: string[]) =>
  new Promise<void>((ok, mal) => execFile(cmd, args, { timeout: 10000, windowsHide: true }, (e, _o, err) => (e ? mal(new Error(err?.toString().trim() || e.message)) : ok())));

/** Conexión persistente con la balanza: un solo lector abierto; cada pedido espera la trama siguiente. */
export class LectorBalanza {
  private canal: { escribir: (b: Buffer) => void; cerrar: () => void } | null = null;
  private abriendo: Promise<void> | null = null;
  private resto = '';
  private esperando: { ok: (t: string) => void; mal: (e: Error) => void }[] = [];

  constructor(private readonly config: ConfigBalanza) {}

  private recibir(datos: Buffer) {
    this.resto += datos.toString('latin1');
    if (this.resto.length > 4096) this.resto = this.resto.slice(-512);
    // Fin de trama: ETX, CR o LF.
    const partes = this.resto.split(/[\x03\r\n]/);
    this.resto = partes.pop() ?? '';
    for (const p of partes) {
      if (!p.replace(/[\x00-\x1f]/g, '').trim()) continue;
      for (const e of this.esperando.splice(0)) e.ok(p);
    }
  }

  private fallar(e: Error) {
    this.canal = null;
    for (const x of this.esperando.splice(0)) x.mal(e);
  }

  private conectar(): Promise<void> {
    if (this.canal) return Promise.resolve();
    if (this.abriendo) return this.abriendo;
    const c = this.config;
    this.abriendo = (async () => {
      if (c.tipo === 'red') {
        await new Promise<void>((ok, mal) => {
          const s: Socket = connect({ host: c.host, port: c.puerto });
          s.setTimeout(5000, () => s.destroy(new Error(`La balanza ${c.host} no responde`)));
          s.once('connect', () => {
            s.setTimeout(0);
            this.canal = { escribir: (b) => s.write(b), cerrar: () => s.destroy() };
            ok();
          });
          s.on('data', (d: Buffer) => this.recibir(d));
          s.on('error', (e) => (this.canal ? this.fallar(new ErrorBalanza(`Balanza: ${e.message}`)) : mal(new ErrorBalanza(`No se pudo conectar con la balanza ${c.host}: ${e.message}`))));
          s.on('close', () => this.fallar(new ErrorBalanza('Se perdió la conexión con la balanza')));
        });
      } else if (c.tipo === 'serie') {
        const baudios = String(c.baudios ?? 9600);
        const windows = process.platform === 'win32';
        const ruta = windows ? `\\\\.\\${c.puerto}` : c.puerto;
        try {
          if (windows) await ejecutar('mode', [`${c.puerto}:`, `BAUD=${baudios}`, 'PARITY=N', 'DATA=8', 'STOP=1', 'TO=OFF', 'DTR=ON', 'RTS=ON']);
          else await ejecutar('stty', ['-F', c.puerto, baudios, 'raw', '-echo', 'cs8', '-cstopb', '-parenb']);
        } catch (e) {
          throw new ErrorBalanza(`No se pudo configurar el puerto ${c.puerto}: ${(e as Error).message}`);
        }
        const fd = await new Promise<number>((ok, mal) => open(ruta, 'r+', (e, f) => (e ? mal(new ErrorBalanza(`No se pudo abrir el puerto ${c.puerto}: ${e.message}`)) : ok(f))));
        // En Linux el puerto es una terminal: lectura sin bloquear. En Windows (COM), lectura de archivo.
        const lector: Readable = !windows && isatty(fd) ? new LectorTty(fd) : createReadStream('', { fd, autoClose: true, highWaterMark: 64 });
        lector.on('data', (d) => this.recibir(d as Buffer));
        lector.on('error', (e) => this.fallar(new ErrorBalanza(`Puerto ${c.puerto}: ${e.message}`)));
        lector.on('close', () => this.fallar(new ErrorBalanza(`Se cerró el puerto ${c.puerto}`)));
        this.canal = { escribir: (b) => write(fd, b, () => undefined), cerrar: () => lector.destroy() };
      }
    })().finally(() => {
      this.abriendo = null;
    });
    return this.abriendo;
  }

  async leer(espera = 2500): Promise<Lectura> {
    const c = this.config;
    if (c.tipo === 'prueba') return { kg: Number(c.kg).toFixed(3), estable: true };
    await this.conectar();
    const decimales = c.decimales ?? 3;
    const continuo = c.protocolo === 'continuo';
    // En modo continuo se descarta la trama a medias y se espera una completa nueva.
    if (continuo) this.resto = '';
    const fin = Date.now() + espera;
    for (;;) {
      const restante = fin - Date.now();
      if (restante <= 0) throw new ErrorBalanza('La balanza no respondió: revise el cable, el puerto y que esté en modo de comunicación con PDV');
      const trama = await new Promise<string>((ok, mal) => {
        const t = setTimeout(() => {
          this.esperando = this.esperando.filter((x) => x !== pedido);
          ok('');
        }, restante);
        const pedido = { ok: (v: string) => (clearTimeout(t), ok(v)), mal: (e: Error) => (clearTimeout(t), mal(e)) };
        this.esperando.push(pedido);
        if (!continuo) this.canal?.escribir(Buffer.from([ENQ]));
      });
      if (!trama) continue;
      const l = interpretarTrama(trama, decimales);
      if (l) return l;
    }
  }

  cerrar() {
    this.canal?.cerrar();
    this.canal = null;
  }
}
