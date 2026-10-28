import { createDecipheriv, createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import { UnrecoverableError } from 'bullmq';
import { Client, type PoolClient } from 'pg';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { AuditService } from '../audit/audit.service.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import type { BackgroundJobContext } from '../jobs/job-handler-registry.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { PostgresBackupDumpRunner } from './postgres-backup-dump.runner.js';
import {
  backupDatabaseEngine,
  databaseEngineMatchesRestoreTarget,
  type BackupDatabaseEngine,
} from './backup-database-source.js';
import { ObjectStorageBackupArchive } from './object-storage-backup-archive.js';
import { FileShareBackupArchive } from './file-share-backup-archive.js';
import {
  createBackupDecompressor,
  createUncompressedSizeGuard,
  type BackupCompressionAlgorithm,
} from './backup-compression.js';

interface RestoreArtifactCandidate {
  artifact_key: string;
  artifact_sha256: string;
  artifact_size_bytes: string;
  backup_type: string;
  compression_algorithm: BackupCompressionAlgorithm;
  database_engine: BackupDatabaseEngine | null;
  encryption_nonce: string;
  encryption_tag: string;
  id: string;
  parent_run_id: string | null;
  policy_code: string;
  run_status: string;
  source_bucket_snapshot: string | null;
  source_code_snapshot: string | null;
  source_identity_snapshot: string | null;
  source_location_snapshot: string | null;
  source_type: 'cloud_service' | 'database' | 'email' | 'file' | 'file_share' | 'object_storage';
  uncompressed_size_bytes: string | null;
  verification_status: string;
}

interface RestoreCandidate extends RestoreArtifactCandidate {
  approval_status: string;
  policy_status: string;
  requested_by: string;
  restore_object_key: string | null;
  run_id: string;
  status: string;
}

@Injectable()
export class BackupRestoreWorkerService {
  private readonly objectStorageArchive = new ObjectStorageBackupArchive();
  private readonly fileShareArchive = new FileShareBackupArchive();

  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ObjectStorageService) private readonly storage: ObjectStorageService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(JobQueueService) private readonly jobs: JobQueueService,
    @Inject(PostgresBackupDumpRunner) private readonly dumpRunner: PostgresBackupDumpRunner,
  ) {}

  async dispatchApprovedRestores(): Promise<{ deduplicatedCount: number; enqueuedCount: number }> {
    const pending = await this.database.getPool().query<{ id: string }>(
      `SELECT restore.id
       FROM backup.restore_requests restore
       JOIN backup.approval_requests approval ON approval.id=restore.approval_request_id
       JOIN backup.execution_runs run ON run.id=restore.execution_run_id
       WHERE restore.status='approved' AND approval.status='approved'
         AND run.status='verified' AND run.verification_status='verified'
         AND ((run.source_type='database' AND $1::boolean)
           OR run.source_type IN ('cloud_service','email','object_storage','file','file_share'))
       ORDER BY restore.created_at,restore.id LIMIT 100`,
      [Boolean(this.environment.BACKUP_RESTORE_DATABASE_URL)],
    );
    let enqueuedCount = 0;
    let deduplicatedCount = 0;
    for (const restore of pending.rows) {
      const result = await this.jobs.enqueue({
        correlationId: `backup-restore:${restore.id}`,
        idempotencyKey: `backup-restore:${restore.id}`,
        name: 'backup.restore.execute',
        payload: { restoreRequestId: restore.id },
      });
      if (result.deduplicated) deduplicatedCount += 1;
      else enqueuedCount += 1;
    }
    return { deduplicatedCount, enqueuedCount };
  }

  async execute(context: BackgroundJobContext): Promise<Record<string, unknown>> {
    const restoreRequestId = requiredPayloadString(context, 'restoreRequestId');
    const lockKey = `backup-restore:${restoreRequestId}`;
    const lockClient = await this.database.getPool().connect();
    const locked = await lockClient.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
      [lockKey],
    );
    if (!locked.rows[0]?.locked) {
      lockClient.release();
      throw new Error('BACKUP_RESTORE_BUSY');
    }

    let request: RestoreCandidate;
    let attempt = 0;
    try {
      await lockClient.query('BEGIN');
      const result = await lockClient.query<RestoreCandidate>(
        `SELECT restore.id,restore.status,approval.status AS approval_status,
            restore.requested_by,restore.restore_object_key,run.id AS run_id,run.status AS run_status,
            run.backup_type,run.source_type,run.artifact_key,run.artifact_sha256,
            run.artifact_size_bytes::text,run.encryption_nonce,run.encryption_tag,
            run.compression_algorithm,run.uncompressed_size_bytes::text,run.database_engine,
            run.source_bucket_snapshot,run.source_identity_snapshot,
            run.source_code_snapshot,run.source_location_snapshot,run.parent_run_id,
            policy.policy_code,policy.status AS policy_status
         FROM backup.restore_requests restore
         JOIN backup.approval_requests approval ON approval.id=restore.approval_request_id
         JOIN backup.execution_runs run ON run.id=restore.execution_run_id
         JOIN backup.policies policy ON policy.id=run.policy_id
         WHERE restore.id=$1
         FOR UPDATE OF restore,approval`,
        [restoreRequestId],
      );
      const found = result.rows[0];
      if (!found) throw new UnrecoverableError('The restore request was not found.');
      if (found.status === 'completed') {
        await lockClient.query('COMMIT');
        return { restoreRequestId, status: 'completed' };
      }
      if (
        !['approved', 'failed', 'running'].includes(found.status) ||
        found.approval_status !== 'approved' ||
        found.run_status !== 'verified' ||
        !isSupportedRestoreSource(found.source_type, found.backup_type) ||
        (found.source_type === 'database' &&
          !databaseEngineMatchesRestoreTarget(
            found.database_engine ?? 'postgresql',
            this.environment.BACKUP_RESTORE_DATABASE_URL,
          ))
      ) {
        throw new UnrecoverableError(
          'Only an approved request for a verified backup with an isolated target can run.',
        );
      }
      request = found;
      const attemptResult = await lockClient.query<{ attempt_count: number }>(
        `UPDATE backup.restore_requests SET status='running',attempt_count=attempt_count+1,
            error_code=NULL,updated_at=now()
         WHERE id=$1 RETURNING attempt_count`,
        [restoreRequestId],
      );
      attempt = attemptResult.rows[0]?.attempt_count ?? 1;
      await lockClient.query(
        `INSERT INTO backup.restore_events(restore_request_id,event_type,details)
         VALUES($1,'started',$2)`,
        [restoreRequestId, { attempt }],
      );
      await this.audit.append(
        {
          action: 'backup.restore.started',
          correlationId: context.correlationId,
          metadata: {
            attempt,
            ...(request.restore_object_key ? { objectKey: request.restore_object_key } : {}),
            policyCode: request.policy_code,
            runId: request.run_id,
          },
          targetId: restoreRequestId,
          targetType: 'backup_restore_request',
        },
        lockClient,
      );
      await lockClient.query('COMMIT');
    } catch (error) {
      await lockClient.query('ROLLBACK').catch(() => undefined);
      await unlockAndRelease(lockClient, lockKey);
      throw error;
    }

    const directory = await createPrivateTempDirectory();
    const encryptedPath = join(directory, 'artifact.enc');
    const dumpPath = join(directory, 'database.dump');
    let targetDatabaseName: string | undefined;
    let targetCreated = false;
    let targetStoragePrefix: string | undefined;
    try {
      let archivePaths: string[] | undefined;
      let databaseArchive: { hasVistaMigrationLedger: boolean } | undefined;
      if (
        request.source_type === 'email' ||
        request.source_type === 'cloud_service' ||
        request.source_type === 'object_storage' ||
        request.source_type === 'file' ||
        request.source_type === 'file_share'
      ) {
        const lineage = await this.loadFileShareLineage(request.run_id);
        archivePaths = [];
        for (const [index, ancestor] of lineage.entries()) {
          const ancestorEncryptedPath = join(directory, `artifact-${index}.enc`);
          const ancestorArchivePath = join(directory, `archive-${index}.bin`);
          await this.decryptAndValidate(ancestor, ancestorEncryptedPath, ancestorArchivePath);
          archivePaths.push(ancestorArchivePath);
        }
      } else {
        databaseArchive = await this.decryptAndValidate(request, encryptedPath, dumpPath);
      }
      if (request.source_type === 'database') {
        const targetUrl = this.environment.BACKUP_RESTORE_DATABASE_URL;
        if (!targetUrl) throw new Error('BACKUP_RESTORE_TARGET_NOT_CONFIGURED');
        targetDatabaseName = restoreDatabaseName(restoreRequestId, attempt);
        const engine = backupDatabaseEngine(targetUrl);
        if (engine === 'mariadb') {
          await this.dumpRunner.createIsolatedDatabase(targetUrl, targetDatabaseName);
        } else {
          await createIsolatedDatabase(targetUrl, targetDatabaseName);
        }
        targetCreated = true;
        const databaseUrl = databaseUrlFor(targetUrl, targetDatabaseName);
        await this.dumpRunner.restore(databaseUrl, dumpPath);
        const primarySourceCode =
          this.environment.BACKUP_PRIMARY_DATABASE_SOURCE_CODE?.trim().toUpperCase() ||
          'VISTA-DB-01';
        const sourceCode = request.source_code_snapshot?.trim().toUpperCase();
        if (engine === 'mariadb') {
          await this.dumpRunner.verifyIsolatedDatabase(databaseUrl);
        } else {
          await verifyRestoredDatabase(
            databaseUrl,
            Boolean(databaseArchive?.hasVistaMigrationLedger) ||
              !sourceCode ||
              sourceCode === primarySourceCode,
          );
        }
        await this.markCompleted(request, context, { databaseName: targetDatabaseName }, attempt);
        targetCreated = false;
        return { restoreRequestId, status: 'completed', targetDatabaseName };
      }

      targetStoragePrefix = restoreStoragePrefix(restoreRequestId, attempt);
      const manifest =
        request.source_type === 'email' ||
        request.source_type === 'object_storage' ||
        request.source_type === 'cloud_service'
          ? await this.objectStorageArchive.restoreChain(
              archivePaths ?? [],
              request.source_bucket_snapshot ?? this.storage.bucketName(),
              this.storage,
              targetStoragePrefix,
              request.restore_object_key ?? undefined,
            )
          : await this.fileShareArchive.restoreChain(
              archivePaths ?? [],
              requiredSnapshotValue(request.source_code_snapshot),
              requiredSnapshotValue(request.source_location_snapshot),
              this.storage,
              targetStoragePrefix,
              request.restore_object_key ?? undefined,
            );
      await this.markCompleted(
        request,
        context,
        {
          ...(request.restore_object_key ? { objectKey: request.restore_object_key } : {}),
          storageBucket: this.environment.BACKUP_S3_BUCKET,
          storagePrefix: targetStoragePrefix,
        },
        attempt,
      );
      return {
        objectCount: request.restore_object_key
          ? 1
          : 'objects' in manifest
            ? manifest.objects.length
            : manifest.files.length,
        ...(request.restore_object_key ? { restoredObjectKey: request.restore_object_key } : {}),
        restoreRequestId,
        status: 'completed',
        targetStorageBucket: this.environment.BACKUP_S3_BUCKET,
        targetStoragePrefix,
      };
    } catch (error) {
      let orphanedTargetDatabaseName: string | undefined;
      if (targetCreated && targetDatabaseName) {
        try {
          if (backupDatabaseEngine(this.environment.BACKUP_RESTORE_DATABASE_URL) === 'mariadb') {
            await this.dumpRunner.dropIsolatedDatabase(
              this.environment.BACKUP_RESTORE_DATABASE_URL,
              targetDatabaseName,
            );
          } else {
            await dropIsolatedDatabase(
              this.environment.BACKUP_RESTORE_DATABASE_URL,
              targetDatabaseName,
            );
          }
          targetCreated = false;
        } catch {
          orphanedTargetDatabaseName = targetDatabaseName;
        }
      }
      let orphanedStoragePrefix: string | undefined;
      if (targetStoragePrefix) {
        try {
          await this.storage.deleteRestoredFilePrefix(targetStoragePrefix);
          targetStoragePrefix = undefined;
        } catch {
          orphanedStoragePrefix = targetStoragePrefix;
        }
      }
      const errorCode = safeErrorCode(error);
      await this.markFailed(
        request,
        context,
        errorCode,
        attempt,
        orphanedTargetDatabaseName,
        orphanedStoragePrefix,
      );
      throw error;
    } finally {
      await rm(directory, { force: true, recursive: true });
      await unlockAndRelease(lockClient, lockKey);
    }
  }

  private async decryptAndValidate(
    run: RestoreArtifactCandidate,
    encryptedPath: string,
    dumpPath: string,
  ): Promise<{ hasVistaMigrationLedger: boolean } | undefined> {
    const key = parseEncryptionKey(this.environment.BACKUP_ENCRYPTION_KEY);
    const hash = createHash('sha256');
    let bytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        bytes += chunk.length;
        callback(null, chunk);
      },
    });
    await pipeline(
      await this.storage.getBackupObjectStream(run.artifact_key),
      meter,
      createWriteStream(encryptedPath, { mode: 0o600 }),
    );
    if (
      hash.digest('hex') !== run.artifact_sha256.trim() ||
      bytes !== Number(run.artifact_size_bytes)
    ) {
      throw new Error('BACKUP_ARTIFACT_CHECKSUM_MISMATCH');
    }
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(run.encryption_nonce, 'hex'));
    decipher.setAuthTag(Buffer.from(run.encryption_tag, 'hex'));
    const encryptedInput = createReadStream(encryptedPath);
    const decompressor = createBackupDecompressor(run.compression_algorithm);
    if (decompressor) {
      await pipeline(
        encryptedInput,
        decipher,
        decompressor,
        createUncompressedSizeGuard(run.uncompressed_size_bytes),
        createWriteStream(dumpPath, { mode: 0o600 }),
      );
    } else {
      await pipeline(encryptedInput, decipher, createWriteStream(dumpPath, { mode: 0o600 }));
    }
    if (run.uncompressed_size_bytes && run.compression_algorithm !== 'gzip') {
      const archiveStats = await stat(dumpPath);
      if (BigInt(archiveStats.size) !== BigInt(run.uncompressed_size_bytes)) {
        throw new Error('BACKUP_UNCOMPRESSED_SIZE_MISMATCH');
      }
    }
    if (run.source_type === 'database') {
      return this.dumpRunner.validateArchive(dumpPath, run.database_engine ?? 'postgresql');
    } else if (
      run.source_type === 'object_storage' ||
      run.source_type === 'email' ||
      run.source_type === 'cloud_service'
    ) {
      await this.objectStorageArchive.validateFile(
        dumpPath,
        run.source_bucket_snapshot ?? this.storage.bucketName(),
      );
    } else {
      await this.fileShareArchive.validateFile(
        dumpPath,
        requiredSnapshotValue(run.source_code_snapshot),
        requiredSnapshotValue(run.source_location_snapshot),
      );
    }
  }

  private async loadFileShareLineage(runId: string): Promise<RestoreArtifactCandidate[]> {
    const result = await this.database.getPool().query<RestoreArtifactCandidate>(
      `WITH RECURSIVE lineage AS (
         SELECT run.id,run.parent_run_id,run.backup_type,run.source_type,run.source_bucket_snapshot,
           run.source_identity_snapshot,run.source_code_snapshot,
           run.source_location_snapshot,run.database_engine,run.status AS run_status,run.verification_status,
           run.artifact_key,run.artifact_sha256,run.artifact_size_bytes::text,
           run.encryption_nonce,run.encryption_tag,run.compression_algorithm,
           run.uncompressed_size_bytes::text,policy.policy_code,
           ARRAY[run.id]::uuid[] AS path,0 AS depth
         FROM backup.execution_runs run
         JOIN backup.policies policy ON policy.id=run.policy_id
        WHERE run.id=$1
         UNION ALL
         SELECT parent.id,parent.parent_run_id,parent.backup_type,parent.source_type,
           parent.source_bucket_snapshot,parent.source_identity_snapshot,
           parent.source_code_snapshot,parent.source_location_snapshot,parent.database_engine,parent.status,
           parent.verification_status,parent.artifact_key,parent.artifact_sha256,
           parent.artifact_size_bytes::text,parent.encryption_nonce,parent.encryption_tag,
           parent.compression_algorithm,parent.uncompressed_size_bytes::text,policy.policy_code,
           lineage.path || parent.id,lineage.depth+1
         FROM lineage
         JOIN backup.execution_runs parent ON parent.id=lineage.parent_run_id
         JOIN backup.policies policy ON policy.id=parent.policy_id
         WHERE lineage.depth < 100 AND NOT parent.id=ANY(lineage.path)
       )
       SELECT id,parent_run_id,backup_type,source_type,source_bucket_snapshot,
         source_identity_snapshot,source_code_snapshot,
         source_location_snapshot,database_engine,run_status,verification_status,artifact_key,artifact_sha256,
         artifact_size_bytes,encryption_nonce,encryption_tag,compression_algorithm,
         uncompressed_size_bytes,policy_code
       FROM lineage ORDER BY depth DESC`,
      [runId],
    );
    const lineage = result.rows;
    const requested = lineage.at(-1);
    if (
      lineage.length === 0 ||
      requested?.id !== runId ||
      !['full', 'system_image'].includes(lineage[0]?.backup_type ?? '') ||
      lineage.some(
        (run) =>
          !['cloud_service', 'email', 'object_storage', 'file', 'file_share'].includes(
            run.source_type,
          ) ||
          run.run_status !== 'verified' ||
          run.verification_status !== 'verified' ||
          !run.artifact_key ||
          !run.artifact_sha256 ||
          !run.artifact_size_bytes ||
          !run.encryption_nonce ||
          !run.encryption_tag ||
          (run.id !== lineage[0]?.id &&
            (run.policy_code !== lineage[0]?.policy_code ||
              run.source_type !== lineage[0]?.source_type ||
              run.source_bucket_snapshot !== lineage[0]?.source_bucket_snapshot ||
              run.source_identity_snapshot !== lineage[0]?.source_identity_snapshot ||
              run.source_code_snapshot !== lineage[0]?.source_code_snapshot ||
              run.source_location_snapshot !== lineage[0]?.source_location_snapshot)),
      ) ||
      lineage.some(
        (run, index) =>
          index > 0 &&
          (run.parent_run_id !== lineage[index - 1]?.id ||
            !['incremental', 'differential'].includes(run.backup_type) ||
            (run.backup_type === 'differential' && index !== 1)),
      )
    ) {
      throw new Error('BACKUP_INCREMENTAL_CHAIN_INVALID');
    }
    return lineage;
  }

  private async markCompleted(
    request: RestoreCandidate,
    context: BackgroundJobContext,
    target: {
      databaseName?: string;
      objectKey?: string;
      storageBucket?: string;
      storagePrefix?: string;
    },
    attempt: number,
  ): Promise<void> {
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE backup.restore_requests SET status='completed',target_database_name=$2,
            target_storage_bucket=$3,target_storage_prefix=$4,
            completed_at=now(),error_code=NULL,updated_at=now()
         WHERE id=$1 AND status='running'`,
        [
          request.id,
          target.databaseName ?? null,
          target.storageBucket ?? null,
          target.storagePrefix ?? null,
        ],
      );
      await client.query(
        `UPDATE backup.approval_requests SET status='executed'
         WHERE target_id=$1 AND target_type='backup_restore_request'
           AND critical_action='destructive_restore' AND status='approved'`,
        [request.id],
      );
      await client.query(
        `INSERT INTO backup.restore_events(restore_request_id,event_type,details)
         VALUES($1,'completed',$2)`,
        [request.id, { attempt, ...target }],
      );
      await this.audit.append(
        {
          action: 'backup.restore.completed',
          correlationId: context.correlationId,
          metadata: { attempt, policyCode: request.policy_code, ...target },
          targetId: request.id,
          targetType: 'backup_restore_request',
        },
        client,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async markFailed(
    request: RestoreCandidate,
    context: BackgroundJobContext,
    errorCode: string,
    attempt: number,
    targetDatabaseName: string | undefined,
    targetStoragePrefix: string | undefined,
  ): Promise<void> {
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE backup.restore_requests SET status='failed',error_code=$2,
            target_database_name=$3,target_storage_bucket=$4,target_storage_prefix=$5,
            updated_at=now()
         WHERE id=$1 AND status='running'`,
        [
          request.id,
          errorCode,
          targetDatabaseName ?? null,
          targetStoragePrefix ? this.environment.BACKUP_S3_BUCKET : null,
          targetStoragePrefix ?? null,
        ],
      );
      await client.query(
        `INSERT INTO backup.restore_events(restore_request_id,event_type,details)
         VALUES($1,'failed',$2)`,
        [
          request.id,
          {
            attempt,
            errorCode,
            ...(targetDatabaseName ? { targetDatabaseName } : {}),
            ...(targetStoragePrefix
              ? { targetStorageBucket: this.environment.BACKUP_S3_BUCKET, targetStoragePrefix }
              : {}),
          },
        ],
      );
      await this.audit.append(
        {
          action: 'backup.restore.failed',
          correlationId: context.correlationId,
          metadata: { attempt, errorCode, policyCode: request.policy_code },
          targetId: request.id,
          targetType: 'backup_restore_request',
        },
        client,
      );
      await client.query('COMMIT');
    } catch {
      await client.query('ROLLBACK').catch(() => undefined);
    } finally {
      client.release();
    }
  }
}

