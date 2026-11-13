import { PERMISOS, type Alcance } from './permisos';

/**
 * Perfiles que se crean en cada empresa nueva. Son plantillas: el propietario
 * puede editarlos o crear perfiles propios. El perfil Propietario es especial:
 * tiene todos los permisos con alcance empresa y no se puede restringir.
 */
export interface PlantillaPerfil {
  clave: string;
  nombre: string;
  descripcion: string;
  alcance: Alcance;
  esPropietario?: boolean;
  /** Códigos "recurso.accion"; "recurso.*" = todas las acciones del recurso. */
  permisos: readonly string[];
}

export const PLANTILLAS_PERFIL: readonly PlantillaPerfil[] = [
  {
    clave: 'propietario',
    nombre: 'Propietario',
    descripcion: 'Acceso total, incluida configuración, planes y permisos. No se puede restringir.',
    alcance: 'empresa',
    esPropietario: true,
    permisos: ['*'],
  },
  {
    clave: 'administrador',
    nombre: 'Administrador',
    descripcion: 'Todo excepto datos de suscripción y eliminar al propietario.',
    alcance: 'empresa',
    permisos: ['*'],
  },
  {
    clave: 'gerente',
    nombre: 'Gerente',
    descripcion: 'Operación completa, aprobaciones e informes.',
    alcance: 'sucursal',
    permisos: [
      'sucursal.ver', 'usuario.ver', 'auditoria.ver',
      'producto.*', 'costo_producto.ver', 'precio.*', 'stock.*', 'transferencia.*', 'conteo.*',
      'venta.*', 'descuento.aprobar', 'devolucion.*', 'presupuesto.*', 'pedido.*',
      'cliente.*', 'credito_cliente.*', 'caja.*', 'arqueo.*',
      'proveedor.ver', 'orden_compra.*', 'recepcion.*',
      'cuenta_cobrar.*', 'informe_ventas.*', 'informe_ganancias.ver', 'documento_fiscal.*', 'entrega.*', 'asistencia.*', 'receta.*', 'salon.*', 'cocina.*',
    ],
  },
  {
    clave: 'supervisor',
    nombre: 'Supervisor',
    descripcion: 'Cajas, autorizaciones del PDV y ajustes menores de stock.',
    alcance: 'sucursal',
    permisos: [
      'sucursal.ver', 'producto.ver', 'precio.ver', 'stock.ver', 'stock.editar', 'conteo.ver', 'conteo.crear',
      'venta.ver', 'venta.crear', 'venta.cancelar', 'venta.imprimir', 'descuento.aprobar',
      'devolucion.*', 'cliente.ver', 'cliente.crear', 'caja.*', 'arqueo.*', 'documento_fiscal.ver', 'documento_fiscal.imprimir',
      'credito_cliente.ver', 'credito_cliente.aprobar', 'cuenta_cobrar.ver', 'cuenta_cobrar.crear', 'asistencia.ver', 'asistencia.editar', 'receta.ver', 'salon.ver', 'salon.crear', 'salon.cancelar', 'cocina.ver',
    ],
  },
  {
    clave: 'cajero',
    nombre: 'Cajero',
    descripcion: 'PDV, apertura y cierre de su caja.',
    alcance: 'propia',
    permisos: [
      'producto.ver', 'precio.ver', 'stock.ver', 'venta.ver', 'venta.crear', 'venta.imprimir',
      'cliente.ver', 'cliente.crear', 'caja.ver', 'caja.crear', 'arqueo.crear', 'documento_fiscal.imprimir', 'cuenta_cobrar.ver', 'cuenta_cobrar.crear', 'salon.ver',
    ],
  },
  {
    clave: 'mozo',
    nombre: 'Mozo',
    descripcion: 'Mesas y comandas de su sucursal; no cobra.',
    alcance: 'sucursal',
    permisos: ['producto.ver', 'precio.ver', 'salon.ver', 'salon.crear'],
  },
  {
    clave: 'cocina',
    nombre: 'Cocina',
    descripcion: 'Pantalla de cocina y bar de su sucursal.',
    alcance: 'sucursal',
    permisos: ['cocina.ver', 'cocina.editar'],
  },
  {
    clave: 'vendedor',
    nombre: 'Vendedor',
    descripcion: 'Presupuestos, pedidos y clientes; sin costos.',
    alcance: 'propia',
    permisos: ['producto.ver', 'precio.ver', 'stock.ver', 'presupuesto.*', 'pedido.*', 'cliente.ver', 'cliente.crear', 'cliente.editar', 'venta.ver'],
  },
  {
    clave: 'stock',
    nombre: 'Encargado de stock',
    descripcion: 'Inventario, recepciones, transferencias y conteos.',
    alcance: 'sucursal',
    permisos: ['sucursal.ver', 'producto.*', 'stock.*', 'transferencia.*', 'conteo.*', 'recepcion.*', 'proveedor.ver', 'orden_compra.ver'],
  },
  {
    clave: 'comprador',
    nombre: 'Comprador',
    descripcion: 'Cotizaciones, órdenes de compra y proveedores.',
    alcance: 'empresa',
    permisos: ['producto.ver', 'costo_producto.ver', 'stock.ver', 'proveedor.*', 'orden_compra.ver', 'orden_compra.crear', 'orden_compra.editar', 'orden_compra.cancelar', 'recepcion.ver'],
  },
  {
    clave: 'financiero',
    nombre: 'Financiero',
    descripcion: 'Cuentas a pagar y cobrar, bancos y flujo de caja.',
    alcance: 'empresa',
    permisos: ['cuenta_pagar.*', 'cuenta_cobrar.*', 'banco.*', 'flujo_caja.*', 'informe_ventas.ver', 'credito_cliente.ver', 'cliente.ver', 'proveedor.ver', 'caja.ver', 'arqueo.ver', 'informe_ganancias.ver'],
  },
  {
    clave: 'contador',
    nombre: 'Contador',
    descripcion: 'Lectura de finanzas y fiscal, exportaciones y cierres.',
    alcance: 'empresa',
    permisos: [
      'cuenta_pagar.ver', 'cuenta_pagar.exportar', 'cuenta_cobrar.ver', 'cuenta_cobrar.exportar', 'banco.ver',
      'contabilidad.*', 'documento_fiscal.ver', 'documento_fiscal.imprimir', 'venta.ver', 'venta.exportar',
      'informe_ventas.*', 'informe_ganancias.*', 'auditoria.ver',
    ],
  },
  {
    clave: 'rrhh',
    nombre: 'Recursos humanos',
    descripcion: 'Legajos de funcionarios, sueldos, aguinaldo y planillas.',
    alcance: 'empresa',
    permisos: ['funcionario.*', 'salario.*', 'asistencia.*', 'sucursal.ver'],
  },
  {
    clave: 'repartidor',
    nombre: 'Repartidor',
    descripcion: 'Sus entregas y rutas.',
    alcance: 'propia',
    permisos: ['entrega.ver', 'entrega.editar', 'cliente.ver'],
  },
];

/** Expande comodines ("*", "recurso.*") a códigos concretos del catálogo. */
export function expandirPermisos(patrones: readonly string[]): string[] {
  const out = new Set<string>();
  for (const patron of patrones) {
    if (patron === '*') {
      PERMISOS.forEach((p) => out.add(p.codigo));
    } else if (patron.endsWith('.*')) {
      const recurso = patron.slice(0, -2);
      const encontrados = PERMISOS.filter((p) => p.recurso === recurso);
      if (encontrados.length === 0) throw new Error(`Recurso desconocido en plantilla: ${patron}`);
      encontrados.forEach((p) => out.add(p.codigo));
    } else {
      if (!PERMISOS.some((p) => p.codigo === patron)) throw new Error(`Permiso desconocido en plantilla: ${patron}`);
      out.add(patron);
    }
  }
  return [...out].sort();
}
