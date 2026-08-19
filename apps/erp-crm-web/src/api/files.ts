import type {
  ApiErrorResponse,
  ManagedFile,
  ManagedFilePage,
  ManagedFileParentType,
} from '@vista/contracts';

import { ApiClientError, apiV1BaseUrl, authorizationHeaders } from './client';

export interface DownloadedManagedFile {
  blob: Blob;
  fileName: string;
}

export async function listManagedFiles(
  token: string,
  parentType: ManagedFileParentType,
  parentId: string,
): Promise<ManagedFilePage> {
  const query = new URLSearchParams({ page: '1', pageSize: '100', parentId, parentType });
  return requestJson<ManagedFilePage>(`${apiV1BaseUrl}/files?${query.toString()}`, token);
}

export function listManagedFileVersions(token: string, fileId: string): Promise<ManagedFile[]> {
  return requestJson<ManagedFile[]>(`${apiV1BaseUrl}/files/${fileId}/versions`, token);
}

export function uploadManagedFile(
  token: string,
  parentType: ManagedFileParentType,
  parentId: string,
  idempotencyKey: string,
  file: File,
): Promise<ManagedFile> {
  const body = new FormData();
  body.set('parentType', parentType);
  body.set('parentId', parentId);
  body.set('file', file);
  return requestJson<ManagedFile>(`${apiV1BaseUrl}/files`, token, {
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
    method: 'POST',
  });
}

export function uploadManagedFileVersion(
  token: string,
  fileId: string,
  idempotencyKey: string,
  file: File,
): Promise<ManagedFile> {
  const body = new FormData();
  body.set('file', file);
  return requestJson<ManagedFile>(`${apiV1BaseUrl}/files/${fileId}/versions`, token, {
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
    method: 'POST',
  });
}

export async function downloadManagedFile(
  token: string,
  file: ManagedFile,
): Promise<DownloadedManagedFile> {
  const response = await fetch(`${apiV1BaseUrl}/files/${file.id}/content`, {
    headers: authorizationHeaders(token),
  });
  if (!response.ok) throw await apiError(response);
  return { blob: await response.blob(), fileName: file.originalName };
}

async function requestJson<T>(url: string, token: string, options: RequestInit = {}): Promise<T> {
  const additionalHeaders = options.headers
    ? Object.fromEntries(new Headers(options.headers).entries())
    : {};
  const response = await fetch(url, {
    ...options,
    headers: authorizationHeaders(token, additionalHeaders),
  });
  if (!response.ok) throw await apiError(response);
  return (await response.json()) as T;
}

async function apiError(response: Response): Promise<ApiClientError> {
  const body = (await response.json().catch(() => undefined)) as ApiErrorResponse | undefined;
  return new ApiClientError(
    body?.error.message ?? 'The file request failed.',
    body?.error.code ?? 'FILE_REQUEST_FAILED',
    response.status,
    body?.error.correlationId,
    body?.error.details,
  );
}
