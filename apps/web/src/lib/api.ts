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

let accessToken: string | null = null;
let renovando: Promise<boolean> | null = null;
let alExpirar: (() => void) | null = null;

export function fijarToken(t: string | null) {
  accessToken = t;
}
export function alPerderSesion(fn: () => void) {
  alExpirar = fn;
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

export async function renovarSesion(): Promise<boolean> {
  renovando ??= (async () => {
    try {
      const r = await fetch('/api/auth/renovar', { method: 'POST', credentials: 'same-origin', headers: { 'X-Kontiva': '1' } });
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
}

export async function api<T = unknown>(ruta: string, opciones: { metodo?: string; cuerpo?: unknown; reintento?: boolean } = {}): Promise<T> {
  const { metodo = 'GET', cuerpo, reintento = true } = opciones;
  const headers: Record<string, string> = { 'X-Kontiva': '1' };
  if (cuerpo !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const r = await fetch(`/api${ruta}`, {
    method: metodo,
    headers,
    credentials: 'same-origin',
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });

  if (r.status === 401 && reintento && !ruta.startsWith('/auth/login')) {
    if (await renovarSesion()) return api<T>(ruta, { ...opciones, reintento: false });
    alExpirar?.();
  }
  if (!r.ok) throw await leerError(r);
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

/** Tipos de respuesta usados por la interfaz. */
export type Alcance = 'propia' | 'sucursal' | 'empresa';

export interface Yo {
  usuario: { id: string; nombre: string; email: string; perfil: { id: string; nombre: string }; esPropietario: boolean; tienePin: boolean };
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
