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
