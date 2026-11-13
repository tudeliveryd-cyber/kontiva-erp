/**
 * Documento de ticket para impresoras térmicas: la web lo arma, el agente local lo convierte a ESC/POS.
 * Independiente del ancho: el agente acomoda las filas a 32 (58 mm) o 48 (80 mm) columnas.
 */
export type BloqueTicket =
  | { t: 'texto'; v: string; alinear?: 'izq' | 'centro' | 'der'; negrita?: boolean; grande?: boolean }
  | { t: 'fila'; izq: string; der: string; negrita?: boolean; grande?: boolean }
  | { t: 'linea' }
  | { t: 'qr'; v: string; tamano?: number }
  | { t: 'espacio'; n?: number };

export interface DocumentoTicket {
  bloques: BloqueTicket[];
  /** Cortar el papel al terminar (si la impresora tiene cortador). */
  cortar?: boolean;
  /** Abrir el cajón de dinero conectado a la impresora. */
  abrirCajon?: boolean;
}
