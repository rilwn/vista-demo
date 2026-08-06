import type { Permission } from '@vista/auth';

import type { CorrelatedRequest } from '../common/correlation-id.middleware.js';

export interface AuthenticationContext {
  accountId: string;
  displayName: string;
  email: string;
  employeeId: string;
  isAdministrative: boolean;
  permissions: Permission[];
  sessionId: string;
  twoFactorVerified: boolean;
}

export interface AuthenticatedRequest extends CorrelatedRequest {
  authentication: AuthenticationContext;
}

export interface RequestSecurityMetadata {
  correlationId: string;
  sourceIp?: string;
  userAgent?: string;
}
