import type { AppEnvironment } from '@vista/config';
import type { DestinationStream } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { StructuredLogger } from './structured-logger.service.js';

describe('StructuredLogger', () => {
  it('emits structured events without credentials, tokens, PINs, or card data', () => {
    const lines: string[] = [];
    const destination: DestinationStream = { write: (message) => lines.push(message) };
    const logger = new StructuredLogger(
      {
        LOG_LEVEL: 'info',
        NODE_ENV: 'test',
      } as AppEnvironment,
      destination,
    );

    logger.event('info', 'security.redaction.test', {
      authorization: 'Bearer visible-token',
      cardNumber: '4111111111111111',
      database: 'postgresql://vista:visible-password@localhost:5432/vista',
      nested: { password: 'visible-password', pin: '1234' },
      safe: 'retained',
    });

    expect(lines).toHaveLength(1);
    const output = lines[0] ?? '';
    expect(output).toContain('security.redaction.test');
    expect(output).toContain('retained');
    expect(output).not.toContain('visible-token');
    expect(output).not.toContain('visible-password');
    expect(output).not.toContain('4111111111111111');
    expect(output).not.toContain('1234');
  });

  it('preserves the generated repeat-job timestamp without relaxing other redaction', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-26T13:13:52.970Z'));
    try {
      const lines: string[] = [];
      const logger = new StructuredLogger(
        { LOG_LEVEL: 'info', NODE_ENV: 'test' } as AppEnvironment,
        { write: (message) => lines.push(message) },
      );
      const jobId = `repeat:crm.sla.frequent:${new Date('2026-10-26T13:15:00.000Z').getTime()}`;
      logger.event('info', 'job.schedule.registered', {
        jobId,
        nested: { jobId, cardNumber: '4111111111111', token: 'private-token' },
        suspicious: { jobId: jobId.replace('crm.sla.frequent', 'cards.4111111111111111') },
        message: 'Card 4111 1111 1111 1111',
        unrelated: '1793020500000',
      });
      const output = lines[0]!;
      expect(output).toContain(jobId);
      expect(output).not.toContain('4111111111111');
      expect(output).not.toContain('4111 1111 1111 1111');
      expect(output).not.toContain('private-token');
      expect((JSON.parse(output) as Record<string, unknown>)['unrelated']).toBe('[REDACTED-CARD]');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not treat card numbers, credentials or arbitrary numeric IDs as scheduled jobs', () => {
    const lines: string[] = [];
    const logger = new StructuredLogger({ LOG_LEVEL: 'info', NODE_ENV: 'test' } as AppEnvironment, {
      write: (message) => lines.push(message),
    });
    for (const jobId of [
      '4111111111111',
      'repeat:crm.sla.frequent:4111111111111',
      'repeat:crm.sla.frequent:4111111111111111',
      'repeat:crm.sla.frequent:4111-1111-1111-1111',
      'repeat:password=private-password:1793020500000',
    ])
      logger.event('info', 'job.failed', { jobId });
    const output = lines.join('');
    expect(output).not.toContain('4111111111111');
    expect(output).not.toContain('4111111111111111');
    expect(output).not.toContain('4111-1111-1111-1111');
    expect(output).not.toContain('private-password');
  });
});
