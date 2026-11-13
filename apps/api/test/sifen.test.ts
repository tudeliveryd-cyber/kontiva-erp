import type { INestApplication } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import { unzipSync, strFromU8 } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calcularDvRuc } from '@kontiva/shared';
import { generarP12DePrueba } from '../src/sifen/certificado';
import { sha256Hex, valor, verificarFirma } from '../src/sifen/firma';
import { crearEmpresa, crearUsuario, http, iniciarApp, login, prepararVenta, rucValido, unico, type EmpresaPrueba } from './ayudas';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RUC = '80069563-1';
const CSC = 'ABCD0000000000000000000000000000';

/** Simulador de SIFEN: verifica la firma de cada DE y responde como los servicios reales. */
class SifenSimulado {
  server!: Server;
  lotes = new Map<string, { cdc: string; aprobado: boolean; motivo?: string }[]>();
  eventos: string[] = [];
  falla = false;
  private n = 1000;
  async iniciar(): Promise<string> {
    this.server = createServer((req, res) => {
      let cuerpo = '';
      req.on('data', (c) => (cuerpo += c));
      req.on('end', () => {
        const ns = 'xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd"';
        const sobre = (x: string) => `<?xml version="1.0" encoding="UTF-8"?><env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Header/><env:Body>${x}</env:Body></env:Envelope>`;
        if (this.falla) {
          res.writeHead(503).end('Servicio no disponible');
          return;
        }
        if (req.url!.endsWith('recibe-lote.wsdl')) {
          const zip = Buffer.from(valor(cuerpo, 'xDE')!, 'base64');
          const lote = strFromU8(unzipSync(new Uint8Array(zip))['lote.xml']!);
          const docs = lote.match(/<rDE[\s\S]*?<\/rDE>/g) ?? [];
          const protocolo = String(++this.n);
          this.lotes.set(
            protocolo,
            docs.map((d) => {
              const cdc = /Id="([0-9]{44})"/.exec(d)![1]!;
              const firmaOk = verificarFirma(d);
              const rechazar = (valor(d, 'dNomRec') ?? '').includes('RECHAZAR');
              return { cdc, aprobado: firmaOk && !rechazar, motivo: !firmaOk ? '0141 Firma difiere del estándar' : rechazar ? '1309 RUC del receptor inexistente' : undefined };
            }),
          );
          res.end(sobre(`<ns2:rResEnviLoteDe ${ns}><ns2:dFecProc>2026-11-12T10:00:00</ns2:dFecProc><ns2:dCodRes>0300</ns2:dCodRes><ns2:dMsgRes>Lote recibido con éxito</ns2:dMsgRes><ns2:dProtConsLote>${protocolo}</ns2:dProtConsLote><ns2:dTpoProces>0</ns2:dTpoProces></ns2:rResEnviLoteDe>`));
          return;
        }
        if (req.url!.endsWith('consulta-lote.wsdl')) {
          const docs = this.lotes.get(valor(cuerpo, 'dProtConsLote')!);
          if (!docs) {
            res.end(sobre(`<ns2:rResEnviConsLoteDe ${ns}><ns2:dCodResLot>0360</ns2:dCodResLot><ns2:dMsgResLot>Número de Lote inexistente</ns2:dMsgResLot></ns2:rResEnviConsLoteDe>`));
            return;
          }
          const items = docs
            .map((d) =>
              d.aprobado
                ? `<ns2:gResProcLote><ns2:id>${d.cdc}</ns2:id><ns2:dEstRes>Aprobado</ns2:dEstRes><ns2:dProtAut>${d.cdc.slice(-10)}</ns2:dProtAut><ns2:gResProc><ns2:dCodRes>0260</ns2:dCodRes><ns2:dMsgRes>Autorización del DE satisfactoria</ns2:dMsgRes></ns2:gResProc></ns2:gResProcLote>`
                : `<ns2:gResProcLote><ns2:id>${d.cdc}</ns2:id><ns2:dEstRes>Rechazado</ns2:dEstRes><ns2:gResProc><ns2:dCodRes>${d.motivo!.slice(0, 4)}</ns2:dCodRes><ns2:dMsgRes>${d.motivo!.slice(5)}</ns2:dMsgRes></ns2:gResProc></ns2:gResProcLote>`,
            )
            .join('');
          res.end(sobre(`<ns2:rResEnviConsLoteDe ${ns}><ns2:dFecProc>2026-11-12T10:00:05</ns2:dFecProc><ns2:dCodResLot>0362</ns2:dCodResLot><ns2:dMsgResLot>Procesamiento de lote concluido</ns2:dMsgResLot>${items}</ns2:rResEnviConsLoteDe>`));
          return;
        }
        if (req.url!.endsWith('evento.wsdl')) {
          this.eventos.push(cuerpo);
          const cdc = valor(cuerpo, 'Id')!;
          const ok = verificarFirma(cuerpo) && [...this.lotes.values()].flat().some((d) => d.cdc === cdc && d.aprobado);
          res.end(sobre(`<ns2:rRetEnviEventoDe ${ns}><ns2:dFecProc>2026-11-12T10:00:09</ns2:dFecProc><ns2:gResProcEVe><ns2:dEstRes>${ok ? 'Aprobado' : 'Rechazado'}</ns2:dEstRes>${ok ? '<ns2:dProtAut>9988776655</ns2:dProtAut>' : ''}<ns2:id>1</ns2:id><ns2:gResProc><ns2:dCodRes>${ok ? '0600' : '4002'}</ns2:dCodRes><ns2:dMsgRes>${ok ? 'Evento registrado correctamente' : 'CDC inexistente o firma inválida'}</ns2:dMsgRes></ns2:gResProc></ns2:gResProcEVe></ns2:rRetEnviEventoDe>`));
          return;
        }
        res.writeHead(404).end();
      });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    const dir = this.server.address() as { port: number };
    return `http://127.0.0.1:${dir.port}`;
  }
}

describe('Facturación electrónica (SIFEN)', () => {
  const sifen = new SifenSimulado();
  let app: INestApplication;
  let e: EmpresaPrueba;
  let h: { Authorization: string };
  let base: Awaited<ReturnType<typeof prepararVenta>>;

  const vender = (cuerpo: object = {}, token = e.propietario.token) =>
    http(app)
      .post('/api/ventas')
      .set(auth(token))
      .send({ claveIdempotencia: unico('fe-'), cajaId: base.cajaId, items: [{ varianteId: base.varianteId, cantidad: 2 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 50000 }], ...cuerpo });
  const procesar = () => http(app).post('/api/facturacion/procesar').set(h).send({}).expect(200);

  beforeAll(async () => {
    process.env.SIFEN_URL_TEST = await sifen.iniciar();
    app = await iniciarApp();
    e = await crearEmpresa(app, 'BUSINESS');
    h = auth(e.propietario.token);
    base = await prepararVenta(app, e, 100); // precio 11.000 IVA 10 %
  });
  afterAll(async () => {
    await app.close();
    sifen.server.close();
  });

  it('no se activa sin completar la configuración', async () => {
    const c = await http(app).get('/api/facturacion/configuracion').set(h).expect(200);
    expect(c.body.activa).toBe(false);
    expect(c.body.pendientes.length).toBeGreaterThan(4);
    const r = await http(app).post('/api/facturacion/activar').set(h).send({ activa: true }).expect(400);
    expect(r.body.mensaje).toContain('Falta completar');
  });

  it('geografía de la DNIT', async () => {
    const dep = await http(app).get('/api/facturacion/geografia').set(h).expect(200);
    expect(dep.body).toContainEqual({ codigo: 11, nombre: 'ALTO PARANA' });
    const dis = await http(app).get('/api/facturacion/geografia?departamento=11').set(h).expect(200);
    expect(dis.body).toContainEqual({ codigo: 145, nombre: 'CIUDAD DEL ESTE' });
    const ciu = await http(app).get('/api/facturacion/geografia?distrito=145').set(h).expect(200);
    expect(ciu.body.some((c: { codigo: number }) => c.codigo === 3383)).toBe(true);
  });

  it('carga la configuración, el certificado, la sucursal y el punto, y activa', async () => {
    await http(app).patch('/api/empresa').set(h).send({ ruc: RUC, email: 'facturas@empresa.test' }).expect(200);
    const otro = generarP12DePrueba('80012345-6', 'clave');
    const mal = await http(app).post('/api/facturacion/certificado').set(h).send({ archivo: otro, clave: 'clave' }).expect(400);
    expect(mal.body.mensaje).toContain('80012345-6');
    await http(app).post('/api/facturacion/certificado').set(h).send({ archivo: generarP12DePrueba(RUC, 'clave'), clave: 'otra' }).expect(400);
    const cert = await http(app).post('/api/facturacion/certificado').set(h).send({ archivo: generarP12DePrueba(RUC, 'clave'), clave: 'clave' }).expect(200);
    expect(cert.body.certificado).toMatchObject({ titular: 'EMPRESA DE PRUEBA', ruc: RUC });

    await http(app)
      .put('/api/facturacion/configuracion')
      .set(h)
      .send({ ambiente: 'test', tipoContribuyente: 2, actividadCodigo: '47190', actividadDescripcion: 'Venta al por menor', timbradoNumero: '12558946', timbradoFecha: '2026-01-01', cscId: '1', csc: CSC })
      .expect(200);
    await http(app)
      .put(`/api/facturacion/establecimientos/${e.sucursalId}`)
      .set(h)
      .send({ direccion: 'Avda. San Blas', numeroCasa: '123', departamento: 11, distrito: 145, ciudad: 3432, telefono: '061 500 000' })
      .expect(200);
    await http(app).put(`/api/facturacion/establecimientos/${e.sucursalId}`).set(h).send({ direccion: 'X calle', departamento: 11, distrito: 145, ciudad: 1, telefono: '061500000' }).expect(400);
    const p = await http(app).put(`/api/facturacion/puntos/${base.cajaId}`).set(h).send({ punto: '001' }).expect(200);
    expect(p.body.pendientes).toEqual([]);
    const a = await http(app).post('/api/facturacion/activar').set(h).send({ activa: true }).expect(200);
    expect(a.body).toMatchObject({ activa: true, ambiente: 'test', cscId: '0001', cscCargado: true });
    expect(JSON.stringify(a.body)).not.toContain(CSC);
  });

  let facturaId: string;
  let ventaId: string;
  it('la venta emite la factura electrónica firmada con QR, en la misma transacción', async () => {
    const v = await vender().expect(201);
    ventaId = v.body.id;
    expect(v.body.comprobante).toBe('factura');
    const de = v.body.documentoElectronico;
    expect(de).toMatchObject({ numero: '001-001-0000001', timbrado: '12558946', estado: 'pendiente', ambiente: 'test', totalIva: '2000.00' });
    expect(de.cdc).toMatch(/^01800695631001001000000122/);
    facturaId = de.id;
    const d = await http(app).get(`/api/facturacion/documentos/${facturaId}`).set(h).expect(200);
    expect(verificarFirma(d.body.xml)).toBe(true);
    expect(valor(d.body.xml, 'dNomEmi')).toBe('DE generado en ambiente de prueba - sin valor comercial ni fiscal');
    expect(valor(d.body.xml, 'dTotGralOpe')).toBe('22000');
    expect(valor(d.body.xml, 'iTipIDRec')).toBe('5'); // innominado
    // QR: el hash se calcula con el CSC.
    const qr: string = d.body.qr;
    const [params, hash] = qr.split('?')[1]!.split('&cHashQR=');
    expect(sha256Hex(params + CSC)).toBe(hash);
    expect(qr).toContain('consultas-test');
    // El segundo número es correlativo.
    const v2 = await vender({ items: [{ varianteId: base.varianteId, cantidad: 1 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 11000 }] }).expect(201);
    expect(v2.body.documentoElectronico.numero).toBe('001-001-0000002');
  });

  it('el emisor envía el lote, consulta el resultado y queda aprobado', async () => {
    const r1 = await procesar();
    expect(r1.body.enviados).toBe(2);
    let d = await http(app).get(`/api/facturacion/documentos/${facturaId}`).set(h).expect(200);
    expect(d.body.estado).toBe('enviado');
    await espera(1100);
    const r2 = await procesar();
    expect(r2.body.consultados).toBe(2);
    d = await http(app).get(`/api/facturacion/documentos/${facturaId}`).set(h).expect(200);
    expect(d.body).toMatchObject({ estado: 'aprobado', respuesta: { codigo: '0260' } });
    expect(d.body.protocoloAutorizacion).toBeTruthy();
  });

  it('cliente contribuyente: B2B con RUC; rechazo de SIFEN y reenvío', async () => {
    const malo = await http(app).post('/api/clientes').set(h).send({ nombre: 'RUC Mal SA', documento: `80012345-${(calcularDvRuc('80012345') + 1) % 10}` }).expect(201);
    const e1 = await vender({ clienteId: malo.body.id }).expect(400);
    expect(e1.body.mensaje).toContain('no es válido');
    const ruc = rucValido();
    const cl = await http(app).post('/api/clientes').set(h).send({ nombre: 'RECHAZAR SA', documento: ruc }).expect(201);
    const v = await vender({ clienteId: cl.body.id }).expect(201);
    const id = v.body.documentoElectronico.id;
    let d = await http(app).get(`/api/facturacion/documentos/${id}`).set(h).expect(200);
    expect(valor(d.body.xml, 'iNatRec')).toBe('1');
    expect(valor(d.body.xml, 'dRucRec')).toBe(ruc.split('-')[0]);
    expect(valor(d.body.xml, 'iTiOpe')).toBe('1');
    await procesar();
    await espera(1100);
    await procesar();
    d = await http(app).get(`/api/facturacion/documentos/${id}`).set(h).expect(200);
    expect(d.body).toMatchObject({ estado: 'rechazado', respuesta: { codigo: '1309' } });
    const lista = await http(app).get('/api/facturacion/documentos?estado=rechazado').set(h).expect(200);
    expect(lista.body.map((x: { id: string }) => x.id)).toContain(id);
    await http(app).post(`/api/facturacion/documentos/${id}/reenviar`).set(h).send({}).expect(200);
    d = await http(app).get(`/api/facturacion/documentos/${id}`).set(h).expect(200);
    expect(d.body.estado).toBe('pendiente');
    await http(app).post(`/api/facturacion/documentos/${facturaId}/reenviar`).set(h).send({}).expect(409);
  });

  it('cédula: receptor no contribuyente con documento', async () => {
    const cl = await http(app).post('/api/clientes').set(h).send({ nombre: 'Juan Pérez', documento: '4567890' }).expect(201);
    const v = await vender({ clienteId: cl.body.id }).expect(201);
    const d = await http(app).get(`/api/facturacion/documentos/${v.body.documentoElectronico.id}`).set(h).expect(200);
    expect(valor(d.body.xml, 'iNatRec')).toBe('2');
    expect(valor(d.body.xml, 'iTipIDRec')).toBe('1');
    expect(valor(d.body.xml, 'dNumIDRec')).toBe('4567890');
  });

  it('SIFEN caído: el documento queda pendiente con reintento', async () => {
    sifen.falla = true;
    const r = await procesar();
    expect(r.body.enviados).toBe(0);
    const l = await http(app).get('/api/facturacion/documentos?estado=pendiente').set(h).expect(200);
    expect(l.body.length).toBeGreaterThan(0);
    expect(l.body[0].mensaje).toContain('503');
    sifen.falla = false;
  });

  it('anular una venta con factura aprobada envía el evento de cancelación firmado', async () => {
    const r = await http(app).post(`/api/ventas/${ventaId}/anular`).set(h).send({ motivo: 'Error de carga' }).expect(200);
    expect(r.body.estado).toBe('anulada');
    expect(sifen.eventos).toHaveLength(1);
    expect(sifen.eventos[0]).toContain('<rGeVeCan>');
    const d = await http(app).get(`/api/facturacion/documentos/${facturaId}`).set(h).expect(200);
    expect(d.body).toMatchObject({ estado: 'cancelado', cancelacion: { motivo: 'Error de carga' } });
  });

  it('con la factura en proceso no se anula; la devolución espera la nota de crédito', async () => {
    const v = await vender().expect(201);
    const r = await http(app).post(`/api/ventas/${v.body.id}/anular`).set(h).send({ motivo: 'Probando' }).expect(409);
    expect(r.body.codigo).toBe('FE_EN_PROCESO');
    const dv = await http(app).post('/api/devoluciones').set(h).send({ ventaId: v.body.id, cajaId: base.cajaId, motivo: 'Fallado', items: [{ linea: 1, cantidad: 1 }] }).expect(409);
    expect(dv.body.codigo).toBe('NOTA_CREDITO_PENDIENTE');
  });

  it('caja sin punto de expedición: comprobante interno', async () => {
    const c = await http(app).post('/api/cajas').set(h).send({ nombre: `Caja ${unico()}`, sucursalId: e.sucursalId, depositoId: base.depositoId }).expect(201);
    const cajero = await crearUsuario(app, e, 'cajero');
    const t = (await login(app, cajero.email)).token;
    await http(app).post(`/api/cajas/${c.body.id}/abrir`).set(auth(t)).send({}).expect(201);
    const v = await http(app)
      .post('/api/ventas')
      .set(auth(t))
      .send({ claveIdempotencia: unico('fe-'), cajaId: c.body.id, items: [{ varianteId: base.varianteId, cantidad: 1 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 11000 }] })
      .expect(201);
    expect(v.body).toMatchObject({ comprobante: 'interno', documentoElectronico: null });
    // El cajero no ve la configuración fiscal ni los secretos.
    await http(app).get('/api/facturacion/configuracion').set(auth(t)).expect(403);
  });
});
