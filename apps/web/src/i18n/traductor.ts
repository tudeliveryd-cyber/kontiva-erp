/**
 * Idioma de la interfaz. La aplicación se escribe en español; en portugués, cada texto que aparece en pantalla
 * (incluidos los mensajes que llegan de la API) se reemplaza con el diccionario revisado de `pt.ts` al dibujarse.
 * Frases con datos ("Venta N.º {0}") se traducen por patrón y sus datos quedan intactos.
 * Nunca se traduce lo marcado con translate="no", los tickets ni los documentos (.ticket, .doc-a4: valor fiscal
 * en Paraguay), ni lo que la persona escribe (input, textarea).
 */
import { PT } from './pt';

export type Idioma = 'es' | 'pt';
const CLAVE = 'kontiva.idioma';
const ATRIBUTOS = ['placeholder', 'title', 'aria-label', 'alt'] as const;
const NO_TRADUCIR = '[translate="no"], .ticket, .doc-a4, input, textarea, script, style, code, pre';

const exactos = new Map<string, string>();
const patrones: { prefijo: string; re: RegExp; pt: string; debil: boolean }[] = [];
for (const [es, pt] of Object.entries(PT)) {
  if (/\{\d+\}/.test(es)) {
    const partes = es.split(/\{(\d+)\}/);
    const orden: number[] = [];
    let fuente = '';
    partes.forEach((p, i) => {
      if (i % 2) {
        orden.push(Number(p));
        fuente += '(.+?)';
      } else fuente += p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    // Con muy poco texto fijo ("{0} al {1}") el patrón podría tocar nombres que escribió la persona
    // ("Pollo al horno"): solo se aplica si cada dato tiene cifras o una traducción propia.
    const debil = partes.filter((_, i) => i % 2 === 0).join('').replace(/[^\p{L}]/gu, '').length < 4;
    patrones.push({ prefijo: partes[0]!, re: new RegExp(`^${fuente}$`, 's'), pt: pt.replace(/\{(\d+)\}/g, (_, n) => `{${orden.indexOf(Number(n))}}`), debil });
  } else exactos.set(es, pt);
}
// Los patrones más específicos (prefijo más largo) primero.
patrones.sort((a, b) => b.prefijo.length - a.prefijo.length);

/** Traduce un texto completo; devuelve null si no hay traducción. Conserva los espacios de los bordes. */
export function traducir(texto: string): string | null {
  const t = texto.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const bordes = (pt: string) => texto.match(/^\s*/)![0] + pt + texto.match(/\s*$/)![0];
  const e = exactos.get(t);
  if (e !== undefined) return bordes(e);
  for (const p of patrones) {
    if (!t.startsWith(p.prefijo)) continue;
    const m = t.match(p.re);
    if (!m) continue;
    if (p.debil && !m.slice(1).every((v) => /\d/.test(v) || exactos.has(v))) continue;
    const valores = m.slice(1).map((v) => exactos.get(v) ?? v);
    return bordes(p.pt.replace(/\{(\d+)\}/g, (_, n) => valores[Number(n)] ?? ''));
  }
  return null;
}

/** Para textos armados en código fuera de la pantalla (confirm, título de la pestaña). */
export const t = (texto: string) => (idiomaActual() === 'pt' ? (traducir(texto) ?? texto) : texto);

export function idiomaActual(): Idioma {
  try {
    const v = localStorage.getItem(CLAVE);
    if (v === 'es' || v === 'pt') return v;
  } catch {
    /* almacenamiento no disponible */
  }
  return navigator.language?.toLowerCase().startsWith('pt') ? 'pt' : 'es';
}

const traducidos = new WeakMap<Node, string>(); // nodo → texto que pusimos (para no volver a procesarlo)

function traducirNodo(n: Text) {
  const v = n.nodeValue;
  if (!v || traducidos.get(n) === v) return;
  const padre = n.parentElement;
  if (!padre || padre.closest(NO_TRADUCIR)) return;
  const pt = traducir(v);
  if (pt !== null && pt !== v) {
    traducidos.set(n, pt);
    n.nodeValue = pt;
  }
}

const atributosHechos = new WeakMap<Element, Map<string, string>>();
function traducirAtributos(el: Element) {
  if (el.closest('[translate="no"], .ticket, .doc-a4')) return;
  for (const a of ATRIBUTOS) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const hechos = atributosHechos.get(el) ?? new Map<string, string>();
    if (hechos.get(a) === v) continue;
    const pt = traducir(v);
    if (pt !== null && pt !== v) {
      hechos.set(a, pt);
      atributosHechos.set(el, hechos);
      el.setAttribute(a, pt);
    }
  }
}

function recorrer(raiz: Node) {
  if (raiz.nodeType === Node.TEXT_NODE) return traducirNodo(raiz as Text);
  if (raiz.nodeType !== Node.ELEMENT_NODE) return;
  const el = raiz as Element;
  if (el.closest(NO_TRADUCIR) && !el.matches('input, textarea')) return;
  traducirAtributos(el);
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) traducirNodo(n as Text);
    else traducirAtributos(n as Element);
  }
}

let observador: MutationObserver | null = null;

/** Aplica el idioma: en portugués traduce lo que hay y lo que se dibuje después. */
export function aplicarIdioma(idioma: Idioma) {
  document.documentElement.lang = idioma === 'pt' ? 'pt-BR' : 'es-PY';
  if (idioma !== 'pt' || observador) return;
  const titulo = traducir(document.title);
  if (titulo) document.title = titulo;
  recorrer(document.body);
  observador = new MutationObserver((cambios) => {
    for (const c of cambios) {
      if (c.type === 'characterData') traducirNodo(c.target as Text);
      else if (c.type === 'attributes') traducirAtributos(c.target as Element);
      else c.addedNodes.forEach(recorrer);
    }
  });
  observador.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATRIBUTOS] });
  // Diálogos del navegador.
  const confirmar = window.confirm.bind(window);
  const avisar = window.alert.bind(window);
  window.confirm = (m?: string) => confirmar(m === undefined ? m : (traducir(m) ?? m));
  window.alert = (m?: string) => avisar(m === undefined ? m : (traducir(m) ?? m));
}

/** Cambia el idioma de este navegador (y recarga para volver al español sin rastros). */
export function fijarIdioma(idioma: Idioma, recargar = true) {
  const antes = idiomaActual();
  try {
    localStorage.setItem(CLAVE, idioma);
  } catch {
    /* sin almacenamiento: vale para esta página */
  }
  if (idioma === antes) return;
  if (recargar) window.location.reload();
  else aplicarIdioma(idioma);
}
