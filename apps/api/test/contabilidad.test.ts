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

describe('Contabilidad: plan de cuentas, asientos automáticos, libros y cierres', () => {
  let app: INestApplication;
  let e: EmpresaPrueba;
  let h: { Authorization: string };
  let base: Awaited<ReturnType<typeof prepararVenta>>; // venta de 11.000 en efectivo (IVA 10 %, costo 7.000)
  const cta: Record<string, string> = {};

  const balance = async (desde = '2026-01-01', hasta = hoy()) => (await http(app).get(`/api/contabilidad/balance?desde=${desde}&hasta=${hasta}`).set(h).expect(200)).body;
  const saldo = async (codigo: string) => (await balance()).filas.find((f: { codigo: string }) => f.codigo === codigo).saldo as string;
  const contabilizar = async () => (await http(app).post('/api/contabilidad/contabilizar').set(h).send({}).expect(200)).body;

  beforeAll(async () => {
    app = await iniciarApp();
    e = await crearEmpresa(app, 'BUSINESS');
    h = auth(e.propietario.token);
    base = await prepararVenta(app, e, 100);
  });
  afterAll(() => app.close());

  it('sin plan de cuentas no contabiliza; el plan sugerido asigna todos los conceptos', async () => {
    const est = await http(app).get('/api/contabilidad/estado').set(h).expect(200);
    expect(est.body).toMatchObject({ tienePlan: false, cerradoHasta: null });
    expect(est.body.pendientes.total).toBeGreaterThan(0);
    const r = await http(app).post('/api/contabilidad/contabilizar').set(h).send({}).expect(409);
    expect(r.body.codigo).toBe('CONFIGURACION_INCOMPLETA');
    await http(app).post('/api/contabilidad/cuentas/plan-sugerido').set(h).expect(201);
    await http(app).post('/api/contabilidad/cuentas/plan-sugerido').set(h).expect(409);
    const p = await http(app).get('/api/contabilidad/cuentas').set(h).expect(200);
    for (const c of p.body.cuentas) cta[c.codigo] = c.id;
    expect(p.body.conceptos.every((c: { cuentaId: string | null }) => c.cuentaId)).toBe(true);
    expect((await http(app).get('/api/contabilidad/estado').set(h).expect(200)).body.faltanConceptos).toEqual([]);
  });

  it('el cajero no ve la contabilidad; el contador sí, pero no cambia el plan... salvo con contabilidad.aprobar', async () => {
    const caj = await crearUsuario(app, e, 'cajero');
    await http(app).get('/api/contabilidad/cuentas').set(auth((await login(app, caj.email)).token)).expect(403);
    const con = await crearUsuario(app, e, 'contador');
    const tc = (await login(app, con.email)).token;
    await http(app).get('/api/contabilidad/balance?desde=2026-01-01&hasta=2026-12-31').set(auth(tc)).expect(200);
  });

  it('plan de cuentas: subcuentas bajo un grupo, sin duplicados ni hijas de cuentas imputables', async () => {
    const r = await http(app).post('/api/contabilidad/cuentas').set(h).send({ codigo: '1.1.08', nombre: 'Fondo fijo', imputable: true }).expect(201);
    cta['1.1.08'] = r.body.id;
    await http(app).post('/api/contabilidad/cuentas').set(h).send({ codigo: '1.1.08', nombre: 'Otra', imputable: true }).expect(409);
    await http(app).post('/api/contabilidad/cuentas').set(h).send({ codigo: '1.1.01.1', nombre: 'Hija de caja', imputable: true }).expect(400);
    await http(app).post('/api/contabilidad/cuentas').set(h).send({ codigo: '7.1.01', nombre: 'Sin padre', imputable: true }).expect(400);
    await http(app).post('/api/contabilidad/cuentas').set(h).send({ codigo: '1.1.x', nombre: 'Código inválido', imputable: true }).expect(400);
    // Una cuenta asignada a un concepto no se desactiva.
    await http(app).patch(`/api/contabilidad/cuentas/${cta['1.1.01']}`).set(h).send({ codigo: '1.1.01', nombre: 'Caja', imputable: true, activa: false }).expect(409);
    await http(app).patch(`/api/contabilidad/cuentas/${cta['1.1.08']}`).set(h).send({ codigo: '1.1.08', nombre: 'Fondo fijo de caja', imputable: true }).expect(200);
  });

  let pagoId: string;
  it('contabiliza ventas, compras, pagos, cobros y movimientos bancarios', async () => {
    // Compra a crédito: 10 × 7.000 = 70.000 (IVA 10 % incluido: 6.364).
    const pv = await http(app).post('/api/proveedores').set(h).send({ nombre: `Mayorista ${unico()}` }).expect(201);
    const co = await http(app)
      .post('/api/compras')
      .set(h)
      .send({ proveedorId: pv.body.id, depositoId: base.depositoId, documentoTipo: 'factura', timbrado: '12345678', documentoNumero: '001-001-0000123', fechaDocumento: hoy(), condicion: 'credito', vencimiento: masDias(30), items: [{ varianteId: base.varianteId, cantidad: 10, costoUnitario: 7000 }] })
      .expect(201);
    // Pago parcial desde el banco.
    const cb = await http(app).post('/api/cuentas-bancarias').set(h).send({ banco: 'Itaú', nombre: 'Cuenta corriente', saldoInicial: 0, fechaSaldoInicial: hoy() }).expect(201);
    const p = await http(app).post('/api/pagos-proveedor').set(h).send({ proveedorId: pv.body.id, fecha: hoy(), medio: 'transferencia', cuentaBancariaId: cb.body.id, aplicaciones: [{ cuentaId: co.body.cuenta.id, monto: 20000 }] }).expect(201);
    pagoId = p.body.id;
    await http(app).post(`/api/cuentas-bancarias/${cb.body.id}/movimientos`).set(h).send({ tipo: 'gasto', fecha: hoy(), monto: 5000, descripcion: 'Comisión' }).expect(201);
    // Venta a crédito de 44.000 y cobro de 14.000 en efectivo.
    const cl = await http(app).post('/api/clientes').set(h).send({ nombre: 'Comercial Sur', documento: '5554443', limiteCredito: 500000, plazoCreditoDias: 10 }).expect(201);
    const v = await http(app).post('/api/ventas').set(h).send({ claveIdempotencia: unico('ct-'), cajaId: base.cajaId, clienteId: cl.body.id, items: [{ varianteId: base.varianteId, cantidad: 4 }], pagos: [], credito: 44000 }).expect(201);
    await http(app).post('/api/cobros').set(h).send({ clienteId: cl.body.id, fecha: hoy(), medio: 'efectivo', cajaId: base.cajaId, aplicaciones: [{ cuentaId: v.body.cuentaCobrar.id, monto: 14000 }] }).expect(201);

    const r = await contabilizar();
    expect(r.porTipo).toEqual({ venta: 2, compra: 1, pago_proveedor: 1, cobro: 1, movimiento_bancario: 1 });
    // Idempotente: una segunda vez no genera nada.
    expect((await contabilizar()).generados).toBe(0);
    expect((await http(app).get('/api/contabilidad/estado').set(h).expect(200)).body.pendientes.total).toBe(0);

    expect(await saldo('1.1.01')).toBe('25000.00'); // caja: 11.000 + 14.000
    expect(await saldo('1.1.03')).toBe('-25000.00'); // bancos: −20.000 −5.000
    expect(await saldo('1.1.05')).toBe('30000.00'); // deudores: 44.000 − 14.000
    expect(await saldo('1.1.06')).toBe('6364.00'); // IVA crédito
    expect(await saldo('2.1.01')).toBe('-50000.00'); // proveedores: 70.000 − 20.000
    expect(await saldo('2.1.02')).toBe('-5000.00'); // IVA débito: 1.000 + 4.000
    expect(await saldo('4.1.01')).toBe('-50000.00'); // ventas netas: 10.000 + 40.000
    expect(await saldo('5.1.01')).toBe('31819.00'); // costo sin IVA, redondeado por venta: 6.364 + 25.455
    expect(await saldo('5.3.01')).toBe('5000.00');
  });

  it('el balance cuadra: debe = haber y activo = pasivo + patrimonio + resultado', async () => {
    const b = await balance();
    expect(b.totales.debe).toBe(b.totales.haber);
    expect(Number(b.activo)).toBe(Number(b.pasivo) + Number(b.patrimonio) + Number(b.resultadoAcumulado));
    expect(b.resultadoPeriodo).toBe('13181.00'); // 50.000 − 31.819 − 5.000
    // Los grupos acumulan a sus subcuentas.
    const grupo = b.filas.find((f: { codigo: string }) => f.codigo === '4');
    expect(grupo.saldo).toBe('-50000.00');
  });

  it('las anulaciones generan el asiento inverso', async () => {
    await http(app).post(`/api/pagos-proveedor/${pagoId}/anular`).set(h).send({ motivo: 'Transferencia rechazada' }).expect(200);
    await http(app).post(`/api/ventas/${base.ventaId}/anular`).set(h).send({ motivo: 'Error de carga' }).expect(200);
    const r = await contabilizar();
    expect(r.porTipo).toEqual({ pago_proveedor: 1, venta: 1 });
    expect(await saldo('2.1.01')).toBe('-70000.00');
    expect(await saldo('1.1.03')).toBe('-5000.00');
    expect(await saldo('4.1.01')).toBe('-40000.00');
    const d = await http(app).get(`/api/contabilidad/asientos?desde=${hoy()}&hasta=${hoy()}`).set(h).expect(200);
    expect(d.body.items.some((a: { origen: string }) => a.origen === 'venta_anulacion')).toBe(true);
  });

  it('libro mayor con saldo corrido', async () => {
    const m = await http(app).get(`/api/contabilidad/mayor?cuentaId=${cta['2.1.01']}&desde=${hoy()}&hasta=${hoy()}`).set(h).expect(200);
    expect(m.body).toMatchObject({ saldoInicial: '0.00', debe: '20000.00', haber: '90000.00', saldoFinal: '-70000.00' });
    expect(m.body.items.at(-1).saldo).toBe('-70000.00');
    // El mayor de un grupo incluye sus subcuentas.
    const g = await http(app).get(`/api/contabilidad/mayor?cuentaId=${cta['2.1']}&desde=${hoy()}&hasta=${hoy()}`).set(h).expect(200);
    expect(g.body.saldoFinal).toBe('-74000.00'); // proveedores −70.000 e IVA débito −4.000
  });

  let manualId: string;
  it('asientos manuales: balanceados, en cuentas imputables, y se anulan con el inverso', async () => {
    const mal = await http(app).post('/api/contabilidad/asientos').set(h).send({ fecha: hoy(), descripcion: 'Desbalanceado', lineas: [{ cuentaId: cta['1.1.01'], debe: 100 }, { cuentaId: cta['3.1.01'], haber: 90 }] }).expect(400);
    expect(JSON.stringify(mal.body)).toMatch(/debe y el haber/);
    await http(app).post('/api/contabilidad/asientos').set(h).send({ fecha: hoy(), descripcion: 'En un grupo', lineas: [{ cuentaId: cta['1.1'], debe: 100 }, { cuentaId: cta['3.1.01'], haber: 100 }] }).expect(400);
    await http(app).post('/api/contabilidad/asientos').set(h).send({ fecha: masDias(1), descripcion: 'Futuro', lineas: [{ cuentaId: cta['1.1.01'], debe: 100 }, { cuentaId: cta['3.1.01'], haber: 100 }] }).expect(400);
    const a = await http(app)
      .post('/api/contabilidad/asientos')
      .set(h)
      .send({ fecha: hoy(), descripcion: 'Aporte inicial de capital', lineas: [{ cuentaId: cta['1.1.03'], debe: 1000000, detalle: 'Depósito del socio' }, { cuentaId: cta['3.1.01'], haber: 1000000 }] })
      .expect(201);
    manualId = a.body.id;
    expect(a.body).toMatchObject({ origen: 'manual', estado: 'confirmado', total: '1000000.00' });
    expect(await saldo('3.1.01')).toBe('-1000000.00');
    await http(app).post(`/api/contabilidad/asientos/${manualId}/anular`).set(h).send({ motivo: 'Monto equivocado' }).expect(200);
    await http(app).post(`/api/contabilidad/asientos/${manualId}/anular`).set(h).send({ motivo: 'Otra vez' }).expect(409);
    expect(await saldo('3.1.01')).toBe('0.00');
    const auto = (await http(app).get(`/api/contabilidad/asientos?desde=${hoy()}&hasta=${hoy()}&origen=automatico`).set(h).expect(200)).body.items[0];
    await http(app).post(`/api/contabilidad/asientos/${auto.id}/anular`).set(h).send({ motivo: 'No se puede' }).expect(400);
    // Una cuenta con movimientos no cambia de imputable a grupo.
    await http(app).patch(`/api/contabilidad/cuentas/${cta['3.1.01']}`).set(h).send({ codigo: '3.1.01', nombre: 'Capital social', imputable: false }).expect(409);
  });

  it('en cada contabilización los asientos se numeran en orden de fecha', async () => {
    const pv = await http(app).post('/api/proveedores').set(h).send({ nombre: `Orden ${unico()}` }).expect(201);
    // Se carga primero un gasto de hoy y después una compra de hace tres días.
    await http(app).post('/api/cuentas-pagar').set(h).send({ proveedorId: pv.body.id, descripcion: 'Flete', fecha: hoy(), vencimiento: masDias(5), monto: 15000 }).expect(201);
    await http(app).post('/api/compras').set(h).send({ proveedorId: pv.body.id, depositoId: base.depositoId, documentoTipo: 'remision', fechaDocumento: masDias(-3), condicion: 'credito', vencimiento: masDias(5), items: [{ varianteId: base.varianteId, cantidad: 1, costoUnitario: 7000 }] }).expect(201);
    expect((await contabilizar()).porTipo).toEqual({ cuenta_pagar: 1, compra: 1 });
    const d = (await http(app).get(`/api/contabilidad/asientos?desde=${masDias(-3)}&hasta=${hoy()}&origen=automatico`).set(h).expect(200)).body.items as { numero: number; origen: string }[];
    const compra = d.filter((a) => a.origen === 'compra').at(-1)!;
    const flete = d.find((a) => a.origen === 'cuenta_pagar')!;
    expect(compra.numero).toBeLessThan(flete.numero);
    expect(await saldo('5.2.01')).toBe('15000.00');
  });

  it('cierre de período: bloquea asientos en fechas cerradas; los documentos atrasados pasan al primer día abierto', async () => {
    await http(app).post('/api/contabilidad/cierre').set(h).send({ hasta: hoy() }).expect(400);
    const ayer = masDias(-1);
    await http(app).post('/api/contabilidad/cierre').set(h).send({ hasta: ayer, motivo: 'Cierre mensual' }).expect(200);
    await http(app).post('/api/contabilidad/cierre').set(h).send({ hasta: masDias(-2) }).expect(400);
    const r = await http(app).post('/api/contabilidad/asientos').set(h).send({ fecha: ayer, descripcion: 'En período cerrado', lineas: [{ cuentaId: cta['1.1.01'], debe: 1 }, { cuentaId: cta['3.1.01'], haber: 1 }] }).expect(409);
    expect(r.body.codigo).toBe('PERIODO_CERRADO');
    // Una compra cargada hoy con fecha de ayer se contabiliza hoy, con la fecha original en la descripción.
    const pv = await http(app).post('/api/proveedores').set(h).send({ nombre: `Atrasado ${unico()}` }).expect(201);
    await http(app).post('/api/compras').set(h).send({ proveedorId: pv.body.id, depositoId: base.depositoId, documentoTipo: 'remision', fechaDocumento: ayer, condicion: 'credito', vencimiento: masDias(5), items: [{ varianteId: base.varianteId, cantidad: 1, costoUnitario: 7000 }] }).expect(201);
    expect((await contabilizar()).porTipo).toEqual({ compra: 1 });
    const d = await http(app).get(`/api/contabilidad/asientos?desde=${hoy()}&hasta=${hoy()}`).set(h).expect(200);
    expect(d.body.items.find((a: { descripcion: string }) => a.descripcion.includes('fecha original'))).toBeDefined();
    // Reapertura con motivo.
    await http(app).post('/api/contabilidad/cierre/reabrir').set(h).send({ hasta: null, motivo: 'x' }).expect(400);
    await http(app).post('/api/contabilidad/cierre/reabrir').set(h).send({ hasta: null, motivo: 'Corrección de un asiento de ayer' }).expect(200);
    const est = await http(app).get('/api/contabilidad/estado').set(h).expect(200);
    expect(est.body.cerradoHasta).toBeNull();
    expect(est.body.cierres.map((c: { accion: string }) => c.accion)).toEqual(['reapertura', 'cierre']);
  });

  it('devoluciones: revierten venta, IVA y costo; descuentan deuda o reintegran efectivo', async () => {
    const cl = await http(app).post('/api/clientes').set(h).send({ nombre: 'Cliente Devolución', documento: '3332221', limiteCredito: 100000 }).expect(201);
    const v = await http(app).post('/api/ventas').set(h).send({ claveIdempotencia: unico('dv-'), cajaId: base.cajaId, clienteId: cl.body.id, items: [{ varianteId: base.varianteId, cantidad: 2 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 11000 }], credito: 11000 }).expect(201);
    await contabilizar();
    const antes = await balance();
    const s0 = (c: string) => Number(antes.filas.find((f: { codigo: string }) => f.codigo === c).saldo);
    // Primera devolución: descuenta la deuda; segunda: se reintegra en efectivo.
    await http(app).post('/api/devoluciones').set(h).send({ ventaId: v.body.id, cajaId: base.cajaId, motivo: 'Fallado', items: [{ linea: 1, cantidad: 1 }] }).expect(201);
    await http(app).post('/api/devoluciones').set(h).send({ ventaId: v.body.id, cajaId: base.cajaId, motivo: 'Fallado', items: [{ linea: 1, cantidad: 1 }] }).expect(201);
    expect((await contabilizar()).porTipo).toEqual({ devolucion: 2 });
    const b = await balance();
    const s1 = (c: string) => Number(b.filas.find((f: { codigo: string }) => f.codigo === c).saldo);
    expect(s1('4.1.02') - s0('4.1.02')).toBe(20000); // devoluciones sobre ventas (neto)
    expect(s1('2.1.02') - s0('2.1.02')).toBe(2000); // IVA débito revertido
    expect(s1('1.1.05') - s0('1.1.05')).toBe(-11000); // deuda descontada
    expect(s1('1.1.01') - s0('1.1.01')).toBe(-11000); // efectivo reintegrado
    expect(s1('5.1.01') - s0('5.1.01')).toBe(-12728); // costo devuelto: 2 × 6.364
    expect(b.totales.debe).toBe(b.totales.haber);
  });

  it('una cuenta bancaria puede tener su propia cuenta contable', async () => {
    const r = await http(app).post('/api/contabilidad/cuentas').set(h).send({ codigo: '1.1.09', nombre: 'Banco Continental', imputable: true }).expect(201);
    const cb = await http(app).post('/api/cuentas-bancarias').set(h).send({ banco: 'Continental', nombre: 'Caja de ahorro', fechaSaldoInicial: hoy() }).expect(201);
    await http(app).put('/api/contabilidad/conceptos').set(h).send({ bancos: { [cb.body.id]: cta['1.1'] } }).expect(400);
    await http(app).put('/api/contabilidad/conceptos').set(h).send({ bancos: { [cb.body.id]: r.body.id } }).expect(200);
    await http(app).post(`/api/cuentas-bancarias/${cb.body.id}/movimientos`).set(h).send({ tipo: 'ingreso', fecha: hoy(), monto: 3000, descripcion: 'Intereses' }).expect(201);
    await contabilizar();
    expect(await saldo('1.1.09')).toBe('3000.00');
    expect(await saldo('4.2.01')).toBe('-3000.00');
  });
});
