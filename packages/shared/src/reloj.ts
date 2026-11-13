/**
 * Archivos de relojes de asistencia. Acepta el `attlog.dat` de ZKTeco (código, fecha y hora separados por
 * tabulación) y las exportaciones en CSV o texto de los programas de los relojes, con la fecha como
 * AAAA-MM-DD o DD/MM/AAAA y la hora en la misma columna o en la siguiente.
 * De cada línea se toman la fecha, la hora y las palabras anteriores, entre las que está el código del
 * funcionario (o su cédula); quien importa decide a qué funcionario corresponde cada código.
 */
export interface LineaReloj {
  linea: number;
  claves: string[];
  fecha: string;
  hora: string;
}

const ISO = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[\sT;,]+(\d{1,2}):(\d{2})(?::(\d{2}))?/;
const DMA = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})[\sT;,]+(\d{1,2}):(\d{2})(?::(\d{2}))?/;
const dos = (n: number) => String(n).padStart(2, '0');

export function leerArchivoReloj(texto: string): { lineas: LineaReloj[]; ignoradas: number } {
  const lineas: LineaReloj[] = [];
  let ignoradas = 0;
  texto.split(/\r?\n/).forEach((cruda, i) => {
    const l = cruda.replace(/"/g, '').trim();
    if (!l) return;
    const iso = ISO.exec(l);
    const dma = iso ? null : DMA.exec(l);
    const m = iso ?? dma;
    if (!m) return void ignoradas++;
    const [a, me, d] = iso ? [Number(m[1]), Number(m[2]), Number(m[3])] : [Number(m[3]), Number(m[2]), Number(m[1])];
    const h = Number(m[4]);
    const mi = Number(m[5]);
    const s = Number(m[6] ?? 0);
    const valida = new Date(Date.UTC(a, me - 1, d));
    if (me < 1 || me > 12 || valida.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return void ignoradas++;
    const claves = l
      .slice(0, m.index)
      .split(/[\s;,]+/)
      .filter((t) => /^[0-9A-Za-z]{1,20}$/.test(t));
    if (!claves.length) return void ignoradas++;
    lineas.push({ linea: i + 1, claves, fecha: `${a}-${dos(me)}-${dos(d)}`, hora: `${dos(h)}:${dos(mi)}:${dos(s)}` });
  });
  return { lineas, ignoradas };
}
