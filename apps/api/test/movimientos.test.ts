import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONTRASENA, crearEmpresa, crearUsuario, http, iniciarApp, unico, type EmpresaPrueba } from './ayudas';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Transferencias y devoluciones', () => {
  let app: INestApplication;
  let e: EmpresaPrueba;
  let h: { Authorization: string };
  let depA: string; // casa matriz
  let depB: string; // sucursal 2
  let sucB: string;

  const saldo = async (dep: string, varianteId: string) => {
    const r = await http(app).get(`/api/stock?depositoId=${dep}`).set(h).expect(200);
    return Number(r.body.find((x: { varianteId: string }) => x.varianteId === varianteId)?.cantidad ?? 0);
  };
  const producto = async (precio: number, stock: number) => {
    const p = await http(app).post('/api/productos').set(h).send({ nombre: `P ${unico()}`, variantes: [{ precio, codigos: [] }] }).expect(201);
    const v = p.body.variantes[0].id as string;
    await http(app).post('/api/stock/ajustes').set(h).send({ depositoId: depA, motivo: 'Inicial', items: [{ varianteId: v, cantidadNueva: stock }] }).expect(201);
    return v;
  };

  beforeAll(async () => {
    app = await iniciarApp();
    e = await crearEmpresa(app); // BUSINESS: 3 sucursales
    h = auth(e.propietario.token);
    const s2 = await http(app).post('/api/sucursales').set(h).send({ nombre: 'Ciudad del Este', codigo: '002' }).expect(201);
    sucB = s2.body.id;
    const deps = await http(app).get('/api/depositos').set(h).expect(200);
    depA = deps.body.find((d: { sucursal: { id: string } }) => d.sucursal.id === e.sucursalId).id;
    depB = deps.body.find((d: { sucursal: { id: string } }) => d.sucursal.id === sucB).id;
  });
  afterAll(() => app.close());

  describe('transferencias', () => {
    it('directa: sale y entra en el acto', async () => {
      const v = await producto(1000, 10);
      const r = await http(app).post('/api/transferencias').set(h).send({ origenId: depA, destinoId: depB, directa: true, items: [{ varianteId: v, cantidad: 4 }] }).expect(201);
      expect(r.body).toMatchObject({ estado: 'recibida', numero: 1 });
      expect([await saldo(depA, v), await saldo(depB, v)]).toEqual([6, 4]);
    });

    it('en tránsito: el destino confirma y los faltantes quedan registrados', async () => {
      const v = await producto(1000, 10);
      const t = await http(app).post('/api/transferencias').set(h).send({ origenId: depA, destinoId: depB, items: [{ varianteId: v, cantidad: 5 }] }).expect(201);
      expect(t.body.estado).toBe('en_transito');
      expect([await saldo(depA, v), await saldo(depB, v)]).toEqual([5, 0]);

      // Encargado de stock de la sucursal origen: no puede confirmar la recepción en el destino.
      const enA = await crearUsuario(app, e, 'stock', [e.sucursalId]);
      await http(app).post(`/api/transferencias/${t.body.id}/recibir`).set(auth(enA.token)).send({}).expect(403);

      const enB = await crearUsuario(app, e, 'stock', [sucB]);
      const r = await http(app).post(`/api/transferencias/${t.body.id}/recibir`).set(auth(enB.token)).send({ items: [{ linea: 1, cantidadRecibida: 4 }] }).expect(200);
      expect(r.body.estado).toBe('recibida');
      expect(r.body.items[0]).toMatchObject({ cantidadRecibida: '4.0000', faltante: '1.0000' });
      expect([await saldo(depA, v), await saldo(depB, v)]).toEqual([5, 4]);
      await http(app).post(`/api/transferencias/${t.body.id}/recibir`).set(auth(enB.token)).send({}).expect(409);
    });

    it('cancelar una en tránsito devuelve la mercadería al origen', async () => {
      const v = await producto(1000, 3);
      const t = await http(app).post('/api/transferencias').set(h).send({ origenId: depA, destinoId: depB, items: [{ varianteId: v, cantidad: 3 }] }).expect(201);
      expect(await saldo(depA, v)).toBe(0);
      const c = await http(app).post(`/api/transferencias/${t.body.id}/cancelar`).set(h).send({ motivo: 'Camión sin lugar' }).expect(200);
      expect(c.body).toMatchObject({ estado: 'cancelada', motivoCancelacion: 'Camión sin lugar' });
      expect(await saldo(depA, v)).toBe(3);
    });

    it('no transfiere más de lo que hay', async () => {
      const v = await producto(1000, 2);
      const r = await http(app).post('/api/transferencias').set(h).send({ origenId: depA, destinoId: depB, items: [{ varianteId: v, cantidad: 5 }] }).expect(409);
      expect(r.body.codigo).toBe('STOCK_INSUFICIENTE');
      expect(await saldo(depA, v)).toBe(2);
    });

    it('quien opera en otra sucursal no saca stock de un depósito ajeno', async () => {
      const v = await producto(1000, 5);
      const enB = await crearUsuario(app, e, 'stock', [sucB]);
      await http(app).post('/api/transferencias').set(auth(enB.token)).send({ origenId: depA, destinoId: depB, items: [{ varianteId: v, cantidad: 1 }] }).expect(404);
    });
  });

  describe('devoluciones', () => {
    let v: string;
    let caja: string;
    let venta: { id: string };
    let cajero: Awaited<ReturnType<typeof crearUsuario>>;
    let sup: Awaited<ReturnType<typeof crearUsuario>>;

    beforeAll(async () => {
      v = await producto(10000, 20);
      const c1 = await http(app).post('/api/cajas').set(h).send({ nombre: 'Caja 1', sucursalId: e.sucursalId, depositoId: depA }).expect(201);
      caja = c1.body.id;
      await http(app).post(`/api/cajas/${caja}/abrir`).set(h).send({ fondos: [{ moneda: 'PYG', monto: 50000 }] }).expect(201);
      // 3 unidades con 3.000 de descuento: total 27.000 (9.000 c/u).
      const r = await http(app)
        .post('/api/ventas')
        .set(h)
        .send({ claveIdempotencia: unico('dv-'), cajaId: caja, items: [{ varianteId: v, cantidad: 3, descuento: 3000 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 27000 }] })
        .expect(201);
      venta = r.body;
      // Se cierra la caja: la venta ya no se puede anular, solo devolver.
      await http(app).post(`/api/cajas/${caja}/cerrar`).set(h).send({ contado: [{ moneda: 'PYG', medio: 'efectivo', monto: 77000 }] }).expect(200);
      cajero = await crearUsuario(app, e, 'cajero');
      sup = await crearUsuario(app, e, 'supervisor');
      await http(app).put('/api/auth/pin').set(auth(sup.token)).send({ pin: '7777', contrasena: CONTRASENA }).expect(204);
    });

    it('una venta de caja cerrada no se anula: se devuelve', async () => {
      const r = await http(app).post(`/api/ventas/${venta.id}/anular`).set(h).send({ motivo: 'x x x' }).expect(409);
      expect(r.body.codigo).toBe('SESION_CERRADA');
    });

    it('el cajero necesita el PIN del supervisor y su propia caja abierta', async () => {
      const c2 = await http(app).post('/api/cajas').set(h).send({ nombre: 'Caja 2', sucursalId: e.sucursalId, depositoId: depA }).expect(201);
      const cuerpo = { ventaId: venta.id, cajaId: c2.body.id, motivo: 'Producto fallado', items: [{ linea: 1, cantidad: 1 }] };
      await http(app).post('/api/devoluciones').set(auth(cajero.token)).send(cuerpo).expect(403);
      const pin = await http(app).post('/api/autorizaciones').set(auth(cajero.token)).send({ usuarioId: sup.id, pin: '7777', permiso: 'devolucion.aprobar' }).expect(200);
      const x = { 'X-Autorizacion': pin.body.autorizacion };
      await http(app).post('/api/devoluciones').set(auth(cajero.token)).set(x).send(cuerpo).expect(409); // caja cerrada
      await http(app).post(`/api/cajas/${c2.body.id}/abrir`).set(auth(cajero.token)).send({ fondos: [{ moneda: 'PYG', monto: 100000 }] }).expect(201);
      const antes = await saldo(depA, v);
      const d = await http(app).post('/api/devoluciones').set(auth(cajero.token)).set(x).send(cuerpo).expect(201);
      // Proporcional al total con descuento: 27.000 / 3 = 9.000.
      expect(d.body).toMatchObject({ total: '9000.00', numero: 1, medio: 'efectivo' });
      expect(await saldo(depA, v)).toBe(antes + 1);
      const ses = await http(app).get(`/api/cajas/${c2.body.id}/sesion`).set(auth(cajero.token)).expect(200);
      expect(ses.body.esperado).toContainEqual({ moneda: 'PYG', medio: 'efectivo', monto: '91000.00' });
    });

    it('no se devuelve más de lo vendido, y la última devolución cierra el total exacto', async () => {
      const c3 = await http(app).post('/api/cajas').set(h).send({ nombre: 'Caja 3', sucursalId: e.sucursalId, depositoId: depA }).expect(201);
      await http(app).post(`/api/cajas/${c3.body.id}/abrir`).set(h).send({ fondos: [{ moneda: 'PYG', monto: 100000 }] }).expect(201);
      const r = await http(app).post('/api/devoluciones').set(h).send({ ventaId: venta.id, cajaId: c3.body.id, motivo: 'Más', items: [{ linea: 1, cantidad: 3 }] }).expect(400);
      expect(r.body.mensaje).toMatch(/como máximo 2/);
      const d = await http(app).post('/api/devoluciones').set(h).send({ ventaId: venta.id, cajaId: c3.body.id, motivo: 'Resto', items: [{ linea: 1, cantidad: 2 }] }).expect(201);
      expect(d.body.total).toBe('18000.00');
      const vv = await http(app).get(`/api/ventas/${venta.id}`).set(h).expect(200);
      expect(vv.body.items[0].cantidadDevuelta).toBe('3.0000');
      expect(vv.body.devoluciones).toHaveLength(2);
      await http(app).post('/api/devoluciones').set(h).send({ ventaId: venta.id, cajaId: c3.body.id, motivo: 'Otra', items: [{ linea: 1, cantidad: 1 }] }).expect(400);
    });

    it('sin efectivo suficiente en la caja no reintegra en efectivo', async () => {
      const otra = await http(app)
        .post('/api/ventas')
        .set(h)
        .send({ claveIdempotencia: unico('dv-'), cajaId: (await http(app).get('/api/cajas').set(h)).body.find((c: { nombre: string }) => c.nombre === 'Caja 3').id, items: [{ varianteId: v, cantidad: 1 }], pagos: [{ medio: 'tarjeta', moneda: 'PYG', monto: 10000 }] })
        .expect(201);
      const vacia = await crearUsuario(app, e, 'gerente');
      const c4 = await http(app).post('/api/cajas').set(h).send({ nombre: 'Caja 4', sucursalId: e.sucursalId, depositoId: depA }).expect(201);
      await http(app).post(`/api/cajas/${c4.body.id}/abrir`).set(auth(vacia.token)).send({}).expect(201);
      const r = await http(app).post('/api/devoluciones').set(auth(vacia.token)).send({ ventaId: otra.body.id, cajaId: c4.body.id, motivo: 'Fallado', items: [{ linea: 1, cantidad: 1 }] }).expect(409);
      expect(r.body.codigo).toBe('SALDO_INSUFICIENTE');
      await http(app).post('/api/devoluciones').set(auth(vacia.token)).send({ ventaId: otra.body.id, cajaId: c4.body.id, medio: 'tarjeta', motivo: 'Fallado', items: [{ linea: 1, cantidad: 1 }] }).expect(201);
    });
  });
});
