import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEmpresa, crearUsuario, http, iniciarApp, login, type EmpresaPrueba } from './ayudas';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/**
 * Asistencia, vacaciones y liquidación final.
 * Diego: mensual 4.500.000 desde el 15/03/2021, despedido sin causa el 10/11/2026 (5 años, 7 meses):
 * jornal 150.000; preaviso legal 60 días; indemnización 6 × 15 = 90 días; vacaciones 5 períodos × 12 = 60 días.
 */
describe('RRHH: asistencia, vacaciones y liquidación final', () => {
  let app: INestApplication;
  let e: EmpresaPrueba;
  let h: { Authorization: string };
  const f = { ana: '', diego: '' };

  const alta = (datos: object) => http(app).post('/api/funcionarios').set(h).send({ sucursalId: e.sucursalId, cargo: 'Vendedor', remuneracion: 'mensual', ...datos }).expect(201);
  const novedad = (datos: object, estado = 201) => http(app).post('/api/rrhh/novedades').set(h).send(datos).expect(estado);
  const saldo = async (id: string) => (await http(app).get(`/api/rrhh/vacaciones?funcionarioId=${id}`).set(h).expect(200)).body;

  beforeAll(async () => {
    app = await iniciarApp();
    e = await crearEmpresa(app, 'BUSINESS');
    h = auth(e.propietario.token);
    f.ana = (await alta({ nombre: 'Ana Benítez', documento: '7111222', fechaIngreso: '2023-06-01', salario: 3600000 })).body.id;
    f.diego = (await alta({ nombre: 'Diego Ruiz', documento: '7222333', fechaIngreso: '2021-03-15', salario: 4500000 })).body.id;
  });
  afterAll(() => app.close());

  it('novedades: ausencia, reposo por rango y horas extra; sin duplicados', async () => {
    await novedad({ funcionarioId: f.ana, fecha: '2026-10-05', tipo: 'ausencia' });
    const r = await novedad({ funcionarioId: f.ana, fecha: '2026-10-12', hasta: '2026-10-14', tipo: 'reposo', observacion: 'Reposo médico IPS' });
    expect(r.body.ids).toHaveLength(3);
    await novedad({ funcionarioId: f.ana, fecha: '2026-10-20', tipo: 'horas_extra', horas: 4, recargo: 50 });
    await novedad({ funcionarioId: f.ana, fecha: '2026-10-21', tipo: 'llegada_tardia', horas: 0.5 });
    await novedad({ funcionarioId: f.ana, fecha: '2026-10-22', tipo: 'ausencia_justificada', observacion: 'Trámite' });
    // Duplicada, choque con reposo, horas extra sin recargo, antes del ingreso.
    await novedad({ funcionarioId: f.ana, fecha: '2026-10-05', tipo: 'ausencia' }, 409);
    await novedad({ funcionarioId: f.ana, fecha: '2026-10-13', tipo: 'ausencia' }, 409);
    await novedad({ funcionarioId: f.ana, fecha: '2026-10-23', tipo: 'horas_extra', horas: 2 }, 400);
    await novedad({ funcionarioId: f.ana, fecha: '2023-05-01', tipo: 'ausencia' }, 400);
    const l = await http(app).get('/api/rrhh/novedades?desde=2026-10-01&hasta=2026-10-31').set(h).expect(200);
    expect(l.body.funcionarios).toHaveLength(2);
    expect(l.body.novedades).toHaveLength(7);
    // El supervisor carga asistencia; el cajero no.
    const sup = await crearUsuario(app, e, 'supervisor');
    await http(app).get('/api/rrhh/novedades?desde=2026-10-01&hasta=2026-10-31').set(auth((await login(app, sup.email)).token)).expect(200);
    const caj = await crearUsuario(app, e, 'cajero');
    await http(app).get('/api/rrhh/novedades?desde=2026-10-01&hasta=2026-10-31').set(auth((await login(app, caj.email)).token)).expect(403);
  });

  it('la planilla mensual descuenta ausencias y reposo y suma las horas extra', async () => {
    const l = await http(app).post('/api/liquidaciones').set(h).send({ tipo: 'mensual', periodo: '2026-10' }).expect(201);
    const ana = l.body.items.find((x: { funcionarioId: string }) => x.funcionarioId === f.ana);
    // 30 − 1 ausencia − 3 de reposo = 26 días; 4 horas al 50 % (hora = 3.600.000 / 240 = 15.000).
    expect(ana).toMatchObject({ dias: '26.0000', salarioBase: '3120000.00', horasExtra50: '4.0000', montoHorasExtra: '90000.00' });
    await http(app).post(`/api/liquidaciones/${l.body.id}/confirmar`).set(h).expect(200);
    // Con el mes liquidado, sus novedades ya no se modifican.
    const n = await http(app).get(`/api/rrhh/novedades?desde=2026-10-05&hasta=2026-10-05&funcionarioId=${f.ana}`).set(h).expect(200);
    await http(app).delete(`/api/rrhh/novedades/${n.body.novedades[0].id}`).set(h).expect(409);
    await novedad({ funcionarioId: f.ana, fecha: '2026-10-28', tipo: 'ausencia' }, 409);
  });

  it('planilla en borrador: vuelve a tomar las novedades', async () => {
    await novedad({ funcionarioId: f.ana, fecha: '2026-11-02', tipo: 'ausencia' });
    const l = await http(app).post('/api/liquidaciones').set(h).send({ tipo: 'mensual', periodo: '2026-11' }).expect(201);
    const dias = (b: { items: { funcionarioId: string; dias: string }[] }) => b.items.find((x) => x.funcionarioId === f.ana)!.dias;
    expect(dias(l.body)).toBe('29.0000');
    const n = await novedad({ funcionarioId: f.ana, fecha: '2026-11-03', tipo: 'ausencia' });
    const a = await http(app).post(`/api/liquidaciones/${l.body.id}/novedades`).set(h).expect(200);
    expect(dias(a.body)).toBe('28.0000');
    await http(app).delete(`/api/rrhh/novedades/${n.body.ids[0]}`).set(h).expect(200);
    await http(app).post(`/api/liquidaciones/${l.body.id}/anular`).set(h).send({ motivo: 'Prueba de novedades' }).expect(200);
  });

  it('vacaciones: saldo por años de servicio, goce, ajuste y anulación', async () => {
    // Ana ingresó el 1/6/2023: tres períodos cumplidos de 12 días.
    let s = await saldo(f.ana);
    expect(s).toMatchObject({ causados: 36, gozados: 0, pendientes: 36 });
    expect(s.periodos[0]).toMatchObject({ anio: 1, desde: '2024-06-01', dias: 12 });
    const g = await http(app).post('/api/rrhh/vacaciones/goce').set(h).send({ funcionarioId: f.ana, desde: '2026-01-05', hasta: '2026-01-16', dias: 10 }).expect(201);
    await http(app).post('/api/rrhh/vacaciones/ajuste').set(h).send({ funcionarioId: f.ana, dias: -12, observacion: 'Gozadas antes de usar el sistema' }).expect(201);
    s = await saldo(f.ana);
    expect(s).toMatchObject({ gozados: 10, ajustes: -12, pendientes: 14 });
    await http(app).post('/api/rrhh/vacaciones/goce').set(h).send({ funcionarioId: f.ana, desde: '2026-01-10', hasta: '2026-01-12', dias: 2 }).expect(409);
    await http(app).post('/api/rrhh/vacaciones/goce').set(h).send({ funcionarioId: f.ana, desde: '2026-02-02', hasta: '2026-02-28', dias: 20 }).expect(409);
    await http(app).post(`/api/rrhh/vacaciones/${g.body.id}/anular`).set(h).send({ motivo: 'Cargado por error' }).expect(200);
    expect((await saldo(f.ana)).pendientes).toBe(24);
    const r = await http(app).get('/api/rrhh/vacaciones/resumen').set(h).expect(200);
    expect(r.body.find((x: { funcionarioId: string }) => x.funcionarioId === f.diego)).toMatchObject({ causados: 60, pendientes: 60 });
  });

  it('liquidación final por despido sin causa: conceptos, ajustes, confirmación y anulación', async () => {
    const l = await http(app).post('/api/liquidaciones/final').set(h).send({ funcionarioId: f.diego, fechaEgreso: '2026-11-10', motivo: 'despido_injustificado', detalleMotivo: 'Reestructuración' }).expect(201);
    const id = l.body.id;
    const monto = (b: { final: { conceptos: { concepto: string; monto: string }[] } }, c: string) => b.final.conceptos.find((x) => x.concepto === c)?.monto;
    expect(l.body.tipo).toBe('final');
    expect(l.body.final.calculo).toMatchObject({ diasPreaviso: 60, aniosIndemnizacion: 6, estabilidad: false, baseDiaria: '150000.00' });
    expect(l.body.final.opciones).toMatchObject({ diasTrabajados: 10, vacacionesPendientes: 60, vacacionesProporcionales: true });
    // Octubre liquidado (4.500.000) + 10 días de noviembre (1.500.000), sobre 12.
    expect(monto(l.body, 'dias_trabajados')).toBe('1500000.00');
    expect(monto(l.body, 'aguinaldo')).toBe('500000.00');
    expect(monto(l.body, 'vacaciones_causadas')).toBe('9000000.00');
    expect(monto(l.body, 'vacaciones_proporcionales')).toBe('1575000.00');
    expect(monto(l.body, 'preaviso')).toBe('9000000.00');
    expect(monto(l.body, 'indemnizacion')).toBe('13500000.00');

    // Se dio la mitad del preaviso y ya gozó parte de las vacaciones; adelanto a descontar.
    const a = await http(app).patch(`/api/liquidaciones/${id}/final`).set(h).send({ preavisoOtorgado: 30, vacacionesPendientes: 12, descuentos: 1000000, detalleDescuentos: 'Adelanto' }).expect(200);
    expect(monto(a.body, 'preaviso')).toBe('4500000.00');
    expect(monto(a.body, 'vacaciones_causadas')).toBe('1800000.00');
    // IPS 9 % sobre días trabajados y vacaciones: (1.500.000 + 1.800.000 + 1.575.000) × 9 % = 438.750.
    expect(a.body.totales).toMatchObject({ bruto: '23375000.00', ipsObrero: '438750.00', ipsPatronal: '804375.00', descuentos: '1000000.00', neto: '21936250.00' });
    await http(app).patch(`/api/liquidaciones/${f.diego}/final`).set(h).send({}).expect(404);
    await http(app).post('/api/liquidaciones/final').set(h).send({ funcionarioId: f.diego, fechaEgreso: '2026-11-10', motivo: 'renuncia' }).expect(409);

    await http(app).post(`/api/liquidaciones/${id}/confirmar`).set(h).expect(200);
    let d = await http(app).get(`/api/funcionarios/${f.diego}`).set(h).expect(200);
    expect(d.body).toMatchObject({ fechaEgreso: '2026-11-10', motivoEgreso: 'Despido sin justa causa: Reestructuración' });
    await http(app).patch(`/api/liquidaciones/${id}/final`).set(h).send({ descuentos: 0 }).expect(409);
    const lista = await http(app).get('/api/liquidaciones').set(h).expect(200);
    expect(lista.body.find((x: { id: string }) => x.id === id)).toMatchObject({ tipo: 'final', funcionario: 'Diego Ruiz', neto: '21936250.00' });

    // La planilla de noviembre ya no lo incluye: su mes se pagó en la liquidación final.
    const nov = await http(app).post('/api/liquidaciones').set(h).send({ tipo: 'mensual', periodo: '2026-11' }).expect(201);
    expect(nov.body.items.map((x: { funcionarioId: string }) => x.funcionarioId)).not.toContain(f.diego);
    await http(app).post(`/api/liquidaciones/${nov.body.id}/anular`).set(h).send({ motivo: 'Prueba de exclusión' }).expect(200);

    // Al anularla, el legajo vuelve a quedar activo.
    await http(app).post(`/api/liquidaciones/${id}/anular`).set(h).send({ motivo: 'Se acordó la reincorporación' }).expect(200);
    d = await http(app).get(`/api/funcionarios/${f.diego}`).set(h).expect(200);
    expect(d.body).toMatchObject({ fechaEgreso: null, activo: true });
  });

  it('renuncia: sin preaviso ni indemnización', async () => {
    const l = await http(app).post('/api/liquidaciones/final').set(h).send({ funcionarioId: f.diego, fechaEgreso: '2026-11-10', motivo: 'renuncia' }).expect(201);
    expect(l.body.final.conceptos.map((c: { concepto: string }) => c.concepto)).toEqual(['dias_trabajados', 'aguinaldo', 'vacaciones_causadas']);
  });
});
