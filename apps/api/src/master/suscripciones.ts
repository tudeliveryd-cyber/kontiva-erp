import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { sql } from 'kysely';
import { auditar } from '../comun/auditoria';
import { config } from '../config';
import { Db } from '../db/database';
import { auditarMaster } from './master-auditoria';

/** Fecha de hoy en Asunción (YYYY-MM-DD). */
export const hoyAsuncion = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(d);

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export type EstadoSuscripcion = 'al_dia' | 'en_gracia' | 'vencida' | 'sin_control';

export function estadoSuscripcion(s: { vence_en: string; dias_gracia: number } | null | undefined, hoy = hoyAsuncion()): EstadoSuscripcion {
  if (!s) return 'sin_control';
  if (hoy <= s.vence_en) return 'al_dia';
  if (hoy <= sumarDias(s.vence_en, s.dias_gracia)) return 'en_gracia';
  return 'vencida';
}

/**
 * Suspensión automática por falta de pago: vencido el plazo de gracia, la empresa queda
 * suspendida (conserva sus datos, no puede operar). Al registrar el pago se reactiva sola.
 * Una suspensión manual nunca se levanta automáticamente.
 */
@Injectable()
export class Suscripciones implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Suscripciones');
  private reloj?: NodeJS.Timeout;

  constructor(private readonly db: Db) {}

  onModuleInit() {
    if (config().NODE_ENV === 'test') return;
    void this.procesar().catch((e) => this.log.error(e));
    this.reloj = setInterval(() => void this.procesar().catch((e) => this.log.error(e)), 3600_000);
    this.reloj.unref();
  }

  onModuleDestroy() {
    if (this.reloj) clearInterval(this.reloj);
  }

  async procesar(hoy = hoyAsuncion()): Promise<{ suspendidas: string[]; reactivadas: string[] }> {
    const filas = await this.db.k
      .selectFrom('master.suscripcion as s')
      .select(['s.empresa_id', 's.vence_en', 's.dias_gracia', 's.suspension_automatica', 's.motivo_suspension'])
      .execute();
    const { rows: empresas } = await sql<{ id: string; estado: string }>`SELECT id, estado FROM master.resumen_empresas()`.execute(this.db.k);
    const estado = new Map(empresas.map((e) => [e.id, e.estado]));
    const suspendidas: string[] = [];
    const reactivadas: string[] = [];

    for (const s of filas) {
      const vencida = estadoSuscripcion(s, hoy) === 'vencida';
      const actual = estado.get(s.empresa_id);
      if (vencida && s.suspension_automatica && actual === 'activa') {
        await this.cambiarEstado(s.empresa_id, 'suspendida', 'falta_pago');
        suspendidas.push(s.empresa_id);
      } else if (!vencida && actual === 'suspendida' && s.motivo_suspension === 'falta_pago') {
        await this.cambiarEstado(s.empresa_id, 'activa', null);
        reactivadas.push(s.empresa_id);
      }
    }
    if (suspendidas.length || reactivadas.length) this.log.log(`Suspendidas: ${suspendidas.length} · reactivadas: ${reactivadas.length}`);
    return { suspendidas, reactivadas };
  }

  async cambiarEstado(empresaId: string, estado: 'activa' | 'suspendida', motivo: 'falta_pago' | 'manual' | null, quien: { usuarioId: string | null; ip?: string | null; agente?: string | null } = { usuarioId: null }) {
    await this.db.enEmpresa(empresaId, async (tx) => {
      await tx.updateTable('empresa').set({ estado }).where('id', '=', empresaId).execute();
      // La empresa ve en su propia auditoría que Araújo Tech cambió su estado.
      await auditar(tx, { empresaId, usuarioId: null, cuentaId: null }, {
        accion: estado === 'suspendida' ? 'suspension' : 'reactivacion',
        entidad: 'empresa',
        entidadId: empresaId,
        despues: { estado, motivo, por: 'Araújo Tech Sistemas' },
      });
      await tx.updateTable('master.suscripcion').set({ motivo_suspension: estado === 'suspendida' ? motivo : null }).where('empresa_id', '=', empresaId).execute();
      await auditarMaster(tx, quien, { accion: estado === 'suspendida' ? 'suspender' : 'reactivar', entidad: 'empresa', entidadId: empresaId, despues: { motivo } });
    });
  }
}
