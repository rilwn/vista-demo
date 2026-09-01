import type {
  ApiErrorResponse,
  CreateCrmInteractionRequest,
  CreateCrmTaskRequest,
  CrmInteraction,
  CrmTask,
  CrmTimelinePage,
  CrmTimelineReferenceData,
  TransitionCrmTaskRequest,
} from '@vista/contracts';

import { ApiClientError, apiV1BaseUrl, authorizationHeaders } from './client';

export function getCrmTimelineReferenceData(token: string): Promise<CrmTimelineReferenceData> {
  return request<CrmTimelineReferenceData>(`${apiV1BaseUrl}/crm/timeline/reference-data`, token);
}

export function listCrmTimeline(
  token: string,
  input: {
    customerLocationId?: string;
    customerPartnerId: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    pageSize?: number;
  },
): Promise<CrmTimelinePage> {
  const query = new URLSearchParams({
    customerPartnerId: input.customerPartnerId,
    page: String(input.page ?? 1),
    pageSize: String(input.pageSize ?? 25),
  });
  if (input.customerLocationId) query.set('customerLocationId', input.customerLocationId);
  if (input.dateFrom) query.set('dateFrom', input.dateFrom);
  if (input.dateTo) query.set('dateTo', input.dateTo);
  return request<CrmTimelinePage>(`${apiV1BaseUrl}/crm/timeline?${query.toString()}`, token);
}

export function createCrmInteraction(
  token: string,
  key: string,
  input: CreateCrmInteractionRequest,
): Promise<CrmInteraction> {
  return request<CrmInteraction>(`${apiV1BaseUrl}/crm/interactions`, token, {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    method: 'POST',
  });
}

export function createCrmTask(
  token: string,
  key: string,
  input: CreateCrmTaskRequest,
): Promise<CrmTask> {
  return request<CrmTask>(`${apiV1BaseUrl}/crm/tasks`, token, {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    method: 'POST',
  });
}

export function transitionCrmTask(
  token: string,
  id: string,
  key: string,
  input: TransitionCrmTaskRequest,
): Promise<CrmTask> {
  return request<CrmTask>(`${apiV1BaseUrl}/crm/tasks/${id}/transition`, token, {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    method: 'POST',
  });
}

async function request<T>(url: string, token: string, options: RequestInit = {}): Promise<T> {
  const headers = options.headers ? Object.fromEntries(new Headers(options.headers).entries()) : {};
  const response = await fetch(url, {
    ...options,
    headers: authorizationHeaders(token, headers),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as ApiErrorResponse | undefined;
    throw new ApiClientError(
      body?.error.message ?? 'The CRM request failed.',
      body?.error.code ?? 'CRM_REQUEST_FAILED',
      response.status,
      body?.error.correlationId,
      body?.error.details,
    );
  }
  return (await response.json()) as T;
}
