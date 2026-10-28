import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import { UnrecoverableError } from 'bullmq';
import type { PoolClient } from 'pg';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { AuditService } from '../audit/audit.service.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';
import { queueEmailMessage } from '../notifications/notification-email.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import type { BackgroundJobContext } from '../jobs/job-handler-registry.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { PostgresBackupDumpRunner } from './postgres-backup-dump.runner.js';
import { hashBackupPlanSnapshot, loadBackupPlanSnapshot } from './backup-plan-review.js';
import {
  ObjectStorageBackupArchive,
  type ObjectStorageBackupManifest,
  type ObjectStorageBackupMode,
} from './object-storage-backup-archive.js';
import {
  objectStorageBackupSourceSnapshot,
  resolveObjectStorageBackupSource,
  type ObjectStorageBackupSourceHandle,
} from './object-storage-backup-source.js';
import {
  FileShareBackupArchive,
  type FileShareBackupMode,
  type FileShareManifest,
} from './file-share-backup-archive.js';
import { backupDatabaseEngine, backupDatabaseSourceUrl } from './backup-database-source.js';
import {
  emailImapBackupSourceSnapshot,
  resolveEmailImapBackupSource,
} from './email-imap-backup-source.js';
import { resolveWebDavBackupSource, webDavBackupSourceSnapshot } from './webdav-backup-source.js';
import {
  backupCompressionAlgorithm,
  createBackupCompressor,
  createBackupDecompressor,
  createUncompressedSizeGuard,
  type BackupCompressionAlgorithm,
} from './backup-compression.js';

const multipartPartBytes = 8 * 1024 * 1024;
const retentionBatchSize = 50;

interface ClaimedRun {
  attempt_count: number;
  artifact_key: string | null;
  artifact_sha256: string | null;
  artifact_size_bytes: string | null;
  backup_type: string;
  compression_algorithm: BackupCompressionAlgorithm;
  database_engine: 'mariadb' | 'postgresql' | null;
  encryption_nonce: string | null;
  encryption_tag: string | null;
  id: string;
  independent_copy_error_code: string | null;
  independent_copy_status: 'failed' | 'not_configured' | 'pending' | 'running' | 'verified';
  independent_copy_target_code: string | null;
  independent_copy_verified_at: Date | string | null;
  idempotency_key: string;
  legacy_managed_source: boolean;
  policy_code: string;
  policy_id: string;
  policy_status: string;
  parent_run_id: string | null;
  parent_source_manifest?: unknown;
  scheduled_for: Date | string;
  source_bucket_snapshot: string | null;
  source_code_snapshot: string | null;
  source_id: string | null;
  source_identity_snapshot: string | null;
  source_location_snapshot: string | null;
  source_type: 'cloud_service' | 'database' | 'email' | 'file' | 'file_share' | 'object_storage';
  status: 'failed' | 'running' | 'stored' | 'verified';
  verification_attempt_count: number;
  verification_status: 'failed' | 'pending' | 'running' | 'verified';
  uncompressed_size_bytes: string | null;
}

interface DuePolicy {
  policy_code: string;
  policy_id: string;
  scheduled_for: Date | string;
}

interface RetentionCandidate {
  artifact_key: string;
  attempt_count: number;
  id: string;
  policy_approval_request_id: string;
  policy_approved_by: string;
  policy_code: string;
  policy_requested_by: string;
  retention_daily_copies: number;
  retention_monthly_copies: number;
  scheduled_for: Date | string;
}

interface ArtifactDeletionCandidate {
  approval_request_id: string;
  artifact_key: string | null;
  artifact_sha256: string | null;
  artifact_deleted_at: Date | string | null;
  attempt_count: number;
  id: string;
  policy_code: string;
  requested_by: string;
  run_id: string;
  scheduled_for: Date | string;
  status: 'approved' | 'failed' | 'running';
  target_sha256: string;
  verification_status: string;
  run_status: string;
  lease_expired: boolean;
}

interface MissedRunCandidate {
  policy_code: string;
  policy_id: string;
  scheduled_for: Date | string;
}

interface BackupAlertRecipient {
  account_id: string;
  email: string;
}

interface DrTestReminderCandidate {
  due_at: Date | string;
  reminder_key: string;
  reminder_state: 'initial' | 'upcoming' | 'overdue';
  test_code: string | null;
}

interface PlanReviewReminderCandidate {
  next_review_due_at: Date | string | null;
  outcome: 'approved' | 'changes_required' | null;
  review_code: string | null;
  review_id: string | null;
  reviewed_at: Date | string | null;
  snapshot_sha256: string | null;
}

type BackupAlertKind = 'failed' | 'missed' | 'verified';

@Injectable()
export class BackupExecutionService {
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

  async dispatchDueRuns(context: BackgroundJobContext): Promise<{
    dueCount: number;
    enqueuedCount: number;
    deduplicatedCount: number;
  }> {
    void context;
    const due = await this.database.getPool().query<DuePolicy>(
      `WITH clock AS (
         SELECT now() AT TIME ZONE $1 AS local_now
       ), slots AS (
         SELECT policy.id AS policy_id, policy.policy_code,
           CASE
             WHEN policy.frequency='hourly' THEN date_trunc('hour', clock.local_now)
             WHEN policy.frequency='daily' AND clock.local_now::time >= policy.run_time_local
               THEN date_trunc('day', clock.local_now)
                    + (policy.run_time_local - time '00:00')
             WHEN policy.frequency='weekly'
               AND extract(dow FROM clock.local_now)::integer=policy.day_of_week
               AND clock.local_now::time >= policy.run_time_local
               THEN date_trunc('day', clock.local_now)
                    + (policy.run_time_local - time '00:00')
             WHEN policy.frequency='monthly'
               AND extract(day FROM clock.local_now)::integer=policy.day_of_month
               AND clock.local_now::time >= policy.run_time_local
               THEN date_trunc('day', clock.local_now)
                    + (policy.run_time_local - time '00:00')
             ELSE NULL
           END AS scheduled_local
         FROM backup.policies policy CROSS JOIN clock
         WHERE policy.status='active'
           AND policy.backup_type IN ('database_snapshot','full','incremental','differential')
       )
       SELECT slots.policy_id, slots.policy_code,
              slots.scheduled_local AT TIME ZONE $1 AS scheduled_for
       FROM slots CROSS JOIN clock
       WHERE slots.scheduled_local IS NOT NULL
         AND slots.scheduled_local <= clock.local_now
         AND NOT EXISTS (
           SELECT 1 FROM backup.execution_runs run
           WHERE run.policy_id=slots.policy_id
             AND run.scheduled_for=slots.scheduled_local AT TIME ZONE $1
         )
       ORDER BY slots.policy_code, slots.policy_id`,
      [this.environment.BUSINESS_TIMEZONE],
    );
    let enqueuedCount = 0;
    let deduplicatedCount = 0;
    for (const policy of due.rows) {
      const scheduledFor = asDate(policy.scheduled_for).toISOString();
      const result = await this.jobs.enqueue({
        correlationId: `backup:${policy.policy_id}:${scheduledFor}`,
        idempotencyKey: `backup-run:${policy.policy_id}:${scheduledFor}`,
        name: 'backup.execute',
        payload: { policyId: policy.policy_id, scheduledFor },
      });
      if (result.deduplicated) deduplicatedCount += 1;
      else enqueuedCount += 1;
    }
    return { deduplicatedCount, dueCount: due.rows.length, enqueuedCount };
  }

