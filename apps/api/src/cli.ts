import 'reflect-metadata';
import './env';
import { NestFactory } from '@nestjs/core';
import { parseArgs } from 'node:util';
import { AppModule } from './app.module';
import { config } from './config';
import { migrar, revertirUltima } from './db/migrador';
import { ProvisionService } from './provision/provision.service';

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
`;

async function main() {
  const [comando, ...resto] = process.argv.slice(2);
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
        },
      });
      if (!v.razon || !v.plan || !v.email || !v.nombre) throw new Error('Faltan opciones obligatorias.\n\n' + AYUDA);
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
        console.log(r.enlaceInvitacion ? `Enlace para crear la contraseña: ${r.enlaceInvitacion}` : 'La cuenta ya existía: ingresa con su contraseña actual.');
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
