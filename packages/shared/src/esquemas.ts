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
  activo: z.boolean().optional(),
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
