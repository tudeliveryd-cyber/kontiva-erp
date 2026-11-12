import { Global, Module } from '@nestjs/common';
import { Db } from './database';

@Global()
@Module({ providers: [Db], exports: [Db] })
export class DbModule {}
