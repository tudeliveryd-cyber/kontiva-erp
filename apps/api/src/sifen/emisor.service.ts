import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import xmlgen from 'facturacionelectronicapy-xmlgen';
import { sql } from 'kysely';
import { config } from '../config';
import { Db } from '../db/database';
import type { EstadoDocumentoElectronico } from '../db/tipos';
import { consultarLote, enviarEvento, enviarLote, ErrorSifen } from './cliente';
import { cargarFe, type FeActiva } from './emision';
import { firmarEvento } from './firma';

const ESTADOS: Record<string, EstadoDocumentoElectronico> = {
  Aprobado: 'aprobado',
  'Aprobado con observación': 'aprobado_obs',
  Rechazado: 'rechazado',
};

/** Espera creciente entre reintentos por fallas de conexión: 30 s, 1, 2, 4… hasta 1 hora. */
const espera = (intentos: number) => Math.min(30_000 * 2 ** Math.max(0, intentos - 1), 3_600_000);
const nuevoId = () => Number(String(Date.now()).slice(-13));

/**
 * Emisor en segundo plano: envía a SIFEN los documentos pendientes en lotes de hasta 50
 * y consulta el resultado de los lotes enviados. La red nunca se usa dentro de una transacción.
 */
@Injectable()
export class EmisorSifen implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('SIFEN');
  private temporizador: NodeJS.Timeout | null = null;
  private trabajando = false;

  constructor(private readonly db: Db) {}

  onModuleInit() {
    if (config().SIFEN_EMISOR === 'activo' && config().NODE_ENV !== 'test') {
      this.temporizador = setInterval(() => void this.ciclo(), config().SIFEN_INTERVALO_MS);
    }
  }

  onModuleDestroy() {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  private async ciclo() {
    if (this.trabajando) return;
    this.trabajando = true;
    try {
      const { rows } = await sql<{ fe_empresas_con_cola: string }>`SELECT fe_empresas_con_cola()`.execute(this.db.k);
      for (const r of rows) await this.procesarEmpresa(r.fe_empresas_con_cola).catch((e) => this.log.error(`Empresa ${r.fe_empresas_con_cola}: ${(e as Error).message}`));
    } catch (e) {
      this.log.error((e as Error).message);
    } finally {
      this.trabajando = false;
    }
  }

  /** Un ciclo completo para una empresa: enviar pendientes y consultar lotes. Devuelve lo hecho. */
  async procesarEmpresa(empresaId: string) {
    const fe = await this.db.enEmpresa(empresaId, (tx) => cargarFe(tx, true));
    if (!fe) return { enviados: 0, consultados: 0 };
    const enviados = await this.enviarPendientes(empresaId, fe);
    const consultados = await this.consultarLotes(empresaId, fe);
    return { enviados, consultados };
  }

  private async enviarPendientes(empresaId: string, fe: FeActiva): Promise<number> {
    // Reserva (lease) de hasta 50 documentos del mismo tipo: otro proceso no los toma por 2 minutos.
    const lote = await this.db.enEmpresa(empresaId, async (tx) => {
      const primero = await tx
        .selectFrom('documento_electronico')
        .select('tipo_documento')
        .where('estado', '=', 'pendiente')
        .where('proximo_intento', '<=', new Date())
        .orderBy('creado_en')
        .limit(1)
        .executeTakeFirst();
      if (!primero) return [];
      const docs = await tx
        .selectFrom('documento_electronico')
        .select(['id', 'xml_firmado', 'intentos'])
        .where('estado', '=', 'pendiente')
        .where('tipo_documento', '=', primero.tipo_documento)
        .where('proximo_intento', '<=', new Date())
        .orderBy('creado_en')
        .limit(50)
        .forUpdate()
        .skipLocked()
        .execute();
      if (docs.length) {
        await tx
          .updateTable('documento_electronico')
          .set({ proximo_intento: new Date(Date.now() + 120_000) })
          .where('id', 'in', docs.map((d) => d.id))
          .execute();
      }
      return docs;
    });
    if (!lote.length) return 0;
    const ids = lote.map((d) => d.id);
    try {
      const r = await enviarLote(fe.ambiente, nuevoId(), lote.map((d) => d.xml_firmado), fe.cert);
      await this.db.enEmpresa(empresaId, async (tx) => {
        if (r.codigo === '0300' && r.protocolo) {
          await tx
            .updateTable('documento_electronico')
            .set({ estado: 'enviado', lote_protocolo: r.protocolo, enviado_en: new Date(), respuesta_codigo: r.codigo, respuesta_mensaje: r.mensaje, proximo_intento: new Date(Date.now() + Math.max(r.tiempoProceso, 1) * 1000) })
            .where('id', 'in', ids)
            .execute();
        } else {
          // Lote no encolado (0301 u otro): queda pendiente y se reintenta más tarde.
          await tx
            .updateTable('documento_electronico')
            .set((eb) => ({ respuesta_codigo: r.codigo, respuesta_mensaje: r.mensaje, intentos: eb('intentos', '+', 1), proximo_intento: new Date(Date.now() + espera(lote[0]!.intentos + 1)) }))
            .where('id', 'in', ids)
            .execute();
        }
      });
      return r.codigo === '0300' ? ids.length : 0;
    } catch (e) {
      const mensaje = e instanceof ErrorSifen ? e.message : `Error: ${(e as Error).message}`;
      await this.db.enEmpresa(empresaId, (tx) =>
        tx
          .updateTable('documento_electronico')
          .set((eb) => ({ respuesta_mensaje: mensaje, intentos: eb('intentos', '+', 1), proximo_intento: new Date(Date.now() + espera(lote[0]!.intentos + 1)) }))
          .where('id', 'in', ids)
          .execute(),
      );
      this.log.warn(`Lote no enviado (${ids.length} documentos): ${mensaje}`);
      return 0;
    }
  }

  private async consultarLotes(empresaId: string, fe: FeActiva): Promise<number> {
    const lotes = await this.db.enEmpresa(empresaId, (tx) =>
      tx
        .selectFrom('documento_electronico')
        .select('lote_protocolo')
        .distinct()
        .where('estado', '=', 'enviado')
        .where('proximo_intento', '<=', new Date())
        .where('lote_protocolo', 'is not', null)
        .limit(10)
        .execute(),
    );
    let n = 0;
    for (const { lote_protocolo } of lotes) {
      const protocolo = lote_protocolo!;
      try {
        const r = await consultarLote(fe.ambiente, nuevoId(), protocolo, fe.cert);
        await this.db.enEmpresa(empresaId, async (tx) => {
          if (r.codigo === '0362') {
            for (const res of r.resultados) {
              const estado = ESTADOS[res.estado] ?? 'rechazado';
              await tx
                .updateTable('documento_electronico')
                .set({
                  estado,
                  protocolo_autorizacion: res.protocolo,
                  respuesta_codigo: res.mensajes[0]?.codigo ?? null,
                  respuesta_mensaje: res.mensajes.map((m) => `${m.codigo} ${m.mensaje}`).join(' · ') || res.estado,
                  procesado_en: new Date(),
                })
                .where('cdc', '=', res.cdc)
                .where('lote_protocolo', '=', protocolo)
                .execute();
              n++;
            }
          } else if (r.codigo === '0361') {
            await tx.updateTable('documento_electronico').set({ proximo_intento: new Date(Date.now() + 15_000) }).where('lote_protocolo', '=', protocolo).where('estado', '=', 'enviado').execute();
          } else {
            // 0360 lote inexistente u otro: se reenvían los documentos.
            await tx
              .updateTable('documento_electronico')
              .set({ estado: 'pendiente', lote_protocolo: null, respuesta_codigo: r.codigo, respuesta_mensaje: r.mensaje, proximo_intento: new Date() })
              .where('lote_protocolo', '=', protocolo)
              .where('estado', '=', 'enviado')
              .execute();
          }
        });
      } catch (e) {
        const mensaje = (e as Error).message;
        await this.db.enEmpresa(empresaId, (tx) =>
          tx.updateTable('documento_electronico').set({ respuesta_mensaje: mensaje, proximo_intento: new Date(Date.now() + 60_000) }).where('lote_protocolo', '=', protocolo).where('estado', '=', 'enviado').execute(),
        );
      }
    }
    return n;
  }
}

