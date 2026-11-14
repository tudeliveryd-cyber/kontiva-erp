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
  fe_numero_casa: string | null;
  fe_departamento: number | null;
  fe_distrito: number | null;
  fe_ciudad: number | null;
  fe_email: string | null;
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
  idioma: Generated<'es' | 'pt'>;
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
  vale: ValeTabla;
  vale_movimiento: ValeMovimientoTabla;
  codigo_barras: CodigoBarrasTabla;
  lista_precio: ListaPrecioTabla;
  precio: PrecioTabla;
  deposito: DepositoTabla;
  stock: StockTabla;
  movimiento_stock: MovimientoStockTabla;
  cliente: ClienteTabla;
  ruta: RutaTabla;
  reparto: RepartoTabla;
  reparto_pedido: RepartoPedidoTabla;
  presentacion: PresentacionTabla;
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
  fe_configuracion: FeConfiguracionTabla;
  fe_numeracion: FeNumeracionTabla;
  documento_electronico: DocumentoElectronicoTabla;
  proveedor: ProveedorTabla;
  orden_compra: OrdenCompraTabla;
  orden_compra_item: OrdenCompraItemTabla;
  compra: CompraTabla;
  compra_item: CompraItemTabla;
  cuenta_pagar: CuentaPagarTabla;
  pago_proveedor: PagoProveedorTabla;
  pago_aplicacion: PagoAplicacionTabla;
  cuenta_cobrar: CuentaCobrarTabla;
  cobro_cliente: CobroClienteTabla;
  cobro_aplicacion: CobroAplicacionTabla;
  cuenta_bancaria: CuentaBancariaTabla;
  movimiento_bancario: MovimientoBancarioTabla;
  cuenta_contable: CuentaContableTabla;
  cuenta_concepto: CuentaConceptoTabla;
  asiento: AsientoTabla;
  asiento_linea: AsientoLineaTabla;
  cierre_contable: CierreContableTabla;
  rrhh_configuracion: RrhhConfiguracionTabla;
  funcionario: FuncionarioTabla;
  liquidacion: LiquidacionTabla;
  liquidacion_item: LiquidacionItemTabla;
  novedad: NovedadTabla;
  receta_produccion: RecetaProduccionTabla;
  receta_produccion_insumo: RecetaProduccionInsumoTabla;
  orden_produccion: OrdenProduccionTabla;
  orden_produccion_insumo: OrdenProduccionInsumoTabla;
  salon: SalonTabla;
  mesa: MesaTabla;
  cuenta_salon: CuentaSalonTabla;
  comanda: ComandaTabla;
  cuenta_salon_item: CuentaSalonItemTabla;
  receta: RecetaTabla;
  lote: LoteTabla;
  stock_lote: StockLoteTabla;
  movimiento_lote: MovimientoLoteTabla;
  marcacion: MarcacionTabla;
  vacacion: VacacionTabla;
  liquidacion_final: LiquidacionFinalTabla;
  liquidacion_concepto: LiquidacionConceptoTabla;
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
  controla_lote: Generated<boolean>;
  principio_activo: string | null;
  concentracion: string | null;
  forma: string | null;
  registro_sanitario: string | null;
  condicion_venta: Generated<'libre' | 'receta' | 'receta_archivada'>;
  estacion: 'cocina' | 'bar' | null;
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
  talle: string | null;
  color: string | null;
  costo: NumGen;
  stock_minimo: NumGen;
  activa: Generated<boolean>;
  creado_en: Creado;
  actualizado_en: Actualizado;
}

