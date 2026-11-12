import { crearCliente } from '../lib/api';

export const master = crearCliente('/api/master');

export interface EmpresaMaster {
  id: string;
  nombre: string;
  razonSocial: string;
  ruc: string | null;
  rubro: string;
  estado: 'activa' | 'suspendida';
  plan: string;
  creadoEn: string;
  usuariosActivos: number;
  sucursalesActivas: number;
  ultimoAcceso: string | null;
  propietario: { email: string; nombre: string; pendiente: boolean } | null;
  suscripcion: {
    ciclo: 'mensual' | 'anual';
    precio: string;
    moneda: 'PYG' | 'USD' | 'BRL';
    venceEn: string;
    diasGracia: number;
    suspensionAutomatica: boolean;
    motivoSuspension: 'falta_pago' | 'manual' | null;
    notas: string | null;
    estado: 'al_dia' | 'en_gracia' | 'vencida' | 'sin_control';
  } | null;
}

export interface PagoMaster {
  id: string;
  monto: string;
  moneda: string;
  fecha: string;
  periodoDesde: string;
  periodoHasta: string;
  metodo: string;
  referencia: string | null;
  anulado: boolean;
  motivoAnulacion: string | null;
  registradoPor: string;
}

export interface PlanMaster {
  id: string;
  codigo: string;
  nombre: string;
  maxUsuarios: number | null;
  maxSucursales: number | null;
  maxCajas: number | null;
  precioMensual: string | null;
  precioAnual: string | null;
  exige2faPropietario: boolean;
  activo: boolean;
  empresas: number;
}

const formatos: Record<string, Intl.NumberFormat> = {
  PYG: new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'PYG', maximumFractionDigits: 0 }),
  USD: new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'USD' }),
  BRL: new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'BRL' }),
};
export const dinero = (v: string | number | null, moneda = 'PYG') => (v === null ? '—' : (formatos[moneda] ?? formatos.PYG!).format(Number(v)));

export const fecha = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};

export const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
export const sumarDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const ESTADO_SUSCRIPCION = {
  al_dia: { texto: 'Al día', clase: 'i-ok' },
  en_gracia: { texto: 'En gracia', clase: 'i-warn' },
  vencida: { texto: 'Vencida', clase: 'i-bad' },
  sin_control: { texto: 'Sin suscripción', clase: 'i-n' },
} as const;

export const RUBROS: Record<string, string> = {
  general: 'Comercio general',
  supermercado: 'Supermercado',
  panaderia: 'Panadería',
  restaurante: 'Restaurante',
  ropa: 'Ropa y calzado',
  farmacia: 'Farmacia',
  ferreteria: 'Ferretería',
  distribuidora: 'Distribuidora',
};
