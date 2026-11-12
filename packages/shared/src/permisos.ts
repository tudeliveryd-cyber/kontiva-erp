/**
 * Catálogo de permisos de KONTIVA ERP.
 *
 * Permiso = recurso + acción + alcance.
 * El código de un permiso es "<recurso>.<accion>" (ej. "venta.cancelar").
 * El alcance (propia | sucursal | empresa) se asigna en el perfil o en el usuario.
 *
 * Este catálogo es la única fuente de verdad: la migración de base lo sincroniza
 * con la tabla `permiso`, y el backend rechaza cualquier código que no esté aquí.
 */

export const ACCIONES = [
  'ver',
  'crear',
  'editar',
  'eliminar',
  'aprobar',
  'cancelar',
  'imprimir',
  'exportar',
] as const;
export type Accion = (typeof ACCIONES)[number];

export const ALCANCES = ['propia', 'sucursal', 'empresa'] as const;
export type Alcance = (typeof ALCANCES)[number];

/** Orden de amplitud: un alcance mayor incluye a los menores. */
export const RANGO_ALCANCE: Record<Alcance, number> = { propia: 1, sucursal: 2, empresa: 3 };

export function alcanceMayor(a: Alcance, b: Alcance): Alcance {
  return RANGO_ALCANCE[a] >= RANGO_ALCANCE[b] ? a : b;
}

interface DefRecurso {
  nombre: string;
  modulo: string;
  acciones: readonly Accion[];
  /** Datos confidenciales: se ocultan en las respuestas a quien no tenga `ver`. */
  confidencial?: boolean;
}

