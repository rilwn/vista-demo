import { describe, expect, it } from 'vitest';

import {
  assertKnownPermission,
  hasPermission,
  validatePasswordPolicy,
  type PasswordPolicy,
  type Permission,
} from './index';

describe('hasPermission', () => {
  it('matches the exact module and action', () => {
    const granted: Permission[] = [{ module: 'erp.warehouse', action: 'view' }];

    expect(hasPermission(granted, { module: 'erp.warehouse', action: 'view' })).toBe(true);
    expect(hasPermission(granted, { module: 'erp.warehouse', action: 'edit' })).toBe(false);
    expect(hasPermission(granted, { module: 'crm', action: 'view' })).toBe(false);
  });

  it('supports deliberate module and action wildcards', () => {
    const granted: Permission[] = [
      { module: 'backup', action: '*' },
      { module: '*', action: 'view' },
    ];

    expect(hasPermission(granted, { module: 'backup', action: 'approve' })).toBe(true);
    expect(hasPermission(granted, { module: 'pos', action: 'view' })).toBe(true);
    expect(hasPermission(granted, { module: 'pos', action: 'delete' })).toBe(false);
  });
});

describe('assertKnownPermission', () => {
  it('rejects permission strings outside the controlled vocabulary', () => {
    expect(() => assertKnownPermission({ module: 'crm', action: 'view' })).not.toThrow();
    expect(() =>
      assertKnownPermission({
        module: 'unknown' as Permission['module'],
        action: 'view',
      }),
    ).toThrow('Unknown permission');
  });
});

describe('validatePasswordPolicy', () => {
  const policy: PasswordPolicy = {
    minimumLength: 12,
    requireLowercase: true,
    requireNumber: true,
    requireSymbol: true,
    requireUppercase: true,
  };

  it('accepts a password satisfying every configured control', () => {
    expect(validatePasswordPolicy('Correct-Horse-7', policy)).toEqual([]);
  });

  it('reports every unmet configured control without exposing the password', () => {
    const violations = validatePasswordPolicy('short', policy);

    expect(violations.map(({ code }) => code)).toEqual([
      'minimum_length',
      'uppercase_required',
      'number_required',
      'symbol_required',
    ]);
    expect(JSON.stringify(violations)).not.toContain('short');
  });
});
