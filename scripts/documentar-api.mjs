#!/usr/bin/env node
/**
 * Genera la documentación de la API de empresas a partir del código:
 *   docs/api/openapi.json  (OpenAPI 3.1, para Postman, Insomnia o generadores de clientes)
 *   docs/api/README.md     (guía legible por módulo, con el permiso de cada ruta)
 *
 * Lee los controladores (rutas, @Requiere / @SoloSesion / @Publico, comentarios y la validación del cuerpo)
 * y convierte a JSON Schema los esquemas zod de @kontiva/shared. La CI verifica que esté al día:
 *   node scripts/documentar-api.mjs && git diff --exit-code docs/api
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fuentes = join(raiz, 'apps/api/src');
const requerir = createRequire(join(raiz, 'packages/shared/package.json'));
const compartido = await import(join(raiz, 'packages/shared/dist/index.js'));
const { z } = await import(requerir.resolve('zod'));
const { PERMISOS } = compartido;

function archivos(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'master' ? [] : archivos(p);
    return n.endsWith('.controller.ts') ? [p] : [];
  });
}

/** Texto entre el paréntesis que abre en `i` y el que lo cierra (respeta anidamiento y cadenas). */
function balanceado(t, i) {
  let n = 0;
  let cadena = null;
  for (let j = i; j < t.length; j++) {
    const c = t[j];
    if (cadena) {
      if (c === '\\') j++;
      else if (c === cadena) cadena = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') cadena = c;
    else if (c === '(') n++;
    else if (c === ')' && --n === 0) return t.slice(i + 1, j);
  }
  return t.slice(i + 1);
}

/** Primer argumento de `validar(...)` (hasta la coma de primer nivel). */
function primerArgumento(args) {
  let n = 0;
  for (let j = 0; j < args.length; j++) {
    const c = args[j];
    if ('([{'.includes(c)) n++;
    else if (')]}'.includes(c)) n--;
    else if (c === ',' && n === 0) return [args.slice(0, j).trim(), args.slice(j + 1).trim()];
  }
  return [args.trim(), ''];
}

const limpiarDoc = (d) =>
  d
    .trim()
    .replace(/^\/\*\*|\*\/$/g, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean)
    .join(' ');

const MODULO = (archivo) => relative(fuentes, archivo).split('/')[0];
const NOMBRE_MODULO = {
  auth: 'Acceso y sesión', empresa: 'Empresa', catalogo: 'Catálogo y stock', operacion: 'Caja y ventas', compras: 'Compras',
  finanzas: 'Finanzas', contabilidad: 'Contabilidad', sifen: 'Facturación electrónica (SIFEN)', informes: 'Informes',
  rrhh: 'Personal (RRHH)', restaurante: 'Restaurante', produccion: 'Producción', distribucion: 'Distribución',
  usuarios: 'Usuarios y perfiles', perfiles: 'Usuarios y perfiles', sucursales: 'Empresa', 'salud.controller.ts': 'Estado del servicio', auditoria: 'Auditoría',
};

const rutas = [];
for (const archivo of archivos(fuentes).sort()) {
  const t = readFileSync(archivo, 'utf8');
  // Cada clase controladora con su prefijo.
  const clases = [...t.matchAll(/@Controller\((?:'([^']*)')?\)\s*\nexport class (\w+)/g)];
  for (const [k, c] of clases.entries()) {
    const prefijo = c[1] ?? '';
    const inicio = c.index;
    const fin = clases[k + 1]?.index ?? t.length;
    const cuerpo = t.slice(inicio, fin);
    // Grupos de decoradores de un método: comentario opcional + decoradores + firma.
    const re = /(\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*)?((?:\s*@(?:Requiere|SoloSesion|Publico|Get|Post|Put|Patch|Delete|HttpCode|Header|UseInterceptors|Throttle|SkipThrottle)\([^\n]*\)\s*)+)\s*(?:async\s+)?(\w+)\s*\(/g;
    const metodos = [...cuerpo.matchAll(re)];
    for (const [i, m] of metodos.entries()) {
      const deco = m[2];
      const http = deco.match(/@(Get|Post|Put|Patch|Delete)\((?:'([^']*)')?\)/);
      if (!http) continue;
      const desde = m.index + m[0].length - 1;
      const hasta = metodos[i + 1]?.index ?? cuerpo.length;
      const codigo = cuerpo.slice(desde, hasta);
      const req = deco.match(/@Requiere\('([^']+)',\s*'([^']+)'\)/);
      const acceso = req ? { tipo: 'permiso', permiso: `${req[1]}.${req[2]}` } : /@Publico\(\)/.test(deco) ? { tipo: 'publico' } : /@SoloSesion\(\)/.test(deco) ? { tipo: 'sesion' } : { tipo: 'desconocido' };
      const camino = `/api/${[prefijo, http[2] ?? ''].filter(Boolean).join('/')}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/api';
      const validaciones = [];
      for (const v of codigo.matchAll(/validar\(/g)) {
        const [esquema, objetivo] = primerArgumento(balanceado(codigo, v.index + 'validar'.length));
        const destino = /\bquery\b/.test(objetivo) ? 'query' : /\bbody\b/.test(objetivo) ? 'body' : null;
        if (destino) validaciones.push({ destino, esquema });
      }
      rutas.push({
        modulo: MODULO(archivo),
        archivo: relative(raiz, archivo),
        metodo: http[1].toUpperCase(),
        camino,
        operacion: m[3],
        doc: m[1] ? limpiarDoc(m[1]) : '',
        acceso,
        validaciones,
        codigo: (deco.match(/@HttpCode\((\d+)\)/) ?? [])[1] ?? (http[1] === 'Post' ? '201' : '200'),
        archivoBinario: /StreamableFile/.test(codigo),
      });
    }
  }
}

// Esquemas: los de @kontiva/shared se publican completos; los definidos en el controlador, como código.
const componentes = {};
const usados = new Set();
function esquemaDe(texto) {
  const nombre = texto.match(/^(\w+)(?:\.(?:extend|partial|omit|pick)\(|$)/)?.[1];
  const valor = nombre ? compartido[nombre] : undefined;
  if (valor && typeof valor === 'object' && '_zod' in valor) {
    if (!componentes[nombre]) {
      try {
        componentes[nombre] = z.toJSONSchema(valor, { io: 'input', unrepresentable: 'any' });
      } catch {
        componentes[nombre] = { description: `Ver ${nombre} en packages/shared/src/esquemas.ts` };
      }
    }
    usados.add(nombre);
    const exacto = texto === nombre;
    return { ref: nombre, exacto, schema: exacto ? { $ref: `#/components/schemas/${nombre}` } : { allOf: [{ $ref: `#/components/schemas/${nombre}` }], description: `Basado en ${nombre}: ${texto.slice(0, 300)}` } };
  }
  return { ref: null, exacto: false, schema: { type: 'object', description: `Validación en el controlador:\n${texto}` } };
}

const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'KONTIVA ERP · API de empresas',
    version: JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')).version,
    description:
      'API REST de KONTIVA ERP (multiempresa, PostgreSQL con aislamiento por fila). Autenticación: POST /api/auth/login devuelve un accessToken (JWT, 15 minutos) que va en Authorization: Bearer; la sesión se renueva con POST /api/auth/renovar (cookie httpOnly). Todas las peticiones del navegador llevan X-Kontiva: 1. Cada ruta exige un permiso (x-permiso) del perfil del usuario; el propietario los tiene todos. Errores: { codigo, mensaje, detalles? }. Importes en guaraníes como texto decimal; fechas en ISO 8601.\n\nKONTIVA ERP · Desarrollado por Araújo Tech Sistemas',
  },
  servers: [{ url: '/', description: 'Mismo origen que la aplicación' }],
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: componentes,
    responses: {
      Error: { description: 'Error de negocio o de validación', content: { 'application/json': { schema: { type: 'object', properties: { codigo: { type: 'string' }, mensaje: { type: 'string' }, detalles: {} }, required: ['codigo', 'mensaje'] } } } },
    },
  },
  tags: [],
  paths: {},
};

const etiquetas = new Set();
for (const r of rutas) {
  const camino = r.camino.replace(/:(\w+)/g, '{$1}');
  const etiqueta = NOMBRE_MODULO[r.modulo] ?? r.modulo;
  etiquetas.add(etiqueta);
  const parametros = [...r.camino.matchAll(/:(\w+)/g)].map((p) => ({ name: p[1], in: 'path', required: true, schema: { type: 'string', ...(p[1] === 'id' && { format: 'uuid' }) } }));
  const op = {
    tags: [etiqueta],
    operationId: `${r.modulo}_${r.operacion}_${r.metodo.toLowerCase()}`.replace(/[^\w]/g, '_'),
    summary: r.doc ? r.doc.split(/(?<=[.:])\s/)[0].slice(0, 120) : `${r.operacion}`,
    ...(r.doc && { description: r.doc }),
    ...(r.acceso.tipo !== 'publico' && { security: [{ bearer: [] }] }),
    ...(r.acceso.tipo === 'permiso' && { 'x-permiso': r.acceso.permiso }),
    parameters: parametros,
    responses: {
      [r.codigo]: r.archivoBinario ? { description: 'Archivo', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } } : { description: 'Correcto', content: { 'application/json': { schema: {} } } },
      400: { $ref: '#/components/responses/Error' },
      ...(r.acceso.tipo !== 'publico' && { 401: { $ref: '#/components/responses/Error' }, 403: { $ref: '#/components/responses/Error' } }),
    },
  };
  for (const v of r.validaciones) {
    const e = esquemaDe(v.esquema);
    if (v.destino === 'body') op.requestBody = { required: true, content: { 'application/json': { schema: e.schema } } };
    else op.parameters.push({ name: 'filtros', in: 'query', style: 'form', explode: true, schema: e.schema });
  }
  openapi.paths[camino] ??= {};
  openapi.paths[camino][r.metodo.toLowerCase()] = op;
}
openapi.tags = [...etiquetas].sort().map((name) => ({ name }));
for (const k of Object.keys(componentes)) if (!usados.has(k)) delete componentes[k];
openapi.components.schemas = Object.fromEntries(Object.entries(componentes).sort(([a], [b]) => a.localeCompare(b)));

// Guía legible.
const nombrePermiso = (p) => {
  const [rec, acc] = p.split('.');
  return PERMISOS?.[rec] ? `${PERMISOS[rec].nombre} · ${acc}` : p;
};
const md = [];
md.push('# KONTIVA ERP · API de empresas', '');
md.push('> Generado por `node scripts/documentar-api.mjs` a partir del código. No editar a mano.', '');
md.push(`${rutas.length} rutas · OpenAPI 3.1 en [openapi.json](./openapi.json) (se importa en Postman o Insomnia).`, '');
md.push('## Cómo se usa', '');
md.push('1. `POST /api/auth/login` con `{ "email", "contrasena" }` → `{ accessToken }` (15 minutos) y una cookie de sesión.');
md.push('   Si el usuario tiene segundo factor, la respuesta pide el código (`POST /api/auth/2fa/verificar`). Con varias empresas, se indica `empresaId`.');
md.push('2. Cada petición lleva `Authorization: Bearer <accessToken>` y `X-Kontiva: 1`.');
md.push('3. Al vencer el token (401), `POST /api/auth/renovar` con la cookie devuelve uno nuevo.');
md.push('4. Errores: HTTP 4xx con `{ "codigo": "STOCK_INSUFICIENTE", "mensaje": "...", "detalles": ... }`.');
md.push('5. Importes en guaraníes como texto decimal (`"11000.00"`); cantidades con 4 decimales; fechas ISO 8601.');
md.push('6. Las ventas llevan `claveIdempotencia`: reenviar la misma venta no la duplica (caja sin conexión).', '');
md.push('Acceso: **permiso** = el perfil del usuario debe tenerlo (el propietario tiene todos) · **sesión** = cualquier usuario con sesión · **público** = sin sesión.', '');
const porModulo = new Map();
for (const r of rutas) {
  const m = NOMBRE_MODULO[r.modulo] ?? r.modulo;
  porModulo.set(m, [...(porModulo.get(m) ?? []), r]);
}
md.push('## Módulos', '');
for (const m of [...porModulo.keys()].sort()) md.push(`- [${m}](#${m.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-')}) (${porModulo.get(m).length})`);
md.push('');
for (const m of [...porModulo.keys()].sort()) {
  md.push(`## ${m}`, '');
  md.push('| Método | Ruta | Acceso | Cuerpo / filtros | Descripción |', '|---|---|---|---|---|');
  for (const r of porModulo.get(m)) {
    const acceso = r.acceso.tipo === 'permiso' ? `\`${r.acceso.permiso}\`` : r.acceso.tipo;
    const val = r.validaciones.map((v) => {
      const e = esquemaDe(v.esquema);
      const nombre = e.ref ? `\`${e.exacto ? e.ref : `${e.ref}…`}\`` : 'en el controlador';
      return `${v.destino === 'body' ? 'cuerpo' : 'filtros'}: ${nombre}`;
    }).join('<br>');
    const desc = (r.doc || '').replace(/\|/g, '\\|');
    md.push(`| ${r.metodo} | \`${r.camino}\` | ${acceso} | ${val || '—'} | ${desc} |`);
  }
  md.push('');
}
md.push('## Permisos', '', '| Permiso | Nombre |', '|---|---|');
for (const p of [...new Set(rutas.filter((r) => r.acceso.tipo === 'permiso').map((r) => r.acceso.permiso))].sort()) md.push(`| \`${p}\` | ${nombrePermiso(p)} |`);
md.push('', '---', 'KONTIVA ERP · Desarrollado por Araújo Tech Sistemas', '');

const desconocidas = rutas.filter((r) => r.acceso.tipo === 'desconocido');
if (desconocidas.length) {
  console.error(`Rutas sin @Requiere / @SoloSesion / @Publico: ${desconocidas.map((r) => `${r.metodo} ${r.camino}`).join(', ')}`);
  process.exit(1);
}
mkdirSync(join(raiz, 'docs/api'), { recursive: true });
writeFileSync(join(raiz, 'docs/api/openapi.json'), `${JSON.stringify(openapi, null, 2)}\n`);
writeFileSync(join(raiz, 'docs/api/README.md'), md.join('\n'));
console.log(`docs/api: ${rutas.length} rutas, ${Object.keys(openapi.components.schemas).length} esquemas`);
