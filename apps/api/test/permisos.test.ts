import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service';
import { filtrarCampos } from '../src/comun/confidencial';
import { CONTRASENA, crearEmpresa, crearUsuario, http, iniciarApp, login, rucValido, unico, type EmpresaPrueba } from './ayudas';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Permisos y reglas de Fase 0', () => {
  let app: INestApplication;
  let e: EmpresaPrueba;
  let perfiles: Record<string, string>;

  beforeAll(async () => {
    app = await iniciarApp();
    e = await crearEmpresa(app, 'ENTERPRISE');
    const r = await http(app).get('/api/perfiles').set(auth(e.propietario.token)).expect(200);
    perfiles = Object.fromEntries(r.body.map((p: { clave: string; id: string }) => [p.clave, p.id]));
  });
  afterAll(() => app.close());

  describe('perfiles de plantilla', () => {
    it('el cajero no puede gestionar usuarios', async () => {
      const c = await crearUsuario(app, e, 'cajero');
      await http(app).get('/api/usuarios').set(auth(c.token)).expect(403);
      const me = await http(app).get('/api/me').set(auth(c.token)).expect(200);
      expect(me.body.permisos['venta.crear']).toBe('propia');
      expect(me.body.permisos['usuario.ver']).toBeUndefined();
    });

    it('el vendedor ve productos pero no costos', async () => {
      const v = await crearUsuario(app, e, 'vendedor');
      const me = await http(app).get('/api/me').set(auth(v.token)).expect(200);
      expect(me.body.permisos['producto.ver']).toBeDefined();
      expect(me.body.permisos['costo_producto.ver']).toBeUndefined();
    });

    it('el perfil Propietario no se puede editar ni asignar', async () => {
      await http(app).patch(`/api/perfiles/${perfiles.propietario}`).set(auth(e.propietario.token)).send({ nombre: 'Otro' }).expect(403);
      const r = await http(app)
        .post('/api/usuarios')
        .set(auth(e.propietario.token))
        .send({ email: `${unico()}@prueba.com.py`, nombre: 'Segundo dueño', perfilId: perfiles.propietario, sucursalIds: [e.sucursalId] })
        .expect(403);
      expect(r.body.mensaje).toMatch(/Propietario/);
    });

    it('los perfiles del sistema no se eliminan; los propios sin usuarios sí', async () => {
      await http(app).delete(`/api/perfiles/${perfiles.cajero}`).set(auth(e.propietario.token)).expect(403);
      const p = await http(app).post('/api/perfiles').set(auth(e.propietario.token)).send({ nombre: 'Temporal', alcance: 'propia', permisos: ['producto.ver'] }).expect(201);
      await http(app).delete(`/api/perfiles/${p.body.id}`).set(auth(e.propietario.token)).expect(204);
    });

    it('rechaza permisos que no existen en el catálogo', async () => {
      const r = await http(app).post('/api/perfiles').set(auth(e.propietario.token)).send({ nombre: 'Raro', alcance: 'propia', permisos: ['nave.volar'] }).expect(400);
      expect(r.body.codigo).toBe('DATOS_INVALIDOS');
    });
  });

  describe('sin escalada de permisos', () => {
    let gerente: Awaited<ReturnType<typeof crearUsuario>>;
    beforeAll(async () => {
      // El gerente tiene usuario.ver pero no usuario.crear: se lo concedemos individualmente.
      gerente = await crearUsuario(app, e, 'gerente');
      await http(app)
        .put(`/api/usuarios/${gerente.id}/permisos`)
        .set(auth(e.propietario.token))
        .send({ permisos: [{ permiso: 'usuario.crear', tipo: 'conceder', alcance: 'sucursal' }, { permiso: 'usuario.editar', tipo: 'conceder', alcance: 'sucursal' }, { permiso: 'perfil.crear', tipo: 'conceder', alcance: 'sucursal' }] })
        .expect(200);
    });

    it('un gerente no puede crear un Administrador', async () => {
      const r = await http(app)
        .post('/api/usuarios')
        .set(auth(gerente.token))
        .send({ email: `${unico()}@prueba.com.py`, nombre: 'Admin trucho', perfilId: perfiles.administrador, sucursalIds: [e.sucursalId] })
        .expect(403);
      expect(r.body.codigo).toBe('ESCALADA_DE_PERMISOS');
    });

    it('un gerente sí puede crear un Cajero en su sucursal', async () => {
      await http(app)
        .post('/api/usuarios')
        .set(auth(gerente.token))
        .send({ email: `${unico()}@prueba.com.py`, nombre: 'Cajero nuevo', perfilId: perfiles.cajero, sucursalIds: [e.sucursalId] })
        .expect(201);
    });

    it('un gerente no puede crear un perfil con permisos que no tiene', async () => {
      const r = await http(app)
        .post('/api/perfiles')
        .set(auth(gerente.token))
        .send({ nombre: 'Con salarios', alcance: 'propia', permisos: ['salario.ver'] })
        .expect(403);
      expect(r.body.detalle).toEqual(['salario.ver']);
    });

    it('un gerente no puede conceder alcance empresa si él tiene alcance sucursal', async () => {
      const r = await http(app)
        .post('/api/perfiles')
        .set(auth(gerente.token))
        .send({ nombre: 'Ventas global', alcance: 'empresa', permisos: ['venta.ver'] })
        .expect(403);
      expect(r.body.codigo).toBe('ESCALADA_DE_PERMISOS');
    });

    it('nadie modifica sus propios permisos ni su perfil', async () => {
      await http(app).put(`/api/usuarios/${gerente.id}/permisos`).set(auth(gerente.token)).send({ permisos: [] }).expect(403);
      await http(app).patch(`/api/usuarios/${gerente.id}`).set(auth(gerente.token)).send({ perfilId: perfiles.cajero }).expect(403);
    });

    it('un administrador no puede tocar al Propietario', async () => {
      const admin = await crearUsuario(app, e, 'administrador');
      await http(app).patch(`/api/usuarios/${e.propietario.usuarioId}`).set(auth(admin.token)).send({ nombre: 'Cambiado' }).expect(403);
      await http(app).delete(`/api/usuarios/${e.propietario.usuarioId}`).set(auth(admin.token)).expect(403);
      await http(app).put(`/api/usuarios/${e.propietario.usuarioId}/permisos`).set(auth(admin.token)).send({ permisos: [] }).expect(403);
    });
  });

  describe('restricciones individuales', () => {
    it('una denegación quita el permiso aunque el perfil lo dé, con efecto inmediato', async () => {
      const s = await crearUsuario(app, e, 'supervisor');
      await http(app).get('/api/sucursales').set(auth(s.token)).expect(200);
      await http(app)
        .put(`/api/usuarios/${s.id}/permisos`)
        .set(auth(e.propietario.token))
        .send({ permisos: [{ permiso: 'sucursal.ver', tipo: 'denegar' }] })
        .expect(200);
      await http(app).get('/api/sucursales').set(auth(s.token)).expect(403);
    });
  });

  describe('alcance por sucursal', () => {
    it('quien tiene alcance sucursal solo ve sus sucursales y los usuarios de ellas', async () => {
      const otra = await http(app).post('/api/sucursales').set(auth(e.propietario.token)).send({ nombre: 'Sucursal Ciudad del Este', codigo: '002' }).expect(201);
      const enOtra = await crearUsuario(app, e, 'cajero', [otra.body.id]);
      const g = await crearUsuario(app, e, 'gerente', [e.sucursalId]);

      const suc = await http(app).get('/api/sucursales').set(auth(g.token)).expect(200);
      expect(suc.body.map((s: { id: string }) => s.id)).toEqual([e.sucursalId]);
      await http(app).get(`/api/sucursales/${otra.body.id}`).set(auth(g.token)).expect(404);

      const us = await http(app).get('/api/usuarios').set(auth(g.token)).expect(200);
      expect(us.body.map((u: { id: string }) => u.id)).not.toContain(enOtra.id);
      await http(app).get(`/api/usuarios/${enOtra.id}`).set(auth(g.token)).expect(404);
    });
  });

  describe('límites del plan (se aplican en el backend)', () => {
    it('START permite 3 usuarios activos y 1 sucursal', async () => {
      const s = await crearEmpresa(app, 'START');
      const r = await http(app).get('/api/perfiles').set(auth(s.propietario.token)).expect(200);
      const cajero = r.body.find((p: { clave: string }) => p.clave === 'cajero').id;
      const alta = (n: number) =>
        http(app).post('/api/usuarios').set(auth(s.propietario.token)).send({ email: `${unico('lim' + n)}@prueba.com.py`, nombre: `Cajero ${n}`, perfilId: cajero, sucursalIds: [s.sucursalId] });

      await alta(2).expect(201);
      const tercero = await alta(3).expect(201);
      const cuarto = await alta(4).expect(409);
      expect(cuarto.body.codigo).toBe('LIMITE_PLAN');

      // Desactivar libera el cupo.
      await http(app).delete(`/api/usuarios/${tercero.body.id}`).set(auth(s.propietario.token)).expect(204);
      await alta(5).expect(201);

      const suc = await http(app).post('/api/sucursales').set(auth(s.propietario.token)).send({ nombre: 'Segunda', codigo: '002' }).expect(409);
      expect(suc.body.codigo).toBe('LIMITE_PLAN');

      const emp = await http(app).get('/api/empresa').set(auth(s.propietario.token)).expect(200);
      expect(emp.body.plan).toMatchObject({ codigo: 'START', limites: { usuarios: 3, sucursales: 1 }, uso: { usuarios: 3, sucursales: 1 } });
    });

    it('no permite desactivar la última sucursal', async () => {
      const s = await crearEmpresa(app, 'START');
      const r = await http(app).delete(`/api/sucursales/${s.sucursalId}`).set(auth(s.propietario.token)).expect(409);
      expect(r.body.codigo).toBe('ULTIMA_SUCURSAL');
    });
  });

  describe('autorización con PIN de supervisor', () => {
    it('el supervisor autoriza sin cerrar la sesión del cajero; queda auditado', async () => {
      const sup = await crearUsuario(app, e, 'supervisor');
      const caj = await crearUsuario(app, e, 'cajero');
      await http(app).put('/api/auth/pin').set(auth(sup.token)).send({ pin: '4821', contrasena: CONTRASENA }).expect(204);

      const ok = await http(app)
        .post('/api/autorizaciones')
        .set(auth(caj.token))
        .send({ usuarioId: sup.id, pin: '4821', permiso: 'venta.cancelar', motivo: 'Cliente desistió' })
        .expect(200);
      expect(ok.body.autorizadoPor).toEqual({ id: sup.id, nombre: 'Usuario supervisor' });

      // El token solo vale para ese cajero, ese permiso y esa empresa.
      const servicio = app.get(AuthService);
      const ctxCajero = { empresaId: e.empresaId, usuarioId: caj.id } as Parameters<AuthService['verificarAutorizacion']>[0];
      expect(await servicio.verificarAutorizacion(ctxCajero, ok.body.autorizacion, 'venta.cancelar')).toBe(sup.id);
      expect(await servicio.verificarAutorizacion(ctxCajero, ok.body.autorizacion, 'descuento.aprobar')).toBeNull();
      expect(await servicio.verificarAutorizacion({ ...ctxCajero, usuarioId: sup.id }, ok.body.autorizacion, 'venta.cancelar')).toBeNull();

      const aud = await http(app).get('/api/auditoria?accion=autorizacion_concedida').set(auth(e.propietario.token)).expect(200);
      expect(aud.body.items[0]).toMatchObject({ usuario: { id: caj.id }, autorizadoPor: { id: sup.id }, entidadId: 'venta.cancelar' });
    });

    it('rechaza PIN incorrecto, bloquea tras 3 intentos y rechaza si el supervisor no tiene el permiso', async () => {
      const sup = await crearUsuario(app, e, 'supervisor');
      const caj = await crearUsuario(app, e, 'cajero');
      await http(app).put('/api/auth/pin').set(auth(sup.token)).send({ pin: '1357', contrasena: CONTRASENA }).expect(204);
      await http(app).post('/api/autorizaciones').set(auth(caj.token)).send({ usuarioId: sup.id, pin: '1357', permiso: 'salario.ver' }).expect(403);
      for (let i = 0; i < 3; i++) {
        await http(app).post('/api/autorizaciones').set(auth(caj.token)).send({ usuarioId: sup.id, pin: '0000', permiso: 'venta.cancelar' }).expect(403);
      }
      const r = await http(app).post('/api/autorizaciones').set(auth(caj.token)).send({ usuarioId: sup.id, pin: '1357', permiso: 'venta.cancelar' }).expect(429);
      expect(r.body.codigo).toBe('PIN_BLOQUEADO');
    });

    it('definir el PIN exige la contraseña', async () => {
      const sup = await crearUsuario(app, e, 'supervisor');
      await http(app).put('/api/auth/pin').set(auth(sup.token)).send({ pin: '1234', contrasena: 'equivocada' }).expect(400);
      await http(app).put('/api/auth/pin').set(auth(sup.token)).send({ pin: '12', contrasena: CONTRASENA }).expect(400);
    });
  });

  describe('auditoría', () => {
    it('registra quién cambió qué, con valores antes y después, sin secretos', async () => {
      const s = await http(app).post('/api/sucursales').set(auth(e.propietario.token)).send({ nombre: 'Encarnación', codigo: '003' }).expect(201);
      await http(app).patch(`/api/sucursales/${s.body.id}`).set(auth(e.propietario.token)).send({ nombre: 'Encarnación Centro' }).expect(200);
      const r = await http(app).get(`/api/auditoria?entidad=sucursal&accion=editar`).set(auth(e.propietario.token)).expect(200);
      const ev = r.body.items.find((x: { entidadId: string }) => x.entidadId === s.body.id);
      expect(ev.usuario.id).toBe(e.propietario.usuarioId);
      expect(ev.antes.nombre).toBe('Encarnación');
      expect(ev.despues.nombre).toBe('Encarnación Centro');
      expect(ev.ip).toBeTruthy();

      const pins = await http(app).get('/api/auditoria?accion=definir_pin').set(auth(e.propietario.token)).expect(200);
      expect(JSON.stringify(pins.body)).not.toMatch(/argon2/);
    });

    it('pagina por cursor sin repetir registros', async () => {
      const p1 = await http(app).get('/api/auditoria?limite=5').set(auth(e.propietario.token)).expect(200);
      expect(p1.body.items).toHaveLength(5);
      const p2 = await http(app).get(`/api/auditoria?limite=5&cursor=${p1.body.siguiente}`).set(auth(e.propietario.token)).expect(200);
      const ids1 = p1.body.items.map((x: { id: number }) => x.id);
      const ids2 = p2.body.items.map((x: { id: number }) => x.id);
      expect(ids1.filter((x: number) => ids2.includes(x))).toEqual([]);
      expect(Math.min(...ids1)).toBeGreaterThan(Math.max(...ids2));
    });

    it('un usuario con alcance propia solo ve sus propias acciones', async () => {
      const c = await crearUsuario(app, e, 'cajero');
      await http(app)
        .put(`/api/usuarios/${c.id}/permisos`)
        .set(auth(e.propietario.token))
        .send({ permisos: [{ permiso: 'auditoria.ver', tipo: 'conceder', alcance: 'propia' }] })
        .expect(200);
      const s = await login(app, c.email);
      const r = await http(app).get('/api/auditoria').set(auth(s.token)).expect(200);
      expect(r.body.items.length).toBeGreaterThan(0);
      expect(r.body.items.every((x: { usuario: { id: string } | null }) => x.usuario?.id === c.id)).toBe(true);
    });
  });

  describe('empresa', () => {
    it('valida el RUC al editar', async () => {
      await http(app).patch('/api/empresa').set(auth(e.propietario.token)).send({ ruc: '1234567-8' }).expect(400);
      const ruc = rucValido();
      const r = await http(app).patch('/api/empresa').set(auth(e.propietario.token)).send({ ruc, nombreFantasia: 'Súper Prueba' }).expect(200);
      expect(r.body).toMatchObject({ ruc, nombreFantasia: 'Súper Prueba' });
    });
  });

  describe('campos confidenciales', () => {
    it('filtrarCampos quita lo que el usuario no puede ver', () => {
      const ctx = { permisos: new Map([['producto.ver', 'empresa' as const]]) };
      const p = { nombre: 'Arroz 1 kg', precio: '9500', costo: '7200' };
      expect(filtrarCampos(p, ctx, { costo: 'costo_producto.ver' })).toEqual({ nombre: 'Arroz 1 kg', precio: '9500' });
      const ctx2 = { permisos: new Map([['costo_producto.ver', 'empresa' as const]]) };
      expect(filtrarCampos(p, ctx2, { costo: 'costo_producto.ver' })).toEqual(p);
    });
  });
});
