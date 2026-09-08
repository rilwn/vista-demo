import type {
  OperationsOverview,
  OverviewPreferences,
  SavedFinanceReport,
  SavedServiceReport,
  SavedCrmReport,
} from '@vista/contracts';
import { apiClient, authorizationHeaders, unwrapApiResponse } from './client';

export function saveOverviewPreferences(
  token: string,
  input: OverviewPreferences,
): Promise<OverviewPreferences> {
  return unwrapApiResponse(
    apiClient.PUT('/api/v1/operations/overview/preferences', {
      headers: authorizationHeaders(token),
      body: input,
    }),
  );
}

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

export function listSavedServiceReports(token: string, page = 1) {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/service/saved-reports', {
      headers: authorizationHeaders(token),
      params: { query: { page, pageSize: 20 } },
    }),
  );
}

export function listSavedCrmReports(token: string, page = 1) {
  return unwrapApiResponse(
    apiClient.GET('/api/v1/crm/saved-reports', {
      headers: authorizationHeaders(token),
      params: { query: { page, pageSize: 20 } },
    }),
  );
}

export function saveCrmReport(token: string, input: SavedCrmReport): Promise<SavedCrmReport> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/crm/saved-reports', {
      headers: authorizationHeaders(token),
      body: input,
    }),
  );
}

export function saveServiceReport(
  token: string,
  input: SavedServiceReport,
): Promise<SavedServiceReport> {
  return unwrapApiResponse(
    apiClient.POST('/api/v1/service/saved-reports', {
      headers: authorizationHeaders(token),
      body: input,
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
