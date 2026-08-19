import type {
  AuthenticationContextResponse,
  ChangePasswordRequest,
  ChangePasswordResponse,
  CompleteAccountRecoveryRequest,
  CompleteAccountRecoveryResponse,
  DisableTotpRequest,
  DisableTotpResponse,
  LoginRequest,
  LoginResponse,
  PasswordPolicyResponse,
  StartAccountRecoveryTotpRequest,
  StartAccountRecoveryTotpResponse,
  StartTotpEnrollmentRequest,
  StartTotpEnrollmentResponse,
  TotpEnrollmentStatus,
  VerifyAccountRecoveryTotpRequest,
  VerifyAccountRecoveryTotpResponse,
  VerifyTotpEnrollmentRequest,
  VerifyTotpEnrollmentResponse,
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

export function getTotpStatus(token: string): Promise<TotpEnrollmentStatus> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/auth/me/totp', { headers: authorizationHeaders(token) }),
  );
}

export function startTotpEnrollment(
  token: string,
  input: StartTotpEnrollmentRequest,
): Promise<StartTotpEnrollmentResponse> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/auth/me/totp/enrollment', {
      body: input,
      headers: authorizationHeaders(token),
    }),
  );
}

export function verifyTotpEnrollment(
  token: string,
  enrollmentId: string,
  input: VerifyTotpEnrollmentRequest,
): Promise<VerifyTotpEnrollmentResponse> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/auth/me/totp/enrollment/{enrollmentId}/verify', {
      body: input,
      headers: authorizationHeaders(token),
      params: { path: { enrollmentId } },
    }),
  );
}

export function disableTotp(
  token: string,
  input: DisableTotpRequest,
): Promise<DisableTotpResponse> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/auth/me/totp/disable', {
      body: input,
      headers: authorizationHeaders(token),
    }),
  );
}

export function completeAccountRecovery(
  input: CompleteAccountRecoveryRequest,
): Promise<CompleteAccountRecoveryResponse> {
  return unwrapApiResponse(apiClient.POST('/api/v1/auth/recovery/complete', { body: input }));
}

export function startAccountRecoveryTotpEnrollment(
  input: StartAccountRecoveryTotpRequest,
): Promise<StartAccountRecoveryTotpResponse> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/auth/recovery/totp/enrollment', { body: input }),
  );
}

export function verifyAccountRecoveryTotpEnrollment(
  enrollmentId: string,
  input: VerifyAccountRecoveryTotpRequest,
): Promise<VerifyAccountRecoveryTotpResponse> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/auth/recovery/totp/enrollment/{enrollmentId}/verify', {
      body: input,
      params: { path: { enrollmentId } },
    }),
  );
}
