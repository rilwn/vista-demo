import type {
  AuthenticationContextResponse,
  ChangePasswordRequest,
  ChangePasswordResponse,
  LoginRequest,
  LoginResponse,
  PasswordPolicyResponse,
} from '@vista/contracts';

import { apiClient, authorizationHeaders, unwrapApiResponse } from './client';

export { ApiClientError } from './client';

export function authenticate(input: LoginRequest): Promise<LoginResponse> {
  return unwrapApiResponse(apiClient.POST('/api/v1/auth/login', { body: input }));
}

export function getCurrentAccount(token: string): Promise<AuthenticationContextResponse> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/auth/me', { headers: authorizationHeaders(token) }),
  );
}

export function revokeSession(token: string): Promise<void> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/auth/logout', { headers: authorizationHeaders(token) }),
  );
}

export function getPasswordPolicy(token: string): Promise<PasswordPolicyResponse> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/auth/me/password-policy', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function changePassword(
  token: string,
  input: ChangePasswordRequest,
): Promise<ChangePasswordResponse> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/auth/me/password', {
      body: input,
      headers: authorizationHeaders(token),
    }),
  );
}