export interface CodigoBarrasTabla { empresa_id: string; codigo: string; variante_id: string; presentacion_id: string | null }
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
  ruta_id: string | null;
  orden_ruta: number | null;
  limite_credito: NumGen;
  plazo_credito_dias: Generated<number>;
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
  punto_expedicion: string | null;
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
  tipo: 'apertura' | 'venta' | 'vuelto' | 'anulacion' | 'devolucion' | 'retiro' | 'ingreso' | 'pago_proveedor' | 'cobro';
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
  cuenta_salon_id: Generated<string | null>;
  credito: NumGen;
  estado: Generated<'confirmada' | 'anulada'>;
  comprobante: Generated<'interno' | 'factura'>;
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
  registrada_offline_en: Generated<Date | null>;
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
  presentacion: string | null;
  condicion_venta: Generated<'receta' | 'receta_archivada' | null>;
}

export interface VentaPagoTabla {
  empresa_id: string;
  venta_id: string;
  linea: number;
  medio: Medio | 'vale';
  moneda: Moneda;
  monto: Num;
  cotizacion: NumGen;
  monto_pyg: Num;
  referencia: string | null;
}

export type TipoMovimientoStock = 'inicial' | 'ajuste' | 'venta' | 'anulacion_venta' | 'devolucion' | 'compra' | 'anulacion_compra' | 'transferencia_salida' | 'transferencia_entrada' | 'transferencia' | 'produccion_consumo' | 'produccion' | 'anulacion_produccion' | 'merma';

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
  medio: Medio | 'vale';
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

export interface FeConfiguracionTabla {
  empresa_id: string;
  activa: Generated<boolean>;
  ambiente: Generated<'test' | 'produccion'>;
  tipo_contribuyente: Generated<number>;
  tipo_regimen: number | null;
  actividad_codigo: string | null;
  actividad_descripcion: string | null;
  timbrado_numero: string | null;
  timbrado_fecha: ColumnType<string | null, string | null | undefined, string | null>;
  csc_id: string | null;
  csc_cifrado: string | null;
  certificado_cifrado: string | null;
  certificado_clave: string | null;
  certificado_titular: string | null;
  certificado_ruc: string | null;
  certificado_vence: Date | null;
  envio_correo: Generated<boolean>;
  actualizado_por: string | null;
  actualizado_en: Actualizado;
}

export interface FeNumeracionTabla {
  empresa_id: string;
  establecimiento: string;
  punto: string;
  tipo_documento: number;
  timbrado: string;
  ultimo: Generated<number>;
}

export type EstadoDocumentoElectronico = 'pendiente' | 'enviado' | 'aprobado' | 'aprobado_obs' | 'rechazado' | 'cancelado' | 'inutilizado';

export interface DocumentoElectronicoTabla {
  empresa_id: string;
  id: Generated<string>;
  tipo_documento: number;
  cdc: string;
  ambiente: 'test' | 'produccion';
  timbrado: string;
  establecimiento: string;
  punto: string;
  numero: number;
  fecha_emision: Date;
  sucursal_id: string;
  venta_id: string | null;
  devolucion_id: string | null;
  documento_asociado_id: string | null;
  receptor_nombre: string;
  receptor_documento: string | null;
  total: Num;
  total_iva: Num;
  estado: Generated<EstadoDocumentoElectronico>;
  xml_firmado: string;
  qr_url: string;
  lote_protocolo: string | null;
  enviado_en: Date | null;
  intentos: Generated<number>;
  proximo_intento: Generated<Date>;
  respuesta_codigo: string | null;
  respuesta_mensaje: string | null;
  protocolo_autorizacion: string | null;
  procesado_en: Date | null;
  cancelado_en: Date | null;
  correo_enviado_a: string | null;
  correo_enviado_en: Date | null;
  correo_intentos: Generated<number>;
  correo_error: string | null;
  cancelado_por: string | null;
  motivo_cancelacion: string | null;
  creado_por: string;
  creado_en: Creado;
}

type Fecha = ColumnType<string, string, string>;
type FechaNula = ColumnType<string | null, string | null | undefined, string | null>;

