import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEmpresa, crearUsuario, http, iniciarApp, login, prepararVenta, unico, type EmpresaPrueba } from './ayudas';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());

/** Farmacia: condición de venta, recetas, principio activo y recetario. */
describe('Farmacia', () => {
  let app: INestApplication;
  let e: EmpresaPrueba;
  let h: { Authorization: string };
  let base: Awaited<ReturnType<typeof prepararVenta>>;
  const v: Record<string, string> = {};

  const producto = async (nombre: string, extra: object, stock = 20) => {
    const p = await http(app).post('/api/productos').set(h).send({ nombre, tasaIva: 10, controlaLote: true, variantes: [{ precio: 10000, costo: 5000, codigos: [] }], ...extra }).expect(201);
    const id = p.body.variantes[0].id as string;
    await http(app).post('/api/stock/ajustes').set(h).send({ depositoId: base.depositoId, motivo: 'Inicial', items: [{ varianteId: id, cantidadNueva: stock, lote: { codigo: `L${nombre.length}`, vencimiento: '2028-01-31' } }] }).expect(201);
    return id;
  };
  const vender = (items: string[], receta?: object) =>
    http(app)
      .post('/api/ventas')
      .set(h)
      .send({ claveIdempotencia: unico('f-'), cajaId: base.cajaId, items: items.map((varianteId) => ({ varianteId, cantidad: 1 })), pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: items.length * 10000 }], ...(receta ? { receta } : {}) });
  const receta = { medico: 'Dra. Carmen Villalba', matricula: 'RP 12345', paciente: 'Juan Pérez', fecha: hoy(), numero: '0001' };

  beforeAll(async () => {
    app = await iniciarApp();
    e = await crearEmpresa(app, 'BUSINESS');
    h = auth(e.propietario.token);
    base = await prepararVenta(app, e, 100);
    v.paracetamol = await producto('Dolofen 500', { principioActivo: 'Paracetamol', concentracion: '500 mg', forma: 'Comprimido', registroSanitario: 'DNVS 01234' });
    v.generico = await producto('Paracetamol genérico', { principioActivo: 'paracetamol', concentracion: '500 MG' }, 0);
    v.otroGenerico = await producto('Paracetamol Lab', { principioActivo: 'Paracetamol', concentracion: '500 mg' }, 7);
    v.amoxi = await producto('Amoxicilina 500', { principioActivo: 'Amoxicilina', concentracion: '500 mg', condicionVenta: 'receta' });
    v.clona = await producto('Clonazepam 2', { principioActivo: 'Clonazepam', concentracion: '2 mg', condicionVenta: 'receta_archivada' });
  });
  afterAll(() => app.close());

  it('el producto guarda los datos del medicamento', async () => {
    const l = await http(app).get('/api/productos?q=amoxicilina').set(h).expect(200);
    const p = (l.body.items ?? l.body).find((x: { nombre: string }) => x.nombre === 'Amoxicilina 500');
    expect(p).toMatchObject({ principioActivo: 'Amoxicilina', concentracion: '500 mg', condicionVenta: 'receta', controlaLote: true });
  });

  it('el PDV busca por principio activo y ofrece equivalentes', async () => {
    const b = await http(app).get(`/api/pdv/buscar?cajaId=${base.cajaId}&q=paracetamol`).set(h).expect(200);
    expect(b.body.items.map((i: { descripcion: string }) => i.descripcion).sort()).toEqual(['Dolofen 500', 'Paracetamol Lab', 'Paracetamol genérico']);
    expect(b.body.items.find((i: { varianteId: string }) => i.varianteId === v.paracetamol)).toMatchObject({ principioActivo: 'Paracetamol', condicionVenta: 'libre' });
    const eq = await http(app).get(`/api/pdv/equivalentes?cajaId=${base.cajaId}&varianteId=${v.generico}`).set(h).expect(200);
    // Primero los que tienen stock.
    expect(eq.body.items.map((i: { varianteId: string }) => i.varianteId)).toEqual([v.paracetamol, v.otroGenerico]);
  });

  it('venta libre sin receta; bajo receta exige la receta', async () => {
    await vender([v.paracetamol]).expect(201);
    const sin = await vender([v.paracetamol, v.amoxi]).expect(400);
    expect(sin.body.codigo).toBe('RECETA_REQUERIDA');
    await vender([v.amoxi], { ...receta, fecha: '2099-01-01' }).expect(400);
    const ok = await vender([v.paracetamol, v.amoxi], receta).expect(201);
    const d = await http(app).get(`/api/ventas/${ok.body.id}`).set(h).expect(200);
    expect(d.body.receta).toMatchObject({ medico: 'Dra. Carmen Villalba', matricula: 'RP 12345', retenida: false });
    expect(d.body.items.map((i: { condicionVenta: string | null }) => i.condicionVenta)).toEqual([null, 'receta']);
    expect(d.body.items[1].lotes).toEqual([{ codigo: 'L15', vencimiento: '2028-01-31', cantidad: '1.0000' }]);
  });

  it('receta archivada: retenida y con la cédula del paciente', async () => {
    const a = await vender([v.clona], receta).expect(400);
    expect(a.body.codigo).toBe('RECETA_ARCHIVADA');
    await vender([v.clona], { ...receta, retenida: true }).expect(400);
    await vender([v.clona], { ...receta, retenida: true, pacienteDocumento: '3456789' }).expect(201);
  });

  it('libro recetario: por fecha, búsqueda y solo archivadas; con permiso', async () => {
    const r = await http(app).get(`/api/recetas?desde=${hoy()}&hasta=${hoy()}`).set(h).expect(200);
    expect(r.body).toHaveLength(2);
    expect(r.body[0]).toMatchObject({ medico: 'Dra. Carmen Villalba', paciente: 'Juan Pérez', archivada: false, items: [{ descripcion: 'Amoxicilina 500', cantidad: '1', condicionVenta: 'receta', lotes: ['L15'] }] });
    const ar = await http(app).get(`/api/recetas?desde=${hoy()}&hasta=${hoy()}&soloArchivadas=true`).set(h).expect(200);
    expect(ar.body).toHaveLength(1);
    expect(ar.body[0]).toMatchObject({ retenida: true, pacienteDocumento: '3456789', archivada: true });
    const bu = await http(app).get(`/api/recetas?desde=${hoy()}&hasta=${hoy()}&buscar=3456789`).set(h).expect(200);
    expect(bu.body).toHaveLength(1);
    const caj = await crearUsuario(app, e, 'cajero');
    await http(app).get(`/api/recetas?desde=${hoy()}&hasta=${hoy()}`).set(auth((await login(app, caj.email)).token)).expect(403);
  });
});