function requiredPayloadString(context: BackgroundJobContext, name: string): string {
  const value = context.payload[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new UnrecoverableError(`Backup restore job requires ${name}.`);
  }
  return value;
}

function requiredSnapshotValue(value: string | null): string {
  if (!value) throw new UnrecoverableError('The protected source snapshot is incomplete.');
  return value;
}

function parseEncryptionKey(value: string): Buffer {
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new Error('BACKUP_ENCRYPTION_KEY_MISSING_OR_INVALID');
  return Buffer.from(value, 'hex');
}

function restoreDatabaseName(requestId: string, attempt: number): string {
  if (!/^[a-f0-9-]{36}$/i.test(requestId) || !Number.isSafeInteger(attempt) || attempt < 1) {
    throw new UnrecoverableError('The restore target identifier is invalid.');
  }
  return `vista_restore_${requestId.replaceAll('-', '').slice(0, 20)}_${attempt}`;
}

function restoreStoragePrefix(requestId: string, attempt: number): string {
  if (!/^[a-f0-9-]{36}$/i.test(requestId) || !Number.isSafeInteger(attempt) || attempt < 1) {
    throw new UnrecoverableError('The restore target identifier is invalid.');
  }
  return `restores/${requestId.replaceAll('-', '').toLowerCase()}/attempt-${attempt}/`;
}

