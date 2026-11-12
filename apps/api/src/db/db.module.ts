import { Global, Module } from '@nestjs/common';
import { config } from '../config';
import { Db } from './database';

@Global()
@Module({ providers: [{ provide: Db, useFactory: () => new Db(config().DATABASE_URL) }], exports: [Db] })
export class DbModule {}
