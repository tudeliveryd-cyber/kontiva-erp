import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../src/db/database';
import { ProvisionService } from '../src/provision/provision.service';
import { CONTRASENA, crearEmpresa, crearUsuario, http, iniciarApp, login, tokenDeCorreo, unico, type EmpresaPrueba } from './ayudas';

const conCsrf = { 'X-Kontiva': '1' };

describe('Autenticación', () => {
  let app: INestApplication;
  let e: EmpresaPrueba;

  beforeAll(async () => {
    app = await iniciarApp();
    e = await crearEmpresa(app);
  });
  afterAll(() => app.close());

  describe('inicio de sesión', () => {
    it('entrega token de acceso y cookie de renovación httpOnly', async () => {
      const r = await http(app).post('/api/auth/login').send({ email: e.propietario.email, contrasena: CONTRASENA }).expect(200);
      expect(r.body).toMatchObject({ tipo: 'sesion', expiraEn: 900, empresaId: e.empresaId });
      expect(r.body.refreshToken).toBeUndefined();
      const cookie = ([] as string[]).concat(r.headers['set-cookie'] ?? []).find((c) => c.startsWith('kontiva_rt='))!;
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(cookie).toMatch(/Path=\/api\/auth/);
    });

    it('acepta el correo con mayúsculas y espacios', async () => {
      await http(app).post('/api/auth/login').send({ email: `  ${e.propietario.email.toUpperCase()} `, contrasena: CONTRASENA }).expect(200);
    });

    it('responde igual a cuenta inexistente y a contraseña incorrecta', async () => {
      const a = await http(app).post('/api/auth/login').send({ email: 'nadie@prueba.com.py', contrasena: 'x' }).expect(401);
      const b = await http(app).post('/api/auth/login').send({ email: e.propietario.email, contrasena: 'incorrecta' }).expect(401);
      expect(a.body).toEqual(b.body);
      expect(a.body.codigo).toBe('CREDENCIALES_INVALIDAS');
    });

    it('bloquea la cuenta tras 5 intentos fallidos, aun con la contraseña correcta', async () => {
      const u = await crearUsuario(app, e, 'cajero');
      for (let i = 0; i < 5; i++) {
        await http(app).post('/api/auth/login').send({ email: u.email, contrasena: 'mala-clave' }).expect(401);
      }
      const r = await http(app).post('/api/auth/login').send({ email: u.email, contrasena: CONTRASENA }).expect(429);
      expect(r.body.codigo).toBe('CUENTA_BLOQUEADA');
    });

    it('rechaza peticiones sin token o con token alterado', async () => {
      await http(app).get('/api/me').expect(401);
      await http(app).get('/api/me').set('Authorization', `Bearer ${e.propietario.token}x`).expect(401);
      await http(app).get('/api/me').set('Authorization', `Bearer ${e.propietario.token}`).expect(200);
    });

    it('/me devuelve usuario, empresa y permisos efectivos', async () => {
      const r = await http(app).get('/api/me').set('Authorization', `Bearer ${e.propietario.token}`).expect(200);
      expect(r.body.usuario.esPropietario).toBe(true);
      expect(r.body.empresa.id).toBe(e.empresaId);
      expect(r.body.permisos['usuario.crear']).toBe('empresa');
      expect(r.body.sucursales).toHaveLength(1);
    });
  });

  describe('renovación rotativa', () => {
    it('rota el token y detecta reutilización cerrando la sesión', async () => {
      const s = await login(app, e.propietario.email);
      const r1 = await http(app).post('/api/auth/renovar').set('Cookie', s.cookie).set(conCsrf).expect(200);
      const nueva = ([] as string[]).concat(r1.headers['set-cookie'] ?? []).find((c) => c.startsWith('kontiva_rt='))!.split(';')[0]!;
      expect(nueva).not.toBe(s.cookie);
      await http(app).get('/api/me').set('Authorization', `Bearer ${r1.body.accessToken}`).expect(200);

      // Reusar el token viejo: se asume robo y se cierra la sesión entera.
      await http(app).post('/api/auth/renovar').set('Cookie', s.cookie).set(conCsrf).expect(401);
      await http(app).post('/api/auth/renovar').set('Cookie', nueva).set(conCsrf).expect(401);
      await http(app).get('/api/me').set('Authorization', `Bearer ${r1.body.accessToken}`).expect(401);
    });

    it('exige el encabezado anti-CSRF', async () => {
      const s = await login(app, e.propietario.email);
      await http(app).post('/api/auth/renovar').set('Cookie', s.cookie).expect(403);
    });

    it('cerrar sesión invalida la cookie y el token de acceso', async () => {
      const s = await login(app, e.propietario.email);
      await http(app).post('/api/auth/cerrar').set('Cookie', s.cookie).set(conCsrf).expect(204);
      await http(app).post('/api/auth/renovar').set('Cookie', s.cookie).set(conCsrf).expect(401);
      await http(app).get('/api/me').set('Authorization', `Bearer ${s.token}`).expect(401);
    });
  });

  describe('sesiones activas', () => {
    it('lista las sesiones y permite cerrar otra en forma remota, con efecto inmediato', async () => {
      const otra = await login(app, e.propietario.email);
      const actual = await login(app, e.propietario.email);
      const lista = await http(app).get('/api/auth/sesiones').set('Authorization', `Bearer ${actual.token}`).expect(200);
      expect(lista.body.filter((s: { actual: boolean }) => s.actual)).toHaveLength(1);
      const me = await http(app).get('/api/me').set('Authorization', `Bearer ${otra.token}`).expect(200);
      expect(me.body.usuario.id).toBe(e.propietario.usuarioId);

      const sidOtra = lista.body.find((s: { actual: boolean }) => !s.actual).id;
      // la más reciente no-actual puede no ser "otra": cerramos todas las no actuales
      for (const s of lista.body.filter((x: { actual: boolean }) => !x.actual)) {
        await http(app).delete(`/api/auth/sesiones/${s.id}`).set('Authorization', `Bearer ${actual.token}`).expect(204);
      }
      expect(sidOtra).toBeTruthy();
      await http(app).get('/api/me').set('Authorization', `Bearer ${otra.token}`).expect(401);
      await http(app).get('/api/me').set('Authorization', `Bearer ${actual.token}`).expect(200);
      e.propietario.token = actual.token;
    });
  });

  describe('contraseñas', () => {
    it('cambiar la contraseña cierra las demás sesiones', async () => {
      const u = await crearUsuario(app, e, 'vendedor');
      const otra = await login(app, u.email);
      await http(app)
        .post('/api/auth/contrasena')
        .set('Authorization', `Bearer ${u.token}`)
        .send({ actual: CONTRASENA, nueva: 'otra-clave-segura-456' })
        .expect(204);
      await http(app).get('/api/me').set('Authorization', `Bearer ${otra.token}`).expect(401);
      await http(app).get('/api/me').set('Authorization', `Bearer ${u.token}`).expect(200);
      await http(app).post('/api/auth/login').send({ email: u.email, contrasena: 'otra-clave-segura-456' }).expect(200);
    });

    it('rechaza contraseñas cortas', async () => {
      const r = await http(app)
        .post('/api/auth/contrasena')
        .set('Authorization', `Bearer ${e.propietario.token}`)
        .send({ actual: CONTRASENA, nueva: 'corta' })
        .expect(400);
      expect(r.body.codigo).toBe('DATOS_INVALIDOS');
    });

    it('recuperación: enlace de un solo uso que cierra todas las sesiones', async () => {
      const u = await crearUsuario(app, e, 'vendedor');
      await http(app).post('/api/auth/recuperar').send({ email: u.email }).expect(204);
      const token = tokenDeCorreo(app, u.email);
      await http(app).post('/api/auth/restablecer').send({ token, contrasena: 'recuperada-789xyz' }).expect(204);
      await http(app).post('/api/auth/restablecer').send({ token, contrasena: 'recuperada-789xyz' }).expect(400);
      await http(app).get('/api/me').set('Authorization', `Bearer ${u.token}`).expect(401);
      await http(app).post('/api/auth/login').send({ email: u.email, contrasena: 'recuperada-789xyz' }).expect(200);
    });

    it('recuperación de un correo inexistente responde igual y no envía nada', async () => {
      await http(app).post('/api/auth/recuperar').send({ email: 'inexistente@prueba.com.py' }).expect(204);
      expect(() => tokenDeCorreo(app, 'inexistente@prueba.com.py')).toThrow();
    });
  });

  describe('varias empresas por cuenta', () => {
    it('pide elegir empresa y permite cambiar entre ellas', async () => {
      const otra = await crearEmpresa(app);
      // El propietario de `otra` también es usuario de `e`.
      const perfiles = await http(app).get('/api/perfiles').set('Authorization', `Bearer ${e.propietario.token}`).expect(200);
      const contador = perfiles.body.find((p: { clave: string }) => p.clave === 'contador');
      await http(app)
        .post('/api/usuarios')
        .set('Authorization', `Bearer ${e.propietario.token}`)
        .send({ email: otra.propietario.email, nombre: 'Contador externo', perfilId: contador.id, sucursalIds: [e.sucursalId] })
        .expect(201);

      const r = await http(app).post('/api/auth/login').send({ email: otra.propietario.email, contrasena: CONTRASENA }).expect(200);
      expect(r.body.tipo).toBe('elegir_empresa');
      expect(r.body.empresas.map((x: { id: string }) => x.id).sort()).toEqual([e.empresaId, otra.empresaId].sort());

      const elegida = await http(app).post('/api/auth/empresa').send({ ticket: r.body.ticket, empresaId: e.empresaId }).expect(200);
      const me = await http(app).get('/api/me').set('Authorization', `Bearer ${elegida.body.accessToken}`).expect(200);
      expect(me.body.empresa.id).toBe(e.empresaId);
      expect(me.body.usuario.perfil.nombre).toBe('Contador');

      const cambio = await http(app)
        .post('/api/auth/cambiar-empresa')
        .set('Authorization', `Bearer ${elegida.body.accessToken}`)
        .send({ empresaId: otra.empresaId })
        .expect(200);
      const me2 = await http(app).get('/api/me').set('Authorization', `Bearer ${cambio.body.accessToken}`).expect(200);
      expect(me2.body.empresa.id).toBe(otra.empresaId);
      expect(me2.body.usuario.esPropietario).toBe(true);
      // La sesión anterior queda cerrada.
      await http(app).get('/api/me').set('Authorization', `Bearer ${elegida.body.accessToken}`).expect(401);
    });

    it('no permite elegir una empresa ajena', async () => {
      const ajena = await crearEmpresa(app);
      await http(app)
        .post('/api/auth/login')
        .send({ email: e.propietario.email, contrasena: CONTRASENA, empresaId: ajena.empresaId })
        .expect(403);
    });
  });

  describe('estado de usuario y empresa', () => {
    it('desactivar un usuario corta su acceso de inmediato', async () => {
      const u = await crearUsuario(app, e, 'cajero');
      await http(app).get('/api/me').set('Authorization', `Bearer ${u.token}`).expect(200);
      await http(app).delete(`/api/usuarios/${u.id}`).set('Authorization', `Bearer ${e.propietario.token}`).expect(204);
      await http(app).get('/api/me').set('Authorization', `Bearer ${u.token}`).expect(401);
      await http(app).post('/api/auth/login').send({ email: u.email, contrasena: CONTRASENA }).expect(403);
    });

    it('una empresa suspendida no puede operar', async () => {
      const s = await crearEmpresa(app);
      const db = app.get(Db);
      await db.enEmpresa(s.empresaId, (tx) => tx.updateTable('empresa').set({ estado: 'suspendida' }).execute());
      const r = await http(app).get('/api/me').set('Authorization', `Bearer ${s.propietario.token}`).expect(403);
      expect(r.body.mensaje).toMatch(/suspendida/);
      await http(app).post('/api/auth/login').send({ email: s.propietario.email, contrasena: CONTRASENA }).expect(403);
    });
  });

  describe('alta de empresa', () => {
    it('empieza vacía: sin datos de ejemplo, con perfiles de plantilla y casa matriz', async () => {
      const email = `${unico('alta')}@prueba.com.py`;
      const r = await app.get(ProvisionService).crearEmpresa({
        razonSocial: 'Ferretería Prueba S.A.',
        ruc: '1234567-9',
        rubro: 'ferreteria',
        planCodigo: 'START',
        propietario: { email, nombre: 'Ana Benítez' },
      });
      expect(r.enlaceInvitacion).toMatch(/restablecer\?token=/);
      const datos = await app.get(Db).enEmpresa(r.empresaId, async (tx) => ({
        perfiles: await tx.selectFrom('perfil').select('clave').execute(),
        sucursales: await tx.selectFrom('sucursal').select(['codigo', 'nombre']).execute(),
        usuarios: await tx.selectFrom('usuario').select('id').execute(),
        auditoria: await tx.selectFrom('auditoria').select('accion').execute(),
      }));
      expect(datos.perfiles).toHaveLength(12);
      expect(datos.sucursales).toEqual([{ codigo: '001', nombre: 'Casa matriz' }]);
      expect(datos.usuarios).toHaveLength(1);
      expect(datos.auditoria.map((a) => a.accion)).toContain('alta_empresa');
    });

    it('rechaza un RUC con dígito verificador incorrecto', async () => {
      await expect(
        app.get(ProvisionService).crearEmpresa({
          razonSocial: 'Mal RUC S.A.',
          ruc: '1234567-1',
          planCodigo: 'START',
          propietario: { email: `${unico()}@prueba.com.py`, nombre: 'X Y' },
        }),
      ).rejects.toThrow(/RUC/);
    });
  });
});
