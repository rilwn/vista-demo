import { createDecipheriv, createHash, randomUUID } from 'node:crypto';
import { PassThrough, Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  BackupDrTest,
  BackupDrTestPage,
  BackupPlanReview,
  BackupPlanReviewPage,
  BackupDataClassification,
  BackupArtifactDeletionRequest,
  BackupArtifactDeletionRequestPage,
  BackupExecutionRun,
  BackupExecutionRunPage,
  BackupFileRestoreOptions,
  BackupEmployeeOption,
  ActivateBackupPolicyRequest,
  BackupPolicy,
  BackupPolicyApprovalPage,
  BackupPolicyApprovalRequest,
  BackupProtectedSource,
  BackupRecordPage,
  BackupReferenceData,
  BackupRestoreRequest,
  BackupRestoreRequestPage,
  CreateBackupPolicyRequest,
  CreateBackupProtectedSourceRequest,
  DecideBackupPolicyApprovalRequest,
  DecideBackupArtifactDeletionRequest,
  DecideBackupRestoreApprovalRequest,
  RequestBackupRestoreRequest,
  RequestBackupArtifactDeletionRequest,
  RequestBackupPolicyApprovalRequest,
  RequestBackupRetentionReductionRequest,
  UpdateBackupPolicyRequest,
  UpdateBackupProtectedSourceRequest,
  PlanBackupDrTestRequest,
  RecordBackupDrTestRequest,
  RecordBackupPlanReviewRequest,
} from '@vista/contracts';
import type { PoolClient } from 'pg';