export interface ProveedorTabla {
  empresa_id: string;
  id: Generated<string>;
  nombre: string;
  ruc: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  contacto: string | null;
  plazo_pago_dias: Generated<number>;
  nota: string | null;
  activo: Generated<boolean>;
  creado_por: string | null;
  creado_en: Creado;
  actualizado_en: Actualizado;
}

export type EstadoOrdenCompra = 'borrador' | 'enviada' | 'parcial' | 'recibida' | 'cancelada';

export interface OrdenCompraTabla {
  empresa_id: string;
  id: Generated<string>;
  numero: ColumnType<string, number, never>;
  proveedor_id: string;
  sucursal_id: string;
  deposito_id: string;
  estado: Generated<EstadoOrdenCompra>;
  fecha_entrega: FechaNula;
  nota: string | null;
  total: NumGen;
  aprobada_por: string | null;
  aprobada_en: Date | null;
  motivo_cancelacion: string | null;
  creado_por: string;
  creado_en: Creado;
  actualizado_en: Actualizado;
}

export interface OrdenCompraItemTabla {
  empresa_id: string;
  orden_id: string;
  linea: number;
  variante_id: string;
  descripcion: string;
  cantidad: Num;
  cantidad_recibida: NumGen;
  costo_unitario: Num;
  tasa_iva: number;
  total: Num;
}

export interface CompraTabla {
  empresa_id: string;
  id: Generated<string>;
  numero: ColumnType<string, number, never>;
  proveedor_id: string;
  orden_id: string | null;
  sucursal_id: string;
  deposito_id: string;
  documento_tipo: 'factura' | 'factura_electronica' | 'remision' | 'otro';
  timbrado: string | null;
  documento_numero: string | null;
  cdc: string | null;
  fecha_documento: Fecha;
  condicion: 'contado' | 'credito';
  vencimiento: FechaNula;
  subtotal: Num;
  descuento: NumGen;
  total: Num;
  gravado10: NumGen;
  gravado5: NumGen;
  exento: NumGen;
  iva10: NumGen;
  iva5: NumGen;
  estado: Generated<'confirmada' | 'anulada'>;
  nota: string | null;
  creado_por: string;
  creado_en: Creado;
  anulada_por: string | null;
  anulada_en: Date | null;
  motivo_anulacion: string | null;
}

export interface CompraItemTabla {
  empresa_id: string;
  compra_id: string;
  linea: number;
  variante_id: string;
  descripcion: string;
  cantidad: Num;
  costo_unitario: Num;
  descuento: NumGen;
  tasa_iva: number;
  total: Num;
  orden_linea: number | null;
  presentacion: string | null;
  lote_codigo: string | null;
  lote_vencimiento: FechaNula;
}

export interface CuentaPagarTabla {
  empresa_id: string;
  id: Generated<string>;
  proveedor_id: string;
  compra_id: string | null;
  descripcion: string;
  fecha: Fecha;
  vencimiento: Fecha;
  monto: Num;
  saldo: Num;
  estado: Generated<'pendiente' | 'parcial' | 'pagada' | 'anulada'>;
  creado_por: string;
  creado_en: Creado;
}

export interface PagoProveedorTabla {
  empresa_id: string;
  id: Generated<string>;
  numero: ColumnType<string, number, never>;
  proveedor_id: string;
  fecha: Fecha;
  medio: 'efectivo' | 'transferencia' | 'cheque' | 'tarjeta' | 'otro';
  sesion_caja_id: string | null;
  cuenta_bancaria_id: Generated<string | null>;
  monto: Num;
  referencia: string | null;
  nota: string | null;
  estado: Generated<'confirmado' | 'anulado'>;
  creado_por: string;
  creado_en: Creado;
  anulado_por: string | null;
  anulado_en: Date | null;
}

export interface PagoAplicacionTabla {
  empresa_id: string;
  pago_id: string;
  cuenta_pagar_id: string;
  monto: Num;
}

