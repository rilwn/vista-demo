import type {
  BackupDrTest,
  BackupDrTestPage,
  BackupArtifactDeletionRequest,
  BackupArtifactDeletionRequestPage,
  ActivateBackupPolicyRequest,
  BackupExecutionRunPage,
  BackupFileRestoreOptions,
  BackupDatabaseRecordRecovery,
  BackupDatabaseRecordRecoveryRequest,
  BackupDatabaseRecoveryTablePage,
  BackupPolicy,
  BackupPolicyApprovalPage,
  BackupPlanReview,
  BackupPlanReviewPage,
  BackupProtectedSource,
  BackupRecordPage,
  BackupRestoreRequest,
  BackupRestoreRequestPage,
  BackupReferenceData,
  CreateBackupPolicyRequest,
  CreateBackupProtectedSourceRequest,
  DecideBackupPolicyApprovalRequest,
  DecideBackupArtifactDeletionRequest,
  DecideBackupRestoreApprovalRequest,
  RequestBackupPolicyApprovalRequest,
  RequestBackupRetentionReductionRequest,
  RequestBackupRestoreRequest,
  RequestBackupArtifactDeletionRequest,
  PlanBackupDrTestRequest,
  RecordBackupDrTestRequest,
  RecordBackupPlanReviewRequest,
  UpdateBackupPolicyRequest,
  UpdateBackupProtectedSourceRequest,
} from '@vista/contracts';

import {
  ApiClientError,
  apiV1BaseUrl,
  authorizationHeaders,
  backupApiClient,
  unwrapApiResponse,
} from './client';

export function loadBackupPlanReviews(token: string): Promise<BackupPlanReviewPage> {
  return unwrapApiResponse(
    backupApiClient.GET('/api/v1/backup/plan-reviews', { headers: authorizationHeaders(token) }),
  );
}

export function recordBackupPlanReview(
  token: string,
  input: RecordBackupPlanReviewRequest,
  idempotencyKey: string,
): Promise<BackupPlanReview> {
  return unwrapApiResponse(
    backupApiClient.POST('/api/v1/backup/plan-reviews', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': idempotencyKey } },
    }),
  );
}

export function loadBackupDrTests(token: string): Promise<BackupDrTestPage> {
  return unwrapApiResponse(
    backupApiClient.GET('/api/v1/backup/dr-tests', { headers: authorizationHeaders(token) }),
  );
}

export function planBackupDrTest(
  token: string,
  input: PlanBackupDrTestRequest,
  idempotencyKey: string,
): Promise<BackupDrTest> {
  return unwrapApiResponse(
    backupApiClient.POST('/api/v1/backup/dr-tests', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': idempotencyKey } },
    }),
  );
}

export function recordBackupDrTest(
  token: string,
  testId: string,
  input: RecordBackupDrTestRequest,
  idempotencyKey: string,
): Promise<BackupDrTest> {
  return unwrapApiResponse(
    backupApiClient.POST('/api/v1/backup/dr-tests/{id}/result', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': idempotencyKey }, path: { id: testId } },
    }),
  );
}

export async function uploadBackupDrTestProtocol(
  token: string,
  testId: string,
  file: File,
  idempotencyKey: string,
): Promise<{ id: string; status: string }> {
  const body = new FormData();
  body.set('parentType', 'backup_dr_test');
  body.set('parentId', testId);
  body.set('file', file);
  const response = await fetch(`${apiV1BaseUrl}/files`, {
    method: 'POST',
    headers: authorizationHeaders(token, { 'Idempotency-Key': idempotencyKey }),
    body,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => undefined)) as
      { error?: { code?: string; correlationId?: string; message?: string } } | undefined;
    throw new ApiClientError(
      payload?.error?.message ?? 'The signed protocol could not be uploaded.',
      payload?.error?.code ?? 'BACKUP_DR_TEST_PROTOCOL_UPLOAD_FAILED',
      response.status,
      payload?.error?.correlationId,
    );
  }
  const payload = (await response.json()) as { data?: { id?: unknown; status?: unknown } };
  const id = payload.data?.id;
  const status = payload.data?.status;
  if (typeof id !== 'string' || typeof status !== 'string') {
    throw new ApiClientError(
      'The signed protocol upload response was incomplete.',
      'BACKUP_DR_TEST_PROTOCOL_UPLOAD_INVALID',
      response.status,
    );
  }
  return { id, status };
}

