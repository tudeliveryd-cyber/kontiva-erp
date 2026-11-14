#!/usr/bin/env node
/**
 * Extrae los textos de la interfaz (y los mensajes de la API que llegan a la pantalla) para el diccionario
 * de idiomas. Uso: node scripts/extraer-textos.mjs [--faltantes]
 *   Sin opciones: escribe scripts/textos.json (exactos y patrones con {0}, {1}…).
 *   --faltantes: lista los que todavía no tienen traducción en apps/web/src/i18n/pt.ts (la CI lo verifica).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const ts = createRequire(join(raiz, 'apps/web/package.json'))('typescript');

const archivos = (dir, ext) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return ['i18n', 'node_modules', 'dist', 'master'].includes(n) ? [] : archivos(p, ext);
    return ext.some((e) => n.endsWith(e)) && !n.endsWith('.d.ts') ? [p] : [];
  });

const LETRA = /[A-Za-zÁÉÍÓÚÑáéíóúñü]/;
const normalizar = (t) => t.replace(/\s+/g, ' ').trim();
// Atributos que no son texto visible.
const ATRIBUTOS_TECNICOS = new Set(['className', 'id', 'htmlFor', 'type', 'name', 'href', 'to', 'src', 'key', 'role', 'inputMode', 'autoComplete', 'method', 'rel', 'target', 'accept', 'pattern', 'lang', 'width', 'height', 'viewBox', 'd', 'fill', 'stroke', 'tipo', 'clase', 'variante', 'engine', 'form', 'step', 'min', 'max', 'value', 'defaultValue']);

/** ¿Parece texto para personas (y no un identificador, ruta, clase CSS o formato)? */
function esTexto(t) {
  if (!LETRA.test(t)) return false;
  if (/^(https?:|\/|\.|#|data:|mailto:)/.test(t)) return false;
  if (/^[a-z0-9_.:-]+$/.test(t)) return false; // identificadores: efectivo, venta.crear, en_ruta, i-ok
  if (/^[A-Z0-9_]+$/.test(t) && t.length > 3 && !/^[A-ZÁÉÍÓÚÑ]{2,}$/.test(t)) return false; // CONSTANTES_ASI
  if (/^(en-CA|es-PY|America\/Asuncion|UTF-8|PYG|USD|BRL)$/.test(t)) return false;
  if (/^[\w-]+(\s[\w-]+)*$/.test(t) && /(^| )(btn|entrada|insignia|tenue|peq|num|der|mono|panel|form|clic|i-\w+)( |$)/.test(t)) return false; // clases CSS
  if (/^\s*[\d.,:%\s-]+\s*$/.test(t)) return false;
  if (/(^|\s)-?\d+(px|rem|em|%|ms|s)\b|var\(--|calc\(|rgba?\(|#[0-9a-f]{3,6}\b/i.test(t)) return false; // CSS
  if (/\b(coalesce|select|from|where|join)\b.*[(|']|\|\|/i.test(t)) return false; // SQL
  if (/^[a-z]+[A-Z][A-Za-z]*$/.test(t)) return false; // camelCase
  return true;
}

const exactos = new Map(); // texto → primer archivo
const patrones = new Map();
const anotar = (mapa, t, archivo) => {
  const n = normalizar(t);
  if (n && esTexto(n.replace(/\{\d+\}/g, '')) && !mapa.has(n)) mapa.set(n, archivo.replace(raiz + '/', ''));
};

function plantilla(nodo) {
  // `Venta N.º ${n} · ${caja}` → "Venta N.º {0} · {1}"
  let t = nodo.head.text;
  nodo.templateSpans.forEach((s, i) => (t += `{${i}}` + s.literal.text));
  return t;
}

function recorrerWeb(archivo) {
  const fuente = ts.createSourceFile(archivo, readFileSync(archivo, 'utf8'), ts.ScriptTarget.Latest, true, archivo.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visitar = (n) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if (ts.isJsxText(n)) {
      anotar(exactos, n.text, archivo);
    } else if (ts.isJsxAttribute(n)) {
      const nombre = n.name.getText();
      if (ATRIBUTOS_TECNICOS.has(nombre) || nombre.startsWith('data-')) return;
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const p = n.parent;
      // Claves de objeto, comparaciones con identificadores y argumentos técnicos no son texto.
      if (ts.isPropertyAssignment(p) && p.name === n) return;
      if (ts.isElementAccessExpression(p) || ts.isLiteralTypeNode(p)) return;
      if (ts.isCallExpression(p) && /^(api|archivo|fetch|querySelector|querySelectorAll|getElementById|addEventListener|setItem|getItem|removeItem|navigate|startsWith|endsWith|includes|split|replace|toLocaleString|Intl\.\w+|new Intl\.\w+)$/.test(p.expression.getText().split('.').pop())) return;
      if (ts.isBinaryExpression(p) && /===|!==|==|!=/.test(p.operatorToken.getText())) return;
      if (ts.isCaseClause(p)) return;
      if (ts.isJsxAttribute(p) && ATRIBUTOS_TECNICOS.has(p.name.getText())) return;
      anotar(exactos, n.text, archivo);
    } else if (ts.isTemplateExpression(n)) {
      const p = n.parent;
      if (ts.isCallExpression(p) && /^(api|archivo|fetch|navigate)$/.test(p.expression.getText().split('.').pop())) return;
      if (ts.isJsxAttribute(p) && ATRIBUTOS_TECNICOS.has(p.name.getText())) return;
      if (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent) && ATRIBUTOS_TECNICOS.has(p.parent.name.getText())) return;
      const t = plantilla(n);
      // Rutas y clases armadas con plantillas no son texto.
      if (/^(\/|\{0\}\/|insignia|btn|entrada|fila|chip|celda|mesa)/.test(t) || /[?&]\w+=/.test(t)) {
        // pero sí sus partes visibles anidadas
      } else anotar(patrones, t, archivo);
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
}

/** Mensajes de la API que se muestran: invalido('…'), conflicto('COD', '…'), noEncontrado('…'), prohibido('…'). */
function recorrerApi(archivo) {
  const fuente = ts.createSourceFile(archivo, readFileSync(archivo, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visitar = (n) => {
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const f = n.expression.getText().split('.').pop();
      const args = n.arguments ?? [];
      const mensaje = { invalido: 0, prohibido: 0, noEncontrado: 0, conflicto: 1, ErrorNegocio: 2, refine: 1 }[f];
      const a = mensaje !== undefined ? args[mensaje] : undefined;
      if (a) {
        if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) anotar(f === 'noEncontrado' ? patrones : exactos, f === 'noEncontrado' ? `${a.text} no encontrado` : a.text, archivo);
        else if (ts.isTemplateExpression(a)) anotar(patrones, plantilla(a), archivo);
      }
    }
    // Mensajes de zod: .min(1, 'Nombre…'), { message: '…' }, z.string('…')
    if (ts.isStringLiteral(n) && ts.isCallExpression(n.parent) && /^(min|max|regex|refine|email|uuid|positive|nonnegative|int|length|string|number|array|enum)$/.test(n.parent.expression.getText().split('.').pop() ?? '') && /\s/.test(n.text)) anotar(exactos, n.text, archivo);
    if (ts.isPropertyAssignment(n) && /^(message|error|nombre|descripcion|mensaje)$/.test(n.name.getText()) && (ts.isStringLiteral(n.initializer) || ts.isNoSubstitutionTemplateLiteral(n.initializer))) anotar(exactos, n.initializer.text, archivo);
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
}

for (const a of archivos(join(raiz, 'apps/web/src'), ['.tsx', '.ts'])) recorrerWeb(a);
for (const a of archivos(join(raiz, 'packages/shared/src'), ['.ts'])) recorrerApi(a);
for (const a of archivos(join(raiz, 'apps/api/src'), ['.ts'])) if (!/\/(master|provision)\/|cli\.ts$|migrador\.ts$|bootstrap\.ts$|env\.ts$|config\.ts$|main(-master)?\.ts$/.test(a)) recorrerApi(a);

// El mensaje genérico de "no encontrado" de la API.
patrones.set('{0} no encontrado', 'apps/api/src/comun/errores.ts');

const salida = { exactos: Object.fromEntries([...exactos].sort(([a], [b]) => a.localeCompare(b, 'es'))), patrones: Object.fromEntries([...patrones].sort(([a], [b]) => a.localeCompare(b, 'es'))) };

if (process.argv.includes('--faltantes')) {
  const pt = readFileSync(join(raiz, 'apps/web/src/i18n/pt.ts'), 'utf8');
  const tiene = new Set([...pt.matchAll(/^\s*(['"])((?:\\.|(?!\1).)*)\1\s*:/gm)].map((m) => m[2].replace(/\\(['"\\])/g, '$1')));
  const faltan = [...Object.keys(salida.exactos), ...Object.keys(salida.patrones)].filter((t) => !tiene.has(t));
  if (faltan.length) {
    console.error(`Textos sin traducción al portugués (${faltan.length}):\n${faltan.slice(0, 50).map((t) => `  ${JSON.stringify(t)}`).join('\n')}`);
    process.exit(1);
  }
  console.log('Diccionario completo.');
} else {
  writeFileSync(join(raiz, 'scripts/textos.json'), JSON.stringify(salida, null, 1));
  console.log(`${Object.keys(salida.exactos).length} textos y ${Object.keys(salida.patrones).length} patrones`);
}
