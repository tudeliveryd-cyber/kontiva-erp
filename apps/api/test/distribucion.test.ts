import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEmpresa, http, iniciarApp, type EmpresaPrueba } from './ayudas';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const clave = () => `clave-${Math.random().toString(36).slice(2)}`;

/**
 * Distribuidora de bebidas. Gaseosa 2 L a 12.000 la unidad; pack x 6 a 66.000 (código propio).
 * Tres clientes: Despensa Sol (sin crédito), Súper Luna (crédito 15 días) y Kiosco Río.
 */
describe('Distribuidora: presentaciones, rutas, reparto y rendición', () => {
  let app: INestApplication;
  let e: EmpresaPrueba;
  let h: { Authorization: string };
  let depositoId = '';
  let cajaId = '';
  let gaseosa = '';
  let pack = '';
  const cliente: Record<'sol' | 'luna' | 'rio', string> = { sol: '', luna: '', rio: '' };
  const pedido: Record<'sol' | 'luna' | 'rio', string> = { sol: '', luna: '', rio: '' };
  let ruta = '';
  let reparto = '';

  const stock = async () => Number(((b) => (Array.isArray(b) ? b : b.items))((await http(app).get(`/api/stock?depositoId=${depositoId}&q=Gaseosa`).set(h).expect(200)).body).find((x: { varianteId: string }) => x.varianteId === gaseosa).cantidad);
  const efectivo = async () => {
    const s = await http(app).get(`/api/cajas/${cajaId}/sesion`).set(h).expect(200);
    return Number(s.body.esperado.find((x: { moneda: string; medio: string }) => x.moneda === 'PYG' && x.medio === 'efectivo')?.monto ?? 0);
  };

  beforeAll(async () => {
    app = await iniciarApp();
    e = await crearEmpresa(app, 'BUSINESS');
    h = auth(e.propietario.token);
    depositoId = (await http(app).get('/api/depositos').set(h).expect(200)).body[0].id;
    cajaId = (await http(app).post('/api/cajas').set(h).send({ nombre: 'Caja despacho', sucursalId: e.sucursalId, depositoId }).expect(201)).body.id;
    await http(app).post(`/api/cajas/${cajaId}/abrir`).set(h).send({ fondos: [{ moneda: 'PYG', monto: 100000 }] }).expect(201);
    const p = await http(app)
      .post('/api/productos')
      .set(h)
      .send({ nombre: 'Gaseosa 2 L', tasaIva: 10, variantes: [{ precio: 12000, costo: 8000, codigos: ['7790001000011'], presentaciones: [{ nombre: 'Pack x 6', factor: 6, precio: 66000, codigos: ['17790001000018'] }] }] })
      .expect(201);
    gaseosa = p.body.variantes[0].id;
    pack = p.body.variantes[0].presentaciones[0].id;
    expect(p.body.variantes[0].codigos).toEqual(['7790001000011']);
    expect(p.body.variantes[0].presentaciones[0].codigos).toEqual(['17790001000018']);
    await http(app).post('/api/stock/ajustes').set(h).send({ depositoId, tipo: 'inicial', motivo: 'Inicial', items: [{ varianteId: gaseosa, cantidadNueva: 600 }] }).expect(201);
    cliente.sol = (await http(app).post('/api/clientes').set(h).send({ nombre: 'Despensa Sol', direccion: 'Av. Paraguay 120' }).expect(201)).body.id;
    cliente.luna = (await http(app).post('/api/clientes').set(h).send({ nombre: 'Súper Luna', limiteCredito: 1000000, plazoCreditoDias: 15 }).expect(201)).body.id;
    cliente.rio = (await http(app).post('/api/clientes').set(h).send({ nombre: 'Kiosco Río' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('presentaciones: el pack se vende y se compra por pack; el stock y el costo quedan en unidades', async () => {
    const b = await http(app).get(`/api/pdv/buscar?cajaId=${cajaId}&q=17790001000018`).set(h).expect(200);
    expect(b.body.porCodigo).toBe(true);
    expect(b.body.items[0].presentacionId).toBe(pack);
    expect(b.body.items[0].presentaciones[0]).toMatchObject({ nombre: 'Pack x 6', factor: '6.0000', precio: '66000.00' });

    const v = await http(app)
      .post('/api/ventas')
      .set(h)
      .send({ claveIdempotencia: clave(), cajaId, items: [{ varianteId: gaseosa, presentacionId: pack, cantidad: 2 }, { varianteId: gaseosa, cantidad: 1 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 144000 }] })
      .expect(201);
    expect(v.body.total).toBe('144000.00');
    expect(v.body.items[0]).toMatchObject({ cantidad: '12.0000', presentacion: '2 × Pack x 6', total: '132000.00' });
    expect(v.body.items[0].descripcion).toBe('Gaseosa 2 L · Pack x 6');
    expect(await stock()).toBe(587);

    // Precio de la presentación distinto: requiere permiso de cambiar precios (el propietario lo tiene).
    const otra = await http(app)
      .post('/api/ventas')
      .set(h)
      .send({ claveIdempotencia: clave(), cajaId, items: [{ varianteId: gaseosa, presentacionId: pack, cantidad: 1, precioUnitario: 60000 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 60000 }] })
      .expect(201);
    expect(otra.body.total).toBe('60000.00');
    expect(await stock()).toBe(581);

    const pv = await http(app).post('/api/proveedores').set(h).send({ nombre: 'Embotelladora' }).expect(201);
    const c = await http(app)
      .post('/api/compras')
      .set(h)
      .send({ proveedorId: pv.body.id, depositoId, documentoTipo: 'remision', fechaDocumento: '2026-11-14', condicion: 'credito', items: [{ varianteId: gaseosa, presentacionId: pack, cantidad: 10, costoUnitario: 48000 }] })
      .expect(201);
    expect(c.body.total).toBe('480000.00');
    expect(c.body.items[0]).toMatchObject({ cantidad: '60.0000', costoUnitario: '8000.00', presentacion: '10 × Pack x 6' });
    expect(await stock()).toBe(641);
  });

  it('ruta: clientes en orden de visita; los pedidos salen en ese orden', async () => {
    ruta = (await http(app).post('/api/rutas').set(h).send({ sucursalId: e.sucursalId, nombre: 'Centro', dias: [2, 5] }).expect(201)).body.id;
    await http(app).post('/api/rutas').set(h).send({ sucursalId: e.sucursalId, nombre: 'centro' }).expect(409);
    await http(app).put(`/api/rutas/${ruta}/clientes`).set(h).send({ clienteIds: [cliente.luna, cliente.sol] }).expect(200);
    const cl = (await http(app).get(`/api/rutas/${ruta}/clientes`).set(h).expect(200)).body;
    expect(cl.map((c: { nombre: string }) => c.nombre)).toEqual(['Súper Luna', 'Despensa Sol']);
    expect((await http(app).get('/api/rutas').set(h).expect(200)).body[0].clientes).toBe(2);

    const nuevo = (clienteId: string, cantidad: number) => http(app).post('/api/pedidos').set(h).send({ sucursalId: e.sucursalId, clienteId, entregaPrevista: '2026-11-15', items: [{ varianteId: gaseosa, cantidad }] }).expect(201);
    pedido.sol = (await nuevo(cliente.sol, 12)).body.id;
    pedido.luna = (await nuevo(cliente.luna, 24)).body.id;
    pedido.rio = (await nuevo(cliente.rio, 24)).body.id;
    await http(app).post('/api/pedidos').set(h).send({ sucursalId: e.sucursalId, clienteNombre: 'Sin registrar', items: [{ varianteId: gaseosa, cantidad: 1 }] }).expect(201);

    const libres = (await http(app).get(`/api/repartos/pedidos?sucursalId=${e.sucursalId}&hasta=2026-11-15`).set(h).expect(200)).body;
    // Solo pedidos de clientes registrados; primero la ruta en su orden, después los clientes sin ruta.
    expect(libres.map((p: { cliente: { nombre: string } }) => p.cliente.nombre)).toEqual(['Súper Luna', 'Despensa Sol', 'Kiosco Río']);
    const enRuta = (await http(app).get(`/api/repartos/pedidos?sucursalId=${e.sucursalId}&rutaId=${ruta}`).set(h).expect(200)).body;
    expect(enRuta).toHaveLength(2);
  });

  it('reparto: hoja de carga; un pedido no va en dos repartos; el despacho factura a la cuenta del cliente', async () => {
    const r = await http(app).post('/api/repartos').set(h).send({ cajaId, rutaId: ruta, fecha: '2026-11-15', repartidor: 'Carlos Benítez', vehiculo: 'Camión ABC 123', pedidoIds: [pedido.luna, pedido.sol, pedido.rio] }).expect(201);
    reparto = r.body.id;
    expect(r.body.estado).toBe('preparacion');
    expect(r.body.carga).toEqual([expect.objectContaining({ descripcion: 'Gaseosa 2 L', cantidad: '60.0000' })]);
    expect(r.body.total).toBe('720000.00');
    const dup = await http(app).post('/api/repartos').set(h).send({ cajaId, fecha: '2026-11-15', repartidor: 'Otro', pedidoIds: [pedido.sol] }).expect(409);
    expect(dup.body.codigo).toBe('PEDIDO_EN_REPARTO');

    const antes = await stock();
    const efAntes = await efectivo();
    const d = await http(app).post(`/api/repartos/${reparto}/despachar`).set(h).expect(200);
    expect(d.body.errores).toEqual([]);
    expect(d.body.estado).toBe('en_ruta');
    expect(d.body.pedidos.every((p: { venta: unknown }) => p.venta)).toBe(true);
    expect(await stock()).toBe(antes - 60);
    expect(await efectivo()).toBe(efAntes);
    const sol = d.body.pedidos.find((p: { pedidoId: string }) => p.pedidoId === pedido.sol);
    const luna = d.body.pedidos.find((p: { pedidoId: string }) => p.pedidoId === pedido.luna);
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
    expect(sol.cuenta).toMatchObject({ saldo: '144000.00', vencimiento: hoy }); // contra entrega
    expect(luna.cuenta.vencimiento > hoy).toBe(true);
    await http(app).post(`/api/repartos/${reparto}/anular`).set(h).send({ motivo: 'Prueba' }).expect(409);
    await http(app).post(`/api/repartos/${reparto}/despachar`).set(h).expect(409);
  });

  it('rendición: cobros a la caja, devoluciones al stock, rechazado reprogramado y la diferencia de efectivo', async () => {
    const r = (await http(app).get(`/api/repartos/${reparto}`).set(h).expect(200)).body;
    const luna = r.pedidos.find((p: { pedidoId: string }) => p.pedidoId === pedido.luna);
    // Falta uno.
    await http(app).post(`/api/repartos/${reparto}/rendir`).set(h).send({ entregas: [{ pedidoId: pedido.sol, estado: 'entregado', cobrado: 144000 }], efectivoEntregado: 144000 }).expect(400);
    const antes = await stock();
    const efAntes = await efectivo();
    const rendido = await http(app)
      .post(`/api/repartos/${reparto}/rendir`)
      .set(h)
      .send({
        entregas: [
          { pedidoId: pedido.sol, estado: 'entregado', cobrado: 144000, medio: 'efectivo' },
          { pedidoId: pedido.luna, estado: 'parcial', devuelto: [{ linea: 1, cantidad: 4 }], motivo: 'Botellas golpeadas', cobrado: 100000, medio: 'transferencia' },
          { pedidoId: pedido.rio, estado: 'rechazado', motivo: 'Local cerrado', reprogramar: true },
        ],
        efectivoEntregado: 140000,
      })
      .expect(200);
    expect(rendido.body.estado).toBe('rendido');
    expect(rendido.body.efectivoEsperado).toBe('144000.00');
    expect(rendido.body.diferencia).toBe('-4000.00');
    expect(rendido.body.cobrado).toBe('244000.00');
    expect(await stock()).toBe(antes + 4 + 24);
    expect(await efectivo()).toBe(efAntes + 144000);

    const lunaDespues = rendido.body.pedidos.find((p: { pedidoId: string }) => p.pedidoId === pedido.luna);
    expect(lunaDespues).toMatchObject({ estado: 'parcial', devuelto: '48000.00' });
    expect(lunaDespues.cuenta.saldo).toBe(String((Number(luna.total) - 48000 - 100000).toFixed(2)));
    const solDespues = rendido.body.pedidos.find((p: { pedidoId: string }) => p.pedidoId === pedido.sol);
    expect(solDespues.cuenta.saldo).toBe('0.00');
    // El rechazado vuelve a estar libre para el próximo reparto.
    const libres = (await http(app).get(`/api/repartos/pedidos?sucursalId=${e.sucursalId}`).set(h).expect(200)).body;
    expect(libres.map((p: { id: string }) => p.id)).toContain(pedido.rio);
    expect((await http(app).get(`/api/pedidos/${pedido.rio}`).set(h).expect(200)).body.estado).toBe('pendiente');
    await http(app).post(`/api/repartos/${reparto}/rendir`).set(h).send({ entregas: [{ pedidoId: pedido.sol, estado: 'entregado' }], efectivoEntregado: 0 }).expect(409);

    const lista = (await http(app).get('/api/repartos').set(h).expect(200)).body;
    expect(lista[0]).toMatchObject({ estado: 'rendido', pedidos: 3, diferencia: '-4000.00' });
  });
});
