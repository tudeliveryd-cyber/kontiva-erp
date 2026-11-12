import 'reflect-metadata';
import './env';
import { Logger } from '@nestjs/common';
import { crearApp } from './bootstrap';
import { config } from './config';
import { MasterModule } from './master/master.module';

async function main() {
  const app = await crearApp({ modulo: MasterModule, prefijo: 'api/master', origen: config().MASTER_WEB_URL, pagina: 'master.html' });
  await app.listen(config().MASTER_PORT);
  new Logger('KONTIVA Master').log(`Panel Master escuchando en el puerto ${config().MASTER_PORT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
