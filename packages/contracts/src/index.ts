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
