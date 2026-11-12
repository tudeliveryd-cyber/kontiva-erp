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
  exige_2fa_propietario: Generated<boolean>;
  precio_mensual: string | null;
  precio_anual: string | null;
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
  totp_activo: Generated<boolean>;
  totp_pendiente: string | null;
  totp_ultimo_paso: Paso;
  creado_en: Creado;
  actualizado_en: Actualizado;
}

/** int8: se lee como string (sin pérdida de precisión). */
type Paso = ColumnType<string | null, number | null | undefined, number | null>;

export interface CodigoRespaldoTabla {
  id: Generated<string>;
  cuenta_id: string;
  hash: string;
  usado_en: Date | null;
  creado_en: Creado;
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
  codigo_respaldo: CodigoRespaldoTabla;
  'master.usuario': MasterUsuarioTabla;
  'master.sesion': MasterSesionTabla;
  'master.suscripcion': MasterSuscripcionTabla;
  'master.pago': MasterPagoTabla;
  'master.auditoria': MasterAuditoriaTabla;
}

// ---------------------------------------------------------------------------
// Esquema master (solo accesible con el rol kontiva_master)
// ---------------------------------------------------------------------------

export interface MasterUsuarioTabla {
  id: Generated<string>;
  email: string;
  nombre: string;
  hash_contrasena: string;
  totp_secreto: string | null;
  totp_pendiente: string | null;
  totp_activo: Generated<boolean>;
  totp_ultimo_paso: Paso;
  intentos_fallidos: Generated<number>;
  bloqueada_hasta: Date | null;
  activo: Generated<boolean>;
  creado_en: Creado;
  actualizado_en: Actualizado;
}

export interface MasterSesionTabla {
  id: Generated<string>;
  usuario_id: string;
  hash_token: string;
  hash_token_anterior: string | null;
  ip: string | null;
  agente: string | null;
  creado_en: Creado;
  ultimo_uso_en: Generated<Date>;
  expira_en: Date;
  revocada_en: Date | null;
}

export interface MasterSuscripcionTabla {
  empresa_id: string;
  ciclo: Generated<'mensual' | 'anual'>;
  precio: Generated<string>;
  moneda: Generated<'PYG' | 'USD' | 'BRL'>;
  vence_en: string;
  dias_gracia: Generated<number>;
  suspension_automatica: Generated<boolean>;
  motivo_suspension: 'falta_pago' | 'manual' | null;
  notas: string | null;
  creado_en: Creado;
  actualizado_en: Actualizado;
}

export interface MasterPagoTabla {
  id: Generated<string>;
  empresa_id: string;
  monto: string;
  moneda: 'PYG' | 'USD' | 'BRL';
  fecha: ColumnType<string, string, never>;
  periodo_desde: ColumnType<string, string, never>;
  periodo_hasta: ColumnType<string, string, never>;
  metodo: 'transferencia' | 'efectivo' | 'tarjeta' | 'otro';
  referencia: string | null;
  registrado_por: string;
  anulado_en: Date | null;
  anulado_por: string | null;
  motivo_anulacion: string | null;
  creado_en: Creado;
}

export interface MasterAuditoriaTabla {
  id: Generated<string>;
  usuario_id: string | null;
  accion: string;
  entidad: string;
  entidad_id: string | null;
  antes: Json | null;
  despues: Json | null;
  ip: string | null;
  agente: string | null;
  creado_en: Creado;
}

export type Usuario = Selectable<UsuarioTabla>;
export type Perfil = Selectable<PerfilTabla>;
export type Sucursal = Selectable<SucursalTabla>;
export type Empresa = Selectable<EmpresaTabla>;
export type Cuenta = Selectable<CuentaTabla>;
export type NuevaAuditoria = Insertable<AuditoriaTabla>;
export type CambioEmpresa = Updateable<EmpresaTabla>;
