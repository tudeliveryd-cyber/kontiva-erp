import type { ConfigBalanza } from '@kontiva/shared';
/**
 * Cliente HTTP de KONTIVA.
 * - El token de acceso vive solo en memoria (nunca en localStorage).
 * - La renovación usa la cookie httpOnly; una sola renovación a la vez (las peticiones
 *   que fallan con 401 esperan esa misma renovación y se reintentan una vez).
 */

export interface ErrorApi {
  estado: number;
  codigo: string;
  mensaje: string;
  detalle?: unknown;
}

export class FalloApi extends Error implements ErrorApi {
  constructor(
    public estado: number,
    public codigo: string,
    mensaje: string,
    public detalle?: unknown,
  ) {
    super(mensaje);
  }
  get mensaje() {
    return this.message;
  }
}

async function leerError(r: Response): Promise<FalloApi> {
  let cuerpo: { codigo?: string; mensaje?: string; detalle?: unknown } = {};
  try {
    cuerpo = await r.json();
  } catch {
    /* sin cuerpo */
  }
  return new FalloApi(r.status, cuerpo.codigo ?? 'ERROR', cuerpo.mensaje ?? `Error ${r.status}`, cuerpo.detalle);
}

/** Rutas de ingreso: un 401 ahí es la respuesta, no una sesión vencida. */
const SIN_REINTENTO = ['/auth/login', '/auth/empresa', '/auth/2fa/verificar', '/auth/2fa/enrolar', '/auth/renovar', '/auth/recuperar', '/auth/restablecer'];

export interface OpcionesApi {
  metodo?: string;
  cuerpo?: unknown;
  reintento?: boolean;
  /** Encabezados extra, ej. X-Autorizacion con el token del PIN de un supervisor. */
  encabezados?: Record<string, string>;
  /** Tiempo máximo de espera (ms). Vencido, se trata como falta de conexión (el PDV pasa a vender sin conexión). */
  tiempo?: number;
}

export interface Cliente {
  api: <T = unknown>(ruta: string, opciones?: OpcionesApi) => Promise<T>;
  archivo: (ruta: string) => Promise<Blob>;
  renovarSesion: () => Promise<boolean>;
  fijarToken: (t: string | null) => void;
  alPerderSesion: (fn: () => void) => void;
}

/** Un cliente por servicio: la API de empresas (/api) y el Panel Master (/api/master). */
export function crearCliente(base: string): Cliente {
  let accessToken: string | null = null;
  let renovando: Promise<boolean> | null = null;
  let alExpirar: (() => void) | null = null;

  const renovarSesion = (): Promise<boolean> => {
    renovando ??= (async () => {
      try {
        const r = await fetch(`${base}/auth/renovar`, { method: 'POST', credentials: 'same-origin', headers: { 'X-Kontiva': '1' } });
        if (!r.ok) {
          accessToken = null;
          return false;
        }
        accessToken = (await r.json()).accessToken;
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => (renovando = null), 0);
      }
    })();
    return renovando;
  };

  const api = async <T = unknown>(ruta: string, opciones: OpcionesApi = {}): Promise<T> => {
    const { metodo = 'GET', cuerpo, reintento = true } = opciones;
    const headers: Record<string, string> = { 'X-Kontiva': '1', ...opciones.encabezados };
    if (cuerpo !== undefined) headers['Content-Type'] = 'application/json';
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const corte = opciones.tiempo ? new AbortController() : null;
    const reloj = corte ? setTimeout(() => corte.abort(), opciones.tiempo) : null;
    let r: Response;
    try {
      r = await fetch(`${base}${ruta}`, {
        method: metodo,
        headers,
        credentials: 'same-origin',
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        signal: corte?.signal,
      });
    } finally {
      if (reloj) clearTimeout(reloj);
    }
    if (r.status === 401 && reintento && !SIN_REINTENTO.some((p) => ruta.startsWith(p))) {
      if (await renovarSesion()) return api<T>(ruta, { ...opciones, reintento: false });
      alExpirar?.();
    }
    if (!r.ok) throw await leerError(r);
    if (r.status === 204) return undefined as T;
    return (await r.json()) as T;
  };

  /** Descarga un archivo (PDF, XML) con la sesión; devuelve el contenido como Blob. */
  const archivo = async (ruta: string, reintento = true): Promise<Blob> => {
    const headers: Record<string, string> = { 'X-Kontiva': '1' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const r = await fetch(`${base}${ruta}`, { headers, credentials: 'same-origin' });
    if (r.status === 401 && reintento) {
      if (await renovarSesion()) return archivo(ruta, false);
      alExpirar?.();
    }
    if (!r.ok) throw await leerError(r);
    return r.blob();
  };

  return {
    api,
    archivo,
    renovarSesion,
    fijarToken: (t) => (accessToken = t),
    alPerderSesion: (fn) => (alExpirar = fn),
  };
}

