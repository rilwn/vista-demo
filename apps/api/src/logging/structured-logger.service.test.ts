import type { AppEnvironment } from '@vista/config';
import type { DestinationStream } from 'pino';
import { describe, expect, it } from 'vitest';

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
});
