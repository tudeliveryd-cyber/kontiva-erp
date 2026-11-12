import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEmpresa, crearUsuario, http, iniciarApp, type EmpresaPrueba } from './ayudas';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const filas = (lista: Record<string, unknown>[]) => lista.map((valores, i) => ({ fila: i + 2, valores }));

describe('Importación desde planilla', () => {
  let app: INestApplication;
  let e: EmpresaPrueba;
  let h: { Authorization: string };
  let depositoId: string;
  const importar = (cuerpo: Record<string, unknown>, token = e.propietario.token) => http(app).post('/api/importaciones/productos').set(auth(token)).send(cuerpo);

  beforeAll(async () => {
    app = await iniciarApp();
    e = await crearEmpresa(app);
    h = auth(e.propietario.token);
    depositoId = (await http(app).get('/api/depositos').set(h).expect(200)).body[0].id;
  });
  afterAll(() => app.close());

  const planilla = filas([
    { nombre: 'Coca-Cola 2 L', codigo: '7894900011517', categoria: 'Bebidas', precio: '13.500', costo: '9.000', iva: '10%', stock: '24' },
    { nombre: 'Arroz 1 kg', codigo: 7840118210011, categoria: 'Almacén', precio: 9500, iva: '10', stock: 40 },
    { nombre: 'Remera', variante: 'Talle M', sku: 'REM-M', categoria: 'Ropa', precio: '65.000', stock: '5' },
    { nombre: 'Remera', variante: 'Talle L', sku: 'REM-L', categoria: 'Ropa', precio: '65.000', stock: '3' },
    { nombre: 'Queso Paraguay', precio: '42.000', unidad: 'kilo', iva: '5', stock: '2,5' },
  ]);

  it('simular no escribe nada y muestra qué haría', async () => {
    const r = await importar({ simular: true, depositoId, filas: planilla }).expect(200);
    expect(r.body.resumen).toEqual({ crear: 5, actualizar: 0, errores: 0, stock: 5 });
    const lista = await http(app).get('/api/productos').set(h).expect(200);
    expect(lista.body.total).toBe(0);
  });

  it('importa productos, variantes, categorías, precios y stock', async () => {
    const r = await importar({ simular: false, depositoId, filas: planilla }).expect(200);
    expect(r.body.resumen).toMatchObject({ crear: 5, errores: 0 });
    const lista = await http(app).get('/api/productos').set(h).expect(200);
    expect(lista.body.total).toBe(4); // la remera con 2 variantes es un solo producto
    const remera = lista.body.items.find((p: { nombre: string }) => p.nombre === 'Remera');
    expect(remera.variantes.map((v: { nombre: string; precio: string }) => [v.nombre, v.precio])).toEqual([['Talle M', '65000.00'], ['Talle L', '65000.00']]);
    const queso = lista.body.items.find((p: { nombre: string }) => p.nombre === 'Queso Paraguay');
    expect(queso).toMatchObject({ unidad: 'kg', tasaIva: 5 });
    const stock = await http(app).get(`/api/stock?depositoId=${depositoId}`).set(h).expect(200);
    const cant = Object.fromEntries(stock.body.map((s: { descripcion: string; cantidad: string }) => [s.descripcion, Number(s.cantidad)]));
    expect(cant).toMatchObject({ 'Coca-Cola 2 L': 24, 'Arroz 1 kg': 40, 'Remera · Talle M': 5, 'Queso Paraguay': 2.5 });
    const cats = await http(app).get('/api/categorias').set(h).expect(200);
    expect(cats.body.map((c: { nombre: string }) => c.nombre).sort()).toEqual(['Almacén', 'Bebidas', 'Ropa']);
  });

  it('reimportar la misma planilla actualiza, no duplica', async () => {
    const cambiada = filas([
      { nombre: 'Coca-Cola 2 L', codigo: '7894900011517', precio: '14.000', stock: '20' },
      { nombre: 'Remera', variante: 'Talle M', sku: 'rem-m', precio: '70.000' },
      { nombre: 'Remera', variante: 'Talle XL', precio: '70.000' },
    ]);
    const r = await importar({ simular: false, depositoId, filas: cambiada }).expect(200);
    expect(r.body.resumen).toMatchObject({ crear: 1, actualizar: 2 });
    expect(r.body.filas[0].stock).toEqual({ antes: '24.0000', despues: '20.0000' });
    const lista = await http(app).get('/api/productos?q=Remera').set(h).expect(200);
    expect(lista.body.total).toBe(1);
    expect(lista.body.items[0].variantes.map((v: { nombre: string }) => v.nombre).sort()).toEqual(['Talle L', 'Talle M', 'Talle XL']);
    // La planilla no traía IVA ni categoría: se conservan.
    const queso = filas([{ nombre: 'Queso Paraguay', precio: '45.000' }]);
    await importar({ simular: false, filas: queso }).expect(200);
    const q = await http(app).get('/api/productos?q=Queso').set(h).expect(200);
    expect(q.body.items[0]).toMatchObject({ tasaIva: 5, unidad: 'kg' });
    const coca = await http(app).get('/api/productos?q=7894900011517').set(h).expect(200);
    expect(coca.body.items[0].variantes[0].precio).toBe('14000.00');
  });

  it('con un solo error no importa nada y dice qué fila corregir', async () => {
    const mala = filas([
      { nombre: 'Fideos', precio: '6.000' },
      { nombre: 'Aceite', precio: 'consultar' },
      { nombre: 'Sal', codigo: 'X!', precio: 3000 },
      { nombre: 'Fideos', precio: '6.500' },
    ]);
    const r = await importar({ simular: false, filas: mala }).expect(400);
    expect(r.body.codigo).toBe('IMPORTACION_CON_ERRORES');
    const porFila = Object.fromEntries(r.body.detalle.filas.map((f: { fila: number; errores: string[] }) => [f.fila, f.errores]));
    expect(porFila[3]).toEqual(['Precio inválido: "consultar"']);
    expect(porFila[4]).toEqual(['Código de barras inválido: "X!"']);
    expect(porFila[5]).toEqual(['Producto repetido (fila 2)']);
    const lista = await http(app).get('/api/productos?q=Fideos').set(h).expect(200);
    expect(lista.body.total).toBe(0);
  });

  it('un código que ya usa otra variante es un error de esa fila', async () => {
    // "Remera · Talle XL" toma por nombre la variante existente, pero trae el código de la Coca-Cola.
    const r = await importar({ simular: true, filas: filas([{ nombre: 'Remera', variante: 'Talle XL', codigo: '7894900011517', precio: 1 }]) }).expect(200);
    expect(r.body.filas[0].errores).toEqual(['El código o SKU pertenece a otro producto que el nombre "Remera · Talle XL"']);
  });

  it('stock sin depósito o costos sin permiso son errores generales', async () => {
    const r = await importar({ simular: true, filas: filas([{ nombre: 'X', precio: 1, stock: 3 }]) }).expect(200);
    expect(r.body.globales).toContain('Elija el depósito donde cargar el stock');
    const s = await crearUsuario(app, e, 'stock');
    const r2 = await importar({ simular: true, depositoId, filas: filas([{ nombre: 'Y', precio: 1, costo: 1 }]) }, s.token).expect(200);
    expect(r2.body.globales[0]).toMatch(/costos/);
  });

  it('importa clientes y empareja por RUC o cédula', async () => {
    const c = (lista: Record<string, unknown>[], simular = false) => http(app).post('/api/importaciones/clientes').set(h).send({ simular, filas: filas(lista) });
    await c([{ nombre: 'Ana Benítez', documento: '4.512.336', telefono: 981123456 }, { nombre: 'Ferretería Sur S.A.', documento: '1234567-9' }]).expect(200);
    const r = await c([{ nombre: 'Ana B. Benítez', documento: '4512336' }, { nombre: 'Nuevo', documento: '1234567-8' }]).expect(400);
    expect(r.body.detalle.filas[1].errores[0]).toMatch(/dígito verificador/);
    const ok = await c([{ nombre: 'Ana B. Benítez', documento: '4512336' }]).expect(200);
    expect(ok.body.resumen).toMatchObject({ actualizar: 1, crear: 0 });
    const lista = await http(app).get('/api/clientes?q=4512336').set(h).expect(200);
    expect(lista.body).toHaveLength(1);
    expect(lista.body[0]).toMatchObject({ nombre: 'Ana B. Benítez', telefono: '981123456' });
  });

  it('1.000 filas en una sola importación', async () => {
    const muchas = filas(Array.from({ length: 1000 }, (_, i) => ({ nombre: `Artículo ${i}`, codigo: String(7790000000000 + i), precio: 1000 + i, stock: i % 50 })));
    const t = Date.now();
    const r = await importar({ simular: false, depositoId, filas: muchas }).expect(200);
    expect(r.body.resumen.crear).toBe(1000);
    expect(Date.now() - t).toBeLessThan(30000);
  }, 60000);
});