export async function downloadBackupDrTestProtocol(token: string, fileId: string): Promise<Blob> {
  const response = await fetch(`${apiV1BaseUrl}/files/${encodeURIComponent(fileId)}/content`, {
    headers: authorizationHeaders(token),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => undefined)) as
      { error?: { code?: string; correlationId?: string; message?: string } } | undefined;
    throw new ApiClientError(
      payload?.error?.message ?? 'The signed test protocol could not be downloaded.',
      payload?.error?.code ?? 'BACKUP_DR_TEST_PROTOCOL_DOWNLOAD_FAILED',
      response.status,
      payload?.error?.correlationId,
    );
  }
  const content = await response.blob();
  if (content.type !== 'application/pdf') {
    throw new ApiClientError(
      'The signed test protocol is not available as a PDF.',
      'BACKUP_DR_TEST_PROTOCOL_DOWNLOAD_INVALID',
      response.status,
    );
  }
  return content;
}

export async function downloadBackupRestoreFile(
  token: string,
  restoreRequestId: string,
): Promise<Blob> {
  const response = await fetch(
    `${apiV1BaseUrl}/backup/restore-requests/${encodeURIComponent(restoreRequestId)}/download`,
    { headers: authorizationHeaders(token) },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => undefined)) as
      { error?: { code?: string; correlationId?: string; message?: string } } | undefined;
    throw new ApiClientError(
      payload?.error?.message ?? 'The recovered file could not be downloaded.',
      payload?.error?.code ?? 'BACKUP_RESTORE_FILE_DOWNLOAD_FAILED',
      response.status,
      payload?.error?.correlationId,
    );
  }
  return response.blob();
}

export function loadBackupPolicyApprovals(token: string): Promise<BackupPolicyApprovalPage> {
  return unwrapApiResponse(
    backupApiClient.GET('/api/v1/backup/approval-requests', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function loadBackupArtifactDeletionRequests(
  token: string,
): Promise<BackupArtifactDeletionRequestPage> {
  return unwrapApiResponse(
    backupApiClient.GET('/api/v1/backup/artifact-deletion-requests', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function loadBackupRuns(token: string): Promise<BackupExecutionRunPage> {
  return unwrapApiResponse(
    backupApiClient.GET('/api/v1/backup/runs', { headers: authorizationHeaders(token) }),
  );
}

export function loadBackupFileRestoreOptions(
  token: string,
  runId: string,
  search: string,
): Promise<BackupFileRestoreOptions> {
  return unwrapApiResponse(
    backupApiClient.GET('/api/v1/backup/runs/{id}/file-restore-options', {
      headers: authorizationHeaders(token),
      params: { path: { id: runId }, query: { search } },
    }),
  );
}

export function loadBackupRestoreRequests(token: string): Promise<BackupRestoreRequestPage> {
  return unwrapApiResponse(
    backupApiClient.GET('/api/v1/backup/restore-requests', {
      headers: authorizationHeaders(token),
    }),
  );
}

export function loadBackupDatabaseRecoveryTables(
  token: string,
  restoreRequestId: string,
): Promise<BackupDatabaseRecoveryTablePage> {
  return unwrapApiResponse(
    backupApiClient.GET('/api/v1/backup/restore-requests/{id}/database/tables', {
      headers: authorizationHeaders(token),
      params: { path: { id: restoreRequestId } },
    }),
  );
}

export function recoverBackupDatabaseRecord(
  token: string,
  restoreRequestId: string,
  input: BackupDatabaseRecordRecoveryRequest,
): Promise<BackupDatabaseRecordRecovery> {
  return unwrapApiResponse(
    backupApiClient.POST('/api/v1/backup/restore-requests/{id}/database/record', {
      body: input,
      headers: authorizationHeaders(token),
      params: { path: { id: restoreRequestId } },
    }),
  );
}

export function requestBackupRestore(
  token: string,
  runId: string,
  input: RequestBackupRestoreRequest,
  idempotencyKey: string,
): Promise<BackupRestoreRequest> {
  return unwrapApiResponse(
    backupApiClient.POST('/api/v1/backup/runs/{id}/restore-requests', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': idempotencyKey }, path: { id: runId } },
    }),
  );
}

export function requestBackupArtifactDeletion(
  token: string,
  runId: string,
  input: RequestBackupArtifactDeletionRequest,
  idempotencyKey: string,
): Promise<BackupArtifactDeletionRequest> {
  return unwrapApiResponse(
    backupApiClient.POST('/api/v1/backup/runs/{id}/deletion-requests', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': idempotencyKey }, path: { id: runId } },
    }),
  );
}

export function decideBackupArtifactDeletion(
  token: string,
  requestId: string,
  input: DecideBackupArtifactDeletionRequest,
  idempotencyKey: string,
): Promise<BackupArtifactDeletionRequest> {
  return unwrapApiResponse(
    backupApiClient.POST('/api/v1/backup/artifact-deletion-requests/{id}/decision', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': idempotencyKey }, path: { id: requestId } },
    }),
  );
}

export function decideBackupRestore(
  token: string,
  requestId: string,
  input: DecideBackupRestoreApprovalRequest,
  idempotencyKey: string,
): Promise<BackupRestoreRequest> {
  return unwrapApiResponse(
    backupApiClient.POST('/api/v1/backup/restore-requests/{id}/decision', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': idempotencyKey }, path: { id: requestId } },
    }),
  );
}

export function requestBackupPolicyApproval(
  token: string,
  policyId: string,
  input: RequestBackupPolicyApprovalRequest,
  idempotencyKey: string,
): Promise<BackupPolicy> {
  return unwrapApiResponse(
    backupApiClient.POST('/api/v1/backup/policies/{id}/approval', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': idempotencyKey }, path: { id: policyId } },
    }),
  );
}

export function requestBackupPolicyPause(
  token: string,
  policyId: string,
  input: RequestBackupPolicyApprovalRequest,
  idempotencyKey: string,
): Promise<BackupPolicy> {
  return unwrapApiResponse(
    backupApiClient.POST('/api/v1/backup/policies/{id}/pause-requests', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': idempotencyKey }, path: { id: policyId } },
    }),
  );
}

