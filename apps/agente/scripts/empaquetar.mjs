// KONTIVA ERP · empaqueta el agente en un solo ejecutable (Node.js Single Executable Application).
// En Windows genera kontiva-agente.exe; en Linux/macOS, kontiva-agente. No requiere Node en la caja.
// Uso: pnpm --filter @kontiva/agente empaquetar
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const salida = join(raiz, 'ejecutable');
const require = createRequire(import.meta.url);
const windows = process.platform === 'win32';
const exe = join(salida, windows ? 'kontiva-agente.exe' : 'kontiva-agente');

rmSync(salida, { recursive: true, force: true });
mkdirSync(salida, { recursive: true });

// 1. Un solo archivo JavaScript con todo el agente.
const { buildSync } = require('esbuild');
buildSync({ entryPoints: [join(raiz, 'src/main.ts')], bundle: true, platform: 'node', target: 'node22', format: 'cjs', outfile: join(salida, 'agente.js'), legalComments: 'none' });

// 2. El blob de la aplicación.
writeFileSync(join(salida, 'sea-config.json'), JSON.stringify({ main: join(salida, 'agente.js'), output: join(salida, 'sea.blob'), disableExperimentalSEAWarning: true, useCodeCache: false }));
execFileSync(process.execPath, ['--experimental-sea-config', join(salida, 'sea-config.json')], { stdio: 'inherit' });

// 3. Copia del binario de Node con el blob inyectado.
copyFileSync(process.execPath, exe);
if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', exe]);
const postject = join(dirname(require.resolve('postject/package.json')), 'dist', 'cli.js');
execFileSync(process.execPath, [postject, exe, 'NODE_SEA_BLOB', join(salida, 'sea.blob'), '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : [])], { stdio: 'inherit' });
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', exe]);

for (const f of ['agente.js', 'sea.blob', 'sea-config.json']) rmSync(join(salida, f));
console.log(`Ejecutable listo: ${exe}`);
