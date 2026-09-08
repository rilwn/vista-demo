import type {
  LibraryDefinition,
  LibraryViewPage,
  LibraryExport,
  ReportingScope,
  ReportScheduleInput,
  ReportSchedule,
  ReportSchedulePage,
  ReportRunPage,
} from '@vista/contracts';
import { apiV1BaseUrl, ApiClientError, authorizationHeaders } from './client';
async function request<T>(
  token: string,
  path: string,
  method = 'GET',
  body?: unknown,
  key?: string,
): Promise<T> {
  const response = await fetch(`${apiV1BaseUrl}/reporting/${path}`, {
    method,
    headers: authorizationHeaders(token, {
      'Content-Type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {}),
    }),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as {
      message?: unknown;
      code?: unknown;
    };
    throw new ApiClientError(
      typeof error.message === 'string'
        ? error.message
        : 'The report request could not be completed.',
      typeof error.code === 'string' ? error.code : 'REPORT_REQUEST_FAILED',
      response.status,
    );
  }
  return response.json() as Promise<T>;
}
export const reportingHubApi = {
  context: (token: string) => request<{ timezone: string }>(token, 'context'),
  definitions: (token: string) => request<LibraryDefinition[]>(token, 'definitions'),
  views: (token: string, page = 1) =>
    request<LibraryViewPage>(token, `views?page=${page}&pageSize=20`),
  exportView: (token: string, scope: ReportingScope, id: string, key: string) =>
    request<LibraryExport>(token, `views/${scope}/${id}/export`, 'POST', undefined, key),
  exportStatus: (token: string, scope: ReportingScope, id: string) =>
    request<LibraryExport>(token, `exports/${scope}/${id}`),
  schedules: (token: string, page = 1) =>
    request<ReportSchedulePage>(token, `schedules?page=${page}&pageSize=20`),
  schedule: (token: string, input: ReportScheduleInput) =>
    request<ReportSchedule>(token, 'schedules', 'POST', input),
  state: (token: string, id: string, enabled: boolean, version: number) =>
    request<ReportSchedule>(token, `schedules/${id}/state`, 'PUT', { enabled, version }),
  runs: (token: string, id: string, page = 1) =>
    request<ReportRunPage>(token, `schedules/${id}/runs?page=${page}&pageSize=20`),
  retry: (token: string, scope: ReportingScope, id: string) =>
    request<LibraryExport>(token, `exports/${scope}/${id}/retry`, 'POST'),
};
export async function downloadLibraryExport(
  token: string,
  scope: ReportingScope,
  report: LibraryExport,
) {
  const response = await fetch(`${apiV1BaseUrl}/reporting/exports/${scope}/${report.id}/content`, {
    headers: authorizationHeaders(token),
  });
  if (!response.ok) throw new Error('Download failed');
  const blob = await response.blob(),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = report.fileName ?? 'report';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
