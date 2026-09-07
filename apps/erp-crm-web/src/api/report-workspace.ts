import type { OperationsOverview, SavedFinanceReport } from '@vista/contracts';
import { apiClient, authorizationHeaders, unwrapApiResponse } from './client';

export function getOperationsOverview(
  token: string,
  dateFrom: string,
  dateTo: string,
  warrantyDays: number,
): Promise<OperationsOverview> {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/operations/overview', {
      headers: authorizationHeaders(token),
      params: { query: { dateFrom, dateTo, warrantyDays } },
    }),
  );
}

export function listSavedFinanceReports(token: string, page = 1) {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/finance/saved-reports', {
      headers: authorizationHeaders(token),
      params: { query: { page, pageSize: 20 } },
    }),
  );
}

export function saveFinanceReport(
  token: string,
  input: SavedFinanceReport,
): Promise<SavedFinanceReport> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/finance/saved-reports', {
      headers: authorizationHeaders(token),
      body: input,
    }),
  );
}
