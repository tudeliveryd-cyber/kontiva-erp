import { z } from 'zod';
import { ALCANCES, esPermisoValido } from './permisos';
import { validarRuc } from './ruc';

/** Esquemas de entrada compartidos por la API (validación) y la web (formularios). */

export const email = z.string().trim().toLowerCase().email('Correo inválido').max(254);
export const contrasena = z
  .string()
  .min(10, 'Mínimo 10 caracteres')
  .max(200, 'Máximo 200 caracteres');
export const uuid = z.string().uuid('Identificador inválido');
export const alcance = z.enum(ALCANCES);
export const codigoPermiso = z.string().refine(esPermisoValido, 'Permiso desconocido');
export const ruc = z.string().trim().refine(validarRuc, 'RUC inválido (formato 80012345-6, con dígito verificador)');

export const loginEntrada = z.object({
  email,
  contrasena: z.string().min(1, 'Ingrese su contraseña').max(200),
  empresaId: uuid.optional(),
});
export type LoginEntrada = z.infer<typeof loginEntrada>;

export const elegirEmpresaEntrada = z.object({ ticket: z.string().min(1), empresaId: uuid });
export const cambiarEmpresaEntrada = z.object({ empresaId: uuid });

export const recuperarEntrada = z.object({ email });
export const restablecerEntrada = z.object({ token: z.string().min(20).max(200), contrasena });
export const cambiarContrasenaEntrada = z.object({ actual: z.string().min(1).max(200), nueva: contrasena });
export const pinEntrada = z.object({ pin: z.string().regex(/^[0-9]{4,6}$/, 'El PIN debe tener de 4 a 6 dígitos') });

export const autorizarEntrada = z.object({
  usuarioId: uuid,
  pin: z.string().regex(/^[0-9]{4,6}$/),
  permiso: codigoPermiso,
  motivo: z.string().trim().max(300).optional(),
});

export const empresaEditar = z.object({
  permiteStockNegativo: z.boolean().optional(),
  razonSocial: z.string().trim().min(2).max(200).optional(),
  nombreFantasia: z.string().trim().max(200).nullable().optional(),
  ruc: ruc.optional(),
  telefono: z.string().trim().max(40).nullable().optional(),
  direccion: z.string().trim().max(300).nullable().optional(),
  email: email.nullable().optional(),
});

export const sucursalCrear = z.object({
  nombre: z.string().trim().min(2).max(120),
  codigo: z.string().trim().regex(/^[0-9]{3}$/, 'Código de establecimiento de 3 dígitos (ej. 001)'),
  direccion: z.string().trim().max(300).nullable().optional(),
  telefono: z.string().trim().max(40).nullable().optional(),
});
export const sucursalEditar = sucursalCrear.partial().extend({ activa: z.boolean().optional() });

export const usuarioCrear = z.object({
  email,
  nombre: z.string().trim().min(2).max(120),
  perfilId: uuid,
  sucursalIds: z.array(uuid).max(500).default([]),
});
export type UsuarioCrear = z.infer<typeof usuarioCrear>;

export const usuarioEditar = z.object({
  nombre: z.string().trim().min(2).max(120).optional(),
  perfilId: uuid.optional(),
  sucursalIds: z.array(uuid).max(500).optional(),
  activo: z.boolean().optional(),
});

export const permisoIndividual = z.object({
  permiso: codigoPermiso,
  tipo: z.enum(['conceder', 'denegar']),
  alcance: alcance.default('empresa'),
});
export const usuarioPermisosEntrada = z.object({ permisos: z.array(permisoIndividual).max(1000) });

export const perfilCrear = z.object({
  nombre: z.string().trim().min(2).max(80),
  descripcion: z.string().trim().max(300).nullable().optional(),
  alcance: alcance,
  permisos: z.array(codigoPermiso).max(1000),
});
export const perfilEditar = perfilCrear.partial();

export const auditoriaFiltro = z.object({
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
  usuarioId: uuid.optional(),
  entidad: z.string().max(60).optional(),
  accion: z.string().max(60).optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});

// ---------------------------------------------------------------------------
// Fase 1 · catálogo, stock, clientes, cajas y ventas
// ---------------------------------------------------------------------------

const textoOpcional = (max: number) => z.string().trim().max(max).nullable().optional();
const dinero = z.coerce.number().min(0).max(1e13);
const cantidad = z.coerce.number().positive().max(1e9);
const codigoBarras = z.string().trim().regex(/^[0-9A-Za-z\-.]{3,40}$/, 'Código de barras inválido');

export const UNIDADES = ['unidad', 'kg', 'g', 'litro', 'ml', 'metro', 'm2', 'm3', 'caja', 'paquete'] as const;

export const varianteEntrada = z.object({
  id: uuid.optional(),
  nombre: textoOpcional(80),
  sku: textoOpcional(60),
  codigos: z.array(codigoBarras).max(20).default([]),
  precio: dinero,
  costo: dinero.optional(),
  activa: z.boolean().default(true),
});