/** Evento de cancelación de un DE aprobado (síncrono). Devuelve el resultado de SIFEN. */
export async function cancelarEnSifen(fe: FeActiva, empresa: { ruc: string; razonSocial: string }, cdc: string, motivo: string) {
  const params = { version: 150, ruc: empresa.ruc, razonSocial: empresa.razonSocial, actividadesEconomicas: [fe.actividad], timbradoNumero: fe.timbrado.numero, timbradoFecha: fe.timbrado.fecha, tipoContribuyente: fe.tipoContribuyente, establecimientos: [] };
  const sobre = await (xmlgen as unknown as { generateXMLEventoCancelacion(id: number, p: object, d: object): Promise<string> }).generateXMLEventoCancelacion(nuevoId(), params, { cdc, motivo });
  const firmado = firmarEvento(sobre.replace(/>\s+</g, '><').trim(), fe.cert);
  const [r] = await enviarEvento(fe.ambiente, firmado, fe.cert);
  return r ?? { cdc, estado: 'Rechazado', protocolo: null, mensajes: [{ codigo: '', mensaje: 'Sin respuesta de SIFEN' }] };
}

/** Evento de inutilización de un rango de números de un tipo de documento (síncrono). */
export async function inutilizarEnSifen(
  fe: FeActiva,
  empresa: { ruc: string; razonSocial: string },
  r: { tipoDocumento: number; establecimiento: string; punto: string; desde: number; hasta: number; motivo: string },
) {
  const params = { version: 150, ruc: empresa.ruc, razonSocial: empresa.razonSocial, actividadesEconomicas: [fe.actividad], timbradoNumero: fe.timbrado.numero, timbradoFecha: fe.timbrado.fecha, tipoContribuyente: fe.tipoContribuyente, establecimientos: [] };
  const sobre = await (xmlgen as unknown as { generateXMLEventoInutilizacion(id: number, p: object, d: object): Promise<string> }).generateXMLEventoInutilizacion(nuevoId(), params, { timbrado: fe.timbrado.numero, ...r });
  const firmado = firmarEvento(sobre.replace(/>\s+</g, '><').trim(), fe.cert);
  const [res] = await enviarEvento(fe.ambiente, firmado, fe.cert);
  return res ?? { cdc: '', estado: 'Rechazado', protocolo: null, mensajes: [{ codigo: '', mensaje: 'Sin respuesta de SIFEN' }] };
}
