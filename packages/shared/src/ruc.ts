/**
 * RUC paraguayo: número base + dígito verificador (módulo 11, algoritmo de la DNIT).
 * Formato aceptado: "80012345-6" o "1234567-9".
 */
export function calcularDvRuc(base: string, baseMax = 11): number {
  const limpio = base.toUpperCase().replace(/[^0-9A-Z]/g, '');
  // La DNIT reemplaza letras por su código ASCII antes de calcular.
  const numerico = [...limpio].map((c) => (/[0-9]/.test(c) ? c : String(c.charCodeAt(0)))).join('');
  let total = 0;
  let k = 2;
  for (let i = numerico.length - 1; i >= 0; i--) {
    if (k > baseMax) k = 2;
    total += Number(numerico[i]) * k;
    k++;
  }
  const resto = total % 11;
  return resto > 1 ? 11 - resto : 0;
}

export function validarRuc(ruc: string): boolean {
  const m = /^([0-9A-Za-z]{1,12})-([0-9])$/.exec(ruc.trim());
  if (!m) return false;
  return calcularDvRuc(m[1]!) === Number(m[2]);
}
