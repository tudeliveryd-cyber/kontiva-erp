import { readSheet } from 'read-excel-file/browser';
import writeXlsxFile from 'write-excel-file/browser';
import type { ColumnaImportacion } from '@kontiva/shared';

/**
 * Lectura de planillas en el navegador: .xlsx (Excel, LibreOffice, Google Sheets) y .csv.
 * Los CSV de Excel en español usan ";" y a veces Windows-1252: se detectan ambos.
 */
export async function leerPlanilla(archivo: File): Promise<unknown[][]> {
  const nombre = archivo.name.toLowerCase();
  if (nombre.endsWith('.xlsx')) return (await readSheet(archivo)) as unknown[][];
  if (nombre.endsWith('.csv') || nombre.endsWith('.txt')) return leerCsv(await decodificar(archivo));
  if (nombre.endsWith('.xls')) throw new Error('El formato .xls antiguo no se puede leer. En Excel use "Guardar como" → Libro de Excel (.xlsx).');
  throw new Error('Use un archivo .xlsx o .csv');
}

async function decodificar(archivo: File): Promise<string> {
  const bytes = await archivo.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function leerCsv(texto: string): string[][] {
  const primera = texto.split(/\r?\n/, 1)[0] ?? '';
  const candidatos = [';', ',', '\t'];
  const sep = candidatos.reduce((a, b) => (primera.split(b).length > primera.split(a).length ? b : a));
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') {
        celda += '"';
        i++;
      } else if (c === '"') comillas = false;
      else celda += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) {
      fila.push(celda);
      celda = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = '';
    } else celda += c;
  }
  if (celda !== '' || fila.length) {
    fila.push(celda);
    filas.push(fila);
  }
  return filas;
}

/** Planilla modelo con encabezados, una fila de ejemplo y una hoja de instrucciones. */
export async function descargarModelo(columnas: ColumnaImportacion[], nombre: string) {
  const encabezados = columnas.map((c) => ({ value: c.titulo, fontWeight: 'bold' as const, backgroundColor: '#F4EEF8' }));
  const ejemplo = columnas.map((c) => ({ value: c.ejemplo === '' ? undefined : c.ejemplo }));
  const ayuda = [
    [{ value: 'Columna', fontWeight: 'bold' as const }, { value: 'Obligatoria', fontWeight: 'bold' as const }, { value: 'Qué poner', fontWeight: 'bold' as const }],
    ...columnas.map((c) => [{ value: c.titulo }, { value: c.obligatoria ? 'Sí' : 'No' }, { value: c.ayuda }]),
  ];
  await writeXlsxFile(
    [
      { data: [encabezados, ejemplo], sheet: 'Datos', columns: columnas.map(() => ({ width: 20 })) },
      { data: ayuda, sheet: 'Instrucciones', columns: [{ width: 20 }, { width: 12 }, { width: 80 }] },
    ],
  ).toFile(nombre);
}
