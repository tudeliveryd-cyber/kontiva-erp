import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEmpresa, http, iniciarApp, prepararVenta, unico, type EmpresaPrueba } from './ayudas';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
const dias = (n: number) => new Date(Date.parse(`${hoy()}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Lotes y vencimientos: entradas por lote, salidas FEFO sin vencidos, reversiones al mismo lote. */
describe('Lotes y vencimientos', () => {
  let app: INestApplication;
  let e: EmpresaPrueba;
  let h: { Authorization: string };
  let base: Awaited<ReturnType<typeof prepararVenta>>;
  let prov: string;
  let yogur: string;

  const lotes = async (dep = base.depositoId, v = yogur) =>
    Object.fromEntries((await http(app).get(`/api/stock/lotes?varianteId=${v}&depositoId=${dep}`).set(h).expect(200)).body.map((l: { codigo: string; cantidad: string }) => [l.codigo, Number(l.cantidad)]));
  const total = async (dep = base.depositoId, v = yogur) => Number((await http(app).get(`/api/stock?depositoId=${dep}&q=`).set(h).expect(200)).body.find((x: { varianteId: string }) => x.varianteId === v).cantidad);
  const vender = (cantidad: number) =>
    http(app)
      .post('/api/ventas')
      .set(h)
      .send({ claveIdempotencia: unico('l-'), cajaId: base.cajaId, items: [{ varianteId: yogur, cantidad }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: cantidad * 10000 }] });
  const compra = (items: object[]) =>
    http(app)
      .post('/api/compras')
      .set(h)
      .send({ proveedorId: prov, depositoId: base.depositoId, documentoTipo: 'remision', fechaDocumento: hoy(), condicion: 'credito', items });

  beforeAll(async () => {
    app = await iniciarApp();
    e = await crearEmpresa(app, 'BUSINESS');
    h = auth(e.propietario.token);
    base = await prepararVenta(app, e, 100);
    prov = (await http(app).post('/api/proveedores').set(h).send({ nombre: 'Lácteos del Sur', ruc: '80012345-6' }).expect(201)).body.id;
    const p = await http(app).post('/api/productos').set(h).send({ nombre: 'Yogur bebible 1 L', tasaIva: 10, controlaLote: true, variantes: [{ precio: 10000, costo: 6000, codigos: [] }] }).expect(201);
    expect(p.body.controlaLote).toBe(true);
    yogur = p.body.variantes[0].id;
  });
  afterAll(() => app.close());

  it('entradas: sin lote van a "S/L"; la compra exige lote o vencimiento', async () => {
    await http(app).post('/api/stock/ajustes').set(h).send({ depositoId: base.depositoId, tipo: 'inicial', motivo: 'Inicial', items: [{ varianteId: yogur, cantidadNueva: 5 }] }).expect(201);
    expect(await lotes()).toEqual({ 'S/L': 5 });
    await compra([{ varianteId: yogur, cantidad: 10, costoUnitario: 6000 }]).expect(400);
    const c = await compra([
      { varianteId: yogur, cantidad: 10, costoUnitario: 6000, lote: { codigo: 'a1', vencimiento: dias(10) } },
      { varianteId: yogur, cantidad: 10, costoUnitario: 6000, lote: { vencimiento: dias(40) } },
    ]).expect(201);
    expect(c.body.items.map((i: { lote: { codigo: string } }) => i.lote.codigo)).toEqual(['A1', `VTO-${dias(40).replace(/-/g, '')}`]);
    // El mismo lote con otro vencimiento es un error de carga.
    await compra([{ varianteId: yogur, cantidad: 1, costoUnitario: 6000, lote: { codigo: 'A1', vencimiento: dias(11) } }]).expect(409);
    // Conteo por lote: se da de baja lo que estaba sin lote.
    const sl = (await http(app).get(`/api/stock/lotes?varianteId=${yogur}&depositoId=${base.depositoId}`).set(h).expect(200)).body.find((l: { codigo: string }) => l.codigo === 'S/L');
    await http(app).post('/api/stock/ajustes').set(h).send({ depositoId: base.depositoId, motivo: 'Conteo por lote', items: [{ varianteId: yogur, cantidadNueva: 0, loteId: sl.loteId }] }).expect(201);
    expect(await total()).toBe(20);
    expect(await lotes()).toMatchObject({ A1: 10, 'S/L': 0 });
  });

  it('venta FEFO; devolución y anulación vuelven al mismo lote', async () => {
    const venc = `VTO-${dias(40).replace(/-/g, '')}`;
    const v = await vender(12).expect(201);
    expect(await lotes()).toMatchObject({ A1: 0, [venc]: 8 });
    await http(app).post('/api/devoluciones').set(h).send({ ventaId: v.body.id, cajaId: base.cajaId, motivo: 'Cliente', items: [{ linea: 1, cantidad: 3 }] }).expect(201);
    expect(await lotes()).toMatchObject({ A1: 3, [venc]: 8 });
    // Otra devolución de la misma venta: ya volvieron 3 de A1, quedan 7 de A1 y 2 del otro lote.
    await http(app).post('/api/devoluciones').set(h).send({ ventaId: v.body.id, cajaId: base.cajaId, motivo: 'Cliente', items: [{ linea: 1, cantidad: 8 }] }).expect(201);
    expect(await lotes()).toMatchObject({ A1: 10, [venc]: 9 });
    const v2 = await vender(1).expect(201);
    expect(await lotes()).toMatchObject({ A1: 9 });
    await http(app).post(`/api/ventas/${v2.body.id}/anular`).set(h).send({ motivo: 'Error de carga' }).expect(200);
    expect(await lotes()).toMatchObject({ A1: 10, [venc]: 9 });
  });

  it('un lote vencido no se vende; sale con un ajuste', async () => {
    await http(app).post('/api/stock/ajustes').set(h).send({ depositoId: base.depositoId, motivo: 'Lote encontrado', items: [{ varianteId: yogur, cantidadNueva: 4, lote: { codigo: 'V0', vencimiento: dias(-2) } }] }).expect(201);
    expect(await total()).toBe(23);
    const r = await vender(20).expect(409);
    expect(r.body.codigo).toBe('LOTE_VENCIDO');
    await vender(19).expect(201);
    expect(await lotes()).toMatchObject({ A1: 0, V0: 4 });
    const ven = await http(app).get('/api/stock/vencimientos?dias=15').set(h).expect(200);
    expect(ven.body.map((x: { codigo: string; vencido: boolean; dias: number }) => [x.codigo, x.vencido, x.dias])).toEqual([['V0', true, -2]]);
    const t = await http(app).get(`/api/tablero?desde=${hoy()}&hasta=${hoy()}`).set(h).expect(200);
    expect(t.body.vencimientos).toEqual({ vencidos: 1, porVencer: 0 });
    const vencido = (await http(app).get(`/api/stock/lotes?varianteId=${yogur}&depositoId=${base.depositoId}`).set(h).expect(200)).body.find((l: { codigo: string }) => l.codigo === 'V0');
    expect(vencido.vencido).toBe(true);
    await http(app).post('/api/stock/ajustes').set(h).send({ depositoId: base.depositoId, motivo: 'Baja de vencidos', items: [{ varianteId: yogur, cantidadNueva: 0, loteId: vencido.loteId }] }).expect(201);
    expect(await total()).toBe(0);
  });

  it('transferencia: los lotes viajan; anular una compra saca su lote', async () => {
    const c = await compra([{ varianteId: yogur, cantidad: 6, costoUnitario: 6000, lote: { codigo: 'C3', vencimiento: dias(20) } }]).expect(201);
    await compra([{ varianteId: yogur, cantidad: 4, costoUnitario: 6000, lote: { codigo: 'D4', vencimiento: dias(5) } }]).expect(201);
    const s2 = await http(app).post('/api/sucursales').set(h).send({ nombre: 'Encarnación', codigo: '002' }).expect(201);
    const destino = (await http(app).get('/api/depositos').set(h).expect(200)).body.find((d: { sucursal: { id: string } }) => d.sucursal.id === s2.body.id).id;
    await http(app).post('/api/transferencias').set(h).send({ origenId: base.depositoId, destinoId: destino, directa: true, items: [{ varianteId: yogur, cantidad: 5 }] }).expect(201);
    expect(await lotes(destino)).toEqual({ D4: 4, C3: 1 });
    // C3 entró 6 y quedan 5: anular la compra no puede sacar lo que ya no está.
    await http(app).post(`/api/compras/${c.body.id}/anular`).set(h).send({ motivo: 'Factura equivocada' }).expect(409);
  });

  it('activar el control por lote deja el stock existente en "S/L"', async () => {
    const p = await http(app).get(`/api/productos/${base.productoId}`).set(h).expect(200);
    const v0 = p.body.variantes[0];
    await http(app).patch(`/api/productos/${base.productoId}`).set(h).send({ nombre: p.body.nombre, tasaIva: 10, controlaLote: true, variantes: [{ id: v0.id, precio: 11000, costo: 7000, codigos: v0.codigos }] }).expect(200);
    expect(await lotes(base.depositoId, base.varianteId)).toEqual({ 'S/L': 99 });
  });
});
