import { createServer as crearTcp, type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codificar, fila, partir, renderizar } from '../src/escpos';
import { enviar, trabajosDePrueba } from '../src/impresora';
import { crearServidor, type ConfigAgente } from '../src/servidor';

describe('ESC/POS', () => {
  it('codifica el español en PC850', () => {
    expect(codificar('ñÑáéíóú¿º')).toEqual([0xa4, 0xa5, 0xa0, 0x82, 0xa1, 0xa2, 0xa3, 0xa8, 0xa7]);
    expect(codificar('₲')).toEqual([0x3f]);
  });

  it('acomoda filas y renglones al ancho del papel', () => {
    expect(fila('Remera', '11.000', 48)).toEqual(['Remera' + ' '.repeat(48 - 6 - 6) + '11.000']);
    const larga = fila('Remera de algodón peinado talle XL color azul marino', '1.234.000', 32);
    expect(larga.every((r) => r.length <= 32)).toBe(true);
    expect(larga.at(-1)!.endsWith('1.234.000')).toBe(true);
    expect(partir('uno dos tres', 7)).toEqual(['uno dos', 'tres']);
  });

  it('arma el ticket: inicio, página de códigos, QR, corte y cajón', () => {
    const b = renderizar({ bloques: [{ t: 'texto', v: 'Hola', alinear: 'centro', negrita: true }, { t: 'qr', v: 'https://x.py' }], abrirCajon: true }, 48);
    const hex = b.toString('hex');
    expect(hex.startsWith('1b40' + '1b7402')).toBe(true);
    expect(hex).toContain('1d286b0400314132'); // QR modelo 2
    expect(hex).toContain(Buffer.from('https://x.py').toString('hex'));
    expect(hex).toContain('1d564200'); // corte
    expect(hex.endsWith('1b700019fa')).toBe(true); // cajón
  });
});

describe('Impresora de red (puerto 9100)', () => {
  it('envía los bytes por TCP', async () => {
    const recibido: Buffer[] = [];
    const srv = crearTcp((s) => s.on('data', (d) => recibido.push(d)));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const puerto = (srv.address() as AddressInfo).port;
    await enviar({ tipo: 'red', host: '127.0.0.1', puerto }, Buffer.from([1, 2, 3]));
    await new Promise((r) => setTimeout(r, 50));
    srv.close();
    expect(Buffer.concat(recibido)).toEqual(Buffer.from([1, 2, 3]));
    await expect(enviar({ tipo: 'red', host: '127.0.0.1', puerto: 1 }, Buffer.from([1]))).rejects.toThrow(/No se pudo conectar/);
  });
});

describe('Servidor local', () => {
  const config: ConfigAgente = { puerto: 0, token: 'clave-de-prueba-123456', origenes: ['https://erp.ejemplo.py'], impresora: { tipo: 'prueba' }, ancho: 48 };
  const srv = crearServidor(config);
  let url = '';
  beforeAll(async () => {
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });
  afterAll(() => srv.close());
  const origen = { Origin: 'https://erp.ejemplo.py' };

  it('preflight con acceso a red privada para el origen del ERP; otros orígenes no', async () => {
    const r = await fetch(`${url}/imprimir`, { method: 'OPTIONS', headers: { ...origen, 'Access-Control-Request-Private-Network': 'true' } });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-private-network')).toBe('true');
    expect(r.headers.get('access-control-allow-origin')).toBe('https://erp.ejemplo.py');
    const otro = await fetch(`${url}/imprimir`, { method: 'OPTIONS', headers: { Origin: 'https://malicioso.com' } });
    expect(otro.status).toBe(403);
  });

  it('salud sin clave; lo demás exige la clave del equipo', async () => {
    expect(await (await fetch(`${url}/salud`, { headers: origen })).json()).toMatchObject({ ok: true, agente: 'kontiva' });
    expect((await fetch(`${url}/estado`, { headers: origen })).status).toBe(401);
    const e = await fetch(`${url}/estado`, { headers: { ...origen, 'X-Agente-Token': config.token } });
    expect(await e.json()).toMatchObject({ impresora: 'Impresora de prueba (sin papel)', ancho: 48 });
  });

  it('imprime el documento, abre el cajón y rechaza documentos inválidos', async () => {
    const h = { ...origen, 'X-Agente-Token': config.token, 'Content-Type': 'application/json' };
    const antes = trabajosDePrueba.length;
    const r = await fetch(`${url}/imprimir`, { method: 'POST', headers: h, body: JSON.stringify({ documento: { bloques: [{ t: 'texto', v: 'Venta N.º 1' }], abrirCajon: true } }) });
    expect(r.status).toBe(200);
    expect(trabajosDePrueba.length).toBe(antes + 1);
    expect(trabajosDePrueba.at(-1)!.toString('latin1')).toContain('Venta N');
    expect((await fetch(`${url}/cajon`, { method: 'POST', headers: h })).status).toBe(200);
    expect((await fetch(`${url}/imprimir`, { method: 'POST', headers: h, body: JSON.stringify({ documento: { bloques: [{ t: 'script' }] } }) })).status).toBe(400);
    expect((await fetch(`${url}/prueba`, { method: 'POST', headers: h })).status).toBe(200);
  });
});
