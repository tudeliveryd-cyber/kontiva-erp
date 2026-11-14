#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { describirBalanza } from './balanza';
import { describir } from './impresora';
import { crearServidor, VERSION, type ConfigAgente } from './servidor';

/**
 * KONTIVA ERP · agente local del PDV.
 * Se instala en la computadora de la caja; la web del PDV le envía los tickets y la orden de abrir el cajón,
 * y le pide el peso de la balanza (opcional: "balanza" en la configuración, ver balanza.ts).
 * La primera vez crea la configuración con una clave nueva, que se carga en el PDV (Impresora).
 */
function rutaConfig(): string {
  if (process.env.KONTIVA_AGENTE_CONFIG) return process.env.KONTIVA_AGENTE_CONFIG;
  const base = process.platform === 'win32' ? (process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')) : join(homedir(), '.config');
  return join(base, 'kontiva-agente', 'config.json');
}

function cargar(): { config: ConfigAgente; ruta: string; nueva: boolean } {
  const ruta = rutaConfig();
  if (!existsSync(ruta)) {
    const config: ConfigAgente = {
      puerto: 9420,
      token: randomBytes(16).toString('hex'),
      origenes: [],
      impresora: { tipo: 'red', host: '192.168.1.100', puerto: 9100 },
      ancho: 48,
    };
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, JSON.stringify(config, null, 2), { mode: 0o600 });
    return { config, ruta, nueva: true };
  }
  return { config: JSON.parse(readFileSync(ruta, 'utf8')) as ConfigAgente, ruta, nueva: false };
}

const { config, ruta, nueva } = cargar();
const servidor = crearServidor(config);
servidor.listen(config.puerto, '127.0.0.1', () => {
  console.log(`KONTIVA ERP · agente local ${VERSION}`);
  console.log(`Escuchando en http://127.0.0.1:${config.puerto}`);
  console.log(`Impresora: ${describir(config.impresora)} · ${config.ancho} columnas`);
  const balanza = describirBalanza(config.balanza);
  if (balanza) console.log(`${balanza} · ${config.balanza?.tipo === 'prueba' ? 'peso fijo' : `protocolo ${config.balanza?.protocolo ?? 'pedido'}`}`);
  console.log(`Configuración: ${ruta}`);
  console.log(`Clave para el PDV: ${config.token}`);
  if (nueva) console.log('Configuración creada: edite la impresora en el archivo y reinicie el agente.');
});
servidor.on('error', (e) => {
  console.error(`No se pudo iniciar el agente: ${(e as Error).message}`);
  process.exit(1);
});
