import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEmpresa, http, iniciarApp, type EmpresaPrueba } from './ayudas';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Reloj de asistencia: importación del archivo y novedades propuestas según el horario. */
describe('RRHH: reloj de asistencia', () => {
  let app: INestApplication;
  let e: EmpresaPrueba;
  let h: { Authorization: string };
  const f = { ana: '', beto: '' };

  // Ana (código 7): 07:30 a 17:30, sábados hasta las 12:00. Semana del lunes 2 al domingo 8 de noviembre de 2026.
  const archivo = [
    'No.\tFecha\tEstado',
    '7\t2026-11-02 07:28:00\t0',
    '7\t2026-11-02 12:00:10\t1',
    '7\t2026-11-02 17:31:00\t1',
    '7\t2026-11-03 07:52:00\t0', // 22 minutos tarde
    '7\t2026-11-03 18:45:00\t1', // 1 h 15 min después: 1 hora extra
    // miércoles 4 sin marcaciones: ausencia
    '7\t2026-11-05 07:30:00\t0', // jueves 5: falta la salida
    '7\t2026-11-06 07:30:00\t0',
    '7\t2026-11-06 17:30:00\t1',
    '7\t2026-11-06 17:30:00\t1', // repetida
    '7\t2026-11-07 07:30:00\t0',
    '7\t2026-11-07 13:05:00\t1', // sábado: 1 hora extra
    '7\t2026-11-08 08:00:00\t0',
    '7\t2026-11-08 11:10:00\t1', // domingo: 3 horas al 100 %
    '999\t2026-11-03 08:00:00\t0',
    '8222333\t2026-11-03 08:00:00\t0', // Beto, por cédula, sin horario
  ].join('\n');

  beforeAll(async () => {
    app = await iniciarApp();
    e = await crearEmpresa(app, 'BUSINESS');
    h = auth(e.propietario.token);
    const alta = (d: object) => http(app).post('/api/funcionarios').set(h).send({ sucursalId: e.sucursalId, cargo: 'Cajero', remuneracion: 'mensual', fechaIngreso: '2026-01-05', salario: 3600000, ...d });
    f.ana = (await alta({ nombre: 'Ana Reloj', documento: '8111222', codigoReloj: '7', horarioEntrada: '07:30', horarioSalida: '17:30', trabajaSabado: true, sabadoSalida: '12:00' }).expect(201)).body.id;
    f.beto = (await alta({ nombre: 'Beto Reloj', documento: '8222333' }).expect(201)).body.id;
    await alta({ nombre: 'Otro', documento: '8333444', codigoReloj: '7' }).expect(409);
    await alta({ nombre: 'Otro', documento: '8333444', horarioEntrada: '18:00', horarioSalida: '08:00' }).expect(400);
  });
  afterAll(() => app.close());

  it('importa el archivo: asigna por código o cédula e ignora repetidas', async () => {
    const r = await http(app).post('/api/rrhh/marcaciones/importar').set(h).send({ contenido: archivo, nombreArchivo: 'attlog.dat' }).expect(200);
    expect(r.body).toMatchObject({ lineas: 15, importadas: 13, repetidas: 1, ignoradas: 1, sinFuncionario: ['999'], desde: '2026-11-02', hasta: '2026-11-08' });
    const otra = await http(app).post('/api/rrhh/marcaciones/importar').set(h).send({ contenido: archivo }).expect(200);
    expect(otra.body.importadas).toBe(0);
    const l = await http(app).get(`/api/rrhh/novedades?desde=2026-11-02&hasta=2026-11-08&funcionarioId=${f.ana}`).set(h).expect(200);
    expect(l.body.marcaciones).toHaveLength(12);
    expect(l.body.marcaciones[0]).toMatchObject({ fecha: '2026-11-02', hora: '07:28', origen: 'reloj' });
  });

  it('propone ausencias, llegadas tardías y horas extra según el horario', async () => {
    const r = await http(app).get('/api/rrhh/marcaciones/propuestas?desde=2026-11-02&hasta=2026-11-08').set(h).expect(200);
    const p = r.body.propuestas.map((x: { fecha: string; tipo: string; horas?: number; recargo?: number }) => [x.fecha, x.tipo, x.horas ?? null, x.recargo ?? null]);
    expect(p).toEqual([
      ['2026-11-03', 'llegada_tardia', 0.37, null],
      ['2026-11-03', 'horas_extra', 1, 50],
      ['2026-11-04', 'ausencia', null, null],
      ['2026-11-07', 'horas_extra', 1, 50],
      ['2026-11-08', 'horas_extra', 3, 100],
    ]);
    expect(r.body.incompletas).toEqual([{ funcionarioId: f.ana, nombre: 'Ana Reloj', fecha: '2026-11-05', hora: '07:30' }]);
    expect(r.body.sinHorario).toEqual(['Beto Reloj']);

    // Se registran las propuestas; ya no se vuelven a proponer.
    const lote = await http(app)
      .post('/api/rrhh/novedades/lote')
      .set(h)
      .send({ novedades: r.body.propuestas.map((x: Record<string, unknown>) => ({ funcionarioId: x.funcionarioId, fecha: x.fecha, tipo: x.tipo, horas: x.horas, recargo: x.recargo, observacion: x.detalle })) })
      .expect(200);
    expect(lote.body).toEqual({ registradas: 5, rechazadas: [] });
    const otra = await http(app).get('/api/rrhh/marcaciones/propuestas?desde=2026-11-02&hasta=2026-11-08').set(h).expect(200);
    expect(otra.body.propuestas).toHaveLength(0);
    const repetido = await http(app).post('/api/rrhh/novedades/lote').set(h).send({ novedades: [{ funcionarioId: f.ana, fecha: '2026-11-04', tipo: 'ausencia' }] }).expect(200);
    expect(repetido.body.registradas).toBe(0);
    expect(repetido.body.rechazadas[0].motivo).toMatch(/Ya está cargada/);
  });

  it('marcación manual: completa el día y se puede quitar', async () => {
    const m = await http(app).post('/api/rrhh/marcaciones').set(h).send({ funcionarioId: f.ana, fecha: '2026-11-05', hora: '17:30' }).expect(201);
    await http(app).post('/api/rrhh/marcaciones').set(h).send({ funcionarioId: f.ana, fecha: '2026-11-05', hora: '17:30' }).expect(409);
    let r = await http(app).get('/api/rrhh/marcaciones/propuestas?desde=2026-11-02&hasta=2026-11-08').set(h).expect(200);
    expect(r.body.incompletas).toHaveLength(0);
    await http(app).delete(`/api/rrhh/marcaciones/${m.body.id}`).set(h).expect(200);
    r = await http(app).get('/api/rrhh/marcaciones/propuestas?desde=2026-11-02&hasta=2026-11-08').set(h).expect(200);
    expect(r.body.incompletas).toHaveLength(1);
  });
});
