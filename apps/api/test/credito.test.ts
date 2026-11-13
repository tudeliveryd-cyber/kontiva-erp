import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONTRASENA, crearEmpresa, crearUsuario, http, iniciarApp, login, prepararVenta, unico, type EmpresaPrueba } from './ayudas';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Ventas a crédito y cuentas a cobrar', () => {
  let app: INestApplication;
  let e: EmpresaPrueba;
  let h: { Authorization: string };
  let base: Awaited<ReturnType<typeof prepararVenta>>; // precio 11.000, caja abierta con 100.000
  let cliente: string;
  let cajero: { token: string; id: string };
  let cajaCajero: string;

  const vender = (cuerpo: object, token = e.propietario.token) =>
    http(app).post('/api/ventas').set(auth(token)).send({ claveIdempotencia: unico('cr-'), cajaId: base.cajaId, items: [{ varianteId: base.varianteId, cantidad: 2 }], pagos: [], ...cuerpo });
  const efectivoCaja = async () => {
    const c = await http(app).get(`/api/cajas/${base.cajaId}/sesion`).set(h).expect(200);
    const e = (c.body.esperado ?? []).find((x: { moneda: string; medio: string }) => x.moneda === 'PYG' && x.medio === 'efectivo');
    return Number(e?.monto ?? NaN);
  };

  beforeAll(async () => {
    app = await iniciarApp();
    e = await crearEmpresa(app, 'BUSINESS');
    h = auth(e.propietario.token);
    base = await prepararVenta(app, e, 100);
    const c = await http(app).post('/api/clientes').set(h).send({ nombre: 'Almacén La Esquina', documento: '1234567', limiteCredito: 50000, plazoCreditoDias: 15 }).expect(201);
    cliente = c.body.id;
    expect(c.body).toMatchObject({ limiteCredito: '50000.00', plazoCreditoDias: 15 });
    const u = await crearUsuario(app, e, 'cajero');
    cajero = { token: (await login(app, u.email)).token, id: u.id };
    const c2 = await http(app).post('/api/cajas').set(h).send({ nombre: `Caja ${unico()}`, sucursalId: e.sucursalId, depositoId: base.depositoId }).expect(201);
    cajaCajero = c2.body.id;
    await http(app).post(`/api/cajas/${cajaCajero}/abrir`).set(auth(cajero.token)).send({}).expect(201);
  });
  afterAll(() => app.close());

  it('el cajero no cambia el límite de crédito', async () => {
    await http(app).patch(`/api/clientes/${cliente}`).set(auth(cajero.token)).send({ nombre: 'Almacén La Esquina', documento: '1234567', limiteCredito: 9999999 }).expect(403);
  });

  let ventaId: string;
  it('venta a crédito total: sin pasar por la caja, con cuenta a cobrar al plazo del cliente', async () => {
    const r = await vender({ clienteId: cliente, credito: 22000 }).expect(201);
    ventaId = r.body.id;
    expect(r.body).toMatchObject({ total: '22000.00', credito: '22000.00', cuentaCobrar: { saldo: '22000.00', estado: 'pendiente' } });
    const c = await http(app).get(`/api/clientes/${cliente}`).set(h).expect(200);
    expect(c.body.saldo).toBe('22000.00');
    await vender({ credito: 22000 }).expect(400); // sin cliente
    await vender({ clienteId: cliente, credito: 30000 }).expect(400); // más que el total
  });

  it('venta mixta: parte en efectivo y parte a crédito', async () => {
    const r = await vender({ clienteId: cliente, credito: 12000, pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 10000 }] }).expect(201);
    expect(r.body).toMatchObject({ credito: '12000.00', cuentaCobrar: { saldo: '12000.00' } });
    // Debe 34.000 de 50.000: quedan 16.000 disponibles.
    const ec = await http(app).get(`/api/cuentas-cobrar/cliente/${cliente}`).set(h).expect(200);
    expect(ec.body).toMatchObject({ deuda: '34000.00', disponible: '16000.00' });
  });

  it('superar el límite pide autorización de un supervisor', async () => {
    const r = await vender({ clienteId: cliente, credito: 22000, cajaId: cajaCajero }, cajero.token);
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ codigo: 'CREDITO_EXCEDIDO' });
    expect(r.body.detalle.disponible).toBe('16000.00');
    // Con PIN del supervisor.
    const sup = await crearUsuario(app, e, 'supervisor');
    const ts = (await login(app, sup.email)).token;
    await http(app).put('/api/auth/pin').set(auth(ts)).send({ pin: '2468', contrasena: CONTRASENA }).expect(204);
    const pin = await http(app).post('/api/autorizaciones').set(auth(cajero.token)).send({ usuarioId: sup.id, pin: '2468', permiso: 'credito_cliente.aprobar' }).expect(200);
    const ok = await http(app)
      .post('/api/ventas')
      .set(auth(cajero.token))
      .set('X-Autorizacion', pin.body.autorizacion)
      .send({ claveIdempotencia: unico('cr-'), cajaId: cajaCajero, clienteId: cliente, items: [{ varianteId: base.varianteId, cantidad: 2 }], pagos: [], credito: 22000 })
      .expect(201);
    expect(ok.body.credito).toBe('22000.00');
  });

  it('cobro parcial en efectivo en la caja, cobro de varias cuentas por transferencia y anulación', async () => {
    const antes = await efectivoCaja();
    const l = await http(app).get(`/api/cuentas-cobrar?clienteId=${cliente}`).set(h).expect(200);
    expect(l.body).toHaveLength(3);
    const primera = l.body.find((c: { saldo: string }) => c.saldo === '22000.00');
    await http(app).post('/api/cobros').set(h).send({ clienteId: cliente, fecha: '2026-11-12', medio: 'efectivo', aplicaciones: [{ cuentaId: primera.id, monto: 5000 }] }).expect(400); // efectivo sin caja
    const k1 = await http(app).post('/api/cobros').set(h).send({ clienteId: cliente, fecha: '2026-11-12', medio: 'efectivo', cajaId: base.cajaId, aplicaciones: [{ cuentaId: primera.id, monto: 7000 }] }).expect(201);
    expect(k1.body.total).toBe('7000.00');
    if (!Number.isNaN(antes)) expect(await efectivoCaja()).toBe(antes + 7000);
    await http(app).post('/api/cobros').set(h).send({ clienteId: cliente, fecha: '2026-11-12', medio: 'transferencia', aplicaciones: [{ cuentaId: primera.id, monto: 99999 }] }).expect(400);
    const resto = l.body.filter((c: { id: string }) => c.id !== primera.id);
    const k2 = await http(app)
      .post('/api/cobros')
      .set(h)
      .send({ clienteId: cliente, fecha: '2026-11-12', medio: 'transferencia', referencia: 'TRX-9', aplicaciones: resto.map((c: { id: string; saldo: string }) => ({ cuentaId: c.id, monto: Number(c.saldo) })) })
      .expect(201);
    expect(Number(k2.body.total)).toBe(12000 + 22000);
    let ec = await http(app).get(`/api/cuentas-cobrar/cliente/${cliente}`).set(h).expect(200);
    expect(ec.body.deuda).toBe('15000.00');
    expect(ec.body.movimientos.at(-1)).toMatchObject({ tipo: 'cobro', saldo: '15000.00' });
    await http(app).post(`/api/cobros/${k1.body.id}/anular`).set(h).send({ motivo: 'Billete falso' }).expect(200);
    ec = await http(app).get(`/api/cuentas-cobrar/cliente/${cliente}`).set(h).expect(200);
    expect(ec.body.deuda).toBe('22000.00');
    if (!Number.isNaN(antes)) expect(await efectivoCaja()).toBe(antes);
    const res = await http(app).get('/api/cuentas-cobrar/resumen').set(h).expect(200);
    expect(res.body).toMatchObject({ abierto: '22000.00', clientes: 1 });
  });

  it('anular una venta a crédito: sin cobros se anula la cuenta; con cobros, no', async () => {
    const nueva = await vender({ clienteId: cliente, credito: 22000 }).expect(201);
    await http(app).post(`/api/ventas/${nueva.body.id}/anular`).set(h).send({ motivo: 'Error de carga' }).expect(200);
    const v = await http(app).get(`/api/ventas/${nueva.body.id}`).set(h).expect(200);
    expect(v.body.cuentaCobrar.estado).toBe('anulada');
    const cc = (await http(app).get(`/api/ventas/${ventaId}`).set(h)).body.cuentaCobrar;
    await http(app).post('/api/cobros').set(h).send({ clienteId: cliente, fecha: '2026-11-12', medio: 'transferencia', aplicaciones: [{ cuentaId: cc.id, monto: 1000 }] }).expect(201);
    const r = await http(app).post(`/api/ventas/${ventaId}/anular`).set(h).send({ motivo: 'x x x' }).expect(409);
    expect(r.body.codigo).toBe('VENTA_CON_COBROS');
  });

  it('devolución de una venta a crédito: primero descuenta la deuda, el resto se reintegra', async () => {
    const v = await vender({ clienteId: cliente, credito: 11000, pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 11000 }] }).expect(201);
    // Devuelve 1 de 2 (11.000): queda cubierto por la deuda de 11.000.
    const d1 = await http(app).post('/api/devoluciones').set(h).send({ ventaId: v.body.id, cajaId: base.cajaId, motivo: 'Fallado', items: [{ linea: 1, cantidad: 1 }] }).expect(201);
    expect(d1.body).toMatchObject({ total: '11000.00', descontadoDeuda: '11000.00', reintegrado: '0.00' });
    const vv = await http(app).get(`/api/ventas/${v.body.id}`).set(h).expect(200);
    expect(vv.body.cuentaCobrar).toMatchObject({ saldo: '0.00', estado: 'cobrada' });
    // La otra unidad ya no tiene deuda: se reintegra en efectivo.
    const d2 = await http(app).post('/api/devoluciones').set(h).send({ ventaId: v.body.id, cajaId: base.cajaId, motivo: 'Fallado', items: [{ linea: 1, cantidad: 1 }] }).expect(201);
    expect(d2.body).toMatchObject({ descontadoDeuda: '0.00', reintegrado: '11000.00' });
    const ec = await http(app).get(`/api/cuentas-cobrar/cliente/${cliente}`).set(h).expect(200);
    expect(ec.body.movimientos.some((m: { tipo: string }) => m.tipo === 'devolucion')).toBe(true);
  });

  it('el cajero cobra en su caja pero no anula cobros', async () => {
    const l = await http(app).get(`/api/cuentas-cobrar?clienteId=${cliente}`).set(auth(cajero.token)).expect(200);
    const k = await http(app).post('/api/cobros').set(auth(cajero.token)).send({ clienteId: cliente, fecha: '2026-11-12', medio: 'efectivo', cajaId: cajaCajero, aplicaciones: [{ cuentaId: l.body[0].id, monto: 1000 }] }).expect(201);
    await http(app).post(`/api/cobros/${k.body.id}/anular`).set(auth(cajero.token)).send({ motivo: 'Intento' }).expect(403);
    // No cobra en una caja ajena.
    await http(app).post('/api/cobros').set(auth(cajero.token)).send({ clienteId: cliente, fecha: '2026-11-12', medio: 'efectivo', cajaId: base.cajaId, aplicaciones: [{ cuentaId: l.body[0].id, monto: 1000 }] }).expect(409);
  });
});
