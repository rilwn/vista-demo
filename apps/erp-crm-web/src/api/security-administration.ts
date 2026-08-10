import type {
  AuditEventPage,
  AuditIntegrityResult,
  ChangeAccountStatusRequest,
  CreateSecurityAccountRequest,
  CreateSecurityRoleRequest,
  ReplaceAccountRolesRequest,
  SecurityAccount,
  SecurityAccountPage,
  SecurityRole,
  SecuritySession,
} from '@vista/contracts';

import { apiRequest } from './client';

export function listSecurityAccounts(token: string, search = ''): Promise<SecurityAccountPage> {
  const query = new URLSearchParams({ page: '1', pageSize: '100' });
  if (search.trim()) query.set('search', search.trim());
  return apiRequest<SecurityAccountPage>(`/platform/security/accounts?${query}`, { token });
}

export function createSecurityAccount(
  token: string,
  key: string,
  input: CreateSecurityAccountRequest,
): Promise<SecurityAccount> {
  return command('/platform/security/accounts', token, key, input, 'POST');
}

export function changeSecurityAccountStatus(
  token: string,
  key: string,
  account: SecurityAccount,
  status: 'active' | 'disabled',
): Promise<SecurityAccount> {
  const input: ChangeAccountStatusRequest = { expectedVersion: account.version };
  return command(
    `/platform/security/accounts/${account.accountId}/${status === 'active' ? 'reactivate' : 'disable'}`,
    token,
    key,
    input,
    'POST',
  );
}

export function replaceSecurityAccountRoles(
  token: string,
  key: string,
  account: SecurityAccount,
  roleIds: string[],
): Promise<SecurityAccount> {
  const input: ReplaceAccountRolesRequest = {
    expectedVersion: account.version,
    roleIds,
  };
  return command(
    `/platform/security/accounts/${account.accountId}/roles`,
    token,
    key,
    input,
    'PUT',
  );
}

export function listSecurityRoles(token: string): Promise<SecurityRole[]> {
  return apiRequest<SecurityRole[]>('/platform/security/roles', { token });
}

export function createSecurityRole(
  token: string,
  key: string,
  input: CreateSecurityRoleRequest,
): Promise<SecurityRole> {
  return command('/platform/security/roles', token, key, input, 'POST');
}

export function listSecuritySessions(token: string): Promise<SecuritySession[]> {
  return apiRequest<SecuritySession[]>('/platform/security/sessions', { token });
}

export function revokeSecuritySession(token: string, sessionId: string): Promise<void> {
  return apiRequest<void>(`/platform/security/sessions/${sessionId}/revoke`, {
    method: 'POST',
    token,
  });
}

export function listAuditEvents(token: string, action = ''): Promise<AuditEventPage> {
  const query = new URLSearchParams({ page: '1', pageSize: '100' });
  if (action.trim()) query.set('action', action.trim());
  return apiRequest<AuditEventPage>(`/platform/security/audit-events?${query}`, { token });
}

export function verifyAuditIntegrity(token: string): Promise<AuditIntegrityResult> {
  return apiRequest<AuditIntegrityResult>('/platform/security/audit-integrity', { token });
}

function command<T>(
  path: string,
  token: string,
  key: string,
  input: object,
  method: 'POST' | 'PUT',
): Promise<T> {
  return apiRequest<T>(path, {
    body: JSON.stringify(input),
    headers: { 'Idempotency-Key': key },
    method,
    token,
  });
}