export const productoEntrada = z.object({
  nombre: z.string().trim().min(1, 'Ingrese el nombre').max(200),
  descripcion: textoOpcional(1000),
  categoriaId: uuid.nullable().optional(),
  marcaId: uuid.nullable().optional(),
  tipo: z.enum(['producto', 'servicio']).default('producto'),
  unidad: z.enum(UNIDADES).default('unidad'),
  tasaIva: z.coerce.number().refine((v) => v === 0 || v === 5 || v === 10, 'IVA 10, 5 o exento').default(10),
  controlaStock: z.boolean().default(true),
  activo: z.boolean().default(true),
  variantes: z.array(varianteEntrada).min(1).max(200),
});
export type ProductoEntrada = z.infer<typeof productoEntrada>;

export const nombreSimple = z.object({ nombre: z.string().trim().min(1).max(80) });

export const ajusteStockEntrada = z.object({
  depositoId: uuid,
  motivo: z.string().trim().min(3, 'Indique el motivo').max(300),
  tipo: z.enum(['inicial', 'ajuste']).default('ajuste'),
  items: z
    .array(z.object({ varianteId: uuid, cantidadNueva: z.coerce.number().min(-1e9).max(1e9) }))
    .min(1)
    .max(2000),
});

export const clienteEntrada = z.object({
  nombre: z.string().trim().min(2, 'Ingrese el nombre').max(200),
  documento: z
    .string()
    .trim()
    .max(20)
    .regex(/^[0-9A-Za-z-]*$/, 'Solo números y guion')
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  telefono: textoOpcional(40),
  email: email.nullable().optional().or(z.literal('').transform(() => null)),
  direccion: textoOpcional(300),
  listaPrecioId: uuid.nullable().optional(),
  activo: z.boolean().optional(),
});

export const listaPrecioEntrada = z.object({
  nombre: z.string().trim().min(2, 'Ingrese el nombre').max(80),
  activa: z.boolean().optional(),
});

/** precio null = quitar el precio especial (rige el general). */
export const preciosListaEntrada = z.object({
  sucursalId: uuid.nullable().optional(),
  items: z.array(z.object({ varianteId: uuid, precio: dinero.nullable() })).min(1).max(2000),
});

/** Genera precios de la lista a partir del precio normal: -10 = 10 % menos. */
export const ajusteListaEntrada = z.object({
  porcentaje: z.coerce.number().min(-90).max(500),
  redondeo: z.coerce.number().refine((v) => [1, 50, 100, 500, 1000].includes(v), 'Redondeo inválido').default(1),
  categoriaId: uuid.nullable().optional(),
  soloSinPrecio: z.boolean().default(false),
});

export const cotizacionEntrada = z
  .object({
    sucursalId: uuid,
    moneda: z.enum(['USD', 'BRL']),
    compra: z.coerce.number().positive().max(1e7),
    venta: z.coerce.number().positive().max(1e7),
  })
  .refine((d) => d.venta >= d.compra, { message: 'La cotización de venta no puede ser menor que la de compra', path: ['venta'] });

export const cajaEntrada = z.object({
  nombre: z.string().trim().min(1).max(60),
  sucursalId: uuid,
  depositoId: uuid,
  activa: z.boolean().optional(),
});

const montoMoneda = z.object({ moneda: z.enum(['PYG', 'USD', 'BRL']), monto: z.coerce.number().min(0).max(1e13) });

export const aperturaCajaEntrada = z.object({ fondos: z.array(montoMoneda).max(3).default([]) });

export const movimientoCajaEntrada = z.object({
  tipo: z.enum(['retiro', 'ingreso']),
  moneda: z.enum(['PYG', 'USD', 'BRL']),
  monto: z.coerce.number().positive().max(1e13),
  motivo: z.string().trim().min(3).max(300),
});

export const cierreCajaEntrada = z.object({
  contado: z
    .array(
      z.object({
        moneda: z.enum(['PYG', 'USD', 'BRL']),
        medio: z.enum(['efectivo', 'tarjeta', 'transferencia', 'otro']),
        monto: z.coerce.number().min(0).max(1e13),
      }),
    )
    .max(12),
});

export const ventaEntrada = z.object({
  claveIdempotencia: z.string().min(8).max(80),
  cajaId: uuid,
  clienteId: uuid.nullable().optional(),
  /** Pedido que se entrega con esta venta: rigen sus precios y descuentos. */
  pedidoId: uuid.nullable().optional(),
  items: z
    .array(
      z.object({
        varianteId: uuid,
        cantidad,
        /** Solo con permiso precio.editar; si no, se usa el precio de lista. */
        precioUnitario: dinero.optional(),
        descuento: dinero.optional(),
      }),
    )
    .min(1, 'La venta no tiene productos')
    .max(500),
  pagos: z
    .array(
      z.object({
        medio: z.enum(['efectivo', 'tarjeta', 'transferencia', 'otro']),
        moneda: z.enum(['PYG', 'USD', 'BRL']),
        monto: z.coerce.number().positive().max(1e13),
        referencia: textoOpcional(80),
      }),
    )
    .min(1, 'Registre al menos un pago')
    .max(10),
  vueltoMoneda: z.enum(['PYG', 'USD', 'BRL']).default('PYG'),
});
export type VentaEntrada = z.infer<typeof ventaEntrada>;

