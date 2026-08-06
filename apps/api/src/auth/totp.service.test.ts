import type { AppEnvironment } from '@vista/config';
import { describe, expect, it } from 'vitest';

import { TotpService } from './totp.service.js';

const service = new TotpService({
  TOTP_ENCRYPTION_KEY: 'test-encryption-key-with-at-least-32-characters',
  TOTP_ISSUER: 'Vista Service',
  TOTP_WINDOW_STEPS: 0,
} as AppEnvironment);

describe('TotpService', () => {
  it('matches the six-digit RFC 6238 test value', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

    expect(service.generateCode(secret, new Date(59_000))).toBe('287082');
  });

  it('encrypts factor material at rest and verifies a current code', () => {
    const secret = service.generateSecret();
    const encrypted = service.encryptSecret(secret);
    const now = new Date('2026-08-06T12:00:00.000Z');

    expect(encrypted.toString('utf8')).not.toContain(secret);
    expect(service.verify(service.generateCode(secret, now), encrypted, now)).toBe(true);
    expect(service.verify('000000', encrypted, now)).toBe(false);
  });
});
