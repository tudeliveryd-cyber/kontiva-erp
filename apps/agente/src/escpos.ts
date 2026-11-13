import type { BloqueTicket, DocumentoTicket } from '@kontiva/shared';

/**
 * Conversión del documento de ticket a comandos ESC/POS (Epson y compatibles: Bematech, Daruma,
 * Xprinter, Elgin, 3nStar...). Página de códigos PC850 para tildes, ñ y signos del español.
 */

const ESC = 0x1b;
const GS = 0x1d;

const PC850: Record<string, number> = {
  á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, ü: 0x81, Ü: 0x9a,
  Á: 0xb5, É: 0x90, Í: 0xd6, Ó: 0xe0, Ú: 0xe9, '¿': 0xa8, '¡': 0xad, º: 0xa7, ª: 0xa6,
  '°': 0xf8, '·': 0xfa, '×': 0x9e, ç: 0x87, Ç: 0x80, ã: 0xc6, Ã: 0xc7, õ: 0xe4, Õ: 0xe5, â: 0x83, ê: 0x88, ô: 0x93, à: 0x85,
};

/** Texto a bytes PC850; lo que no existe en la página de códigos se reemplaza sin tildes o con "?". */
export function codificar(texto: string): number[] {
  const bytes: number[] = [];
  for (const ch of texto) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x20 && c < 0x7f) bytes.push(c);
    else if (PC850[ch] !== undefined) bytes.push(PC850[ch]!);
    else {
      const sin = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      bytes.push(sin.length === 1 && sin.charCodeAt(0) < 0x7f ? sin.charCodeAt(0) : 0x3f);
    }
  }
  return bytes;
}

/** Corta un texto en renglones de `ancho` columnas, sin partir palabras si se puede. */
export function partir(texto: string, ancho: number): string[] {
  const renglones: string[] = [];
  for (const parrafo of texto.split('\n')) {
    let actual = '';
    for (const palabra of parrafo.split(/\s+/).filter(Boolean)) {
      let p = palabra;
      while (p.length > ancho) {
        if (actual) {
          renglones.push(actual);
          actual = '';
        }
        renglones.push(p.slice(0, ancho));
        p = p.slice(ancho);
      }
      if (!actual) actual = p;
      else if (actual.length + 1 + p.length <= ancho) actual += ` ${p}`;
      else {
        renglones.push(actual);
        actual = p;
      }
    }
    renglones.push(actual);
  }
  return renglones;
}

/** Fila con texto a la izquierda y monto a la derecha; si no entra, la izquierda ocupa más renglones. */
export function fila(izq: string, der: string, ancho: number): string[] {
  const espacio = ancho - der.length - 1;
  if (espacio < 4) return [...partir(izq, ancho), der.padStart(ancho)];
  const partes = partir(izq, espacio);
  const ultima = partes.pop() ?? '';
  return [...partes, ultima.padEnd(ancho - der.length) + der];
}

export function renderizar(doc: DocumentoTicket, ancho = 48): Buffer {
  const b: number[] = [];
  const cmd = (...x: number[]) => b.push(...x);
  const linea = (t: string) => {
    b.push(...codificar(t));
    cmd(0x0a);
  };
  cmd(ESC, 0x40); // inicializar
  cmd(ESC, 0x74, 2); // página de códigos PC850
  for (const bl of doc.bloques as BloqueTicket[]) {
    switch (bl.t) {
      case 'texto': {
        cmd(ESC, 0x61, bl.alinear === 'centro' ? 1 : bl.alinear === 'der' ? 2 : 0);
        if (bl.negrita) cmd(ESC, 0x45, 1);
        if (bl.grande) cmd(GS, 0x21, 0x11);
        for (const r of partir(bl.v, bl.grande ? Math.floor(ancho / 2) : ancho)) linea(r);
        if (bl.grande) cmd(GS, 0x21, 0);
        if (bl.negrita) cmd(ESC, 0x45, 0);
        cmd(ESC, 0x61, 0);
        break;
      }
      case 'fila': {
        if (bl.negrita) cmd(ESC, 0x45, 1);
        if (bl.grande) cmd(GS, 0x21, 0x01); // doble alto: mantiene las columnas
        for (const r of fila(bl.izq, bl.der, ancho)) linea(r);
        if (bl.grande) cmd(GS, 0x21, 0);
        if (bl.negrita) cmd(ESC, 0x45, 0);
        break;
      }
      case 'linea':
        linea('-'.repeat(ancho));
        break;
      case 'espacio':
        for (let i = 0; i < (bl.n ?? 1); i++) cmd(0x0a);
        break;
      case 'qr': {
        const datos = Buffer.from(bl.v, 'utf8');
        const largo = datos.length + 3;
        cmd(ESC, 0x61, 1);
        cmd(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0); // modelo 2
        cmd(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, Math.min(Math.max(bl.tamano ?? 5, 1), 16)); // tamaño del módulo
        cmd(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31); // corrección de errores M
        cmd(GS, 0x28, 0x6b, largo & 0xff, largo >> 8, 0x31, 0x50, 0x30, ...datos); // guardar
        cmd(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30); // imprimir
        cmd(0x0a);
        cmd(ESC, 0x61, 0);
        break;
      }
    }
  }
  cmd(0x0a, 0x0a, 0x0a);
  if (doc.cortar !== false) cmd(GS, 0x56, 0x42, 0); // avance y corte parcial
  if (doc.abrirCajon) cmd(ESC, 0x70, 0, 25, 250); // pulso al cajón (pin 2)
  return Buffer.from(b);
}

/** Solo el pulso para abrir el cajón, sin imprimir. */
export const pulsoCajon = () => Buffer.from([ESC, 0x40, ESC, 0x70, 0, 25, 250]);
