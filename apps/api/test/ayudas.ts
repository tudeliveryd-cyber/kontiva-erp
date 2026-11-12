import type { INestApplication } from '@nestjs/common';
import { calcularDvRuc } from '@kontiva/shared';
import request from 'supertest';
import { crearApp } from '../src/bootstrap';
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

export async function login(app: INestApplication, email: string, contrasena = CONTRASENA, empresaId?: string) {
  const r = await http(app).post('/api/auth/login').send({ email, contrasena, empresaId });
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
