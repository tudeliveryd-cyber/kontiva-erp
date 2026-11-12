import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashear } from '../src/auth/cripto';
import { codigoActual } from '../src/auth/segundo-factor';
import { crearApp } from '../src/bootstrap';
import { crearKysely } from '../src/db/database';
import { MasterModule } from '../src/master/master.module';
import { hoyAsuncion, sumarDias, Suscripciones } from '../src/master/suscripciones';
import { CONTRASENA, crearEmpresa, http, iniciarApp, login, tokenDeCorreo, unico } from './ayudas';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Panel Master', () => {
  let app: INestApplication; // API de empresas
  let master: INestApplication; // Panel Master (otro módulo, otro rol, otro secreto)
  const k = () => crearKysely(process.env.DATABASE_MASTER_URL!, 1);
  let token: string;
  const emailMaster = `${unico('master')}@araujotech.com.py`;
  const claveMaster = 'clave-master-muy-segura-1';

  async function secretoMaster(campo: 'totp_secreto' | 'totp_pendiente') {
    const db = k();
    try {
      await db.updateTable('master.usuario').set({ totp_ultimo_paso: null }).where('email', '=', emailMaster).execute();
      return (await db.selectFrom('master.usuario').select([campo]).where('email', '=', emailMaster).executeTakeFirstOrThrow())[campo]!;
    } finally {
      await db.destroy();
    }
  }

  beforeAll(async () => {
    app = await iniciarApp();
    master = await crearApp({ modulo: MasterModule, prefijo: 'api/master', origen: 'http://localhost:5173', pagina: 'master.html' });
    await master.init();
    const db = k();
    await db.insertInto('master.usuario').values({ email: emailMaster, nombre: 'Jean Carlos', hash_contrasena: await hashear(claveMaster), totp_secreto: null, totp_pendiente: null, bloqueada_hasta: null }).execute();
    await db.destroy();
  });
  afterAll(async () => {
    await master.close();
    await app.close();
  });

  describe('roles de base de datos', () => {
    it('el rol de la API de empresas no puede leer el esquema master', async () => {
      const db = crearKysely(process.env.DATABASE_URL!, 1);
      try {
        await expect(sql`SELECT count(*) FROM master.usuario`.execute(db)).rejects.toThrow(/permission denied/);
        await expect(sql`SELECT * FROM master.resumen_empresas()`.execute(db)).rejects.toThrow(/permission denied/);
      } finally {
        await db.destroy();
      }
    });

    it('el rol master tampoco salta RLS sobre las tablas de negocio', async () => {
      await crearEmpresa(app);
      const db = k();
      try {
        const { rows } = await sql<{ rolbypassrls: boolean }>`SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`.execute(db);
        expect(rows[0]!.rolbypassrls).toBe(false);
        expect(await db.selectFrom('usuario').select('id').execute()).toHaveLength(0);
        // Solo ve conteos agregados a través de la función de resumen.
        const r = await sql<{ usuarios_activos: string }>`SELECT usuarios_activos FROM master.resumen_empresas()`.execute(db);
        expect(r.rows.length).toBeGreaterThan(0);
      } finally {
        await db.destroy();
      }
    });
  });

  describe('acceso', () => {
    it('la contraseña sola nunca abre sesión: obliga a configurar el segundo factor', async () => {
      const r = await http(master).post('/api/master/auth/login').send({ email: emailMaster, contrasena: claveMaster }).expect(200);
      expect(r.body.tipo).toBe('configurar_segundo_factor');
      expect(r.body.accessToken).toBeUndefined();
      await http(master).post('/api/master/auth/2fa/enrolar').send({ ticket: r.body.ticket }).expect(200);
      const fin = await http(master)
        .post('/api/master/auth/2fa/enrolar/confirmar')
        .send({ ticket: r.body.ticket, codigo: codigoActual(await secretoMaster('totp_pendiente')) })
        .expect(200);
      token = fin.body.accessToken;
      const me = await http(master).get('/api/master/auth/me').set(auth(token)).expect(200);
      expect(me.body.nombre).toBe('Jean Carlos');
    });

    it('después pide el código en cada ingreso', async () => {
      const r = await http(master).post('/api/master/auth/login').send({ email: emailMaster, contrasena: claveMaster }).expect(200);
      expect(r.body.tipo).toBe('segundo_factor');
      await http(master).post('/api/master/auth/2fa/verificar').send({ ticket: r.body.ticket, codigo: '000000' }).expect(401);
      await http(master).post('/api/master/auth/2fa/verificar').send({ ticket: r.body.ticket, codigo: codigoActual(await secretoMaster('totp_secreto')) }).expect(200);
    });

    it('los tokens de un servicio no sirven en el otro', async () => {
      const e = await crearEmpresa(app);
      await http(master).get('/api/master/empresas').set(auth(e.propietario.token)).expect(401);
      await http(app).get('/api/me').set(auth(token)).expect(401);
    });

    it('todo endpoint no público exige sesión', async () => {
      for (const ruta of ['/api/master/empresas', '/api/master/planes', '/api/master/auditoria', '/api/master/auth/me']) {
        await http(master).get(ruta).expect(401);
      }
      await http(master).post('/api/master/empresas').send({}).expect(401);
    });
  });

  describe('empresas', () => {
    let empresaId: string;
    const emailDueno = `${unico('cliente')}@prueba.com.py`;

    it('da de alta una empresa con su Propietario y suscripción', async () => {
      const r = await http(master)
        .post('/api/master/empresas')
        .set(auth(token))
        .send({
          razonSocial: 'Supermercado Frontera S.A.',
          nombreFantasia: 'Súper Frontera',
          rubro: 'supermercado',
          planCodigo: 'START',
          propietario: { email: emailDueno, nombre: 'Rosa Benítez' },
          suscripcion: { ciclo: 'mensual', precio: 250000, moneda: 'PYG', venceEn: sumarDias(hoyAsuncion(), 30), diasGracia: 5 },
        })
        .expect(201);
      empresaId = r.body.empresaId;
      expect(r.body.enlaceInvitacion).toMatch(/restablecer\?token=/);

      const lista = await http(master).get('/api/master/empresas?q=frontera').set(auth(token)).expect(200);
      expect(lista.body).toHaveLength(1);
      expect(lista.body[0]).toMatchObject({ nombre: 'Súper Frontera', plan: 'START', estado: 'activa', usuariosActivos: 1, sucursalesActivas: 1 });
      expect(lista.body[0].suscripcion).toMatchObject({ estado: 'al_dia', precio: '250000.00' });
      expect(lista.body[0].propietario).toMatchObject({ email: emailDueno, pendiente: true });

      // El Propietario activa su cuenta en la aplicación de empresas.
      await http(app).post('/api/auth/restablecer').send({ token: tokenDeCorreo(master, emailDueno), contrasena: CONTRASENA }).expect(204);
      await login(app, emailDueno);
    });

    it('cambia el plan y la empresa lo ve en su auditoría', async () => {
      const r = await http(master).patch(`/api/master/empresas/${empresaId}/plan`).set(auth(token)).send({ planCodigo: 'BUSINESS' }).expect(200);
      expect(r.body.plan).toBe('BUSINESS');
      const s = await login(app, emailDueno);
      const emp = await http(app).get('/api/empresa').set(auth(s.token)).expect(200);
      expect(emp.body.plan.codigo).toBe('BUSINESS');
      const aud = await http(app).get('/api/auditoria?accion=cambio_plan').set(auth(s.token)).expect(200);
      expect(aud.body.items[0].despues).toMatchObject({ plan: 'BUSINESS', por: 'Araújo Tech Sistemas' });
    });

    it('vencida la gracia la suspende; el pago la reactiva', async () => {
      const s = await login(app, emailDueno);
      await http(master)
        .put(`/api/master/empresas/${empresaId}/suscripcion`)
        .set(auth(token))
        .send({ ciclo: 'mensual', precio: 250000, moneda: 'PYG', venceEn: sumarDias(hoyAsuncion(), -10), diasGracia: 5 })
        .expect(200);
      const v = await http(master).get(`/api/master/empresas/${empresaId}`).set(auth(token)).expect(200);
      expect(v.body).toMatchObject({ estado: 'suspendida', suscripcion: { estado: 'vencida', motivoSuspension: 'falta_pago' } });
      await http(app).get('/api/me').set(auth(s.token)).expect(403);

      const p = await http(master)
        .post(`/api/master/empresas/${empresaId}/pagos`)
        .set(auth(token))
        .send({ monto: 250000, moneda: 'PYG', fecha: hoyAsuncion(), metodo: 'transferencia', referencia: 'Itaú 4471' })
        .expect(201);
      expect(p.body.estado).toBe('activa');
      expect(p.body.suscripcion.estado).toBe('al_dia');
      expect(p.body.suscripcion.venceEn > hoyAsuncion()).toBe(true);
      expect(p.body.pagos[0]).toMatchObject({ monto: '250000.00', periodoDesde: hoyAsuncion(), metodo: 'transferencia', registradoPor: 'Jean Carlos' });
      await http(app).get('/api/me').set(auth(s.token)).expect(200);
    });

    it('en el período de gracia la empresa sigue operando', async () => {
      await http(master)
        .put(`/api/master/empresas/${empresaId}/suscripcion`)
        .set(auth(token))
        .send({ ciclo: 'mensual', precio: 250000, moneda: 'PYG', venceEn: sumarDias(hoyAsuncion(), -2), diasGracia: 5 })
        .expect(200)
        .expect((r) => expect(r.body).toMatchObject({ estado: 'activa', suscripcion: { estado: 'en_gracia' } }));
    });

    it('una suspensión manual no se levanta con un pago ni con el proceso automático', async () => {
      await http(master).post(`/api/master/empresas/${empresaId}/suspender`).set(auth(token)).expect(200);
      await http(master)
        .post(`/api/master/empresas/${empresaId}/pagos`)
        .set(auth(token))
        .send({ monto: 250000, moneda: 'PYG', fecha: hoyAsuncion(), metodo: 'efectivo' })
        .expect(201)
        .expect((r) => expect(r.body.estado).toBe('suspendida'));
      await master.get(Suscripciones).procesar();
      const r = await http(master).post(`/api/master/empresas/${empresaId}/reactivar`).set(auth(token)).expect(200);
      expect(r.body.estado).toBe('activa');
    });

    it('un pago se anula, no se borra', async () => {
      const v = await http(master).get(`/api/master/empresas/${empresaId}`).set(auth(token)).expect(200);
      const pago = v.body.pagos[0];
      const r = await http(master).post(`/api/master/empresas/${empresaId}/pagos/${pago.id}/anular`).set(auth(token)).send({ motivo: 'Transferencia rechazada' }).expect(200);
      expect(r.body.pagos.find((p: { id: string }) => p.id === pago.id)).toMatchObject({ anulado: true, motivoAnulacion: 'Transferencia rechazada' });
    });

    it('los cambios de límites del plan rigen de inmediato en la empresa', async () => {
      const planes = await http(master).get('/api/master/planes').set(auth(token)).expect(200);
      const start = planes.body.find((p: { codigo: string }) => p.codigo === 'START');
      await http(master).patch(`/api/master/planes/${start.id}`).set(auth(token)).send({ maxUsuarios: 4, precioMensual: 180000 }).expect(200);
      const despues = await http(master).get('/api/master/planes').set(auth(token)).expect(200);
      expect(despues.body.find((p: { codigo: string }) => p.codigo === 'START')).toMatchObject({ maxUsuarios: 4, precioMensual: '180000.00' });
      await http(master).patch(`/api/master/planes/${start.id}`).set(auth(token)).send({ maxUsuarios: 3 }).expect(200);
    });

    it('todo queda en la auditoría master', async () => {
      const r = await http(master).get('/api/master/auditoria').set(auth(token)).expect(200);
      const acciones = r.body.items.map((x: { accion: string }) => x.accion);
      for (const a of ['alta_empresa', 'cambio_plan', 'registrar_pago', 'suspender', 'reactivar', 'anular_pago', 'editar_plan']) expect(acciones).toContain(a);
    });
  });
});