export const RECURSOS = {
  // Plataforma e identidad (Fase 0)
  empresa: { nombre: 'Datos de la empresa', modulo: 'plataforma', acciones: ['ver', 'editar'] },
  sucursal: { nombre: 'Sucursales', modulo: 'plataforma', acciones: ['ver', 'crear', 'editar', 'eliminar'] },
  usuario: { nombre: 'Usuarios', modulo: 'plataforma', acciones: ['ver', 'crear', 'editar', 'eliminar'] },
  perfil: { nombre: 'Perfiles de acceso', modulo: 'plataforma', acciones: ['ver', 'crear', 'editar', 'eliminar'] },
  auditoria: { nombre: 'Registro de auditoría', modulo: 'plataforma', acciones: ['ver', 'exportar'] },

  // Catálogo e inventario (Fase 1)
  producto: { nombre: 'Productos', modulo: 'catalogo', acciones: ['ver', 'crear', 'editar', 'eliminar', 'exportar', 'imprimir'] },
  costo_producto: { nombre: 'Costo y margen de productos', modulo: 'catalogo', acciones: ['ver', 'editar'], confidencial: true },
  precio: { nombre: 'Listas de precios', modulo: 'catalogo', acciones: ['ver', 'editar'] },
  stock: { nombre: 'Stock', modulo: 'inventario', acciones: ['ver', 'editar', 'exportar'] },
  transferencia: { nombre: 'Transferencias entre depósitos', modulo: 'inventario', acciones: ['ver', 'crear', 'aprobar', 'cancelar'] },
  conteo: { nombre: 'Conteos físicos', modulo: 'inventario', acciones: ['ver', 'crear', 'aprobar'] },

  // Ventas y caja (Fase 1)
  venta: { nombre: 'Ventas', modulo: 'ventas', acciones: ['ver', 'crear', 'cancelar', 'imprimir', 'exportar'] },
  descuento: { nombre: 'Descuentos en venta', modulo: 'ventas', acciones: ['aprobar'] },
  devolucion: { nombre: 'Devoluciones', modulo: 'ventas', acciones: ['ver', 'crear', 'aprobar'] },
  presupuesto: { nombre: 'Presupuestos', modulo: 'ventas', acciones: ['ver', 'crear', 'editar', 'imprimir'] },
  pedido: { nombre: 'Pedidos', modulo: 'ventas', acciones: ['ver', 'crear', 'editar', 'cancelar'] },
  cliente: { nombre: 'Clientes', modulo: 'clientes', acciones: ['ver', 'crear', 'editar', 'eliminar', 'exportar'] },
  credito_cliente: { nombre: 'Crédito de clientes', modulo: 'clientes', acciones: ['ver', 'editar', 'aprobar'] },
  caja: { nombre: 'Caja', modulo: 'caja', acciones: ['ver', 'crear', 'editar', 'aprobar'] },
  arqueo: { nombre: 'Arqueos de caja', modulo: 'caja', acciones: ['ver', 'crear', 'aprobar'] },

  // Compras y finanzas (Fase 2)
  proveedor: { nombre: 'Proveedores', modulo: 'compras', acciones: ['ver', 'crear', 'editar', 'eliminar'] },
  orden_compra: { nombre: 'Órdenes de compra', modulo: 'compras', acciones: ['ver', 'crear', 'editar', 'aprobar', 'cancelar'] },
  recepcion: { nombre: 'Recepciones de mercadería', modulo: 'compras', acciones: ['ver', 'crear'] },
  cuenta_pagar: { nombre: 'Cuentas a pagar', modulo: 'finanzas', acciones: ['ver', 'crear', 'editar', 'aprobar', 'exportar'] },
  cuenta_cobrar: { nombre: 'Cuentas a cobrar', modulo: 'finanzas', acciones: ['ver', 'crear', 'editar', 'exportar'] },
  banco: { nombre: 'Bancos y conciliación', modulo: 'finanzas', acciones: ['ver', 'crear', 'editar'] },
  contabilidad: { nombre: 'Asientos y cierres', modulo: 'finanzas', acciones: ['ver', 'crear', 'aprobar', 'exportar'] },
  informe_ganancias: { nombre: 'Informe de ganancias', modulo: 'informes', acciones: ['ver', 'exportar'], confidencial: true },

  // Fiscal (Fase 3)
  documento_fiscal: { nombre: 'Documentos electrónicos', modulo: 'fiscal', acciones: ['ver', 'crear', 'cancelar', 'imprimir'] },
  config_fiscal: { nombre: 'Configuración fiscal (timbrado, certificado)', modulo: 'fiscal', acciones: ['ver', 'editar'], confidencial: true },

  // RRHH (Fase 4)
  funcionario: { nombre: 'Funcionarios', modulo: 'rrhh', acciones: ['ver', 'crear', 'editar', 'eliminar'] },
  salario: { nombre: 'Salarios', modulo: 'rrhh', acciones: ['ver', 'editar'], confidencial: true },

  // Logística (verticales)
  entrega: { nombre: 'Entregas y rutas', modulo: 'logistica', acciones: ['ver', 'crear', 'editar'] },
} as const satisfies Record<string, DefRecurso>;

export type Recurso = keyof typeof RECURSOS;

export interface DefPermiso {
  codigo: string;
  recurso: Recurso;
  accion: Accion;
  nombre: string;
  modulo: string;
}

const NOMBRE_ACCION: Record<Accion, string> = {
  ver: 'Ver',
  crear: 'Crear',
  editar: 'Editar',
  eliminar: 'Eliminar',
  aprobar: 'Aprobar',
  cancelar: 'Cancelar',
  imprimir: 'Imprimir',
  exportar: 'Exportar',
};

export const PERMISOS: readonly DefPermiso[] = (Object.keys(RECURSOS) as Recurso[]).flatMap((recurso) => {
  const def: DefRecurso = RECURSOS[recurso];
  return def.acciones.map((accion) => ({
    codigo: `${recurso}.${accion}`,
    recurso,
    accion,
    nombre: `${NOMBRE_ACCION[accion]} · ${def.nombre}`,
    modulo: def.modulo,
  }));
});

const CODIGOS = new Set(PERMISOS.map((p) => p.codigo));

export function esPermisoValido(codigo: string): boolean {
  return CODIGOS.has(codigo);
}

export function armarCodigoPermiso(recurso: Recurso, accion: Accion): string {
  return `${recurso}.${accion}`;
}
