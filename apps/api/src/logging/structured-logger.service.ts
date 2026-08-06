import { Inject, Injectable, Optional, type LoggerService } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import pino, { type DestinationStream, type Logger } from 'pino';

import { APP_ENVIRONMENT } from '../config/config.module.js';

export const LOG_DESTINATION = Symbol('LOG_DESTINATION');

type LogLevel = 'debug' | 'error' | 'fatal' | 'info' | 'trace' | 'warn';

const sensitiveKey =
  /(?:authorization|card(?:number)?|cookie|credential|cvc|cvv|pan|pass(?:word)?|pin|secret|token)/i;

@Injectable()
export class StructuredLogger implements LoggerService {
  private readonly logger: Logger;

  constructor(
    @Inject(APP_ENVIRONMENT) environment: AppEnvironment,
    @Optional() @Inject(LOG_DESTINATION) destination?: DestinationStream,
  ) {
    this.logger = pino(
      {
        base: {
          environment: environment.NODE_ENV,
          service: 'vista-api',
          version: '0.1.0',
        },
        level: environment.LOG_LEVEL,
        redact: {
          censor: '[REDACTED]',
          paths: [
            'authorization',
            'cookie',
            'password',
            'passwordHash',
            'pin',
            'token',
            '*.authorization',
            '*.cookie',
            '*.password',
            '*.passwordHash',
            '*.pin',
            '*.token',
          ],
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      destination,
    );
  }

  debug(message: unknown, ...optionalParameters: unknown[]): void {
    this.write('debug', message, optionalParameters);
  }

  error(message: unknown, ...optionalParameters: unknown[]): void {
    this.write('error', message, optionalParameters);
  }

  fatal(message: unknown, ...optionalParameters: unknown[]): void {
    this.write('fatal', message, optionalParameters);
  }

  log(message: unknown, ...optionalParameters: unknown[]): void {
    this.write('info', message, optionalParameters);
  }

  verbose(message: unknown, ...optionalParameters: unknown[]): void {
    this.write('trace', message, optionalParameters);
  }

  warn(message: unknown, ...optionalParameters: unknown[]): void {
    this.write('warn', message, optionalParameters);
  }

  event(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
    this.logger[level](sanitizeRecord({ ...fields, event }), event);
  }

  private write(level: LogLevel, message: unknown, optionalParameters: unknown[]): void {
    const context = extractContext(optionalParameters);
    const fields: Record<string, unknown> = {
      ...(context === undefined ? {} : { context }),
      ...(optionalParameters.length === 0
        ? {}
        : { parameters: optionalParameters.map((parameter) => sanitizeValue(parameter)) }),
    };

    if (isRecord(message)) {
      this.logger[level](sanitizeRecord({ ...message, ...fields }));
      return;
    }

    this.logger[level](sanitizeRecord(fields), sanitizeText(String(message)));
  }
}

function extractContext(parameters: unknown[]): string | undefined {
  const candidate = parameters.at(-1);
  return typeof candidate === 'string' ? sanitizeText(candidate) : undefined;
}

function sanitizeRecord(record: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(record) as Record<string, unknown>;
}

function sanitizeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') {
    return sanitizeText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, seen));
  }
  if (!isRecord(value)) {
    return value;
  }
  if (seen.has(value)) {
    return '[CIRCULAR]';
  }

  seen.add(value);
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    sanitized[key] = sensitiveKey.test(key) ? '[REDACTED]' : sanitizeValue(entry, seen);
  }
  seen.delete(value);
  return sanitized;
}

function sanitizeText(value: string): string {
  return value
    .replace(/(:\/\/[^:/\s]+):[^@\s]+@/gu, '$1:[REDACTED]@')
    .replace(/\bBearer\s+[^\s,;]+/giu, 'Bearer [REDACTED]')
    .replace(
      /\b(password|secret|token|authorization|cookie|pin|pan|cardNumber)\s*([=:])\s*["']?[^\s,"']+/giu,
      '$1$2[REDACTED]',
    )
    .replace(/\b(?:\d[ -]?){13,19}\b/gu, '[REDACTED-CARD]');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
