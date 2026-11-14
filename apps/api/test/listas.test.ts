import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEmpresa, crearUsuario, http, iniciarApp, prepararVenta, unico, type EmpresaPrueba } from './ayudas';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Listas de precios', () => {
  let app: INestApplication;
  let e: EmpresaPrueba;
  let h: { Authorization: string };
  let base: Awaited<ReturnType<typeof prepararVenta>>;
  let mayorista: string;
  let sucursal2: string;

  beforeAll(async () => {
    app = await iniciarApp();
    e = await crearEmpresa(app, 'ENTERPRISE');
    h = auth(e.propietario.token);
    base = await prepararVenta(app, e, 50); // precio normal 11.000
    const s2 = await http(app).post('/api/sucursales').set(h).send({ nombre: 'Encarnación', codigo: '002' }).expect(201);
    sucursal2 = s2.body.id;
  });
  afterAll(() => app.close());

  it('crea listas, no repite nombres y no desactiva la predeterminada', async () => {
    const r = await http(app).post('/api/listas-precio').set(h).send({ nombre: 'Mayorista' }).expect(201);
    mayorista = r.body.id;
    expect(r.body.predeterminada).toBe(false);
    await http(app).post('/api/listas-precio').set(h).send({ nombre: 'mayorista' }).expect(409);
    const todas = await http(app).get('/api/listas-precio').set(h).expect(200);
    const pred = todas.body.find((l: { predeterminada: boolean }) => l.predeterminada);
    expect(pred.precios).toBeGreaterThan(0);
    await http(app).patch(`/api/listas-precio/${pred.id}`).set(h).send({ nombre: pred.nombre, activa: false }).expect(400);
  });

  it('ajuste por porcentaje con redondeo a partir del precio normal', async () => {
    const r = await http(app).post(`/api/listas-precio/${mayorista}/ajuste`).set(h).send({ porcentaje: -12, redondeo: 500 }).expect(201);
    expect(r.body.actualizados).toBe(1);
    const p = await http(app).get(`/api/listas-precio/${mayorista}/precios`).set(h).expect(200);
    const it = p.body.items.find((x: { varianteId: string }) => x.varianteId === base.varianteId);
    // 11.000 × 0,88 = 9.680 → múltiplo de 500 más cercano: 9.500
    expect(it).toMatchObject({ normal: '11000.00', especial: '9500.00' });
    const pred = (await http(app).get('/api/listas-precio').set(h)).body.find((l: { predeterminada: boolean }) => l.predeterminada);
    await http(app).post(`/api/listas-precio/${pred.id}/ajuste`).set(h).send({ porcentaje: 10 }).expect(400);
  });

  it('precio por sucursal y precio especial que se quita', async () => {
    await http(app).put(`/api/listas-precio/${mayorista}/precios`).set(h).send({ sucursalId: sucursal2, items: [{ varianteId: base.varianteId, precio: 9000 }] }).expect(200);
    const s = await http(app).get(`/api/listas-precio/${mayorista}/precios?sucursalId=${sucursal2}&soloEspeciales=true`).set(h).expect(200);
    expect(s.body.items).toHaveLength(1);
    expect(s.body.items[0]).toMatchObject({ especial: '9000.00', general: '9500.00' });
    const r = await http(app).put(`/api/listas-precio/${mayorista}/precios`).set(h).send({ sucursalId: sucursal2, items: [{ varianteId: base.varianteId, precio: null }] }).expect(200);
    expect(r.body.cambiados).toBe(1);
    const s2 = await http(app).get(`/api/listas-precio/${mayorista}/precios?sucursalId=${sucursal2}&soloEspeciales=true`).set(h).expect(200);
    expect(s2.body.items).toHaveLength(0);
    // Sin cambios: nada que guardar ni auditar.
    const igual = await http(app).put(`/api/listas-precio/${mayorista}/precios`).set(h).send({ items: [{ varianteId: base.varianteId, precio: 9500 }] }).expect(200);
    expect(igual.body.cambiados).toBe(0);
  });

  it('el precio normal no se puede quitar', async () => {
    const pred = (await http(app).get('/api/listas-precio').set(h)).body.find((l: { predeterminada: boolean }) => l.predeterminada);
    await http(app).put(`/api/listas-precio/${pred.id}/precios`).set(h).send({ items: [{ varianteId: base.varianteId, precio: null }] }).expect(400);
  });

  it('el cliente con lista paga ese precio; el servidor lo decide, no el PDV', async () => {
    const cl = await http(app).post('/api/clientes').set(h).send({ nombre: 'Almacén Don Pedro', listaPrecioId: mayorista }).expect(201);
    expect(cl.body.listaPrecioId).toBe(mayorista);

    const b = await http(app).get(`/api/pdv/buscar?cajaId=${base.cajaId}&q=${base.codigo}&clienteId=${cl.body.id}`).set(h).expect(200);
    expect(b.body.items[0].precio).toBe('9500.00');
    const sin = await http(app).get(`/api/pdv/buscar?cajaId=${base.cajaId}&q=${base.codigo}`).set(h).expect(200);
    expect(sin.body.items[0].precio).toBe('11000.00');

    const pr = await http(app).post('/api/pdv/precios').set(h).send({ cajaId: base.cajaId, clienteId: cl.body.id, varianteIds: [base.varianteId] }).expect(200);
    expect(pr.body).toEqual({ lista: { id: mayorista, nombre: 'Mayorista' }, precios: { [base.varianteId]: '9500.00' } });

    // Pagando el precio normal con cliente mayorista el total no coincide: el precio sale de la base.
    const v = await http(app)
      .post('/api/ventas')
      .set(h)
      .send({ claveIdempotencia: unico('lp-'), cajaId: base.cajaId, clienteId: cl.body.id, items: [{ varianteId: base.varianteId, cantidad: 2 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 19000 }] })
      .expect(201);
    expect(v.body.total).toBe('19000.00');
    expect(v.body.items[0].precioUnitario).toBe('9500.00');
  });

  it('lista desactivada: el cliente vuelve al precio normal', async () => {
    await http(app).patch(`/api/listas-precio/${mayorista}`).set(h).send({ nombre: 'Mayorista', activa: false }).expect(200);
    const cls = await http(app).get('/api/clientes?q=Don%20Pedro').set(h).expect(200);
    const b = await http(app).get(`/api/pdv/buscar?cajaId=${base.cajaId}&q=${base.codigo}&clienteId=${cls.body[0].id}`).set(h).expect(200);
    expect(b.body.items[0].precio).toBe('11000.00');
    await http(app).post('/api/clientes').set(h).send({ nombre: 'Otro', listaPrecioId: mayorista }).expect(400);
    await http(app).patch(`/api/listas-precio/${mayorista}`).set(h).send({ nombre: 'Mayorista', activa: true }).expect(200);
  });

  it('cajero: ve listas solo si tiene precio.ver y no puede editarlas', async () => {
    const cajero = await crearUsuario(app, e, 'cajero');
    const { login } = await import('./ayudas');
    const t = (await login(app, cajero.email)).token;
    await http(app).put(`/api/listas-precio/${mayorista}/precios`).set(auth(t)).send({ items: [{ varianteId: base.varianteId, precio: 1 }] }).expect(403);
    await http(app).post(`/api/listas-precio/${mayorista}/ajuste`).set(auth(t)).send({ porcentaje: -50 }).expect(403);
  });

  it('auditoría de los cambios de precios', async () => {
    const a = await http(app).get('/api/auditoria?entidad=lista_precio').set(h).expect(200);
    const acciones = (a.body.items ?? a.body).map((x: { accion: string }) => x.accion);
    expect(acciones).toEqual(expect.arrayContaining(['crear', 'ajuste_precios', 'precios', 'editar']));
  });
});