  async detectMissedRuns(context: BackgroundJobContext): Promise<{
    detectedCount: number;
    notifiedCount: number;
  }> {
    const candidates = await this.database.getPool().query<MissedRunCandidate>(
      `WITH clock AS (
         SELECT now() AS utc_now, now() AT TIME ZONE $1 AS local_now
       ), active_policies AS (
         SELECT policy.id AS policy_id, policy.policy_code, policy.frequency,
                policy.run_time_local, policy.day_of_week, policy.day_of_month,
                policy.updated_at AT TIME ZONE $1 AS activated_or_changed_at
         FROM backup.policies policy
         WHERE policy.status='active'
           AND policy.backup_type IN ('database_snapshot','full','incremental','differential')
       ), slots AS (
         SELECT policy.policy_id, policy.policy_code, clock.utc_now,
                slot.hour_start AT TIME ZONE $1 AS scheduled_local,
                slot.hour_start AS scheduled_for
         FROM active_policies policy CROSS JOIN clock
         CROSS JOIN LATERAL generate_series(
           date_trunc('hour', clock.utc_now - interval '90 days', 'UTC'),
           date_trunc('hour', clock.utc_now - interval '20 minutes', 'UTC'),
           interval '1 hour'
         ) AS slot(hour_start)
         WHERE policy.frequency='hourly'
           AND slot.hour_start AT TIME ZONE $1 >= policy.activated_or_changed_at
         UNION ALL
         SELECT policy.policy_id, policy.policy_code, clock.utc_now,
                day.local_day + policy.run_time_local AS scheduled_local,
                (day.local_day + policy.run_time_local) AT TIME ZONE $1 AS scheduled_for
         FROM active_policies policy CROSS JOIN clock
         CROSS JOIN LATERAL generate_series(
           date_trunc('day', (clock.utc_now - interval '90 days') AT TIME ZONE $1),
           date_trunc('day', (clock.utc_now - CASE policy.frequency
             WHEN 'daily' THEN interval '2 hours'
             ELSE interval '24 hours' END) AT TIME ZONE $1),
           interval '1 day'
         ) AS day(local_day)
         WHERE policy.frequency IN ('daily','weekly','monthly')
           AND day.local_day + policy.run_time_local >= policy.activated_or_changed_at
           AND day.local_day + policy.run_time_local <= clock.local_now - CASE policy.frequency
             WHEN 'daily' THEN interval '2 hours'
             ELSE interval '24 hours' END
           AND (policy.frequency <> 'weekly'
             OR extract(dow FROM day.local_day)::integer = policy.day_of_week)
           AND (policy.frequency <> 'monthly'
             OR extract(day FROM day.local_day)::integer = policy.day_of_month)
       )
       SELECT DISTINCT slots.policy_id, slots.policy_code, slots.scheduled_for
       FROM slots
       WHERE NOT EXISTS (
         SELECT 1 FROM backup.execution_runs run
         WHERE run.policy_id=slots.policy_id AND run.scheduled_for=slots.scheduled_for
       )
         AND NOT EXISTS (
           SELECT 1 FROM backup.missed_schedule_events missed
           WHERE missed.policy_id=slots.policy_id AND missed.scheduled_for=slots.scheduled_for
         )
       ORDER BY slots.scheduled_for, slots.policy_code
       LIMIT 500`,
      [this.environment.BUSINESS_TIMEZONE],
    );
    let detectedCount = 0;
    let notifiedCount = 0;
    for (const candidate of candidates.rows) {
      const client = await this.database.getPool().connect();
      try {
        await client.query('BEGIN');
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO backup.missed_schedule_events (policy_id, scheduled_for)
           VALUES ($1,$2)
           ON CONFLICT (policy_id, scheduled_for) DO NOTHING
           RETURNING id`,
          [candidate.policy_id, candidate.scheduled_for],
        );
        const event = inserted.rows[0];
        if (event) {
          notifiedCount += await this.queueBackupAlerts(client, {
            eventId: event.id,
            kind: 'missed',
            policyCode: candidate.policy_code,
            scheduledFor: asDate(candidate.scheduled_for),
          });
          await this.audit.append(
            {
              action: 'backup.schedule.missed',
              correlationId: context.correlationId,
              metadata: {
                policyCode: candidate.policy_code,
                scheduledFor: asDate(candidate.scheduled_for).toISOString(),
              },
              targetId: candidate.policy_id,
              targetType: 'backup_policy',
            },
            client,
          );
          detectedCount += 1;
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
    return { detectedCount, notifiedCount };
  }

  async prepareDrTestReminders(
    context?: BackgroundJobContext,
  ): Promise<{ dueCount: number; notifiedCount: number }> {
    void context;
    const pool = this.database.getPool();
    const candidate = await pool.query<DrTestReminderCandidate>(
      `WITH latest_recorded AS (
         SELECT id,test_code,completed_at
         FROM backup.dr_test_records
         WHERE status='recorded' AND completed_at IS NOT NULL
         ORDER BY completed_at DESC,id DESC
         LIMIT 1
       ), latest_plan AS (
         SELECT id,test_code,planned_for
         FROM backup.dr_test_records
         WHERE status='planned'
         ORDER BY planned_for DESC,id DESC
         LIMIT 1
       ), reminder AS (
         SELECT CASE
             WHEN recorded.id IS NOT NULL THEN recorded.completed_at+interval '1 year'
             WHEN planned.id IS NOT NULL THEN planned.planned_for
             ELSE now()
           END AS due_at,
           CASE
             WHEN recorded.id IS NOT NULL THEN 'annual:'||recorded.id::text
             WHEN planned.id IS NOT NULL THEN 'planned:'||planned.id::text
             ELSE 'initial:'||to_char(now() AT TIME ZONE $1,'YYYY')
           END AS reminder_key,
           CASE
             WHEN recorded.id IS NOT NULL
               THEN CASE WHEN recorded.completed_at+interval '1 year' < now()
                         THEN 'overdue' ELSE 'upcoming' END
             WHEN planned.id IS NOT NULL
               THEN CASE WHEN planned.planned_for < now() THEN 'overdue' ELSE 'upcoming' END
             ELSE 'initial'
           END AS reminder_state,
           COALESCE(recorded.test_code,planned.test_code) AS test_code,
           recorded.completed_at AS last_completed_at,
           planned.planned_for AS next_planned_for
         FROM (SELECT 1) seed
         LEFT JOIN latest_recorded recorded ON true
         LEFT JOIN latest_plan planned ON true
       )
       SELECT due_at,reminder_key,reminder_state,test_code
       FROM reminder
       WHERE due_at <= now()+interval '30 days'
         AND NOT (
           last_completed_at IS NOT NULL
           AND next_planned_for > now()
           AND next_planned_for <= last_completed_at+interval '1 year'
         )
       LIMIT 1`,
      [this.environment.BUSINESS_TIMEZONE],
    );
    const due = candidate.rows[0];
    if (!due) return { dueCount: 0, notifiedCount: 0 };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const recipients = await client.query<BackupAlertRecipient>(
        `SELECT DISTINCT account.id AS account_id,employee.email
         FROM identity.user_accounts account
         JOIN identity.employees employee ON employee.id=account.employee_id AND employee.active
         JOIN iam.account_roles account_role ON account_role.account_id=account.id
         JOIN iam.role_permissions role_permission ON role_permission.role_id=account_role.role_id
         JOIN iam.permissions permission ON permission.id=role_permission.permission_id
         WHERE account.status='active' AND (account.locked_until IS NULL OR account.locked_until<=now())
           AND permission.module='backup' AND permission.action='view'
         ORDER BY account.id`,
      );
      const dueAt = asDate(due.due_at);
      const dueDate = dueAt.toISOString();
      const reminderTitle =
        due.reminder_state === 'initial'
          ? 'Disaster-recovery test required / Изисква се тест за възстановяване'
          : due.reminder_state === 'overdue'
            ? 'Disaster-recovery test overdue / Просрочен тест за възстановяване'
            : 'Disaster-recovery test due soon / Предстоящ тест за възстановяване';
      const reminderText =
        due.reminder_state === 'initial'
          ? 'No disaster-recovery test has been recorded. Schedule a restore test and record its measured RPO/RTO and signed protocol in Vista Recovery > DR tests.\n\nНяма записан тест за възстановяване след бедствие. Планирайте тест и запишете измерените RPO/RTO и подписания протокол във Vista Recovery > Тестове за възстановяване.'
          : `A disaster-recovery test must be completed by ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: this.environment.BUSINESS_TIMEZONE }).format(dueAt)}. Review Vista Recovery > DR tests and record the measured RPO/RTO and signed protocol.${due.test_code ? ` Reference: ${due.test_code}.` : ''}\n\nТестът за възстановяване след бедствие трябва да бъде завършен до ${new Intl.DateTimeFormat('bg-BG', { dateStyle: 'medium', timeZone: this.environment.BUSINESS_TIMEZONE }).format(dueAt)}. Отворете Vista Recovery > Тестове за възстановяване и запишете измерените RPO/RTO и подписания протокол.${due.test_code ? ` Референция: ${due.test_code}.` : ''}`;
      const smsBody =
        due.reminder_state === 'initial'
          ? 'Няма записан DR тест. Планирайте възстановяване във Vista Recovery и приложете подписан протокол.'
          : `DR тестът трябва да бъде завършен до ${new Intl.DateTimeFormat('bg-BG', { dateStyle: 'medium', timeZone: this.environment.BUSINESS_TIMEZONE }).format(dueAt)}. Проверете Vista Recovery > Тестове.`;
      const eventKey =
        due.reminder_state === 'initial'
          ? due.reminder_key
          : `${due.reminder_key}:${due.reminder_state}:${dueDate.slice(0, 10)}`;
      let notifiedCount = 0;
      for (const recipient of recipients.rows) {
        const idempotencyKey = `backup-dr-test-reminder:${eventKey}:${recipient.account_id}`;
        const inserted = await client.query(
          `INSERT INTO notifications.messages (
             recipient_account_id,channel,template_key,template_version,payload,idempotency_key,status
           ) VALUES ($1,'in_system','backup.dr-test.due',1,$2,$3,'pending')
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            recipient.account_id,
            { dueDate, reminderState: due.reminder_state, testCode: due.test_code },
            idempotencyKey,
          ],
        );
        if (inserted.rowCount) notifiedCount += 1;
        const email = await queueEmailMessage(client, {
          idempotencyKey,
          recipient: recipient.email,
          subject: reminderTitle,
          text: reminderText,
        });
        if (email.created) notifiedCount += 1;
      }
      if (this.environment.SMS_PROVIDER === 'twilio') {
        const smsRecipients = this.environment.BACKUP_ALERT_SMS_RECIPIENTS.split(',')
          .map((recipient) => recipient.trim())
          .filter(Boolean);
        for (const recipient of smsRecipients) {
          const inserted = await client.query(
            `INSERT INTO notifications.messages (
               channel,template_key,template_version,payload,idempotency_key,status
             ) VALUES ('sms','backup.alert.sms',1,$1,$2,'pending')
             ON CONFLICT (idempotency_key) DO NOTHING`,
            [
              { body: smsBody, to: recipient },
              `backup-dr-test-reminder:sms:${eventKey}:${createHash('sha256').update(recipient).digest('hex').slice(0, 32)}`,
            ],
          );
          if (inserted.rowCount) notifiedCount += 1;
        }
      }
      await client.query('COMMIT');
      return { dueCount: 1, notifiedCount };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async preparePlanReviewReminders(
    context?: BackgroundJobContext,
  ): Promise<{ dueCount: number; notifiedCount: number }> {
    void context;
    const pool = this.database.getPool();
    const [snapshot, latestResult, clockResult] = await Promise.all([
      loadBackupPlanSnapshot(pool, this.environment.BACKUP_S3_BUCKET),
      pool.query<PlanReviewReminderCandidate>(
        `SELECT id AS review_id,review_code,reviewed_at,next_review_due_at,
                outcome,snapshot_sha256
         FROM backup.plan_reviews
         ORDER BY reviewed_at DESC,id DESC LIMIT 1`,
      ),
      pool.query<{ now: Date | string }>('SELECT now() AS now'),
    ]);
    const latest = latestResult.rows[0];
    const now = asDate(clockResult.rows[0]?.now ?? new Date());
    const currentFingerprint = hashBackupPlanSnapshot(snapshot);
    let reminderState: 'initial' | 'inventory_changed' | 'actions_due' | 'upcoming' | 'overdue';
    let eventKey: string;
    let dueAt: Date | undefined;

    if (!latest) {
      reminderState = 'initial';
      eventKey = `initial:${currentFingerprint}`;
    } else if (latest.snapshot_sha256?.trim() !== currentFingerprint) {
      reminderState = 'inventory_changed';
      eventKey = `changed:${latest.review_id}:${currentFingerprint}`;
    } else if (latest.outcome === 'changes_required') {
      reminderState = 'actions_due';
      eventKey = `actions:${latest.review_id}`;
    } else {
      dueAt = asDate(latest.next_review_due_at ?? now);
      if (dueAt.getTime() > now.getTime() + 30 * 24 * 60 * 60 * 1000) {
        return { dueCount: 0, notifiedCount: 0 };
      }
      reminderState = dueAt.getTime() <= now.getTime() ? 'overdue' : 'upcoming';
      eventKey = `annual:${latest.review_id}:${reminderState}`;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const recipients = await client.query<BackupAlertRecipient>(
        `SELECT DISTINCT account.id AS account_id,employee.email
         FROM identity.user_accounts account
         JOIN identity.employees employee ON employee.id=account.employee_id AND employee.active
         JOIN iam.account_roles account_role ON account_role.account_id=account.id
         JOIN iam.role_permissions role_permission ON role_permission.role_id=account_role.role_id
         JOIN iam.permissions permission ON permission.id=role_permission.permission_id
         WHERE account.status='active' AND (account.locked_until IS NULL OR account.locked_until<=now())
           AND permission.module='backup' AND permission.action='view'
         ORDER BY account.id`,
      );
      const formattedDueDate = dueAt
        ? new Intl.DateTimeFormat('en-GB', {
            dateStyle: 'medium',
            timeZone: this.environment.BUSINESS_TIMEZONE,
          }).format(dueAt)
        : undefined;
      const formattedBgDueDate = dueAt
        ? new Intl.DateTimeFormat('bg-BG', {
            dateStyle: 'medium',
            timeZone: this.environment.BUSINESS_TIMEZONE,
          }).format(dueAt)
        : undefined;
      const copy = planReviewReminderCopy(reminderState, formattedDueDate, formattedBgDueDate);
      const reminderPayload = {
        dueDate: dueAt?.toISOString(),
        reminderState,
        reviewCode: latest?.review_code,
      };
      let notifiedCount = 0;
      for (const recipient of recipients.rows) {
        const idempotencyKey = `backup-plan-review-reminder:${eventKey}:${recipient.account_id}`;
        const inserted = await client.query(
          `INSERT INTO notifications.messages (
             recipient_account_id,channel,template_key,template_version,payload,idempotency_key,status
           ) VALUES ($1,'in_system','backup.plan-review.due',1,$2,$3,'pending')
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [recipient.account_id, reminderPayload, idempotencyKey],
        );
        if (inserted.rowCount) notifiedCount += 1;
        const email = await queueEmailMessage(client, {
          idempotencyKey,
          recipient: recipient.email,
          subject: copy.subject,
          text: copy.text,
        });
        if (email.created) notifiedCount += 1;
      }
      if (this.environment.SMS_PROVIDER === 'twilio') {
        const smsRecipients = this.environment.BACKUP_ALERT_SMS_RECIPIENTS.split(',')
          .map((recipient) => recipient.trim())
          .filter(Boolean);
        for (const recipient of smsRecipients) {
          const inserted = await client.query(
            `INSERT INTO notifications.messages (
               channel,template_key,template_version,payload,idempotency_key,status
             ) VALUES ('sms','backup.alert.sms',1,$1,$2,'pending')
             ON CONFLICT (idempotency_key) DO NOTHING`,
            [
              { body: copy.sms, to: recipient },
              `backup-plan-review-reminder:sms:${eventKey}:${createHash('sha256').update(recipient).digest('hex').slice(0, 32)}`,
            ],
          );
          if (inserted.rowCount) notifiedCount += 1;
        }
      }
      await client.query('COMMIT');
      return { dueCount: 1, notifiedCount };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async enforceRetention(context: BackgroundJobContext): Promise<{
    deletedArtifactCount: number;
    processedCount: number;
  }> {
    let deletedArtifactCount = 0;
    let processedCount = 0;
    while (true) {
      const client = await this.database.getPool().connect();
      try {
        await client.query('BEGIN');
        const lock = await client.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_xact_lock(hashtextextended('backup.retention.enforce', 0)) AS locked",
        );
        if (!lock.rows[0]?.locked) {
          await client.query('COMMIT');
          return { deletedArtifactCount, processedCount };
        }
        const candidates = await client.query<RetentionCandidate>(
          `WITH ranked AS (
             SELECT run.id,run.artifact_key,run.attempt_count,run.policy_id,
               run.scheduled_for,policy.policy_code,policy.frequency,
               policy.retention_daily_copies,policy.retention_monthly_copies,
               row_number() OVER (
                 PARTITION BY run.policy_id,(run.scheduled_for AT TIME ZONE $1)::date
                 ORDER BY run.scheduled_for DESC,run.id DESC
               ) AS day_copy_rank,
               dense_rank() OVER (
                 PARTITION BY run.policy_id
                 ORDER BY (run.scheduled_for AT TIME ZONE $1)::date DESC
               ) AS day_age_rank,
               row_number() OVER (
                 PARTITION BY run.policy_id,date_trunc('month',run.scheduled_for AT TIME ZONE $1)
                 ORDER BY run.scheduled_for DESC,run.id DESC
               ) AS month_copy_rank,
               dense_rank() OVER (
                 PARTITION BY run.policy_id
                 ORDER BY date_trunc('month',run.scheduled_for AT TIME ZONE $1) DESC
               ) AS month_age_rank
             FROM backup.execution_runs run
             JOIN backup.policies policy ON policy.id=run.policy_id
             WHERE run.status='verified' AND run.verification_status='verified'
               AND run.artifact_key IS NOT NULL AND run.artifact_deleted_at IS NULL
               AND policy.status IN ('active','paused')
           ), expired AS (
             SELECT ranked.* FROM ranked
             WHERE NOT (
               (day_copy_rank=1 AND day_age_rank<=retention_daily_copies)
               OR (month_copy_rank=1 AND month_age_rank<=retention_monthly_copies)
               OR (frequency='hourly' AND scheduled_for >= now()-interval '24 hours')
             )
           )
           SELECT run.id,run.artifact_key,run.attempt_count,run.scheduled_for,
               expired.policy_code,expired.retention_daily_copies,
               expired.retention_monthly_copies,
               approval.id AS policy_approval_request_id,
               approval.requested_by AS policy_requested_by,
               decision.approver_account_id AS policy_approved_by
           FROM backup.execution_runs run
           JOIN expired ON expired.id=run.id
           JOIN LATERAL (
             SELECT request.id,request.requested_by
             FROM backup.approval_requests request
             WHERE request.critical_action IN ('modify_policy','reduce_retention')
               AND request.target_type='backup_policy'
               AND request.target_id=run.policy_id AND request.status='approved'
             ORDER BY request.requested_at DESC,request.id DESC LIMIT 1
           ) approval ON true
           JOIN backup.approvals decision
             ON decision.request_id=approval.id AND decision.decision='approve'
           WHERE NOT EXISTS (
             SELECT 1 FROM backup.restore_requests restore
             WHERE restore.execution_run_id=run.id
               AND restore.status IN ('pending_approval','approved','running','failed')
           )
           AND NOT EXISTS (
             SELECT 1 FROM backup.execution_runs child
             WHERE child.parent_run_id=run.id
               AND child.status IN ('running','stored','verified')
               AND child.artifact_deleted_at IS NULL
           )
           AND NOT EXISTS (
             SELECT 1 FROM backup.artifact_deletion_requests deletion
             WHERE deletion.execution_run_id=run.id
               AND deletion.status IN ('pending_approval','approved','running')
           )
           ORDER BY run.scheduled_for,run.id
           LIMIT $2
           FOR UPDATE OF run SKIP LOCKED`,
          [this.environment.BUSINESS_TIMEZONE, retentionBatchSize],
        );

        for (const candidate of candidates.rows) {
          await this.storage.deleteBackupObject(candidate.artifact_key);
          const updated = await client.query(
            `UPDATE backup.execution_runs
             SET artifact_deleted_at=now(),artifact_deleted_reason='approved_retention_policy',updated_at=now()
             WHERE id=$1 AND artifact_deleted_at IS NULL AND status='verified'`,
            [candidate.id],
          );
          if (updated.rowCount !== 1) {
            throw new Error('BACKUP_RETENTION_RECORD_CHANGED');
          }
          const details = {
            approvalRequestId: candidate.policy_approval_request_id,
            approvedBy: candidate.policy_approved_by,
            dailyCopies: candidate.retention_daily_copies,
            policyCode: candidate.policy_code,
            requestedBy: candidate.policy_requested_by,
            retentionRule: 'approved_retention_policy',
            scheduledFor: asDate(candidate.scheduled_for).toISOString(),
            monthlyCopies: candidate.retention_monthly_copies,
          };
          await appendRunEvent(
            client,
            candidate.id,
            'retention_expired',
            candidate.attempt_count,
            details,
          );
          await this.audit.append(
            {
              action: 'backup.run.retention_expired',
              correlationId: context.correlationId,
              metadata: details,
              targetId: candidate.id,
              targetType: 'backup_execution_run',
            },
            client,
          );
          deletedArtifactCount += 1;
        }
        await client.query('COMMIT');
        processedCount += candidates.rows.length;
        if (candidates.rows.length < retentionBatchSize) {
          return { deletedArtifactCount, processedCount };
        }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
  }

  async dispatchApprovedArtifactDeletions(context: BackgroundJobContext): Promise<{
    completedCount: number;
    failedCount: number;
    processedCount: number;
    retryScheduledCount: number;
  }> {
    const client = await this.database.getPool().connect();
    let candidates: ArtifactDeletionCandidate[];
    try {
      await client.query('BEGIN');
      const result = await client.query<ArtifactDeletionCandidate>(
        `SELECT request.id,request.status,request.target_sha256,request.attempt_count,
            request.approval_request_id,request.requested_by,
            request.lease_expires_at<=now() AS lease_expired,
            run.id AS run_id,run.artifact_key,run.artifact_sha256,run.artifact_deleted_at,
            run.status AS run_status,run.verification_status,run.scheduled_for,
            policy.policy_code
         FROM backup.artifact_deletion_requests request
         JOIN backup.approval_requests approval ON approval.id=request.approval_request_id
         JOIN backup.execution_runs run ON run.id=request.execution_run_id
         JOIN backup.policies policy ON policy.id=run.policy_id
         WHERE approval.status='approved'
           AND NOT EXISTS (
             SELECT 1 FROM backup.execution_runs child
             WHERE child.parent_run_id=run.id
               AND child.status IN ('running','stored','verified')
               AND child.artifact_deleted_at IS NULL
           )
           AND NOT EXISTS (
             SELECT 1 FROM backup.restore_requests restore
             WHERE restore.execution_run_id=run.id
               AND restore.status IN ('pending_approval','approved','running')
           )
           AND (
             request.status='approved'
             OR (request.status='failed' AND request.attempt_count<5)
             OR (request.status='running' AND request.lease_expires_at<=now())
           )
         ORDER BY request.created_at,request.id
         LIMIT 25
         FOR UPDATE OF request,approval,run SKIP LOCKED`,
      );
      candidates = result.rows;
      const claimed: ArtifactDeletionCandidate[] = [];
      for (const candidate of candidates) {
        const sourceMatches =
          candidate.run_status === 'verified' &&
          candidate.verification_status === 'verified' &&
          !candidate.artifact_deleted_at &&
          Boolean(candidate.artifact_key) &&
          candidate.artifact_sha256?.toLowerCase() === candidate.target_sha256;
        if (!sourceMatches) {
          await client.query(
            `UPDATE backup.artifact_deletion_requests
             SET status='expired',lease_expires_at=NULL,error_code='BACKUP_RESTORE_POINT_CHANGED',updated_at=now()
             WHERE id=$1 AND status IN ('approved','failed','running')`,
            [candidate.id],
          );
          await client.query(`UPDATE backup.approval_requests SET status='expired' WHERE id=$1`, [
            candidate.approval_request_id,
          ]);
          await client.query(
            `INSERT INTO backup.artifact_deletion_events(request_id,event_type,details)
             VALUES($1,'expired',$2)`,
            [candidate.id, { reason: 'restore_point_changed' }],
          );
          await this.audit.append(
            {
              action: 'backup.artifact_deletion.expired',
              actorAccountId: candidate.requested_by,
              correlationId: `backup-artifact-deletion-expired:${candidate.id}`,
              targetId: candidate.id,
              targetType: 'backup_artifact_deletion_request',
            },
            client,
          );
          continue;
        }
        if (candidate.status === 'running' && candidate.attempt_count >= 5) {
          await client.query(
            `UPDATE backup.artifact_deletion_requests
             SET status='failed',lease_expires_at=NULL,error_code='BACKUP_ARTIFACT_DELETION_RETRIES_EXHAUSTED',updated_at=now()
             WHERE id=$1 AND status='running'`,
            [candidate.id],
          );
          await client.query(
            `INSERT INTO backup.artifact_deletion_events(request_id,event_type,details)
             VALUES($1,'failed',$2)`,
            [
              candidate.id,
              {
                attempt: candidate.attempt_count,
                errorCode: 'BACKUP_ARTIFACT_DELETION_RETRIES_EXHAUSTED',
              },
            ],
          );
          await this.audit.append(
            {
              action: 'backup.artifact_deletion.failed',
              actorAccountId: candidate.requested_by,
              correlationId: context.correlationId,
              metadata: {
                approvalRequestId: candidate.approval_request_id,
                errorCode: 'BACKUP_ARTIFACT_DELETION_RETRIES_EXHAUSTED',
                runId: candidate.run_id,
              },
              targetId: candidate.id,
              targetType: 'backup_artifact_deletion_request',
            },
            client,
          );
          continue;
        }
        await client.query(
          `UPDATE backup.artifact_deletion_requests
           SET status='running',attempt_count=attempt_count+1,
               lease_expires_at=now()+interval '10 minutes',error_code=NULL,updated_at=now()
           WHERE id=$1 AND status IN ('approved','failed','running')`,
          [candidate.id],
        );
        await client.query(
          `INSERT INTO backup.artifact_deletion_events(request_id,event_type,details)
           VALUES($1,'started',$2)`,
          [candidate.id, { attempt: candidate.attempt_count + 1, runId: candidate.run_id }],
        );
        claimed.push(candidate);
      }
      await client.query('COMMIT');
      candidates = claimed;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    let completedCount = 0;
    let failedCount = 0;
    let retryScheduledCount = 0;
    for (const candidate of candidates) {
      let objectDeleteConfirmed = false;
      try {
        const artifactKey = candidate.artifact_key;
        if (!artifactKey) throw new Error('BACKUP_RESTORE_POINT_CHANGED');
        // S3 DeleteObject is idempotent: a retry after a worker interruption is safe.
        await this.storage.deleteBackupObject(artifactKey);
        objectDeleteConfirmed = true;
        const commit = await this.database.getPool().connect();
        try {
          await commit.query('BEGIN');
          const locked = await commit.query<{
            approval_status: string;
            artifact_deleted_at: Date | string | null;
            artifact_key: string | null;
            artifact_sha256: string | null;
            request_status: string;
          }>(
            `SELECT request.status AS request_status,approval.status AS approval_status,
                run.artifact_deleted_at,run.artifact_key,run.artifact_sha256
             FROM backup.artifact_deletion_requests request
             JOIN backup.approval_requests approval ON approval.id=request.approval_request_id
             JOIN backup.execution_runs run ON run.id=request.execution_run_id
             WHERE request.id=$1
             FOR UPDATE OF request,approval,run`,
            [candidate.id],
          );
          const state = locked.rows[0];
          if (
            !state ||
            state.request_status !== 'running' ||
            state.approval_status !== 'approved' ||
            state.artifact_key !== artifactKey ||
            state.artifact_sha256?.toLowerCase() !== candidate.target_sha256
          ) {
            throw new Error('BACKUP_RESTORE_POINT_CHANGED');
          }
          if (state.artifact_deleted_at) {
            // Another approved retention action may have removed the same object while this
            // worker was between the object-store delete and the database commit.
            await commit.query(
              `UPDATE backup.artifact_deletion_requests
               SET status='expired',lease_expires_at=NULL,error_code='BACKUP_RESTORE_POINT_CHANGED',updated_at=now()
               WHERE id=$1`,
              [candidate.id],
            );
            await commit.query(`UPDATE backup.approval_requests SET status='expired' WHERE id=$1`, [
              candidate.approval_request_id,
            ]);
            await commit.query(
              `INSERT INTO backup.artifact_deletion_events(request_id,event_type,details)
               VALUES($1,'expired',$2)`,
              [candidate.id, { reason: 'restore_point_already_removed' }],
            );
            await commit.query('COMMIT');
            continue;
          }
          const updatedRun = await commit.query(
            `UPDATE backup.execution_runs
             SET artifact_deleted_at=now(),artifact_deleted_reason='approved_restore_point_deletion',updated_at=now()
             WHERE id=$1 AND artifact_deleted_at IS NULL AND status='verified'
               AND verification_status='verified' AND artifact_sha256=$2`,
            [candidate.run_id, candidate.target_sha256],
          );
          if (updatedRun.rowCount !== 1) throw new Error('BACKUP_RESTORE_POINT_CHANGED');
          await commit.query(
            `UPDATE backup.artifact_deletion_requests
             SET status='completed',completed_at=now(),lease_expires_at=NULL,updated_at=now()
             WHERE id=$1 AND status='running'`,
            [candidate.id],
          );
          await commit.query(`UPDATE backup.approval_requests SET status='executed' WHERE id=$1`, [
            candidate.approval_request_id,
          ]);
          await commit.query(
            `INSERT INTO backup.artifact_deletion_events(request_id,event_type,details)
             VALUES($1,'completed',$2)`,
            [candidate.id, { runId: candidate.run_id, targetSha256: candidate.target_sha256 }],
          );
          await this.audit.append(
            {
              action: 'backup.artifact_deletion.completed',
              actorAccountId: candidate.requested_by,
              after: {
                artifactDeletedReason: 'approved_restore_point_deletion',
                policyCode: candidate.policy_code,
                runId: candidate.run_id,
                scheduledFor: asDate(candidate.scheduled_for).toISOString(),
                targetSha256: candidate.target_sha256,
              },
              correlationId: context.correlationId,
              metadata: {
                approvalRequestId: candidate.approval_request_id,
                attemptedBy: 'backup-worker',
              },
              targetId: candidate.run_id,
              targetType: 'backup_execution_run',
            },
            commit,
          );
          await commit.query('COMMIT');
          completedCount += 1;
        } catch (error) {
          await commit.query('ROLLBACK').catch(() => undefined);
          throw error;
        } finally {
          commit.release();
        }
      } catch (error) {
        const failureCode = artifactDeletionErrorCode(error);
        const failure = await this.database.getPool().connect();
        try {
          await failure.query('BEGIN');
          if (objectDeleteConfirmed) {
            const rescheduled = await failure.query(
              `UPDATE backup.artifact_deletion_requests
               SET error_code='BACKUP_ARTIFACT_DELETION_COMMIT_PENDING',
                   lease_expires_at=now()+interval '2 minutes',updated_at=now()
               WHERE id=$1 AND status='running'`,
              [candidate.id],
            );
            if (rescheduled.rowCount === 1) {
              await failure.query(
                `INSERT INTO backup.artifact_deletion_events(request_id,event_type,details)
                 VALUES($1,'retry_scheduled',$2)`,
                [candidate.id, { attempt: candidate.attempt_count + 1, errorCode: failureCode }],
              );
              await this.audit.append(
                {
                  action: 'backup.artifact_deletion.retry_scheduled',
                  actorAccountId: candidate.requested_by,
                  correlationId: context.correlationId,
                  metadata: {
                    approvalRequestId: candidate.approval_request_id,
                    attempt: candidate.attempt_count + 1,
                    errorCode: failureCode,
                    runId: candidate.run_id,
                  },
                  targetId: candidate.id,
                  targetType: 'backup_artifact_deletion_request',
                },
                failure,
              );
              retryScheduledCount += 1;
            }
          } else {
            const marked = await failure.query(
              `UPDATE backup.artifact_deletion_requests
               SET status='failed',error_code=$2,lease_expires_at=NULL,updated_at=now()
               WHERE id=$1 AND status='running'`,
              [candidate.id, failureCode],
            );
            if (marked.rowCount === 1) {
              await failure.query(
                `INSERT INTO backup.artifact_deletion_events(request_id,event_type,details)
               VALUES($1,'failed',$2)`,
                [candidate.id, { attempt: candidate.attempt_count + 1, errorCode: failureCode }],
              );
              await this.audit.append(
                {
                  action: 'backup.artifact_deletion.failed',
                  actorAccountId: candidate.requested_by,
                  correlationId: context.correlationId,
                  metadata: {
                    approvalRequestId: candidate.approval_request_id,
                    errorCode: failureCode,
                    runId: candidate.run_id,
                  },
                  targetId: candidate.id,
                  targetType: 'backup_artifact_deletion_request',
                },
                failure,
              );
            }
            if (marked.rowCount === 1) failedCount += 1;
          }
          await failure.query('COMMIT');
        } catch (markError) {
          await failure.query('ROLLBACK').catch(() => undefined);
          throw markError;
        } finally {
          failure.release();
        }
      }
    }
    return {
      completedCount,
      failedCount,
      processedCount: candidates.length,
      retryScheduledCount,
    };
  }

  async execute(context: BackgroundJobContext): Promise<Record<string, unknown>> {
    const policyId = requiredPayloadString(context, 'policyId');
    const scheduledFor = parseScheduledFor(context);
    const claim = await this.claimExecution(policyId, scheduledFor, context);
    if (claim.run.status === 'verified') {
      await this.releaseLock(claim.client, context.idempotencyKey);
      return { runId: claim.run.id, status: 'verified' };
    }
    if (claim.run.status === 'stored') {
      await this.releaseLock(claim.client, context.idempotencyKey);
      await this.enqueueVerification(claim.run, context);
      return { runId: claim.run.id, status: 'stored' };
    }

    let uploadId: string | undefined;
    let stored = false;
    let lockReleased = false;
    let objectStorageSource: ObjectStorageBackupSourceHandle | undefined;
    let emailSource: ReturnType<typeof resolveEmailImapBackupSource> | undefined;
    let webDavSource: ReturnType<typeof resolveWebDavBackupSource> | undefined;
    let parts: Array<{ ETag: string; PartNumber: number }>;
    const artifactKey =
      claim.run.source_type === 'database'
        ? `database/${claim.run.policy_code}/${claim.run.id}.dump.enc`
        : claim.run.source_type === 'email'
          ? `email/${claim.run.policy_code}/${claim.run.id}.archive.enc`
          : claim.run.source_type === 'cloud_service'
            ? `cloud-service/${claim.run.policy_code}/${claim.run.id}.archive.enc`
            : claim.run.source_type === 'object_storage'
              ? `object-storage/${claim.run.policy_code}/${claim.run.id}.archive.enc`
              : `file-share/${claim.run.policy_code}/${claim.run.id}.archive.enc`;
    try {
      const key = parseEncryptionKey(this.environment.BACKUP_ENCRYPTION_KEY);
      if (claim.run.source_type === 'object_storage') {
        const sourceSnapshot = objectStorageBackupSourceSnapshot(
          claim.run.source_code_snapshot,
          claim.run.source_location_snapshot,
          this.environment,
          this.storage.bucketName(),
          claim.run.legacy_managed_source,
        );
        if (
          !claim.run.source_identity_snapshot ||
          claim.run.source_identity_snapshot.trim() !== sourceSnapshot.identity ||
          claim.run.source_bucket_snapshot !== sourceSnapshot.bucket
        ) {
          throw new Error('BACKUP_OBJECT_STORAGE_SOURCE_CHANGED');
        }
        objectStorageSource = resolveObjectStorageBackupSource(
          claim.run.source_code_snapshot,
          claim.run.source_location_snapshot,
          this.environment,
          this.storage,
          claim.run.legacy_managed_source,
        );
      } else if (claim.run.source_type === 'email') {
        const sourceSnapshot = emailImapBackupSourceSnapshot(
          claim.run.source_code_snapshot,
          claim.run.source_location_snapshot,
          this.environment,
        );
        if (
          !claim.run.source_identity_snapshot ||
          claim.run.source_identity_snapshot.trim() !== sourceSnapshot.identity ||
          claim.run.source_bucket_snapshot !== sourceSnapshot.namespace
        ) {
          throw new Error('BACKUP_EMAIL_SOURCE_CHANGED');
        }
        emailSource = resolveEmailImapBackupSource(
          claim.run.source_code_snapshot,
          claim.run.source_location_snapshot,
          this.environment,
        );
      } else if (claim.run.source_type === 'cloud_service') {
        const sourceSnapshot = webDavBackupSourceSnapshot(
          claim.run.source_code_snapshot,
          claim.run.source_location_snapshot,
          this.environment,
        );
        if (
          !claim.run.source_identity_snapshot ||
          claim.run.source_identity_snapshot.trim() !== sourceSnapshot.identity ||
          claim.run.source_bucket_snapshot !== sourceSnapshot.namespace
        ) {
          throw new Error('BACKUP_WEBDAV_SOURCE_CHANGED');
        }
        webDavSource = resolveWebDavBackupSource(
          claim.run.source_code_snapshot,
          claim.run.source_location_snapshot,
          this.environment,
        );
      }
      if (claim.run.backup_type === 'system_image') {
        await this.fileShareArchive.assertSystemImageAvailable(
          this.environment.BACKUP_FILE_SOURCE_ROOT,
          requiredSnapshotValue(claim.run.source_location_snapshot),
        );
      }
      uploadId = await this.storage.createBackupUpload(artifactKey);
      const dump =
        claim.run.source_type === 'database'
          ? this.dumpRunner.open(
              backupDatabaseSourceUrl(claim.run.source_code_snapshot, this.environment),
              {
                compressionEnabled: claim.run.compression_algorithm !== 'none',
              },
            )
          : undefined;
      const sourceStream =
        dump?.stdout ??
        (claim.run.source_type === 'object_storage' ||
        claim.run.source_type === 'email' ||
        claim.run.source_type === 'cloud_service'
          ? this.objectStorageArchive.open(
              claim.run.source_type === 'email'
                ? (emailSource?.source ?? this.storage)
                : claim.run.source_type === 'cloud_service'
                  ? (webDavSource?.source ?? this.storage)
                  : (objectStorageSource?.source ?? this.storage),
              {
                backupType: objectStorageBackupMode(claim.run.backup_type),
                ...(claim.run.backup_type === 'full'
                  ? {}
                  : {
                      baseline: this.objectStorageArchive.manifestFromValue(
                        claim.run.parent_source_manifest,
                        claim.run.source_type === 'email'
                          ? (emailSource?.source.bucketName() ?? this.storage.bucketName())
                          : claim.run.source_type === 'cloud_service'
                            ? (webDavSource?.source.bucketName() ?? this.storage.bucketName())
                            : (objectStorageSource?.source.bucketName() ??
                              this.storage.bucketName()),
                      ),
                    }),
              },
            )
          : this.fileShareArchive.open(
              this.environment.BACKUP_FILE_SOURCE_ROOT,
              requiredSnapshotValue(claim.run.source_code_snapshot),
              requiredSnapshotValue(claim.run.source_location_snapshot),
              {
                backupType: fileShareBackupMode(claim.run.backup_type),
                ...(claim.run.backup_type === 'full' || claim.run.backup_type === 'system_image'
                  ? {}
                  : {
                      baseline: this.fileShareArchive.manifestFromValue(
                        claim.run.parent_source_manifest,
                        requiredSnapshotValue(claim.run.source_code_snapshot),
                        requiredSnapshotValue(claim.run.source_location_snapshot),
                      ),
                    }),
              },
            ));
      const compressor = createBackupCompressor(claim.run.compression_algorithm);
      let uncompressedSizeBytes = 0;
      const sourceSize = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          uncompressedSizeBytes += chunk.length;
          callback(null, chunk);
        },
      });
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const hash = createHash('sha256');
      let artifactSizeBytes = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          artifactSizeBytes += chunk.length;
          callback(null, chunk);
        },
      });
      try {
        const encrypted = compressor
          ? pipeline(sourceStream, sourceSize, compressor, cipher, meter)
          : pipeline(sourceStream, sourceSize, cipher, meter);
        const uploaded = this.uploadStream(meter, artifactKey, uploadId);
        parts = await Promise.all([encrypted, uploaded, dump?.completed ?? Promise.resolve()]).then(
          (values) => values[1],
        );
      } catch (error) {
        dump?.cancel();
        throw error;
      }
      const encryptionTag = cipher.getAuthTag();
      const artifactSha256 = hash.digest('hex');
      await this.storage.completeBackupUpload({
        key: artifactKey,
        parts,
        uploadId,
      });
      uploadId = undefined;
      await this.markStored(claim, context, {
        artifactKey,
        artifactSha256,
        artifactSizeBytes,
        uncompressedSizeBytes:
          claim.run.compression_algorithm === 'postgres_custom' ? null : uncompressedSizeBytes,
        encryptionNonce: nonce.toString('hex'),
        encryptionTag: encryptionTag.toString('hex'),
      });
      stored = true;
      await this.releaseLock(claim.client, context.idempotencyKey);
      lockReleased = true;
      await this.enqueueVerification(claim.run, context);
      return {
        artifactSizeBytes,
        compressionAlgorithm: claim.run.compression_algorithm,
        ...(claim.run.compression_algorithm === 'postgres_custom'
          ? {}
          : { uncompressedSizeBytes: String(uncompressedSizeBytes) }),
        runId: claim.run.id,
        status: 'stored',
      };
    } catch (error) {
      const failedUploadId = uploadId;
      if (failedUploadId) {
        await Promise.resolve()
          .then(() =>
            this.storage.abortBackupUpload({ key: artifactKey, uploadId: failedUploadId }),
          )
          .catch(() => undefined);
      }
      let failureToThrow = error;
      if (!stored) {
        try {
          await this.markExecutionFailed(claim, context, executionErrorCode(error));
        } catch (markError) {
          failureToThrow = new AggregateError(
            [error, markError],
            'Backup execution failed and its final status could not be recorded.',
          );
        }
      }
      if (!lockReleased) {
        await this.releaseLock(claim.client, context.idempotencyKey);
      }
      throw failureToThrow;
    } finally {
      objectStorageSource?.close();
      await emailSource?.source.close?.();
      await webDavSource?.source.close?.();
    }
  }

  async verify(context: BackgroundJobContext): Promise<Record<string, unknown>> {
    const runId = requiredPayloadString(context, 'runId');
    const lockKey = `backup-verify:${runId}`;
    const client = await this.database.getPool().connect();
    const locked = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
      [lockKey],
    );
    if (!locked.rows[0]?.locked) {
      client.release();
      throw new Error('BACKUP_VERIFICATION_BUSY');
    }
    let run: ClaimedRun;
    try {
      await client.query('BEGIN');
      const result = await client.query<ClaimedRun>(
        `SELECT run.*, policy.policy_code, policy.status AS policy_status
         FROM backup.execution_runs run
         JOIN backup.policies policy ON policy.id=run.policy_id
         WHERE run.id=$1 FOR UPDATE OF run`,
        [runId],
      );
      run = result.rows[0] as ClaimedRun;
      if (!run) throw new UnrecoverableError('Backup run was not found.');
      if (run.status === 'verified') {
        await client.query('COMMIT');
        await unlockAndRelease(client, lockKey);
        return { runId, status: 'verified' };
      }
      if (run.status !== 'stored' || !run.artifact_key) {
        throw new UnrecoverableError('Only a stored backup can be verified.');
      }
      run.verification_attempt_count += 1;
      await client.query(
        `UPDATE backup.execution_runs SET verification_status='running',
           verification_attempt_count=verification_attempt_count+1,updated_at=now()
         WHERE id=$1`,
        [runId],
      );
      await appendRunEvent(
        client,
        runId,
        'verification_started',
        run.verification_attempt_count,
        {},
      );
      await this.audit.append(
        {
          action: 'backup.run.verification_started',
          correlationId: context.correlationId,
          metadata: { attempt: run.verification_attempt_count },
          targetId: runId,
          targetType: 'backup_execution_run',
        },
        client,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      await unlockAndRelease(client, lockKey);
      throw error;
    }

    let verifiedSourceManifest: FileShareManifest | ObjectStorageBackupManifest | undefined;
    const directory = await createPrivateTempDirectory();
    const encryptedPath = join(directory, 'artifact.enc');
    const dumpPath = join(directory, 'database.dump');
    try {
      const key = parseEncryptionKey(this.environment.BACKUP_ENCRYPTION_KEY);
      const artifactHash = createHash('sha256');
      let bytes = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          artifactHash.update(chunk);
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
        artifactHash.digest('hex') !== run.artifact_sha256?.trim() ||
        bytes !== Number(run.artifact_size_bytes)
      ) {
        throw new Error('BACKUP_ARTIFACT_CHECKSUM_MISMATCH');
      }
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(run.encryption_nonce ?? '', 'hex'),
      );
      decipher.setAuthTag(Buffer.from(run.encryption_tag ?? '', 'hex'));
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
        await this.dumpRunner.validateArchive(dumpPath, run.database_engine ?? 'postgresql');
      } else if (
        run.source_type === 'object_storage' ||
        run.source_type === 'email' ||
        run.source_type === 'cloud_service'
      ) {
        verifiedSourceManifest = await this.objectStorageArchive.validateFile(
          dumpPath,
          run.source_bucket_snapshot ?? this.storage.bucketName(),
        );
      } else {
        verifiedSourceManifest = await this.fileShareArchive.validateFile(
          dumpPath,
          requiredSnapshotValue(run.source_code_snapshot),
          requiredSnapshotValue(run.source_location_snapshot),
        );
      }
      if (this.environment.BACKUP_REPLICA_REQUIRED && !this.storage.independentCopyConfigured()) {
        throw new Error('BACKUP_REPLICA_NOT_CONFIGURED');
      }
      if (this.storage.independentCopyConfigured()) {
        await this.markIndependentCopyStarted(run, context);
        await this.storage.copyBackupObjectToIndependentStore({
          expectedSha256: run.artifact_sha256?.trim() ?? '',
          expectedSizeBytes: Number(run.artifact_size_bytes),
          key: run.artifact_key,
        });
        await this.markIndependentCopyVerified(run, context);
        run.independent_copy_status = 'verified';
        run.independent_copy_target_code = this.storage.independentCopyTargetCode();
      }
      await this.markVerified(run, context, verifiedSourceManifest);
      await unlockAndRelease(client, lockKey);
      return { runId, status: 'verified' };
    } catch (error) {
      try {
        await this.markVerificationFailed(run, context, executionErrorCode(error));
      } finally {
        await unlockAndRelease(client, lockKey);
      }
      throw error;
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }

  private async claimExecution(
    policyId: string,
    scheduledFor: Date,
    context: BackgroundJobContext,
  ): Promise<{ client: PoolClient; run: ClaimedRun }> {
    const client = await this.database.getPool().connect();
    const lock = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
      [context.idempotencyKey],
    );
    if (!lock.rows[0]?.locked) {
      client.release();
      throw new Error('BACKUP_RUN_BUSY');
    }
    try {
      await client.query('BEGIN');
      const prior = await client.query<ClaimedRun>(
        `SELECT run.*,policy.policy_code,policy.status AS policy_status,
           EXISTS(SELECT 1 FROM backup.legacy_managed_object_sources legacy
             WHERE legacy.source_id=run.source_id
               AND legacy.source_code_snapshot=run.source_code_snapshot) AS legacy_managed_source
         FROM backup.execution_runs run JOIN backup.policies policy ON policy.id=run.policy_id
         WHERE run.idempotency_key=$1 FOR UPDATE OF run`,
        [context.idempotencyKey],
      );
      const priorRun = prior.rows[0];
      if (
        priorRun &&
        (priorRun.policy_id !== policyId ||
          new Date(priorRun.scheduled_for).getTime() !== scheduledFor.getTime())
      ) {
        throw new UnrecoverableError('This backup request belongs to a different schedule slot.');
      }
      if (priorRun && ['stored', 'verified'].includes(priorRun.status)) {
        await client.query('COMMIT');
        return { client, run: priorRun };
      }
      const policy = await client.query<{
        backup_type: string;
        policy_code: string;
        source_code: string | null;
        source_id: string | null;
        source_location: string | null;
        source_type:
          'cloud_service' | 'database' | 'email' | 'file' | 'file_share' | 'object_storage' | null;
        status: string;
        source_count: number;
        database_source_count: number;
        email_source_count: number;
        cloud_service_source_count: number;
        file_source_count: number;
        file_share_source_count: number;
        object_storage_source_count: number;
        legacy_managed_source: boolean;
        compression_enabled: boolean;
      }>(
        `SELECT policy.backup_type,policy.policy_code,policy.status,policy.compression_enabled,
           count(source.id)::integer AS source_count,
           count(source.id) FILTER (WHERE source.source_type='database'
             AND source.status='active')::integer AS database_source_count,
           count(source.id) FILTER (WHERE source.source_type='object_storage'
             AND source.status='active')::integer AS object_storage_source_count,
           count(source.id) FILTER (WHERE source.source_type='email'
             AND source.status='active')::integer AS email_source_count,
           count(source.id) FILTER (WHERE source.source_type='cloud_service'
             AND source.status='active')::integer AS cloud_service_source_count,
           count(source.id) FILTER (WHERE source.source_type='file'
             AND source.status='active')::integer AS file_source_count,
           count(source.id) FILTER (WHERE source.source_type IN
             ('file_share','server','workstation','mobile_device','other')
             AND source.status='active')::integer AS file_share_source_count,
           min(CASE WHEN source.source_type IN ('server','workstation','mobile_device','other')
             THEN 'file_share' ELSE source.source_type END)
             FILTER (WHERE source.status='active') AS source_type,
           min(source.id::text) FILTER (WHERE source.status='active') AS source_id,
           min(source.source_code) FILTER (WHERE source.status='active') AS source_code,
           min(source.location) FILTER (WHERE source.status='active') AS source_location,
           coalesce(bool_or(legacy.source_id IS NOT NULL AND source.source_type='object_storage'),false)
             AS legacy_managed_source
         FROM backup.policies policy
         LEFT JOIN backup.policy_sources link ON link.policy_id=policy.id
         LEFT JOIN backup.protected_sources source ON source.id=link.source_id
         LEFT JOIN backup.legacy_managed_object_sources legacy ON legacy.source_id=source.id
           AND legacy.source_code_snapshot=source.source_code
         WHERE policy.id=$1
         GROUP BY policy.id`,
        [policyId],
      );
      const policyRow = policy.rows[0];
      if (!policyRow) throw new UnrecoverableError('Backup policy was not found.');
      const sourceType = policyRow.source_type;
      if (policyRow.status !== 'active') {
        throw new UnrecoverableError('Only an approved active backup policy can run.');
      }
      if (
        Number(policyRow.source_count) !== 1 ||
        !sourceType ||
        !isSupportedRunSource(sourceType, policyRow.backup_type) ||
        (sourceType === 'database' && Number(policyRow.database_source_count) !== 1) ||
        (sourceType === 'object_storage' && Number(policyRow.object_storage_source_count) !== 1) ||
        (sourceType === 'email' && Number(policyRow.email_source_count) !== 1) ||
        (sourceType === 'cloud_service' && Number(policyRow.cloud_service_source_count) !== 1) ||
        (sourceType === 'file' && Number(policyRow.file_source_count) !== 1) ||
        (sourceType === 'file_share' && Number(policyRow.file_share_source_count) !== 1) ||
        ((sourceType === 'file' || sourceType === 'file_share') &&
          !this.environment.BACKUP_FILE_SOURCE_ROOT)
      ) {
        throw new UnrecoverableError(
          'This backup policy does not use one active protected source and backup mode supported by this release.',
        );
      }
      const sourceSnapshot =
        sourceType === 'object_storage'
          ? (() => {
              const snapshot = objectStorageBackupSourceSnapshot(
                policyRow.source_code,
                policyRow.source_location,
                this.environment,
                this.storage.bucketName(),
                policyRow.legacy_managed_source,
              );
              return { identity: snapshot.identity, archiveNamespace: snapshot.bucket };
            })()
          : sourceType === 'email'
            ? (() => {
                const snapshot = emailImapBackupSourceSnapshot(
                  policyRow.source_code,
                  policyRow.source_location,
                  this.environment,
                );
                return { identity: snapshot.identity, archiveNamespace: snapshot.namespace };
              })()
            : sourceType === 'cloud_service'
              ? (() => {
                  const snapshot = webDavBackupSourceSnapshot(
                    policyRow.source_code,
                    policyRow.source_location,
                    this.environment,
                  );
                  return { identity: snapshot.identity, archiveNamespace: snapshot.namespace };
                })()
              : undefined;
      const databaseSourceUrl =
        sourceType === 'database'
          ? backupDatabaseSourceUrl(policyRow.source_code, this.environment)
          : undefined;
      let effectiveBackupType = policyRow.backup_type;
      let parentRunId: string | null = null;
      if (
        ['cloud_service', 'email', 'file', 'file_share', 'object_storage'].includes(sourceType) &&
        ['incremental', 'differential'].includes(policyRow.backup_type)
      ) {
        const parent = await client.query<{ id: string }>(
          `SELECT id FROM backup.execution_runs
           WHERE policy_id=$1 AND source_id=$2 AND source_type=$3
             AND source_code_snapshot=$4 AND source_location_snapshot IS NOT DISTINCT FROM $5
             AND ($3 NOT IN ('object_storage','email','cloud_service') OR source_identity_snapshot=$7)
             AND status='verified' AND verification_status='verified'
             AND artifact_deleted_at IS NULL AND source_manifest IS NOT NULL
             AND ($3 NOT IN ('object_storage','email','cloud_service') OR source_manifest->>'format' IN (
               'vista-object-store-backup-v2','vista-object-store-backup-v3'
             ))
             AND backup_type IN ('full','incremental','differential')
             AND NOT EXISTS (
               SELECT 1 FROM backup.artifact_deletion_requests deletion
               WHERE deletion.execution_run_id=backup.execution_runs.id
                 AND deletion.status IN ('pending_approval','approved','running')
             )
             AND ($6 <> 'differential' OR backup_type='full')
           ORDER BY scheduled_for DESC,id DESC
           LIMIT 1 FOR SHARE`,
          [
            policyId,
            policyRow.source_id,
            sourceType,
            policyRow.source_code,
            policyRow.source_location,
            policyRow.backup_type,
            sourceSnapshot?.identity ?? null,
          ],
        );
        if (parent.rows[0]) parentRunId = parent.rows[0].id;
        else effectiveBackupType = 'full';
      }
      const inserted = await client.query(
        `INSERT INTO backup.execution_runs (
           policy_id,scheduled_for,idempotency_key,backup_type,parent_run_id,source_type,
           source_id,source_code_snapshot,source_location_snapshot,source_bucket_snapshot,
           source_identity_snapshot,database_engine,
           compression_algorithm,status,attempt_count
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'running',1) ON CONFLICT DO NOTHING`,
        [
          policyId,
          scheduledFor,
          context.idempotencyKey,
          effectiveBackupType,
          parentRunId,
          sourceType,
          policyRow.source_id,
          policyRow.source_code,
          policyRow.source_location,
          sourceSnapshot?.archiveNamespace ?? null,
          sourceSnapshot?.identity ?? null,
          databaseSourceUrl ? backupDatabaseEngine(databaseSourceUrl) : null,
          backupCompressionAlgorithm(sourceType, policyRow.compression_enabled, databaseSourceUrl),
        ],
      );
      const existing = await client.query<ClaimedRun>(
        `SELECT run.*,policy.policy_code,policy.status AS policy_status,
           EXISTS(SELECT 1 FROM backup.legacy_managed_object_sources legacy
             WHERE legacy.source_id=run.source_id
               AND legacy.source_code_snapshot=run.source_code_snapshot) AS legacy_managed_source
         FROM backup.execution_runs run JOIN backup.policies policy ON policy.id=run.policy_id
         WHERE run.idempotency_key=$1 OR (run.policy_id=$2 AND run.scheduled_for=$3)
         ORDER BY (run.idempotency_key=$1) DESC LIMIT 1 FOR UPDATE OF run`,
        [context.idempotencyKey, policyId, scheduledFor],
      );
      const run = existing.rows[0];
      if (!run) throw new Error('Backup execution run could not be claimed');
      if (run.idempotency_key && run.idempotency_key !== context.idempotencyKey) {
        throw new UnrecoverableError(
          'A different backup run already owns this policy schedule slot.',
        );
      }
      if (
        run.policy_id !== policyId ||
        new Date(run.scheduled_for).getTime() !== scheduledFor.getTime()
      ) {
        throw new UnrecoverableError('This backup request belongs to a different schedule slot.');
      }
      if (run.parent_run_id) {
        const parentManifest = await client.query<{ source_manifest: unknown }>(
          `SELECT source_manifest FROM backup.execution_runs
           WHERE id=$1 AND policy_id=$2
             AND source_type IN ('cloud_service','email','file','file_share','object_storage')
             AND status='verified' AND verification_status='verified'
             AND artifact_deleted_at IS NULL
           FOR SHARE`,
          [run.parent_run_id, policyId],
        );
        const manifestValue = parentManifest.rows[0]?.source_manifest;
        if (!manifestValue) {
          throw new UnrecoverableError('The verified incremental backup base is unavailable.');
        }
        run.parent_source_manifest =
          run.source_type === 'object_storage' ||
          run.source_type === 'email' ||
          run.source_type === 'cloud_service'
            ? this.objectStorageArchive.manifestFromValue(
                manifestValue,
                run.source_bucket_snapshot ?? this.storage.bucketName(),
              )
            : this.fileShareArchive.manifestFromValue(
                manifestValue,
                requiredSnapshotValue(run.source_code_snapshot),
                requiredSnapshotValue(run.source_location_snapshot),
              );
      }
      if (run.status === 'failed' || run.status === 'running') {
        run.attempt_count = Number(run.attempt_count) + (inserted.rowCount === 1 ? 0 : 1);
        await client.query(
          `UPDATE backup.execution_runs SET status='running',attempt_count=$2,
             started_at=now(),error_code=NULL,updated_at=now() WHERE id=$1`,
          [run.id, run.attempt_count],
        );
        await appendRunEvent(client, run.id, 'started', run.attempt_count, {});
        await this.audit.append(
          {
            action: 'backup.run.started',
            correlationId: context.correlationId,
            metadata: { attempt: run.attempt_count, policyCode: run.policy_code },
            targetId: run.id,
            targetType: 'backup_execution_run',
          },
          client,
        );
      }
      await client.query('COMMIT');
      return { client, run };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      await unlockAndRelease(client, context.idempotencyKey);
      throw error;
    }
  }

  private async markStored(
    claim: { client: PoolClient; run: ClaimedRun },
    context: BackgroundJobContext,
    artifact: {
      artifactKey: string;
      artifactSha256: string;
      artifactSizeBytes: number;
      uncompressedSizeBytes: number | null;
      encryptionNonce: string;
      encryptionTag: string;
    },
  ): Promise<void> {
    const client = claim.client;
    await client.query('BEGIN');
    try {
      await client.query(
        `UPDATE backup.execution_runs SET status='stored',verification_status='pending',
           stored_at=now(),artifact_key=$2,artifact_sha256=$3,artifact_size_bytes=$4,
           uncompressed_size_bytes=$5,encryption_nonce=$6,encryption_tag=$7,
           independent_copy_status=$8,independent_copy_target_code=$9,
           independent_copy_verified_at=NULL,independent_copy_error_code=NULL,
           error_code=NULL,updated_at=now()
         WHERE id=$1 AND status='running'`,
        [
          claim.run.id,
          artifact.artifactKey,
          artifact.artifactSha256,
          artifact.artifactSizeBytes,
          artifact.uncompressedSizeBytes,
          artifact.encryptionNonce,
          artifact.encryptionTag,
          this.storage.independentCopyConfigured() || this.environment.BACKUP_REPLICA_REQUIRED
            ? 'pending'
            : 'not_configured',
          this.storage.independentCopyConfigured() || this.environment.BACKUP_REPLICA_REQUIRED
            ? this.storage.independentCopyTargetCode()
            : null,
        ],
      );
      await appendRunEvent(client, claim.run.id, 'stored', claim.run.attempt_count, {
        artifactSha256: artifact.artifactSha256,
        artifactSizeBytes: artifact.artifactSizeBytes,
        compressionAlgorithm: claim.run.compression_algorithm,
        uncompressedSizeBytes: artifact.uncompressedSizeBytes,
      });
      await this.audit.append(
        {
          action: 'backup.run.stored',
          correlationId: context.correlationId,
          metadata: {
            artifactSha256: artifact.artifactSha256,
            artifactSizeBytes: artifact.artifactSizeBytes,
            compressionAlgorithm: claim.run.compression_algorithm,
            uncompressedSizeBytes: artifact.uncompressedSizeBytes,
            policyCode: claim.run.policy_code,
          },
          targetId: claim.run.id,
          targetType: 'backup_execution_run',
        },
        client,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  private async markExecutionFailed(
    claim: { client: PoolClient; run: ClaimedRun },
    context: BackgroundJobContext,
    errorCode: string,
  ): Promise<void> {
    const client = claim.client;
    await client.query('BEGIN');
    try {
      await client.query(
        `UPDATE backup.execution_runs SET status='failed',error_code=$2,updated_at=now()
         WHERE id=$1 AND status='running'`,
        [claim.run.id, errorCode],
      );
      await appendRunEvent(client, claim.run.id, 'execution_failed', claim.run.attempt_count, {
        errorCode,
      });
      await this.audit.append(
        {
          action: 'backup.run.execution_failed',
          correlationId: context.correlationId,
          metadata: { attempt: claim.run.attempt_count, errorCode },
          targetId: claim.run.id,
          targetType: 'backup_execution_run',
        },
        client,
      );
      if (!context.retryAllowed) {
        await this.queueBackupAlerts(client, {
          eventId: `${claim.run.id}:execution-failed`,
          kind: 'failed',
          policyCode: claim.run.policy_code,
          scheduledFor: asDate(claim.run.scheduled_for),
        });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }

  private async markVerified(
    run: ClaimedRun,
    context: BackgroundJobContext,
    sourceManifest?: FileShareManifest | ObjectStorageBackupManifest,
  ): Promise<void> {
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE backup.execution_runs SET status='verified',verification_status='verified',
           verified_at=now(),source_manifest=COALESCE($2::jsonb,source_manifest),
           error_code=NULL,updated_at=now()
         WHERE id=$1 AND status='stored'`,
        [run.id, sourceManifest ? JSON.stringify(sourceManifest) : null],
      );
      await appendRunEvent(client, run.id, 'verified', run.verification_attempt_count, {
        artifactSha256: run.artifact_sha256,
      });
      await this.audit.append(
        {
          action: 'backup.run.verified',
          correlationId: context.correlationId,
          metadata: { artifactSha256: run.artifact_sha256, policyCode: run.policy_code },
          targetId: run.id,
          targetType: 'backup_execution_run',
        },
        client,
      );
      await this.queueBackupAlerts(client, {
        eventId: `${run.id}:verified`,
        kind: 'verified',
        policyCode: run.policy_code,
        scheduledFor: asDate(run.scheduled_for),
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async markIndependentCopyStarted(
    run: ClaimedRun,
    context: BackgroundJobContext,
  ): Promise<void> {
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE backup.execution_runs
         SET independent_copy_status='running',independent_copy_target_code=$2,
             independent_copy_verified_at=NULL,independent_copy_error_code=NULL,updated_at=now()
         WHERE id=$1 AND status='stored' AND verification_status='running'
           AND artifact_deleted_at IS NULL`,
        [run.id, this.storage.independentCopyTargetCode()],
      );
      if (updated.rowCount !== 1) throw new Error('BACKUP_REPLICA_RUN_CHANGED');
      await appendRunEvent(
        client,
        run.id,
        'independent_copy_started',
        run.verification_attempt_count,
        {
          targetCode: this.storage.independentCopyTargetCode(),
        },
      );
      await this.audit.append(
        {
          action: 'backup.run.independent_copy_started',
          correlationId: context.correlationId,
          metadata: { targetCode: this.storage.independentCopyTargetCode() },
          targetId: run.id,
          targetType: 'backup_execution_run',
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

  private async markIndependentCopyVerified(
    run: ClaimedRun,
    context: BackgroundJobContext,
  ): Promise<void> {
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE backup.execution_runs
         SET independent_copy_status='verified',independent_copy_verified_at=now(),
             independent_copy_error_code=NULL,updated_at=now()
         WHERE id=$1 AND status='stored' AND verification_status='running'
           AND independent_copy_status='running'
           AND independent_copy_target_code=$2`,
        [run.id, this.storage.independentCopyTargetCode()],
      );
      if (updated.rowCount !== 1) throw new Error('BACKUP_REPLICA_RUN_CHANGED');
      await appendRunEvent(
        client,
        run.id,
        'independent_copy_verified',
        run.verification_attempt_count,
        {
          sha256: run.artifact_sha256,
          sizeBytes: run.artifact_size_bytes,
          targetCode: this.storage.independentCopyTargetCode(),
        },
      );
      await this.audit.append(
        {
          action: 'backup.run.independent_copy_verified',
          correlationId: context.correlationId,
          metadata: {
            sha256: run.artifact_sha256,
            sizeBytes: run.artifact_size_bytes,
            targetCode: this.storage.independentCopyTargetCode(),
          },
          targetId: run.id,
          targetType: 'backup_execution_run',
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

  private async markVerificationFailed(
    run: ClaimedRun,
    context: BackgroundJobContext,
    errorCode: string,
  ): Promise<void> {
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE backup.execution_runs
         SET verification_status='failed',error_code=$2,
             independent_copy_status=CASE
               WHEN independent_copy_status IN ('pending','running') THEN 'failed'
               ELSE independent_copy_status END,
             independent_copy_error_code=CASE
               WHEN independent_copy_status IN ('pending','running') THEN $2
               ELSE independent_copy_error_code END,
             independent_copy_verified_at=NULL,updated_at=now()
         WHERE id=$1 AND status='stored'`,
        [run.id, errorCode],
      );
      await appendRunEvent(client, run.id, 'verification_failed', run.verification_attempt_count, {
        errorCode,
      });
      if (run.independent_copy_status !== 'not_configured') {
        await appendRunEvent(
          client,
          run.id,
          'independent_copy_failed',
          run.verification_attempt_count,
          { errorCode },
        );
        await this.audit.append(
          {
            action: 'backup.run.independent_copy_failed',
            correlationId: context.correlationId,
            metadata: {
              errorCode,
              targetCode: run.independent_copy_target_code,
            },
            targetId: run.id,
            targetType: 'backup_execution_run',
          },
          client,
        );
      }
      await this.audit.append(
        {
          action: 'backup.run.verification_failed',
          correlationId: context.correlationId,
          metadata: { attempt: run.verification_attempt_count, errorCode },
          targetId: run.id,
          targetType: 'backup_execution_run',
        },
        client,
      );
      if (!context.retryAllowed) {
        await this.queueBackupAlerts(client, {
          eventId: `${run.id}:verification-failed`,
          kind: 'failed',
          policyCode: run.policy_code,
          scheduledFor: asDate(run.scheduled_for),
        });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async queueBackupAlerts(
    client: PoolClient,
    input: {
      eventId: string;
      kind: BackupAlertKind;
      policyCode: string;
      scheduledFor: Date;
    },
  ): Promise<number> {
    const recipients = await client.query<BackupAlertRecipient>(
      `SELECT DISTINCT account.id AS account_id, employee.email
       FROM identity.user_accounts account
       JOIN identity.employees employee ON employee.id=account.employee_id AND employee.active
       JOIN iam.account_roles account_role ON account_role.account_id=account.id
       JOIN iam.role_permissions role_permission ON role_permission.role_id=account_role.role_id
       JOIN iam.permissions permission ON permission.id=role_permission.permission_id
       WHERE account.status='active' AND (account.locked_until IS NULL OR account.locked_until<=now())
         AND permission.module='backup' AND permission.action='view'
       ORDER BY account.id`,
    );
    if (recipients.rows.length === 0) return 0;

    const templateKey =
      input.kind === 'missed' ? 'backup.schedule.missed' : `backup.run.${input.kind}`;
    const scheduledFor = input.scheduledFor.toISOString();
    const alertText = backupAlertCopy(input.kind, input.policyCode, input.scheduledFor);
    let queuedCount = 0;
    for (const recipient of recipients.rows) {
      const inSystem = await client.query(
        `INSERT INTO notifications.messages (
           recipient_account_id,channel,template_key,template_version,payload,idempotency_key,status
         ) VALUES ($1,'in_system',$2,1,$3,$4,'pending')
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          recipient.account_id,
          templateKey,
          { policyCode: input.policyCode, scheduledFor },
          `backup-alert:${input.kind}:${input.eventId}:${recipient.account_id}`,
        ],
      );
      if (inSystem.rowCount) queuedCount += 1;
      const email = await queueEmailMessage(client, {
        idempotencyKey: `backup-alert:${input.kind}:${input.eventId}:${recipient.account_id}`,
        recipient: recipient.email,
        subject: alertText.subject,
        text: alertText.text,
      });
      if (email.created) queuedCount += 1;
    }
    if (this.environment.SMS_PROVIDER === 'twilio') {
      const smsRecipients = this.environment.BACKUP_ALERT_SMS_RECIPIENTS.split(',')
        .map((recipient) => recipient.trim())
        .filter(Boolean);
      for (const recipient of smsRecipients) {
        const inserted = await client.query(
          `INSERT INTO notifications.messages (
             channel,template_key,template_version,payload,idempotency_key,status
           ) VALUES ('sms','backup.alert.sms',1,$1,$2,'pending')
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            { body: alertText.smsBody, to: recipient },
            `backup-alert:sms:${input.kind}:${input.eventId}:${createHash('sha256').update(recipient).digest('hex').slice(0, 32)}`,
          ],
        );
        if (inserted.rowCount) queuedCount += 1;
      }
    }
    return queuedCount;
  }

  private async enqueueVerification(run: ClaimedRun, context: BackgroundJobContext): Promise<void> {
    await this.jobs.enqueue({
      correlationId: context.correlationId,
      idempotencyKey: `backup-verify:${run.id}`,
      name: 'backup.verify',
      payload: { runId: run.id },
    });
  }

  private async uploadStream(
    stream: Readable,
    key: string,
    uploadId: string,
  ): Promise<Array<{ ETag: string; PartNumber: number }>> {
    const parts: Array<{ ETag: string; PartNumber: number }> = [];
    const buffers: Buffer[] = [];
    let bufferedBytes = 0;
    let partNumber = 1;
    const uploadPart = async (body: Buffer) => {
      if (partNumber > 10_000) throw new Error('BACKUP_ARTIFACT_TOO_LARGE');
      const ETag = await this.storage.uploadBackupPart({
        body,
        key,
        partNumber,
        uploadId,
      });
      parts.push({ ETag, PartNumber: partNumber });
      partNumber += 1;
    };
    const take = (length: number): Buffer => {
      const selected: Buffer[] = [];
      let remaining = length;
      while (remaining > 0) {
        const first = buffers[0];
        if (!first) throw new Error('Backup upload buffer accounting failed');
        const size = Math.min(first.length, remaining);
        selected.push(first.subarray(0, size));
        if (size === first.length) buffers.shift();
        else buffers[0] = first.subarray(size);
        bufferedBytes -= size;
        remaining -= size;
      }
      return Buffer.concat(selected, length);
    };
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      buffers.push(Buffer.from(chunk));
      bufferedBytes += chunk.length;
      while (bufferedBytes >= multipartPartBytes) await uploadPart(take(multipartPartBytes));
    }
    if (bufferedBytes > 0) await uploadPart(take(bufferedBytes));
    if (parts.length === 0) throw new Error('BACKUP_DATABASE_DUMP_EMPTY');
    return parts;
  }

  private async releaseLock(client: PoolClient, lockKey: string): Promise<void> {
    await unlockAndRelease(client, lockKey);
  }
}

function parseEncryptionKey(value: string): Buffer {
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new Error('BACKUP_ENCRYPTION_KEY_MISSING_OR_INVALID');
  return Buffer.from(value, 'hex');
}

function requiredPayloadString(context: BackgroundJobContext, key: string): string {
  const value = context.payload[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new UnrecoverableError(`Backup job requires ${key}.`);
  }
  return value;
}

function parseScheduledFor(context: BackgroundJobContext): Date {
  const raw = context.payload['scheduledFor'];
  const value = typeof raw === 'string' ? new Date(raw) : new Date(context.enqueuedAt);
  if (Number.isNaN(value.getTime()))
    throw new UnrecoverableError('Backup schedule time is invalid.');
  return value;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function backupAlertCopy(
  kind: BackupAlertKind,
  policyCode: string,
  scheduledFor: Date,
): { subject: string; text: string; smsBody: string } {
  const when = new Intl.DateTimeFormat('bg-BG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Sofia',
  }).format(scheduledFor);
  if (kind === 'verified') {
    return {
      subject: 'Backup verified / Резервното копие е проверено',
      smsBody: `Архивът ${policyCode} от ${when} е проверен и готов за възстановяване.`,
      text: `The scheduled backup for ${policyCode} at ${when} passed its integrity check and is ready for recovery.\n\nПланираното резервно копие ${policyCode} от ${when} премина проверката за цялост и е готово за възстановяване.`,
    };
  }
  if (kind === 'missed') {
    return {
      subject: 'Scheduled backup missed / Пропуснато планирано резервно копие',
      smsBody: `Липсва планиран архив ${policyCode} за ${when}. Проверете Backup.`,
      text: `No backup run was recorded for ${policyCode} at ${when}. Review the backup run list and schedule.\n\nНяма записано изпълнение на резервно копие ${policyCode} за ${when}. Проверете списъка с изпълнения и графика.`,
    };
  }
  return {
    subject: 'Backup needs attention / Резервното копие изисква внимание',
    smsBody: `Архивът ${policyCode} от ${when} не завърши успешно. Проверете Backup.`,
    text: `The scheduled backup for ${policyCode} at ${when} did not complete successfully after automatic retries. Review the backup run list.\n\nПланираното резервно копие ${policyCode} от ${when} не завърши успешно след автоматичните повторни опити. Проверете списъка с изпълнения.`,
  };
}

function planReviewReminderCopy(
  state: 'initial' | 'inventory_changed' | 'actions_due' | 'upcoming' | 'overdue',
  dueDate?: string,
  bgDueDate?: string,
): { subject: string; text: string; sms: string } {
  if (state === 'initial') {
    return {
      subject: 'Backup plan review required / Изисква се преглед на плана за архивиране',
      sms: 'Не е записан годишен преглед на плана за архивиране. Отворете Vista Recovery > Преглед на плана.',
      text: `No annual backup-plan review has been recorded. Open Vista Recovery > Plan review, compare the protected-source inventory and policies with the approved Information Backup Plan, and record the review outcome.

Не е записан годишен преглед на плана за архивиране. Отворете Vista Recovery > Преглед на плана, сравнете инвентара на защитените източници и политиките с одобрения план за архивиране и запишете резултата от прегледа.`,
    };
  }
  if (state === 'inventory_changed') {
    return {
      subject: 'Backup plan changed since review / Планът за архивиране е променен след прегледа',
      sms: 'Инвентарът или политиките за архивиране са променени след последния преглед. Проверете Vista Recovery > Преглед на плана.',
      text: `The protected-source inventory or backup policies changed after the last recorded review. Open Vista Recovery > Plan review, check the changed plan against the approved Information Backup Plan, and record a new review.

Инвентарът на защитените източници или политиките за архивиране са променени след последния преглед. Отворете Vista Recovery > Преглед на плана, проверете промените спрямо одобрения план за архивиране и запишете нов преглед.`,
    };
  }
  if (state === 'actions_due') {
    return {
      subject:
        'Backup plan review actions remain open / Има неизпълнени действия по плана за архивиране',
      sms: 'Последният преглед изисква коригиращи действия. Проверете Vista Recovery > Преглед на плана.',
      text: `The last backup-plan review recorded changes that require corrective action. Review its actions in Vista Recovery > Plan review, complete the work, then record a follow-up review.

При последния преглед на плана за архивиране са записани коригиращи действия. Проверете ги във Vista Recovery > Преглед на плана, изпълнете ги и запишете последващ преглед.`,
    };
  }
  const date = dueDate ?? 'the scheduled date';
  const bgDate = bgDueDate ?? 'планираната дата';
  const overdue = state === 'overdue';
  return {
    subject: overdue
      ? 'Annual backup plan review overdue / Просрочен годишен преглед на плана за архивиране'
      : 'Annual backup plan review due soon / Предстоящ годишен преглед на плана за архивиране',
    sms: overdue
      ? 'Просрочен е годишният преглед на плана за архивиране. Отворете Vista Recovery > Преглед на плана.'
      : `Годишният преглед на плана за архивиране е до ${bgDate}. Отворете Vista Recovery > Преглед на плана.`,
    text: overdue
      ? `The annual backup-plan review was due on ${date}. Open Vista Recovery > Plan review and record the current inventory, policy review and required actions.

Годишният преглед на плана за архивиране е бил дължим на ${bgDate}. Отворете Vista Recovery > Преглед на плана и запишете актуалния инвентар, прегледа на политиките и необходимите действия.`
      : `The annual backup-plan review is due by ${date}. Open Vista Recovery > Plan review and record the current inventory, policy review and required actions.

Годишният преглед на плана за архивиране е дължим до ${bgDate}. Отворете Vista Recovery > Преглед на плана и запишете актуалния инвентар, прегледа на политиките и необходимите действия.`,
  };
}

function isSupportedRunSource(sourceType: string | null, backupType: string): boolean {
  return (
    (sourceType === 'database' && ['database_snapshot', 'full'].includes(backupType)) ||
    (sourceType === 'object_storage' &&
      ['differential', 'full', 'incremental'].includes(backupType)) ||
    (sourceType === 'cloud_service' &&
      ['differential', 'full', 'incremental'].includes(backupType)) ||
    (['file', 'file_share'].includes(sourceType ?? '') &&
      (['differential', 'full', 'incremental'].includes(backupType) ||
        (sourceType === 'file_share' && backupType === 'system_image')))
  );
}

function fileShareBackupMode(value: string): FileShareBackupMode {
  if (value === 'system_image') return 'full';
  if (value === 'full' || value === 'incremental' || value === 'differential') return value;
  throw new UnrecoverableError('The file-share backup mode is not supported.');
}

function objectStorageBackupMode(value: string): ObjectStorageBackupMode {
  if (value === 'full' || value === 'incremental' || value === 'differential') return value;
  throw new UnrecoverableError('The object-storage backup mode is not supported.');
}

function requiredSnapshotValue(value: string | null): string {
  if (!value) throw new UnrecoverableError('The protected source snapshot is incomplete.');
  return value;
}

function executionErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,79}$/.test(error.message)) return error.message;
  return 'BACKUP_EXECUTION_FAILED';
}

function artifactDeletionErrorCode(error: unknown): string {
  if (error instanceof Error && error.message === 'BACKUP_RESTORE_POINT_CHANGED') {
    return 'BACKUP_RESTORE_POINT_CHANGED';
  }
  return 'BACKUP_ARTIFACT_DELETE_FAILED';
}

async function appendRunEvent(
  client: PoolClient,
  runId: string,
  eventType: string,
  attemptNumber: number,
  details: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO backup.execution_events(run_id,event_type,attempt_number,details)
     VALUES($1,$2,$3,$4)`,
    [runId, eventType, Math.max(1, attemptNumber), details],
  );
}

async function unlockAndRelease(client: PoolClient, lockKey: string): Promise<void> {
  await client
    .query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey])
    .catch(() => undefined);
  client.release();
}

async function createPrivateTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'vista-backup-'));
  await chmod(directory, 0o700);
  return directory;
}
