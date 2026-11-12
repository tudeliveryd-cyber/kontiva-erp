import { SetMetadata } from '@nestjs/common';
import type { Accion, Recurso } from '@kontiva/shared';

export const META_PUBLICO = 'kontiva:publico';
export const META_PERMISO = 'kontiva:permiso';

/** Endpoint sin sesión (login, recuperación, salud). */
export const Publico = () => SetMetadata(META_PUBLICO, true);

/** Permiso exigido. Lo valida AuthGuard en el servidor antes de ejecutar. */
export const Requiere = (recurso: Recurso, accion: Accion) => SetMetadata(META_PERMISO, `${recurso}.${accion}`);

/** Endpoint autenticado que no exige un permiso concreto (perfil propio, sesiones propias). */
export const SoloSesion = () => SetMetadata(META_PERMISO, '__sesion__');
