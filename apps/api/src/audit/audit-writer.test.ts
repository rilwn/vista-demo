import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { appendAuditEvent as serviceWriter } from './audit.service.js';
import { appendAuditEvent, calculateEventHash } from './audit-writer.js';

describe('framework-independent audit writer', () => {
  it('preserves the existing canonical hash format, including nested keys and Unicode', () => {
    const expected = createHash('sha256')
      .update(
        '{"action":"test.create","after":{"amount":"12.3400","currency":"EUR"},"metadata":{"a":1,"z":["България",null,true]}}',
      )
      .digest('hex');
    expect(
      calculateEventHash({
        metadata: { z: ['България', undefined, true], a: 1 },
        after: { currency: 'EUR', amount: '12.3400' },
        action: 'test.create',
      }),
    ).toBe(expected);
  });
  it('keeps the previous service export compatible with the shared writer', () => {
    expect(serviceWriter).toBe(appendAuditEvent);
  });
});
