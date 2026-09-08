import { hasPermission, type PermissionModule } from '@vista/auth';
import type { AuthenticationContext } from '../auth/authentication.types.js';
import { reportingScopes, type ReportingScope } from '@vista/contracts';
import { ApiErrorException } from '../common/api-error.exception.js';
export function canReport(
  auth: Pick<AuthenticationContext, 'permissions'>,
  scope: ReportingScope,
  create = false,
) {
  const module: PermissionModule = scope === 'crm' || scope === 'pos' ? scope : `erp.${scope}`;
  return (
    hasPermission(auth.permissions, { module, action: scope === 'service' ? 'approve' : 'view' }) &&
    (!create || hasPermission(auth.permissions, { module, action: 'create' }))
  );
}
export function reportAccess(
  auth: Pick<AuthenticationContext, 'permissions'>,
  value: string,
  create = false,
): ReportingScope {
  if (!reportingScopes.includes(value as ReportingScope))
    throw new ApiErrorException(
      'REPORT_SCOPE_INVALID',
      'Choose an available reporting module.',
      400,
    );
  const scope = value as ReportingScope;
  if (!canReport(auth, scope, create))
    throw new ApiErrorException(
      'FORBIDDEN',
      'Your account cannot perform this report action.',
      403,
    );
  return scope;
}