function isSupportedRestoreSource(sourceType: string, backupType: string): boolean {
  return (
    (sourceType === 'database' && ['database_snapshot', 'full'].includes(backupType)) ||
    (sourceType === 'object_storage' &&
      ['differential', 'full', 'incremental'].includes(backupType)) ||
    (sourceType === 'email' && ['differential', 'full', 'incremental'].includes(backupType)) ||
    (sourceType === 'cloud_service' &&
      ['differential', 'full', 'incremental'].includes(backupType)) ||
    (['file', 'file_share'].includes(sourceType) &&
      (['differential', 'full', 'incremental'].includes(backupType) ||
        (sourceType === 'file_share' && backupType === 'system_image')))
  );
}

function databaseUrlFor(adminUrl: string, databaseName: string): string {
  if (!/^vista_restore_[a-f0-9_]+$/u.test(databaseName)) {
    throw new Error('BACKUP_RESTORE_TARGET_NAME_INVALID');
  }
  const parsed = new URL(adminUrl);
  if (!['postgres:', 'postgresql:', 'mysql:', 'mysql2:', 'mariadb:'].includes(parsed.protocol)) {
    throw new Error('BACKUP_RESTORE_DATABASE_URL_INVALID');
  }
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function createIsolatedDatabase(adminUrl: string, databaseName: string): Promise<void> {
  const client = maintenanceClient(adminUrl);
  try {
    await client.connect();
    await client.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function dropIsolatedDatabase(adminUrl: string, databaseName: string): Promise<void> {
  if (!/^vista_restore_[a-f0-9_]+$/.test(databaseName)) return;
  const client = maintenanceClient(adminUrl);
  try {
    await client.connect();
    await client.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid()',
      [databaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

function maintenanceClient(adminUrl: string): Client {
  const parsed = new URL(adminUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('BACKUP_RESTORE_DATABASE_URL_INVALID');
  }
  parsed.pathname = '/postgres';
  return new Client({ connectionString: parsed.toString() });
}

async function verifyRestoredDatabase(
  databaseUrl: string,
  hasVistaMigrationLedger: boolean,
): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const result = await client.query<{
      database_name: string | null;
      migration_table: string | null;
    }>(
      "SELECT current_database() AS database_name,to_regclass('platform.schema_migrations')::text AS migration_table",
    );
    if (
      !result.rows[0]?.database_name ||
      (hasVistaMigrationLedger && !result.rows[0]?.migration_table)
    ) {
      throw new Error('BACKUP_RESTORE_CONTENT_CHECK_FAILED');
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function createPrivateTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'vista-backup-restore-'));
  await chmod(directory, 0o700);
  return directory;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,79}$/.test(error.message)) return error.message;
  return 'BACKUP_RESTORE_FAILED';
}

async function unlockAndRelease(client: PoolClient, lockKey: string): Promise<void> {
  await client
    .query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey])
    .catch(() => undefined);
  client.release();
}
