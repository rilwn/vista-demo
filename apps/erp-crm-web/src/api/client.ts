import type { ApiErrorDetail, ApiErrorResponse } from '@vista/contracts';

const configuredApiBaseUrl: unknown = import.meta.env.VITE_API_BASE_URL;
const apiBaseUrl = (
  typeof configuredApiBaseUrl === 'string' && configuredApiBaseUrl.trim()
    ? configuredApiBaseUrl.trim()
    : '/api/v1'
).replace(/\/$/u, '');

export class ApiClientError extends Error {
  readonly code: string;
  readonly correlationId: string | undefined;
  readonly details: ApiErrorDetail[];
  readonly status: number;

  constructor(
    message: string,
    code: string,
    status: number,
    correlationId?: string,
    details: ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.correlationId = correlationId;
    this.details = details;
  }
}

export interface ApiRequestOptions extends RequestInit {
  token?: string;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`);

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, { ...options, headers });
  } catch {
    throw new ApiClientError('The service is unavailable', 'UNAVAILABLE', 0);
  }

  if (!response.ok) throw await parseApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function parseApiError(response: Response): Promise<ApiClientError> {
  try {
    const body = (await response.json()) as ApiErrorResponse;
    return new ApiClientError(
      body.error.message,
      body.error.code,
      response.status,
      body.error.correlationId,
      body.error.details,
    );
  } catch {
    return new ApiClientError('The request failed', 'REQUEST_FAILED', response.status);
  }
}
