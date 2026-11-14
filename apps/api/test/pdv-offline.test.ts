import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEmpresa, crearUsuario, http, iniciarApp, login, prepararVenta, unico, type EmpresaPrueba } from './ayudas';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** PDV sin conexión: el catálogo se descarga; las ventas se registran después con su momento real. */
describe('PDV sin conexión', () => {
  let app: INestApplication;
  let e: EmpresaPrueba;
  let h: { Authorization: string };
  let base: Awaited<ReturnType<typeof prepararVenta>>; // precio 11.000, stock 100
  let hc: { Authorization: string };
  let cajaId: string;
  let abiertaEn: number;

  const venta = (cuerpo: object) => ({
    claveIdempotencia: unico('off-'),
    cajaId,
    items: [{ varianteId: base.varianteId, cantidad: 1, precioUnitario: 11000 }],
    pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 11000 }],
    ...cuerpo,
  });

  beforeAll(async () => {
    app = await iniciarApp();
    e = await crearEmpresa(app, 'BUSINESS');
    h = auth(e.propietario.token);
    base = await prepararVenta(app, e, 100);
    // Un cajero (sin permiso para cambiar precios) en su propia caja.
    const c = await http(app).post('/api/cajas').set(h).send({ nombre: `Caja ${unico()}`, sucursalId: e.sucursalId, depositoId: base.depositoId }).expect(201);
    cajaId = c.body.id;
    const cajero = await crearUsuario(app, e, 'cajero');
    hc = auth((await login(app, cajero.email)).token);
    await http(app).post(`/api/cajas/${cajaId}/abrir`).set(hc).send({}).expect(201);
    abiertaEn = Date.now();
    await espera(50);
  });
  afterAll(() => app.close());

  it('descarga el catálogo de la caja con códigos de barras, precio y stock', async () => {
    const r = await http(app).get(`/api/pdv/catalogo?cajaId=${cajaId}`).set(hc).expect(200);
    expect(r.body.generado).toBeTruthy();
    const it = r.body.items.find((x: { varianteId: string }) => x.varianteId === base.varianteId);
    expect(it).toMatchObject({ precio: '11000.00', stock: '99.0000', tasaIva: 10 });
    expect(it.codigos.length).toBeGreaterThan(0);
  });

  it('registra la venta hecha sin conexión con su momento real', async () => {
    const registradaEn = new Date(Date.now() - 1000).toISOString();
    const v = await http(app).post('/api/ventas').set(hc).send(venta({ offline: { registradaEn } })).expect(201);
    expect(v.body.total).toBe('11000.00');
    expect(new Date(v.body.registradaOfflineEn).toISOString()).toBe(registradaEn);
    // Reintento de la sincronización: la misma clave devuelve la misma venta.
    const cuerpo = venta({ offline: { registradaEn } });
    const a = await http(app).post('/api/ventas').set(hc).send(cuerpo).expect(201);
    const b = await http(app).post('/api/ventas').set(hc).send(cuerpo).expect(201);
    expect(b.body.id).toBe(a.body.id);
  });

  it('el momento debe corresponder a la sesión de caja y a las últimas 72 horas', async () => {
    await http(app).post('/api/ventas').set(hc).send(venta({ offline: { registradaEn: new Date(abiertaEn - 3600_000).toISOString() } })).expect(400);
    await http(app).post('/api/ventas').set(hc).send(venta({ offline: { registradaEn: new Date(Date.now() + 3600_000).toISOString() } })).expect(400);
  });

  it('respeta el precio que tenía la caja solo si cambió después de la venta', async () => {
    const antes = new Date(Date.now() - 500).toISOString();
    await espera(20);
    // El dueño sube el precio a 12.000.
    const p = await http(app).get(`/api/productos/${base.productoId}`).set(h).expect(200);
    const v0 = p.body.variantes[0];
    await http(app).patch(`/api/productos/${base.productoId}`).set(h).send({ nombre: p.body.nombre, tasaIva: 10, variantes: [{ id: v0.id, precio: 12000, costo: 7000, codigos: v0.codigos }] }).expect(200);
    // Venta sin conexión anterior al cambio, cobrada a 11.000: se respeta.
    const ok = await http(app).post('/api/ventas').set(hc).send(venta({ offline: { registradaEn: antes } })).expect(201);
    expect(ok.body.total).toBe('11000.00');
    // Si se declara posterior al cambio, 11.000 es un cambio de precio sin permiso.
    await espera(20);
    await http(app).post('/api/ventas').set(hc).send(venta({ offline: { registradaEn: new Date().toISOString() } })).expect(403);
    // Guardar el producto sin cambiar el precio no habilita precios viejos.
    const desde = new Date().toISOString();
    await espera(20);
    await http(app).patch(`/api/productos/${base.productoId}`).set(h).send({ nombre: `${p.body.nombre} `.trim(), tasaIva: 10, variantes: [{ id: v0.id, precio: 12000, costo: 7000, codigos: v0.codigos }] }).expect(200);
    await http(app).post('/api/ventas').set(hc).send(venta({ offline: { registradaEn: desde } })).expect(403);
    // En línea, el precio sale siempre de la base.
    const online = await http(app).post('/api/ventas').set(hc).send(venta({ items: [{ varianteId: base.varianteId, cantidad: 1 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 12000 }] })).expect(201);
    expect(online.body.total).toBe('12000.00');
  });

  it('lo vendido sin conexión se registra aunque el stock quede negativo', async () => {
    const mucho = { items: [{ varianteId: base.varianteId, cantidad: 500, precioUnitario: 12000 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 6000000 }] };
    await http(app).post('/api/ventas').set(hc).send(venta(mucho)).expect(409);
    await http(app).post('/api/ventas').set(hc).send(venta({ ...mucho, offline: { registradaEn: new Date().toISOString() } })).expect(201);
    const r = await http(app).get(`/api/pdv/catalogo?cajaId=${cajaId}`).set(hc).expect(200);
    expect(Number(r.body.items.find((x: { varianteId: string }) => x.varianteId === base.varianteId).stock)).toBeLessThan(0);
  });
});
