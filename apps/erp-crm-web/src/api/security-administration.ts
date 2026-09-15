import type {
  AuditEventPage,
  AuditIntegrityResult,
  ChangeAccountStatusRequest,
  CreateSecurityAccountRequest,
  CreateSecurityRoleRequest,
  AccountRecoveryHandoff,
  IssueAccountRecoveryHandoffRequest,
  ReplaceAccountRolesRequest,
  SecurityAccount,
  SecurityAccountPage,
  SecurityRole,
  SecuritySession,
  UpdateSecurityRoleRequest,
} from '@vista/contracts';

import {
  apiClient,
  authorizationHeaders,
  idempotencyParameters,
  unwrapApiResponse,
} from './client';

export function listSecurityAccounts(token: string, search = ''): Promise<SecurityAccountPage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/platform/security/accounts', {
      headers: authorizationHeaders(token),
      params: {
        query: {
          page: 1,
          pageSize: 100,
          ...(search.trim() ? { search: search.trim() } : {}),
        },
      },
    }),
  );
}

export function createSecurityAccount(
  token: string,
  key: string,
  input: CreateSecurityAccountRequest,
): Promise<SecurityAccount> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/platform/security/accounts', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

export function changeSecurityAccountStatus(
  token: string,
  key: string,
  account: SecurityAccount,
  status: 'active' | 'disabled',
): Promise<SecurityAccount> {
  const input: ChangeAccountStatusRequest = { expectedVersion: account.version };
  return status === 'active'
    ? unwrapApiResponse(
        apiClient.POST('/api/v1/platform/security/accounts/{id}/reactivate', {
          body: input,
          headers: authorizationHeaders(token),
          params: {
            header: idempotencyParameters(key).header,
            path: { id: account.accountId },
          },
        }),
      )
    : unwrapApiResponse(
        apiClient.POST('/api/v1/platform/security/accounts/{id}/disable', {
          body: input,
          headers: authorizationHeaders(token),
          params: {
            header: idempotencyParameters(key).header,
            path: { id: account.accountId },
          },
        }),
      );
}

export function issueAccountRecoveryHandoff(
  token: string,
  key: string,
  account: SecurityAccount,
  input: IssueAccountRecoveryHandoffRequest,
): Promise<AccountRecoveryHandoff> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/platform/security/accounts/{id}/recovery-handoff', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(key).header,
        path: { id: account.accountId },
      },
    }),
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
  return unwrapApiResponse(
    apiClient.PUT('/api/v1/platform/security/accounts/{id}/roles', {
      body: input,
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(key).header,
        path: { id: account.accountId },
      },
    }),
  );
}

export function listSecurityRoles(token: string): Promise<SecurityRole[]> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/platform/security/roles', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function createSecurityRole(
  token: string,
  key: string,
  input: CreateSecurityRoleRequest,
): Promise<SecurityRole> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/platform/security/roles', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

export function updateSecurityRole(
  token: string,
  key: string,
  role: SecurityRole,
  input: Omit<UpdateSecurityRoleRequest, 'expectedVersion'>,
): Promise<SecurityRole> {
  return unwrapApiResponse(
    apiClient.PUT('/api/v1/platform/security/roles/{id}', {
      body: { ...input, expectedVersion: role.version },
      headers: authorizationHeaders(token),
      params: {
        header: idempotencyParameters(key).header,
        path: { id: role.id },
      },
    }),
  );
}

export function listSecuritySessions(token: string): Promise<SecuritySession[]> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/platform/security/sessions', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function revokeSecuritySession(token: string, sessionId: string): Promise<void> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/platform/security/sessions/{id}/revoke', {
      headers: authorizationHeaders(token),
      params: { path: { id: sessionId } },
    }),
  );
}

export function listAuditEvents(token: string, action = ''): Promise<AuditEventPage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/platform/security/audit-events', {
      headers: authorizationHeaders(token),
      params: {
        query: {
          page: 1,
          pageSize: 100,
          ...(action.trim() ? { action: action.trim() } : {}),
        },
      },
    }),
  );
}

export function verifyAuditIntegrity(token: string): Promise<AuditIntegrityResult> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/platform/security/audit-integrity', {
      headers: authorizationHeaders(token),
    }),
  );
}
