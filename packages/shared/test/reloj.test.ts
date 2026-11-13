import { describe, expect, it } from 'vitest';
import { leerArchivoReloj } from '../src';

describe('archivos de reloj de asistencia', () => {
  it('lee el attlog.dat de ZKTeco', () => {
    const r = leerArchivoReloj('        1\t2026-11-03 07:58:12\t1\t0\t1\t0\n       12\t2026-11-03 18:31:05\t1\t1\t1\t0\n');
    expect(r.lineas).toEqual([
      { linea: 1, claves: ['1'], fecha: '2026-11-03', hora: '07:58:12' },
      { linea: 2, claves: ['12'], fecha: '2026-11-03', hora: '18:31:05' },
    ]);
  });

  it('lee CSV con encabezado, nombre y fecha día/mes/año, con la hora en otra columna', () => {
    const r = leerArchivoReloj('No.;Nombre;Fecha;Hora;Estado\r\n"7";"Ana Benítez";"03/11/2026";"07:59";"Entrada"\r\n4111222,Beto,4/11/2026 13:02,Salida\r\n');
    expect(r.ignoradas).toBe(1);
    expect(r.lineas).toEqual([
      { linea: 2, claves: ['7', 'Ana'], fecha: '2026-11-03', hora: '07:59:00' },
      { linea: 3, claves: ['4111222', 'Beto'], fecha: '2026-11-04', hora: '13:02:00' },
    ]);
  });

  it('descarta fechas imposibles y líneas sin código', () => {
    const r = leerArchivoReloj('5\t2026-02-30 08:00:00\n2026-11-03 08:00:00\n9\t2026-11-03 25:00\n');
    expect(r.lineas).toHaveLength(0);
    expect(r.ignoradas).toBe(3);
  });
});
