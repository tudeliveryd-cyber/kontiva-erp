import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codigoActual, descifrar } from '../src/auth/segundo-factor';
import { Db } from '../src/db/database';
import { CONTRASENA, crearEmpresa, crearUsuario, http, iniciarApp, type EmpresaPrueba } from './ayudas';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Lee el secreto (cifrado) guardado para calcular códigos como lo haría el teléfono. */
async function secreto(app: INestApplication, email: string, campo: 'totp_secreto' | 'totp_pendiente') {
  const c = await app.get(Db).k.selectFrom('cuenta').select([campo]).where('email', '=', email).executeTakeFirstOrThrow();
  return c[campo]!;
}

describe('Segundo factor (TOTP)', () => {
  let app: INestApplication;
  let e: EmpresaPrueba;

  beforeAll(async () => {
    app = await iniciarApp();
    e = await crearEmpresa(app);
  });
  afterAll(() => app.close());

  it('el secreto se guarda cifrado, nunca en claro', async () => {
    const u = await crearUsuario(app, e, 'gerente');
    const ini = await http(app).post('/api/auth/2fa/iniciar').set(auth(u.token)).send({ contrasena: CONTRASENA }).expect(200);
    expect(ini.body.uri).toMatch(/^otpauth:\/\/totp\//);
    expect(ini.body.qr).toMatch(/^data:image\/svg\+xml;base64,/);
    const guardado = await secreto(app, u.email, 'totp_pendiente');
    expect(guardado).not.toContain(ini.body.secreto);
    expect(descifrar(guardado)).toBe(ini.body.secreto);
  });

  describe('activado por el usuario', () => {
    let u: Awaited<ReturnType<typeof crearUsuario>>;
    let respaldo: string[];

    beforeAll(async () => {
      u = await crearUsuario(app, e, 'gerente');
      await http(app).post('/api/auth/2fa/iniciar').set(auth(u.token)).send({ contrasena: CONTRASENA }).expect(200);
      await http(app).post('/api/auth/2fa/activar').set(auth(u.token)).send({ codigo: '000000' }).expect(400);
      const pendiente = await secreto(app, u.email, 'totp_pendiente');
      const r = await http(app).post('/api/auth/2fa/activar').set(auth(u.token)).send({ codigo: codigoActual(pendiente) }).expect(200);
      respaldo = r.body.codigosRespaldo;
    });

    it('entrega 10 códigos de respaldo', async () => {
      expect(respaldo).toHaveLength(10);
      expect(respaldo[0]).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
      const est = await http(app).get('/api/auth/2fa').set(auth(u.token)).expect(200);
      expect(est.body).toEqual({ activo: true, obligatorio: false, codigosRestantes: 10 });
    });

    it('el login pide el código y no entrega sesión solo con la contraseña', async () => {
      const r = await http(app).post('/api/auth/login').send({ email: u.email, contrasena: CONTRASENA }).expect(200);
      expect(r.body.tipo).toBe('segundo_factor');
      expect(r.body.accessToken).toBeUndefined();
      expect(r.headers['set-cookie']).toBeUndefined();
      // El ticket no sirve como token de acceso ni para elegir empresa.
      await http(app).get('/api/me').set(auth(r.body.ticket)).expect(401);
      await http(app).post('/api/auth/empresa').send({ ticket: r.body.ticket, empresaId: e.empresaId }).expect(401);
    });

    it('acepta el código vigente una sola vez', async () => {
      const r = await http(app).post('/api/auth/login').send({ email: u.email, contrasena: CONTRASENA }).expect(200);
      // Un código adelantado un paso (como haría un reloj algo adelantado) es válido…
      const codigo = codigoActual(await secreto(app, u.email, 'totp_secreto'), 1);
      const ok = await http(app).post('/api/auth/2fa/verificar').send({ ticket: r.body.ticket, codigo }).expect(200);
      expect(ok.body.tipo).toBe('sesion');
      // …y no se puede volver a usar.
      const r2 = await http(app).post('/api/auth/login').send({ email: u.email, contrasena: CONTRASENA }).expect(200);
      await http(app).post('/api/auth/2fa/verificar').send({ ticket: r2.body.ticket, codigo }).expect(401);
    });

    it('acepta un código de respaldo, una sola vez', async () => {
      const r = await http(app).post('/api/auth/login').send({ email: u.email, contrasena: CONTRASENA }).expect(200);
      await http(app).post('/api/auth/2fa/verificar').send({ ticket: r.body.ticket, codigo: respaldo[0]!.toLowerCase() }).expect(200);
      const r2 = await http(app).post('/api/auth/login').send({ email: u.email, contrasena: CONTRASENA }).expect(200);
      await http(app).post('/api/auth/2fa/verificar').send({ ticket: r2.body.ticket, codigo: respaldo[0] }).expect(401);
      const est = await http(app).get('/api/auth/2fa').set(auth(u.token)).expect(200);
      expect(est.body.codigosRestantes).toBe(9);
    });

    it('desactivar exige contraseña y código', async () => {
      await http(app).post('/api/auth/2fa/desactivar').set(auth(u.token)).send({ contrasena: CONTRASENA, codigo: '123456' }).expect(400);
      await http(app).post('/api/auth/2fa/desactivar').set(auth(u.token)).send({ contrasena: CONTRASENA, codigo: respaldo[1] }).expect(204);
      const r = await http(app).post('/api/auth/login').send({ email: u.email, contrasena: CONTRASENA }).expect(200);
      expect(r.body.tipo).toBe('sesion');
    });
  });

  describe('obligatorio para el Propietario en ENTERPRISE', () => {
    it('flujo completo: configurar, recibir códigos y entrar', async () => {
      const email = `ent${Date.now()}@prueba.com.py`;
      const { ProvisionService } = await import('../src/provision/provision.service');
      await app.get(ProvisionService).crearEmpresa({ razonSocial: 'Cadena Prueba S.A.', planCodigo: 'ENTERPRISE', propietario: { email, nombre: 'Dueña' } });
      const { tokenDeCorreo } = await import('./ayudas');
      await http(app).post('/api/auth/restablecer').send({ token: tokenDeCorreo(app, email), contrasena: CONTRASENA }).expect(204);

      const r = await http(app).post('/api/auth/login').send({ email, contrasena: CONTRASENA }).expect(200);
      expect(r.body.tipo).toBe('configurar_segundo_factor');
      const q = await http(app).post('/api/auth/2fa/enrolar').send({ ticket: r.body.ticket }).expect(200);
      expect(q.body.secreto).toBeTruthy();
      const codigo = codigoActual(await secreto(app, email, 'totp_pendiente'));
      const fin = await http(app).post('/api/auth/2fa/enrolar/confirmar').send({ ticket: r.body.ticket, codigo }).expect(200);
      expect(fin.body.codigosRespaldo).toHaveLength(10);
      expect(fin.body.siguiente.tipo).toBe('sesion');

      const token = fin.body.siguiente.accessToken as string;
      const est = await http(app).get('/api/auth/2fa').set(auth(token)).expect(200);
      expect(est.body).toMatchObject({ activo: true, obligatorio: true });
      const d = await http(app).post('/api/auth/2fa/desactivar').set(auth(token)).send({ contrasena: CONTRASENA, codigo: fin.body.codigosRespaldo[0] }).expect(403);
      expect(d.body.mensaje).toMatch(/exige/);
    });
  });

  it('los códigos incorrectos cuentan para el bloqueo de la cuenta', async () => {
    const u = await crearUsuario(app, e, 'gerente');
    await http(app).post('/api/auth/2fa/iniciar').set(auth(u.token)).send({ contrasena: CONTRASENA }).expect(200);
    await http(app).post('/api/auth/2fa/activar').set(auth(u.token)).send({ codigo: codigoActual(await secreto(app, u.email, 'totp_pendiente')) }).expect(200);
    const r = await http(app).post('/api/auth/login').send({ email: u.email, contrasena: CONTRASENA }).expect(200);
    for (let i = 0; i < 5; i++) await http(app).post('/api/auth/2fa/verificar').send({ ticket: r.body.ticket, codigo: '000000' }).expect(401);
    const b = await http(app).post('/api/auth/2fa/verificar').send({ ticket: r.body.ticket, codigo: codigoActual(await secreto(app, u.email, 'totp_secreto')) }).expect(429);
    expect(b.body.codigo).toBe('CUENTA_BLOQUEADA');
  });
});
