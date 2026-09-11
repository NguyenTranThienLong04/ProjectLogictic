import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  messageId: string;
}

export abstract class EmailSender {
  abstract readonly enabled: boolean;
  abstract send(message: EmailMessage): Promise<void>;
}

@Injectable()
export class SmtpEmailSender implements EmailSender {
  readonly enabled: boolean;
  private readonly from: string;
  private readonly transporter: Transporter | null;

  constructor(config: ConfigService) {
    this.enabled = config.getOrThrow<string>('EMAIL_DELIVERY_ENABLED') === 'true';
    this.from = config.getOrThrow<string>('EMAIL_FROM');
    this.transporter = this.enabled
      ? nodemailer.createTransport({
          host: config.getOrThrow<string>('SMTP_HOST'),
          port: Number(config.getOrThrow<string>('SMTP_PORT')),
          secure: config.getOrThrow<string>('SMTP_SECURE') === 'true',
          auth: {
            user: config.getOrThrow<string>('SMTP_USER'),
            pass: config.getOrThrow<string>('SMTP_PASSWORD'),
          },
          connectionTimeout: Number(config.getOrThrow<string>('SMTP_CONNECTION_TIMEOUT_MS')),
          greetingTimeout: Number(config.getOrThrow<string>('SMTP_GREETING_TIMEOUT_MS')),
          socketTimeout: Number(config.getOrThrow<string>('SMTP_SOCKET_TIMEOUT_MS')),
        })
      : null;
  }

  async send(message: EmailMessage): Promise<void> {
    if (!this.transporter) return;
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      messageId: message.messageId,
      headers: { 'X-Idempotency-Key': message.messageId },
    });
  }
}
