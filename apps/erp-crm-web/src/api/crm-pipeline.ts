import type {
  ApiErrorResponse,
  ConvertCrmLeadRequest,
  CreateCrmLeadRequest,
  CreateCrmOpportunityRequest,
  CrmLead,
  CrmLeadPage,
  CrmLeadSource,
  CrmLeadStatus,
  CrmOpportunity,
  CrmOpportunityPage,
  CrmOpportunityStage,
  CrmPipelineReferenceData,
  LinkCrmOpportunityQuotationRequest,
  MoveCrmOpportunityRequest,
  QualifyCrmLeadRequest,
} from '@vista/contracts';

import { ApiClientError, apiV1BaseUrl, authorizationHeaders } from './client';

export function getCrmPipelineReferenceData(token: string): Promise<CrmPipelineReferenceData> {
  return request<CrmPipelineReferenceData>(`${apiV1BaseUrl}/crm/pipeline/reference-data`, token);
}

export function listCrmLeads(
  token: string,
  input: {
    page?: number;
    pageSize?: number;
    search?: string;
    source?: CrmLeadSource;
    status?: CrmLeadStatus;
  },
): Promise<CrmLeadPage> {
  const query = queryString(input);
  return request<CrmLeadPage>(`${apiV1BaseUrl}/crm/leads?${query}`, token);
}

export function createCrmLead(
  token: string,
  key: string,
  input: CreateCrmLeadRequest,
): Promise<CrmLead> {
  return command<CrmLead>(`${apiV1BaseUrl}/crm/leads`, token, key, input);
}

export function qualifyCrmLead(
  token: string,
  id: string,
  key: string,
  input: QualifyCrmLeadRequest,
): Promise<CrmLead> {
  return command<CrmLead>(`${apiV1BaseUrl}/crm/leads/${id}/qualify`, token, key, input);
}

export function convertCrmLead(
  token: string,
  id: string,
  key: string,
  input: ConvertCrmLeadRequest,
): Promise<{
  customer: { id: string; name: string };
  lead: CrmLead;
  opportunity?: CrmOpportunity;
}> {
  return command(`${apiV1BaseUrl}/crm/leads/${id}/convert`, token, key, input);
}

export function listCrmOpportunities(
  token: string,
  input: {
    page?: number;
    pageSize?: number;
    search?: string;
    stage?: CrmOpportunityStage;
  },
): Promise<CrmOpportunityPage> {
  const query = queryString(input);
  return request<CrmOpportunityPage>(`${apiV1BaseUrl}/crm/opportunities?${query}`, token);
}

export function getCrmOpportunity(token: string, id: string): Promise<CrmOpportunity> {
  return request<CrmOpportunity>(`${apiV1BaseUrl}/crm/opportunities/${id}`, token);
}

export function createCrmOpportunity(
  token: string,
  key: string,
  input: CreateCrmOpportunityRequest,
): Promise<CrmOpportunity> {
  return command<CrmOpportunity>(`${apiV1BaseUrl}/crm/opportunities`, token, key, input);
}

export function moveCrmOpportunity(
  token: string,
  id: string,
  key: string,
  input: MoveCrmOpportunityRequest,
): Promise<CrmOpportunity> {
  return command<CrmOpportunity>(
    `${apiV1BaseUrl}/crm/opportunities/${id}/stage`,
    token,
    key,
    input,
  );
}

export function linkCrmOpportunityQuotation(
  token: string,
  id: string,
  key: string,
  input: LinkCrmOpportunityQuotationRequest,
): Promise<CrmOpportunity> {
  return command<CrmOpportunity>(
    `${apiV1BaseUrl}/crm/opportunities/${id}/quotations`,
    token,
    key,
    input,
  );
}

function command<T>(url: string, token: string, key: string, body: object): Promise<T> {
  return request<T>(url, token, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    method: 'POST',
  });
}

function queryString(values: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  return query.toString();
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
