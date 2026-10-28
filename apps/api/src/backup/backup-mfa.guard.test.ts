import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { BackupMfaGuard } from './backup-mfa.guard.js';

describe('BackupMfaGuard', () => {
  it('requires a verified second factor at the API boundary', () => {
    const guard = new BackupMfaGuard();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          authentication: { twoFactorVerified: false },
        }),
      }),
    } as ExecutionContext;

    expect(() => guard.canActivate(context)).toThrow(
      'A verified two-factor session is required for the Recovery console.',
    );
  });

  it('allows Recovery requests only after the second factor is verified', () => {
    const guard = new BackupMfaGuard();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          authentication: { twoFactorVerified: true },
        }),
      }),
    } as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
  });
});
