import { connect as connectTls, type TLSSocket } from 'node:tls';
import { createConnection, type Socket } from 'node:net';
import { Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';

import { APP_ENVIRONMENT } from '../config/config.module.js';

export interface SmtpAttachment {
  content: Buffer;
  fileName: string;
  mediaType: string;
}

export interface SmtpMessage {
  attachment?: SmtpAttachment;
  messageId: string;
  subject: string;
  text: string;
  to: string;
}

interface SmtpReply {
  code: number;
  lines: string[];
}

@Injectable()
export class SmtpMailerService {
  constructor(@Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment) {}

  async send(message: SmtpMessage): Promise<void> {
    validateMessage(message);
    let socket: Socket | TLSSocket;
    if (this.environment.SMTP_TLS_MODE === 'implicit') {
      socket = connectTls({
        host: this.environment.SMTP_HOST,
        port: this.environment.SMTP_PORT,
        servername: this.environment.SMTP_HOST,
      });
      await waitForConnect(socket, 'secureConnect');
    } else {
      socket = createConnection({
        host: this.environment.SMTP_HOST,
        port: this.environment.SMTP_PORT,
      });
      await waitForConnect(socket, 'connect');
    }
    socket.setTimeout(20_000, () => socket.destroy(new Error('SMTP connection timed out.')));
    let session = new SmtpSession(socket);
    try {
      expectCode(await session.readReply(), [220]);
      await command(session, `EHLO ${ehloName(this.environment.SMTP_HOST)}`, [250]);

      if (this.environment.SMTP_TLS_MODE === 'starttls') {
        await command(session, 'STARTTLS', [220]);
        session.detach();
        const secure = connectTls({
          socket,
          servername: this.environment.SMTP_HOST,
        });
        await waitForConnect(secure, 'secureConnect');
        socket = secure;
        socket.setTimeout(20_000, () => socket.destroy(new Error('SMTP connection timed out.')));
        session = new SmtpSession(socket);
        await command(session, `EHLO ${ehloName(this.environment.SMTP_HOST)}`, [250]);
      }

      if (this.environment.SMTP_USERNAME) {
        const credentials = Buffer.from(
          `\u0000${this.environment.SMTP_USERNAME}\u0000${this.environment.SMTP_PASSWORD}`,
        ).toString('base64');
        const authReply = await session.writeCommand(`AUTH PLAIN ${credentials}`);
        if (authReply.code === 334) expectCode(await session.writeCommand(credentials), [235]);
        else expectCode(authReply, [235]);
      }

      await command(session, `MAIL FROM:<${this.environment.SMTP_FROM}>`, [250]);
      await command(session, `RCPT TO:<${message.to}>`, [250, 251]);
      await command(session, 'DATA', [354]);
      expectCode(
        await session.writeData(serializeSmtpMessage(message, this.environment.SMTP_FROM)),
        [250],
      );
      await command(session, 'QUIT', [221]);
    } finally {
      session.detach();
      socket.destroy();
    }
  }
}

class SmtpSession {
  private buffer = '';
  private responseLines: string[] = [];
  private readonly replies: SmtpReply[] = [];
  private readonly waiters: Array<{
    reject: (error: Error) => void;
    resolve: (reply: SmtpReply) => void;
  }> = [];
  private failure: Error | undefined;

  constructor(private readonly socket: Socket | TLSSocket) {
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('close', this.onClose);
  }

  async readReply(): Promise<SmtpReply> {
    const reply = this.replies.shift();
    if (reply) return reply;
    if (this.failure) throw this.failure;
    return new Promise<SmtpReply>((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  async writeCommand(value: string): Promise<SmtpReply> {
    this.socket.write(`${value}\r\n`);
    return this.readReply();
  }

  async writeData(value: string): Promise<SmtpReply> {
    const dotStuffed = value.replace(/(^|\r\n)\./gu, '$1..');
    this.socket.write(`${dotStuffed}\r\n.\r\n`);
    return this.readReply();
  }

  detach(): void {
    this.socket.off('data', this.onData);
    this.socket.off('error', this.onError);
    this.socket.off('close', this.onClose);
  }

  private readonly onData = (chunk: Buffer): void => {
    this.buffer += chunk.toString('utf8');
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/u, '');
      this.buffer = this.buffer.slice(newline + 1);
      const match = /^(\d{3})([ -])(.*)$/u.exec(line);
      if (match) {
        this.responseLines.push(line);
        if (match[2] === ' ') {
          const reply = { code: Number(match[1]), lines: this.responseLines };
          this.responseLines = [];
          const waiter = this.waiters.shift();
          if (waiter) waiter.resolve(reply);
          else this.replies.push(reply);
        }
      }
      newline = this.buffer.indexOf('\n');
    }
  };

  private readonly onError = (error: Error): void => {
    this.failure = new Error(`SMTP delivery failed (${error.constructor.name}).`);
    for (const waiter of this.waiters.splice(0)) waiter.reject(this.failure);
  };

  private readonly onClose = (): void => {
    if (!this.failure) this.failure = new Error('SMTP server closed the connection unexpectedly.');
    for (const waiter of this.waiters.splice(0)) waiter.reject(this.failure);
  };
}

function command(session: SmtpSession, value: string, expectedCodes: number[]): Promise<void> {
  return session.writeCommand(value).then((reply) => expectCode(reply, expectedCodes));
}

function expectCode(reply: SmtpReply, expectedCodes: number[]): void {
  if (!expectedCodes.includes(reply.code))
    throw new Error(`SMTP server rejected a delivery step (response ${reply.code}).`);
}

export function serializeSmtpMessage(message: SmtpMessage, from: string): string {
  validateMessage(message);
  const headers = [
    `From: <${from}>`,
    `To: <${message.to}>`,
    `Subject: =?UTF-8?B?${Buffer.from(message.subject, 'utf8').toString('base64')}?=`,
    `Message-ID: <${message.messageId}>`,
    'MIME-Version: 1.0',
  ];
  if (!message.attachment) {
    headers.push(
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(Buffer.from(message.text, 'utf8').toString('base64')),
    );
    return `${headers.join('\r\n')}\r\n`;
  }
  const boundary = `vista-${message.messageId.replace(/[^A-Za-z0-9]/gu, '').slice(0, 36)}`;
  const fileName = encodeURIComponent(safeFileName(message.attachment.fileName));
  headers.push(
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(Buffer.from(message.text, 'utf8').toString('base64')),
    `--${boundary}`,
    `Content-Type: ${message.attachment.mediaType}; name*=UTF-8''${fileName}`,
    `Content-Disposition: attachment; filename*=UTF-8''${fileName}`,
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(message.attachment.content.toString('base64')),
    `--${boundary}--`,
  );
  return `${headers.join('\r\n')}\r\n`;
}

function validateMessage(message: SmtpMessage): void {
  for (const [field, value] of Object.entries({
    to: message.to,
    subject: message.subject,
    messageId: message.messageId,
  })) {
    if (!value || hasSmtpControl(value)) throw new Error(`Invalid email ${field}.`);
  }
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(message.to))
    throw new Error('Invalid email recipient.');
  if (message.attachment && message.attachment.content.length > 8 * 1024 * 1024)
    throw new Error('Email attachment exceeds the eight-megabyte limit.');
}

function safeFileName(value: string): string {
  return (
    value
      .replace(/[\\/\r\n]/gu, '_')
      .replaceAll(String.fromCharCode(0), '_')
      .slice(0, 120) || 'document.pdf'
  );
}

function hasSmtpControl(value: string): boolean {
  return Array.from(value).some(
    (character) => character === '\r' || character === '\n' || character.charCodeAt(0) === 0,
  );
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/gu)?.join('\r\n') ?? '';
}

function ehloName(host: string): string {
  return host.replace(/[^A-Za-z0-9.-]/gu, '').slice(0, 100) || 'vista.local';
}

async function waitForConnect(socket: Socket | TLSSocket, event: 'connect' | 'secureConnect') {
  await new Promise<void>((resolve, reject) => {
    socket.once(event, resolve);
    socket.once('error', (error) => {
      const errorName = error instanceof Error ? error.name : 'unknown error';
      reject(new Error(`SMTP connection failed (${errorName}).`));
    });
  });
}
