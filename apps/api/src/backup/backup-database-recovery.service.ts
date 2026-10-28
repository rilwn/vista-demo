import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  BackupDatabaseRecordRecovery,
  BackupDatabaseRecordRecoveryRequest,
  BackupDatabaseRecoveryTablePage,
} from '@vista/contracts';

import { AuditService } from '../audit/audit.service.js';
import type {
  AuthenticationContext,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';
import {
  databaseEngineMatchesRestoreTarget,
  type BackupDatabaseEngine,
} from './backup-database-source.js';
import { PostgresBackupDumpRunner } from './postgres-backup-dump.runner.js';

interface CompletedDatabaseRestore {
  database_engine: BackupDatabaseEngine | null;
  restore_status: string;
  run_id: string;
  source_type: string;
  target_database_name: string | null;
}

@Injectable()
export class BackupDatabaseRecoveryService {
  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PostgresBackupDumpRunner) private readonly dumpRunner: PostgresBackupDumpRunner,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async tables(restoreRequestId: string): Promise<BackupDatabaseRecoveryTablePage> {
    const target = await this.completedRestoreTarget(restoreRequestId);
    const connection = this.restoreDatabaseUrl(target);
    return { items: await this.dumpRunner.listRecoveryTables(connection.url) };
  }

  async recoverRecord(
    restoreRequestId: string,
    input: BackupDatabaseRecordRecoveryRequest,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<BackupDatabaseRecordRecovery> {
    const target = await this.completedRestoreTarget(restoreRequestId);
    const connection = this.restoreDatabaseUrl(target);
    let record: Record<string, unknown> | undefined;
    try {
      record = await this.dumpRunner.readRecoveryRecord(
        connection.url,
        input.tableName,
        input.primaryKey,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        ['BACKUP_RECOVERY_TABLE_NOT_AVAILABLE', 'BACKUP_RECOVERY_PRIMARY_KEY_INVALID'].includes(
          error.message,
        )
      ) {
        throw new ApiErrorException(
          error.message,
          'Choose a listed table and enter every primary-key value exactly as shown in the source system.',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
    if (!record) {
      throw new ApiErrorException(
        'BACKUP_RECOVERY_RECORD_NOT_FOUND',
        'No matching record was found in this isolated recovery copy.',
        HttpStatus.NOT_FOUND,
      );
    }

    const result: BackupDatabaseRecordRecovery = {
      databaseEngine: connection.engine,
      format: 'vista-database-record-recovery-v1',
      primaryKey: input.primaryKey,
      recoveredAt: new Date().toISOString(),
      record,
      restoreRequestId,
      sourceRunId: target.run_id,
      tableName: input.tableName,
    };
    const size = Buffer.byteLength(JSON.stringify(result), 'utf8');
    if (size > 5 * 1024 * 1024) {
      throw new ApiErrorException(
        'BACKUP_RECOVERY_RECORD_TOO_LARGE',
        'This record is too large for an individual recovery export. Recover its containing document or file instead.',
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    await this.audit.append({
      action: 'backup.restore.database_record_exported',
      actorAccountId: actor.accountId,
      correlationId: metadata.correlationId,
      metadata: {
        databaseEngine: connection.engine,
        primaryKeySha256: createHash('sha256')
          .update(JSON.stringify(input.primaryKey))
          .digest('hex'),
        recordFieldCount: Object.keys(record).length,
        tableName: input.tableName,
      },
      targetId: restoreRequestId,
      targetType: 'backup_restore_request',
    });
    return result;
  }

  private async completedRestoreTarget(
    restoreRequestId: string,
  ): Promise<CompletedDatabaseRestore> {
    const result = await this.database.getPool().query<CompletedDatabaseRestore>(
      `SELECT restore.status AS restore_status,restore.target_database_name,
          run.id AS run_id,run.source_type,run.database_engine
       FROM backup.restore_requests restore
       JOIN backup.execution_runs run ON run.id=restore.execution_run_id
       WHERE restore.id=$1`,
      [restoreRequestId],
    );
    const target = result.rows[0];
    if (!target)
      throw new ApiErrorException(
        'BACKUP_RESTORE_NOT_FOUND',
        'Recovery request not found.',
        HttpStatus.NOT_FOUND,
      );
    if (
      target.restore_status !== 'completed' ||
      target.source_type !== 'database' ||
      !target.target_database_name ||
      !/^vista_restore_[a-f0-9_]+$/u.test(target.target_database_name)
    ) {
      throw new ApiErrorException(
        'BACKUP_RECOVERY_DATABASE_NOT_READY',
        'Complete an isolated database recovery before selecting an individual record.',
        HttpStatus.CONFLICT,
      );
    }
    return target;
  }

  private restoreDatabaseUrl(target: CompletedDatabaseRestore): {
    engine: BackupDatabaseEngine;
    url: string;
  } {
    const baseUrl = this.environment.BACKUP_RESTORE_DATABASE_URL;
    const engine = target.database_engine ?? 'postgresql';
    if (!baseUrl || !databaseEngineMatchesRestoreTarget(engine, baseUrl)) {
      throw new ApiErrorException(
        'BACKUP_RESTORE_TARGET_NOT_CONFIGURED',
        'The isolated database recovery connection is not configured for this database type.',
        HttpStatus.CONFLICT,
      );
    }
    const url = new URL(baseUrl);
    url.pathname = `/${target.target_database_name}`;
    return { engine, url: url.toString() };
  }
}