export const anularVentaEntrada = z.object({ motivo: z.string().trim().min(3, 'Indique el motivo').max(300) });

/** Booleano en query string: solo "true" es verdadero (z.coerce.boolean convierte "false" en true). */
export const booleanoQuery = z.preprocess((v) => v === true || v === 'true' || v === '1', z.boolean()).default(false);

export const transferenciaEntrada = z.object({
  origenId: uuid,
  destinoId: uuid,
  /** true: sale y entra en el acto. false: queda en tránsito hasta que el destino confirme. */
  directa: z.boolean().default(false),
  nota: z.string().trim().max(300).nullable().optional(),
  items: z.array(z.object({ varianteId: uuid, cantidad: z.coerce.number().positive().max(1e9) })).min(1, 'Agregue productos').max(1000),
});

export const recepcionEntrada = z.object({
  items: z.array(z.object({ linea: z.number().int().positive(), cantidadRecibida: z.coerce.number().min(0).max(1e9) })).max(1000).default([]),
});

export const cancelarEntrada = z.object({ motivo: z.string().trim().min(3, 'Indique el motivo').max(300) });

export const devolucionEntrada = z.object({
  ventaId: uuid,
  /** Caja abierta del usuario: de ahí sale el dinero y al depósito de esa caja vuelve la mercadería. */
  cajaId: uuid,
  medio: z.enum(['efectivo', 'tarjeta', 'transferencia', 'otro']).default('efectivo'),
  motivo: z.string().trim().min(3, 'Indique el motivo').max(300),
  items: z.array(z.object({ linea: z.number().int().positive(), cantidad: z.coerce.number().positive().max(1e9) })).min(1, 'Elija qué se devuelve').max(500),
});

// ---------------------------------------------------------------------------
// Presupuestos y pedidos
// ---------------------------------------------------------------------------

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida')
  .nullable()
  .optional()
  .or(z.literal('').transform(() => null));

export const pedidoEntrada = z
  .object({
    sucursalId: uuid,
    clienteId: uuid.nullable().optional(),
    clienteNombre: z.string().trim().max(200).nullable().optional().transform((v) => (v ? v : null)),
    validoHasta: fecha,
    entregaPrevista: fecha,
    nota: textoOpcional(1000),
    items: z
      .array(
        z.object({
          varianteId: uuid,
          cantidad,
          /** Solo con permiso precio.editar; si no, el precio de lista del cliente. */
          precioUnitario: dinero.optional(),
          descuento: dinero.optional(),
        }),
      )
      .min(1, 'Agregue al menos un producto')
      .max(500),
  });
export type PedidoEntrada = z.infer<typeof pedidoEntrada>;

export const cerrarPedidoEntrada = z.object({ motivo: z.string().trim().min(3, 'Indique el motivo').max(300) });
export const estadoPedidoEntrada = z.object({ estado: z.enum(['pendiente', 'preparado']) });

// ---------------------------------------------------------------------------
// Facturación electrónica (SIFEN)
// ---------------------------------------------------------------------------

export const feConfiguracionEntrada = z.object({
  ambiente: z.enum(['test', 'produccion']),
  tipoContribuyente: z.coerce.number().refine((v) => v === 1 || v === 2, 'Persona física o jurídica'),
  tipoRegimen: z.coerce.number().int().min(1).max(99).nullable().optional(),
  actividadCodigo: z.string().trim().regex(/^[0-9]{3,8}$/, 'Código de actividad económica (números)'),
  actividadDescripcion: z.string().trim().min(3, 'Describa la actividad').max(300),
  timbradoNumero: z.string().trim().regex(/^[0-9]{8}$/, 'El timbrado tiene 8 dígitos'),
  timbradoFecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha de inicio de vigencia'),
  cscId: z.string().trim().regex(/^[0-9]{1,4}$/, 'Identificador del CSC (ej. 0001)'),
  /** Vacío = conservar el CSC cargado. */
  csc: z.string().trim().max(64).optional().transform((v) => (v ? v : undefined)),
});

export const feCertificadoEntrada = z.object({
  archivo: z.string().min(100, 'Seleccione el archivo .p12 / .pfx').max(40000),
  clave: z.string().min(1, 'Ingrese la contraseña del certificado').max(200),
});

export const feEstablecimientoEntrada = z.object({
  direccion: z.string().trim().min(3, 'Ingrese la dirección').max(255),
  numeroCasa: z.string().trim().max(10).optional().transform((v) => (v ? v : null)),
  departamento: z.coerce.number().int().positive('Elija el departamento'),
  distrito: z.coerce.number().int().positive('Elija el distrito'),
  ciudad: z.coerce.number().int().positive('Elija la ciudad'),
  telefono: z.string().trim().min(6, 'Teléfono (mínimo 6 dígitos)').max(20),
  email: email.nullable().optional().or(z.literal('').transform(() => null)),
});

export const fePuntoEntrada = z.object({ punto: z.string().regex(/^[0-9]{3}$/, 'Tres dígitos: 001').nullable() });
