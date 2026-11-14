import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONTRASENA, crearEmpresa, crearUsuario, http, iniciarApp, login, prepararVenta, unico, type EmpresaPrueba } from './ayudas';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Presupuestos y pedidos', () => {
  let app: INestApplication;
  let e: EmpresaPrueba;
  let h: { Authorization: string };
  let base: Awaited<ReturnType<typeof prepararVenta>>; // precio normal 11.000, stock 50 (1 vendido)
  let clienteId: string;
  let vendedor: string;

  beforeAll(async () => {
    app = await iniciarApp();
    e = await crearEmpresa(app, 'ENTERPRISE');
    h = auth(e.propietario.token);
    base = await prepararVenta(app, e, 50);
    const lp = await http(app).post('/api/listas-precio').set(h).send({ nombre: 'Mayorista' }).expect(201);
    await http(app).put(`/api/listas-precio/${lp.body.id}/precios`).set(h).send({ items: [{ varianteId: base.varianteId, precio: 10000 }] }).expect(200);
    const cl = await http(app).post('/api/clientes').set(h).send({ nombre: 'Ferretería Central', listaPrecioId: lp.body.id, telefono: '0981 000 000' }).expect(201);
    clienteId = cl.body.id;
    const v = await crearUsuario(app, e, 'vendedor');
    vendedor = (await login(app, v.email)).token;
  });
  afterAll(() => app.close());

  it('presupuesto con la lista del cliente, numeración propia y sin mover stock', async () => {
    const r = await http(app)
      .post('/api/presupuestos')
      .set(auth(vendedor))
      .send({ sucursalId: e.sucursalId, clienteId, validoHasta: '2099-12-31', nota: 'Entrega en obra', items: [{ varianteId: base.varianteId, cantidad: 5 }] })
      .expect(201);
    expect(r.body).toMatchObject({ tipo: 'presupuesto', numero: 1, estado: 'vigente', total: '50000.00', lista: { nombre: 'Mayorista' }, vencido: false });
    expect(r.body.items[0]).toMatchObject({ precioUnitario: '10000.00', cantidad: '5.0000' });
    const st = await http(app).get(`/api/stock?depositoId=${base.depositoId}`).set(h).expect(200);
    expect(Number(st.body.find((x: { varianteId: string }) => x.varianteId === base.varianteId).cantidad)).toBe(49);
    const r2 = await http(app).post('/api/presupuestos').set(auth(vendedor)).send({ sucursalId: e.sucursalId, clienteNombre: 'Juan sin registro', items: [{ varianteId: base.varianteId, cantidad: 1 }] }).expect(201);
    expect(r2.body.numero).toBe(2);
    expect(r2.body.cliente).toMatchObject({ id: null, nombre: 'Juan sin registro' });
    expect(r2.body.items[0].precioUnitario).toBe('11000.00');
  });

  it('búsqueda de productos con el precio del cliente y el stock de la sucursal', async () => {
    const r = await http(app).get(`/api/presupuestos/productos?sucursalId=${e.sucursalId}&clienteId=${clienteId}&q=${base.codigo}`).set(auth(vendedor)).expect(200);
    expect(r.body[0]).toMatchObject({ varianteId: base.varianteId, precio: '10000.00', stock: '49.0000' });
    const sin = await http(app).get(`/api/pedidos/productos?sucursalId=${e.sucursalId}&q=Producto`).set(auth(vendedor)).expect(200);
    expect(sin.body[0].precio).toBe('11000.00');
  });

  it('el vendedor no cambia precios ni descuenta sin autorización', async () => {
    const cuerpo = { sucursalId: e.sucursalId, items: [{ varianteId: base.varianteId, cantidad: 1, precioUnitario: 5000 }] };
    await http(app).post('/api/presupuestos').set(auth(vendedor)).send(cuerpo).expect(403);
    const d = { sucursalId: e.sucursalId, items: [{ varianteId: base.varianteId, cantidad: 2, descuento: 2000 }] };
    await http(app).post('/api/presupuestos').set(auth(vendedor)).send(d).expect(403);
    // Con PIN de supervisor.
    const sup = await crearUsuario(app, e, 'supervisor');
    const ts = (await login(app, sup.email)).token;
    await http(app).put('/api/auth/pin').set(auth(ts)).send({ pin: '4321', contrasena: CONTRASENA }).expect(204);
    const pin = await http(app).post('/api/autorizaciones').set(auth(vendedor)).send({ usuarioId: sup.id, pin: '4321', permiso: 'descuento.aprobar' }).expect(200);
    const ok = await http(app).post('/api/presupuestos').set(auth(vendedor)).set('X-Autorizacion', pin.body.autorizacion).send(d).expect(201);
    expect(ok.body.total).toBe('20000.00');
  });

  it('presupuesto vencido no se acepta; editar actualiza precios y validez', async () => {
    const r = await http(app).post('/api/presupuestos').set(h).send({ sucursalId: e.sucursalId, clienteId, validoHasta: '2020-01-01', items: [{ varianteId: base.varianteId, cantidad: 1 }] }).expect(201);
    expect(r.body.vencido).toBe(true);
    const ac = await http(app).post(`/api/presupuestos/${r.body.id}/aceptar`).set(h).send({}).expect(409);
    expect(ac.body.codigo).toBe('PRESUPUESTO_VENCIDO');
    const ed = await http(app).patch(`/api/presupuestos/${r.body.id}`).set(h).send({ sucursalId: e.sucursalId, clienteId, validoHasta: '2099-01-01', items: [{ varianteId: base.varianteId, cantidad: 3 }] }).expect(200);
    expect(ed.body).toMatchObject({ vencido: false, total: '30000.00' });
    const rch = await http(app).post(`/api/presupuestos/${r.body.id}/rechazar`).set(h).send({ motivo: 'Compró en otro lado' }).expect(200);
    expect(rch.body.estado).toBe('rechazado');
    await http(app).patch(`/api/presupuestos/${r.body.id}`).set(h).send({ sucursalId: e.sucursalId, items: [{ varianteId: base.varianteId, cantidad: 1 }] }).expect(409);
  });

  let pedidoId: string;
  it('aceptar genera el pedido con los precios cotizados aunque cambie la lista', async () => {
    const pr = await http(app).get('/api/presupuestos?estado=abiertos&q=Ferreter').set(h).expect(200);
    const presu = pr.body.find((x: { numero: number }) => x.numero === 1);
    // Sube el precio mayorista después de cotizar.
    const listas = await http(app).get('/api/listas-precio').set(h);
    const may = listas.body.find((l: { nombre: string }) => l.nombre === 'Mayorista');
    await http(app).put(`/api/listas-precio/${may.id}/precios`).set(h).send({ items: [{ varianteId: base.varianteId, precio: 10500 }] }).expect(200);

    const p = await http(app).post(`/api/presupuestos/${presu.id}/aceptar`).set(auth(vendedor)).send({ entregaPrevista: '2099-01-15' }).expect(201);
    pedidoId = p.body.id;
    expect(p.body).toMatchObject({ tipo: 'pedido', numero: 1, estado: 'pendiente', total: '50000.00', origen: { numero: 1 }, entregaPrevista: '2099-01-15' });
    const presuDespues = await http(app).get(`/api/presupuestos/${presu.id}`).set(h).expect(200);
    expect(presuDespues.body).toMatchObject({ estado: 'aceptado', pedidoGenerado: { id: pedidoId, numero: 1 } });
    await http(app).post(`/api/presupuestos/${presu.id}/aceptar`).set(h).send({}).expect(409);
    // Presupuesto sin cliente: para pedirlo hay que indicar quién.
    const sin = await http(app).post('/api/presupuestos').set(h).send({ sucursalId: e.sucursalId, items: [{ varianteId: base.varianteId, cantidad: 1 }] }).expect(201);
    await http(app).post(`/api/presupuestos/${sin.body.id}/aceptar`).set(h).send({}).expect(400);
  });

  it('pedido preparado y cobrado en el PDV con sus precios: queda entregado', async () => {
    await http(app).post(`/api/pedidos/${pedidoId}/estado`).set(h).send({ estado: 'preparado' }).expect(200);
    const lista = await http(app).get(`/api/pdv/pedidos?cajaId=${base.cajaId}`).set(h).expect(200);
    expect(lista.body.map((p: { id: string }) => p.id)).toContain(pedidoId);
    const venta = { claveIdempotencia: unico('pd-'), cajaId: base.cajaId, pedidoId, items: [{ varianteId: base.varianteId, cantidad: 5 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 50000 }] };
    // Otro cliente: rechazado.
    await http(app).post('/api/ventas').set(h).send({ ...venta, clienteId: null }).expect(400);
    const v = await http(app).post('/api/ventas').set(h).send({ ...venta, clienteId }).expect(201);
    expect(v.body).toMatchObject({ total: '50000.00', pedidoId });
    const p = await http(app).get(`/api/pedidos/${pedidoId}`).set(h).expect(200);
    expect(p.body).toMatchObject({ estado: 'entregado', venta: { id: v.body.id } });
    await http(app).post('/api/ventas').set(h).send({ ...venta, clienteId, claveIdempotencia: unico('pd-') }).expect(409);
    // Anular la venta devuelve el pedido a pendiente.
    await http(app).post(`/api/ventas/${v.body.id}/anular`).set(h).send({ motivo: 'Cobro equivocado' }).expect(200);
    const p2 = await http(app).get(`/api/pedidos/${pedidoId}`).set(h).expect(200);
    expect(p2.body).toMatchObject({ estado: 'pendiente', venta: null });
  });

  it('el descuento del pedido no vuelve a pedir PIN en caja; uno mayor sí', async () => {
    const ped = await http(app).post('/api/pedidos').set(h).send({ sucursalId: e.sucursalId, clienteNombre: 'Mostrador', items: [{ varianteId: base.varianteId, cantidad: 4, descuento: 4000 }] }).expect(201);
    expect(ped.body.total).toBe('40000.00');
    const cajero = await crearUsuario(app, e, 'cajero');
    const tc = (await login(app, cajero.email)).token;
    const c2 = await http(app).post('/api/cajas').set(h).send({ nombre: `Caja ${unico()}`, sucursalId: e.sucursalId, depositoId: base.depositoId }).expect(201);
    await http(app).post(`/api/cajas/${c2.body.id}/abrir`).set(auth(tc)).send({}).expect(201);
    const cuerpo = { claveIdempotencia: unico('pd-'), cajaId: c2.body.id, pedidoId: ped.body.id, items: [{ varianteId: base.varianteId, cantidad: 4, descuento: 5000 }], pagos: [{ medio: 'tarjeta', moneda: 'PYG', monto: 39000 }] };
    await http(app).post('/api/ventas').set(auth(tc)).send(cuerpo).expect(403);
    // Lleva 2 de los 4: descuento proporcional 2.000 sin PIN.
    const v = await http(app).post('/api/ventas').set(auth(tc)).send({ ...cuerpo, items: [{ varianteId: base.varianteId, cantidad: 2, descuento: 2000 }], pagos: [{ medio: 'tarjeta', moneda: 'PYG', monto: 20000 }] }).expect(201);
    expect(v.body.total).toBe('20000.00');
  });

  it('cancelar un pedido abierto; no se cobra después', async () => {
    const ped = await http(app).post('/api/pedidos').set(h).send({ sucursalId: e.sucursalId, clienteId, items: [{ varianteId: base.varianteId, cantidad: 1 }] }).expect(201);
    expect(ped.body.items[0].precioUnitario).toBe('10500.00');
    const c = await http(app).post(`/api/pedidos/${ped.body.id}/cancelar`).set(h).send({ motivo: 'El cliente desistió' }).expect(200);
    expect(c.body).toMatchObject({ estado: 'cancelado', cierre: { motivo: 'El cliente desistió' } });
    await http(app)
      .post('/api/ventas')
      .set(h)
      .send({ claveIdempotencia: unico('pd-'), cajaId: base.cajaId, clienteId, pedidoId: ped.body.id, items: [{ varianteId: base.varianteId, cantidad: 1 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 10500 }] })
      .expect(409);
    await http(app).post('/api/pedidos').set(h).send({ sucursalId: e.sucursalId, items: [{ varianteId: base.varianteId, cantidad: 1 }] }).expect(400);
  });

  it('el vendedor no ve presupuestos de sucursales ajenas', async () => {
    const s2 = await http(app).post('/api/sucursales').set(h).send({ nombre: 'Luque', codigo: '002' }).expect(201);
    const otro = await http(app).post('/api/presupuestos').set(h).send({ sucursalId: s2.body.id, items: [{ varianteId: base.varianteId, cantidad: 1 }] }).expect(201);
    await http(app).get(`/api/presupuestos/${otro.body.id}`).set(auth(vendedor)).expect(404);
    const l = await http(app).get('/api/presupuestos').set(auth(vendedor)).expect(200);
    expect(l.body.map((p: { id: string }) => p.id)).not.toContain(otro.body.id);
    await http(app).post('/api/presupuestos').set(auth(vendedor)).send({ sucursalId: s2.body.id, items: [{ varianteId: base.varianteId, cantidad: 1 }] }).expect(404);
  });
});
