/** Tipos y formatos de la operación (catálogo, stock, cajas, ventas). */

export type Moneda = 'PYG' | 'USD' | 'BRL';
export type Medio = 'efectivo' | 'tarjeta' | 'transferencia' | 'otro';

export interface Variante {
  id?: string;
  nombre: string | null;
  sku: string | null;
  activa: boolean;
  precio: string;
  costo?: string;
  stockMinimo?: string;
  codigos: string[];
}

export interface Producto {
  id: string;
  nombre: string;
  descripcion: string | null;
  categoria: { id: string; nombre: string } | null;
  marca: { id: string; nombre: string } | null;
  tipo: 'producto' | 'servicio';
  unidad: string;
  tasaIva: 0 | 5 | 10;
  controlaStock: boolean;
  controlaLote?: boolean;
  principioActivo?: string | null;
  concentracion?: string | null;
  forma?: string | null;
  registroSanitario?: string | null;
  condicionVenta?: 'libre' | 'receta' | 'receta_archivada';
  estacion?: 'cocina' | 'bar' | null;
  activo: boolean;
  variantes: (Variante & { id: string })[];
}

export interface Deposito {
  id: string;
  nombre: string;
  sucursal: { id: string; nombre: string; codigo: string };
}

export interface FilaStock {
  varianteId: string;
  descripcion: string;
  sku: string | null;
  unidad: string;
  cantidad: string;
  controlaLote?: boolean;
  costo?: string;
}

export interface Cliente {
  id: string;
  nombre: string;
  documento: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  listaPrecioId: string | null;
  limiteCredito: string;
  plazoCreditoDias: number;
  saldo?: string;
  activo: boolean;
}

export interface CajaFila {
  id: string;
  nombre: string;
  activa: boolean;
  sucursal: { id: string; nombre: string };
  deposito: { id: string; nombre: string };
  sesion: { id: string; abiertaEn: string; usuario: { id: string; nombre: string }; propia: boolean } | null;
}

export interface SesionCaja {
  id: string;
  cajaId: string;
  estado: 'abierta' | 'cerrada';
  abiertaEn: string;
  cerradaEn: string | null;
  usuario: { id: string; nombre: string };
  ventas: { cantidad: number; total: string; anuladas: number };
  esperado: { moneda: Moneda; medio: Medio; monto: string }[];
  movimientos: { tipo: string; medio: Medio; moneda: Moneda; monto: string; motivo: string | null; creado_en: string }[];
  arqueo: { moneda: Moneda; medio: Medio; esperado: string; contado: string; diferencia: string }[];
}

export interface Cotizacion {
  moneda: 'USD' | 'BRL';
  compra: string;
  venta: string;
  creado_en: string;
}

export interface Venta {
  id: string;
  numero: number;
  estado: 'confirmada' | 'anulada';
  comprobante: 'interno' | 'factura';
  fecha: string;
  credito: string;
  cuentaCobrar: { id: string; saldo: string; vencimiento: string; estado: string } | null;
  documentoElectronico: {
    id: string;
    cdc: string;
    numero: string;
    timbrado: string;
    timbradoInicio: string | null;
    estado: 'pendiente' | 'enviado' | 'aprobado' | 'aprobado_obs' | 'rechazado' | 'cancelado';
    qr: string;
    qrImagen: string;
    ambiente: 'test' | 'produccion';
    totalIva: string;
    mensaje: string | null;
  } | null;
  caja: { id: string; nombre: string };
  sucursal: { id: string; nombre: string; codigo: string; direccion: string | null };
  vendedor: { id: string; nombre: string };
  cliente: { id: string; nombre: string; documento: string | null } | null;
  subtotal: string;
  descuento: string;
  total: string;
  gravado10: string;
  gravado5: string;
  exento: string;
  iva10: string;
  iva5: string;
  vuelto: { moneda: Moneda; monto: string }[];
  items: { linea: number; descripcion: string; cantidad: string; precioUnitario: string; descuento: string; total: string; tasaIva: number; cantidadDevuelta: string; condicionVenta?: 'receta' | 'receta_archivada' | null; lotes?: { codigo: string; vencimiento: string | null; cantidad: string }[] }[];
  receta?: { medico: string; matricula: string; paciente: string; pacienteDocumento: string | null; fecha: string; numero: string | null; retenida: boolean } | null;
  devoluciones: { id: string; numero: number; total: string; fecha: string }[];
  pagos: { medio: Medio; moneda: Moneda; monto: string; cotizacion: string; montoPyg: string; referencia: string | null }[];
  anulacion: { fecha: string; por: string; motivo: string; autorizadaPor: string | null } | null;
}

const fmt: Record<Moneda, Intl.NumberFormat> = {
  PYG: new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 }),
  USD: new Intl.NumberFormat('es-PY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  BRL: new Intl.NumberFormat('es-PY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
};
const SIMBOLO: Record<Moneda, string> = { PYG: 'Gs.', USD: 'US$', BRL: 'R$' };

export const dinero = (v: string | number, moneda: Moneda = 'PYG') => `${SIMBOLO[moneda]} ${fmt[moneda].format(Number(v))}`;
export const numero = (v: string | number, decimales = 0) => new Intl.NumberFormat('es-PY', { maximumFractionDigits: decimales }).format(Number(v));
export const cantidad = (v: string | number) => new Intl.NumberFormat('es-PY', { maximumFractionDigits: 3 }).format(Number(v));

export const NOMBRE_MEDIO: Record<Medio, string> = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', otro: 'Otro' };
export const NOMBRE_MONEDA: Record<Moneda, string> = { PYG: 'Guaraníes', USD: 'Dólares', BRL: 'Reales' };
export const UNIDADES: Record<string, string> = {
  unidad: 'Unidad', kg: 'Kilogramo', g: 'Gramo', litro: 'Litro', ml: 'Mililitro', metro: 'Metro', m2: 'Metro cuadrado', m3: 'Metro cúbico', caja: 'Caja', paquete: 'Paquete',
};

/** Clave de idempotencia de una venta (se reutiliza si hay que reintentar). */
export const nuevaClave = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
