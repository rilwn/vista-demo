import type { AuthenticationContextResponse, LoginRequest, LoginResponse } from '@vista/contracts';

import { apiRequest } from './client';

export { ApiClientError } from './client';

export function authenticate(input: LoginRequest): Promise<LoginResponse> {
  return apiRequest<LoginResponse>('/auth/login', {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function getCurrentAccount(token: string): Promise<AuthenticationContextResponse> {
  return apiRequest<AuthenticationContextResponse>('/auth/me', { token });
}

export function revokeSession(token: string): Promise<void> {
  return apiRequest<void>('/auth/logout', { method: 'POST', token });
}
