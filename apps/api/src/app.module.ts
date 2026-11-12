import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditoriaController } from './auditoria/auditoria.controller';
import { AuthController, CuentaController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { Tokens } from './auth/tokens';
import { Correo } from './comun/correo';
import { FiltroErrores } from './comun/errores';
import { config } from './config';
import { DbModule } from './db/db.module';
import { EmpresaController } from './empresa/empresa.controller';
import { PerfilesController } from './perfiles/perfiles.controller';
import { ProvisionService } from './provision/provision.service';
import { SaludController } from './salud.controller';
import { SucursalesController } from './sucursales/sucursales.controller';
import { UsuariosController } from './usuarios/usuarios.controller';

@Module({
  imports: [
    DbModule,
    ThrottlerModule.forRoot({
      // Límite general por IP; los endpoints de acceso tienen límites propios más bajos.
      throttlers: [{ name: 'default', ttl: 60000, limit: 300 }],
      skipIf: () => config().NODE_ENV === 'test',
    }),
  ],
  controllers: [
    SaludController,
    AuthController,
    CuentaController,
    EmpresaController,
    SucursalesController,
    PerfilesController,
    UsuariosController,
    AuditoriaController,
  ],
  providers: [
    Tokens,
    Correo,
    AuthService,
    ProvisionService,
    // Orden: primero el límite de peticiones, después la autenticación y permisos.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: FiltroErrores },
  ],
})
export class AppModule {}
