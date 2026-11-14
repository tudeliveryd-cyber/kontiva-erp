import { createServer as crearTcp, type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { interpretarTrama, LectorBalanza } from '../src/balanza';
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

describe('Balanza', () => {
  it('interpreta las tramas habituales de las balanzas de mostrador', () => {
    expect(interpretarTrama('\x02  1.234\x03')).toEqual({ kg: '1.234', estable: true });
    expect(interpretarTrama('\x0201234')).toEqual({ kg: '1.234', estable: true }); // sin punto: gramos
    expect(interpretarTrama('00850', 2)).toEqual({ kg: '8.500', estable: true });
    expect(interpretarTrama('ST,GS,+0002.500kg')).toEqual({ kg: '2.500', estable: true });
    expect(interpretarTrama('US,GS,+0002.480kg')).toEqual({ kg: '2.480', estable: false });
    expect(interpretarTrama('0,750 kg')).toEqual({ kg: '0.750', estable: true });
    expect(() => interpretarTrama('IIIII')).toThrow(/estable/);
    expect(() => interpretarTrama('NNNNN')).toThrow(/negativo/);
    expect(() => interpretarTrama('SSSSS')).toThrow(/sobrecarga/);
    expect(() => interpretarTrama('-0.120')).toThrow(/negativo/);
    expect(interpretarTrama('\x02\x03')).toBeNull();
  });

  // Balanza simulada por red: responde al ENQ como una Toledo en modo PDV.
  async function balanzaSimulada(responder: (pedido: Buffer) => Buffer | null) {
    const srv = crearTcp((s) => s.on('data', (d) => { const r = responder(d); if (r) s.write(r); }));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    return { srv, puerto: (srv.address() as AddressInfo).port };
  }

  it('pide el peso con ENQ por una conexión persistente y avisa si no responde', async () => {
    let pedidos = 0;
    let peso = '01234';
    const { srv, puerto } = await balanzaSimulada((d) => (d[0] === 0x05 ? (pedidos++, Buffer.from(`\x02${peso}\x03`)) : null));
    const lector = new LectorBalanza({ tipo: 'red', host: '127.0.0.1', puerto });
    expect(await lector.leer()).toEqual({ kg: '1.234', estable: true });
    peso = '00500';
    expect(await lector.leer()).toEqual({ kg: '0.500', estable: true });
    expect(pedidos).toBe(2);
    peso = 'IIIII';
    await expect(lector.leer()).rejects.toThrow(/estable/);
    lector.cerrar();
    srv.close();

    const { srv: muda, puerto: p2 } = await balanzaSimulada(() => null);
    const sinRespuesta = new LectorBalanza({ tipo: 'red', host: '127.0.0.1', puerto: p2 });
    await expect(sinRespuesta.leer(300)).rejects.toThrow(/no respondió/);
    sinRespuesta.cerrar();
    muda.close();
  });

  it('modo continuo: toma la primera trama completa después del pedido', async () => {
    const { srv, puerto } = await balanzaSimulada(() => null);
    const clientes: import('node:net').Socket[] = [];
    srv.on('connection', (s) => clientes.push(s));
    const lector = new LectorBalanza({ tipo: 'red', host: '127.0.0.1', puerto, protocolo: 'continuo' });
    const lectura = lector.leer();
    await new Promise((r) => setTimeout(r, 100));
    clientes[0]!.write('0.9');
    clientes[0]!.write('99\r\n 2.250\r\n');
    expect(await lectura).toEqual({ kg: '0.999', estable: true });
    lector.cerrar();
    srv.close();
  });

  it('el agente expone /peso y lo informa en /estado', async () => {
    const config: ConfigAgente = { puerto: 0, token: 'clave-de-prueba-123456', origenes: [], impresora: { tipo: 'prueba' }, ancho: 48, balanza: { tipo: 'prueba', kg: '1.5' } };
    const srv = crearServidor(config);
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const h = { 'X-Agente-Token': config.token };
    expect(await (await fetch(`${url}/peso`, { headers: h })).json()).toEqual({ kg: '1.500', estable: true });
    expect(await (await fetch(`${url}/estado`, { headers: h })).json()).toMatchObject({ balanza: 'Balanza de prueba (peso fijo)' });
    expect((await fetch(`${url}/peso`)).status).toBe(401);
    srv.close();

    const sin = crearServidor({ ...config, balanza: undefined });
    await new Promise<void>((r) => sin.listen(0, '127.0.0.1', r));
    const r = await fetch(`http://127.0.0.1:${(sin.address() as AddressInfo).port}/peso`, { headers: h });
    expect(r.status).toBe(409);
    sin.close();
  });
});
