export const permissionActions = ['view', 'create', 'edit', 'delete', 'approve'] as const;

export type PermissionAction = (typeof permissionActions)[number];

export const permissionModules = [
  'platform',
  'platform.organization',
  'erp.finance',
  'erp.procurement',
  'erp.warehouse',
  'erp.sales',
  'erp.service',
  'erp.logistics',
  'reports',
  'crm',
  'pos',
  'backup',
] as const;

export type PermissionModule = (typeof permissionModules)[number];

export interface Permission {
  action: PermissionAction | '*';
  module: PermissionModule | '*';
}

export interface PasswordPolicy {
  minimumLength: number;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSymbol: boolean;
  requireUppercase: boolean;
}

export interface PasswordPolicyViolation {
  code:
    | 'minimum_length'
    | 'lowercase_required'
    | 'uppercase_required'
    | 'number_required'
    | 'symbol_required';
  message: string;
}

export function hasPermission(
  grantedPermissions: readonly Permission[],
  requested: Permission,
): boolean {
  return grantedPermissions.some(
    (granted) =>
      (granted.module === '*' || granted.module === requested.module) &&
      (granted.action === '*' || granted.action === requested.action),
  );
}

export function assertKnownPermission(permission: Permission): void {
  const knownModule = permission.module === '*' || permissionModules.includes(permission.module);
  const knownAction = permission.action === '*' || permissionActions.includes(permission.action);

  if (!knownModule || !knownAction) {
    throw new Error('Unknown permission');
  }
}

export function validatePasswordPolicy(
  password: string,
  policy: PasswordPolicy,
): PasswordPolicyViolation[] {
  const violations: PasswordPolicyViolation[] = [];
  if (password.length < policy.minimumLength) {
    violations.push({
      code: 'minimum_length',
      message: `Password must contain at least ${policy.minimumLength} characters`,
    });
  }
  if (policy.requireLowercase && !/[a-z]/u.test(password)) {
    violations.push({
      code: 'lowercase_required',
      message: 'Password must contain lowercase text',
    });
  }
  if (policy.requireUppercase && !/[A-Z]/u.test(password)) {
    violations.push({
      code: 'uppercase_required',
      message: 'Password must contain uppercase text',
    });
  }
  if (policy.requireNumber && !/[0-9]/u.test(password)) {
    violations.push({ code: 'number_required', message: 'Password must contain a number' });
  }
  if (policy.requireSymbol && !/[^\p{L}\p{N}\s]/u.test(password)) {
    violations.push({ code: 'symbol_required', message: 'Password must contain a symbol' });
  }
  return violations;
}
