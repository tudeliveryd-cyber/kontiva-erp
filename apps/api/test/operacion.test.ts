import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../src/db/database';
import { CONTRASENA, crearEmpresa, crearUsuario, http, iniciarApp, prepararVenta, unico, type EmpresaPrueba } from './ayudas';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Operación central: catálogo, stock, caja y PDV', () => {
  let app: INestApplication;
  let e: EmpresaPrueba;
  let h: { Authorization: string };
  let depositoId: string;

  async function producto(precio: number, opciones: Record<string, unknown> = {}) {
    const r = await http(app)
      .post('/api/productos')
      .set(h)
      .send({ nombre: `Producto ${unico()}`, tasaIva: 10, variantes: [{ precio, costo: Math.round(precio * 0.6), codigos: [] }], ...opciones })
      .expect(201);
    return { id: r.body.id as string, varianteId: r.body.variantes[0].id as string };
  }
  async function stock(varianteId: string, cantidad: number) {
    await http(app).post('/api/stock/ajustes').set(h).send({ depositoId, motivo: 'Conteo', items: [{ varianteId, cantidadNueva: cantidad }] }).expect(201);
  }
  async function saldo(varianteId: string) {
    const r = await http(app).get(`/api/stock?depositoId=${depositoId}`).set(h).expect(200);
    return Number(r.body.find((x: { varianteId: string }) => x.varianteId === varianteId).cantidad);
  }
  async function cajaAbierta(token: string, fondos: { moneda: string; monto: number }[] = []) {
    const c = await http(app).post('/api/cajas').set(h).send({ nombre: `Caja ${unico()}`, sucursalId: e.sucursalId, depositoId }).expect(201);
    await http(app).post(`/api/cajas/${c.body.id}/abrir`).set(auth(token)).send({ fondos }).expect(201);
    return c.body.id as string;
  }
  const vender = (token: string, cuerpo: Record<string, unknown>, extra: Record<string, string> = {}) =>
    http(app).post('/api/ventas').set(auth(token)).set(extra).send({ claveIdempotencia: unico('k-'), ...cuerpo });

  beforeAll(async () => {
    app = await iniciarApp();
    e = await crearEmpresa(app, 'ENTERPRISE');
    h = auth(e.propietario.token);
    depositoId = (await http(app).get('/api/depositos').set(h).expect(200)).body[0].id;
    await http(app).post('/api/cotizaciones').set(h).send({ sucursalId: e.sucursalId, moneda: 'USD', compra: 7300, venta: 7450 }).expect(201);
    await http(app).post('/api/cotizaciones').set(h).send({ sucursalId: e.sucursalId, moneda: 'BRL', compra: 1280, venta: 1320 }).expect(201);
  });
  afterAll(() => app.close());

  describe('catálogo', () => {
    it('crea producto con variantes, códigos y precio; el costo es confidencial', async () => {
      const r = await http(app)
        .post('/api/productos')
        .set(h)
        .send({
          nombre: 'Remera básica',
          tasaIva: 10,
          variantes: [
            { nombre: 'Talle M', sku: 'REM-M', precio: 65000, costo: 30000, codigos: ['7891000000011'] },
            { nombre: 'Talle L', sku: 'REM-L', precio: 65000, costo: 30000, codigos: ['7891000000028'] },
          ],
        })
        .expect(201);
      expect(r.body.variantes).toHaveLength(2);
      expect(r.body.variantes[0]).toMatchObject({ nombre: 'Talle M', precio: '65000.00', costo: '30000.00', codigos: ['7891000000011'] });

      const v = await crearUsuario(app, e, 'vendedor');
      const vista = await http(app).get(`/api/productos/${r.body.id}`).set(auth(v.token)).expect(200);
      expect(vista.body.variantes[0].costo).toBeUndefined();
      expect(vista.body.variantes[0].precio).toBe('65000.00');
    });

    it('no repite códigos de barras entre productos', async () => {
      await http(app).post('/api/productos').set(h).send({ nombre: 'Otro', variantes: [{ precio: 1000, codigos: ['7891000000011'] }] }).expect(409);
    });

    it('quien no tiene costo_producto.editar no carga costos', async () => {
      const s = await crearUsuario(app, e, 'stock');
      const r = await http(app).post('/api/productos').set(auth(s.token)).send({ nombre: 'Con costo', variantes: [{ precio: 1000, costo: 500, codigos: [] }] }).expect(403);
      expect(r.body.mensaje).toMatch(/costos/);
    });

    it('editar desactiva las variantes que ya no vienen (no se borran)', async () => {
      const p = await producto(5000);
      const r = await http(app).get(`/api/productos/${p.id}`).set(h).expect(200);
      const editado = await http(app)
        .patch(`/api/productos/${p.id}`)
        .set(h)
        .send({ nombre: r.body.nombre, variantes: [{ nombre: 'Nueva', precio: 6000, codigos: [] }] })
        .expect(200);
      expect(editado.body.variantes.find((x: { id: string }) => x.id === p.varianteId).activa).toBe(false);
    });
  });

  describe('stock', () => {
    it('cada ajuste deja un movimiento con saldo y motivo', async () => {
      const p = await producto(1000);
      await stock(p.varianteId, 12);
      await stock(p.varianteId, 9);
      const m = await http(app).get(`/api/stock/movimientos?varianteId=${p.varianteId}&depositoId=${depositoId}`).set(h).expect(200);
      expect(m.body.map((x: { cantidad: string; saldo: string }) => [Number(x.cantidad), Number(x.saldo)])).toEqual([[-3, 9], [12, 12]]);
      expect(await saldo(p.varianteId)).toBe(9);
      // soloBajo=false no filtra (regresión: "false" se interpretaba como verdadero).
      const todos = await http(app).get(`/api/stock?depositoId=${depositoId}&soloBajo=false`).set(h).expect(200);
      expect(todos.body.some((x: { varianteId: string }) => x.varianteId === p.varianteId)).toBe(true);
      const bajos = await http(app).get(`/api/stock?depositoId=${depositoId}&soloBajo=true`).set(h).expect(200);
      expect(bajos.body.some((x: { varianteId: string }) => x.varianteId === p.varianteId)).toBe(false);
    });
  });

  describe('venta', () => {
    let caja: string;
    let p: { id: string; varianteId: string };
    let s: { id: string; varianteId: string };

    beforeAll(async () => {
      caja = await cajaAbierta(e.propietario.token, [{ moneda: 'PYG', monto: 200000 }, { moneda: 'USD', monto: 50 }]);
      p = await producto(11000); // IVA 10
      s = await producto(21000, { tasaIva: 5 });
      await stock(p.varianteId, 10);
      await stock(s.varianteId, 10);
    });

    it('calcula IVA y totales en el servidor, descuenta stock y registra la caja', async () => {
      const r = await vender(e.propietario.token, {
        cajaId: caja,
        items: [{ varianteId: p.varianteId, cantidad: 2 }, { varianteId: s.varianteId, cantidad: 1 }],
        pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 50000 }],
      }).expect(201);
      expect(r.body).toMatchObject({ total: '43000.00', gravado10: '22000.00', iva10: '2000.00', gravado5: '21000.00', iva5: '1000.00', comprobante: 'interno', estado: 'confirmada' });
      expect(r.body.vuelto).toEqual([{ moneda: 'PYG', monto: '7000.00' }]);
      expect(await saldo(p.varianteId)).toBe(8);
      const ses = await http(app).get(`/api/cajas/${caja}/sesion`).set(h).expect(200);
      expect(ses.body.esperado).toContainEqual({ moneda: 'PYG', medio: 'efectivo', monto: '243000.00' });
    });

    it('ignora un precio enviado por el navegador sin permiso', async () => {
      const c = await crearUsuario(app, e, 'cajero');
      const cc = await cajaAbierta(c.token);
      await vender(c.token, { cajaId: cc, items: [{ varianteId: p.varianteId, cantidad: 1, precioUnitario: 1 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 11000 }] }).expect(403);
    });

    it('la misma clave de idempotencia no duplica la venta ni el stock', async () => {
      const antes = await saldo(p.varianteId);
      const cuerpo = { claveIdempotencia: unico('rep-'), cajaId: caja, items: [{ varianteId: p.varianteId, cantidad: 1 }], pagos: [{ medio: 'tarjeta', moneda: 'PYG', monto: 11000 }] };
      const [a, b] = await Promise.all([
        http(app).post('/api/ventas').set(h).send(cuerpo),
        http(app).post('/api/ventas').set(h).send(cuerpo),
      ]);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.id).toBe(b.body.id);
      expect(await saldo(p.varianteId)).toBe(antes - 1);
    });

    it('cobro mixto en reales y dólares con vuelto en dólares y guaraníes', async () => {
      // total 33.000 · R$ 10 (12.800) + US$ 10 (73.000) = 85.800 → vuelto 52.800 = US$ 7 (52.150) + 650 Gs
      const r = await vender(e.propietario.token, {
        cajaId: caja,
        items: [{ varianteId: p.varianteId, cantidad: 3 }],
        pagos: [{ medio: 'efectivo', moneda: 'BRL', monto: 10 }, { medio: 'efectivo', moneda: 'USD', monto: 10 }],
        vueltoMoneda: 'USD',
      }).expect(201);
      expect(r.body.pagos.map((x: { moneda: string; montoPyg: string }) => [x.moneda, x.montoPyg])).toEqual([['BRL', '12800.00'], ['USD', '73000.00']]);
      expect(r.body.vuelto).toEqual([{ moneda: 'USD', monto: '7.00' }, { moneda: 'PYG', monto: '650.00' }]);
      const ses = await http(app).get(`/api/cajas/${caja}/sesion`).set(h).expect(200);
      expect(ses.body.esperado).toContainEqual({ moneda: 'USD', medio: 'efectivo', monto: '53.00' }); // 50 + 10 − 7
      expect(ses.body.esperado).toContainEqual({ moneda: 'BRL', medio: 'efectivo', monto: '10.00' });
    });

    it('rechaza pago insuficiente y tarjeta por encima del total', async () => {
      const a = await vender(e.propietario.token, { cajaId: caja, items: [{ varianteId: p.varianteId, cantidad: 1 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 5000 }] }).expect(400);
      expect(a.body.codigo).toBe('PAGO_INSUFICIENTE');
      const b = await vender(e.propietario.token, { cajaId: caja, items: [{ varianteId: p.varianteId, cantidad: 1 }], pagos: [{ medio: 'tarjeta', moneda: 'PYG', monto: 20000 }] }).expect(400);
      expect(b.body.codigo).toBe('PAGO_EXCEDE');
    });

    it('no vende sin stock salvo que la empresa lo permita', async () => {
      const x = await producto(1000);
      const r = await vender(e.propietario.token, { cajaId: caja, items: [{ varianteId: x.varianteId, cantidad: 1 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 1000 }] }).expect(409);
      expect(r.body.codigo).toBe('STOCK_INSUFICIENTE');
      await http(app).patch('/api/empresa').set(h).send({ permiteStockNegativo: true }).expect(200);
      await vender(e.propietario.token, { cajaId: caja, items: [{ varianteId: x.varianteId, cantidad: 1 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 1000 }] }).expect(201);
      expect(await saldo(x.varianteId)).toBe(-1);
      await http(app).patch('/api/empresa').set(h).send({ permiteStockNegativo: false }).expect(200);
    });

    it('un producto por unidad no acepta cantidades con decimales; uno por kg sí', async () => {
      await vender(e.propietario.token, { cajaId: caja, items: [{ varianteId: p.varianteId, cantidad: 1.5 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 50000 }] }).expect(400);
      const kg = await producto(32000, { unidad: 'kg', tasaIva: 5 });
      await stock(kg.varianteId, 20);
      const r = await vender(e.propietario.token, { cajaId: caja, items: [{ varianteId: kg.varianteId, cantidad: 1.375 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 44000 }] }).expect(201);
      expect(r.body.total).toBe('44000.00');
      expect(await saldo(kg.varianteId)).toBe(18.625);
    });
  });

  describe('cajero, supervisor y PIN', () => {
    let cajero: Awaited<ReturnType<typeof crearUsuario>>;
    let sup: Awaited<ReturnType<typeof crearUsuario>>;
    let caja: string;
    let p: { id: string; varianteId: string };

    async function pin(permiso: string) {
      const r = await http(app).post('/api/autorizaciones').set(auth(cajero.token)).send({ usuarioId: sup.id, pin: '2468', permiso }).expect(200);
      return { 'X-Autorizacion': r.body.autorizacion as string };
    }

    beforeAll(async () => {
      cajero = await crearUsuario(app, e, 'cajero');
      sup = await crearUsuario(app, e, 'supervisor');
      await http(app).put('/api/auth/pin').set(auth(sup.token)).send({ pin: '2468', contrasena: CONTRASENA }).expect(204);
      caja = await cajaAbierta(cajero.token, [{ moneda: 'PYG', monto: 50000 }]);
      p = await producto(10000);
      await stock(p.varianteId, 50);
    });

    it('nadie vende en la caja abierta por otro usuario', async () => {
      await vender(sup.token, { cajaId: caja, items: [{ varianteId: p.varianteId, cantidad: 1 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 10000 }] }).expect(403);
    });

    it('el descuento del cajero requiere el PIN del supervisor y queda registrado', async () => {
      const cuerpo = { cajaId: caja, items: [{ varianteId: p.varianteId, cantidad: 1, descuento: 1000 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 9000 }] };
      await vender(cajero.token, cuerpo).expect(403);
      const r = await vender(cajero.token, cuerpo, await pin('descuento.aprobar')).expect(201);
      expect(r.body).toMatchObject({ total: '9000.00', descuento: '1000.00', autorizadoPor: sup.id });
    });

    it('anular requiere PIN, devuelve el stock y revierte la caja', async () => {
      const antes = await saldo(p.varianteId);
      const v = await vender(cajero.token, { cajaId: caja, items: [{ varianteId: p.varianteId, cantidad: 2 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 50000 }] }).expect(201);
      const sesAntes = await http(app).get(`/api/cajas/${caja}/sesion`).set(auth(cajero.token)).expect(200);
      await http(app).post(`/api/ventas/${v.body.id}/anular`).set(auth(cajero.token)).send({ motivo: 'Cliente desistió' }).expect(403);
      const r = await http(app).post(`/api/ventas/${v.body.id}/anular`).set(auth(cajero.token)).set(await pin('venta.cancelar')).send({ motivo: 'Cliente desistió' }).expect(200);
      expect(r.body.estado).toBe('anulada');
      expect(r.body.anulacion).toMatchObject({ motivo: 'Cliente desistió', autorizadaPor: sup.id });
      expect(await saldo(p.varianteId)).toBe(antes);
      const sesDespues = await http(app).get(`/api/cajas/${caja}/sesion`).set(auth(cajero.token)).expect(200);
      const efectivo = (s: { body: { esperado: { moneda: string; medio: string; monto: string }[] } }) => Number(s.body.esperado.find((x) => x.moneda === 'PYG' && x.medio === 'efectivo')!.monto);
      expect(efectivo(sesDespues)).toBe(efectivo(sesAntes) - 20000);
      await http(app).post(`/api/ventas/${v.body.id}/anular`).set(auth(cajero.token)).set(await pin('venta.cancelar')).send({ motivo: 'Otra vez' }).expect(409);
    });

    it('retiro de efectivo: requiere supervisor y no puede superar lo que hay', async () => {
      const cuerpo = { tipo: 'retiro', moneda: 'PYG', monto: 30000, motivo: 'Depósito al banco' };
      await http(app).post(`/api/cajas/${caja}/movimientos`).set(auth(cajero.token)).send(cuerpo).expect(403);
      await http(app).post(`/api/cajas/${caja}/movimientos`).set(auth(cajero.token)).set(await pin('caja.aprobar')).send({ ...cuerpo, monto: 99999999 }).expect(409);
      await http(app).post(`/api/cajas/${caja}/movimientos`).set(auth(cajero.token)).set(await pin('caja.aprobar')).send(cuerpo).expect(201);
    });

    it('cierre con arqueo: registra la diferencia y bloquea nuevas ventas', async () => {
      const ses = await http(app).get(`/api/cajas/${caja}/sesion`).set(auth(cajero.token)).expect(200);
      const esperadoPyg = Number(ses.body.esperado.find((x: { moneda: string; medio: string }) => x.moneda === 'PYG' && x.medio === 'efectivo').monto);
      const r = await http(app)
        .post(`/api/cajas/${caja}/cerrar`)
        .set(auth(cajero.token))
        .send({ contado: [{ moneda: 'PYG', medio: 'efectivo', monto: esperadoPyg - 2000 }] })
        .expect(200);
      expect(r.body.estado).toBe('cerrada');
      expect(r.body.arqueo).toContainEqual({ moneda: 'PYG', medio: 'efectivo', esperado: esperadoPyg.toFixed(2), contado: (esperadoPyg - 2000).toFixed(2), diferencia: '-2000.00' });
      await vender(cajero.token, { cajaId: caja, items: [{ varianteId: p.varianteId, cantidad: 1 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 10000 }] }).expect(409);
    });
  });

  describe('concurrencia', () => {
    it('20 cajas vendiendo el mismo producto a la vez: el stock final cuadra exactamente', async () => {
      const p = await producto(5000);
      await stock(p.varianteId, 50);
      const cajeros = await Promise.all(Array.from({ length: 20 }, () => crearUsuario(app, e, 'cajero')));
      const cajas: string[] = [];
      for (const c of cajeros) cajas.push(await cajaAbierta(c.token));

      // 20 cajas × 3 ventas = 60 intentos sobre 50 unidades: 50 pasan, 10 por falta de stock.
      const intentos = cajeros.flatMap((c, i) =>
        Array.from({ length: 3 }, () => vender(c.token, { cajaId: cajas[i], items: [{ varianteId: p.varianteId, cantidad: 1 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 5000 }] })),
      );
      const r = await Promise.all(intentos);
      const ok = r.filter((x) => x.status === 201).length;
      const sinStock = r.filter((x) => x.status === 409 && x.body.codigo === 'STOCK_INSUFICIENTE').length;
      expect(ok).toBe(50);
      expect(sinStock).toBe(10);
      expect(await saldo(p.varianteId)).toBe(0);

      // El saldo coincide con la suma de movimientos, y la numeración por caja no tiene huecos.
      const db = app.get(Db);
      await db.enEmpresa(e.empresaId, async (tx) => {
        const suma = await tx.selectFrom('movimiento_stock').select((eb) => eb.fn.sum<string>('cantidad').as('s')).where('variante_id', '=', p.varianteId).executeTakeFirstOrThrow();
        expect(Number(suma.s)).toBe(0);
        for (const cajaId of cajas) {
          const nums = (await tx.selectFrom('venta').select('numero').where('caja_id', '=', cajaId).orderBy('numero').execute()).map((x) => Number(x.numero));
          expect(nums).toEqual(nums.map((_, i) => i + 1));
        }
      });
    }, 120_000);
  });

  describe('búsqueda del PDV', () => {
    it('encuentra por código de barras exacto con precio y stock de la caja', async () => {
      // Otra empresa: el propietario de `e` ya tiene una caja abierta (una por persona).
      const otra = await crearEmpresa(app);
      const vb = await prepararVenta(app, otra, 7);
      const r = await http(app).get(`/api/pdv/buscar?cajaId=${vb.cajaId}&q=${vb.codigo}`).set(auth(otra.propietario.token)).expect(200);
      expect(r.body.porCodigo).toBe(true);
      expect(r.body.items[0]).toMatchObject({ varianteId: vb.varianteId, precio: '11000.00', tasaIva: 10, stock: '6.0000' });
    });
  });
});
