export const permissionActions = ['view', 'create', 'edit', 'delete', 'approve'] as const;

export type PermissionAction = (typeof permissionActions)[number];

export const permissionModules = [
  'platform',
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
