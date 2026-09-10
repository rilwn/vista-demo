import type {
  ApiErrorResponse,
  CreateCrmReportExportRequest,
  CrmAnalyticsOverview,
  CrmReportDefinition,
  CrmReportExport,
  CrmReportExportPage,
} from '@vista/contracts';

import {
  ApiClientError,
  apiClient,
  apiV1BaseUrl,
  authorizationHeaders,
  idempotencyParameters,
  unwrapApiResponse,
} from './client';

export function getCrmAnalyticsOverview(
  token: string,
  dateFrom: string,
  dateTo: string,
): Promise<CrmAnalyticsOverview> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/crm/analytics/overview', {
      headers: authorizationHeaders(token),
      params: { query: { dateFrom, dateTo } },
    }),
  );
}

export function getCrmReportDefinitions(token: string): Promise<CrmReportDefinition[]> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/crm/report-exports/definitions', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function listCrmReportExports(
  token: string,
  page = 1,
  pageSize = 20,
): Promise<CrmReportExportPage> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/crm/report-exports', {
      headers: authorizationHeaders(token),
      params: { query: { page, pageSize } },
    }),
  );
}

export function createCrmReportExport(
  token: string,
  key: string,
  input: CreateCrmReportExportRequest,
): Promise<CrmReportExport> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/crm/report-exports', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: idempotencyParameters(key).header },
    }),
  );
}

export function retryCrmReportExport(token: string, id: string): Promise<CrmReportExport> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/crm/report-exports/{id}/retry', {
      headers: authorizationHeaders(token),
      params: { path: { id } },
    }),
  );
}

export async function downloadCrmReportExport(
  token: string,
  report: CrmReportExport,
): Promise<Blob> {
  const response = await fetch(`${apiV1BaseUrl}/crm/report-exports/${report.id}/content`, {
    headers: authorizationHeaders(token),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as ApiErrorResponse | undefined;
    throw new ApiClientError(
      body?.error.message ?? 'The report could not be downloaded.',
      body?.error.code ?? 'REPORT_DOWNLOAD_FAILED',
      response.status,
      body?.error.correlationId,
      body?.error.details,
    );
  }
  return response.blob();
}
