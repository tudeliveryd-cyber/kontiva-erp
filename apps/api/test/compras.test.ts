import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEmpresa, crearUsuario, http, iniciarApp, login, prepararVenta, rucValido, unico, type EmpresaPrueba } from './ayudas';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Compras y cuentas a pagar', () => {
  let app: INestApplication;
  let e: EmpresaPrueba;
  let h: { Authorization: string };
  let base: Awaited<ReturnType<typeof prepararVenta>>; // costo 7.000, stock 10 − 1 vendido
  let prov: { id: string; nombre: string };
  const rucProv = rucValido();

  const stock = async () => {
    const r = await http(app).get(`/api/stock?depositoId=${base.depositoId}`).set(h).expect(200);
    return Number(r.body.find((x: { varianteId: string }) => x.varianteId === base.varianteId).cantidad);
  };
  const costo = async () => {
    const r = await http(app).get(`/api/productos/${base.productoId}`).set(h).expect(200);
    return r.body.variantes[0].costo;
  };
  const compra = (extra: object = {}) =>
    http(app)
      .post('/api/compras')
      .set(h)
      .send({ proveedorId: prov.id, depositoId: base.depositoId, documentoTipo: 'factura', timbrado: '15500011', documentoNumero: `001-002-${String(Math.floor(Math.random() * 9999999)).padStart(7, '0')}`, fechaDocumento: '2026-11-10', condicion: 'credito', items: [{ varianteId: base.varianteId, cantidad: 9, costoUnitario: 8000 }], ...extra });

  beforeAll(async () => {
    app = await iniciarApp();
    e = await crearEmpresa(app, 'BUSINESS');
    h = auth(e.propietario.token);
    base = await prepararVenta(app, e, 10);
  });
  afterAll(() => app.close());

  it('proveedores: alta, RUC único, búsqueda y edición', async () => {
    const r = await http(app).post('/api/proveedores').set(h).send({ nombre: 'Distribuidora del Este SA', ruc: rucProv, plazoPagoDias: 30, telefono: '0981 111 222' }).expect(201);
    prov = r.body;
    await http(app).post('/api/proveedores').set(h).send({ nombre: 'Otra', ruc: rucProv }).expect(409);
    const l = await http(app).get('/api/proveedores?q=distrib').set(h).expect(200);
    expect(l.body[0]).toMatchObject({ nombre: 'Distribuidora del Este SA', saldo: '0.00', plazoPagoDias: 30 });
    await http(app).patch(`/api/proveedores/${prov.id}`).set(h).send({ nombre: 'Distribuidora del Este SA', ruc: rucProv, plazoPagoDias: 15 }).expect(200);
  });

  it('compra a crédito: stock, costo promedio ponderado y cuenta a pagar con el plazo del proveedor', async () => {
    expect(await stock()).toBe(9);
    expect(await costo()).toBe('7000.00');
    const r = await compra({ documentoNumero: '001-002-0000123' }).expect(201);
    expect(r.body).toMatchObject({ numero: 1, total: '72000.00', iva10: '6545.00', condicion: 'credito', vencimiento: '2026-11-25', cuenta: { estado: 'pendiente', saldo: '72000.00' } });
    expect(await stock()).toBe(18);
    // (9 × 7.000 + 72.000) / 18 = 7.500
    expect(await costo()).toBe('7500.00');
    const mov = await http(app).get(`/api/stock/movimientos?depositoId=${base.depositoId}&varianteId=${base.varianteId}`).set(h);
    if (mov.status === 200) expect(JSON.stringify(mov.body)).toContain('compra');
    // La misma factura no se carga dos veces.
    const rep = await compra({ documentoNumero: '001-002-0000123' }).expect(409);
    expect(rep.body.codigo).toBe('FACTURA_REPETIDA');
    // Validaciones del documento.
    await compra({ timbrado: null }).expect(400);
    await compra({ documentoTipo: 'factura_electronica', cdc: null, timbrado: null }).expect(400);
  });

  let ordenId: string;
  it('orden de compra: borrador, aprobación y recepción parcial y total', async () => {
    const o = await http(app).post('/api/ordenes-compra').set(h).send({ proveedorId: prov.id, depositoId: base.depositoId, items: [{ varianteId: base.varianteId, cantidad: 10, costoUnitario: 7600 }] }).expect(201);
    ordenId = o.body.id;
    expect(o.body).toMatchObject({ numero: 1, estado: 'borrador', total: '76000.00' });
    await http(app).patch(`/api/ordenes-compra/${ordenId}`).set(h).send({ proveedorId: prov.id, depositoId: base.depositoId, items: [{ varianteId: base.varianteId, cantidad: 12, costoUnitario: 7600 }] }).expect(200);
    // Sin enviar no se recibe.
    await compra({ ordenId, items: [{ varianteId: base.varianteId, cantidad: 2, costoUnitario: 7600, ordenLinea: 1 }] }).expect(409);
    const env = await http(app).post(`/api/ordenes-compra/${ordenId}/enviar`).set(h).send({}).expect(200);
    expect(env.body.estado).toBe('enviada');
    await http(app).patch(`/api/ordenes-compra/${ordenId}`).set(h).send({ proveedorId: prov.id, depositoId: base.depositoId, items: [{ varianteId: base.varianteId, cantidad: 1, costoUnitario: 1 }] }).expect(409);
    await compra({ ordenId, items: [{ varianteId: base.varianteId, cantidad: 5, costoUnitario: 7600, ordenLinea: 1 }] }).expect(201);
    let v = await http(app).get(`/api/ordenes-compra/${ordenId}`).set(h).expect(200);
    expect(v.body).toMatchObject({ estado: 'parcial', items: [{ cantidadRecibida: '5.0000', pendiente: '7.0000' }] });
    await compra({ ordenId, items: [{ varianteId: base.varianteId, cantidad: 8, costoUnitario: 7600, ordenLinea: 1 }] }).expect(400);
    await compra({ ordenId, items: [{ varianteId: base.varianteId, cantidad: 7, costoUnitario: 7600, ordenLinea: 1 }] }).expect(201);
    v = await http(app).get(`/api/ordenes-compra/${ordenId}`).set(h).expect(200);
    expect(v.body.estado).toBe('recibida');
    await http(app).post(`/api/ordenes-compra/${ordenId}/cancelar`).set(h).send({ motivo: 'Ya no' }).expect(409);
  });

  it('compra al contado pagada en efectivo desde la caja abierta', async () => {
    const antes = await http(app).get(`/api/cajas`).set(h).expect(200);
    const r = await compra({ condicion: 'contado', items: [{ varianteId: base.varianteId, cantidad: 1, costoUnitario: 20000 }], pago: { medio: 'efectivo', cajaId: base.cajaId } }).expect(201);
    expect(r.body.cuenta).toMatchObject({ estado: 'pagada', saldo: '0.00' });
    // La caja tenía 100.000 + 11.000 de la venta; sin suficiente efectivo, no deja pagar.
    const sin = await compra({ condicion: 'contado', items: [{ varianteId: base.varianteId, cantidad: 10, costoUnitario: 50000 }], pago: { medio: 'efectivo', cajaId: base.cajaId } }).expect(409);
    expect(sin.body.codigo).toBe('SALDO_INSUFICIENTE');
    expect(antes.body.length).toBeGreaterThan(0);
  });

  it('cuentas a pagar: resumen, pagos parciales, pago total y anulación de un pago', async () => {
    const res = await http(app).get('/api/cuentas-pagar/resumen').set(h).expect(200);
    expect(Number(res.body.abierto)).toBe(72000 + 38000 + 53200);
    const l = await http(app).get(`/api/cuentas-pagar?proveedorId=${prov.id}`).set(h).expect(200);
    const primera = l.body.find((c: { descripcion: string }) => c.descripcion.includes('0000123'));
    expect(primera).toMatchObject({ saldo: '72000.00', vencimiento: '2026-11-25' });
    const p1 = await http(app).post('/api/pagos-proveedor').set(h).send({ proveedorId: prov.id, fecha: '2026-11-12', medio: 'transferencia', referencia: 'TRX-1', aplicaciones: [{ cuentaId: primera.id, monto: 30000 }] }).expect(201);
    expect(p1.body.total).toBe('30000.00');
    await http(app).post('/api/pagos-proveedor').set(h).send({ proveedorId: prov.id, fecha: '2026-11-12', medio: 'transferencia', aplicaciones: [{ cuentaId: primera.id, monto: 50000 }] }).expect(400);
    let c = (await http(app).get(`/api/cuentas-pagar?estado=todas&proveedorId=${prov.id}`).set(h)).body.find((x: { id: string }) => x.id === primera.id);
    expect(c).toMatchObject({ estado: 'parcial', saldo: '42000.00' });
    await http(app).post('/api/pagos-proveedor').set(h).send({ proveedorId: prov.id, fecha: '2026-11-12', medio: 'cheque', aplicaciones: [{ cuentaId: primera.id, monto: 42000 }] }).expect(201);
    c = (await http(app).get(`/api/cuentas-pagar?estado=pagadas`).set(h)).body.find((x: { id: string }) => x.id === primera.id);
    expect(c.estado).toBe('pagada');
    await http(app).post(`/api/pagos-proveedor/${p1.body.id}/anular`).set(h).send({ motivo: 'Transferencia rebotada' }).expect(200);
    c = (await http(app).get(`/api/cuentas-pagar?estado=todas`).set(h)).body.find((x: { id: string }) => x.id === primera.id);
    expect(c).toMatchObject({ estado: 'parcial', saldo: '30000.00' });
    await http(app).post(`/api/pagos-proveedor/${p1.body.id}/anular`).set(h).send({ motivo: 'Otra vez' }).expect(409);
    const prov2 = await http(app).get('/api/proveedores').set(h).expect(200);
    expect(prov2.body.find((p: { id: string }) => p.id === prov.id).saldo).toBe(String((30000 + 38000 + 53200).toFixed(2)));
  });

  it('anular compra: con pagos no; sin pagos revierte el stock', async () => {
    const lista = await http(app).get('/api/compras').set(h).expect(200);
    const pagada = lista.body.find((x: { numero: number }) => x.numero === 1);
    const r = await http(app).post(`/api/compras/${pagada.id}/anular`).set(h).send({ motivo: 'Error' }).expect(409);
    expect(r.body.codigo).toBe('COMPRA_CON_PAGOS');
    const antes = await stock();
    const nueva = await compra({ items: [{ varianteId: base.varianteId, cantidad: 3, costoUnitario: 7500 }] }).expect(201);
    expect(await stock()).toBe(antes + 3);
    const an = await http(app).post(`/api/compras/${nueva.body.id}/anular`).set(h).send({ motivo: 'Cargada por error' }).expect(200);
    expect(an.body).toMatchObject({ estado: 'anulada', cuenta: { estado: 'anulada' } });
    expect(await stock()).toBe(antes);
  });

  it('cuenta manual de un servicio y su anulación', async () => {
    const c = await http(app).post('/api/cuentas-pagar').set(h).send({ proveedorId: prov.id, descripcion: 'Flete de noviembre', fecha: '2026-11-01', vencimiento: '2026-11-05', monto: 150000 }).expect(201);
    const v = await http(app).get('/api/cuentas-pagar?estado=vencidas').set(h).expect(200);
    expect(v.body.find((x: { id: string }) => x.id === c.body.id)).toMatchObject({ vencida: true });
    await http(app).post(`/api/cuentas-pagar/${c.body.id}/anular`).set(h).send({}).expect(200);
  });

  it('permisos: el comprador no registra compras; quien no ve costos no ve importes', async () => {
    const comp = await crearUsuario(app, e, 'comprador');
    const tc = (await login(app, comp.email)).token;
    await http(app).post('/api/compras').set(auth(tc)).send({}).expect(403);
    await http(app).post('/api/ordenes-compra').set(auth(tc)).send({ proveedorId: prov.id, depositoId: base.depositoId, items: [{ varianteId: base.varianteId, cantidad: 1, costoUnitario: 1 }] }).expect(201);
    const st = await crearUsuario(app, e, 'stock');
    const ts = (await login(app, st.email)).token;
    const l = await http(app).get('/api/compras').set(auth(ts)).expect(200);
    expect(l.body[0].total).toBeNull();
    const prod = await http(app).get(`/api/compras/productos?q=Producto`).set(auth(ts)).expect(200);
    expect(prod.body[0].costo).toBeNull();
    // Registrar el pago al contado requiere el permiso de pagos.
    await http(app)
      .post('/api/compras')
      .set(auth(ts))
      .send({ proveedorId: prov.id, depositoId: base.depositoId, documentoTipo: 'remision', fechaDocumento: '2026-11-12', condicion: 'contado', pago: { medio: 'transferencia' }, items: [{ varianteId: base.varianteId, cantidad: 1, costoUnitario: 1000 }] })
      .expect(403);
    const sin = await http(app)
      .post('/api/compras')
      .set(auth(ts))
      .send({ proveedorId: prov.id, depositoId: base.depositoId, documentoTipo: 'remision', fechaDocumento: '2026-11-12', condicion: 'contado', items: [{ varianteId: base.varianteId, cantidad: 1, costoUnitario: 1000 }], nota: unico() })
      .expect(201);
    expect(sin.body.cuenta.estado).toBe('pendiente');
  });
});
