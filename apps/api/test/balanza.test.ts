import type { INestApplication } from '@nestjs/common';
import { digitoEan13 } from '@kontiva/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEmpresa, http, iniciarApp, prepararVenta, type EmpresaPrueba } from './ayudas';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const etiqueta = (doce: string) => doce + digitoEan13(doce);

/** Etiquetas de balanza: el PDV reconoce el PLU y carga el producto con su peso. */
describe('Balanza etiquetadora', () => {
  let app: INestApplication;
  let e: EmpresaPrueba;
  let h: { Authorization: string };
  let cajaId: string;
  let varianteId: string;

  beforeAll(async () => {
    app = await iniciarApp();
    e = await crearEmpresa(app, 'BUSINESS');
    h = auth(e.propietario.token);
    const base = await prepararVenta(app, e, 100);
    cajaId = base.cajaId;
    // Producto por kilo, con el PLU de la balanza como código de barras.
    const p = await http(app)
      .post('/api/productos')
      .set(h)
      .send({ nombre: 'Queso Paraguay', tasaIva: 5, unidad: 'kg', variantes: [{ precio: 25000, costo: 18000, codigos: ['000123'] }] })
      .expect(201);
    varianteId = p.body.variantes[0].id;
  });
  afterAll(() => app.close());

  const buscar = (q: string) => http(app).get(`/api/pdv/buscar?cajaId=${cajaId}&q=${q}`).set(h).expect(200);

  it('está desactivada por defecto', async () => {
    const r = await http(app).get('/api/empresa').set(h).expect(200);
    expect(r.body.balanza).toMatchObject({ activa: false, prefijo: '2', digitosCodigo: 6, contenido: 'peso' });
    const b = await buscar(etiqueta('200012301250'));
    expect(b.body.items).toHaveLength(0);
  });

  it('con etiqueta de peso carga el producto con la cantidad', async () => {
    await http(app).patch('/api/empresa').set(h).send({ balanza: { activa: true, prefijo: '2', digitosCodigo: 6, contenido: 'peso', decimalesPeso: 3 } }).expect(200);
    const ctx = await http(app).get(`/api/pdv/contexto?cajaId=${cajaId}`).set(h).expect(200);
    expect(ctx.body.balanza.activa).toBe(true);
    const b = await buscar(etiqueta('200012301250'));
    expect(b.body.porCodigo).toBe(true);
    expect(b.body.items).toHaveLength(1);
    expect(b.body.items[0]).toMatchObject({ varianteId, cantidad: '1.250' });
    // Dígito verificador incorrecto: no es una etiqueta y no coincide con ningún código.
    const malo = await buscar('2000123012509');
    expect(malo.body.items).toHaveLength(0);
  });

  it('con etiqueta de importe calcula la cantidad con el precio vigente', async () => {
    await http(app).patch('/api/empresa').set(h).send({ balanza: { activa: true, prefijo: '2', digitosCodigo: 6, contenido: 'precio', decimalesPeso: 3 } }).expect(200);
    const b = await buscar(etiqueta('200012331250'));
    expect(b.body.items[0]).toMatchObject({ varianteId, cantidad: '1.250' });
  });

  it('rechaza una configuración inválida', async () => {
    await http(app).patch('/api/empresa').set(h).send({ balanza: { activa: true, prefijo: '7', digitosCodigo: 6, contenido: 'peso', decimalesPeso: 3 } }).expect(400);
  });
});
