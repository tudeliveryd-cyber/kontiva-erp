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
  categoria: CategoriaTabla;
  marca: MarcaTabla;
  producto: ProductoTabla;
  variante: VarianteTabla;
  codigo_barras: CodigoBarrasTabla;
  lista_precio: ListaPrecioTabla;
  precio: PrecioTabla;
  deposito: DepositoTabla;
  stock: StockTabla;
  movimiento_stock: MovimientoStockTabla;
  cliente: ClienteTabla;
  cotizacion: CotizacionTabla;
  caja: CajaTabla;
  sesion_caja: SesionCajaTabla;
  movimiento_caja: MovimientoCajaTabla;
  arqueo: ArqueoTabla;
  venta: VentaTabla;
  venta_item: VentaItemTabla;
  venta_pago: VentaPagoTabla;
  transferencia: TransferenciaTabla;
  transferencia_item: TransferenciaItemTabla;
  devolucion: DevolucionTabla;
  devolucion_item: DevolucionItemTabla;
  pedido: PedidoTabla;
  pedido_item: PedidoItemTabla;
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

// ---------------------------------------------------------------------------
// Fase 1 · operación central. numeric llega como string (exacto); se calcula con Decimal.
// ---------------------------------------------------------------------------

type Num = ColumnType<string, string | number, string | number>;
type NumGen = ColumnType<string, string | number | undefined, string | number>;
export type Moneda = 'PYG' | 'USD' | 'BRL';
export type Medio = 'efectivo' | 'tarjeta' | 'transferencia' | 'otro';

export interface CategoriaTabla { empresa_id: string; id: Generated<string>; nombre: string; activa: Generated<boolean>; creado_en: Creado }
export interface MarcaTabla { empresa_id: string; id: Generated<string>; nombre: string; creado_en: Creado }

export interface ProductoTabla {
  empresa_id: string;
  id: Generated<string>;
  nombre: string;
  descripcion: string | null;
  categoria_id: string | null;
  marca_id: string | null;
  tipo: Generated<'producto' | 'servicio'>;
  unidad: Generated<string>;
  tasa_iva: NumGen;
  controla_stock: Generated<boolean>;
  activo: Generated<boolean>;
  creado_en: Creado;
  creado_por: string | null;
  actualizado_en: Actualizado;
}

export interface VarianteTabla {
  empresa_id: string;
  id: Generated<string>;
  producto_id: string;
  nombre: string | null;
  sku: string | null;
  costo: NumGen;
  activa: Generated<boolean>;
  creado_en: Creado;
  actualizado_en: Actualizado;
}

export interface CodigoBarrasTabla { empresa_id: string; codigo: string; variante_id: string }
export interface ListaPrecioTabla { empresa_id: string; id: Generated<string>; nombre: string; predeterminada: Generated<boolean>; activa: Generated<boolean>; creado_en: Creado }
export interface PrecioTabla { empresa_id: string; lista_id: string; variante_id: string; sucursal_id: string | null; precio: Num; actualizado_en: Generated<Date> }
export interface DepositoTabla { empresa_id: string; id: Generated<string>; sucursal_id: string; nombre: string; activo: Generated<boolean>; creado_en: Creado }
export interface StockTabla { empresa_id: string; variante_id: string; deposito_id: string; cantidad: NumGen; actualizado_en: Generated<Date> }

export interface MovimientoStockTabla {
  empresa_id: string;
  id: Generated<string>;
  variante_id: string;
  deposito_id: string;
  tipo: TipoMovimientoStock;
  cantidad: Num;
  saldo: Num;
  costo_unitario: Num | null;
  origen_id: string | null;
  motivo: string | null;
  creado_por: string | null;
  creado_en: Creado;
}

export interface ClienteTabla {
  empresa_id: string;
  id: Generated<string>;
  nombre: string;
  documento: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  lista_precio_id: string | null;
  activo: Generated<boolean>;
  creado_en: Creado;
  creado_por: string | null;
  actualizado_en: Actualizado;
}

export interface CotizacionTabla {
  empresa_id: string;
  id: Generated<string>;
  sucursal_id: string;
  moneda: 'USD' | 'BRL';
  compra: Num;
  venta: Num;
  creado_por: string | null;
  creado_en: Creado;
}

export interface CajaTabla {
  empresa_id: string;
  id: Generated<string>;
  sucursal_id: string;
  deposito_id: string;
  nombre: string;
  ultimo_numero: ColumnType<string, number | undefined, number | string>;
  activa: Generated<boolean>;
  creado_en: Creado;
}

export interface SesionCajaTabla {
  empresa_id: string;
  id: Generated<string>;
  caja_id: string;
  usuario_id: string;
  estado: Generated<'abierta' | 'cerrada'>;
  abierta_en: Generated<Date>;
  cerrada_en: Date | null;
  cerrada_por: string | null;
}