import { AuditService } from '../audit/audit.service.js';
import type {
  AuthenticationContext,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';
import type { BackupPageQueryDto } from './backup.dto.js';
import { hashBackupPlanSnapshot, loadBackupPlanSnapshot } from './backup-plan-review.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import { ObjectStorageBackupArchive } from './object-storage-backup-archive.js';
import { FileShareBackupArchive } from './file-share-backup-archive.js';
import { createBackupDecompressor, createUncompressedSizeGuard } from './backup-compression.js';
import {
  backupDatabaseSourceUrl,
  databaseEngineMatchesRestoreTarget,
  databaseRestoreTargetMatches,
} from './backup-database-source.js';
import { emailImapBackupSourceSnapshot } from './email-imap-backup-source.js';
import { objectStorageBackupSourceBucket } from './object-storage-backup-source.js';
import { webDavBackupSourceSnapshot } from './webdav-backup-source.js';

interface SourceRow {
  annual_growth_percent: string | null;
  created_at: Date | string;
  credential_custody: string;
  data_classification: BackupDataClassification;
  data_steward_employee_id: string | null;
  data_steward_name: string | null;
  dependencies: string;
  encrypted_at_source: boolean;
  estimated_size_gib: string | null;
  id: string;
  location: string;
  name: string;
  owner_employee_id: string | null;
  owner_name: string | null;
  restore_prerequisites: string;
  source_code: string;
  source_type: BackupProtectedSource['sourceType'];
  status: BackupProtectedSource['status'];
  updated_at: Date | string;
  version: number;
}

interface PolicyRow {
  backup_type: BackupPolicy['backupType'];
  compression_enabled: boolean;
  created_at: Date | string;
  day_of_month: number | null;
  day_of_week: number | null;
  encryption_required: boolean;
  frequency: BackupPolicy['frequency'];
  id: string;
  name: string;
  pause_request_pending: boolean;
  retention_reduction_request_pending: boolean;
  policy_code: string;
  retention_daily_copies: number;
  retention_monthly_copies: number;
  rpo_minutes: number;
  rto_minutes: number;
  run_time_local: string | null;
  sources: BackupPolicy['sources'];
  status: BackupPolicy['status'];
  updated_at: Date | string;
  verification_required: boolean;
  version: number;
}

export interface RestoredBackupFileContent {
  body: Readable;
  fileName: string;
  size: number;
}

interface IdempotencyRow {
  request_hash: string;
  response_body: unknown;
  status: 'completed' | 'failed' | 'processing';
}

interface PolicyApprovalRow {
  critical_action: 'disable_job' | 'modify_policy' | 'reduce_retention';
  expires_at: Date | string;
  id: string;
  justification: string;
  policy_code: string;
  policy_id: string;
  policy_name: string;
  policy_version: number;
  previous_daily_copies: number | null;
  previous_monthly_copies: number | null;
  proposed_daily_copies: number | null;
  proposed_monthly_copies: number | null;
  requested_at: Date | string;
  requested_by: string;
  requested_by_name: string;
}

interface ArtifactDeletionRequestRow {
  approved_by_name: string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  error_code: string | null;
  expires_at: Date | string;
  id: string;
  policy_code: string;
  policy_name: string;
  reason: string;
  requested_by: string;
  requested_by_name: string;
  run_id: string;
  scheduled_for: Date | string;
  status: BackupArtifactDeletionRequest['status'];
}

interface RestoreRequestRow {
  approved_by_name: string | null;
  attempt_count: number;
  completed_at: Date | string | null;
  created_at: Date | string;
  error_code: string | null;
  id: string;
  policy_code: string;
  policy_name: string;
  reason: string;
  restore_object_key: string | null;
  requested_by: string;
  requested_by_name: string;
  run_id: string;
  scheduled_for: Date | string;
  source_type: BackupRestoreRequest['sourceType'];
  status: BackupRestoreRequest['status'];
  target_database_name: string | null;
  target_storage_bucket: string | null;
  target_storage_prefix: string | null;
}

interface RestoreCatalogRunRow {
  artifact_deleted_at: Date | string | null;
  artifact_key: string | null;
  artifact_sha256: string | null;
  artifact_size_bytes: string | null;
  compression_algorithm: BackupExecutionRun['compressionAlgorithm'];
  encryption_nonce: string | null;
  encryption_tag: string | null;
  source_bucket_snapshot: string | null;
  source_type: BackupExecutionRun['sourceType'];
  source_code_snapshot: string | null;
  source_location_snapshot: string | null;
  status: BackupExecutionRun['status'];
  uncompressed_size_bytes: string | null;
  verification_status: BackupExecutionRun['verificationStatus'];
}

interface BackupDrTestRow {
  actual_rpo_minutes: number | null;
  actual_rto_minutes: number | null;
  backup_run_id: string;
  backup_scheduled_for: Date | string;
  completed_at: Date | string | null;
  corrective_actions: string;
  created_at: Date | string;
  created_by_name: string;
  evidence_file_id: string | null;
  id: string;
  non_conformities: string;
  outcome: 'failed' | 'passed' | null;
  planned_for: Date | string;
  policy_code: string;
  policy_name: string;
  protocol_signed_at: Date | string | null;
  protocol_signed_by: string | null;
  restore_request_id: string | null;
  restore_status: BackupDrTest['restoreStatus'] | null;
  result_summary: string | null;
  rpo_target_minutes: number;
  rto_target_minutes: number;
  scope: string;
  status: 'planned' | 'recorded';
  test_code: string;
}

interface BackupPlanReviewRow {
  corrective_actions: string;
  id: string;
  next_review_due_at: Date | string;
  outcome: BackupPlanReview['outcome'];
  plan_snapshot: BackupPlanReview['planSnapshot'];
  policy_count: number;
  protected_source_count: number;
  review_code: string;
  reviewed_at: Date | string;
  reviewed_by_name: string;
  snapshot_sha256: string;
  summary: string;
}

const sourceSelect = `
  SELECT source.id, source.source_code, source.name, source.source_type,
    source.data_classification, source.location, source.owner_employee_id,
    owner.display_name AS owner_name, source.data_steward_employee_id,
    steward.display_name AS data_steward_name, source.dependencies,
    source.estimated_size_gib::text, source.annual_growth_percent::text,
    source.credential_custody, source.encrypted_at_source,
    source.restore_prerequisites, source.status, source.version,
    source.created_at, source.updated_at
  FROM backup.protected_sources source
  LEFT JOIN identity.employees owner ON owner.id = source.owner_employee_id
  LEFT JOIN identity.employees steward ON steward.id = source.data_steward_employee_id`;

const policySelect = `
  SELECT policy.id, policy.policy_code, policy.name, policy.backup_type,
    policy.frequency, policy.run_time_local::text, policy.day_of_week,
    policy.day_of_month, policy.retention_daily_copies,
    policy.retention_monthly_copies, policy.rpo_minutes, policy.rto_minutes,
    policy.compression_enabled, policy.encryption_required,
    policy.verification_required, policy.status, policy.version,
    policy.created_at, policy.updated_at,
    EXISTS (
      SELECT 1 FROM backup.approval_requests pause_request
      WHERE pause_request.target_type='backup_policy'
        AND pause_request.target_id=policy.id
        AND pause_request.critical_action='disable_job'
        AND pause_request.status='pending'
        AND pause_request.expires_at > now()
    ) AS pause_request_pending,
    EXISTS (
      SELECT 1 FROM backup.retention_reduction_requests reduction
      JOIN backup.approval_requests request ON request.id=reduction.approval_request_id
      WHERE reduction.policy_id=policy.id
        AND reduction.status='pending'
        AND request.status='pending' AND request.expires_at > now()
    ) AS retention_reduction_request_pending,
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', source.id, 'name', source.name, 'sourceCode', source.source_code
    ) ORDER BY source.name, source.id) FILTER (WHERE source.id IS NOT NULL), '[]'::jsonb) AS sources
  FROM backup.policies policy
  LEFT JOIN backup.policy_sources link ON link.policy_id = policy.id
  LEFT JOIN backup.protected_sources source ON source.id = link.source_id`;

const backupDrTestSelect = `
  SELECT test.id,test.test_code,test.backup_run_id,run.scheduled_for AS backup_scheduled_for,
    test.planned_for,test.scope,test.rpo_target_minutes,test.rto_target_minutes,
    test.status,test.restore_request_id,restore.status AS restore_status,test.outcome,
    test.actual_rpo_minutes,test.actual_rto_minutes,test.result_summary,
    test.non_conformities,test.corrective_actions,test.evidence_file_id,
    test.protocol_signed_by,test.protocol_signed_at,test.created_at,test.completed_at,
    policy.policy_code,policy.name AS policy_name,employee.display_name AS created_by_name
  FROM backup.dr_test_records test
  JOIN backup.execution_runs run ON run.id=test.backup_run_id
  JOIN backup.policies policy ON policy.id=run.policy_id
  JOIN identity.user_accounts account ON account.id=test.created_by
  JOIN identity.employees employee ON employee.id=account.employee_id
  LEFT JOIN backup.restore_requests restore ON restore.id=test.restore_request_id`;

const backupPlanReviewSelect = `
  SELECT review.id,review.review_code,review.reviewed_at,review.next_review_due_at,
    review.outcome,review.summary,review.corrective_actions,
    review.protected_source_count,review.policy_count,review.plan_snapshot,
    review.snapshot_sha256,employee.display_name AS reviewed_by_name
  FROM backup.plan_reviews review
  JOIN identity.user_accounts account ON account.id=review.reviewed_by
  JOIN identity.employees employee ON employee.id=account.employee_id`;

@Injectable()
export class BackupService {
  private readonly objectStorageArchive = new ObjectStorageBackupArchive();
  private readonly fileShareArchive = new FileShareBackupArchive();

  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ObjectStorageService) private readonly storage: ObjectStorageService,
  ) {}

  async referenceData(): Promise<BackupReferenceData> {
    const result = await this.database.getPool().query<BackupEmployeeOption>(
      `SELECT employee.id, employee.display_name AS "displayName",
              employee.employee_number AS "employeeNumber"
       FROM identity.employees employee
       JOIN identity.user_accounts account ON account.employee_id = employee.id
       WHERE employee.active AND account.status = 'active'
       ORDER BY employee.display_name, employee.employee_number, employee.id`,
    );
    return { employees: result.rows };
  }

  async sources(query: BackupPageQueryDto): Promise<BackupRecordPage<BackupProtectedSource>> {
    const page = normalizePage(query);
    const pool = this.database.getPool();
    const [count, records] = await Promise.all([
      pool.query<{ total: string }>('SELECT count(*)::text AS total FROM backup.protected_sources'),
      pool.query<SourceRow>(
        `${sourceSelect}
         ORDER BY CASE source.data_classification
           WHEN 'critical' THEN 0 WHEN 'important' THEN 1 ELSE 2 END,
           upper(source.name), source.id
         LIMIT $1 OFFSET $2`,
        [page.pageSize, (page.page - 1) * page.pageSize],
      ),
    ]);
    return {
      items: records.rows.map(mapSource),
      page: page.page,
      pageSize: page.pageSize,
      total: Number(count.rows[0]?.total ?? 0),
    };
  }

  async policies(query: BackupPageQueryDto): Promise<BackupRecordPage<BackupPolicy>> {
    const page = normalizePage(query);
    const pool = this.database.getPool();
    const [count, records] = await Promise.all([
      pool.query<{ total: string }>('SELECT count(*)::text AS total FROM backup.policies'),
      pool.query<PolicyRow>(
        `${policySelect}
         GROUP BY policy.id
         ORDER BY CASE policy.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
           upper(policy.name), policy.id
         LIMIT $1 OFFSET $2`,
        [page.pageSize, (page.page - 1) * page.pageSize],
      ),
    ]);
    return {
      items: records.rows.map(mapPolicy),
      page: page.page,
      pageSize: page.pageSize,
      total: Number(count.rows[0]?.total ?? 0),
    };
  }

  async executionRuns(query: BackupPageQueryDto): Promise<BackupExecutionRunPage> {
    const page = normalizePage(query);
    const pool = this.database.getPool();
    const [count, records] = await Promise.all([
      pool.query<{ total: string }>('SELECT count(*)::text AS total FROM backup.execution_runs'),
      pool.query<{
        artifact_size_bytes: string | null;
        artifact_deleted_at: Date | string | null;
        artifact_deleted_reason: BackupExecutionRun['artifactDeletedReason'] | null;
        artifact_deletion_status: BackupExecutionRun['artifactDeletionStatus'] | null;
        attempt_count: number;
        backup_type: BackupPolicy['backupType'];
        compression_algorithm: BackupExecutionRun['compressionAlgorithm'];
        database_engine: 'mariadb' | 'postgresql' | null;
        error_code: string | null;
        id: string;
        independent_copy_error_code: string | null;
        independent_copy_status: BackupExecutionRun['independentCopyStatus'];
        independent_copy_target_code: string | null;
        independent_copy_verified_at: Date | string | null;
        policy_code: string;
        policy_name: string;
        scheduled_for: Date | string;
        source_code_snapshot: string | null;
        source_type: BackupExecutionRun['sourceType'];
        started_at: Date | string;
        status: BackupExecutionRun['status'];
        stored_at: Date | string | null;
        uncompressed_size_bytes: string | null;
        verification_attempt_count: number;
        verification_status: BackupExecutionRun['verificationStatus'];
        verified_at: Date | string | null;
      }>(
        `SELECT run.id,policy.policy_code,policy.name AS policy_name,run.backup_type,
           run.source_type,run.source_code_snapshot,run.database_engine,
           run.status,run.verification_status,run.attempt_count,
           run.verification_attempt_count,run.scheduled_for,run.started_at,run.stored_at,
           run.verified_at,run.artifact_size_bytes::text,run.uncompressed_size_bytes::text,
           run.independent_copy_status,run.independent_copy_target_code,
           run.independent_copy_error_code,run.independent_copy_verified_at,
           run.compression_algorithm,run.artifact_deleted_at,run.artifact_deleted_reason,
           run.error_code,deletion.status AS artifact_deletion_status
         FROM backup.execution_runs run
         JOIN backup.policies policy ON policy.id=run.policy_id
         LEFT JOIN LATERAL (
           SELECT request.status FROM backup.artifact_deletion_requests request
           WHERE request.execution_run_id=run.id
           ORDER BY request.created_at DESC,request.id DESC LIMIT 1
         ) deletion ON true
         ORDER BY run.started_at DESC,run.id DESC
         LIMIT $1 OFFSET $2`,
        [page.pageSize, (page.page - 1) * page.pageSize],
      ),
    ]);
    return {
      items: records.rows.map((row) => ({
        ...(row.artifact_size_bytes ? { artifactSizeBytes: row.artifact_size_bytes } : {}),
        artifactAvailable: Boolean(row.artifact_size_bytes && !row.artifact_deleted_at),
        ...(row.artifact_deleted_reason
          ? { artifactDeletedReason: row.artifact_deleted_reason }
          : {}),
        ...(row.artifact_deletion_status &&
        ['approved', 'failed', 'pending_approval', 'running'].includes(row.artifact_deletion_status)
          ? { artifactDeletionStatus: row.artifact_deletion_status }
          : {}),
        attemptCount: row.attempt_count,
        backupType: row.backup_type,
        compressionAlgorithm: row.compression_algorithm,
        ...(row.error_code ? { errorCode: row.error_code } : {}),
        id: row.id,
        independentCopyStatus: row.independent_copy_status,
        ...(row.independent_copy_target_code
          ? { independentCopyTargetCode: row.independent_copy_target_code }
          : {}),
        ...(row.independent_copy_error_code
          ? { independentCopyErrorCode: row.independent_copy_error_code }
          : {}),
        ...(row.independent_copy_verified_at
          ? { independentCopyVerifiedAt: iso(row.independent_copy_verified_at) }
          : {}),
        policyCode: row.policy_code,
        policyName: row.policy_name,
        scheduledFor: iso(row.scheduled_for),
        sourceType: row.source_type,
        restoreAvailable:
          /^[a-fA-F0-9]{64}$/u.test(this.environment.BACKUP_ENCRYPTION_KEY) &&
          (row.source_type === 'database'
            ? row.database_engine
              ? databaseEngineMatchesRestoreTarget(
                  row.database_engine,
                  this.environment.BACKUP_RESTORE_DATABASE_URL,
                )
              : databaseRestoreTargetMatches(
                  row.source_code_snapshot,
                  this.environment,
                  this.environment.BACKUP_RESTORE_DATABASE_URL,
                )
            : Boolean(this.environment.BACKUP_S3_BUCKET)),
        startedAt: iso(row.started_at),
        status: row.status,
        ...(row.stored_at ? { storedAt: iso(row.stored_at) } : {}),
        verificationAttemptCount: row.verification_attempt_count,
        verificationStatus: row.verification_status,
        ...(row.uncompressed_size_bytes
          ? { uncompressedSizeBytes: row.uncompressed_size_bytes }
          : {}),
        ...(row.verified_at ? { verifiedAt: iso(row.verified_at) } : {}),
      })),
      page: page.page,
      pageSize: page.pageSize,
      restoreAvailable: records.rows.some(
        (row) =>
          /^[a-fA-F0-9]{64}$/u.test(this.environment.BACKUP_ENCRYPTION_KEY) &&
          (row.source_type === 'database'
            ? row.database_engine
              ? databaseEngineMatchesRestoreTarget(
                  row.database_engine,
                  this.environment.BACKUP_RESTORE_DATABASE_URL,
                )
              : databaseRestoreTargetMatches(
                  row.source_code_snapshot,
                  this.environment,
                  this.environment.BACKUP_RESTORE_DATABASE_URL,
                )
            : Boolean(this.environment.BACKUP_S3_BUCKET)),
      ),
      total: Number(count.rows[0]?.total ?? 0),
    };
  }

  async fileRestoreOptions(runId: string, search: string): Promise<BackupFileRestoreOptions> {
    const needle = search.trim();
    if (needle.length < 2 || needle.length > 200) {
      throw new ApiErrorException(
        'BACKUP_RESTORE_FILE_SEARCH_INVALID',
        'Enter at least two characters from the file name or folder.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const files = await this.loadFileRestoreManifest(runId);
    const normalizedNeedle = needle.toLocaleLowerCase('en');
    const matches = files.filter((file) =>
      `${file.key} ${file.label ?? ''} ${file.searchableText ?? ''}`
        .toLocaleLowerCase('en')
        .includes(normalizedNeedle),
    );
    return {
      items: matches.slice(0, 100).map(({ key, label, sizeBytes }) => ({
        key,
        ...(label ? { label } : {}),
        sizeBytes,
      })),
      total: matches.length,
    };
  }

  async restoredFileContent(
    restoreRequestId: string,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<RestoredBackupFileContent> {
    const result = await this.database.getPool().query<{
      restore_object_key: string | null;
      source_type: BackupExecutionRun['sourceType'];
      status: BackupRestoreRequest['status'];
      target_storage_prefix: string | null;
    }>(
      `SELECT restore.status,restore.restore_object_key,restore.target_storage_prefix,run.source_type
       FROM backup.restore_requests restore
       JOIN backup.execution_runs run ON run.id=restore.execution_run_id
       WHERE restore.id=$1`,
      [restoreRequestId],
    );
    const restore = result.rows[0];
    if (!restore) throw resourceNotFound('restore request');
    if (
      restore.status !== 'completed' ||
      restore.source_type === 'database' ||
      !restore.restore_object_key ||
      !restore.target_storage_prefix ||
      !/^restores\/[a-f0-9]{32}\/attempt-[1-9][0-9]*\/$/u.test(restore.target_storage_prefix)
    ) {
      throw new ApiErrorException(
        'BACKUP_RESTORE_FILE_NOT_READY',
        'A selected file is available after its approved recovery has completed.',
        HttpStatus.CONFLICT,
      );
    }
    const object = await this.storage.getRestoredFileObjectStream(
      `${restore.target_storage_prefix}${restore.restore_object_key}`,
    );
    const fileName = restore.restore_object_key.split('/').at(-1);
    if (!fileName) {
      throw new ApiErrorException(
        'BACKUP_RESTORED_FILE_NOT_FOUND',
        'The recovered file is not available.',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.audit.append({
      action: 'backup.restore.file_downloaded',
      actorAccountId: actor.accountId,
      correlationId: metadata.correlationId,
      metadata: {
        fileName,
        objectKey: restore.restore_object_key,
        sizeBytes: object.size,
        sourceType: restore.source_type,
      },
      ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
      targetId: restoreRequestId,
      targetType: 'backup_restore_request',
      ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
    });
    return { body: object.body, fileName, size: object.size };
  }

  requestArtifactDeletion(
    runId: string,
    input: RequestBackupArtifactDeletionRequest,
    idempotencyKey: string | undefined,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BackupArtifactDeletionRequest> {
    const reason = normalizeText(input.reason);
    if (reason.length < 10 || reason.length > 1000) {
      throw new ApiErrorException(
        'BACKUP_ARTIFACT_DELETION_REASON_REQUIRED',
        'Explain why this verified restore point should be removed.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.executeCommand(
      'artifact-deletion.request',
      idempotencyKey,
      { reason, runId },
      actor,
      metadata,
      async (client) => {
        const run = await client.query<{
          artifact_deleted_at: Date | string | null;
          artifact_key: string | null;
          artifact_sha256: string | null;
          status: BackupExecutionRun['status'];
          verification_status: BackupExecutionRun['verificationStatus'];
        }>(
          `SELECT artifact_deleted_at,artifact_key,artifact_sha256,status,verification_status
           FROM backup.execution_runs WHERE id=$1 FOR UPDATE`,
          [runId],
        );
        const target = run.rows[0];
        if (!target) throw resourceNotFound('verified backup');
        if (
          target.status !== 'verified' ||
          target.verification_status !== 'verified' ||
          target.artifact_deleted_at ||
          !target.artifact_key ||
          !target.artifact_sha256 ||
          !/^[a-fA-F0-9]{64}$/u.test(target.artifact_sha256)
        ) {
          throw new ApiErrorException(
            'BACKUP_ARTIFACT_DELETION_NOT_AVAILABLE',
            'Only a verified restore point that is still available can be removed.',
            HttpStatus.CONFLICT,
          );
        }
        const dependentRun = await client.query(
          `SELECT 1 FROM backup.execution_runs child
           WHERE child.parent_run_id=$1
             AND child.status IN ('running','stored','verified')
             AND child.artifact_deleted_at IS NULL
           LIMIT 1`,
          [runId],
        );
        if (dependentRun.rowCount) {
          throw new ApiErrorException(
            'BACKUP_ARTIFACT_DELETION_BASE_IN_USE',
            'This restore point is a base for a later backup. Remove dependent restore points first.',
            HttpStatus.CONFLICT,
          );
        }
        const activeRestore = await client.query(
          `SELECT 1 FROM backup.restore_requests
           WHERE execution_run_id=$1 AND status IN ('pending_approval','approved','running')
           LIMIT 1`,
          [runId],
        );
        if (activeRestore.rowCount) {
          throw new ApiErrorException(
            'BACKUP_ARTIFACT_DELETION_RESTORE_IN_PROGRESS',
            'This restore point is in use by a restore request and cannot be removed yet.',
            HttpStatus.CONFLICT,
          );
        }
        const approvalId = randomUUID();
        await client.query(
          `INSERT INTO backup.approval_requests (
             id,critical_action,target_type,target_id,requested_by,expires_at,
             justification,correlation_id
           ) VALUES ($1,'delete_restore_point','backup_execution_run',$2,$3,
             now()+interval '14 days',$4,$5)`,
          [approvalId, runId, actor.accountId, reason, metadata.correlationId],
        );
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO backup.artifact_deletion_requests (
             execution_run_id,approval_request_id,target_sha256,reason,requested_by
           ) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [runId, approvalId, target.artifact_sha256.toLowerCase(), reason, actor.accountId],
        );
        const id = inserted.rows[0]?.id;
        if (!id) throw new Error('Restore-point deletion request insert did not return an id');
        await client.query(
          `INSERT INTO backup.artifact_deletion_events(request_id,event_type,actor_account_id,details)
           VALUES($1,'requested',$2,$3)`,
          [id, actor.accountId, { runId, targetSha256: target.artifact_sha256.toLowerCase() }],
        );
        return getArtifactDeletionRequest(client, id);
      },
      'backup_artifact_deletion_request',
      'backup.artifact_deletion.requested',
      isBackupArtifactDeletionRequest,
    );
  }

  async artifactDeletionRequests(): Promise<BackupArtifactDeletionRequestPage> {
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const expired = await client.query<{ id: string; requested_by: string }>(
        `SELECT request.id,request.requested_by
         FROM backup.artifact_deletion_requests request
         JOIN backup.approval_requests approval ON approval.id=request.approval_request_id
         WHERE request.status='pending_approval' AND approval.status='pending'
           AND approval.expires_at<=now()
         ORDER BY approval.expires_at,request.id LIMIT 100
         FOR UPDATE OF request,approval SKIP LOCKED`,
      );
      for (const request of expired.rows) {
        await client.query(
          `UPDATE backup.approval_requests SET status='expired'
           WHERE id=(SELECT approval_request_id FROM backup.artifact_deletion_requests WHERE id=$1)`,
          [request.id],
        );
        await client.query(
          `UPDATE backup.artifact_deletion_requests SET status='expired',updated_at=now()
           WHERE id=$1 AND status='pending_approval'`,
          [request.id],
        );
        await client.query(
          `INSERT INTO backup.artifact_deletion_events(request_id,event_type,details)
           VALUES($1,'expired','{}'::jsonb)`,
          [request.id],
        );
        await this.audit.append(
          {
            action: 'backup.artifact_deletion.expired',
            actorAccountId: request.requested_by,
            correlationId: `backup-artifact-deletion-expired:${request.id}`,
            targetId: request.id,
            targetType: 'backup_artifact_deletion_request',
          },
          client,
        );
      }
      const result = await client.query<ArtifactDeletionRequestRow>(
        `SELECT request.id,request.reason,request.status,request.error_code,
            request.completed_at,request.created_at,approval.expires_at,
            request.execution_run_id AS run_id,run.scheduled_for,
            policy.policy_code,policy.name AS policy_name,request.requested_by,
            requested_employee.display_name AS requested_by_name,
            approved_employee.display_name AS approved_by_name
         FROM backup.artifact_deletion_requests request
         JOIN backup.approval_requests approval ON approval.id=request.approval_request_id
         JOIN backup.execution_runs run ON run.id=request.execution_run_id
         JOIN backup.policies policy ON policy.id=run.policy_id
         JOIN identity.user_accounts requested_account ON requested_account.id=request.requested_by
         JOIN identity.employees requested_employee ON requested_employee.id=requested_account.employee_id
         LEFT JOIN identity.user_accounts approved_account ON approved_account.id=request.approved_by
         LEFT JOIN identity.employees approved_employee ON approved_employee.id=approved_account.employee_id
         WHERE request.status='pending_approval' AND approval.status='pending'
           AND approval.expires_at>now()
         ORDER BY request.created_at,request.id LIMIT 100`,
      );
      await client.query('COMMIT');
      const items = result.rows.map(mapArtifactDeletionRequest);
      return { items, total: items.length };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  decideArtifactDeletion(
    id: string,
    input: DecideBackupArtifactDeletionRequest,
    idempotencyKey: string | undefined,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BackupArtifactDeletionRequest> {
    const comment = normalizeText(input.comment ?? '');
    return this.executeCommand(
      'artifact-deletion.decide',
      idempotencyKey,
      { comment, decision: input.decision, id },
      actor,
      metadata,
      async (client) => {
        const locked = await client.query<{
          approval_id: string;
          approval_status: string;
          expired: boolean;
          requested_by: string;
          run_deleted_at: Date | string | null;
          run_sha256: string | null;
          run_status: string;
          run_verification_status: string;
          status: BackupArtifactDeletionRequest['status'];
          target_sha256: string;
        }>(
          `SELECT request.approval_request_id AS approval_id,request.status,
              request.requested_by,request.target_sha256,
              approval.status AS approval_status,approval.expires_at<=now() AS expired,
              run.artifact_deleted_at AS run_deleted_at,run.artifact_sha256 AS run_sha256,
              run.status AS run_status,run.verification_status AS run_verification_status
           FROM backup.artifact_deletion_requests request
           JOIN backup.approval_requests approval ON approval.id=request.approval_request_id
           JOIN backup.execution_runs run ON run.id=request.execution_run_id
           WHERE request.id=$1 AND approval.critical_action='delete_restore_point'
             AND approval.target_type='backup_execution_run'
           FOR UPDATE OF request,approval,run`,
          [id],
        );
        const request = locked.rows[0];
        if (!request) throw resourceNotFound('restore-point deletion request');
        if (request.status !== 'pending_approval' || request.approval_status !== 'pending') {
          throw approvalNoLongerPending();
        }
        if (request.requested_by === actor.accountId) {
          throw new ApiErrorException(
            'BACKUP_SELF_APPROVAL_DENIED',
            'A different authorised person must review this restore-point deletion.',
            HttpStatus.FORBIDDEN,
          );
        }
        const before = await getArtifactDeletionRequest(client, id);
        const targetChanged =
          request.run_deleted_at ||
          request.run_status !== 'verified' ||
          request.run_verification_status !== 'verified' ||
          request.run_sha256?.toLowerCase() !== request.target_sha256;
        const activeRestore = await client.query(
          `SELECT 1 FROM backup.restore_requests
           WHERE execution_run_id=(SELECT execution_run_id FROM backup.artifact_deletion_requests WHERE id=$1)
             AND status IN ('pending_approval','approved','running')
           LIMIT 1`,
          [id],
        );
        if (activeRestore.rowCount && input.decision === 'approve') {
          throw new ApiErrorException(
            'BACKUP_ARTIFACT_DELETION_RESTORE_IN_PROGRESS',
            'A restore request is in progress. Wait for it to finish before approving removal.',
            HttpStatus.CONFLICT,
          );
        }
        if (request.expired || targetChanged) {
          await client.query(`UPDATE backup.approval_requests SET status='expired' WHERE id=$1`, [
            request.approval_id,
          ]);
          await client.query(
            `UPDATE backup.artifact_deletion_requests SET status='expired',updated_at=now()
             WHERE id=$1 AND status='pending_approval'`,
            [id],
          );
          await client.query(
            `INSERT INTO backup.artifact_deletion_events(request_id,event_type,actor_account_id,details)
             VALUES($1,'expired',$2,$3)`,
            [id, actor.accountId, { targetChanged }],
          );
          return {
            after: await getArtifactDeletionRequest(client, id),
            before,
            event: 'backup.artifact_deletion.expired',
          };
        }
        await client.query(
          `INSERT INTO backup.approvals(request_id,approver_account_id,decision,comment)
           VALUES($1,$2,$3,$4)`,
          [request.approval_id, actor.accountId, input.decision, comment || null],
        );
        const approved = input.decision === 'approve';
        await client.query(`UPDATE backup.approval_requests SET status=$2 WHERE id=$1`, [
          request.approval_id,
          approved ? 'approved' : 'rejected',
        ]);
        await client.query(
          `UPDATE backup.artifact_deletion_requests
           SET status=$2,approved_by=$3,updated_at=now()
           WHERE id=$1 AND status='pending_approval'`,
          [id, approved ? 'approved' : 'rejected', approved ? actor.accountId : null],
        );
        await client.query(
          `INSERT INTO backup.artifact_deletion_events(request_id,event_type,actor_account_id,details)
           VALUES($1,$2,$3,$4)`,
          [id, approved ? 'approved' : 'rejected', actor.accountId, { comment }],
        );
        return {
          after: await getArtifactDeletionRequest(client, id),
          before,
          event: approved
            ? 'backup.artifact_deletion.approved'
            : 'backup.artifact_deletion.rejected',
        };
      },
      'backup_artifact_deletion_request',
      'backup.artifact_deletion.decision_recorded',
      isBackupArtifactDeletionRequest,
    );
  }

  async restoreRequests(): Promise<BackupRestoreRequestPage> {
    while ((await this.expireRestoreApprovals()) === 100) {
      // Expire old requests in bounded batches before presenting the review queue.
    }
    const result = await this.database.getPool().query<RestoreRequestRow>(
      `SELECT restore.id,restore.execution_run_id AS run_id,restore.reason,
          restore.status,restore.attempt_count,restore.target_database_name,
          restore.target_storage_bucket,restore.target_storage_prefix,
          restore.restore_object_key,restore.error_code,
          restore.completed_at,restore.created_at,policy.policy_code,policy.name AS policy_name,
          run.scheduled_for,run.source_type,requested_employee.display_name AS requested_by_name,
          approved_employee.display_name AS approved_by_name
       FROM backup.restore_requests restore
       JOIN backup.execution_runs run ON run.id=restore.execution_run_id
       JOIN backup.policies policy ON policy.id=run.policy_id
       JOIN identity.user_accounts requested_account ON requested_account.id=restore.requested_by
       JOIN identity.employees requested_employee ON requested_employee.id=requested_account.employee_id
       LEFT JOIN identity.user_accounts approved_account ON approved_account.id=restore.approved_by
       LEFT JOIN identity.employees approved_employee ON approved_employee.id=approved_account.employee_id
       ORDER BY restore.created_at DESC,restore.id DESC
       LIMIT 100`,
    );
    return { items: result.rows.map(mapRestoreRequest), total: result.rows.length };
  }

  async drTests(): Promise<BackupDrTestPage> {
    const result = await this.database.getPool().query<BackupDrTestRow>(
      `${backupDrTestSelect}
       ORDER BY test.planned_for DESC,test.created_at DESC,test.id DESC LIMIT 200`,
    );
    return { items: result.rows.map(mapBackupDrTest), total: result.rows.length };
  }

  async planReviews(): Promise<BackupPlanReviewPage> {
    const pool = this.database.getPool();
    const [snapshot, result] = await Promise.all([
      loadBackupPlanSnapshot(pool, this.environment.BACKUP_S3_BUCKET),
      pool.query<BackupPlanReviewRow>(
        `${backupPlanReviewSelect} ORDER BY review.reviewed_at DESC,review.id DESC LIMIT 100`,
      ),
    ]);
    const items = result.rows.map(mapBackupPlanReview);
    const currentSnapshotSha256 = hashBackupPlanSnapshot(snapshot);
    const latest = items[0];
    return {
      currentPlanSnapshot: snapshot,
      currentSnapshotSha256,
      items,
      reviewRequired:
        !latest ||
        latest.outcome === 'changes_required' ||
        latest.snapshotSha256 !== currentSnapshotSha256 ||
        new Date(latest.nextReviewDueAt).getTime() <= Date.now(),
      total: result.rows.length,
    };
  }

  recordPlanReview(
    input: RecordBackupPlanReviewRequest,
    idempotencyKey: string | undefined,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BackupPlanReview> {
    const normalized = {
      correctiveActions: normalizeOptionalText(input.correctiveActions),
      outcome: input.outcome,
      summary: normalizeText(input.summary),
    };
    if (
      normalized.summary.length < 10 ||
      normalized.summary.length > 2000 ||
      (normalized.outcome === 'changes_required' &&
        (normalized.correctiveActions.length < 10 || normalized.correctiveActions.length > 4000))
    ) {
      throw new ApiErrorException(
        'BACKUP_PLAN_REVIEW_DETAILS_INVALID',
        'Enter a clear review summary and, when changes are required, the corrective actions.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.executeCommand(
      'plan-review.record',
      idempotencyKey,
      normalized,
      actor,
      metadata,
      async (client) => {
        const snapshot = await loadBackupPlanSnapshot(client, this.environment.BACKUP_S3_BUCKET);
        const id = randomUUID();
        const reviewCode = `BPR-${new Date().getUTCFullYear()}-${id.slice(0, 8).toUpperCase()}`;
        await client.query(
          `INSERT INTO backup.plan_reviews (
             id,review_code,reviewed_by,next_review_due_at,outcome,summary,
             corrective_actions,protected_source_count,policy_count,plan_snapshot,snapshot_sha256
           ) VALUES ($1,$2,$3,now()+interval '1 year',$4,$5,$6,$7,$8,$9,$10)`,
          [
            id,
            reviewCode,
            actor.accountId,
            normalized.outcome,
            normalized.summary,
            normalized.correctiveActions,
            snapshot.protectedSources.length,
            snapshot.policies.length,
            snapshot,
            hashBackupPlanSnapshot(snapshot),
          ],
        );
        return loadBackupPlanReview(client, id);
      },
      'backup_plan_review',
      'backup.plan_review.recorded',
      isBackupPlanReview,
    );
  }

  planDrTest(
    input: PlanBackupDrTestRequest,
    idempotencyKey: string | undefined,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BackupDrTest> {
    const scope = normalizeText(input.scope);
    const plannedFor = new Date(input.plannedFor);
    if (
      scope.length < 10 ||
      scope.length > 2000 ||
      !Number.isFinite(plannedFor.getTime()) ||
      plannedFor.getTime() <= Date.now()
    ) {
      throw new ApiErrorException(
        'BACKUP_DR_TEST_DETAILS_INVALID',
        'Enter the test scope and a future planned date.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (
      !this.environment.BACKUP_RESTORE_DATABASE_URL ||
      !/^[a-fA-F0-9]{64}$/u.test(this.environment.BACKUP_ENCRYPTION_KEY)
    ) {
      throw restoreTargetNotConfigured();
    }
    const normalized = { plannedFor: plannedFor.toISOString(), runId: input.runId, scope };
    return this.executeCommand(
      'dr-test.plan',
      idempotencyKey,
      normalized,
      actor,
      metadata,
      async (client) => {
        const run = await client.query<{
          artifact_deleted_at: Date | string | null;
          backup_type: string;
          id: string;
          database_engine: 'mariadb' | 'postgresql' | null;
          source_code_snapshot: string | null;
          status: string;
          verification_status: string;
        }>(
          `SELECT id,source_code_snapshot,database_engine,backup_type,status,verification_status,artifact_deleted_at
           FROM backup.execution_runs WHERE id=$1 FOR SHARE`,
          [input.runId],
        );
        const verifiedRun = run.rows[0];
        if (!verifiedRun) throw resourceNotFound('verified backup');
        if (
          verifiedRun.status !== 'verified' ||
          verifiedRun.verification_status !== 'verified' ||
          verifiedRun.artifact_deleted_at ||
          !['database_snapshot', 'full'].includes(verifiedRun.backup_type) ||
          !(verifiedRun.database_engine
            ? databaseEngineMatchesRestoreTarget(
                verifiedRun.database_engine,
                this.environment.BACKUP_RESTORE_DATABASE_URL,
              )
            : databaseRestoreTargetMatches(
                verifiedRun.source_code_snapshot,
                this.environment,
                this.environment.BACKUP_RESTORE_DATABASE_URL,
              ))
        ) {
          throw new ApiErrorException(
            'BACKUP_DR_TEST_RUN_NOT_RESTORABLE',
            'Choose a verified database backup that is still available for restoration.',
            HttpStatus.CONFLICT,
          );
        }
        const id = randomUUID();
        const testCode = `DRT-${new Date().getUTCFullYear()}-${id.slice(0, 8).toUpperCase()}`;
        await client.query(
          `INSERT INTO backup.dr_test_records (
             id,test_code,backup_run_id,planned_for,scope,rpo_target_minutes,
             rto_target_minutes,created_by
           ) SELECT $1,$2,run.id,$3,$4,policy.rpo_minutes,policy.rto_minutes,$5
             FROM backup.execution_runs run
             JOIN backup.policies policy ON policy.id=run.policy_id
            WHERE run.id=$6`,
          [id, testCode, normalized.plannedFor, normalized.scope, actor.accountId, input.runId],
        );
        await insertDrTestEvent(client, id, 'planned', actor.accountId, {
          backupRunId: input.runId,
          plannedFor: normalized.plannedFor,
        });
        return loadBackupDrTest(client, id);
      },
      'backup_dr_test',
      'backup.dr_test.planned',
      isBackupDrTest,
    );
  }

  recordDrTest(
    id: string,
    input: RecordBackupDrTestRequest,
    idempotencyKey: string | undefined,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BackupDrTest> {
    const protocolSignedAt = new Date(input.protocolSignedAt);
    if (!Number.isFinite(protocolSignedAt.getTime())) {
      throw new ApiErrorException(
        'BACKUP_DR_TEST_RESULT_INVALID',
        'Enter the signed date and time shown on the protocol.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const normalized = {
      actualRpoMinutes: input.actualRpoMinutes,
      actualRtoMinutes: input.actualRtoMinutes,
      correctiveActions: normalizeOptionalText(input.correctiveActions),
      evidenceFileId: input.evidenceFileId,
      nonConformities: normalizeOptionalText(input.nonConformities),
      protocolSignedAt: protocolSignedAt.toISOString(),
      protocolSignedBy: normalizeText(input.protocolSignedBy),
      restoreRequestId: input.restoreRequestId,
      resultSummary: normalizeText(input.resultSummary),
    };
    if (
      !Number.isSafeInteger(normalized.actualRpoMinutes) ||
      normalized.actualRpoMinutes < 0 ||
      !Number.isSafeInteger(normalized.actualRtoMinutes) ||
      normalized.actualRtoMinutes < 0 ||
      !normalized.protocolSignedBy ||
      normalized.protocolSignedBy.length > 180 ||
      !normalized.resultSummary ||
      normalized.resultSummary.length < 10 ||
      normalized.resultSummary.length > 4000 ||
      normalized.nonConformities.length > 4000 ||
      normalized.correctiveActions.length > 4000 ||
      protocolSignedAt.getTime() > Date.now()
    ) {
      throw new ApiErrorException(
        'BACKUP_DR_TEST_RESULT_INVALID',
        'Enter the measured recovery times, result, and signed protocol details.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.executeCommand(
      'dr-test.record',
      idempotencyKey,
      { ...normalized, id },
      actor,
      metadata,
      async (client) => {
        const testResult = await client.query<{
          backup_run_id: string;
          rpo_target_minutes: number;
          rto_target_minutes: number;
          status: string;
        }>(
          'SELECT backup_run_id,rpo_target_minutes,rto_target_minutes,status FROM backup.dr_test_records WHERE id=$1 FOR UPDATE',
          [id],
        );
        const test = testResult.rows[0];
        if (!test) throw resourceNotFound('disaster recovery test');
        if (test.status !== 'planned') throw changedRecord('disaster recovery test');

        const restore = await client.query<{ completed_at: Date | string | null; status: string }>(
          `SELECT completed_at,status FROM backup.restore_requests
           WHERE id=$1 AND execution_run_id=$2 FOR SHARE`,
          [normalized.restoreRequestId, test.backup_run_id],
        );
        const restoreResult = restore.rows[0];
        if (!restoreResult || !['completed', 'failed'].includes(restoreResult.status)) {
          throw new ApiErrorException(
            'BACKUP_DR_TEST_RESTORE_NOT_FINISHED',
            'Link a finished isolated restore for the backup selected in this test.',
            HttpStatus.CONFLICT,
          );
        }
        const evidence = await client.query<{ id: string }>(
          `SELECT file.id FROM files.objects file
           WHERE file.id=$1 AND file.parent_type='backup_dr_test' AND file.parent_id=$2
             AND file.status='available' AND file.media_type='application/pdf'
             AND file.version=(SELECT max(current.version) FROM files.objects current
                               WHERE current.version_group_id=file.version_group_id)`,
          [normalized.evidenceFileId, id],
        );
        if (!evidence.rows[0]) {
          throw new ApiErrorException(
            'BACKUP_DR_TEST_PROTOCOL_REQUIRED',
            'Attach the signed test protocol as an available PDF before recording the result.',
            HttpStatus.BAD_REQUEST,
          );
        }
        const outcome =
          restoreResult.status === 'completed' &&
          normalized.actualRpoMinutes <= test.rpo_target_minutes &&
          normalized.actualRtoMinutes <= test.rto_target_minutes
            ? 'passed'
            : 'failed';
        if (outcome === 'failed' && normalized.correctiveActions.length < 10) {
          throw new ApiErrorException(
            'BACKUP_DR_TEST_CORRECTIVE_ACTION_REQUIRED',
            'Record a corrective action of at least 10 characters when the restore or recovery target fails.',
            HttpStatus.BAD_REQUEST,
          );
        }
        await client.query(
          `UPDATE backup.dr_test_records SET status='recorded',restore_request_id=$2,
             outcome=$3,actual_rpo_minutes=$4,actual_rto_minutes=$5,result_summary=$6,
             non_conformities=$7,corrective_actions=$8,evidence_file_id=$9,
             protocol_signed_by=$10,protocol_signed_at=$11,completed_by=$12,
             completed_at=now()
           WHERE id=$1 AND status='planned'`,
          [
            id,
            normalized.restoreRequestId,
            outcome,
            normalized.actualRpoMinutes,
            normalized.actualRtoMinutes,
            normalized.resultSummary,
            normalized.nonConformities,
            normalized.correctiveActions,
            normalized.evidenceFileId,
            normalized.protocolSignedBy,
            normalized.protocolSignedAt,
            actor.accountId,
          ],
        );
        await insertDrTestEvent(client, id, 'result_recorded', actor.accountId, {
          actualRpoMinutes: normalized.actualRpoMinutes,
          actualRtoMinutes: normalized.actualRtoMinutes,
          outcome,
          restoreRequestId: normalized.restoreRequestId,
        });
        return loadBackupDrTest(client, id);
      },
      'backup_dr_test',
      'backup.dr_test.recorded',
      isBackupDrTest,
    );
  }

  requestRestore(
    runId: string,
    input: RequestBackupRestoreRequest,
    idempotencyKey: string | undefined,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BackupRestoreRequest> {
    const reason = input.reason.trim().replace(/\s+/gu, ' ');
    const objectKey = input.objectKey;
    if (reason.length < 10 || reason.length > 1000) {
      throw new ApiErrorException(
        'BACKUP_RESTORE_REASON_REQUIRED',
        'Explain why this verified backup needs to be restored.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (
      objectKey !== undefined &&
      (objectKey.length === 0 ||
        Buffer.byteLength(objectKey, 'utf8') > 1024 ||
        objectKey.includes('\u0000'))
    ) {
      throw new ApiErrorException(
        'BACKUP_RESTORE_OBJECT_KEY_INVALID',
        'Choose a file from the verified restore point.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!/^[a-fA-F0-9]{64}$/u.test(this.environment.BACKUP_ENCRYPTION_KEY)) {
      throw backupEncryptionNotConfigured();
    }
    return this.executeCommand(
      'restore.request',
      idempotencyKey,
      { reason, runId, ...(objectKey !== undefined ? { objectKey } : {}) },
      actor,
      metadata,
      async (client) => {
        const run = await client.query<{
          artifact_deleted_at: Date | string | null;
          backup_type: string;
          database_engine: 'mariadb' | 'postgresql' | null;
          source_type: BackupExecutionRun['sourceType'];
          source_code_snapshot: string | null;
          status: string;
          verification_status: string;
        }>(
          `SELECT artifact_deleted_at,backup_type,source_type,source_code_snapshot,database_engine,
             status,verification_status
           FROM backup.execution_runs WHERE id=$1 FOR UPDATE`,
          [runId],
        );
        if (!run.rows[0]) throw resourceNotFound('verified backup');
        if (
          run.rows[0].status !== 'verified' ||
          run.rows[0].verification_status !== 'verified' ||
          run.rows[0].artifact_deleted_at ||
          !isSupportedRestoreSource(run.rows[0].source_type, run.rows[0].backup_type) ||
          (objectKey !== undefined && run.rows[0].source_type === 'database') ||
          (run.rows[0].source_type !== 'database' && !this.environment.BACKUP_S3_BUCKET) ||
          (run.rows[0].source_type === 'database' &&
            !(run.rows[0].database_engine
              ? databaseEngineMatchesRestoreTarget(
                  run.rows[0].database_engine,
                  this.environment.BACKUP_RESTORE_DATABASE_URL,
                )
              : databaseRestoreTargetMatches(
                  run.rows[0].source_code_snapshot,
                  this.environment,
                  this.environment.BACKUP_RESTORE_DATABASE_URL,
                )))
        ) {
          throw new ApiErrorException(
            'BACKUP_RESTORE_SOURCE_NOT_READY',
            'Only a verified backup with a configured isolated restore target can be restored.',
            HttpStatus.CONFLICT,
          );
        }
        const activeDeletion = await client.query(
          `SELECT 1 FROM backup.artifact_deletion_requests
           WHERE execution_run_id=$1 AND status IN ('pending_approval','approved','running')
           LIMIT 1`,
          [runId],
        );
        if (activeDeletion.rowCount) {
          throw new ApiErrorException(
            'BACKUP_RESTORE_POINT_REMOVAL_PENDING',
            'This restore point has a removal request in progress and cannot be restored right now.',
            HttpStatus.CONFLICT,
          );
        }
        const restoreId = randomUUID();
        const approvalId = randomUUID();
        await client.query(
          `INSERT INTO backup.approval_requests (
             id,critical_action,target_type,target_id,requested_by,expires_at,
             justification,correlation_id
           ) VALUES ($1,'destructive_restore','backup_restore_request',$2,$3,
             now()+interval '14 days',$4,$5)`,
          [approvalId, restoreId, actor.accountId, reason, metadata.correlationId],
        );
        await client.query(
          `INSERT INTO backup.restore_requests (
             id,execution_run_id,approval_request_id,reason,requested_by,restore_object_key
           ) VALUES ($1,$2,$3,$4,$5,$6)`,
          [restoreId, runId, approvalId, reason, actor.accountId, objectKey ?? null],
        );
        await client.query(
          `INSERT INTO backup.restore_events(restore_request_id,event_type,actor_account_id,details)
          VALUES($1,'requested',$2,$3)`,
          [restoreId, actor.accountId, { runId, ...(objectKey ? { objectKey } : {}) }],
        );
        return getRestoreRequest(client, restoreId);
      },
      'backup_restore_request',
      'backup.restore.requested',
      isBackupRestoreRequest,
    );
  }

  decideRestoreApproval(
    id: string,
    input: DecideBackupRestoreApprovalRequest,
    idempotencyKey: string | undefined,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BackupRestoreRequest> {
    const comment = input.comment?.trim().replace(/\s+/gu, ' ') ?? '';
    return this.executeCommand(
      'restore.approval.decide',
      idempotencyKey,
      { comment, decision: input.decision, id },
      actor,
      metadata,
      async (client) => {
        const locked = await client.query<{
          approval_id: string;
          approval_expires_at: Date | string;
          approval_status: string;
          expired: boolean;
          requested_by: string;
          status: BackupRestoreRequest['status'];
        }>(
          `SELECT restore.approval_request_id AS approval_id,restore.status,
              approval.status AS approval_status,approval.expires_at AS approval_expires_at,
              approval.expires_at <= now() AS expired,restore.requested_by
           FROM backup.restore_requests restore
           JOIN backup.approval_requests approval ON approval.id=restore.approval_request_id
           WHERE restore.id=$1 AND approval.critical_action='destructive_restore'
             AND approval.target_type='backup_restore_request'
           FOR UPDATE OF restore,approval`,
          [id],
        );
        const request = locked.rows[0];
        if (!request) throw resourceNotFound('restore request');
        if (request.status !== 'pending_approval' || request.approval_status !== 'pending') {
          throw approvalNoLongerPending();
        }
        if (request.requested_by === actor.accountId) {
          throw new ApiErrorException(
            'BACKUP_SELF_APPROVAL_DENIED',
            'A different authorised person must review this restore.',
            HttpStatus.FORBIDDEN,
          );
        }
        const before = await getRestoreRequest(client, id);
        if (request.expired) {
          await client.query(`UPDATE backup.approval_requests SET status='expired' WHERE id=$1`, [
            request.approval_id,
          ]);
          await client.query(
            `UPDATE backup.restore_requests SET status='expired',updated_at=now()
             WHERE id=$1 AND status='pending_approval'`,
            [id],
          );
          await client.query(
            `INSERT INTO backup.restore_events(restore_request_id,event_type,actor_account_id,details)
             VALUES($1,'expired',$2,'{}'::jsonb)`,
            [id, actor.accountId],
          );
          return {
            after: await getRestoreRequest(client, id),
            before,
            event: 'backup.restore.approval_expired',
          };
        }
        await client.query(
          `INSERT INTO backup.approvals(request_id,approver_account_id,decision,comment)
           VALUES($1,$2,$3,$4)`,
          [request.approval_id, actor.accountId, input.decision, comment || null],
        );
        const approved = input.decision === 'approve';
        await client.query(`UPDATE backup.approval_requests SET status=$2 WHERE id=$1`, [
          request.approval_id,
          approved ? 'approved' : 'rejected',
        ]);
        await client.query(
          `UPDATE backup.restore_requests SET status=$2,approved_by=$3,updated_at=now()
           WHERE id=$1 AND status='pending_approval'`,
          [id, approved ? 'approved' : 'rejected', actor.accountId],
        );
        await client.query(
          `INSERT INTO backup.restore_events(restore_request_id,event_type,actor_account_id,details)
           VALUES($1,$2,$3,$4)`,
          [id, approved ? 'approved' : 'rejected', actor.accountId, { comment }],
        );
        return { after: await getRestoreRequest(client, id), before };
      },
      'backup_restore_request',
      'backup.restore.approval_decided',
      isBackupRestoreRequest,
    );
  }

  async policyApprovalRequests(): Promise<BackupPolicyApprovalPage> {
    while ((await this.expirePolicyApprovalRequests()) === 100) {
      // Drain expiration in bounded batches so an old queue cannot hide newer requests.
    }
    const result = await this.database.getPool().query<PolicyApprovalRow>(
      `SELECT approval.id, approval.critical_action, approval.requested_at, approval.expires_at,
              approval.justification, approval.requested_by,
              requester.display_name AS requested_by_name,
              policy.id AS policy_id, policy.policy_code, policy.name AS policy_name,
              COALESCE(approval.target_version,policy.version) AS policy_version,
              reduction.previous_daily_copies,reduction.previous_monthly_copies,
              reduction.proposed_daily_copies,reduction.proposed_monthly_copies
       FROM backup.approval_requests approval
       JOIN backup.policies policy ON policy.id = approval.target_id
       LEFT JOIN backup.retention_reduction_requests reduction
         ON reduction.approval_request_id=approval.id
       JOIN identity.user_accounts account ON account.id = approval.requested_by
       JOIN identity.employees requester ON requester.id = account.employee_id
       WHERE approval.critical_action IN ('modify_policy','disable_job','reduce_retention')
         AND approval.target_type = 'backup_policy'
         AND approval.status = 'pending'
         AND approval.expires_at > now()
       ORDER BY approval.requested_at, approval.id
       LIMIT 100`,
    );
    const items = result.rows.map(mapPolicyApproval);
    return { items, total: items.length };
  }

  createSource(
    input: CreateBackupProtectedSourceRequest,
    idempotencyKey: string | undefined,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BackupProtectedSource> {
    const normalized = normalizeSource(input);
    return this.executeCommand(
      'source.create',
      idempotencyKey,
      normalized,
      actor,
      metadata,
      async (client) => {
        await assertEmployees(client, [
          normalized.ownerEmployeeId,
          normalized.dataStewardEmployeeId,
        ]);
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO backup.protected_sources (
             source_code, name, source_type, data_classification, location,
             owner_employee_id, data_steward_employee_id, dependencies,
             estimated_size_gib, annual_growth_percent, credential_custody,
             encrypted_at_source, restore_prerequisites, created_by, updated_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
           RETURNING id`,
          [
            normalized.sourceCode,
            normalized.name,
            normalized.sourceType,
            normalized.dataClassification,
            normalized.location,
            normalized.ownerEmployeeId ?? null,
            normalized.dataStewardEmployeeId ?? null,
            normalized.dependencies,
            normalized.estimatedSizeGib ?? null,
            normalized.annualGrowthPercent ?? null,
            normalized.credentialCustody,
            normalized.encryptedAtSource,
            normalized.restorePrerequisites,
            actor.accountId,
          ],
        );
        const id = inserted.rows[0]?.id;
        if (!id) throw new Error('Protected source insert did not return an identifier');
        return getSource(client, id);
      },
      'backup_protected_source',
      'backup.protected_source.created',
      isSource,
    );
  }

  updateSource(
    id: string,
    input: UpdateBackupProtectedSourceRequest,
    idempotencyKey: string | undefined,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BackupProtectedSource> {
    const normalized = normalizeSource(input);
    return this.executeCommand(
      'source.update',
      idempotencyKey,
      { ...normalized, expectedVersion: input.expectedVersion, id },
      actor,
      metadata,
      async (client) => {
        await assertEmployees(client, [
          normalized.ownerEmployeeId,
          normalized.dataStewardEmployeeId,
        ]);
        const before = await getSource(client, id, true);
        if (before.version !== input.expectedVersion) throw changedRecord('source');
        if (before.status !== 'active') throw inactiveSource();
        const updated = await client.query(
          `UPDATE backup.protected_sources SET
             source_code=$1, name=$2, source_type=$3, data_classification=$4,
             location=$5, owner_employee_id=$6, data_steward_employee_id=$7,
             dependencies=$8, estimated_size_gib=$9, annual_growth_percent=$10,
             credential_custody=$11, encrypted_at_source=$12,
             restore_prerequisites=$13, version=version+1, updated_by=$14,
             updated_at=now()
           WHERE id=$15 AND version=$16`,
          [
            normalized.sourceCode,
            normalized.name,
            normalized.sourceType,
            normalized.dataClassification,
            normalized.location,
            normalized.ownerEmployeeId ?? null,
            normalized.dataStewardEmployeeId ?? null,
            normalized.dependencies,
            normalized.estimatedSizeGib ?? null,
            normalized.annualGrowthPercent ?? null,
            normalized.credentialCustody,
            normalized.encryptedAtSource,
            normalized.restorePrerequisites,
            actor.accountId,
            id,
            input.expectedVersion,
          ],
        );
        if (updated.rowCount !== 1) throw changedRecord('source');
        const after = await getSource(client, id);
        return { after, before };
      },
      'backup_protected_source',
      'backup.protected_source.updated',
      isSource,
    );
  }

  createPolicy(
    input: CreateBackupPolicyRequest,
    idempotencyKey: string | undefined,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BackupPolicy> {
    const normalized = normalizePolicy(input);
    return this.executeCommand(
      'policy.create',
      idempotencyKey,
      normalized,
      actor,
      metadata,
      async (client) => {
        const sources = await lockPolicySources(client, normalized.sourceIds);
        validatePolicyTargets(normalized, sources);
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO backup.policies (
             policy_code, name, backup_type, frequency, run_time_local,
             day_of_week, day_of_month, retention_daily_copies,
             retention_monthly_copies, rpo_minutes, rto_minutes,
             compression_enabled, encryption_required, verification_required,
             status, created_by, updated_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,true,'draft',$13,$13)
           RETURNING id`,
          [
            normalized.policyCode,
            normalized.name,
            normalized.backupType,
            normalized.frequency,
            normalized.runTimeLocal ?? null,
            normalized.dayOfWeek ?? null,
            normalized.dayOfMonth ?? null,
            normalized.retentionDailyCopies,
            normalized.retentionMonthlyCopies,
            normalized.rpoMinutes,
            normalized.rtoMinutes,
            normalized.compressionEnabled,
            actor.accountId,
          ],
        );
        const id = inserted.rows[0]?.id;
        if (!id) throw new Error('Backup policy insert did not return an identifier');
        await linkPolicySources(client, id, normalized.sourceIds, actor.accountId);
        return getPolicy(client, id);
      },
      'backup_policy',
      'backup.policy.draft_created',
      isPolicy,
    );
  }

  updatePolicy(
    id: string,
    input: UpdateBackupPolicyRequest,
    idempotencyKey: string | undefined,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BackupPolicy> {
    const normalized = normalizePolicy(input);
    return this.executeCommand(
      'policy.update',
      idempotencyKey,
      { ...normalized, expectedVersion: input.expectedVersion, id },
      actor,
      metadata,
      async (client) => {
        const locked = await client.query<{ status: BackupPolicy['status']; version: number }>(
          'SELECT status, version FROM backup.policies WHERE id=$1 FOR UPDATE',
          [id],
        );
        const row = locked.rows[0];
        if (!row) throw resourceNotFound('policy');
        if (row.status !== 'draft') throw policyNotDraft();
        if (row.version !== input.expectedVersion) throw changedRecord('policy');
        const before = await getPolicy(client, id);

        const sources = await lockPolicySources(client, normalized.sourceIds);
        validatePolicyTargets(normalized, sources);
        await client.query(
          `UPDATE backup.policies SET policy_code=$1, name=$2, backup_type=$3,
             frequency=$4, run_time_local=$5, day_of_week=$6, day_of_month=$7,
             retention_daily_copies=$8, retention_monthly_copies=$9,
             rpo_minutes=$10, rto_minutes=$11, compression_enabled=$12,
             encryption_required=true, verification_required=true,
             version=version+1, updated_by=$13, updated_at=now()
           WHERE id=$14 AND version=$15 AND status='draft'`,
          [
            normalized.policyCode,
            normalized.name,
            normalized.backupType,
            normalized.frequency,
            normalized.runTimeLocal ?? null,
            normalized.dayOfWeek ?? null,
            normalized.dayOfMonth ?? null,
            normalized.retentionDailyCopies,
            normalized.retentionMonthlyCopies,
            normalized.rpoMinutes,
            normalized.rtoMinutes,
            normalized.compressionEnabled,
            actor.accountId,
            id,
            input.expectedVersion,
          ],
        );
        await client.query('DELETE FROM backup.policy_sources WHERE policy_id=$1', [id]);
        await linkPolicySources(client, id, normalized.sourceIds, actor.accountId);
        return { after: await getPolicy(client, id), before };
      },
      'backup_policy',
      'backup.policy.draft_updated',
      isPolicy,
    );
  }

  requestPolicyApproval(
    id: string,
    input: RequestBackupPolicyApprovalRequest,
    idempotencyKey: string | undefined,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BackupPolicy> {
    const justification = input.justification.trim().replace(/\s+/gu, ' ');
    if (justification.length < 10 || justification.length > 1000) {
      throw new ApiErrorException(
        'BACKUP_APPROVAL_JUSTIFICATION_REQUIRED',
        'Explain why this backup policy should be approved.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.executeCommand(
      'policy.approval.request',
      idempotencyKey,
      { expectedVersion: input.expectedVersion, id, justification },
      actor,
      metadata,
      async (client) => {
        const locked = await client.query<{ status: BackupPolicy['status']; version: number }>(
          'SELECT status,version FROM backup.policies WHERE id=$1 FOR UPDATE',
          [id],
        );
        const row = locked.rows[0];
        if (!row) throw resourceNotFound('policy');
        const before = await getPolicy(client, id);
        if (before.status !== 'draft') throw policyNotDraft();
        if (before.version !== input.expectedVersion) throw changedRecord('policy');
        await assertRunnableDatabasePolicy(
          client,
          id,
          before.backupType,
          this.environment,
          this.fileShareArchive,
        );
        const approvalId = randomUUID();
        await client.query(
          `INSERT INTO backup.approval_requests (
             id, critical_action, target_type, target_id, requested_by,
             expires_at, justification, correlation_id
           ) VALUES ($1,'modify_policy','backup_policy',$2,$3,now()+interval '14 days',$4,$5)`,
          [approvalId, id, actor.accountId, justification, metadata.correlationId],
        );
        const updated = await client.query(
          `UPDATE backup.policies SET status='pending_approval',version=version+1,
             updated_by=$2,updated_at=now() WHERE id=$1 AND version=$3 AND status='draft'`,
          [id, actor.accountId, input.expectedVersion],
        );
        if (updated.rowCount !== 1) throw changedRecord('policy');
        return { after: await getPolicy(client, id), before };
      },
      'backup_policy',
      'backup.policy.approval_requested',
      isPolicy,
    );
  }

  async requestPolicyPause(
    id: string,
    input: RequestBackupPolicyApprovalRequest,
    idempotencyKey: string | undefined,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BackupPolicy> {
    const justification = normalizeText(input.justification);
    if (justification.length < 10 || justification.length > 1000) {
      throw new ApiErrorException(
        'BACKUP_APPROVAL_JUSTIFICATION_REQUIRED',
        'Explain why this backup schedule needs to be paused.',
        HttpStatus.BAD_REQUEST,
      );
    }
    while ((await this.expirePolicyApprovalRequests()) === 100) {
      // Clear expired requests before checking the unique pending-pause guard.
    }
    return this.executeCommand(
      'policy.pause.request',
      idempotencyKey,
      { expectedVersion: input.expectedVersion, id, justification },
      actor,
      metadata,
      async (client) => {
        const locked = await client.query<{ status: BackupPolicy['status']; version: number }>(
          'SELECT status,version FROM backup.policies WHERE id=$1 FOR UPDATE',
          [id],
        );
        const policy = locked.rows[0];
        if (!policy) throw resourceNotFound('policy');
        if (policy.status !== 'active') throw policyNotActive();
        if (policy.version !== input.expectedVersion) throw changedRecord('policy');
        const pending = await client.query(
          `SELECT 1 FROM backup.approval_requests
           WHERE target_type='backup_policy' AND target_id=$1
             AND critical_action='disable_job' AND status='pending'
           LIMIT 1`,
          [id],
        );
        if (pending.rowCount) {
          throw new ApiErrorException(
            'BACKUP_POLICY_PAUSE_ALREADY_PENDING',
            'A pause request for this schedule is already awaiting review.',
            HttpStatus.CONFLICT,
          );
        }
        const before = await getPolicy(client, id);
        await client.query(
          `INSERT INTO backup.approval_requests (
             critical_action,target_type,target_id,target_version,requested_by,expires_at,
             justification,correlation_id
           ) VALUES ('disable_job','backup_policy',$1,$2,$3,now()+interval '14 days',$4,$5)`,
          [id, input.expectedVersion, actor.accountId, justification, metadata.correlationId],
        );
        return { after: await getPolicy(client, id), before };
      },
      'backup_policy',
      'backup.policy.pause_requested',
      isPolicy,
    );
  }

  async requestPolicyRetentionReduction(
    id: string,
    input: RequestBackupRetentionReductionRequest,
    idempotencyKey: string | undefined,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BackupPolicy> {
    const justification = normalizeText(input.justification);
    if (justification.length < 10 || justification.length > 1000) {
      throw new ApiErrorException(
        'BACKUP_APPROVAL_JUSTIFICATION_REQUIRED',
        'Explain why this backup retention window needs to be reduced.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (
      !Number.isSafeInteger(input.retentionDailyCopies) ||
      input.retentionDailyCopies < 1 ||
      input.retentionDailyCopies > 3650 ||
      !Number.isSafeInteger(input.retentionMonthlyCopies) ||
      input.retentionMonthlyCopies < 1 ||
      input.retentionMonthlyCopies > 120
    ) {
      throw new ApiErrorException(
        'BACKUP_RETENTION_REDUCTION_INVALID',
        'Enter valid daily and monthly retention counts.',
        HttpStatus.BAD_REQUEST,
      );
    }
    while ((await this.expirePolicyApprovalRequests()) === 100) {
      // Expire stale requests before applying the single-pending-request guard.
    }
    return this.executeCommand(
      'policy.retention.reduction.request',
      idempotencyKey,
      {
        expectedVersion: input.expectedVersion,
        id,
        justification,
        retentionDailyCopies: input.retentionDailyCopies,
        retentionMonthlyCopies: input.retentionMonthlyCopies,
      },
      actor,
      metadata,
      async (client) => {
        const locked = await client.query<{
          retention_daily_copies: number;
          retention_monthly_copies: number;
          status: BackupPolicy['status'];
          version: number;
        }>(
          `SELECT retention_daily_copies,retention_monthly_copies,status,version
           FROM backup.policies WHERE id=$1 FOR UPDATE`,
          [id],
        );
        const current = locked.rows[0];
        if (!current) throw resourceNotFound('policy');
        if (current.status !== 'active' && current.status !== 'paused') {
          throw new ApiErrorException(
            'BACKUP_RETENTION_REDUCTION_POLICY_NOT_ACTIVE',
            'Only an approved backup schedule can request a retention reduction.',
            HttpStatus.CONFLICT,
          );
        }
        if (current.version !== input.expectedVersion) throw changedRecord('policy');
        if (
          input.retentionDailyCopies > current.retention_daily_copies ||
          input.retentionMonthlyCopies > current.retention_monthly_copies ||
          (input.retentionDailyCopies === current.retention_daily_copies &&
            input.retentionMonthlyCopies === current.retention_monthly_copies)
        ) {
          throw new ApiErrorException(
            'BACKUP_RETENTION_REDUCTION_MUST_DECREASE',
            'A retention reduction must lower at least one copy count and cannot increase the other.',
            HttpStatus.BAD_REQUEST,
          );
        }
        const pending = await client.query(
          `SELECT 1 FROM backup.retention_reduction_requests
           WHERE policy_id=$1 AND status='pending' LIMIT 1`,
          [id],
        );
        if (pending.rowCount) {
          throw new ApiErrorException(
            'BACKUP_RETENTION_REDUCTION_ALREADY_PENDING',
            'A retention reduction for this schedule is already awaiting review.',
            HttpStatus.CONFLICT,
          );
        }
        const before = await getPolicy(client, id);
        const approval = await client.query<{ id: string }>(
          `INSERT INTO backup.approval_requests (
             critical_action,target_type,target_id,target_version,requested_by,
             expires_at,justification,correlation_id
           ) VALUES ('reduce_retention','backup_policy',$1,$2,$3,now()+interval '14 days',$4,$5)
           RETURNING id`,
          [id, current.version, actor.accountId, justification, metadata.correlationId],
        );
        const approvalId = approval.rows[0]?.id;
        if (!approvalId) throw new Error('Retention reduction approval was not created');
        await client.query(
          `INSERT INTO backup.retention_reduction_requests (
             approval_request_id,policy_id,target_policy_version,
             previous_daily_copies,previous_monthly_copies,
             proposed_daily_copies,proposed_monthly_copies
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            approvalId,
            id,
            current.version,
            current.retention_daily_copies,
            current.retention_monthly_copies,
            input.retentionDailyCopies,
            input.retentionMonthlyCopies,
          ],
        );
        return { after: await getPolicy(client, id), before };
      },
      'backup_policy',
      'backup.policy.retention_reduction_requested',
      isPolicy,
    );
  }

  decidePolicyApproval(
    approvalId: string,
    input: DecideBackupPolicyApprovalRequest,
    idempotencyKey: string | undefined,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BackupPolicy> {
    const comment = input.comment?.trim().replace(/\s+/gu, ' ') ?? '';
    return this.executeCommand(
      'policy.approval.decide',
      idempotencyKey,
      { approvalId, comment, decision: input.decision },
      actor,
      metadata,
      async (client) => {
        const locked = await client.query<{
          approval_id: string;
          critical_action: 'disable_job' | 'modify_policy' | 'reduce_retention';
          expired: boolean;
          expires_at: Date | string;
          policy_id: string;
          requested_by: string;
          status: string;
          target_version: number | null;
        }>(
          `SELECT approval.id AS approval_id,approval.critical_action,approval.expires_at,
                  approval.expires_at <= now() AS expired,
                  approval.target_id AS policy_id,
                  approval.requested_by,approval.status,approval.target_version
           FROM backup.approval_requests approval
           WHERE approval.id=$1
             AND approval.critical_action IN ('modify_policy','disable_job','reduce_retention')
             AND approval.target_type='backup_policy'
           FOR UPDATE`,
          [approvalId],
        );
        const request = locked.rows[0];
        if (!request) throw resourceNotFound('policy');
        if (request.status !== 'pending') throw approvalNoLongerPending();
        const policyLock = await client.query<{
          status: BackupPolicy['status'];
          version: number;
        }>('SELECT status,version FROM backup.policies WHERE id=$1 FOR UPDATE', [
          request.policy_id,
        ]);
        if (!policyLock.rows[0]) throw resourceNotFound('policy');
        const before = await getPolicy(client, request.policy_id);
        if (request.critical_action === 'modify_policy' && before.status !== 'pending_approval') {
          throw approvalNoLongerPending();
        }
        if (request.critical_action === 'disable_job') {
          if (request.requested_by === actor.accountId) {
            throw new ApiErrorException(
              'BACKUP_SELF_APPROVAL_DENIED',
              'A different authorised person must review this pause request.',
              HttpStatus.FORBIDDEN,
            );
          }
          if (
            request.expired ||
            before.status !== 'active' ||
            request.target_version !== policyLock.rows[0].version
          ) {
            await client.query(`UPDATE backup.approval_requests SET status='expired' WHERE id=$1`, [
              request.approval_id,
            ]);
            return {
              after: await getPolicy(client, request.policy_id),
              before,
              event: 'backup.policy.pause_approval_expired',
            };
          }
          await client.query(
            `INSERT INTO backup.approvals (request_id,approver_account_id,decision,comment)
             VALUES ($1,$2,$3,$4)`,
            [request.approval_id, actor.accountId, input.decision, comment || null],
          );
          const approved = input.decision === 'approve';
          await client.query(`UPDATE backup.approval_requests SET status=$2 WHERE id=$1`, [
            request.approval_id,
            approved ? 'approved' : 'rejected',
          ]);
          if (approved) {
            const paused = await client.query(
              `UPDATE backup.policies SET status='paused',version=version+1,
                 updated_by=$2,updated_at=now()
               WHERE id=$1 AND status='active' AND version=$3`,
              [request.policy_id, actor.accountId, request.target_version],
            );
            if (paused.rowCount !== 1) throw changedRecord('policy');
          }
          return {
            after: await getPolicy(client, request.policy_id),
            before,
            event: approved ? 'backup.policy.pause_approved' : 'backup.policy.pause_rejected',
          };
        }
        if (request.critical_action === 'reduce_retention') {
          if (request.requested_by === actor.accountId) {
            throw new ApiErrorException(
              'BACKUP_SELF_APPROVAL_DENIED',
              'A different authorised person must review this retention reduction.',
              HttpStatus.FORBIDDEN,
            );
          }
          const reductionResult = await client.query<{
            proposed_daily_copies: number;
            proposed_monthly_copies: number;
            status: string;
          }>(
            `SELECT proposed_daily_copies,proposed_monthly_copies,status
             FROM backup.retention_reduction_requests
             WHERE approval_request_id=$1 FOR UPDATE`,
            [request.approval_id],
          );
          const reduction = reductionResult.rows[0];
          if (!reduction || reduction.status !== 'pending') throw approvalNoLongerPending();
          if (
            request.expired ||
            (before.status !== 'active' && before.status !== 'paused') ||
            request.target_version !== policyLock.rows[0].version
          ) {
            await client.query(`UPDATE backup.approval_requests SET status='expired' WHERE id=$1`, [
              request.approval_id,
            ]);
            await client.query(
              `UPDATE backup.retention_reduction_requests
               SET status='expired',updated_at=now() WHERE approval_request_id=$1`,
              [request.approval_id],
            );
            return {
              after: await getPolicy(client, request.policy_id),
              before,
              event: 'backup.policy.retention_reduction_expired',
            };
          }
          await client.query(
            `INSERT INTO backup.approvals (request_id,approver_account_id,decision,comment)
             VALUES ($1,$2,$3,$4)`,
            [request.approval_id, actor.accountId, input.decision, comment || null],
          );
          const approved = input.decision === 'approve';
          await client.query(`UPDATE backup.approval_requests SET status=$2 WHERE id=$1`, [
            request.approval_id,
            approved ? 'approved' : 'rejected',
          ]);
          await client.query(
            `UPDATE backup.retention_reduction_requests
             SET status=$2,updated_at=now() WHERE approval_request_id=$1 AND status='pending'`,
            [request.approval_id, approved ? 'approved' : 'rejected'],
          );
          if (approved) {
            const updated = await client.query(
              `UPDATE backup.policies SET retention_daily_copies=$2,
                 retention_monthly_copies=$3,version=version+1,updated_by=$4,updated_at=now()
               WHERE id=$1 AND status IN ('active','paused') AND version=$5`,
              [
                request.policy_id,
                reduction.proposed_daily_copies,
                reduction.proposed_monthly_copies,
                actor.accountId,
                request.target_version,
              ],
            );
            if (updated.rowCount !== 1) throw changedRecord('policy');
          }
          return {
            after: await getPolicy(client, request.policy_id),
            before,
            event: approved
              ? 'backup.policy.retention_reduction_approved'
              : 'backup.policy.retention_reduction_rejected',
          };
        }
        if (request.requested_by === actor.accountId) {
          throw new ApiErrorException(
            'BACKUP_SELF_APPROVAL_DENIED',
            'A different authorised person must review this policy.',
            HttpStatus.FORBIDDEN,
          );
        }
        if (request.expired) {
          await client.query(`UPDATE backup.approval_requests SET status='expired' WHERE id=$1`, [
            approvalId,
          ]);
          await client.query(
            `UPDATE backup.policies SET status='draft',version=version+1,
               updated_by=$2,updated_at=now() WHERE id=$1 AND status='pending_approval'`,
            [request.policy_id, actor.accountId],
          );
          return {
            after: await getPolicy(client, request.policy_id),
            before,
            event: 'backup.policy.approval_expired',
          };
        }
        await client.query(
          `INSERT INTO backup.approvals (request_id,approver_account_id,decision,comment)
           VALUES ($1,$2,$3,$4)`,
          [approvalId, actor.accountId, input.decision, comment || null],
        );
        await client.query(`UPDATE backup.approval_requests SET status=$2 WHERE id=$1`, [
          approvalId,
          input.decision === 'approve' ? 'approved' : 'rejected',
        ]);
        await client.query(
          `UPDATE backup.policies SET status=$2,version=version+1,updated_by=$3,updated_at=now()
           WHERE id=$1 AND status='pending_approval'`,
          [request.policy_id, input.decision === 'approve' ? 'approved' : 'draft', actor.accountId],
        );
        return { after: await getPolicy(client, request.policy_id), before };
      },
      'backup_policy',
      'backup.policy.approval_decided',
      isPolicy,
    );
  }

  activatePolicy(
    id: string,
    input: ActivateBackupPolicyRequest,
    idempotencyKey: string | undefined,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BackupPolicy> {
    return this.executeCommand(
      'policy.activate',
      idempotencyKey,
      { expectedVersion: input.expectedVersion, id },
      actor,
      metadata,
      async (client) => {
        const locked = await client.query<{ status: BackupPolicy['status']; version: number }>(
          'SELECT status,version FROM backup.policies WHERE id=$1 FOR UPDATE',
          [id],
        );
        const row = locked.rows[0];
        if (!row) throw resourceNotFound('policy');
        const before = await getPolicy(client, id);
        if (before.status !== 'approved') throw policyNotApproved();
        if (before.version !== input.expectedVersion) throw changedRecord('policy');
        await assertRunnableDatabasePolicy(
          client,
          id,
          before.backupType,
          this.environment,
          this.fileShareArchive,
        );
        if (!/^[a-fA-F0-9]{64}$/u.test(this.environment.BACKUP_ENCRYPTION_KEY)) {
          throw backupEncryptionNotConfigured();
        }
        await client.query(
          `UPDATE backup.policies SET status='active',version=version+1,
             updated_by=$2,updated_at=now()
           WHERE id=$1 AND status='approved' AND version=$3`,
          [id, actor.accountId, input.expectedVersion],
        );
        return { after: await getPolicy(client, id), before };
      },
      'backup_policy',
      'backup.policy.activated',
      isPolicy,
    );
  }

  resumePolicy(
    id: string,
    input: ActivateBackupPolicyRequest,
    idempotencyKey: string | undefined,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BackupPolicy> {
    return this.executeCommand(
      'policy.resume',
      idempotencyKey,
      { expectedVersion: input.expectedVersion, id },
      actor,
      metadata,
      async (client) => {
        const locked = await client.query<{ status: BackupPolicy['status']; version: number }>(
          'SELECT status,version FROM backup.policies WHERE id=$1 FOR UPDATE',
          [id],
        );
        const row = locked.rows[0];
        if (!row) throw resourceNotFound('policy');
        if (row.status !== 'paused') throw policyNotPaused();
        if (row.version !== input.expectedVersion) throw changedRecord('policy');
        const before = await getPolicy(client, id);
        await assertRunnableDatabasePolicy(
          client,
          id,
          before.backupType,
          this.environment,
          this.fileShareArchive,
        );
        if (!/^[a-fA-F0-9]{64}$/u.test(this.environment.BACKUP_ENCRYPTION_KEY)) {
          throw backupEncryptionNotConfigured();
        }
        await client.query(
          `UPDATE backup.policies SET status='active',version=version+1,
             updated_by=$2,updated_at=now()
           WHERE id=$1 AND status='paused' AND version=$3`,
          [id, actor.accountId, input.expectedVersion],
        );
        return { after: await getPolicy(client, id), before };
      },
      'backup_policy',
      'backup.policy.resumed',
      isPolicy,
    );
  }

  private async loadFileRestoreManifest(
    runId: string,
  ): Promise<Array<{ key: string; label?: string; searchableText?: string; sizeBytes: string }>> {
    const result = await this.database.getPool().query<RestoreCatalogRunRow>(
      `SELECT artifact_deleted_at,artifact_key,artifact_sha256,artifact_size_bytes::text,
          compression_algorithm,encryption_nonce,encryption_tag,source_type,status,
          source_bucket_snapshot,source_code_snapshot,source_location_snapshot,
          uncompressed_size_bytes::text,verification_status
       FROM backup.execution_runs WHERE id=$1`,
      [runId],
    );
    const run = result.rows[0];
    if (!run) throw resourceNotFound('verified backup');
    if (
      !['cloud_service', 'email', 'object_storage', 'file', 'file_share'].includes(
        run.source_type,
      ) ||
      run.status !== 'verified' ||
      run.verification_status !== 'verified' ||
      run.artifact_deleted_at ||
      !run.artifact_key ||
      !run.artifact_sha256 ||
      !run.artifact_size_bytes ||
      !run.encryption_nonce ||
      !run.encryption_tag ||
      !this.environment.BACKUP_S3_BUCKET
    ) {
      throw new ApiErrorException(
        'BACKUP_RESTORE_POINT_NOT_READY',
        'Choose a verified file-storage or shared-folder restore point that is still within retention.',
        HttpStatus.CONFLICT,
      );
    }
    if (!/^[a-fA-F0-9]{64}$/u.test(this.environment.BACKUP_ENCRYPTION_KEY)) {
      throw backupEncryptionNotConfigured();
    }
    if (
      !/^[a-fA-F0-9]{24}$/u.test(run.encryption_nonce) ||
      !/^[a-fA-F0-9]{32}$/u.test(run.encryption_tag) ||
      !/^[a-fA-F0-9]{64}$/u.test(run.artifact_sha256) ||
      run.compression_algorithm === 'postgres_custom' ||
      (run.compression_algorithm === 'gzip' && run.uncompressed_size_bytes === null)
    ) {
      throw new ApiErrorException(
        'BACKUP_RESTORE_POINT_INVALID',
        'The file-storage restore point has incomplete integrity information.',
        HttpStatus.CONFLICT,
      );
    }

    const key = Buffer.from(this.environment.BACKUP_ENCRYPTION_KEY, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(run.encryption_nonce, 'hex'));
    decipher.setAuthTag(Buffer.from(run.encryption_tag, 'hex'));
    const artifactHash = createHash('sha256');
    let artifactBytes = 0n;
    let uncompressedBytes = 0n;
    const artifactMeter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        artifactHash.update(chunk);
        artifactBytes += BigInt(chunk.length);
        callback(null, chunk);
      },
    });
    const uncompressedMeter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        uncompressedBytes += BigInt(chunk.length);
        callback(null, chunk);
      },
    });
    const decrypted = new PassThrough();
    const source = await this.storage.getBackupObjectStream(run.artifact_key);
    const decompressor = createBackupDecompressor(run.compression_algorithm);
    const verification = decompressor
      ? pipeline(
          source,
          artifactMeter,
          decipher,
          decompressor,
          uncompressedMeter,
          createUncompressedSizeGuard(run.uncompressed_size_bytes),
          decrypted,
        )
      : pipeline(source, artifactMeter, decipher, uncompressedMeter, decrypted);
    if (
      run.source_type !== 'object_storage' &&
      (!run.source_code_snapshot || !run.source_location_snapshot)
    ) {
      throw new ApiErrorException(
        'BACKUP_RESTORE_POINT_INVALID',
        'The shared-folder restore point is missing its protected source details.',
        HttpStatus.CONFLICT,
      );
    }
    const manifestRead =
      run.source_type === 'object_storage' ||
      run.source_type === 'email' ||
      run.source_type === 'cloud_service'
        ? this.objectStorageArchive.validate(
            decrypted,
            run.source_bucket_snapshot ?? this.storage.bucketName(),
          )
        : this.fileShareArchive.validate(
            decrypted,
            run.source_code_snapshot as string,
            run.source_location_snapshot as string,
          );
    const [manifest] = await Promise.all([manifestRead, verification]);
    if (
      artifactHash.digest('hex') !== run.artifact_sha256.trim() ||
      artifactBytes !== BigInt(run.artifact_size_bytes)
    ) {
      throw new ApiErrorException(
        'BACKUP_ARTIFACT_CHECKSUM_MISMATCH',
        'The file-storage restore point did not pass its integrity check.',
        HttpStatus.CONFLICT,
      );
    }
    if (
      run.uncompressed_size_bytes !== null &&
      uncompressedBytes !== BigInt(run.uncompressed_size_bytes)
    ) {
      throw new ApiErrorException(
        'BACKUP_UNCOMPRESSED_SIZE_MISMATCH',
        'The file-storage restore point did not pass its size check.',
        HttpStatus.CONFLICT,
      );
    }
    return 'objects' in manifest
      ? manifest.objects.map((object) => {
          const subject = object.metadata?.['email-subject']?.trim();
          const from = object.metadata?.['email-from']?.trim();
          const date = object.metadata?.['email-internal-date']?.trim();
          const mailbox = object.metadata?.['email-mailbox']?.trim();
          const emailLabel = [date, from, subject].filter(Boolean).join(' · ');
          return {
            key: object.key,
            ...(emailLabel ? { label: emailLabel.slice(0, 500) } : {}),
            ...(mailbox ? { searchableText: mailbox } : {}),
            sizeBytes: String(object.size),
          };
        })
      : manifest.files.map((file) => ({ key: file.key, sizeBytes: String(file.size) }));
  }

  private async executeCommand<T extends { id: string }>(
    scope: string,
    idempotencyKey: string | undefined,
    input: object,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    command: (client: PoolClient) => Promise<T | { after: T; before: T; event?: string }>,
    targetType: string,
    defaultEvent: string,
    isResponse: (value: unknown) => value is T,
  ): Promise<T> {
    const key = requireIdempotencyKey(idempotencyKey);
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const replay = await claimIdempotency(
        client,
        `backup.${scope}`,
        key,
        requestHash,
        this.environment.IDEMPOTENCY_TTL_SECONDS,
        isResponse,
      );
      if (replay) {
        await client.query('COMMIT');
        return replay;
      }

      const commandResult = await command(client);
      const isUpdate = isRecord(commandResult) && 'after' in commandResult;
      const after = isUpdate ? (commandResult as { after: T }).after : commandResult;
      const before = isUpdate ? (commandResult as { before: T }).before : undefined;
      const event =
        isUpdate && typeof commandResult['event'] === 'string'
          ? commandResult['event']
          : defaultEvent;
      if (!isResponse(after)) throw new Error('Backup command returned an invalid record');
      await client.query(
        `INSERT INTO integration.outbox_events (
           id, aggregate_type, aggregate_id, event_type, event_version,
           correlation_id, idempotency_key, payload
         ) VALUES ($1,$2,$3,$4,1,$5,$6,$7)`,
        [
          randomUUID(),
          targetType,
          after.id,
          event,
          metadata.correlationId,
          `backup:${scope}:${key}`,
          { record: after },
        ],
      );
      await this.audit.append(
        {
          action: event,
          actorAccountId: actor.accountId,
          after: toAuditRecord(after),
          ...(before ? { before: toAuditRecord(before) } : {}),
          correlationId: metadata.correlationId,
          ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
          targetId: after.id,
          targetType,
          ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
        },
        client,
      );
      await completeIdempotency(client, `backup.${scope}`, key, after);
      await client.query('COMMIT');
      return after;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        throw new ApiErrorException(
          'BACKUP_CODE_ALREADY_EXISTS',
          'A protected source or policy already uses that code',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async expireRestoreApprovals(): Promise<number> {
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{
        approval_request_id: string;
        id: string;
        requested_by: string;
      }>(
        `SELECT restore.id,restore.approval_request_id,restore.requested_by
         FROM backup.restore_requests restore
         JOIN backup.approval_requests approval ON approval.id=restore.approval_request_id
         WHERE restore.status='pending_approval' AND approval.status='pending'
           AND approval.expires_at <= now()
         ORDER BY approval.expires_at,restore.id LIMIT 100
         FOR UPDATE OF restore,approval SKIP LOCKED`,
      );
      for (const request of result.rows) {
        await client.query("UPDATE backup.approval_requests SET status='expired' WHERE id=$1", [
          request.approval_request_id,
        ]);
        await client.query(
          `UPDATE backup.restore_requests SET status='expired',updated_at=now()
           WHERE id=$1 AND status='pending_approval'`,
          [request.id],
        );
        await client.query(
          `INSERT INTO backup.restore_events(restore_request_id,event_type,details)
           VALUES($1,'expired','{}'::jsonb)`,
          [request.id],
        );
        await this.audit.append(
          {
            action: 'backup.restore.approval_expired',
            actorAccountId: request.requested_by,
            correlationId: `backup-restore-approval-expired:${request.id}`,
            targetId: request.id,
            targetType: 'backup_restore_request',
          },
          client,
        );
      }
      await client.query('COMMIT');
      return result.rows.length;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async expirePolicyApprovalRequests(): Promise<number> {
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const expired = await client.query<{
        critical_action: 'disable_job' | 'modify_policy' | 'reduce_retention';
        id: string;
        policy_id: string;
        requested_by: string;
      }>(
        `SELECT id,target_id AS policy_id,requested_by,critical_action
         FROM backup.approval_requests
         WHERE critical_action IN ('modify_policy','disable_job','reduce_retention')
           AND target_type='backup_policy'
           AND status='pending' AND expires_at <= now()
         ORDER BY expires_at,id LIMIT 100 FOR UPDATE SKIP LOCKED`,
      );
      for (const request of expired.rows) {
        const policyLock = await client.query<{ status: BackupPolicy['status'] }>(
          'SELECT status FROM backup.policies WHERE id=$1 FOR UPDATE',
          [request.policy_id],
        );
        const policyBefore = policyLock.rows[0]
          ? await getPolicy(client, request.policy_id)
          : undefined;
        await client.query("UPDATE backup.approval_requests SET status='expired' WHERE id=$1", [
          request.id,
        ]);
        if (request.critical_action === 'reduce_retention') {
          await client.query(
            `UPDATE backup.retention_reduction_requests
             SET status='expired',updated_at=now()
             WHERE approval_request_id=$1 AND status='pending'`,
            [request.id],
          );
        }
        if (
          request.critical_action === 'modify_policy' &&
          policyBefore?.status === 'pending_approval'
        ) {
          await client.query(
            `UPDATE backup.policies SET status='draft',version=version+1,updated_at=now()
             WHERE id=$1 AND status='pending_approval'`,
            [request.policy_id],
          );
        }
        const policyAfter = policyLock.rows[0]
          ? await getPolicy(client, request.policy_id)
          : undefined;
        const event =
          request.critical_action === 'disable_job'
            ? 'backup.policy.pause_approval_expired'
            : request.critical_action === 'reduce_retention'
              ? 'backup.policy.retention_reduction_expired'
              : 'backup.policy.approval_expired';
        const correlationId = `backup-policy-approval:${request.id}`;
        await client.query(
          `INSERT INTO integration.outbox_events (
             id,aggregate_type,aggregate_id,event_type,event_version,correlation_id,
             idempotency_key,payload
           ) VALUES ($1,'backup_policy',$2,$3,1,$4,$5,$6)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            randomUUID(),
            request.policy_id,
            event,
            correlationId,
            `backup:policy-approval-expired:${request.id}`,
            { approvalRequestId: request.id, policy: policyAfter },
          ],
        );
        await this.audit.append(
          {
            action: event,
            ...(policyAfter ? { after: toAuditRecord(policyAfter) } : {}),
            ...(policyBefore ? { before: toAuditRecord(policyBefore) } : {}),
            correlationId,
            metadata: { approvalRequestId: request.id, requestedBy: request.requested_by },
            targetId: request.policy_id,
            targetType: 'backup_policy',
          },
          client,
        );
      }
      await client.query('COMMIT');
      return expired.rows.length;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function normalizeSource(
  input: CreateBackupProtectedSourceRequest,
): CreateBackupProtectedSourceRequest {
  const sourceCode = input.sourceCode.trim().toUpperCase();
  const name = normalizeText(input.name);
  const location = normalizeText(input.location);
  const annualGrowthPercent = normalizeOptionalDecimal(input.annualGrowthPercent, 'annual growth');
  const estimatedSizeGib = normalizeOptionalDecimal(input.estimatedSizeGib, 'estimated size');
  if (!sourceCode || !name || !location) {
    throw new ApiErrorException(
      'BACKUP_SOURCE_FIELDS_REQUIRED',
      'Complete the source details.',
      HttpStatus.BAD_REQUEST,
    );
  }
  return {
    credentialCustody: normalizeOptionalText(input.credentialCustody),
    dataClassification: input.dataClassification,
    ...(input.dataStewardEmployeeId ? { dataStewardEmployeeId: input.dataStewardEmployeeId } : {}),
    dependencies: normalizeOptionalText(input.dependencies),
    encryptedAtSource: input.encryptedAtSource,
    location,
    name,
    ...(input.ownerEmployeeId ? { ownerEmployeeId: input.ownerEmployeeId } : {}),
    restorePrerequisites: normalizeOptionalText(input.restorePrerequisites),
    sourceCode,
    sourceType: input.sourceType,
    ...(annualGrowthPercent === undefined ? {} : { annualGrowthPercent }),
    ...(estimatedSizeGib === undefined ? {} : { estimatedSizeGib }),
  };
}

interface NormalizedPolicy extends Omit<CreateBackupPolicyRequest, 'sourceIds'> {
  sourceIds: string[];
}

function normalizePolicy(input: CreateBackupPolicyRequest): NormalizedPolicy {
  const policyCode = input.policyCode.trim().toUpperCase();
  const name = normalizeText(input.name);
  const sourceIds = [...new Set(input.sourceIds)].sort();
  if (
    !policyCode ||
    !name ||
    sourceIds.length !== input.sourceIds.length ||
    sourceIds.length === 0
  ) {
    throw new ApiErrorException(
      'BACKUP_POLICY_FIELDS_INVALID',
      'Review the schedule and selected sources.',
      HttpStatus.BAD_REQUEST,
    );
  }
  const hourly = input.frequency === 'hourly';
  const weekly = input.frequency === 'weekly';
  const monthly = input.frequency === 'monthly';
  const hasClock = Boolean(input.runTimeLocal);
  if (
    (hourly && (hasClock || input.dayOfWeek !== undefined || input.dayOfMonth !== undefined)) ||
    (!hourly && !hasClock) ||
    (weekly && (input.dayOfWeek === undefined || input.dayOfMonth !== undefined)) ||
    (!weekly && input.dayOfWeek !== undefined) ||
    (monthly && (input.dayOfMonth === undefined || input.dayOfWeek !== undefined)) ||
    (!monthly && input.dayOfMonth !== undefined) ||
    input.rpoMinutes < 1 ||
    input.rtoMinutes < 1
  ) {
    throw new ApiErrorException(
      'BACKUP_POLICY_SCHEDULE_INVALID',
      'The schedule does not match its frequency.',
      HttpStatus.BAD_REQUEST,
    );
  }
  if (input.encryptionRequired === false || input.verificationRequired === false) {
    throw new ApiErrorException(
      'BACKUP_POLICY_PROTECTION_REQUIRED',
      'Backup encryption and verification must remain enabled.',
      HttpStatus.BAD_REQUEST,
    );
  }
  return {
    backupType: input.backupType,
    compressionEnabled: input.compressionEnabled ?? true,
    ...(input.dayOfMonth === undefined ? {} : { dayOfMonth: input.dayOfMonth }),
    ...(input.dayOfWeek === undefined ? {} : { dayOfWeek: input.dayOfWeek }),
    encryptionRequired: true,
    frequency: input.frequency,
    name,
    policyCode,
    retentionDailyCopies: input.retentionDailyCopies ?? 35,
    retentionMonthlyCopies: input.retentionMonthlyCopies ?? 12,
    rpoMinutes: input.rpoMinutes,
    rtoMinutes: input.rtoMinutes,
    ...(input.runTimeLocal ? { runTimeLocal: input.runTimeLocal } : {}),
    sourceIds,
    verificationRequired: true,
  };
}

async function assertEmployees(
  client: PoolClient,
  employeeIds: Array<string | undefined>,
): Promise<void> {
  const ids = [...new Set(employeeIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return;
  const result = await client.query<{ id: string }>(
    `SELECT employee.id FROM identity.employees employee
     JOIN identity.user_accounts account ON account.employee_id=employee.id
     WHERE employee.id=ANY($1::uuid[]) AND employee.active AND account.status='active'`,
    [ids],
  );
  if (result.rowCount !== ids.length) {
    throw new ApiErrorException(
      'BACKUP_EMPLOYEE_NOT_FOUND',
      'Choose an active employee account.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

interface PolicySourceClassification {
  data_classification: BackupDataClassification;
  id: string;
}

async function lockPolicySources(
  client: PoolClient,
  sourceIds: string[],
): Promise<PolicySourceClassification[]> {
  const result = await client.query<PolicySourceClassification>(
    `SELECT id, data_classification FROM backup.protected_sources
     WHERE id=ANY($1::uuid[]) AND status='active' ORDER BY id FOR SHARE`,
    [sourceIds],
  );
  if (result.rowCount !== sourceIds.length) {
    throw new ApiErrorException(
      'BACKUP_SOURCE_NOT_AVAILABLE',
      'One or more selected sources are not active.',
      HttpStatus.CONFLICT,
    );
  }
  return result.rows;
}

function validatePolicyTargets(
  input: NormalizedPolicy,
  sources: PolicySourceClassification[],
): void {
  const limits: Record<BackupDataClassification, { rpo: number; rto: number }> = {
    critical: { rpo: 60, rto: 240 },
    important: { rpo: 1440, rto: 1440 },
    standard: { rpo: 1440, rto: 4320 },
  };
  const required = sources.map((source) => limits[source.data_classification]);
  if (required.some((limit) => input.rpoMinutes > limit.rpo || input.rtoMinutes > limit.rto)) {
    throw new ApiErrorException(
      'BACKUP_RECOVERY_TARGET_TOO_LONG',
      'The recovery targets exceed the selected source classification.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

async function linkPolicySources(
  client: PoolClient,
  policyId: string,
  sourceIds: string[],
  actorId: string,
): Promise<void> {
  for (const sourceId of sourceIds) {
    await client.query(
      'INSERT INTO backup.policy_sources(policy_id,source_id,linked_by) VALUES($1,$2,$3)',
      [policyId, sourceId, actorId],
    );
  }
}

async function getSource(
  client: PoolClient,
  id: string,
  lock = false,
): Promise<BackupProtectedSource> {
  const query = await client.query<SourceRow>(
    `${sourceSelect} WHERE source.id=$1 ${lock ? 'FOR UPDATE OF source' : ''}`,
    [id],
  );
  const row = query.rows[0];
  if (!row) throw resourceNotFound('source');
  return mapSource(row);
}

async function getPolicy(client: PoolClient, id: string): Promise<BackupPolicy> {
  const query = await client.query<PolicyRow>(
    `${policySelect} WHERE policy.id=$1 GROUP BY policy.id`,
    [id],
  );
  const row = query.rows[0];
  if (!row) throw resourceNotFound('policy');
  return mapPolicy(row);
}

async function getRestoreRequest(client: PoolClient, id: string): Promise<BackupRestoreRequest> {
  const result = await client.query<RestoreRequestRow>(
    `SELECT restore.id,restore.execution_run_id AS run_id,restore.reason,
        restore.status,restore.attempt_count,restore.target_database_name,
        restore.target_storage_bucket,restore.target_storage_prefix,
        restore.restore_object_key,restore.error_code,
        restore.completed_at,restore.created_at,policy.policy_code,policy.name AS policy_name,
        run.scheduled_for,run.source_type,restore.requested_by,
        requested_employee.display_name AS requested_by_name,
        approved_employee.display_name AS approved_by_name
     FROM backup.restore_requests restore
     JOIN backup.execution_runs run ON run.id=restore.execution_run_id
     JOIN backup.policies policy ON policy.id=run.policy_id
     JOIN identity.user_accounts requested_account ON requested_account.id=restore.requested_by
     JOIN identity.employees requested_employee ON requested_employee.id=requested_account.employee_id
     LEFT JOIN identity.user_accounts approved_account ON approved_account.id=restore.approved_by
     LEFT JOIN identity.employees approved_employee ON approved_employee.id=approved_account.employee_id
     WHERE restore.id=$1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw resourceNotFound('restore request');
  return mapRestoreRequest(row);
}

async function getArtifactDeletionRequest(
  client: PoolClient,
  id: string,
): Promise<BackupArtifactDeletionRequest> {
  const result = await client.query<ArtifactDeletionRequestRow>(
    `SELECT request.id,request.reason,request.status,request.error_code,
        request.completed_at,request.created_at,approval.expires_at,
        request.execution_run_id AS run_id,run.scheduled_for,
        policy.policy_code,policy.name AS policy_name,request.requested_by,
        requested_employee.display_name AS requested_by_name,
        approved_employee.display_name AS approved_by_name
     FROM backup.artifact_deletion_requests request
     JOIN backup.approval_requests approval ON approval.id=request.approval_request_id
     JOIN backup.execution_runs run ON run.id=request.execution_run_id
     JOIN backup.policies policy ON policy.id=run.policy_id
     JOIN identity.user_accounts requested_account ON requested_account.id=request.requested_by
     JOIN identity.employees requested_employee ON requested_employee.id=requested_account.employee_id
     LEFT JOIN identity.user_accounts approved_account ON approved_account.id=request.approved_by
     LEFT JOIN identity.employees approved_employee ON approved_employee.id=approved_account.employee_id
     WHERE request.id=$1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw resourceNotFound('restore-point deletion request');
  return mapArtifactDeletionRequest(row);
}

function mapPolicyApproval(row: PolicyApprovalRow): BackupPolicyApprovalRequest {
  return {
    action: row.critical_action,
    createdAt: iso(row.requested_at),
    expiresAt: iso(row.expires_at),
    id: row.id,
    justification: row.justification,
    policyCode: row.policy_code,
    policyId: row.policy_id,
    policyName: row.policy_name,
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name,
    ...(row.previous_daily_copies === null
      ? {}
      : {
          previousDailyCopies: row.previous_daily_copies,
          previousMonthlyCopies: row.previous_monthly_copies!,
          proposedDailyCopies: row.proposed_daily_copies!,
          proposedMonthlyCopies: row.proposed_monthly_copies!,
        }),
    status: 'pending',
    version: row.policy_version,
  };
}

function mapRestoreRequest(row: RestoreRequestRow): BackupRestoreRequest {
  return {
    ...(row.approved_by_name ? { approvedByName: row.approved_by_name } : {}),
    attemptCount: row.attempt_count,
    ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
    createdAt: iso(row.created_at),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    id: row.id,
    policyCode: row.policy_code,
    policyName: row.policy_name,
    reason: row.reason,
    ...(row.restore_object_key ? { restoreObjectKey: row.restore_object_key } : {}),
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name,
    runId: row.run_id,
    scheduledFor: iso(row.scheduled_for),
    sourceType: row.source_type,
    status: row.status,
    ...(row.target_database_name ? { targetDatabaseName: row.target_database_name } : {}),
    ...(row.target_storage_bucket ? { targetStorageBucket: row.target_storage_bucket } : {}),
    ...(row.target_storage_prefix ? { targetStoragePrefix: row.target_storage_prefix } : {}),
  };
}

function mapArtifactDeletionRequest(
  row: ArtifactDeletionRequestRow,
): BackupArtifactDeletionRequest {
  return {
    ...(row.approved_by_name ? { approvedByName: row.approved_by_name } : {}),
    ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
    createdAt: iso(row.created_at),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    expiresAt: iso(row.expires_at),
    id: row.id,
    policyCode: row.policy_code,
    policyName: row.policy_name,
    reason: row.reason,
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name,
    runId: row.run_id,
    scheduledFor: iso(row.scheduled_for),
    status: row.status,
  };
}

async function loadBackupDrTest(client: PoolClient, id: string): Promise<BackupDrTest> {
  const result = await client.query<BackupDrTestRow>(`${backupDrTestSelect} WHERE test.id=$1`, [
    id,
  ]);
  const row = result.rows[0];
  if (!row) throw resourceNotFound('disaster recovery test');
  return mapBackupDrTest(row);
}

async function insertDrTestEvent(
  client: PoolClient,
  drTestId: string,
  eventType: 'planned' | 'result_recorded',
  actorAccountId: string,
  details: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO backup.dr_test_events(dr_test_id,event_type,actor_account_id,details)
     VALUES($1,$2,$3,$4)`,
    [drTestId, eventType, actorAccountId, details],
  );
}

function mapBackupDrTest(row: BackupDrTestRow): BackupDrTest {
  return {
    backupRunId: row.backup_run_id,
    backupScheduledFor: iso(row.backup_scheduled_for),
    ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
    ...(row.corrective_actions ? { correctiveActions: row.corrective_actions } : {}),
    createdAt: iso(row.created_at),
    createdByName: row.created_by_name,
    ...(row.evidence_file_id ? { evidenceFileId: row.evidence_file_id } : {}),
    id: row.id,
    ...(row.non_conformities ? { nonConformities: row.non_conformities } : {}),
    ...(row.outcome ? { outcome: row.outcome } : {}),
    plannedFor: iso(row.planned_for),
    policyCode: row.policy_code,
    policyName: row.policy_name,
    ...(row.protocol_signed_at ? { protocolSignedAt: iso(row.protocol_signed_at) } : {}),
    ...(row.protocol_signed_by ? { protocolSignedBy: row.protocol_signed_by } : {}),
    ...(row.restore_request_id ? { restoreRequestId: row.restore_request_id } : {}),
    ...(row.restore_status ? { restoreStatus: row.restore_status } : {}),
    ...(row.result_summary ? { resultSummary: row.result_summary } : {}),
    ...(row.actual_rpo_minutes === null
      ? {}
      : {
          actualRpoMinutes: row.actual_rpo_minutes,
          rpoMet: row.actual_rpo_minutes <= row.rpo_target_minutes,
        }),
    rpoTargetMinutes: row.rpo_target_minutes,
    ...(row.actual_rto_minutes === null
      ? {}
      : {
          actualRtoMinutes: row.actual_rto_minutes,
          rtoMet: row.actual_rto_minutes <= row.rto_target_minutes,
        }),
    rtoTargetMinutes: row.rto_target_minutes,
    scope: row.scope,
    status: row.status,
    testCode: row.test_code,
  };
}

async function loadBackupPlanReview(client: PoolClient, id: string): Promise<BackupPlanReview> {
  const result = await client.query<BackupPlanReviewRow>(
    `${backupPlanReviewSelect} WHERE review.id=$1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new Error('The recorded backup plan review could not be loaded');
  return mapBackupPlanReview(row);
}

function mapBackupPlanReview(row: BackupPlanReviewRow): BackupPlanReview {
  return {
    ...(row.corrective_actions ? { correctiveActions: row.corrective_actions } : {}),
    id: row.id,
    nextReviewDueAt: iso(row.next_review_due_at),
    outcome: row.outcome,
    planSnapshot: row.plan_snapshot,
    policyCount: row.policy_count,
    protectedSourceCount: row.protected_source_count,
    reviewCode: row.review_code,
    reviewedAt: iso(row.reviewed_at),
    reviewedByName: row.reviewed_by_name,
    snapshotSha256: row.snapshot_sha256.trim(),
    summary: row.summary,
  };
}

function mapSource(row: SourceRow): BackupProtectedSource {
  return {
    ...(row.annual_growth_percent === null
      ? {}
      : { annualGrowthPercent: row.annual_growth_percent }),
    createdAt: iso(row.created_at),
    credentialCustody: row.credential_custody,
    dataClassification: row.data_classification,
    ...(row.data_steward_employee_id
      ? { dataStewardEmployeeId: row.data_steward_employee_id }
      : {}),
    ...(row.data_steward_name ? { dataStewardName: row.data_steward_name } : {}),
    dependencies: row.dependencies,
    encryptedAtSource: row.encrypted_at_source,
    ...(row.estimated_size_gib === null ? {} : { estimatedSizeGib: row.estimated_size_gib }),
    id: row.id,
    location: row.location,
    name: row.name,
    ...(row.owner_employee_id ? { ownerEmployeeId: row.owner_employee_id } : {}),
    ...(row.owner_name ? { ownerName: row.owner_name } : {}),
    restorePrerequisites: row.restore_prerequisites,
    sourceCode: row.source_code,
    sourceType: row.source_type,
    status: row.status,
    updatedAt: iso(row.updated_at),
    version: row.version,
  };
}

function mapPolicy(row: PolicyRow): BackupPolicy {
  return {
    backupType: row.backup_type,
    compressionEnabled: row.compression_enabled,
    createdAt: iso(row.created_at),
    ...(row.day_of_month === null ? {} : { dayOfMonth: row.day_of_month }),
    ...(row.day_of_week === null ? {} : { dayOfWeek: row.day_of_week }),
    encryptionRequired: row.encryption_required,
    frequency: row.frequency,
    id: row.id,
    name: row.name,
    ...(row.pause_request_pending ? { pauseRequestPending: true } : {}),
    ...(row.retention_reduction_request_pending ? { retentionReductionRequestPending: true } : {}),
    policyCode: row.policy_code,
    retentionDailyCopies: row.retention_daily_copies,
    retentionMonthlyCopies: row.retention_monthly_copies,
    rpoMinutes: row.rpo_minutes,
    rtoMinutes: row.rto_minutes,
    ...(row.run_time_local === null ? {} : { runTimeLocal: row.run_time_local.slice(0, 5) }),
    sources: Array.isArray(row.sources) ? row.sources : [],
    status: row.status,
    updatedAt: iso(row.updated_at),
    verificationRequired: row.verification_required,
    version: row.version,
  };
}

function normalizePage(query: BackupPageQueryDto): { page: number; pageSize: number } {
  return {
    page: Number.isSafeInteger(query.page) && query.page > 0 ? query.page : 1,
    pageSize:
      Number.isSafeInteger(query.pageSize) && query.pageSize > 0
        ? Math.min(query.pageSize, 100)
        : 50,
  };
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

function normalizeOptionalText(value: string | undefined): string {
  return value?.trim() ?? '';
}

function normalizeOptionalDecimal(value: string | undefined, label: string): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const normalized = value.trim();
  if (!/^\d{1,10}(?:\.\d{1,2})?$/u.test(normalized)) {
    throw new ApiErrorException(
      'BACKUP_NUMBER_INVALID',
      `Enter a valid ${label}.`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return normalized;
}

function requireIdempotencyKey(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(value)) {
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_REQUIRED',
      'Provide a valid Idempotency-Key.',
      HttpStatus.BAD_REQUEST,
    );
  }
  return value;
}

async function claimIdempotency<T>(
  client: PoolClient,
  scope: string,
  key: string,
  requestHash: string,
  ttlSeconds: number,
  isResponse: (value: unknown) => value is T,
): Promise<T | undefined> {
  const inserted = await client.query(
    `INSERT INTO platform.idempotency_keys(scope,idempotency_key,request_hash,status,expires_at)
     VALUES($1,$2,$3,'processing',now()+($4*interval '1 second'))
     ON CONFLICT DO NOTHING RETURNING idempotency_key`,
    [scope, key, requestHash, ttlSeconds],
  );
  if (inserted.rowCount === 1) return undefined;
  const existing = await client.query<IdempotencyRow>(
    `SELECT request_hash,status,response_body FROM platform.idempotency_keys
     WHERE scope=$1 AND idempotency_key=$2 FOR UPDATE`,
    [scope, key],
  );
  const row = existing.rows[0];
  if (!row || row.request_hash !== requestHash) {
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_CONFLICT',
      'This request key was used for different details.',
      HttpStatus.CONFLICT,
    );
  }
  if (row.status === 'completed' && isResponse(row.response_body)) return row.response_body;
  throw new ApiErrorException(
    'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    'The original request is still being processed.',
    HttpStatus.CONFLICT,
  );
}

async function completeIdempotency<T>(
  client: PoolClient,
  scope: string,
  key: string,
  response: T,
): Promise<void> {
  await client.query(
    `UPDATE platform.idempotency_keys SET status='completed',response_status=200,response_body=$3
     WHERE scope=$1 AND idempotency_key=$2`,
    [scope, key, response],
  );
}

function isSource(value: unknown): value is BackupProtectedSource {
  return (
    isRecord(value) && typeof value['id'] === 'string' && typeof value['sourceCode'] === 'string'
  );
}

function isPolicy(value: unknown): value is BackupPolicy {
  return (
    isRecord(value) && typeof value['id'] === 'string' && typeof value['policyCode'] === 'string'
  );
}

function isBackupRestoreRequest(value: unknown): value is BackupRestoreRequest {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['runId'] === 'string' &&
    typeof value['status'] === 'string'
  );
}

function isBackupArtifactDeletionRequest(value: unknown): value is BackupArtifactDeletionRequest {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['runId'] === 'string' &&
    typeof value['status'] === 'string'
  );
}

function isBackupDrTest(value: unknown): value is BackupDrTest {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['testCode'] === 'string' &&
    typeof value['status'] === 'string'
  );
}

function isBackupPlanReview(value: unknown): value is BackupPlanReview {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['reviewCode'] === 'string' &&
    typeof value['snapshotSha256'] === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toAuditRecord(value: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isUniqueViolation(error: unknown): boolean {
  return isRecord(error) && error['code'] === '23505';
}

function resourceNotFound(
  kind:
    | 'disaster recovery test'
    | 'policy'
    | 'source'
    | 'restore request'
    | 'restore-point deletion request'
    | 'verified backup',
): ApiErrorException {
  const codeKind = kind.replaceAll(' ', '_').toUpperCase();
  return new ApiErrorException(
    `BACKUP_${codeKind}_NOT_FOUND`,
    'The backup record was not found.',
    HttpStatus.NOT_FOUND,
  );
}

function restoreTargetNotConfigured(): ApiErrorException {
  return new ApiErrorException(
    'BACKUP_RESTORE_TARGET_NOT_CONFIGURED',
    'A separate isolated database restore target has not been configured.',
    HttpStatus.CONFLICT,
  );
}

function changedRecord(kind: 'disaster recovery test' | 'policy' | 'source'): ApiErrorException {
  return new ApiErrorException(
    `BACKUP_${kind.toUpperCase()}_CHANGED`,
    'This record changed. Refresh it and try again.',
    HttpStatus.CONFLICT,
  );
}

function inactiveSource(): ApiErrorException {
  return new ApiErrorException(
    'BACKUP_SOURCE_INACTIVE',
    'An inactive source cannot be changed.',
    HttpStatus.CONFLICT,
  );
}

function policyNotDraft(): ApiErrorException {
  return new ApiErrorException(
    'BACKUP_POLICY_REQUIRES_APPROVAL',
    'Only draft policies can be edited. Active policy changes require approval.',
    HttpStatus.CONFLICT,
  );
}

function policyNotApproved(): ApiErrorException {
  return new ApiErrorException(
    'BACKUP_POLICY_NOT_APPROVED',
    'A second authorised person must approve this policy before its schedule can be activated.',
    HttpStatus.CONFLICT,
  );
}

function policyNotActive(): ApiErrorException {
  return new ApiErrorException(
    'BACKUP_POLICY_NOT_ACTIVE',
    'Only an active backup schedule can be paused.',
    HttpStatus.CONFLICT,
  );
}

function policyNotPaused(): ApiErrorException {
  return new ApiErrorException(
    'BACKUP_POLICY_NOT_PAUSED',
    'Only a paused backup schedule can be resumed.',
    HttpStatus.CONFLICT,
  );
}

function backupEncryptionNotConfigured(): ApiErrorException {
  return new ApiErrorException(
    'BACKUP_ENCRYPTION_NOT_CONFIGURED',
    'Configure the 32-byte backup encryption key before activating a schedule.',
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

async function assertRunnableDatabasePolicy(
  client: PoolClient,
  policyId: string,
  backupType: BackupPolicy['backupType'],
  environment: AppEnvironment,
  fileShareArchive: FileShareBackupArchive,
): Promise<void> {
  const result = await client.query<{
    database_sources: number;
    cloud_service_sources: number;
    email_sources: number;
    file_sources: number;
    file_share_sources: number;
    legacy_managed_source: boolean;
    object_storage_sources: number;
    source_code: string | null;
    source_location: string | null;
    source_type: string | null;
    sources: number;
  }>(
    `SELECT count(source.id)::integer AS sources,
       count(source.id) FILTER (WHERE source.source_type='database'
         AND source.status='active')::integer AS database_sources
       ,count(source.id) FILTER (WHERE source.source_type='email'
         AND source.status='active')::integer AS email_sources
       ,count(source.id) FILTER (WHERE source.source_type='cloud_service'
         AND source.status='active')::integer AS cloud_service_sources
       ,count(source.id) FILTER (WHERE source.source_type='object_storage'
         AND source.status='active')::integer AS object_storage_sources
       ,count(source.id) FILTER (WHERE source.source_type='file'
         AND source.status='active')::integer AS file_sources
       ,count(source.id) FILTER (WHERE source.source_type IN
         ('file_share','server','workstation','mobile_device','other')
         AND source.status='active')::integer AS file_share_sources
       ,min(source.source_type) FILTER (WHERE source.status='active') AS source_type
       ,min(source.source_code) FILTER (WHERE source.status='active') AS source_code
       ,min(source.location) FILTER (WHERE source.status='active') AS source_location
       ,coalesce(bool_or(legacy.source_id IS NOT NULL AND source.source_type='object_storage'),false)
         AS legacy_managed_source
     FROM backup.policy_sources link
     JOIN backup.protected_sources source ON source.id=link.source_id
     LEFT JOIN backup.legacy_managed_object_sources legacy ON legacy.source_id=source.id
       AND legacy.source_code_snapshot=source.source_code
     WHERE link.policy_id=$1`,
    [policyId],
  );
  const row = result.rows[0];
  const sourceCount = Number(row?.sources ?? 0);
  const databaseSourceCount = Number(row?.database_sources ?? 0);
  const emailSourceCount = Number(row?.email_sources ?? 0);
  const cloudServiceSourceCount = Number(row?.cloud_service_sources ?? 0);
  const objectStorageSourceCount = Number(row?.object_storage_sources ?? 0);
  const fileSourceCount = Number(row?.file_sources ?? 0);
  const fileShareSourceCount = Number(row?.file_share_sources ?? 0);
  const sourceType = row?.source_type;
  if (sourceType === 'database') {
    try {
      backupDatabaseSourceUrl(row?.source_code ?? null, environment);
    } catch {
      throw new ApiErrorException(
        'BACKUP_DATABASE_SOURCE_NOT_CONFIGURED',
        `Set a PostgreSQL, MySQL, or MariaDB connection for source ${row?.source_code ?? 'code unavailable'} in the deployment secrets before requesting approval or activating its schedule.`,
        HttpStatus.CONFLICT,
      );
    }
  }
  if (sourceType === 'object_storage') {
    try {
      objectStorageBackupSourceBucket(
        row?.source_code ?? null,
        row?.source_location ?? null,
        environment,
        environment.S3_BUCKET,
        row?.legacy_managed_source ?? false,
      );
    } catch {
      throw new ApiErrorException(
        'BACKUP_OBJECT_STORAGE_SOURCE_NOT_CONFIGURED',
        `Set an S3-compatible source configuration for ${row?.source_code ?? 'this source'} in the deployment secrets before activating its schedule.`,
        HttpStatus.CONFLICT,
      );
    }
  }
  if (sourceType === 'email') {
    try {
      emailImapBackupSourceSnapshot(
        row?.source_code ?? null,
        row?.source_location ?? null,
        environment,
      );
    } catch {
      throw new ApiErrorException(
        'BACKUP_EMAIL_SOURCE_NOT_CONFIGURED',
        `Set TLS-protected IMAP credentials and mailbox scope for ${row?.source_code ?? 'this source'} in deployment secrets before activating its schedule.`,
        HttpStatus.CONFLICT,
      );
    }
  }
  if (sourceType === 'cloud_service') {
    try {
      webDavBackupSourceSnapshot(
        row?.source_code ?? null,
        row?.source_location ?? null,
        environment,
      );
    } catch {
      throw new ApiErrorException(
        'BACKUP_WEBDAV_SOURCE_NOT_CONFIGURED',
        `Set a TLS-protected WebDAV endpoint and read-only account for ${row?.source_code ?? 'this source'} in deployment secrets before activating its schedule.`,
        HttpStatus.CONFLICT,
      );
    }
  }
  const fileSourceRoot = environment.BACKUP_FILE_SOURCE_ROOT;
  const supported =
    sourceCount === 1 &&
    ((databaseSourceCount === 1 &&
      objectStorageSourceCount === 0 &&
      emailSourceCount === 0 &&
      fileSourceCount === 0 &&
      fileShareSourceCount === 0 &&
      ['database_snapshot', 'full'].includes(backupType)) ||
      (objectStorageSourceCount === 1 &&
        emailSourceCount === 0 &&
        fileSourceCount === 0 &&
        fileShareSourceCount === 0 &&
        ['differential', 'full', 'incremental'].includes(backupType)) ||
      (fileSourceCount + fileShareSourceCount === 1 &&
        databaseSourceCount === 0 &&
        emailSourceCount === 0 &&
        objectStorageSourceCount === 0 &&
        (['differential', 'full', 'incremental'].includes(backupType) ||
          (backupType === 'system_image' &&
            ['file_share', 'server', 'workstation'].includes(sourceType ?? ''))) &&
        Boolean(fileSourceRoot)) ||
      (emailSourceCount === 1 &&
        databaseSourceCount === 0 &&
        objectStorageSourceCount === 0 &&
        fileSourceCount === 0 &&
        fileShareSourceCount === 0 &&
        ['differential', 'full', 'incremental'].includes(backupType)) ||
      (cloudServiceSourceCount === 1 &&
        databaseSourceCount === 0 &&
        emailSourceCount === 0 &&
        objectStorageSourceCount === 0 &&
        fileSourceCount === 0 &&
        fileShareSourceCount === 0 &&
        ['differential', 'full', 'incremental'].includes(backupType)));
  if (!supported) {
    throw new ApiErrorException(
      'BACKUP_SOURCE_NOT_SUPPORTED',
      'Choose one supported active source and backup type. Server, device, and file sources require an available read-only snapshot folder.',
      HttpStatus.CONFLICT,
    );
  }
  if (isMountedFileBackupSource(sourceType)) {
    try {
      if (backupType === 'system_image') {
        await fileShareArchive.assertSystemImageAvailable(
          fileSourceRoot,
          row?.source_location ?? '',
        );
      } else {
        await fileShareArchive.assertSourceAvailable(fileSourceRoot, row?.source_location ?? '');
      }
    } catch {
      throw new ApiErrorException(
        backupType === 'system_image'
          ? 'BACKUP_SYSTEM_IMAGE_NOT_READY'
          : 'BACKUP_FILE_SOURCE_NOT_READY',
        backupType === 'system_image'
          ? 'The mounted source must contain a supported exported system image file.'
          : 'The shared folder is not available under the configured read-only source root.',
        HttpStatus.CONFLICT,
      );
    }
  }
}

function isMountedFileBackupSource(sourceType: string | null | undefined): boolean {
  return ['file', 'file_share', 'server', 'workstation', 'mobile_device', 'other'].includes(
    sourceType ?? '',
  );
}

function isSupportedRestoreSource(sourceType: string, backupType: string): boolean {
  return (
    (sourceType === 'database' && ['database_snapshot', 'full'].includes(backupType)) ||
    (sourceType === 'object_storage' &&
      ['differential', 'full', 'incremental'].includes(backupType)) ||
    (sourceType === 'cloud_service' &&
      ['differential', 'full', 'incremental'].includes(backupType)) ||
    (sourceType === 'email' && ['differential', 'full', 'incremental'].includes(backupType)) ||
    (['file', 'file_share'].includes(sourceType) &&
      (['differential', 'full', 'incremental'].includes(backupType) ||
        (sourceType === 'file_share' && backupType === 'system_image')))
  );
}

function approvalNoLongerPending(): ApiErrorException {
  return new ApiErrorException(
    'BACKUP_APPROVAL_NO_LONGER_PENDING',
    'This approval request is no longer awaiting a decision.',
    HttpStatus.CONFLICT,
  );
}
