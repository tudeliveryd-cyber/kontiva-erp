import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEmpresa, crearUsuario, http, iniciarApp, login, type EmpresaPrueba } from './ayudas';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());

/**
 * Planilla de octubre de 2026 (salario mínimo 3.044.000, IPS 9 % / 16,5 %):
 * - Ana: mensual 3.600.000, 2 hijos, adelanto 500.000 → bonificación 304.400, IPS 324.000 / 594.000, neto 3.080.400.
 * - Beto: jornalero 117.077 sin IPS, 20 días y 4 horas extra al 50 % → 2.341.540 + 87.808 = 2.429.348.
 * - Carla: mensual 3.044.000, ingresó el 16/10 → 16 días = 1.623.467; IPS 146.112 / 267.872; neto 1.477.355.
 */
describe('RRHH: funcionarios, sueldos, aguinaldo, pago y asientos', () => {
  let app: INestApplication;
  let e: EmpresaPrueba;
  let h: { Authorization: string };
  const f: Record<string, string> = {};
  let octubre: string;

  const funcionario = (datos: object) => ({ sucursalId: e.sucursalId, cargo: 'Vendedor', remuneracion: 'mensual', ...datos });
  const saldo = async (codigo: string) =>
    (await http(app).get(`/api/contabilidad/balance?desde=2026-01-01&hasta=${hoy()}`).set(h).expect(200)).body.filas.find((x: { codigo: string }) => x.codigo === codigo).saldo as string;

  beforeAll(async () => {
    app = await iniciarApp();
    e = await crearEmpresa(app, 'BUSINESS');
    h = auth(e.propietario.token);
  });
  afterAll(() => app.close());

  it('parámetros laborales: vienen los de Paraguay y se pueden ajustar', async () => {
    const c = await http(app).get('/api/rrhh/configuracion').set(h).expect(200);
    expect(c.body).toMatchObject({ salarioMinimo: 3044000, ipsObrero: 9, ipsPatronal: 16.5, personalizado: false });
    const p = await http(app).put('/api/rrhh/configuracion').set(h).send({ salarioMinimo: 3044000, ipsObrero: 9, ipsPatronal: 16.5, bonificacionPct: 5, bonificacionTope: 2 }).expect(200);
    expect(p.body).toMatchObject({ salarioMinimo: '3044000.00', personalizado: true });
  });

  it('legajos: alta, cédula única y permisos', async () => {
    f.ana = (await http(app).post('/api/funcionarios').set(h).send(funcionario({ nombre: 'Ana Benítez', documento: '4111222', fechaIngreso: '2024-03-01', salario: 3600000, hijos: 2, numeroIps: '123456' })).expect(201)).body.id;
    f.beto = (await http(app).post('/api/funcionarios').set(h).send(funcionario({ nombre: 'Beto Giménez', documento: '5222333', cargo: 'Ayudante', fechaIngreso: '2026-02-01', remuneracion: 'jornal', salario: 117077, aseguradoIps: false })).expect(201)).body.id;
    f.carla = (await http(app).post('/api/funcionarios').set(h).send(funcionario({ nombre: 'Carla Ortiz', documento: '6333444', fechaIngreso: '2026-10-16', salario: 3044000 })).expect(201)).body.id;
    await http(app).post('/api/funcionarios').set(h).send(funcionario({ nombre: 'Repetida', documento: '4111222', fechaIngreso: '2026-01-01' })).expect(409);
    const d = await http(app).get(`/api/funcionarios/${f.ana}`).set(h).expect(200);
    expect(d.body).toMatchObject({ nombre: 'Ana Benítez', salario: '3600000.00', activo: true, diasVacaciones: 12 });
    // El cajero no ve legajos; el perfil de RRHH sí, con salarios.
    const caj = await crearUsuario(app, e, 'cajero');
    await http(app).get('/api/funcionarios').set(auth((await login(app, caj.email)).token)).expect(403);
    const rh = await crearUsuario(app, e, 'rrhh');
    const l = await http(app).get('/api/funcionarios').set(auth((await login(app, rh.email)).token)).expect(200);
    expect(l.body).toHaveLength(3);
    expect(l.body[0].salario).toBeDefined();
  });

  it('planilla de octubre: genera, se ajusta y calcula IPS, bonificación, horas extra y descuentos', async () => {
    const l = await http(app).post('/api/liquidaciones').set(h).send({ tipo: 'mensual', periodo: '2026-10' }).expect(201);
    octubre = l.body.id;
    const it = (n: string) => l.body.items.find((x: { funcionarioId: string }) => x.funcionarioId === f[n]);
    expect(it('ana')).toMatchObject({ dias: '30.0000', salarioBase: '3600000.00', bonificacion: '304400.00', ipsObrero: '324000.00', ipsPatronal: '594000.00' });
    expect(it('beto')).toMatchObject({ dias: '0.0000', bruto: '0.00' });
    expect(it('carla')).toMatchObject({ dias: '16.0000', salarioBase: '1623467.00', ipsObrero: '146112.00', ipsPatronal: '267872.00', neto: '1477355.00' });
    await http(app).post('/api/liquidaciones').set(h).send({ tipo: 'mensual', periodo: '2026-10' }).expect(409);
    await http(app).post('/api/liquidaciones').set(h).send({ tipo: 'mensual', periodo: '2027-01' }).expect(400);

    await http(app).patch(`/api/liquidaciones/${octubre}/items`).set(h).send({ funcionarioId: f.beto, dias: 20, horasExtra50: 4 }).expect(200);
    await http(app).patch(`/api/liquidaciones/${octubre}/items`).set(h).send({ funcionarioId: f.ana, descuentos: 99999999 }).expect(400);
    const a = await http(app).patch(`/api/liquidaciones/${octubre}/items`).set(h).send({ funcionarioId: f.ana, descuentos: 500000, detalleDescuentos: 'Adelanto del 15/10' }).expect(200);
    expect(a.body.items.find((x: { funcionarioId: string }) => x.funcionarioId === f.beto)).toMatchObject({ salarioBase: '2341540.00', montoHorasExtra: '87808.00', ipsObrero: '0.00', neto: '2429348.00' });
    expect(a.body.items.find((x: { funcionarioId: string }) => x.funcionarioId === f.ana).neto).toBe('3080400.00');
    expect(a.body.totales).toEqual({ bruto: '7957215.00', ipsObrero: '470112.00', ipsPatronal: '861872.00', descuentos: '500000.00', neto: '6987103.00' });

    const c = await http(app).post(`/api/liquidaciones/${octubre}/confirmar`).set(h).expect(200);
    expect(c.body.estado).toBe('confirmada');
    await http(app).patch(`/api/liquidaciones/${octubre}/items`).set(h).send({ funcionarioId: f.ana, dias: 10 }).expect(409);
  });

  it('asiento de sueldos al cierre del mes y pago desde el banco', async () => {
    await http(app).post('/api/contabilidad/cuentas/plan-sugerido').set(h).expect(201);
    // El plan nuevo ya trae las cuentas de sueldos: completar no agrega nada.
    expect((await http(app).post('/api/contabilidad/cuentas/completar-sugerido').set(h).expect(200)).body).toEqual({ creadas: 0, asignados: 0 });
    expect((await http(app).post('/api/contabilidad/contabilizar').set(h).send({}).expect(200)).body.porTipo).toEqual({ liquidacion: 1 });
    expect(await saldo('5.2.02')).toBe('7957215.00'); // sueldos
    expect(await saldo('5.2.05')).toBe('861872.00'); // aporte patronal
    expect(await saldo('2.1.05')).toBe('-1331984.00'); // IPS a pagar: 470.112 + 861.872
    expect(await saldo('1.1.08')).toBe('-500000.00'); // adelanto descontado
    expect(await saldo('2.1.03')).toBe('-6987103.00'); // sueldos a pagar
    const d = await http(app).get('/api/contabilidad/asientos?desde=2026-10-31&hasta=2026-10-31').set(h).expect(200);
    expect(d.body.items[0].descripcion).toMatch(/octubre de 2026/);

    const cb = await http(app).post('/api/cuentas-bancarias').set(h).send({ banco: 'Itaú', nombre: 'Sueldos', saldoInicial: 10000000, fechaSaldoInicial: '2026-10-01' }).expect(201);
    await http(app).post(`/api/liquidaciones/${octubre}/pagar`).set(h).send({ fecha: hoy(), medio: 'banco' }).expect(400);
    await http(app).post(`/api/liquidaciones/${octubre}/pagar`).set(h).send({ fecha: hoy(), medio: 'banco', cuentaBancariaId: cb.body.id }).expect(200);
    await http(app).post(`/api/liquidaciones/${octubre}/pagar`).set(h).send({ fecha: hoy(), medio: 'banco', cuentaBancariaId: cb.body.id }).expect(409);
    await http(app).post(`/api/liquidaciones/${octubre}/anular`).set(h).send({ motivo: 'Ya está pagada' }).expect(409);
    const cuentas = await http(app).get('/api/cuentas-bancarias').set(h).expect(200);
    expect(cuentas.body[0].saldo).toBe('3012897.00');
    expect((await http(app).post('/api/contabilidad/contabilizar').set(h).send({}).expect(200)).body.porTipo).toEqual({ liquidacion: 1 });
    expect(await saldo('2.1.03')).toBe('0.00');
    // Flujo de caja: el pago de sueldos es una salida.
    const fl = await http(app).get(`/api/finanzas/flujo?desde=${hoy()}&hasta=${hoy()}`).set(h).expect(200);
    expect(fl.body.real.totales.sueldos).toBe('6987103.00');
  });

  it('el mes en curso se contabiliza recién al terminar; una planilla sin pagar se anula', async () => {
    await http(app).post(`/api/funcionarios/${f.carla}/baja`).set(h).send({ fechaEgreso: '2026-10-31', motivo: 'Renuncia' }).expect(200);
    await http(app).post(`/api/funcionarios/${f.carla}/baja`).set(h).send({ fechaEgreso: '2026-10-31', motivo: 'Otra vez' }).expect(409);
    const mes = hoy().slice(0, 7);
    const l = await http(app).post('/api/liquidaciones').set(h).send({ tipo: 'mensual', periodo: mes }).expect(201);
    // Carla ya no está; Beto (jornalero sin días) se descarta al confirmar.
    expect(l.body.items.map((x: { funcionarioId: string }) => x.funcionarioId).sort()).toEqual([f.ana, f.beto].sort());
    const c = await http(app).post(`/api/liquidaciones/${l.body.id}/confirmar`).set(h).expect(200);
    expect(c.body.items).toHaveLength(1);
    const est = await http(app).get('/api/contabilidad/estado').set(h).expect(200);
    expect(est.body.pendientes.total).toBe(0); // se devenga el último día del mes
    await http(app).post(`/api/liquidaciones/${l.body.id}/anular`).set(h).send({ motivo: 'Se rehace' }).expect(200);
    await http(app).post('/api/liquidaciones').set(h).send({ tipo: 'mensual', periodo: mes }).expect(201);
  });

  it('aguinaldo: lo cobrado en el año dividido 12, sin IPS', async () => {
    const a = await http(app).post('/api/liquidaciones').set(h).send({ tipo: 'aguinaldo', anio: 2026 }).expect(201);
    const it = (n: string) => a.body.items.find((x: { funcionarioId: string }) => x.funcionarioId === f[n]);
    expect(it('ana')).toMatchObject({ bruto: '300000.00', ipsObrero: '0.00' }); // 3.600.000 / 12 (sin la bonificación)
    expect(it('beto').bruto).toBe('202446.00');
    expect(it('carla').bruto).toBe('135289.00'); // salió en octubre, igual le corresponde
    await http(app).patch(`/api/liquidaciones/${a.body.id}/items`).set(h).send({ funcionarioId: f.carla, monto: 140000 }).expect(200);
    const c = await http(app).post(`/api/liquidaciones/${a.body.id}/confirmar`).set(h).expect(200);
    expect(c.body.totales).toMatchObject({ bruto: '642446.00', ipsObrero: '0.00', neto: '642446.00' });
    expect((await http(app).post('/api/contabilidad/contabilizar').set(h).send({}).expect(200)).body.porTipo).toEqual({ liquidacion: 1 });
    expect(await saldo('5.2.02')).toBe(String(7957215 + 642446) + '.00');
  });

  it('el legajo muestra su historial de liquidaciones', async () => {
    const d = await http(app).get(`/api/funcionarios/${f.ana}`).set(h).expect(200);
    expect(d.body.liquidaciones.map((l: { tipo: string }) => l.tipo)).toEqual(expect.arrayContaining(['mensual', 'aguinaldo']));
    expect(d.body.liquidaciones.find((l: { tipo: string; periodo: string }) => l.tipo === 'mensual' && l.periodo === '2026-10-01')).toMatchObject({ pagada: true, neto: '3080400.00' });
    const bajas = await http(app).get('/api/funcionarios?estado=bajas').set(h).expect(200);
    expect(bajas.body.map((x: { nombre: string }) => x.nombre)).toEqual(['Carla Ortiz']);
  });
});
