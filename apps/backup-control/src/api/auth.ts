import type { AuthenticationContextResponse, LoginRequest, LoginResponse } from '@vista/contracts';

import { authorizationHeaders, backupApiClient, unwrapApiResponse } from './client';

export { ApiClientError } from './client';

export function authenticate(input: LoginRequest): Promise<LoginResponse> {
  return unwrapApiResponse(backupApiClient.POST('/api/v1/auth/login', { body: input }));
}

export function getCurrentAccount(token: string): Promise<AuthenticationContextResponse> {
  return unwrapApiResponse(
    backupApiClient.GET('/api/v1/auth/me', { headers: authorizationHeaders(token) }),
  );
}

export function revokeSession(token: string): Promise<void> {
  return unwrapApiResponse(
    backupApiClient.POST('/api/v1/auth/logout', { headers: authorizationHeaders(token) }),
  );
}
