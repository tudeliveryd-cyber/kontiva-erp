import 'reflect-metadata';
import './env';
import { Logger } from '@nestjs/common';
import { crearApp } from './bootstrap';
import { config } from './config';

async function main() {
  const app = await crearApp();
  await app.listen(config().PORT);
  new Logger('KONTIVA').log(`API escuchando en el puerto ${config().PORT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
