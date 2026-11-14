import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEmpresa, http, iniciarApp, type EmpresaPrueba } from './ayudas';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const clave = () => `clave-${Math.random().toString(36).slice(2)}`;

/**
 * Tienda de ropa. Remera básica en grade P/M/G × Negro/Blanco a 80.000; jean a 150.000.
 * Cambio: el cliente devuelve una remera (80.000) y queda un vale; con él paga parte del jean y el resto en efectivo.
 */
describe('Ropa: grade talle × color y cambio con vale', () => {
  let app: INestApplication;
  let e: EmpresaPrueba;
  let h: { Authorization: string };
  let depositoId = '';
  let cajaId = '';
  let remera: { id: string; variantes: { id: string; talle: string; color: string; nombre: string; sku: string }[] };
  let jean = '';
  let venta = '';
  let vale = { id: '', codigo: '' };

  const celda = (talle: string, color: string) => remera.variantes.find((v) => v.talle === talle && v.color === color)!.id;
  const esperado = async () => {
    const s = await http(app).get(`/api/cajas/${cajaId}/sesion`).set(h).expect(200);
    return Number(s.body.esperado.find((x: { moneda: string; medio: string }) => x.moneda === 'PYG' && x.medio === 'efectivo')?.monto ?? 0);
  };

  beforeAll(async () => {
    app = await iniciarApp();
    e = await crearEmpresa(app, 'BUSINESS');
    h = auth(e.propietario.token);
    depositoId = (await http(app).get('/api/depositos').set(h).expect(200)).body[0].id;
    const caja = await http(app).post('/api/cajas').set(h).send({ nombre: 'Caja ropa', sucursalId: e.sucursalId, depositoId }).expect(201);
    cajaId = caja.body.id;
    await http(app).post(`/api/cajas/${cajaId}/abrir`).set(h).send({ fondos: [{ moneda: 'PYG', monto: 50000 }] }).expect(201);
  });
  afterAll(() => app.close());

  it('producto con grade: nombre armado, talles y colores únicos, stock por celda', async () => {
    const variantes = ['P', 'M', 'G'].flatMap((talle) => ['Negro', 'Blanco'].map((color) => ({ talle, color, sku: `REM-${talle}-${color.slice(0, 3).toUpperCase()}`, precio: 80000, costo: 35000, codigos: [] })));
    await http(app)
      .post('/api/productos')
      .set(h)
      .send({ nombre: 'Remera repetida', tasaIva: 10, variantes: [variantes[0], { ...variantes[0], sku: 'OTRO' }] })
      .expect(400);
    const r = await http(app).post('/api/productos').set(h).send({ nombre: 'Remera básica', tasaIva: 10, variantes }).expect(201);
    remera = r.body;
    expect(remera.variantes).toHaveLength(6);
    expect(remera.variantes.find((v) => v.talle === 'M' && v.color === 'Negro')!.nombre).toBe('M · Negro');
    jean = (await http(app).post('/api/productos').set(h).send({ nombre: 'Jean recto', tasaIva: 10, variantes: [{ talle: '42', color: 'Azul', precio: 150000, costo: 70000, codigos: [] }] }).expect(201)).body.variantes[0].id;
    await http(app)
      .post('/api/stock/ajustes')
      .set(h)
      .send({ depositoId, tipo: 'inicial', motivo: 'Inicial', items: [...remera.variantes.map((v) => ({ varianteId: v.id, cantidadNueva: v.talle === 'G' ? 0 : 5 })), { varianteId: jean, cantidadNueva: 3 }] })
      .expect(201);

    const g = await http(app).get(`/api/stock/grade?productoId=${remera.id}`).set(h).expect(200);
    expect(g.body.talles).toEqual(['P', 'M', 'G']);
    expect(g.body.colores).toEqual(['Blanco', 'Negro']);
    const mNegro = g.body.celdas.find((c: { talle: string; color: string }) => c.talle === 'M' && c.color === 'Negro');
    expect(Number(mNegro.stock[depositoId])).toBe(5);

    const p = await http(app).get(`/api/pdv/grade?cajaId=${cajaId}&productoId=${remera.id}`).set(h).expect(200);
    expect(p.body.items).toHaveLength(6);
    expect(p.body.items.find((i: { talle: string; color: string }) => i.talle === 'G' && i.color === 'Blanco').stock).toBe('0.0000');
    const b = await http(app).get(`/api/pdv/buscar?cajaId=${cajaId}&q=remera`).set(h).expect(200);
    expect(b.body.items[0].productoId).toBe(remera.id);
    expect(b.body.items[0].talle).toBeTruthy();

    // Quitar una celda la desactiva y libera el talle × color para volver a crearlo.
    const sinGNegro = remera.variantes.filter((v) => !(v.talle === 'G' && v.color === 'Negro'));
    const editado = await http(app)
      .patch(`/api/productos/${remera.id}`)
      .set(h)
      .send({ nombre: 'Remera básica', tasaIva: 10, variantes: [...sinGNegro.map((v) => ({ id: v.id, talle: v.talle, color: v.color, sku: v.sku, precio: 80000, codigos: [] })), { talle: 'G', color: 'Negro', precio: 80000, codigos: [] }] })
      .expect(200);
    expect(editado.body.variantes.filter((v: { activa: boolean }) => v.activa)).toHaveLength(6);
    remera = { ...editado.body, variantes: editado.body.variantes.filter((v: { activa: boolean }) => v.activa) };
  });

  it('cambio: la devolución con vale no saca dinero de la caja y deja el saldo a favor', async () => {
    const v = await http(app)
      .post('/api/ventas')
      .set(h)
      .send({ claveIdempotencia: clave(), cajaId, items: [{ varianteId: celda('M', 'Negro'), cantidad: 2 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 160000 }] })
      .expect(201);
    venta = v.body.id;
    // La caja encuentra la venta por su número (la de cualquier caja de la sucursal).
    const busca = await http(app).get(`/api/pdv/venta-cambio?cajaId=${cajaId}&numero=${v.body.numero}`).set(h).expect(200);
    expect(busca.body.map((x: { id: string }) => x.id)).toContain(venta);
    // Validez de los vales: configuración de la empresa.
    await http(app).patch('/api/empresa').set(h).send({ valeDias: 30 }).expect(200);
    const antes = await esperado();
    const d = await http(app).post('/api/devoluciones').set(h).send({ ventaId: venta, cajaId, medio: 'vale', motivo: 'Cambio de talle', items: [{ linea: 1, cantidad: 1 }] }).expect(201);
    expect(d.body.vale.monto).toBe('80000.00');
    expect(d.body.vale.codigo).toMatch(/^\d{10}$/);
    const en30 = new Date(Date.parse(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date())}T12:00:00Z`) + 30 * 86400000).toISOString().slice(0, 10);
    expect(d.body.vale.vence).toBe(en30);
    expect(await esperado()).toBe(antes);
    vale = { id: d.body.vale.id, codigo: d.body.vale.codigo };

    const c = await http(app).get(`/api/vales/codigo/${vale.codigo}`).set(h).expect(200);
    expect(c.body.saldo).toBe('80000.00');
    expect(c.body.estado).toBe('vigente');
    expect(c.body.venta).toBe(v.body.numero);
    await http(app).get('/api/vales/codigo/0000000000').set(h).expect(404);
  });

  it('el vale paga parte de otra venta; no da vuelto ni supera su saldo; anular la venta lo repone', async () => {
    const vender = (pagos: object[]) => http(app).post('/api/ventas').set(h).send({ claveIdempotencia: clave(), cajaId, items: [{ varianteId: jean, cantidad: 1 }], pagos });
    // Más que el saldo del vale.
    const mas = await vender([{ medio: 'vale', moneda: 'PYG', monto: 90000, referencia: vale.codigo }, { medio: 'efectivo', moneda: 'PYG', monto: 60000 }]).expect(409);
    expect(mas.body.codigo).toBe('VALE_SIN_SALDO');
    // Sin código.
    await vender([{ medio: 'vale', moneda: 'PYG', monto: 50000 }, { medio: 'efectivo', moneda: 'PYG', monto: 100000 }]).expect(400);

    const antes = await esperado();
    const v = await vender([{ medio: 'vale', moneda: 'PYG', monto: 80000, referencia: vale.codigo }, { medio: 'efectivo', moneda: 'PYG', monto: 100000 }]).expect(201);
    expect(Number(v.body.vuelto[0].monto)).toBe(30000);
    expect(await esperado()).toBe(antes + 70000);
    expect(v.body.pagos.map((p: { medio: string }) => p.medio)).toEqual(['vale', 'efectivo']);
    expect((await http(app).get(`/api/vales/${vale.id}`).set(h).expect(200)).body.estado).toBe('usado');
    // Ya usado.
    const otra = await vender([{ medio: 'vale', moneda: 'PYG', monto: 1000, referencia: vale.codigo }, { medio: 'efectivo', moneda: 'PYG', monto: 149000 }]).expect(409);
    expect(otra.body.codigo).toBe('VALE_SIN_SALDO');

    await http(app).post(`/api/ventas/${v.body.id}/anular`).set(h).send({ motivo: 'Error de cobro' }).expect(200);
    const detalle = (await http(app).get(`/api/vales/${vale.id}`).set(h).expect(200)).body;
    expect(detalle.saldo).toBe('80000.00');
    expect(detalle.movimientos.map((m: { tipo: string }) => m.tipo)).toEqual(['emision', 'uso', 'reintegro']);
    expect(await esperado()).toBe(antes);

    const lista = (await http(app).get('/api/vales?estado=vigente').set(h).expect(200)).body;
    expect(lista.items.map((x: { id: string }) => x.id)).toContain(vale.id);
    expect(lista.saldoVigente).toBe('80000.00');
  });

  it('contabilidad: el vale es un pasivo que nace en la devolución y se cancela al usarlo', async () => {
    await http(app).post('/api/contabilidad/cuentas/plan-sugerido').set(h).expect(201);
    // Usado en una venta que queda firme: 30.000 de saldo.
    await http(app)
      .post('/api/ventas')
      .set(h)
      .send({ claveIdempotencia: clave(), cajaId, items: [{ varianteId: celda('P', 'Blanco'), cantidad: 1 }], pagos: [{ medio: 'vale', moneda: 'PYG', monto: 50000, referencia: vale.codigo }, { medio: 'efectivo', moneda: 'PYG', monto: 30000 }] })
      .expect(201);
    await http(app).post('/api/contabilidad/contabilizar').set(h).send({}).expect(200);
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
    const b = (await http(app).get(`/api/contabilidad/balance?desde=2026-01-01&hasta=${hoy}`).set(h).expect(200)).body;
    const vales = b.filas.find((f: { codigo: string }) => f.codigo === '2.1.06');
    expect(Math.abs(Number(vales.saldo))).toBe(30000);
  });
});