export function requestBackupPolicyRetentionReduction(
  token: string,
  policyId: string,
  input: RequestBackupRetentionReductionRequest,
  idempotencyKey: string,
): Promise<BackupPolicy> {
  return unwrapApiResponse(
    backupApiClient.POST('/api/v1/backup/policies/{id}/retention-reduction-requests', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': idempotencyKey }, path: { id: policyId } },
    }),
  );
}

export function decideBackupPolicyApproval(
  token: string,
  approvalId: string,
  input: DecideBackupPolicyApprovalRequest,
  idempotencyKey: string,
): Promise<BackupPolicy> {
  return unwrapApiResponse(
    backupApiClient.POST('/api/v1/backup/approval-requests/{id}/decision', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': idempotencyKey }, path: { id: approvalId } },
    }),
  );
}

export function activateBackupPolicy(
  token: string,
  policyId: string,
  input: ActivateBackupPolicyRequest,
  idempotencyKey: string,
): Promise<BackupPolicy> {
  return unwrapApiResponse(
    backupApiClient.POST('/api/v1/backup/policies/{id}/activate', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': idempotencyKey }, path: { id: policyId } },
    }),
  );
}

export function resumeBackupPolicy(
  token: string,
  policyId: string,
  input: ActivateBackupPolicyRequest,
  idempotencyKey: string,
): Promise<BackupPolicy> {
  return unwrapApiResponse(
    backupApiClient.POST('/api/v1/backup/policies/{id}/resume', {
      body: input,
      headers: authorizationHeaders(token),
      params: { header: { 'Idempotency-Key': idempotencyKey }, path: { id: policyId } },
    }),
  );
}

export function loadBackupSources(token: string): Promise<BackupRecordPage<BackupProtectedSource>> {
  return unwrapApiResponse(
    backupApiClient.GET('/api/v1/backup/sources', { headers: authorizationHeaders(token) }),
  );
}

export function loadBackupPolicies(token: string): Promise<BackupRecordPage<BackupPolicy>> {
  return unwrapApiResponse(
    backupApiClient.GET('/api/v1/backup/policies', { headers: authorizationHeaders(token) }),
  );
}

export function loadBackupReferenceData(token: string): Promise<BackupReferenceData> {
  return unwrapApiResponse(
    backupApiClient.GET('/api/v1/backup/reference-data', { headers: authorizationHeaders(token) }),
  );
}

export function saveBackupSource(
  token: string,
  input: CreateBackupProtectedSourceRequest | UpdateBackupProtectedSourceRequest,
  idempotencyKey: string,
  id?: string,
): Promise<BackupProtectedSource> {
  const headers = authorizationHeaders(token);
  return id
    ? unwrapApiResponse(
        backupApiClient.PUT('/api/v1/backup/sources/{id}', {
          body: input as UpdateBackupProtectedSourceRequest,
          headers,
          params: { header: { 'Idempotency-Key': idempotencyKey }, path: { id } },
        }),
      )
    : unwrapApiResponse(
        backupApiClient.POST('/api/v1/backup/sources', {
          body: input,
          headers,
          params: { header: { 'Idempotency-Key': idempotencyKey } },
        }),
      );
}

export function saveBackupPolicy(
  token: string,
  input: CreateBackupPolicyRequest | UpdateBackupPolicyRequest,
  idempotencyKey: string,
  id?: string,
): Promise<BackupPolicy> {
  const headers = authorizationHeaders(token);
  return id
    ? unwrapApiResponse(
        backupApiClient.PUT('/api/v1/backup/policies/{id}', {
          body: input as UpdateBackupPolicyRequest,
          headers,
          params: { header: { 'Idempotency-Key': idempotencyKey }, path: { id } },
        }),
      )
    : unwrapApiResponse(
        backupApiClient.POST('/api/v1/backup/policies', {
          body: input,
          headers,
          params: { header: { 'Idempotency-Key': idempotencyKey } },
        }),
      );
}
