import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEmpresa, crearUsuario, http, iniciarApp, login, prepararVenta, unico, type EmpresaPrueba } from './ayudas';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

interface Item { id: string; descripcion: string; cantidad: string; estado: string; ventaId: string | null; varianteId: string }

/** Restaurante: mesas, cuentas, comandas, cocina y cobro (entero o por ítems) en el PDV. */
describe('Restaurante', () => {
  let app: INestApplication;
  let e: EmpresaPrueba;
  let h: { Authorization: string };
  let base: Awaited<ReturnType<typeof prepararVenta>>;
  const v = { milanesa: '', cerveza: '', agua: '' };
  const mesas = { m1: '', m2: '' };
  let cuenta = '';

  const producto = async (nombre: string, precio: number, estacion: string | null) =>
    (await http(app).post('/api/productos').set(h).send({ nombre, tasaIva: 10, controlaStock: false, estacion, variantes: [{ precio, costo: precio / 3, codigos: [] }] }).expect(201)).body.variantes[0].id as string;
  const leer = async () => (await http(app).get(`/api/restaurante/cuentas/${cuenta}`).set(h).expect(200)).body as { estado: string; items: Item[]; totales: { total: string; pagado: string; pendiente: string }; propina: string };
  const cobrar = (items: { varianteId: string; cantidad: number }[], monto: number, extra: object = {}) =>
    http(app)
      .post('/api/ventas')
      .set(h)
      .send({ claveIdempotencia: unico('r-'), cajaId: base.cajaId, cuentaId: cuenta, items, pagos: [{ medio: 'efectivo', moneda: 'PYG', monto }], ...extra });

  beforeAll(async () => {
    app = await iniciarApp();
    e = await crearEmpresa(app, 'BUSINESS');
    h = auth(e.propietario.token);
    base = await prepararVenta(app, e, 10);
    v.milanesa = await producto('Milanesa napolitana', 45000, 'cocina');
    v.cerveza = await producto('Cerveza Pilsen 1 L', 15000, 'bar');
    v.agua = await producto('Agua mineral', 6000, null);
    const s = await http(app).post('/api/restaurante/salones').set(h).send({ sucursalId: e.sucursalId, nombre: 'Salón principal' }).expect(201);
    mesas.m1 = (await http(app).post('/api/restaurante/mesas').set(h).send({ salonId: s.body.id, nombre: '1', capacidad: 4, posX: 0, posY: 0 }).expect(201)).body.id;
    mesas.m2 = (await http(app).post('/api/restaurante/mesas').set(h).send({ salonId: s.body.id, nombre: '2', forma: 'redonda', posX: 2, posY: 0 }).expect(201)).body.id;
    await http(app).post('/api/restaurante/mesas').set(h).send({ salonId: s.body.id, nombre: '1' }).expect(409);
  });
  afterAll(() => app.close());

  it('el mozo abre la mesa, carga y envía la comanda; lo que no va a cocina queda listo', async () => {
    const mozo = await crearUsuario(app, e, 'mozo');
    const hm = auth((await login(app, mozo.email)).token);
    const c = await http(app).post('/api/restaurante/cuentas').set(hm).send({ mesaId: mesas.m1, comensales: 3 }).expect(201);
    cuenta = c.body.id;
    await http(app).post('/api/restaurante/cuentas').set(hm).send({ mesaId: mesas.m1 }).expect(409);
    await http(app)
      .post(`/api/restaurante/cuentas/${cuenta}/items`)
      .set(hm)
      .send({ items: [{ varianteId: v.milanesa, cantidad: 2, nota: 'Una sin sal' }, { varianteId: v.cerveza, cantidad: 3 }, { varianteId: v.agua, cantidad: 1 }] })
      .expect(201);
    // No se cobra lo que no se envió.
    await cobrar([{ varianteId: v.agua, cantidad: 1 }], 6000, { cuentaItems: [(await leer()).items[2]!.id] }).expect(409);
    const env = await http(app).post(`/api/restaurante/cuentas/${cuenta}/enviar`).set(hm).expect(200);
    expect(env.body.items.map((i: Item) => i.estado)).toEqual(['enviado', 'enviado', 'listo']);
    await http(app).post(`/api/restaurante/cuentas/${cuenta}/enviar`).set(hm).expect(409);
    // El mozo no ve la cocina ni cobra.
    await http(app).get(`/api/cocina?sucursalId=${e.sucursalId}&estacion=cocina`).set(hm).expect(403);
    const p = await http(app).get(`/api/restaurante/plano?sucursalId=${e.sucursalId}`).set(hm).expect(200);
    expect(p.body.salones[0].mesas[0].cuenta).toMatchObject({ comensales: 3, total: '141000.00', enCocina: 2, listos: 1 });
    expect(p.body.salones[0].mesas[1].cuenta).toBeNull();
  });

  it('cocina y bar ven su parte, la preparan y la marcan lista', async () => {
    const coc = await crearUsuario(app, e, 'cocina');
    const hc = auth((await login(app, coc.email)).token);
    const k = await http(app).get(`/api/cocina?sucursalId=${e.sucursalId}&estacion=cocina`).set(hc).expect(200);
    expect(k.body).toHaveLength(1);
    expect(k.body[0]).toMatchObject({ numero: 1, destino: 'Mesa 1', items: [{ descripcion: 'Milanesa napolitana', cantidad: '2', nota: 'Una sin sal', estado: 'enviado' }] });
    const bar = await http(app).get(`/api/cocina?sucursalId=${e.sucursalId}&estacion=bar`).set(hc).expect(200);
    expect(bar.body[0].items[0].descripcion).toBe('Cerveza Pilsen 1 L');
    await http(app).post('/api/cocina/items').set(hc).send({ items: [k.body[0].items[0].id], estado: 'preparando' }).expect(200);
    await http(app).post('/api/cocina/items').set(hc).send({ items: [k.body[0].items[0].id, bar.body[0].items[0].id], estado: 'listo' }).expect(200);
    const p = await http(app).get(`/api/restaurante/plano?sucursalId=${e.sucursalId}`).set(h).expect(200);
    expect(p.body.salones[0].mesas[0].cuenta).toMatchObject({ enCocina: 0, listos: 3 });
    await http(app).post(`/api/restaurante/cuentas/${cuenta}/servido`).set(h).send({}).expect(200);
    expect((await leer()).items.every((i) => i.estado === 'entregado')).toBe(true);
  });

  it('cuenta dividida: cada uno paga lo suyo; propina a la caja; se cierra al cobrar todo', async () => {
    let c = await leer();
    const cerveza = c.items.find((i) => i.varianteId === v.cerveza)!;
    await http(app).post(`/api/restaurante/cuentas/${cuenta}/items/${cerveza.id}/dividir`).set(h).send({ cantidad: 1 }).expect(200);
    c = await leer();
    const milanesa = c.items.find((i) => i.varianteId === v.milanesa)!;
    const unaCerveza = c.items.find((i) => i.varianteId === v.cerveza && i.cantidad === '1.0000')!;
    // Los productos de la venta deben coincidir con los ítems elegidos.
    await cobrar([{ varianteId: v.milanesa, cantidad: 2 }], 90000, { cuentaItems: [milanesa.id, unaCerveza.id] }).expect(400);
    const v1 = await cobrar([{ varianteId: v.milanesa, cantidad: 2 }, { varianteId: v.cerveza, cantidad: 1 }], 105000, { cuentaItems: [milanesa.id, unaCerveza.id], propina: { monto: 10000, medio: 'efectivo' } }).expect(201);
    expect(v1.body.total).toBe('105000.00');
    c = await leer();
    expect(c).toMatchObject({ estado: 'abierta', propina: '10000.00', totales: { total: '141000.00', pagado: '105000.00', pendiente: '36000.00' } });
    // El resto, de una vez.
    const v2 = await cobrar([{ varianteId: v.cerveza, cantidad: 2 }, { varianteId: v.agua, cantidad: 1 }], 36000).expect(201);
    expect((await leer()).estado).toBe('cerrada');
    let p = await http(app).get(`/api/restaurante/plano?sucursalId=${e.sucursalId}`).set(h).expect(200);
    expect(p.body.salones[0].mesas[0].cuenta).toBeNull();
    // Anular la segunda venta reabre la cuenta y la mesa.
    await http(app).post(`/api/ventas/${v2.body.id}/anular`).set(h).send({ motivo: 'Cobro equivocado' }).expect(200);
    expect((await leer())).toMatchObject({ estado: 'abierta', totales: { pendiente: '36000.00' } });
    p = await http(app).get(`/api/restaurante/plano?sucursalId=${e.sucursalId}`).set(h).expect(200);
    expect(p.body.salones[0].mesas[0].cuenta).not.toBeNull();
    // La caja recibió la propina aparte de las ventas.
    const caja = await http(app).get(`/api/cajas/${base.cajaId}/sesion`).set(h).expect(200);
    expect(JSON.stringify(caja.body)).toContain('Propina');
  });

  it('anular ítems enviados requiere permiso; la cuenta se mueve de mesa', async () => {
    const mozo = await crearUsuario(app, e, 'mozo');
    const hm = auth((await login(app, mozo.email)).token);
    const c = await leer();
    const agua = c.items.find((i) => i.varianteId === v.agua && !i.ventaId)!;
    await http(app).post(`/api/restaurante/cuentas/${cuenta}/items/${agua.id}/anular`).set(hm).send({ motivo: 'No lo pidió' }).expect(403);
    await http(app).post(`/api/restaurante/cuentas/${cuenta}/items/${agua.id}/anular`).set(h).send({ motivo: 'No lo pidió' }).expect(200);
    await http(app).post(`/api/restaurante/cuentas/${cuenta}/mover`).set(hm).send({ mesaId: mesas.m2 }).expect(200);
    const p = await http(app).get(`/api/restaurante/plano?sucursalId=${e.sucursalId}`).set(h).expect(200);
    expect(p.body.salones[0].mesas.map((m: { cuenta: unknown }) => !!m.cuenta)).toEqual([false, true]);
    await cobrar([{ varianteId: v.cerveza, cantidad: 2 }], 30000).expect(201);
    expect((await leer()).estado).toBe('cerrada');
  });

  it('mostrador: cuenta a nombre del cliente; una vacía se anula sin permiso especial', async () => {
    const mozo = await crearUsuario(app, e, 'mozo');
    const hm = auth((await login(app, mozo.email)).token);
    const c = await http(app).post('/api/restaurante/cuentas').set(hm).send({ sucursalId: e.sucursalId, nombre: 'Ana' }).expect(201);
    expect(c.body).toMatchObject({ tipo: 'mostrador', nombre: 'Ana' });
    await http(app).post(`/api/restaurante/cuentas/${c.body.id}/items`).set(hm).send({ items: [{ varianteId: v.agua, cantidad: 1 }] }).expect(201);
    const p = await http(app).get(`/api/restaurante/plano?sucursalId=${e.sucursalId}`).set(hm).expect(200);
    expect(p.body.mostrador).toHaveLength(1);
    await http(app).post(`/api/restaurante/cuentas/${c.body.id}/anular`).set(hm).send({}).expect(200);
    const l = await http(app).get(`/api/restaurante/cuentas?sucursalId=${e.sucursalId}`).set(hm).expect(200);
    expect(l.body).toHaveLength(0);
  });
});
