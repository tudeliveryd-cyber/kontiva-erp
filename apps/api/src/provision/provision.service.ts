import { Injectable } from '@nestjs/common';
import { PLANTILLAS_PERFIL, expandirPermisos, validarRuc } from '@kontiva/shared';
import { randomUUID } from 'node:crypto';
import { AuthService } from '../auth/auth.service';
import { auditar } from '../comun/auditoria';
import { Correo } from '../comun/correo';
import { invalido } from '../comun/errores';
import { config } from '../config';
import { Db } from '../db/database';

export interface AltaEmpresa {
  razonSocial: string;
  nombreFantasia?: string | null;
  ruc?: string | null;
  rubro?: string;
  planCodigo: string;
  sucursal?: { nombre: string; codigo: string };
  propietario: { email: string; nombre: string };
}

export interface ResultadoAlta {
  empresaId: string;
  sucursalId: string;
  usuarioId: string;
  cuentaId: string;
  /** Solo si la cuenta es nueva: enlace para crear la contraseña (también se envía por correo). */
  enlaceInvitacion: string | null;
}

/**
 * Alta de una empresa nueva: empresa, casa matriz, perfiles desde plantillas y usuario
 * Propietario. La empresa empieza vacía (sin datos de ejemplo).
 * Lo usa la CLI hasta que exista el Panel Master.
 */
@Injectable()
export class ProvisionService {
  constructor(
    private readonly db: Db,
    private readonly auth: AuthService,
    private readonly correo: Correo,
  ) {}

  async crearEmpresa(a: AltaEmpresa): Promise<ResultadoAlta> {
    if (a.ruc && !validarRuc(a.ruc)) throw invalido('RUC inválido');
    const email = a.propietario.email.trim().toLowerCase();

    const plan = await this.db.k.selectFrom('plan').select(['id']).where('codigo', '=', a.planCodigo).where('activo', '=', true).executeTakeFirst();
    if (!plan) throw invalido(`Plan inexistente: ${a.planCodigo}`);

    const empresaId = randomUUID();
    const r = await this.db.enEmpresa(empresaId, async (tx) => {
      // La cuenta es global: si la persona ya usa KONTIVA en otra empresa, se reutiliza.
      // Va en la misma transacción para no dejar cuentas huérfanas si el alta falla.
      let cuenta = await tx.selectFrom('cuenta').select(['id', 'hash_contrasena']).where('email', '=', email).executeTakeFirst();
      const cuentaNueva = !cuenta;
      if (!cuenta) {
        cuenta = await tx
          .insertInto('cuenta')
          .values({ email, nombre: a.propietario.nombre.trim() })
          .returning(['id', 'hash_contrasena'])
          .executeTakeFirstOrThrow();
      }
      const cuentaId = cuenta.id;

      await tx
        .insertInto('empresa')
        .values({
          id: empresaId,
          razon_social: a.razonSocial.trim(),
          nombre_fantasia: a.nombreFantasia?.trim() || null,
          ruc: a.ruc?.trim() || null,
          rubro: a.rubro ?? 'general',
          plan_id: plan.id,
          telefono: null,
          email: null,
          direccion: null,
        })
        .execute();

      const sucursal = await tx
        .insertInto('sucursal')
        .values({
          empresa_id: empresaId,
          nombre: a.sucursal?.nombre ?? 'Casa matriz',
          codigo: a.sucursal?.codigo ?? '001',
          direccion: null,
          telefono: null,
          creado_por: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      let propietarioPerfilId = '';
      for (const p of PLANTILLAS_PERFIL) {
        const perfil = await tx
          .insertInto('perfil')
          .values({
            empresa_id: empresaId,
            clave: p.clave,
            nombre: p.nombre,
            descripcion: p.descripcion,
            alcance: p.alcance,
            es_propietario: p.esPropietario ?? false,
            sistema: true,
            creado_por: null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        if (p.esPropietario) propietarioPerfilId = perfil.id;
        const codigos = expandirPermisos(p.permisos);
        if (!p.esPropietario && codigos.length) {
          await tx
            .insertInto('perfil_permiso')
            .values(codigos.map((permiso) => ({ empresa_id: empresaId, perfil_id: perfil.id, permiso })))
            .execute();
        }
      }

      const usuario = await tx
        .insertInto('usuario')
        .values({
          empresa_id: empresaId,
          cuenta_id: cuentaId,
          perfil_id: propietarioPerfilId,
          nombre: a.propietario.nombre.trim(),
          hash_pin: null,
          pin_bloqueado_hasta: null,
          creado_por: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx.insertInto('usuario_sucursal').values({ empresa_id: empresaId, usuario_id: usuario.id, sucursal_id: sucursal.id }).execute();

      await auditar(tx, { empresaId, usuarioId: null, cuentaId: null }, {
        accion: 'alta_empresa',
        entidad: 'empresa',
        entidadId: empresaId,
        despues: { razonSocial: a.razonSocial, plan: a.planCodigo, rubro: a.rubro ?? 'general', propietario: email },
      });
      return { sucursalId: sucursal.id, usuarioId: usuario.id, cuentaId, necesitaContrasena: cuentaNueva || !cuenta.hash_contrasena };
    });

    let enlace: string | null = null;
    if (r.necesitaContrasena) {
      const token = await this.auth.emitirTokenCuenta(r.cuentaId, 'invitacion');
      enlace = `${config().WEB_URL}/restablecer?token=${token}&invitacion=1`;
    }
    await this.correo.enviar({
      para: email,
      asunto: 'Bienvenido a KONTIVA ERP',
      texto:
        `Hola ${a.propietario.nombre}:\n\nSu empresa "${a.nombreFantasia ?? a.razonSocial}" ya está lista en KONTIVA ERP.\n\n` +
        (enlace
          ? `Cree su contraseña con este enlace (válido 7 días):\n${enlace}\n\n`
          : `Ingrese con su correo y contraseña de siempre en ${config().WEB_URL}\n\n`) +
        `KONTIVA ERP · Desarrollado por Araújo Tech Sistemas`,
    });

    return { empresaId, cuentaId: r.cuentaId, sucursalId: r.sucursalId, usuarioId: r.usuarioId, enlaceInvitacion: enlace };
  }
}