export interface CuentaCobrarTabla {
  empresa_id: string;
  id: Generated<string>;
  cliente_id: string;
  venta_id: string | null;
  sucursal_id: string;
  descripcion: string;
  fecha: Fecha;
  vencimiento: Fecha;
  monto: Num;
  saldo: Num;
  estado: Generated<'pendiente' | 'parcial' | 'cobrada' | 'anulada'>;
  autorizado_por: string | null;
  creado_por: string;
  creado_en: Creado;
}

export interface CobroClienteTabla {
  empresa_id: string;
  id: Generated<string>;
  numero: ColumnType<string, number, never>;
  cliente_id: string;
  fecha: Fecha;
  medio: 'efectivo' | 'tarjeta' | 'transferencia' | 'cheque' | 'otro';
  sesion_caja_id: string | null;
  cuenta_bancaria_id: Generated<string | null>;
  monto: Num;
  referencia: string | null;
  nota: string | null;
  estado: Generated<'confirmado' | 'anulado'>;
  creado_por: string;
  creado_en: Creado;
  anulado_por: string | null;
  anulado_en: Date | null;
}

export interface CobroAplicacionTabla {
  empresa_id: string;
  cobro_id: string | null;
  devolucion_id: string | null;
  cuenta_cobrar_id: string;
  monto: Num;
  creado_en: Creado;
}

export interface CuentaBancariaTabla {
  empresa_id: string;
  id: Generated<string>;
  banco: string;
  nombre: string;
  numero: string | null;
  moneda: Generated<'PYG'>;
  saldo_inicial: NumGen;
  fecha_saldo_inicial: Fecha;
  activa: Generated<boolean>;
  cuenta_contable_id: Generated<string | null>;
  creado_por: string | null;
  creado_en: Creado;
}

export type TipoMovimientoBancario = 'deposito' | 'extraccion' | 'transferencia_entrada' | 'transferencia_salida' | 'pago_proveedor' | 'cobro' | 'deposito_caja' | 'gasto' | 'ingreso' | 'anulacion' | 'sueldos';

export interface MovimientoBancarioTabla {
  empresa_id: string;
  id: Generated<string>;
  cuenta_id: string;
  fecha: Fecha;
  tipo: TipoMovimientoBancario;
  descripcion: string;
  monto: Num;
  referencia: string | null;
  origen_tipo: string | null;
  origen_id: string | null;
  conciliado: Generated<boolean>;
  conciliado_en: Date | null;
  conciliado_por: string | null;
  creado_por: string;
  creado_en: Creado;
}

export type TipoCuentaContable = 'activo' | 'pasivo' | 'patrimonio' | 'ingreso' | 'gasto';
export interface CuentaContableTabla {
  empresa_id: string;
  id: Generated<string>;
  codigo: string;
  nombre: string;
  tipo: TipoCuentaContable;
  imputable: boolean;
  padre_id: string | null;
  activa: Generated<boolean>;
  creado_en: Creado;
}
export interface CuentaConceptoTabla {
  empresa_id: string;
  concepto: string;
  cuenta_id: string;
}
export interface AsientoTabla {
  empresa_id: string;
  id: Generated<string>;
  numero: number;
  fecha: Fecha;
  descripcion: string;
  origen_tipo: string;
  origen_id: string | null;
  estado: Generated<'confirmado' | 'anulado'>;
  anulado_por: string | null;
  anulado_en: Date | null;
  motivo_anulacion: string | null;
  creado_por: string;
  creado_en: Creado;
}
export interface AsientoLineaTabla {
  empresa_id: string;
  asiento_id: string;
  linea: number;
  cuenta_id: string;
  debe: Num;
  haber: Num;
  detalle: string | null;
}
export interface CierreContableTabla {
  empresa_id: string;
  id: Generated<string>;
  accion: 'cierre' | 'reapertura';
  hasta: string | null;
  motivo: string | null;
  usuario_id: string;
  creado_en: Creado;
}

