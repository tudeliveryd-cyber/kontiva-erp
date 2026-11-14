import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEmpresa, crearUsuario, http, iniciarApp, prepararVenta, unico, type EmpresaPrueba } from './ayudas';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());

/**
 * Ventas del día (precio 11.000, costo 7.000, IVA incluido):
 * 1 en efectivo exacto (prepararVenta), 2 a crédito (22.000), 1 en efectivo con 50.000 y vuelto 39.000, 1 con tarjeta.
 * Total 55.000 en 4 ventas; costo 35.000; margen 20.000 (36,4 %).
 */
describe('Tablero e informes', () => {
  let app: INestApplication;
  let e: EmpresaPrueba;
  let h: { Authorization: string };
  let base: Awaited<ReturnType<typeof prepararVenta>>;
  const q = `desde=${hoy()}&hasta=${hoy()}`;

  beforeAll(async () => {
    app = await iniciarApp();
    e = await crearEmpresa(app, 'BUSINESS');
    h = auth(e.propietario.token);
    base = await prepararVenta(app, e, 100);
    const cl = await http(app).post('/api/clientes').set(h).send({ nombre: 'Almacén Central', documento: '2223334', limiteCredito: 500000 }).expect(201);
    await http(app).post('/api/ventas').set(h).send({ claveIdempotencia: unico('in-'), cajaId: base.cajaId, clienteId: cl.body.id, items: [{ varianteId: base.varianteId, cantidad: 2 }], pagos: [], credito: 22000 }).expect(201);
    await http(app).post('/api/ventas').set(h).send({ claveIdempotencia: unico('in-'), cajaId: base.cajaId, items: [{ varianteId: base.varianteId, cantidad: 1 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 50000 }] }).expect(201);
    await http(app).post('/api/ventas').set(h).send({ claveIdempotencia: unico('in-'), cajaId: base.cajaId, items: [{ varianteId: base.varianteId, cantidad: 1 }], pagos: [{ medio: 'tarjeta', moneda: 'PYG', monto: 11000 }] }).expect(201);
    // Stock mínimo de 200 unidades: queda por debajo.
    const p = await http(app).get(`/api/productos/${base.productoId}`).set(h).expect(200);
    const v = p.body.variantes[0];
    await http(app)
      .patch(`/api/productos/${base.productoId}`)
      .set(h)
      .send({ nombre: p.body.nombre, tasaIva: 10, variantes: [{ id: v.id, precio: 11000, costo: 7000, stockMinimo: 200, codigos: v.codigos }] })
      .expect(200);
  });
  afterAll(() => app.close());

  it('tablero: ventas, medios de pago, productos, margen, cajas, cuentas a cobrar y stock bajo', async () => {
    const t = await http(app).get(`/api/tablero?${q}`).set(h).expect(200);
    expect(t.body.ventas).toMatchObject({ cantidad: 4, total: '55000.00', credito: '22000.00', ticketPromedio: '13750.00' });
    expect(t.body.ventas.anterior).toMatchObject({ cantidad: 0, total: '0.00' });
    expect(t.body.ventas.porMedio).toEqual([
      { medio: 'credito', total: '22000.00' },
      { medio: 'efectivo', total: '22000.00' },
      { medio: 'tarjeta', total: '11000.00' },
    ]);
    expect(t.body.ventas.topProductos[0]).toMatchObject({ cantidad: '5', total: '55000.00', margen: '20000.00' });
    expect(t.body.ventas.porDia).toEqual([{ fecha: hoy(), cantidad: 4, total: '55000.00' }]);
    expect(t.body.ventas.porVendedor).toHaveLength(1);
    expect(t.body.ganancia).toEqual({ ventas: '55000.00', costo: '35000.00', margen: '20000.00', porcentaje: '36.4' });
    expect(t.body.cobrar).toMatchObject({ saldo: '22000.00', vencido: '0.00' });
    expect(t.body.cajas).toMatchObject({ abiertas: 1, efectivo: '122000.00' });
    expect(t.body.stockBajo.cantidad).toBe(1);
    expect(t.body.stockBajo.items[0]).toMatchObject({ cantidad: '95', minimo: '200' });
  });

  it('cada bloque del tablero depende de los permisos del usuario', async () => {
    const caj = await crearUsuario(app, e, 'cajero');
    const t = await http(app).get(`/api/tablero?${q}`).set(auth(caj.token)).expect(200);
    expect(t.body.ventas).toBeUndefined();
    expect(t.body.ganancia).toBeUndefined();
    expect(t.body.pagar).toBeUndefined();
    // Con alcance de sucursal no se pide otra sucursal.
    const ger = await crearUsuario(app, e, 'gerente');
    const g = await http(app).get(`/api/tablero?${q}`).set(auth(ger.token)).expect(200);
    expect(g.body.ventas.total).toBe('55000.00');
    expect(g.body.bancos).toBeUndefined(); // bancos y cuentas a pagar son de toda la empresa
    await http(app).get(`/api/tablero?${q}&sucursalId=00000000-0000-7000-8000-000000000000`).set(auth(ger.token)).expect(404);
    await http(app).get(`/api/tablero?desde=${hoy()}&hasta=2020-01-01`).set(h).expect(400);
  });

  it('informe de ventas agrupado, con margen para quien ve ganancias', async () => {
    const p = await http(app).get(`/api/informes/ventas?${q}&agrupar=producto`).set(h).expect(200);
    expect(p.body.items).toHaveLength(1);
    expect(p.body.items[0]).toMatchObject({ documentos: 4, cantidad: '5', total: '55000.00', costo: '35000.00', margen: '20000.00', porcentaje: '36.4' });
    const c = await http(app).get(`/api/informes/ventas?${q}&agrupar=cliente`).set(h).expect(200);
    expect(c.body.items.map((x: { nombre: string; total: string }) => [x.nombre, x.total])).toEqual([
      ['Consumidor final', '33000.00'],
      ['Almacén Central', '22000.00'],
    ]);
    const d = await http(app).get(`/api/informes/ventas?${q}&agrupar=dia`).set(h).expect(200);
    expect(d.body.totales).toMatchObject({ total: '55000.00', margen: '20000.00' });
    await http(app).get(`/api/informes/ventas?${q}&agrupar=otro`).set(h).expect(400);
    const sup = await crearUsuario(app, e, 'supervisor');
    await http(app).get(`/api/informes/ventas?${q}`).set(auth(sup.token)).expect(403);
  });

  it('informe de stock con valor al costo y solo lo que está bajo el mínimo', async () => {
    const s = await http(app).get('/api/informes/stock').set(h).expect(200);
    expect(s.body.items[0]).toMatchObject({ cantidad: '95', minimo: '200', bajo: true, costo: '7000.00', valor: '665000.00' });
    expect(s.body.totales).toMatchObject({ bajoMinimo: 1, valor: '665000.00' });
    const b = await http(app).get('/api/informes/stock?soloBajo=true').set(h).expect(200);
    expect(b.body.items).toHaveLength(1);
  });

  it('informe de compras por proveedor y por producto', async () => {
    const pv = await http(app).post('/api/proveedores').set(h).send({ nombre: 'Distribuidora Norte' }).expect(201);
    await http(app)
      .post('/api/compras')
      .set(h)
      .send({ proveedorId: pv.body.id, depositoId: base.depositoId, documentoTipo: 'remision', fechaDocumento: hoy(), condicion: 'credito', vencimiento: hoy(), items: [{ varianteId: base.varianteId, cantidad: 10, costoUnitario: 7000 }] })
      .expect(201);
    const c = await http(app).get(`/api/informes/compras?${q}`).set(h).expect(200);
    expect(c.body.items).toEqual([{ clave: pv.body.id, nombre: 'Distribuidora Norte', documentos: 1, cantidad: '1', total: '70000.00' }]);
    const p = await http(app).get(`/api/informes/compras?${q}&agrupar=producto`).set(h).expect(200);
    expect(p.body.items[0]).toMatchObject({ cantidad: '10', total: '70000.00' });
  });
});
