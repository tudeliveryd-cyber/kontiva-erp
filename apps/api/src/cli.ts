import 'reflect-metadata';
import './env';
import { NestFactory } from '@nestjs/core';
import { parseArgs } from 'node:util';
import { AppModule } from './app.module';
import { config } from './config';
import { migrar, revertirUltima } from './db/migrador';
import { ProvisionService } from './provision/provision.service';
import { AuthService } from './auth/auth.service';
import { randomBytes } from 'node:crypto';
import { hashear } from './auth/cripto';
import { crearKysely } from './db/database';
import { auditarMaster } from './master/master-auditoria';
import { MasterModule } from './master/master.module';
import { Suscripciones } from './master/suscripciones';

const AYUDA = `KONTIVA ERP · herramientas de línea de comandos

  migrar                         Aplica las migraciones pendientes (usa DATABASE_OWNER_URL)
  revertir                       Revierte la última migración (solo desarrollo)
  empresa:crear [opciones]       Da de alta una empresa con su Propietario
      --razon "Razón social"       (obligatorio)
      --fantasia "Nombre"
      --ruc 80012345-6
      --rubro supermercado
      --plan START|BUSINESS|ENTERPRISE   (obligatorio)
      --email propietario@correo      (obligatorio)
      --nombre "Nombre del propietario" (obligatorio)
      --contrasena "..."            (solo pruebas: define la contraseña sin invitación)
  master:crear --email x --nombre "Nombre"   Crea un usuario del Panel Master (imprime una contraseña temporal)
  master:reiniciar-2fa --email x             Quita el segundo factor de un usuario master (lo vuelve a configurar al entrar)
  suscripciones:procesar                     Suspende / reactiva empresas según sus vencimientos
`;

async function main() {
  const [comando, ...resto] = process.argv.slice(2);
  const urlMaster = () => {
    const u = config().DATABASE_MASTER_URL;
    if (!u) throw new Error('Falta DATABASE_MASTER_URL');
    return u;
  };
  const urlDueno = () => {
    const u = config().DATABASE_OWNER_URL;
    if (!u) throw new Error('Falta DATABASE_OWNER_URL');
    return u;
  };

  switch (comando) {
    case 'migrar':
      await migrar(urlDueno());
      return;
    case 'revertir':
      if (config().NODE_ENV === 'production') throw new Error('No se revierte en producción');
      await revertirUltima(urlDueno());
      return;
    case 'empresa:crear': {
      const { values: v } = parseArgs({
        args: resto,
        options: {
          razon: { type: 'string' },
          fantasia: { type: 'string' },
          ruc: { type: 'string' },
          rubro: { type: 'string' },
          plan: { type: 'string' },
          email: { type: 'string' },
          nombre: { type: 'string' },
          // Solo fuera de producción (entornos de prueba): define la contraseña sin enlace de invitación.
          contrasena: { type: 'string' },
        },
      });
      if (!v.razon || !v.plan || !v.email || !v.nombre) throw new Error('Faltan opciones obligatorias.\n\n' + AYUDA);
      if (v.contrasena && config().NODE_ENV === 'production') throw new Error('--contrasena no está permitido en producción');
      const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
      try {
        const r = await app.get(ProvisionService).crearEmpresa({
          razonSocial: v.razon,
          nombreFantasia: v.fantasia ?? null,
          ruc: v.ruc ?? null,
          rubro: v.rubro,
          planCodigo: v.plan.toUpperCase(),
          propietario: { email: v.email, nombre: v.nombre },
        });
        console.log(`Empresa creada: ${r.empresaId}`);
        if (v.contrasena && r.enlaceInvitacion) {
          const token = new URL(r.enlaceInvitacion).searchParams.get('token')!;
          await app.get(AuthService).restablecer(token, v.contrasena, { ip: null, agente: 'cli' });
          console.log(`Ingrese con ${v.email} y la contraseña indicada.`);
        } else console.log(r.enlaceInvitacion ? `Enlace para crear la contraseña: ${r.enlaceInvitacion}` : 'La cuenta ya existía: ingresa con su contraseña actual.');
      } finally {
        await app.close();
      }
      return;
    }
    case 'master:crear':
    case 'master:reiniciar-2fa': {
      const { values: v } = parseArgs({ args: resto, options: { email: { type: 'string' }, nombre: { type: 'string' } } });
      if (!v.email) throw new Error('Falta --email');
      const email = v.email.trim().toLowerCase();
      const db = crearKysely(urlMaster(), 1);
      try {
        if (comando === 'master:crear') {
          if (!v.nombre) throw new Error('Falta --nombre');
          const temporal = randomBytes(12).toString('base64url');
          await db.insertInto('master.usuario').values({ email, nombre: v.nombre, hash_contrasena: await hashear(temporal), totp_secreto: null, totp_pendiente: null, bloqueada_hasta: null }).execute();
          await auditarMaster(db, { usuarioId: null }, { accion: 'crear_usuario_master', entidad: 'usuario_master', entidadId: email });
          console.log(`Usuario master creado: ${email}`);
          console.log(`Contraseña temporal (cámbiela al entrar): ${temporal}`);
          console.log('Al primer ingreso deberá configurar la verificación en dos pasos.');
        } else {
          const r = await db.updateTable('master.usuario').set({ totp_activo: false, totp_secreto: null, totp_pendiente: null, totp_ultimo_paso: null }).where('email', '=', email).returning('id').executeTakeFirst();
          if (!r) throw new Error('Usuario master inexistente');
          await db.updateTable('master.sesion').set({ revocada_en: new Date() }).where('usuario_id', '=', r.id).where('revocada_en', 'is', null).execute();
          await auditarMaster(db, { usuarioId: null }, { accion: 'reiniciar_2fa', entidad: 'usuario_master', entidadId: r.id });
          console.log('Segundo factor reiniciado. Deberá configurarlo de nuevo al entrar.');
        }
      } finally {
        await db.destroy();
      }
      return;
    }
    case 'suscripciones:procesar': {
      const app = await NestFactory.createApplicationContext(MasterModule, { logger: ['error'] });
      try {
        const r = await app.get(Suscripciones).procesar();
        console.log(`Suspendidas: ${r.suspendidas.length} · reactivadas: ${r.reactivadas.length}`);
      } finally {
        await app.close();
      }
      return;
    }
    default:
      console.log(AYUDA);
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
