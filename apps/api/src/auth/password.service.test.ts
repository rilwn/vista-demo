import type { AppEnvironment } from '@vista/config';
import { describe, expect, it } from 'vitest';

import { ApiErrorException } from '../common/api-error.exception.js';
import { PasswordService } from './password.service.js';

const environment = {
  PASSWORD_EXPIRY_DAYS: 0,
  PASSWORD_HISTORY_COUNT: 5,
  PASSWORD_MIN_LENGTH: 12,
  PASSWORD_REQUIRE_LOWERCASE: true,
  PASSWORD_REQUIRE_NUMBER: true,
  PASSWORD_REQUIRE_SYMBOL: true,
  PASSWORD_REQUIRE_UPPERCASE: true,
} as AppEnvironment;

describe('PasswordService', () => {
  const passwords = new PasswordService(environment);

  it('stores a salted, versioned scrypt hash and verifies it', async () => {
    const hash = await passwords.hash('Correct-Horse-7');

    expect(hash).toMatch(/^scrypt\$v1\$/u);
    expect(hash).not.toContain('Correct-Horse-7');
    await expect(passwords.verify('Correct-Horse-7', hash)).resolves.toBe(true);
    await expect(passwords.verify('Incorrect-Horse-7', hash)).resolves.toBe(false);
  });

  it('rejects passwords outside the configured policy without echoing them', async () => {
    try {
      await passwords.hash('secret');
      expect.fail('Expected the password policy to reject the value');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain('secret');
    }
  });

  it('calculates expiration only when the configured policy enables it', () => {
    expect(passwords.passwordExpiresAt(new Date('2026-08-06T00:00:00.000Z'))).toBeUndefined();
    const expiring = new PasswordService({ ...environment, PASSWORD_EXPIRY_DAYS: 30 });

    expect(expiring.passwordExpiresAt(new Date('2026-08-06T00:00:00.000Z'))?.toISOString()).toBe(
      '2026-09-05T00:00:00.000Z',
    );
  });

  it('exposes the active policy without credential material and targets the requested field', async () => {
    expect(passwords.policySummary()).toEqual({
      expirationDays: 0,
      historyCount: 5,
      minimumLength: 12,
      requireLowercase: true,
      requireNumber: true,
      requireSymbol: true,
      requireUppercase: true,
    });
    try {
      await passwords.hash('weak', 'newPassword');
      expect.fail('Expected the password policy to reject the value');
    } catch (error) {
      if (!(error instanceof ApiErrorException)) {
        throw error;
      }
      const response = error.getResponse();
      if (typeof response === 'string') {
        throw new Error('Expected a structured password-policy response');
      }
      const policyResponse = response as {
        code?: string;
        details?: Array<{ field?: string }>;
      };
      expect(policyResponse.code).toBe('PASSWORD_POLICY_VIOLATION');
      expect(policyResponse.details).not.toHaveLength(0);
      expect(policyResponse.details?.every((detail) => detail.field === 'newPassword')).toBe(true);
    }
  });
});
