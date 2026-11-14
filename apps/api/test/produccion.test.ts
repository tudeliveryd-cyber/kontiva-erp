import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEmpresa, crearUsuario, http, iniciarApp, login, prepararVenta, type EmpresaPrueba } from './ayudas';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
const dias = (n: number) => new Date(Date.parse(`${hoy()}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * Producción. Pan francés: una tanda de 10 kg de harina (5.000/kg), 0,2 kg de levadura (40.000/kg) y 0,2 kg de sal
 * (3.000/kg) rinde 100 panes: 58.600 por tanda, 586 por pan.
 */
describe('Producción: recetas, órdenes, mermas y necesidades', () => {
  let app: INestApplication;
  let e: EmpresaPrueba;
  let h: { Authorization: string };
  let base: Awaited<ReturnType<typeof prepararVenta>>;
  const v = { harina: '', levadura: '', sal: '', pan: '', medialuna: '' };
  let receta = '';

  const producto = async (nombre: string, precio: number, costo: number, extra: object = {}) =>
    (await http(app).post('/api/productos').set(h).send({ nombre, tasaIva: 10, unidad: 'unidad', variantes: [{ precio, costo, codigos: [] }], ...extra }).expect(201)).body.variantes[0].id as string;
  const stock = async (id: string) => Number((await http(app).get(`/api/stock?depositoId=${base.depositoId}&q=`).set(h).expect(200)).body.find((x: { varianteId: string }) => x.varianteId === id)?.cantidad ?? 0);
  const ajustar = (items: object[]) => http(app).post('/api/stock/ajustes').set(h).send({ depositoId: base.depositoId, tipo: 'inicial', motivo: 'Inicial', items }).expect(201);

  beforeAll(async () => {
    app = await iniciarApp();
    e = await crearEmpresa(app, 'BUSINESS');
    h = auth(e.propietario.token);
    base = await prepararVenta(app, e, 10);
    v.harina = await producto('Harina 000', 6000, 5000, { unidad: 'kg' });
    v.levadura = await producto('Levadura fresca', 50000, 40000, { unidad: 'kg' });
    v.sal = await producto('Sal fina', 4000, 3000, { unidad: 'kg' });
    v.pan = await producto('Pan francés', 1000, 0);
    v.medialuna = await producto('Medialuna', 2500, 0, { controlaLote: true });
    await ajustar([{ varianteId: v.harina, cantidadNueva: 50 }, { varianteId: v.levadura, cantidadNueva: 0.5 }, { varianteId: v.sal, cantidadNueva: 5 }]);
  });
  afterAll(() => app.close());

  it('receta: costo teórico por unidad y margen contra el precio', async () => {
    const r = await http(app)
      .post('/api/produccion/recetas')
      .set(h)
      .send({ varianteId: v.pan, rendimiento: 100, minutos: 180, insumos: [{ varianteId: v.harina, cantidad: 10 }, { varianteId: v.levadura, cantidad: 0.2 }, { varianteId: v.sal, cantidad: 0.2 }] })
      .expect(201);
    receta = r.body.id;
    const d = await http(app).get(`/api/produccion/recetas/${receta}?sucursalId=${e.sucursalId}`).set(h).expect(200);
    expect(d.body).toMatchObject({ descripcion: 'Pan francés', costoTanda: '58600.00', costoUnitario: '586.00', precio: '1000.00', margen: '41.4' });
    await http(app).post('/api/produccion/recetas').set(h).send({ varianteId: v.pan, rendimiento: 1, insumos: [{ varianteId: v.harina, cantidad: 1 }] }).expect(409);
    await http(app).post('/api/produccion/recetas').set(h).send({ varianteId: v.medialuna, rendimiento: 1, insumos: [{ varianteId: v.medialuna, cantidad: 1 }] }).expect(400);
    await http(app).post('/api/produccion/recetas').set(h).send({ varianteId: v.medialuna, rendimiento: 50, insumos: [{ varianteId: v.harina, cantidad: 5 }] }).expect(201);
  });

  it('orden: insumos en proporción; al terminar, consume lo real y entra lo producido al costo real', async () => {
    const o = await http(app).post('/api/produccion/ordenes').set(h).send({ varianteId: v.pan, depositoId: base.depositoId, cantidad: 200, fecha: hoy() }).expect(201);
    expect(o.body.insumos.map((i: { cantidadTeorica: string }) => i.cantidadTeorica)).toEqual(['20.0000', '0.4000', '0.4000']);
    // Se usó un kilo más de harina y salieron 190 panes: (21 × 5.000 + 0,4 × 40.000 + 0,4 × 3.000) / 190.
    const t = await http(app).post(`/api/produccion/ordenes/${o.body.id}/terminar`).set(h).send({ cantidadProducida: 190, insumos: [{ linea: 1, cantidadReal: 21 }] }).expect(200);
    expect(t.body).toMatchObject({ estado: 'terminada', cantidadProducida: '190.0000', costoTotal: '122200.00', costoUnitario: '643.16' });
    expect(await stock(v.pan)).toBe(190);
    expect(await stock(v.harina)).toBe(29);
    const p = await http(app).get(`/api/productos/${(await http(app).get('/api/productos?q=pan').set(h)).body.items[0].id}`).set(h).expect(200);
    expect(p.body.variantes[0].costo).toBe('643.16');
    await http(app).post(`/api/produccion/ordenes/${o.body.id}/terminar`).set(h).send({ cantidadProducida: 1 }).expect(409);

    // Sin harina suficiente no se termina; se anula planificada.
    const o2 = await http(app).post('/api/produccion/ordenes').set(h).send({ varianteId: v.pan, depositoId: base.depositoId, cantidad: 300, fecha: hoy() }).expect(201);
    const r = await http(app).post(`/api/produccion/ordenes/${o2.body.id}/terminar`).set(h).send({ cantidadProducida: 300 }).expect(409);
    expect(r.body.codigo).toBe('STOCK_INSUFICIENTE');
    await http(app).post(`/api/produccion/ordenes/${o2.body.id}/anular`).set(h).send({ motivo: 'Falta harina' }).expect(200);

    // Anular la terminada: sale lo producido y vuelven los insumos.
    await http(app).post(`/api/produccion/ordenes/${o.body.id}/anular`).set(h).send({ motivo: 'Carga equivocada' }).expect(200);
    expect(await stock(v.pan)).toBe(0);
    expect(await stock(v.harina)).toBe(50);
    expect(await stock(v.levadura)).toBe(0.5);
  });

  it('lo producido con control de lote queda en el lote de la orden; mermas valorizadas', async () => {
    const o = await http(app).post('/api/produccion/ordenes').set(h).send({ varianteId: v.medialuna, depositoId: base.depositoId, cantidad: 50, fecha: hoy() }).expect(201);
    const t = await http(app).post(`/api/produccion/ordenes/${o.body.id}/terminar`).set(h).send({ cantidadProducida: 48, lote: { vencimiento: dias(2) } }).expect(200);
    expect(t.body.lote).toEqual({ codigo: `OP-${o.body.numero}`, vencimiento: dias(2) });
    const l = await http(app).get(`/api/stock/lotes?varianteId=${v.medialuna}&depositoId=${base.depositoId}`).set(h).expect(200);
    expect(l.body.map((x: { codigo: string; cantidad: string }) => [x.codigo, x.cantidad])).toEqual([[`OP-${o.body.numero}`, '48.0000']]);
    // 25.000 de harina / 48 = 520,83 por medialuna.
    const m = await http(app).post('/api/produccion/mermas').set(h).send({ depositoId: base.depositoId, motivo: 'Sobrante del día', items: [{ varianteId: v.medialuna, cantidad: 6 }] }).expect(201);
    expect(m.body.valor).toBe('3124.98');
    expect(await stock(v.medialuna)).toBe(42);
    const rep = await http(app).get(`/api/produccion/mermas?desde=${hoy()}&hasta=${hoy()}`).set(h).expect(200);
    expect(rep.body[0]).toMatchObject({ descripcion: 'Medialuna', cantidad: '6.0000', motivo: 'Sobrante del día', valor: '3124.98' });
  });

  it('necesidades para los encargos: qué producir y qué insumos faltan; crea las órdenes', async () => {
    await http(app).post('/api/pedidos').set(h).send({ sucursalId: e.sucursalId, clienteNombre: 'Cumpleaños Gómez', entregaPrevista: dias(1), items: [{ varianteId: v.pan, cantidad: 300 }, { varianteId: v.medialuna, cantidad: 30 }] }).expect(201);
    const n = await http(app).get(`/api/produccion/necesidades?sucursalId=${e.sucursalId}&desde=${hoy()}&hasta=${dias(2)}`).set(h).expect(200);
    expect(n.body.productos.map((p: { descripcion: string; pedido: string; stock: string; sugerido: string }) => [p.descripcion, p.pedido, p.stock, p.sugerido])).toEqual([
      ['Medialuna', '30.0000', '42.0000', '0.0000'],
      ['Pan francés', '300.0000', '0.0000', '300.0000'],
    ]);
    // 300 panes: 30 kg de harina (hay 50), 0,6 kg de levadura (hay 0,5).
    expect(n.body.insumos.map((i: { descripcion: string; necesario: string; faltante: string }) => [i.descripcion, i.necesario, i.faltante])).toEqual([
      ['Harina 000', '30.0000', '0.0000'],
      ['Levadura fresca', '0.6000', '0.1000'],
      ['Sal fina', '0.6000', '0.0000'],
    ]);
    await http(app).post('/api/produccion/ordenes/lote').set(h).send({ depositoId: base.depositoId, fecha: dias(1), items: [{ varianteId: v.pan, cantidad: 300 }] }).expect(201);
    const n2 = await http(app).get(`/api/produccion/necesidades?sucursalId=${e.sucursalId}&desde=${hoy()}&hasta=${dias(2)}`).set(h).expect(200);
    expect(n2.body.productos.find((p: { descripcion: string }) => p.descripcion === 'Pan francés')).toMatchObject({ planificado: '300.0000', sugerido: '0.0000' });
  });

  it('permisos: el perfil Producción planifica pero no edita recetas; el cajero no entra', async () => {
    const pr = await crearUsuario(app, e, 'produccion');
    const hp = auth((await login(app, pr.email)).token);
    await http(app).get('/api/produccion/ordenes').set(hp).expect(200);
    await http(app).put(`/api/produccion/recetas/${receta}`).set(hp).send({ varianteId: v.pan, rendimiento: 90, insumos: [{ varianteId: v.harina, cantidad: 10 }] }).expect(403);
    const cj = await crearUsuario(app, e, 'cajero');
    await http(app).get('/api/produccion/ordenes').set(auth((await login(app, cj.email)).token)).expect(403);
  });
});
