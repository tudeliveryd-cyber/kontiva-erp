import { execFile } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Cómo llega el ticket a la impresora:
 *  - red: impresora con Ethernet/Wi-Fi en el puerto 9100 (la más común en comercios).
 *  - windows: impresora USB instalada y compartida en Windows (se envía en bruto a \\localhost\NOMBRE).
 *  - cups: impresora instalada en Linux o macOS (lp en modo raw).
 *  - archivo: dispositivo directo, por ejemplo /dev/usb/lp0 o COM3.
 *  - prueba: guarda el último trabajo en memoria (pruebas y demostración).
 */
export type ConfigImpresora =
  | { tipo: 'red'; host: string; puerto?: number }
  | { tipo: 'windows'; nombre: string }
  | { tipo: 'cups'; nombre: string }
  | { tipo: 'archivo'; ruta: string }
  | { tipo: 'prueba' };

export const trabajosDePrueba: Buffer[] = [];

export function describir(c: ConfigImpresora): string {
  switch (c.tipo) {
    case 'red':
      return `Impresora de red ${c.host}:${c.puerto ?? 9100}`;
    case 'windows':
      return `Impresora de Windows "${c.nombre}"`;
    case 'cups':
      return `Impresora "${c.nombre}"`;
    case 'archivo':
      return `Dispositivo ${c.ruta}`;
    case 'prueba':
      return 'Impresora de prueba (sin papel)';
  }
}

const ejecutar = (cmd: string, args: string[]) =>
  new Promise<void>((ok, mal) => execFile(cmd, args, { timeout: 15000, windowsHide: true }, (e, _o, err) => (e ? mal(new Error(err?.toString().trim() || e.message)) : ok())));

async function porArchivoTemporal(datos: Buffer, fn: (ruta: string) => Promise<void>) {
  const ruta = join(tmpdir(), `kontiva-${process.pid}-${Date.now()}.bin`);
  await writeFile(ruta, datos);
  try {
    await fn(ruta);
  } finally {
    await unlink(ruta).catch(() => undefined);
  }
}

export async function enviar(c: ConfigImpresora, datos: Buffer): Promise<void> {
  switch (c.tipo) {
    case 'prueba':
      trabajosDePrueba.push(datos);
      return;
    case 'red':
      return new Promise((ok, mal) => {
        const s = connect({ host: c.host, port: c.puerto ?? 9100 });
        s.setTimeout(8000, () => s.destroy(new Error(`La impresora ${c.host} no responde`)));
        s.on('error', (e) => mal(new Error(`No se pudo conectar con la impresora ${c.host}: ${e.message}`)));
        s.on('connect', () => s.end(datos));
        s.on('close', (conError) => !conError && ok());
      });
    case 'archivo':
      await writeFile(c.ruta, datos);
      return;
    case 'windows':
      return porArchivoTemporal(datos, (ruta) => ejecutar('cmd.exe', ['/c', 'copy', '/b', ruta, `\\\\localhost\\${c.nombre}`]));
    case 'cups':
      return porArchivoTemporal(datos, (ruta) => ejecutar('lp', ['-d', c.nombre, '-o', 'raw', ruta]));
  }
}
