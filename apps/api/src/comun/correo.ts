import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config';

export interface Mensaje {
  para: string;
  asunto: string;
  texto: string;
  adjuntos?: { nombre: string; contenido: Buffer | string; tipo: string }[];
}

/**
 * Correo transaccional. Sin SMTP_URL los mensajes se escriben en el log (desarrollo).
 * En pruebas, `enviados` permite verificar el contenido.
 */
@Injectable()
export class Correo {
  private readonly log = new Logger('Correo');
  private transporte?: Transporter;
  readonly enviados: Mensaje[] = [];

  constructor() {
    const url = config().SMTP_URL;
    if (url) this.transporte = nodemailer.createTransport(url);
  }

  async enviar(m: Mensaje): Promise<void> {
    if (config().NODE_ENV === 'test') {
      this.enviados.push(m);
      return;
    }
    if (!this.transporte) {
      this.log.log(`[sin SMTP] Para: ${m.para} · ${m.asunto}${m.adjuntos?.length ? ` · ${m.adjuntos.length} adjuntos` : ''}\n${m.texto}`);
      return;
    }
    await this.transporte.sendMail({
      from: config().MAIL_FROM,
      to: m.para,
      subject: m.asunto,
      text: m.texto,
      attachments: m.adjuntos?.map((a) => ({ filename: a.nombre, content: a.contenido, contentType: a.tipo })),
    });
  }
}