export interface MovimientoCajaTabla {
  empresa_id: string;
  id: Generated<string>;
  sesion_id: string;
  tipo: 'apertura' | 'venta' | 'vuelto' | 'anulacion' | 'devolucion' | 'retiro' | 'ingreso';
  medio: Medio;
  moneda: Moneda;
  monto: Num;
  venta_id: string | null;
  motivo: string | null;
  autorizado_por: string | null;
  creado_por: string;
  creado_en: Creado;
}

export interface ArqueoTabla {
  empresa_id: string;
  sesion_id: string;
  moneda: Moneda;
  medio: Medio;
  esperado: Num;
  contado: Num;
  diferencia: ColumnType<string, never, never>;
}

export interface VentaTabla {
  empresa_id: string;
  id: Generated<string>;
  sucursal_id: string;
  caja_id: string;
  sesion_caja_id: string;
  numero: ColumnType<string, number | string, never>;
  clave_idempotencia: string;
  cliente_id: string | null;
  lista_precio_id: string | null;
  pedido_id: string | null;
  estado: Generated<'confirmada' | 'anulada'>;
  comprobante: Generated<'interno'>;
  subtotal: Num;
  descuento: NumGen;
  total: Num;
  gravado10: NumGen;
  gravado5: NumGen;
  exento: NumGen;
  iva10: NumGen;
  iva5: NumGen;
  vuelto: NumGen;
  vuelto_moneda: Generated<Moneda>;
  autorizado_por: string | null;
  creado_por: string;
  creado_en: Creado;
  anulada_en: Date | null;
  anulada_por: string | null;
  anulacion_autorizada_por: string | null;
  motivo_anulacion: string | null;
}

export interface VentaItemTabla {
  empresa_id: string;
  venta_id: string;
  linea: number;
  variante_id: string;
  descripcion: string;
  cantidad: Num;
  precio_unitario: Num;
  descuento: NumGen;
  total: Num;
  tasa_iva: Num;
  costo_unitario: NumGen;
}

export interface VentaPagoTabla {
  empresa_id: string;
  venta_id: string;
  linea: number;
  medio: Medio;
  moneda: Moneda;
  monto: Num;
  cotizacion: NumGen;
  monto_pyg: Num;
  referencia: string | null;
}

export type TipoMovimientoStock = 'inicial' | 'ajuste' | 'venta' | 'anulacion_venta' | 'devolucion' | 'compra' | 'transferencia_salida' | 'transferencia_entrada' | 'transferencia';

export interface TransferenciaTabla {
  empresa_id: string;
  id: Generated<string>;
  numero: ColumnType<string, number, never>;
  origen_id: string;
  destino_id: string;
  estado: 'en_transito' | 'recibida' | 'cancelada';
  nota: string | null;
  creado_por: string;
  creado_en: Creado;
  recibida_por: string | null;
  recibida_en: Date | null;
  cancelada_por: string | null;
  cancelada_en: Date | null;
  motivo_cancelacion: string | null;
}

export interface TransferenciaItemTabla {
  empresa_id: string;
  transferencia_id: string;
  linea: number;
  variante_id: string;
  cantidad: Num;
  cantidad_recibida: Num | null;
}

export interface DevolucionTabla {
  empresa_id: string;
  id: Generated<string>;
  numero: ColumnType<string, number, never>;
  venta_id: string;
  sesion_caja_id: string;
  deposito_id: string;
  medio: Medio;
  total: Num;
  motivo: string;
  autorizado_por: string | null;
  creado_por: string;
  creado_en: Creado;
}

export interface DevolucionItemTabla {
  empresa_id: string;
  devolucion_id: string;
  linea_venta: number;
  variante_id: string;
  cantidad: Num;
  total: Num;
}

export type TipoPedido = 'presupuesto' | 'pedido';
export type EstadoPedido = 'vigente' | 'aceptado' | 'rechazado' | 'anulado' | 'pendiente' | 'preparado' | 'entregado' | 'cancelado';

export interface PedidoTabla {
  empresa_id: string;
  id: Generated<string>;
  tipo: TipoPedido;
  numero: ColumnType<string, number, never>;
  sucursal_id: string;
  cliente_id: string | null;
  cliente_nombre: string | null;
  lista_precio_id: string | null;
  estado: EstadoPedido;
  valido_hasta: ColumnType<string | null, string | null | undefined, string | null>;
  entrega_prevista: ColumnType<string | null, string | null | undefined, string | null>;
  nota: string | null;
  subtotal: NumGen;
  descuento: NumGen;
  total: NumGen;
  origen_id: string | null;
  venta_id: string | null;
  autorizado_por: string | null;
  motivo_cierre: string | null;
  cerrado_por: string | null;
  cerrado_en: Date | null;
  creado_por: string;
  creado_en: Creado;
  actualizado_en: Actualizado;
}

export interface PedidoItemTabla {
  empresa_id: string;
  pedido_id: string;
  linea: number;
  variante_id: string;
  descripcion: string;
  cantidad: Num;
  precio_unitario: Num;
  descuento: NumGen;
  total: Num;
  tasa_iva: number;
}
