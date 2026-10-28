import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export interface BackupPlanSnapshot {
  policies: Array<{
    backupType: string;
    compressionEnabled: boolean;
    dayOfMonth?: number;
    dayOfWeek?: number;
    encryptionRequired: boolean;
    frequency: string;
    policyCode: string;
    retentionDailyCopies: number;
    retentionMonthlyCopies: number;
    rpoMinutes: number;
    rtoMinutes: number;
    runTimeLocal?: string;
    sourceCodes: string[];
    status: string;
    verificationRequired: boolean;
    version: number;
  }>;
  protectedSources: Array<{
    classification: string;
    location: string;
    name: string;
    ownerName?: string;
    sourceCode: string;
    sourceType: string;
    status: string;
    stewardName?: string;
    version: number;
  }>;
  storageTarget: string;
}

export async function loadBackupPlanSnapshot(
  queryable: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  storageTarget: string,
): Promise<BackupPlanSnapshot> {
  const result = await queryable.query<{
    policies: BackupPlanSnapshot['policies'];
    protected_sources: BackupPlanSnapshot['protectedSources'];
    storage_target: string;
  }>(
    `SELECT
       $1::text AS storage_target,
       COALESCE((
         SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'classification',source.data_classification,
           'location',source.location,
           'name',source.name,
           'ownerName',owner.display_name,
           'sourceCode',source.source_code,
           'sourceType',source.source_type,
           'status',source.status,
           'stewardName',steward.display_name,
           'version',source.version
         )) ORDER BY source.source_code,source.id)
         FROM backup.protected_sources source
         LEFT JOIN identity.employees owner ON owner.id=source.owner_employee_id
         LEFT JOIN identity.employees steward ON steward.id=source.data_steward_employee_id
       ),'[]'::jsonb) AS protected_sources,
       COALESCE((
         SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'backupType',policy.backup_type,
           'compressionEnabled',policy.compression_enabled,
           'dayOfMonth',policy.day_of_month,
           'dayOfWeek',policy.day_of_week,
           'encryptionRequired',policy.encryption_required,
           'frequency',policy.frequency,
           'policyCode',policy.policy_code,
           'retentionDailyCopies',policy.retention_daily_copies,
           'retentionMonthlyCopies',policy.retention_monthly_copies,
           'rpoMinutes',policy.rpo_minutes,
           'rtoMinutes',policy.rto_minutes,
           'runTimeLocal',policy.run_time_local,
           'sourceCodes',COALESCE((
             SELECT jsonb_agg(source.source_code ORDER BY source.source_code,source.id)
             FROM backup.policy_sources link
             JOIN backup.protected_sources source ON source.id=link.source_id
             WHERE link.policy_id=policy.id
           ),'[]'::jsonb),
           'status',policy.status,
           'verificationRequired',policy.verification_required,
           'version',policy.version
         )) ORDER BY policy.policy_code,policy.id)
         FROM backup.policies policy
       ),'[]'::jsonb) AS policies`,
    [storageTarget],
  );
  const row = result.rows[0];
  if (!row) throw new Error('The backup plan snapshot could not be loaded');
  return {
    policies: row.policies,
    protectedSources: row.protected_sources,
    storageTarget: row.storage_target,
  };
}

export function hashBackupPlanSnapshot(snapshot: BackupPlanSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
