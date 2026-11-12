import type { INestApplication } from '@nestjs/common';
import { calcularDvRuc } from '@kontiva/shared';
import request from 'supertest';
import { codigoActual } from '../src/auth/segundo-factor';
import { crearApp } from '../src/bootstrap';
import { Db } from '../src/db/database';
import { Correo } from '../src/comun/correo';
import { ProvisionService } from '../src/provision/provision.service';

export const CONTRASENA = 'clave-segura-123';

let contador = 0;
export const unico = (p = 'x') => `${p}${Date.now().toString(36)}${(contador++).toString(36)}`;

export async function iniciarApp(): Promise<INestApplication> {
  const app = await crearApp();
  await app.init();
  return app;
}

export const http = (app: INestApplication) => request(app.getHttpServer());

/** Extrae el token de un correo de invitación o recuperación. */
export function tokenDeCorreo(app: INestApplication, email: string): string {
  const m = [...app.get(Correo).enviados].reverse().find((x) => x.para === email);
  const t = m?.texto.match(/token=([A-Za-z0-9_-]+)/)?.[1];
  if (!t) throw new Error(`Sin correo con token para ${email}`);
  return t;
}

export interface EmpresaPrueba {
  empresaId: string;
  sucursalId: string;
  propietario: { email: string; usuarioId: string; token: string };
}

/**
 * Inicia sesión como lo haría una persona: si el plan exige segundo factor, lo configura;
 * si la cuenta lo tiene, ingresa el código (calculado desde el secreto, como el teléfono).
 */
export async function login(app: INestApplication, email: string, contrasena = CONTRASENA, empresaId?: string) {
  let r = await http(app).post('/api/auth/login').send({ email, contrasena, empresaId });
  const db = app.get(Db);
  if (r.body.tipo === 'configurar_segundo_factor') {
    await http(app).post('/api/auth/2fa/enrolar').send({ ticket: r.body.ticket }).expect(200);
    const c = await db.k.selectFrom('cuenta').select('totp_pendiente').where('email', '=', email).executeTakeFirstOrThrow();
    const fin = await http(app).post('/api/auth/2fa/enrolar/confirmar').send({ ticket: r.body.ticket, codigo: codigoActual(c.totp_pendiente!) }).expect(200);
    r = { ...r, body: fin.body.siguiente, headers: fin.headers } as typeof r;
  } else if (r.body.tipo === 'segundo_factor') {
    // Varios ingresos en los mismos 30 s: las pruebas liberan el último paso usado.
    await db.k.updateTable('cuenta').set({ totp_ultimo_paso: null }).where('email', '=', email).execute();
    const c = await db.k.selectFrom('cuenta').select('totp_secreto').where('email', '=', email).executeTakeFirstOrThrow();
    r = await http(app).post('/api/auth/2fa/verificar').send({ ticket: r.body.ticket, codigo: codigoActual(c.totp_secreto!) });
  }
  if (r.status !== 200 || r.body.tipo !== 'sesion') throw new Error(`Login falló ${r.status}: ${JSON.stringify(r.body)}`);
  const cookie = ([] as string[]).concat(r.headers['set-cookie'] ?? []).find((c) => c.startsWith('kontiva_rt='))!;
  return { token: r.body.accessToken as string, cookie: cookie.split(';')[0]! };
}

/** Alta completa de una empresa con propietario activo y con sesión iniciada. */
export async function crearEmpresa(app: INestApplication, plan = 'BUSINESS'): Promise<EmpresaPrueba> {
  const email = `${unico('dueno')}@prueba.com.py`;
  const r = await app.get(ProvisionService).crearEmpresa({
    razonSocial: `Empresa ${unico()} S.A.`,
    planCodigo: plan,
    propietario: { email, nombre: 'Dueño de Prueba' },
  });
  await http(app).post('/api/auth/restablecer').send({ token: tokenDeCorreo(app, email), contrasena: CONTRASENA }).expect(204);
  const { token } = await login(app, email);
  return { empresaId: r.empresaId, sucursalId: r.sucursalId, propietario: { email, usuarioId: r.usuarioId, token } };
}

/** Crea un usuario con el perfil (clave de plantilla) indicado y devuelve su sesión. */
export async function crearUsuario(app: INestApplication, e: EmpresaPrueba, clavePerfil: string, sucursalIds = [e.sucursalId]) {
  const perfiles = await http(app).get('/api/perfiles').set('Authorization', `Bearer ${e.propietario.token}`).expect(200);
  const perfil = perfiles.body.find((p: { clave: string }) => p.clave === clavePerfil);
  const email = `${unico(clavePerfil)}@prueba.com.py`;
  const u = await http(app)
    .post('/api/usuarios')
    .set('Authorization', `Bearer ${e.propietario.token}`)
    .send({ email, nombre: `Usuario ${clavePerfil}`, perfilId: perfil.id, sucursalIds })
    .expect(201);
  await http(app).post('/api/auth/restablecer').send({ token: tokenDeCorreo(app, email), contrasena: CONTRASENA }).expect(204);
  const s = await login(app, email);
  return { id: u.body.id as string, email, token: s.token, cookie: s.cookie, perfilId: perfil.id as string };
}

/** RUC aleatorio con dígito verificador correcto. */
export function rucValido(): string {
  const base = String(80000000 + Math.floor(Math.random() * 9999999));
  return `${base}-${calcularDvRuc(base)}`;
}

/**
 * Deja una empresa lista para vender: producto con código de barras y stock, caja abierta
 * por el propietario y una venta hecha. Devuelve los ids.
 */
export async function prepararVenta(app: INestApplication, e: EmpresaPrueba, stockInicial = 10) {
  const h = { Authorization: `Bearer ${e.propietario.token}` };
  const codigo = String(7840000000000 + Math.floor(Math.random() * 99999999));
  const p = await http(app)
    .post('/api/productos')
    .set(h)
    .send({ nombre: `Producto ${unico()}`, tasaIva: 10, variantes: [{ precio: 11000, costo: 7000, codigos: [codigo] }] })
    .expect(201);
  const varianteId = p.body.variantes[0].id as string;
  const dep = await http(app).get('/api/depositos').set(h).expect(200);
  const depositoId = dep.body[0].id as string;
  await http(app).post('/api/stock/ajustes').set(h).send({ depositoId, motivo: 'Stock inicial', tipo: 'inicial', items: [{ varianteId, cantidadNueva: stockInicial }] }).expect(201);
  const caja = await http(app).post('/api/cajas').set(h).send({ nombre: `Caja ${unico()}`, sucursalId: e.sucursalId, depositoId }).expect(201);
  await http(app).post(`/api/cajas/${caja.body.id}/abrir`).set(h).send({ fondos: [{ moneda: 'PYG', monto: 100000 }] }).expect(201);
  const v = await http(app)
    .post('/api/ventas')
    .set(h)
    .send({ claveIdempotencia: unico('clave-'), cajaId: caja.body.id, items: [{ varianteId, cantidad: 1 }], pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: 11000 }] })
    .expect(201);
  return { productoId: p.body.id as string, varianteId, codigo, depositoId, cajaId: caja.body.id as string, ventaId: v.body.id as string };
}