export interface RrhhConfiguracionTabla {
  empresa_id: string;
  salario_minimo: Num;
  ips_obrero: Num;
  ips_patronal: Num;
  bonificacion_pct: Num;
  bonificacion_tope: Num;
  actualizado_por: string | null;
  actualizado_en: Generated<Date>;
}
export interface FuncionarioTabla {
  empresa_id: string;
  id: Generated<string>;
  sucursal_id: string;
  nombre: string;
  documento: string;
  fecha_nacimiento: FechaNula;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  cargo: string;
  fecha_ingreso: Fecha;
  fecha_egreso: FechaNula;
  motivo_egreso: string | null;
  remuneracion: 'mensual' | 'jornal';
  salario: Num;
  hijos: Generated<number>;
  asegurado_ips: Generated<boolean>;
  numero_ips: string | null;
  banco: string | null;
  cuenta_bancaria: string | null;
  usuario_id: string | null;
  nota: string | null;
  codigo_reloj: string | null;
  horario_entrada: string | null;
  horario_salida: string | null;
  trabaja_sabado: Generated<boolean>;
  sabado_salida: string | null;
  creado_por: string;
  creado_en: Creado;
}
export interface LiquidacionTabla {
  empresa_id: string;
  id: Generated<string>;
  tipo: 'mensual' | 'aguinaldo' | 'final';
  periodo: Fecha;
  estado: Generated<'borrador' | 'confirmada' | 'anulada'>;
  salario_minimo: Num;
  ips_obrero_pct: Num;
  ips_patronal_pct: Num;
  bruto: NumGen;
  ips_obrero: NumGen;
  ips_patronal: NumGen;
  descuentos: NumGen;
  neto: NumGen;
  confirmada_por: string | null;
  confirmada_en: Date | null;
  pago_fecha: FechaNula;
  pago_medio: 'banco' | 'efectivo' | null;
  pago_cuenta_id: string | null;
  pago_sesion_caja_id: string | null;
  pagada_por: string | null;
  anulada_por: string | null;
  anulada_en: Date | null;
  motivo_anulacion: string | null;
  creado_por: string;
  creado_en: Creado;
}
export interface LiquidacionItemTabla {
  empresa_id: string;
  liquidacion_id: string;
  funcionario_id: string;
  dias: NumGen;
  salario_base: NumGen;
  horas_extra_50: NumGen;
  horas_extra_100: NumGen;
  monto_horas_extra: NumGen;
  otros_ingresos: NumGen;
  bonificacion: NumGen;
  imponible: NumGen;
  bruto: NumGen;
  ips_obrero: NumGen;
  ips_patronal: NumGen;
  descuentos: NumGen;
  detalle_descuentos: string | null;
  neto: NumGen;
}

