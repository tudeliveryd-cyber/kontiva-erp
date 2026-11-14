import type { INestApplication } from '@nestjs/common';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEmpresa, crearUsuario, http, iniciarApp, prepararVenta, type EmpresaPrueba } from './ayudas';

type Response = { on: (ev: string, f: (c: Buffer) => void) => void };

const binario = (res: Response, cb: (err: Error | null, body: Buffer) => void) => {
  const partes: Buffer[] = [];
  res.on('data', (c: Buffer) => partes.push(c));
  res.on('end', () => cb(null, Buffer.concat(partes)));
};

describe('Exportación de datos de la empresa', () => {
  let app: INestApplication;
  let a: EmpresaPrueba;
  let b: EmpresaPrueba;
  let ventaA = '';

  beforeAll(async () => {
    app = await iniciarApp();
    a = await crearEmpresa(app);
    b = await crearEmpresa(app);
    ventaA = (await prepararVenta(app, a)).ventaId;
    await prepararVenta(app, b);
    await http(app).post('/api/productos').set({ Authorization: `Bearer ${b.propietario.token}` }).send({ nombre: 'Producto secreto de B', tasaIva: 10, variantes: [{ precio: 1000, codigos: [] }] }).expect(201);
  });
  afterAll(() => app.close());

  it('el propietario descarga un ZIP con un CSV por tabla, solo de su empresa y sin secretos', async () => {
    const r = await http(app).get('/api/empresa/exportar').set({ Authorization: `Bearer ${a.propietario.token}` }).buffer(true).parse(binario).expect(200);
    expect(r.headers['content-type']).toBe('application/zip');
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="kontiva-.+\.zip"/);
    const zip = unzipSync(new Uint8Array(r.body as Buffer));
    const archivos = Object.keys(zip);
    expect(archivos).toEqual(expect.arrayContaining(['LEEME.txt', 'manifiesto.json', 'empresa.csv', 'venta.csv', 'venta_item.csv', 'producto.csv', 'usuario.csv', 'auditoria.csv']));
    for (const t of ['sesion.csv', 'token_cuenta.csv', 'codigo_respaldo.csv']) expect(archivos).not.toContain(t);

    const manifiesto = JSON.parse(strFromU8(zip['manifiesto.json']!));
    expect(manifiesto.tablas.find((t: { tabla: string }) => t.tabla === 'venta').filas).toBe(1);
    const venta = strFromU8(zip['venta.csv']!);
    expect([...zip['venta.csv']!.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM: Excel abre los acentos bien
    expect(venta).toContain(ventaA);
    expect(venta.split('\r\n')[0]).not.toContain('clave_idempotencia');

    // Nada de la otra empresa; nada de secretos.
    const todo = Object.entries(zip).filter(([n]) => n.endsWith('.csv')).map(([, c]) => strFromU8(c)).join('\n');
    expect(todo).not.toContain('Producto secreto de B');
    expect(todo).not.toContain(b.empresaId);
    expect(strFromU8(zip['usuario.csv']!).split('\r\n')[0]).not.toMatch(/hash/);
    if (zip['fe_configuracion.csv']) expect(strFromU8(zip['fe_configuracion.csv']).split('\r\n')[0]).not.toMatch(/cifrad|certificado_clave/);

    const aud = await http(app).get('/api/auditoria?entidad=empresa').set({ Authorization: `Bearer ${a.propietario.token}` });
    if (aud.status === 200) expect(JSON.stringify(aud.body)).toContain('exportar');
  });

  it('nadie más que el propietario puede exportar', async () => {
    const gerente = await crearUsuario(app, a, 'gerente');
    await http(app).get('/api/empresa/exportar').set({ Authorization: `Bearer ${gerente.token}` }).expect(403);
    await http(app).get('/api/empresa/exportar').expect(401);
  });
});
