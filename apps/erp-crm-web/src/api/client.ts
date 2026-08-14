import {
  createVistaApiClientV1,
  resolveVistaBrowserApiBaseUrl,
  type ApiErrorDetail,
  type ApiErrorResponse,
} from '@vista/contracts';

const configuredApiBaseUrl: unknown = import.meta.env.VITE_API_BASE_URL;
export const apiV1BaseUrl = resolveVistaBrowserApiBaseUrl(
  configuredApiBaseUrl,
  globalThis.location.origin,
);

export const apiClient = createVistaApiClientV1({ baseUrl: apiV1BaseUrl });

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

interface SuccessfulApiResponse<T> {
  data: T;
  error?: never;
  response: Response;
}

interface FailedApiResponse {
  data?: never;
  error: unknown;
  response: Response;
}

export function authorizationHeaders(
  token: string,
  additional: Record<string, string> = {},
): Record<string, string> {
  return {
    ...additional,
    Authorization: 'Bearer ' + token,
  };
}

export async function unwrapApiResponse<T>(
  request: Promise<FailedApiResponse | SuccessfulApiResponse<T>>,
): Promise<T> {
  try {
    const result = await request;
    if (result.response.ok) return result.data as T;
    throw parseApiError(result.response, result.error);
  } catch (caught) {
    if (caught instanceof ApiClientError) throw caught;
    throw new ApiClientError('The service is unavailable', 'UNAVAILABLE', 0);
  }
}

function parseApiError(response: Response, value: unknown): ApiClientError {
  if (isApiErrorResponse(value)) {
    return new ApiClientError(
      value.error.message,
      value.error.code,
      response.status,
      value.error.correlationId,
      value.error.details ?? [],
    );
  }
  return new ApiClientError('The request failed', 'REQUEST_FAILED', response.status);
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  if (!value || typeof value !== 'object' || !('error' in value)) return false;
  const error = value.error;
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  );
}

export function idempotencyParameters(key: string): {
  header: { 'Idempotency-Key': string };
} {
  return { header: { 'Idempotency-Key': key } };
}