export interface NovedadTabla {
  empresa_id: string;
  id: Generated<string>;
  funcionario_id: string;
  fecha: Fecha;
  tipo: 'ausencia' | 'ausencia_justificada' | 'reposo' | 'permiso' | 'llegada_tardia' | 'horas_extra';
  horas: NumGen;
  recargo: 50 | 100 | null;
  observacion: string | null;
  creado_por: string;
  creado_en: Creado;
}
export interface VacacionTabla {
  empresa_id: string;
  id: Generated<string>;
  funcionario_id: string;
  tipo: 'goce' | 'ajuste';
  desde: FechaNula;
  hasta: FechaNula;
  dias: Num;
  observacion: string | null;
  estado: Generated<'vigente' | 'anulada'>;
  anulada_por: string | null;
  anulada_en: Date | null;
  motivo_anulacion: string | null;
  creado_por: string;
  creado_en: Creado;
}
export interface LiquidacionFinalTabla {
  empresa_id: string;
  liquidacion_id: string;
  funcionario_id: string;
  fecha_egreso: Fecha;
  motivo: 'renuncia' | 'despido_injustificado' | 'despido_justificado' | 'mutuo_acuerdo' | 'fin_contrato';
  detalle_motivo: string | null;
  opciones: Json<Record<string, unknown>>;
  promedio_mensual: ColumnType<string | null, string | null, string | null>;
  cobrado_anio: NumGen;
  detalle_descuentos: string | null;
  egreso_anterior: FechaNula;
  motivo_anterior: string | null;
}
export interface LiquidacionConceptoTabla {
  empresa_id: string;
  liquidacion_id: string;
  orden: number;
  concepto: string;
  descripcion: string;
  dias: NumGen;
  base: NumGen;
  monto: Num;
  imponible: boolean;
}
export interface MarcacionTabla {
  empresa_id: string;
  id: Generated<string>;
  funcionario_id: string;
  fecha: Fecha;
  hora: string;
  origen: 'reloj' | 'manual';
  creado_por: string;
  creado_en: Creado;
}
export interface LoteTabla {
  empresa_id: string;
  id: Generated<string>;
  variante_id: string;
  codigo: string;
  vencimiento: FechaNula;
  creado_en: Creado;
}
export interface StockLoteTabla {
  empresa_id: string;
  lote_id: string;
  deposito_id: string;
  cantidad: NumGen;
}
export interface MovimientoLoteTabla {
  empresa_id: string;
  id: Generated<string>;
  lote_id: string;
  variante_id: string;
  deposito_id: string;
  tipo: TipoMovimientoStock;
  cantidad: Num;
  origen_id: string | null;
  creado_por: string | null;
  creado_en: Creado;
}
export interface RecetaTabla {
  empresa_id: string;
  id: Generated<string>;
  venta_id: string;
  medico: string;
  matricula: string;
  paciente: string;
  paciente_documento: string | null;
  fecha: Fecha;
  numero: string | null;
  retenida: Generated<boolean>;
  creado_por: string;
  creado_en: Creado;
}
export interface SalonTabla {
  empresa_id: string;
  id: Generated<string>;
  sucursal_id: string;
  nombre: string;
  orden: Generated<number>;
  activo: Generated<boolean>;
}
export interface MesaTabla {
  empresa_id: string;
  id: Generated<string>;
  salon_id: string;
  nombre: string;
  capacidad: Generated<number>;
  forma: Generated<'cuadrada' | 'redonda' | 'rectangular'>;
  pos_x: Generated<number>;
  pos_y: Generated<number>;
  activa: Generated<boolean>;
}
export interface CuentaSalonTabla {
  empresa_id: string;
  id: Generated<string>;
  numero: ColumnType<string, number | string, never>;
  sucursal_id: string;
  tipo: 'mesa' | 'mostrador';
  mesa_id: string | null;
  nombre: string | null;
  comensales: Generated<number>;
  mozo_id: string;
  estado: Generated<'abierta' | 'cerrada' | 'anulada'>;
  propina: NumGen;
  nota: string | null;
  abierta_en: Creado;
  cerrada_en: Date | null;
  anulada_por: string | null;
  motivo_anulacion: string | null;
}
export interface ComandaTabla {
  empresa_id: string;
  id: Generated<string>;
  cuenta_id: string;
  numero: number;
  enviada_en: Creado;
  creado_por: string;
}
export interface CuentaSalonItemTabla {
  empresa_id: string;
  id: Generated<string>;
  cuenta_id: string;
  comanda_id: string | null;
  variante_id: string;
  descripcion: string;
  cantidad: Num;
  precio_unitario: Num;
  nota: string | null;
  estacion: 'cocina' | 'bar' | null;
  estado: Generated<'pendiente' | 'enviado' | 'preparando' | 'listo' | 'entregado' | 'anulado'>;
  venta_id: string | null;
  listo_en: Date | null;
  entregado_en: Date | null;
  anulado_por: string | null;
  motivo_anulacion: string | null;
  creado_por: string;
  creado_en: Creado;
}
export interface RecetaProduccionTabla {
  empresa_id: string;
  id: Generated<string>;
  variante_id: string;
  rendimiento: Num;
  minutos: number | null;
  nota: string | null;
  activa: Generated<boolean>;
  creado_por: string;
  creado_en: Creado;
  actualizado_en: Actualizado;
}
export interface RecetaProduccionInsumoTabla {
  empresa_id: string;
  receta_id: string;
  linea: number;
  variante_id: string;
  cantidad: Num;
}
export interface OrdenProduccionTabla {
  empresa_id: string;
  id: Generated<string>;
  numero: ColumnType<string, number | string, never>;
  deposito_id: string;
  receta_id: string;
  variante_id: string;
  fecha: Fecha;
  cantidad_planificada: Num;
  cantidad_producida: ColumnType<string | null, string | null | undefined, string | null>;
  estado: Generated<'planificada' | 'terminada' | 'anulada'>;
  costo_total: ColumnType<string | null, string | null | undefined, string | null>;
  costo_unitario: ColumnType<string | null, string | null | undefined, string | null>;
  lote_codigo: string | null;
  lote_vencimiento: FechaNula;
  nota: string | null;
  creado_por: string;
  creado_en: Creado;
  terminada_por: string | null;
  terminada_en: Date | null;
  anulada_por: string | null;
  anulada_en: Date | null;
  motivo_anulacion: string | null;
}
export interface OrdenProduccionInsumoTabla {
  empresa_id: string;
  orden_id: string;
  linea: number;
  variante_id: string;
  cantidad_teorica: Num;
  cantidad_real: ColumnType<string | null, string | null | undefined, string | null>;
  costo_unitario: ColumnType<string | null, string | null | undefined, string | null>;
}

