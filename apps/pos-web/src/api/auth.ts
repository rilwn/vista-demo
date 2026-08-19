import type { AuthenticationContextResponse, LoginRequest, LoginResponse } from '@vista/contracts';

import { authorizationHeaders, posApiClient, unwrapApiResponse } from './client';

export { ApiClientError } from './client';

export function authenticate(input: LoginRequest): Promise<LoginResponse> {
  return unwrapApiResponse(posApiClient.POST('/api/v1/auth/login', { body: input }));
}

export function getCurrentAccount(token: string): Promise<AuthenticationContextResponse> {
  return unwrapApiResponse(
    posApiClient.GET('/api/v1/auth/me', { headers: authorizationHeaders(token) }),
  );
}

export function revokeSession(token: string): Promise<void> {
  return unwrapApiResponse(
    posApiClient.POST('/api/v1/auth/logout', { headers: authorizationHeaders(token) }),
  );
}
