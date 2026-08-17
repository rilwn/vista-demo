import { describe, expect, it } from 'vitest';

import type { AuthenticationContext } from '../auth/authentication.types.js';
import { serviceVisibilityAccountId } from './service.service.js';

function authentication(permissions: AuthenticationContext['permissions']): AuthenticationContext {
  return {
    accountId: '4e4c1a34-5184-40ef-9fde-7fc6a0ef399a',
    displayName: 'Service test user',
    email: 'service.test@example.invalid',
    employeeId: 'cae4ab89-4b05-447c-8c57-5b9869c25342',
    isAdministrative: false,
    permissions,
    sessionId: 'b1b3a65d-1be7-4fdc-a72a-f6a37ad1b539',
    twoFactorVerified: false,
  };
}

describe('serviceVisibilityAccountId', () => {
  it('scopes a technician without service approval to its own account', () => {
    const context = authentication([
      { action: 'edit', module: 'erp.service' },
      { action: 'view', module: 'erp.service' },
    ]);

    expect(serviceVisibilityAccountId(context)).toBe(context.accountId);
  });

  it('retains all-work scope only for an approving service role', () => {
    const approvingPermissionSets: AuthenticationContext['permissions'][] = [
      [{ action: 'approve', module: 'erp.service' }],
      [{ action: 'approve', module: '*' }],
      [{ action: '*', module: 'erp.service' }],
      [{ action: '*', module: '*' }],
    ];
    for (const permissions of approvingPermissionSets)
      expect(serviceVisibilityAccountId(authentication(permissions))).toBeUndefined();
  });
});
