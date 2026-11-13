import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEmpresa, crearUsuario, http, iniciarApp, login, prepararVenta, unico, type EmpresaPrueba } from './ayudas';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
const masDias = (n: number) => {
  const d = new Date(`${hoy()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('Bancos, conciliación y flujo de caja', () => {
  let app: INestApplication;
  let e: EmpresaPrueba;
  let h: { Authorization: string };
  let base: Awaited<ReturnType<typeof prepararVenta>>; // precio 11.000, caja abierta con 100.000
  let itau: string;
  let continental: string;

  const cuenta = async (id: string) => (await http(app).get('/api/cuentas-bancarias').set(h).expect(200)).body.find((c: { id: string }) => c.id === id);

  beforeAll(async () => {
    app = await iniciarApp();
    e = await crearEmpresa(app, 'BUSINESS');
    h = auth(e.propietario.token);
    base = await prepararVenta(app, e, 100);
  });
  afterAll(() => app.close());

  it('crea cuentas con saldo inicial y las lista con su saldo', async () => {
    const a = await http(app).post('/api/cuentas-bancarias').set(h).send({ banco: 'Itaú', nombre: 'Cuenta corriente', numero: '123-456', saldoInicial: 1000000, fechaSaldoInicial: '2026-11-01' }).expect(201);
    expect(a.body).toMatchObject({ banco: 'Itaú', saldo: '1000000.00', saldoConciliado: '1000000.00', sinConciliar: 0 });
    itau = a.body.id;
    const b = await http(app).post('/api/cuentas-bancarias').set(h).send({ banco: 'Continental', nombre: 'Caja de ahorro', fechaSaldoInicial: '2026-11-01' }).expect(201);
    continental = b.body.id;
    await http(app).post('/api/cuentas-bancarias').set(h).send({ banco: 'X', nombre: '', fechaSaldoInicial: '2026-11-01' }).expect(400);
  });

  it('el cajero no ve los bancos', async () => {
    const u = await crearUsuario(app, e, 'cajero');
    const t = (await login(app, u.email)).token;
    await http(app).get('/api/cuentas-bancarias').set(auth(t)).expect(403);
    await http(app).get(`/api/finanzas/flujo?desde=${hoy()}&hasta=${hoy()}`).set(auth(t)).expect(403);
  });

  it('movimientos manuales: el signo sigue al tipo', async () => {
    await http(app).post(`/api/cuentas-bancarias/${itau}/movimientos`).set(h).send({ tipo: 'gasto', fecha: hoy(), monto: 15000, descripcion: 'Comisión de mantenimiento' }).expect(201);
    await http(app).post(`/api/cuentas-bancarias/${itau}/movimientos`).set(h).send({ tipo: 'ingreso', fecha: hoy(), monto: 5000, descripcion: 'Intereses' }).expect(201);
    await http(app).post(`/api/cuentas-bancarias/${itau}/movimientos`).set(h).send({ tipo: 'extraccion', fecha: hoy(), monto: -5, descripcion: 'Monto negativo' }).expect(400);
    expect((await cuenta(itau)).saldo).toBe('990000.00');
  });

  it('transferencia entre cuentas: sale de una y entra a la otra', async () => {
    await http(app).post(`/api/cuentas-bancarias/${itau}/transferencia`).set(h).send({ destinoId: itau, fecha: hoy(), monto: 1 }).expect(400);
    await http(app).post(`/api/cuentas-bancarias/${itau}/transferencia`).set(h).send({ destinoId: continental, fecha: hoy(), monto: 200000, referencia: 'TR-1' }).expect(201);
    expect((await cuenta(itau)).saldo).toBe('790000.00');
    expect((await cuenta(continental)).saldo).toBe('200000.00');
  });

  it('depósito del efectivo de la caja: sale de la caja y entra al banco', async () => {
    await http(app).post(`/api/cuentas-bancarias/${continental}/deposito-caja`).set(h).send({ cajaId: base.cajaId, fecha: hoy(), monto: 999999999 }).expect(409);
    await http(app).post(`/api/cuentas-bancarias/${continental}/deposito-caja`).set(h).send({ cajaId: base.cajaId, fecha: hoy(), monto: 60000, referencia: 'Boleta 77' }).expect(201);
    expect((await cuenta(continental)).saldo).toBe('260000.00');
    const s = await http(app).get(`/api/cajas/${base.cajaId}/sesion`).set(h).expect(200);
    const ef = s.body.esperado.find((x: { moneda: string; medio: string }) => x.moneda === 'PYG' && x.medio === 'efectivo');
    expect(Number(ef.monto)).toBe(51000); // 100.000 de apertura + 11.000 de la venta de prepararVenta − 60.000
  });

  let pagoId: string;
  it('pago a proveedor por transferencia desde el banco, y su anulación con movimiento inverso', async () => {
    const pv = await http(app).post('/api/proveedores').set(h).send({ nombre: `Distribuidora ${unico()}` }).expect(201);
    const co = await http(app)
      .post('/api/compras')
      .set(h)
      .send({ proveedorId: pv.body.id, depositoId: base.depositoId, documentoTipo: 'remision', fechaDocumento: hoy(), condicion: 'credito', vencimiento: masDias(10), items: [{ varianteId: base.varianteId, cantidad: 10, costoUnitario: 7000 }] })
      .expect(201);
    // Un pago en efectivo no puede salir del banco.
    await http(app).post('/api/pagos-proveedor').set(h).send({ proveedorId: pv.body.id, fecha: hoy(), medio: 'efectivo', cajaId: base.cajaId, cuentaBancariaId: itau, aplicaciones: [{ cuentaId: co.body.cuenta.id, monto: 1000 }] }).expect(400);
    const p = await http(app).post('/api/pagos-proveedor').set(h).send({ proveedorId: pv.body.id, fecha: hoy(), medio: 'transferencia', cuentaBancariaId: itau, referencia: 'TR-90', aplicaciones: [{ cuentaId: co.body.cuenta.id, monto: 30000 }] }).expect(201);
    pagoId = p.body.id;
    expect((await cuenta(itau)).saldo).toBe('760000.00');
    await http(app).post(`/api/pagos-proveedor/${pagoId}/anular`).set(h).send({ motivo: 'Transferencia rechazada' }).expect(200);
    expect((await cuenta(itau)).saldo).toBe('790000.00');
    const m = await http(app).get(`/api/cuentas-bancarias/${itau}/movimientos`).set(h).expect(200);
    expect(m.body.items.map((x: { tipo: string }) => x.tipo)).toEqual(expect.arrayContaining(['pago_proveedor', 'anulacion']));
    // Se vuelve a pagar para el flujo.
    await http(app).post('/api/pagos-proveedor').set(h).send({ proveedorId: pv.body.id, fecha: hoy(), medio: 'transferencia', cuentaBancariaId: itau, aplicaciones: [{ cuentaId: co.body.cuenta.id, monto: 20000 }] }).expect(201);
  });

  let ventaCredito: { id: string; cuenta: string };
  let clienteId: string;
  it('cobro por transferencia que entra al banco; no puede entrar a caja y banco a la vez', async () => {
    const c = await http(app).post('/api/clientes').set(h).send({ nombre: 'Comercial Norte', documento: '7654321', limiteCredito: 500000, plazoCreditoDias: 5 }).expect(201);
    clienteId = c.body.id;
    const v = await http(app).post('/api/ventas').set(h).send({ claveIdempotencia: unico('bk-'), cajaId: base.cajaId, clienteId, items: [{ varianteId: base.varianteId, cantidad: 4 }], pagos: [], credito: 44000 }).expect(201);
    ventaCredito = { id: v.body.id, cuenta: v.body.cuentaCobrar.id };
    await http(app).post('/api/cobros').set(h).send({ clienteId, fecha: hoy(), medio: 'efectivo', cajaId: base.cajaId, cuentaBancariaId: continental, aplicaciones: [{ cuentaId: ventaCredito.cuenta, monto: 1000 }] }).expect(400);
    const k = await http(app).post('/api/cobros').set(h).send({ clienteId, fecha: hoy(), medio: 'transferencia', cuentaBancariaId: continental, aplicaciones: [{ cuentaId: ventaCredito.cuenta, monto: 14000 }] }).expect(201);
    expect((await cuenta(continental)).saldo).toBe('274000.00');
    await http(app).post(`/api/cobros/${k.body.id}/anular`).set(h).send({ motivo: 'Cheque sin fondos' }).expect(200);
    expect((await cuenta(continental)).saldo).toBe('260000.00');
    await http(app).post('/api/cobros').set(h).send({ clienteId, fecha: hoy(), medio: 'transferencia', cuentaBancariaId: continental, aplicaciones: [{ cuentaId: ventaCredito.cuenta, monto: 14000 }] }).expect(201);
  });

  it('extracto con saldo corrido y conciliación', async () => {
    const m = await http(app).get(`/api/cuentas-bancarias/${continental}/movimientos?desde=${hoy()}`).set(h).expect(200);
    expect(m.body.saldoInicial).toBe('0.00');
    expect(m.body.saldoFinal).toBe('274000.00');
    expect(m.body.items.at(-1).saldo).toBe('274000.00');
    const ids = m.body.items.slice(0, 2).map((x: { id: string }) => x.id);
    await http(app).post('/api/movimientos-bancarios/conciliar').set(h).send({ ids, conciliado: true }).expect(200);
    const c = await cuenta(continental);
    expect(c.sinConciliar).toBe(m.body.items.length - 2);
    expect(c.saldoConciliado).toBe(m.body.items[1].saldo);
    const p = await http(app).get(`/api/cuentas-bancarias/${continental}/movimientos?sinConciliar=true`).set(h).expect(200);
    expect(p.body.items).toHaveLength(m.body.items.length - 2);
    await http(app).post('/api/movimientos-bancarios/conciliar').set(h).send({ ids: ['00000000-0000-7000-8000-000000000000'], conciliado: true }).expect(404);
  });

  it('cuenta inactiva: no admite movimientos nuevos', async () => {
    const x = await http(app).post('/api/cuentas-bancarias').set(h).send({ banco: 'Visión', nombre: 'Cerrada', fechaSaldoInicial: '2026-11-01' }).expect(201);
    await http(app).patch(`/api/cuentas-bancarias/${x.body.id}`).set(h).send({ banco: 'Visión', nombre: 'Cerrada', fechaSaldoInicial: '2026-11-01', activa: false }).expect(200);
    await http(app).post(`/api/cuentas-bancarias/${x.body.id}/movimientos`).set(h).send({ tipo: 'deposito', fecha: hoy(), monto: 100, descripcion: 'No debería' }).expect(400);
  });

  it('flujo de caja: real del período y proyección por vencimientos', async () => {
    const r = await http(app).get(`/api/finanzas/flujo?desde=${hoy()}&hasta=${hoy()}&dias=30`).set(h).expect(200);
    // Ventas al contado: la de prepararVenta (11.000); la venta a crédito no cuenta. Cobros 14.000, ingreso bancario 5.000.
    // Pagos 20.000 (el anulado no cuenta), gasto bancario 15.000.
    expect(r.body.real.totales).toMatchObject({ ventas: '11000.00', cobros: '14000.00', ingresos: '5000.00', pagos: '20000.00', gastos: '15000.00', entradas: '30000.00', salidas: '35000.00', neto: '-5000.00' });
    expect(r.body.real.dias).toHaveLength(1);
    // Proyección: cobrar 30.000 (en 5 días), pagar 50.000 (en 10 días). Bancos: 770.000 + 274.000.
    expect(r.body.proyeccion.saldoBancos).toBe('1044000.00');
    expect(r.body.proyeccion.items).toEqual([
      { fecha: masDias(5), cobrar: '30000.00', pagar: '0.00', acumulado: '1074000.00' },
      { fecha: masDias(10), cobrar: '0.00', pagar: '50000.00', acumulado: '1024000.00' },
    ]);
    await http(app).get(`/api/finanzas/flujo?desde=${hoy()}&hasta=2020-01-01`).set(h).expect(400);
  });
});