export interface ValeTabla {
  empresa_id: string;
  id: Generated<string>;
  numero: number | string;
  codigo: string;
  sucursal_id: string;
  cliente_id: string | null;
  devolucion_id: string | null;
  monto: Num;
  saldo: Num;
  vence: string | null;
  creado_por: string;
  creado_en: Creado;
}

export interface ValeMovimientoTabla {
  empresa_id: string;
  id: Generated<string>;
  vale_id: string;
  tipo: 'emision' | 'uso' | 'reintegro';
  monto: Num;
  saldo: Num;
  venta_id: string | null;
  creado_por: string;
  creado_en: Creado;
}

export interface RutaTabla {
  empresa_id: string;
  id: Generated<string>;
  sucursal_id: string;
  nombre: string;
  dias: number[];
  nota: string | null;
  activa: Generated<boolean>;
  creado_en: Creado;
}

export interface RepartoTabla {
  empresa_id: string;
  id: Generated<string>;
  numero: number | string;
  sucursal_id: string;
  caja_id: string;
  ruta_id: string | null;
  fecha: string;
  repartidor: string;
  funcionario_id: string | null;
  vehiculo: string | null;
  nota: string | null;
  estado: Generated<'preparacion' | 'en_ruta' | 'rendido' | 'anulado'>;
  despachado_en: Date | null;
  despachado_por: string | null;
  rendido_en: Date | null;
  rendido_por: string | null;
  efectivo_esperado: Num | null;
  efectivo_entregado: Num | null;
  creado_por: string;
  creado_en: Creado;
}

export interface RepartoPedidoTabla {
  empresa_id: string;
  reparto_id: string;
  pedido_id: string;
  orden: number;
  estado: Generated<'pendiente' | 'entregado' | 'parcial' | 'rechazado'>;
  venta_id: string | null;
  devolucion_id: string | null;
  cobro_id: string | null;
  cobrado: NumGen;
  medio: 'efectivo' | 'transferencia' | 'cheque' | 'otro' | null;
  motivo: string | null;
}

export interface PresentacionTabla {
  empresa_id: string;
  id: Generated<string>;
  variante_id: string;
  nombre: string;
  factor: Num;
  precio: Num | null;
  activa: Generated<boolean>;
}
