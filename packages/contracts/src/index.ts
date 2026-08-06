export const API_VERSION = 'v1' as const;

export type ApiVersion = typeof API_VERSION;

export interface ApiErrorDetail {
  field?: string;
  message: string;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    correlationId: string;
    details?: ApiErrorDetail[];
    message: string;
    timestamp: string;
  };
}

export interface HealthCheck {
  detail?: string;
  latencyMs?: number;
  status: 'up' | 'down';
}

export interface HealthResponse {
  checks: Record<string, HealthCheck>;
  status: 'ok' | 'degraded';
  timestamp: string;
  version: string;
}

export interface ApiPermission {
  action: string;
  module: string;
}

export interface AuthenticationAccountSummary {
  displayName: string;
  email: string;
  id: string;
  isAdministrative: boolean;
}

export interface AuthenticationContextResponse {
  accountId: string;
  displayName: string;
  email: string;
  employeeId: string;
  isAdministrative: boolean;
  permissions: ApiPermission[];
  sessionId: string;
  twoFactorVerified: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
  totpCode?: string;
}

export interface LoginResponse {
  account: AuthenticationAccountSummary;
  expiresAt: string;
  sessionToken: string;
}

export const partnerKinds = ['legal_entity', 'individual'] as const;
export type PartnerKind = (typeof partnerKinds)[number];

export const partnerRoles = ['customer', 'supplier', 'partner'] as const;
export type PartnerRole = (typeof partnerRoles)[number];

export interface PartnerSummary {
  active: boolean;
  companyRepresentative?: string;
  createdAt: string;
  displayName: string;
  id: string;
  kind: PartnerKind;
  roles: PartnerRole[];
  uic?: string;
  updatedAt: string;
  vatNumber?: string;
  version: number;
}

export interface PartnerPage {
  items: PartnerSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CreatePartnerRequest {
  companyRepresentative?: string;
  displayName: string;
  kind: PartnerKind;
  roles: PartnerRole[];
  uic?: string;
  vatNumber?: string;
}

export interface PartnerDuplicateCandidate {
  displayName: string;
  id: string;
  kind: PartnerKind;
  matchedBy: Array<'name' | 'uic'>;
  roles: PartnerRole[];
  uic?: string;
}

export interface PartnerDuplicateResponse {
  candidates: PartnerDuplicateCandidate[];
}
