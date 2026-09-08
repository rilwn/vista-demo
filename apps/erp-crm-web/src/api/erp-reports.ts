import type {
  ErpReportScope,
  ErpReportRequest,
  SavedErpReport,
  ErpReportExport,
} from '@vista/contracts';
import {
  apiClient,
  authorizationHeaders,
  unwrapApiResponse,
  apiV1BaseUrl,
  ApiClientError,
} from './client';
export const erpReportsApi = {
  definitions: (token: string, scope: ErpReportScope) =>
    unwrapApiResponse(
      apiClient.GET('/api/v1/erp/reports/{scope}/definitions', {
        headers: authorizationHeaders(token),
        params: { path: { scope } },
      }),
    ),
  preview: (
    token: string,
    scope: ErpReportScope,
    input: Omit<ErpReportRequest, 'format' | 'columns'>,
    page: number,
  ) =>
    unwrapApiResponse(
      apiClient.GET('/api/v1/erp/reports/{scope}/preview', {
        headers: authorizationHeaders(token),
        params: { path: { scope }, query: { ...input, page } },
      }),
    ),
  saved: (token: string, scope: ErpReportScope, page: number) =>
    unwrapApiResponse(
      apiClient.GET('/api/v1/erp/reports/{scope}/saved', {
        headers: authorizationHeaders(token),
        params: { path: { scope }, query: { page, pageSize: 20 } },
      }),
    ),
  save: (token: string, scope: ErpReportScope, input: SavedErpReport) =>
    unwrapApiResponse(
      apiClient.POST('/api/v1/erp/reports/{scope}/saved', {
        headers: authorizationHeaders(token),
        params: { path: { scope } },
        body: input,
      }),
    ),
  exports: (token: string, scope: ErpReportScope, page: number) =>
    unwrapApiResponse(
      apiClient.GET('/api/v1/erp/reports/{scope}/exports', {
        headers: authorizationHeaders(token),
        params: { path: { scope }, query: { page, pageSize: 10 } },
      }),
    ),
  create: (token: string, scope: ErpReportScope, input: ErpReportRequest, key: string) =>
    unwrapApiResponse(
      apiClient.POST('/api/v1/erp/reports/{scope}/exports', {
        headers: authorizationHeaders(token, { 'Idempotency-Key': key }),
        params: { path: { scope }, header: { 'Idempotency-Key': key } },
        body: input,
      }),
    ),
  retry: (token: string, scope: ErpReportScope, id: string) =>
    unwrapApiResponse(
      apiClient.POST('/api/v1/erp/reports/{scope}/exports/{id}/retry', {
        headers: authorizationHeaders(token),
        params: { path: { scope, id } },
      }),
    ),
};
export async function downloadErpReport(
  token: string,
  scope: ErpReportScope,
  report: ErpReportExport,
) {
  const response = await fetch(
    `${apiV1BaseUrl}/erp/reports/${scope}/exports/${report.id}/content`,
    { headers: authorizationHeaders(token) },
  );
  if (!response.ok)
    throw new ApiClientError(
      'The report could not be downloaded.',
      'REPORT_DOWNLOAD_FAILED',
      response.status,
    );
  return response.blob();
}
