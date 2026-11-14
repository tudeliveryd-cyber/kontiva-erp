/** Grade de ropa y calzado: curvas de talles habituales y utilidades para armar las variantes. */
export const CURVAS_TALLES = {
  letras: { nombre: 'Letras (PP a XG)', talles: ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XXG'] },
  internacional: { nombre: 'Internacional (XS a XXL)', talles: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
  numeros: { nombre: 'Números (34 a 50)', talles: ['34', '36', '38', '40', '42', '44', '46', '48', '50'] },
  calzado: { nombre: 'Calzado (33 a 44)', talles: ['33', '34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44'] },
  infantil: { nombre: 'Infantil (1 a 16)', talles: ['1', '2', '3', '4', '6', '8', '10', '12', '14', '16'] },
  unico: { nombre: 'Talle único', talles: ['Único'] },
} as const;
export type CurvaTalles = keyof typeof CURVAS_TALLES;

const ORDEN = [...new Set(Object.values(CURVAS_TALLES).flatMap((c) => c.talles as readonly string[]))];

/** Orden natural de los talles: los de las curvas conocidas en su orden, los números por valor, el resto alfabético. */
export function compararTalles(a: string, b: string): number {
  const ia = ORDEN.findIndex((t) => t.toLowerCase() === a.toLowerCase());
  const ib = ORDEN.findIndex((t) => t.toLowerCase() === b.toLowerCase());
  const na = Number(a.replace(',', '.'));
  const nb = Number(b.replace(',', '.'));
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0) return -1;
  if (ib >= 0) return 1;
  return a.localeCompare(b, 'es');
}

/** Nombre de la variante a partir del talle y el color: "M · Negro". */
export function nombreGrade(talle?: string | null, color?: string | null): string | null {
  const partes = [talle?.trim(), color?.trim()].filter(Boolean);
  return partes.length ? partes.join(' · ') : null;
}

/** SKU sugerido para una celda de la grade: base-talle-color en mayúsculas, sin espacios ni acentos. */
export function skuGrade(base: string, talle?: string | null, color?: string | null): string {
  const limpio = (t: string) =>
    t
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^0-9A-Z]+/g, '');
  return [base, talle, color ? color.slice(0, 6) : null]
    .filter(Boolean)
    .map((t) => limpio(t!))
    .filter(Boolean)
    .join('-')
    .slice(0, 60);
}
