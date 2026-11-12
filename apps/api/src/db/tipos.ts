import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

/** Tipos de las tablas de la base (ver migrations/). */

type Creado = ColumnType<Date, Date | undefined, never>;
type Actualizado = ColumnType<Date, never, Date | undefined>;
type Json<T = unknown> = ColumnType<T, string, string>;

export type Alcance = 'propia' | 'sucursal' | 'empresa';

export interface PlanTabla {
  id: Generated<string>;
  codigo: string;
  nombre: string;
  max_usuarios: number | null;
  max_sucursales: number | null;
  max_cajas: number | null;
  modulos: Json<string[]>;
  activo: Generated<boolean>;
  creado_en: Creado;
  actualizado_en: Actualizado;
}

export interface PermisoTabla {
  codigo: string;
  recurso: string;
  accion: string;
  nombre: string;
  modulo: string;
  vigente: Generated<boolean>;
}

export interface EmpresaTabla {
  id: Generated<string>;
  razon_social: string;
  nombre_fantasia: string | null;
  ruc: string | null;
  rubro: Generated<string>;
  plan_id: string;
  estado: Generated<'activa' | 'suspendida'>;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  moneda_base: Generated<string>;
  zona_horaria: Generated<string>;
  configuracion: Generated<Json<Record<string, unknown>>>;
  creado_en: Creado;
  actualizado_en: Actualizado;
}

export interface SucursalTabla {
  empresa_id: string;
  id: Generated<string>;
  codigo: string;
  nombre: string;
  direccion: string | null;
  telefono: string | null;
  activa: Generated<boolean>;
  creado_en: Creado;
  creado_por: string | null;
  actualizado_en: Actualizado;
}

export interface CuentaTabla {
  id: Generated<string>;
  email: string;
  nombre: string;
  hash_contrasena: string | null;
  intentos_fallidos: Generated<number>;
  bloqueada_hasta: Date | null;
  totp_secreto: string | null;
  creado_en: Creado;
  actualizado_en: Actualizado;
}

export interface PerfilTabla {
  empresa_id: string;
  id: Generated<string>;
  clave: string | null;
  nombre: string;
  descripcion: string | null;
  alcance: Alcance;
  es_propietario: Generated<boolean>;
  sistema: Generated<boolean>;
  creado_en: Creado;
  creado_por: string | null;
  actualizado_en: Actualizado;
}

export interface PerfilPermisoTabla {
  empresa_id: string;
  perfil_id: string;
  permiso: string;
}

export interface UsuarioTabla {
  empresa_id: string;
  id: Generated<string>;
  cuenta_id: string;
  perfil_id: string;
  nombre: string;
  activo: Generated<boolean>;
  hash_pin: string | null;
  intentos_pin: Generated<number>;
  pin_bloqueado_hasta: Date | null;
  creado_en: Creado;
  creado_por: string | null;
  actualizado_en: Actualizado;
}

export interface UsuarioPermisoTabla {
  empresa_id: string;
  usuario_id: string;
  permiso: string;
  tipo: 'conceder' | 'denegar';
  alcance: Alcance;
}

export interface UsuarioSucursalTabla {
  empresa_id: string;
  usuario_id: string;
  sucursal_id: string;
}

export interface SesionTabla {
  id: Generated<string>;
  cuenta_id: string;
  empresa_id: string;
  usuario_id: string;
  hash_token: string;
  hash_token_anterior: string | null;
  ip: string | null;
  agente: string | null;
  creado_en: Creado;
  ultimo_uso_en: Generated<Date>;
  expira_en: Date;
  revocada_en: Date | null;
  motivo_revocacion: string | null;
}

export interface TokenCuentaTabla {
  id: Generated<string>;
  cuenta_id: string;
  tipo: 'recuperacion' | 'invitacion';
  hash_token: string;
  expira_en: Date;
  usado_en: Date | null;
  creado_en: Creado;
}

export interface IntentoAccesoTabla {
  id: Generated<string>;
  email: string | null;
  cuenta_id: string | null;
  exito: boolean;
  motivo: string;
  ip: string | null;
  agente: string | null;
  creado_en: Creado;
}

export interface AuditoriaTabla {
  id: Generated<string>;
  empresa_id: string;
  usuario_id: string | null;
  cuenta_id: string | null;
  autorizado_por: string | null;
  accion: string;
  entidad: string;
  entidad_id: string | null;
  antes: Json | null;
  despues: Json | null;
  ip: string | null;
  agente: string | null;
  creado_en: Creado;
}

export interface BaseDatos {
  plan: PlanTabla;
  permiso: PermisoTabla;
  empresa: EmpresaTabla;
  sucursal: SucursalTabla;
  cuenta: CuentaTabla;
  perfil: PerfilTabla;
  perfil_permiso: PerfilPermisoTabla;
  usuario: UsuarioTabla;
  usuario_permiso: UsuarioPermisoTabla;
  usuario_sucursal: UsuarioSucursalTabla;
  sesion: SesionTabla;
  token_cuenta: TokenCuentaTabla;
  intento_acceso: IntentoAccesoTabla;
  auditoria: AuditoriaTabla;
}

export type Usuario = Selectable<UsuarioTabla>;
export type Perfil = Selectable<PerfilTabla>;
export type Sucursal = Selectable<SucursalTabla>;
export type Empresa = Selectable<EmpresaTabla>;
export type Cuenta = Selectable<CuentaTabla>;
export type NuevaAuditoria = Insertable<AuditoriaTabla>;
export type CambioEmpresa = Updateable<EmpresaTabla>;
