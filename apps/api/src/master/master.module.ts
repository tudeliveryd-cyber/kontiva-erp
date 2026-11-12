import { Controller, Get, Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { sql } from 'kysely';
import { AuthService } from '../auth/auth.service';
import { Tokens } from '../auth/tokens';
import { Correo } from '../comun/correo';
import { Publico } from '../comun/decoradores';
import { FiltroErrores } from '../comun/errores';
import { config } from '../config';
import { Db } from '../db/database';
import { ProvisionService } from '../provision/provision.service';
import { MasterAuthController, MasterAuthService, MasterGuard } from './master-auth';
import { MasterAuditoriaController, MasterEmpresasController, MasterPlanesController } from './master-empresas';
import { Suscripciones } from './suscripciones';

@Controller('salud')
class SaludMaster {
  constructor(private readonly db: Db) {}

  @Publico()
  @Get()
  async salud() {
    await sql`SELECT 1`.execute(this.db.k);
    return { estado: 'ok', servicio: 'kontiva-master' };
  }
}

@Global()
@Module({
  providers: [
    {
      provide: Db,
      useFactory: () => {
        const url = config().DATABASE_MASTER_URL;
        if (!url) throw new Error('Falta DATABASE_MASTER_URL para el Panel Master');
        return new Db(url);
      },
    },
  ],
  exports: [Db],
})
class DbMasterModule {}

/**
 * Panel Master de Araújo Tech: servicio separado (otro proceso, otro puerto, otro dominio),
 * con su propio rol de base (kontiva_master), sus propios usuarios y su propio secreto JWT.
 */
@Module({
  imports: [
    DbMasterModule,
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60000, limit: 300 }], skipIf: () => config().NODE_ENV === 'test' }),
  ],
  controllers: [SaludMaster, MasterAuthController, MasterEmpresasController, MasterPlanesController, MasterAuditoriaController],
  providers: [
    { provide: Tokens, useFactory: Tokens.master },
    Correo,
    AuthService,
    ProvisionService,
    MasterAuthService,
    Suscripciones,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: MasterGuard },
    { provide: APP_FILTER, useClass: FiltroErrores },
  ],
})
export class MasterModule {}