const empresas = crearCliente('/api');
export const api = empresas.api;
export const archivo = empresas.archivo;
export const renovarSesion = empresas.renovarSesion;
export const fijarToken = empresas.fijarToken;
export const alPerderSesion = empresas.alPerderSesion;

/** Tipos de respuesta usados por la interfaz. */
export type Alcance = 'propia' | 'sucursal' | 'empresa';

export interface Yo {
  usuario: { id: string; nombre: string; email: string; perfil: { id: string; nombre: string }; esPropietario: boolean; tienePin: boolean; idioma: 'es' | 'pt' };
  empresa: { id: string; nombre: string; razonSocial: string; ruc: string | null; rubro: string; plan: string };
  sucursales: { id: string; codigo: string; nombre: string }[];
  permisos: Record<string, Alcance>;
  empresas: { id: string; nombre: string }[];
}

export interface UsuarioFila {
  id: string;
  nombre: string;
  email: string;
  activo: boolean;
  invitacionPendiente: boolean;
  esPropietario: boolean;
  tienePin: boolean;
  perfil: { id: string; nombre: string };
  sucursalIds: string[];
  permisosIndividuales: { permiso: string; tipo: 'conceder' | 'denegar'; alcance: Alcance }[];
  creadoEn: string;
}

export interface PerfilFila {
  id: string;
  clave: string | null;
  nombre: string;
  descripcion: string | null;
  alcance: Alcance;
  esPropietario: boolean;
  sistema: boolean;
  usuarios: number;
  permisos: string[];
}

export interface SucursalFila {
  id: string;
  codigo: string;
  nombre: string;
  direccion: string | null;
  telefono: string | null;
  activa: boolean;
}

export interface EmpresaDatos {
  id: string;
  razonSocial: string;
  nombreFantasia: string | null;
  ruc: string | null;
  rubro: string;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  permiteStockNegativo: boolean;
  valeDias: number;
  balanza: ConfigBalanza;
  plan: { codigo: string; limites: { usuarios: number | null; sucursales: number | null; cajas: number | null }; uso: { usuarios: number; sucursales: number } };
}

export interface Catalogo {
  recursos: { clave: string; nombre: string; modulo: string; confidencial: boolean; acciones: string[] }[];
  permisos: { codigo: string; recurso: string; accion: string; nombre: string; modulo: string }[];
}

export interface EventoAuditoria {
  id: number;
  fecha: string;
  accion: string;
  entidad: string;
  entidadId: string | null;
  usuario: { id: string; nombre: string } | null;
  autorizadoPor: { id: string; nombre: string } | null;
  antes: unknown;
  despues: unknown;
  ip: string | null;
  agente: string | null;
}

export interface SesionFila {
  id: string;
  empresa: string | null;
  ip: string | null;
  agente: string | null;
  creadoEn: string;
  ultimoUsoEn: string;
  actual: boolean;
}
