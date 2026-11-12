import { Controller, Get } from '@nestjs/common';
import { sql } from 'kysely';
import { Publico } from './comun/decoradores';
import { Db } from './db/database';

@Controller('salud')
export class SaludController {
  constructor(private readonly db: Db) {}

  @Publico()
  @Get()
  async salud() {
    await sql`SELECT 1`.execute(this.db.k);
    return { estado: 'ok', servicio: 'kontiva-api', version: process.env.npm_package_version ?? '0.1.0' };
  }
}
