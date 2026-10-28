import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import type { AppEnvironment } from '@vista/config';
import { S3Client } from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AuditService } from '../src/audit/audit.service.js';
import type { AuthenticationContext } from '../src/auth/authentication.types.js';
import { BackupService } from '../src/backup/backup.service.js';
import { BackupExecutionService } from '../src/backup/backup-execution.service.js';
import { BackupRestoreWorkerService } from '../src/backup/backup-restore-worker.service.js';
import { BackupDatabaseRecoveryService } from '../src/backup/backup-database-recovery.service.js';
import { backupDatabaseSourceUrl } from '../src/backup/backup-database-source.js';
import { ApiErrorException } from '../src/common/api-error.exception.js';
import { PostgresBackupDumpRunner } from '../src/backup/postgres-backup-dump.runner.js';
import { DatabaseService } from '../src/database/database.service.js';
import { FilesService } from '../src/files/files.service.js';
import { migrateDown, migrateUp } from '../src/database/migration-runner.js';
import type { EnqueueJobInput } from '../src/jobs/job-queue.service.js';
import type { ObjectStorageService } from '../src/storage/object-storage.service.js';

const runDatabaseTests = process.env['RUN_DATABASE_TESTS'] === 'true';
let webDavCloudBackupTest: (() => Promise<void>) | undefined;

describe.skipIf(!runDatabaseTests)('backup source and policy management', () => {
  let adminPool: Pool;
  let databasePool: Pool;
  let databaseName: string;
  let databaseUrl: string;
  let database: DatabaseService;
  let backup: BackupService;
  let backupEnvironment: AppEnvironment;
  let actor: AuthenticationContext;
  let approver: AuthenticationContext;
  const fileShareRoots: string[] = [];
  const metadata = { correlationId: 'backup-management-test' };

  afterEach(() => vi.restoreAllMocks());

  beforeAll(async () => {
    const sourceUrl = process.env['DATABASE_URL'];
    if (!sourceUrl) throw new Error('DATABASE_URL is required when RUN_DATABASE_TESTS=true');
    adminPool = new Pool({ connectionString: sourceUrl, max: 1 });
    databaseName = `vista_backup_test_${randomUUID().replaceAll('-', '')}`;
    assertTemporaryDatabaseName(databaseName);
    await adminPool.query(`CREATE DATABASE ${databaseName}`);
    const isolatedUrl = new URL(sourceUrl);
    isolatedUrl.pathname = `/${databaseName}`;
    databaseUrl = isolatedUrl.toString();
    databasePool = new Pool({ connectionString: databaseUrl, max: 2 });
    await migrateUp(
      databasePool,
      fileURLToPath(new URL('../src/database/migrations', import.meta.url)),
    );
    const employeeId = randomUUID();
    const accountId = randomUUID();
    await databasePool.query(
      `INSERT INTO identity.employees(id,employee_number,display_name,email)
       VALUES($1,'TEST-BACKUP-ADMIN','Backup Integration Admin','backup-test@example.invalid')`,
      [employeeId],
    );
    await databasePool.query(
      `INSERT INTO identity.user_accounts(id,employee_id,password_hash)
       VALUES($1,$2,'test-only-hash')`,
      [accountId, employeeId],
    );
    actor = {
      accountId,
      displayName: 'Backup Integration Admin',
      email: 'backup-test@example.invalid',
      employeeId,
      isAdministrative: false,
      permissions: [
        { action: 'view', module: 'backup' },
        { action: 'create', module: 'backup' },
        { action: 'edit', module: 'backup' },
      ],
      sessionId: randomUUID(),
      twoFactorVerified: true,
    };
    const approverEmployeeId = randomUUID();
    const approverAccountId = randomUUID();
    await databasePool.query(
      `INSERT INTO identity.employees(id,employee_number,display_name,email)
       VALUES($1,'TEST-BACKUP-REVIEWER','Backup Integration Reviewer','backup-reviewer@example.invalid')`,
      [approverEmployeeId],
    );
    await databasePool.query(
      `INSERT INTO identity.user_accounts(id,employee_id,password_hash)
       VALUES($1,$2,'test-only-hash')`,
      [approverAccountId, approverEmployeeId],
    );
    approver = {
      accountId: approverAccountId,
      displayName: 'Backup Integration Reviewer',
      email: 'backup-reviewer@example.invalid',
      employeeId: approverEmployeeId,
      isAdministrative: false,
      permissions: [
        { action: 'view', module: 'backup' },
        { action: 'approve', module: 'backup' },
      ],
      sessionId: randomUUID(),
      twoFactorVerified: true,
    };
    const backupViewRole = randomUUID();
    const backupViewPermission = randomUUID();
    await databasePool.query(
      `INSERT INTO iam.roles(id,code,name) VALUES($1,'backup-alert-reader','Backup alert reader')`,
      [backupViewRole],
    );
    await databasePool.query(
      `INSERT INTO iam.permissions(id,module,action,description)
       VALUES($1,'backup','view','View backup records')`,
      [backupViewPermission],
    );
    await databasePool.query(
      `INSERT INTO iam.role_permissions(role_id,permission_id) VALUES($1,$2)`,
      [backupViewRole, backupViewPermission],
    );
    await databasePool.query(
      `INSERT INTO iam.account_roles(account_id,role_id) VALUES($1,$2),($3,$2)`,
      [accountId, backupViewRole, approverAccountId],
    );
    database = new DatabaseService({ DATABASE_URL: databaseUrl } as AppEnvironment);
    backupEnvironment = {
      BACKUP_DATABASE_SOURCE_URLS_JSON: {},
      BACKUP_PRIMARY_DATABASE_SOURCE_CODE: 'VISTA-DB-01',
      BACKUP_ENCRYPTION_KEY: 'a'.repeat(64),
      BACKUP_RESTORE_DATABASE_URL: databaseUrl,
      IDEMPOTENCY_TTL_SECONDS: 86400,
      DATABASE_URL: databaseUrl,
    } as unknown as AppEnvironment;
    backup = new BackupService(
      backupEnvironment,
      database,
      new AuditService(database),
      {} as ObjectStorageService,
    );
  });

  afterAll(async () => {
    for (const fileShareRoot of fileShareRoots) {
      const expectedPrefixes = [
        `${tmpdir()}/vista-backup-share-e2e-`,
        `${tmpdir()}/vista-system-image-e2e-`,
      ];
      if (!expectedPrefixes.some((prefix) => fileShareRoot.startsWith(prefix))) {
        throw new Error('Refusing to remove an unexpected file-share test directory');
      }
      await rm(fileShareRoot, { force: true, recursive: true });
    }
    await database?.onApplicationShutdown();
    await databasePool?.end();
    if (adminPool && databaseName) {
      await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
      await adminPool.end();
    }
  });

  it('creates an auditable source once, lists it, and version-checks edits', async () => {
    const input = {
      dataClassification: 'critical' as const,
      encryptedAtSource: true,
      location: 'Vista staging PostgreSQL',
      name: 'Vista operational database',
      sourceCode: 'VISTA-DB-01',
      sourceType: 'database' as const,
    };
    const created = await backup.createSource(input, 'backup-source-create-0001', actor, metadata);
    const replayed = await backup.createSource(input, 'backup-source-create-0001', actor, metadata);

    expect(replayed).toEqual(created);
    expect((await backup.sources({ page: 1, pageSize: 50 })).items).toContainEqual(created);

    const updated = await backup.updateSource(
      created.id,
      { ...input, location: 'Vista Coolify PostgreSQL', expectedVersion: created.version },
      'backup-source-update-0001',
      actor,
      metadata,
    );
    expect(updated.location).toBe('Vista Coolify PostgreSQL');
    expect(updated.version).toBe(created.version + 1);
    await expect(
      backup.updateSource(
        created.id,
        { ...input, expectedVersion: created.version },
        'backup-source-update-0002',
        actor,
        metadata,
      ),
    ).rejects.toThrow('This record changed');

    const audit = await database.getPool().query<{ action: string; count: string }>(
      `SELECT action,count(*) OVER ()::text AS count FROM audit.events
       WHERE target_id=$1 ORDER BY occurred_at,id`,
      [created.id],
    );
    expect(audit.rows.map(({ action }) => action)).toEqual([
      'backup.protected_source.created',
      'backup.protected_source.updated',
    ]);
    expect(Number(audit.rows[0]?.count)).toBe(2);
  });

  it('creates encrypted, verified draft schedules with adopted retention and recovery targets', async () => {
    const source = (await backup.sources({ page: 1, pageSize: 50 })).items[0];
    if (!source) throw new Error('The protected-source test must run first');
    const draft = await backup.createPolicy(
      {
        backupType: 'database_snapshot',
        frequency: 'hourly',
        name: 'Critical database recovery points',
        policyCode: 'CRITICAL-DB-HOURLY',
        rpoMinutes: 60,
        rtoMinutes: 240,
        sourceIds: [source.id],
      },
      'backup-policy-create-0001',
      actor,
      metadata,
    );
    expect(draft).toMatchObject({
      backupType: 'database_snapshot',
      compressionEnabled: true,
      encryptionRequired: true,
      frequency: 'hourly',
      retentionDailyCopies: 35,
      retentionMonthlyCopies: 12,
      status: 'draft',
      verificationRequired: true,
    });

    const updated = await backup.updatePolicy(
      draft.id,
      {
        backupType: draft.backupType,
        frequency: draft.frequency,
        name: draft.name,
        policyCode: draft.policyCode,
        rpoMinutes: 45,
        rtoMinutes: draft.rtoMinutes,
        sourceIds: [source.id],
        expectedVersion: draft.version,
      },
      'backup-policy-update-0001',
      actor,
      metadata,
    );
    expect(updated.rpoMinutes).toBe(45);
    expect(updated.version).toBe(draft.version + 1);

    await expect(
      backup.createPolicy(
        {
          backupType: 'full',
          frequency: 'daily',
          name: 'Too slow for a critical source',
          policyCode: 'CRITICAL-DB-TOO-SLOW',
          rpoMinutes: 1440,
          rtoMinutes: 1440,
          runTimeLocal: '02:00',
          sourceIds: [source.id],
        },
        'backup-policy-create-0002',
        actor,
        metadata,
      ),
    ).rejects.toThrow('The recovery targets exceed the selected source classification');

    expect((await backup.policies({ page: 1, pageSize: 50 })).items).toContainEqual(updated);

    const requested = await backup.requestPolicyApproval(
      updated.id,
      {
        expectedVersion: updated.version,
        justification: 'Protect this critical database on the agreed hourly schedule.',
      },
      'backup-policy-approval-request-0001',
      actor,
      metadata,
    );
    expect(requested).toMatchObject({ status: 'pending_approval', version: updated.version + 1 });
    const pending = await backup.policyApprovalRequests();
    expect(pending.total).toBe(1);
    expect(pending.items[0]).toMatchObject({ policyId: updated.id, status: 'pending' });

    const approvalId = pending.items[0]?.id;
    if (!approvalId) throw new Error('Approval request was not returned');
    await expect(
      backup.decidePolicyApproval(
        approvalId,
        { decision: 'approve' },
        'backup-policy-self-approval-0001',
        actor,
        metadata,
      ),
    ).rejects.toThrow('A different authorised person must review this policy.');

    const approved = await backup.decidePolicyApproval(
      approvalId,
      { decision: 'approve', comment: 'Reviewed against the adopted recovery targets.' },
      'backup-policy-approval-decision-0001',
      approver,
      metadata,
    );
    expect(approved).toMatchObject({ status: 'approved', version: requested.version + 1 });
    expect(
      await backup.decidePolicyApproval(
        approvalId,
        { decision: 'approve', comment: 'Reviewed against the adopted recovery targets.' },
        'backup-policy-approval-decision-0001',
        approver,
        metadata,
      ),
    ).toEqual(approved);
    let active = await backup.activatePolicy(
      approved.id,
      { expectedVersion: approved.version },
      'backup-policy-activate-0001',
      actor,
      metadata,
    );
    expect(active).toMatchObject({ status: 'active', version: approved.version + 1 });
    expect(
      await backup.activatePolicy(
        approved.id,
        { expectedVersion: approved.version },
        'backup-policy-activate-0001',
        actor,
        metadata,
      ),
    ).toEqual(active);
    await expect(
      backup.updatePolicy(
        active.id,
        {
          backupType: approved.backupType,
          frequency: approved.frequency,
          name: approved.name,
          policyCode: approved.policyCode,
          rpoMinutes: approved.rpoMinutes,
          rtoMinutes: approved.rtoMinutes,
          sourceIds: [source.id],
          expectedVersion: active.version,
        },
        'backup-approved-policy-edit-0001',
        actor,
        metadata,
      ),
    ).rejects.toThrow('Only draft policies can be edited');

    const pauseRequested = await backup.requestPolicyPause(
      active.id,
      {
        expectedVersion: active.version,
        justification: 'Pause the schedule while its recovery target is reviewed.',
      },
      'backup-policy-pause-request-0001',
      actor,
      metadata,
    );
    expect(pauseRequested).toMatchObject({
      pauseRequestPending: true,
      status: 'active',
      version: active.version,
    });
    await expect(
      backup.requestPolicyPause(
        active.id,
        {
          expectedVersion: active.version,
          justification: 'Duplicate pause request while review is already pending.',
        },
        'backup-policy-pause-request-0002',
        actor,
        metadata,
      ),
    ).rejects.toThrow('A pause request for this schedule is already awaiting review.');
    const pauseApproval = await backup.policyApprovalRequests();
    expect(pauseApproval.items).toContainEqual(
      expect.objectContaining({
        action: 'disable_job',
        policyId: active.id,
        version: active.version,
      }),
    );
    const pauseApprovalId = pauseApproval.items.find(
      (request) => request.action === 'disable_job' && request.policyId === active.id,
    )?.id;
    if (!pauseApprovalId) throw new Error('The pause approval was not returned');
    await expect(
      backup.decidePolicyApproval(
        pauseApprovalId,
        { decision: 'approve' },
        'backup-policy-pause-self-approval-0001',
        actor,
        metadata,
      ),
    ).rejects.toThrow('A different authorised person must review this pause request.');
    const paused = await backup.decidePolicyApproval(
      pauseApprovalId,
      { decision: 'approve', comment: 'Pause approved after the recovery review.' },
      'backup-policy-pause-approval-decision-0001',
      approver,
      metadata,
    );
    expect(paused.status).toBe('paused');
    expect(paused.pauseRequestPending).toBeUndefined();

    const approvalEvidence = await database.getPool().query<{
      approval_count: string;
      decision: string;
      outbox_count: string;
      request_status: string;
    }>(
      `SELECT request.status AS request_status, decision.decision,
              count(decision.request_id)::text AS approval_count,
              (SELECT count(*) FROM integration.outbox_events
               WHERE aggregate_id=$1 AND event_type='backup.policy.approval_decided')::text AS outbox_count
       FROM backup.approval_requests request
       JOIN backup.approvals decision ON decision.request_id=request.id
       WHERE request.id=$2
       GROUP BY request.status,decision.decision`,
      [approved.id, approvalId],
    );
    expect(approvalEvidence.rows[0]).toMatchObject({
      approval_count: '1',
      decision: 'approve',
      outbox_count: '1',
      request_status: 'approved',
    });

    const completedObjects = new Map<string, Buffer>();
    const uploadParts = new Map<string, Buffer[]>();
    const storage = {
      abortBackupUpload: vi.fn(({ key }: { key: string }) => {
        uploadParts.delete(key);
        return Promise.resolve();
      }),
      completeBackupUpload: vi.fn(({ key }: { key: string }) => {
        completedObjects.set(key, Buffer.concat(uploadParts.get(key) ?? []));
      }),
      createBackupUpload: vi.fn((key: string) => {
        uploadParts.set(key, []);
        return `upload:${key}`;
      }),
      deleteBackupObject: vi.fn((key: string) => {
        completedObjects.delete(key);
      }),
      getBackupObjectStream: vi.fn((key: string) => {
        const object = completedObjects.get(key);
        if (!object) throw new Error('Backup artifact not found');
        return Readable.from([object]);
      }),
      copyBackupObjectToIndependentStore: vi.fn(),
      independentCopyConfigured: vi.fn(() => false),
      independentCopyTargetCode: vi.fn(() => 'independent-vault'),
      uploadBackupPart: vi.fn(
        ({ body, key, partNumber }: { body: Buffer; key: string; partNumber: number }) => {
          uploadParts.get(key)?.push(body);
          return `etag-${partNumber}`;
        },
      ),
    } as unknown as ObjectStorageService;
    const queue = {
      enqueue: vi
        .fn<(input: EnqueueJobInput) => Promise<{ deduplicated: boolean; jobId: string }>>()
        .mockResolvedValue({ deduplicated: false, jobId: 'verify-1' }),
    };
    const execution = new BackupExecutionService(
      {
        BACKUP_ENCRYPTION_KEY: 'a'.repeat(64),
        BACKUP_ALERT_SMS_RECIPIENTS: '+359888123456,+359888654321',
        BUSINESS_TIMEZONE: 'Europe/Sofia',
        DATABASE_URL: databaseUrl,
        SMS_PROVIDER: 'twilio',
      } as AppEnvironment,
      database,
      storage,
      new AuditService(database),
      queue as never,
      new PostgresBackupDumpRunner(),
    );
    const pausedDispatch = await execution.dispatchDueRuns({
      attemptNumber: 1,
      correlationId: 'backup-paused-dispatch-integration',
      enqueuedAt: new Date().toISOString(),
      idempotencyKey: 'backup-paused-dispatch-integration-0001',
      jobId: 'backup-paused-dispatch-1',
      maxAttempts: 5,
      name: 'backup.schedule.dispatch',
      payload: {},
      retryAllowed: true,
    });
    expect(pausedDispatch.dueCount).toBe(0);
    active = await backup.resumePolicy(
      paused.id,
      { expectedVersion: paused.version },
      'backup-policy-resume-0001',
      actor,
      metadata,
    );
    expect(active.status).toBe('active');
    const dispatch = await execution.dispatchDueRuns({
      attemptNumber: 1,
      correlationId: 'backup-dispatch-integration',
      enqueuedAt: new Date().toISOString(),
      idempotencyKey: 'backup-dispatch-integration-0001',
      jobId: 'backup-dispatch-1',
      maxAttempts: 5,
      name: 'backup.schedule.dispatch',
      payload: {},
      retryAllowed: true,
    });
    expect(dispatch).toMatchObject({ dueCount: 1, enqueuedCount: 1, deduplicatedCount: 0 });
    const scheduledExecution = queue.enqueue.mock.calls[0]?.[0];
    expect(scheduledExecution?.name).toBe('backup.execute');
    expect(scheduledExecution?.payload['policyId']).toBe(active.id);
    expect(typeof scheduledExecution?.payload['scheduledFor']).toBe('string');
    const executeContext = {
      attemptNumber: 1,
      correlationId: 'backup-execution-integration',
      enqueuedAt: new Date().toISOString(),
      idempotencyKey: `backup-run-${active.id}`,
      jobId: 'backup-run-1',
      maxAttempts: 5,
      name: 'backup.execute',
      payload: { policyId: active.id, scheduledFor: new Date().toISOString() },
      retryAllowed: true,
    } as const;
    const run = await execution.execute(executeContext);
    expect(run.status).toBe('stored');
    const runId = String(run.runId);
    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'backup.verify', payload: { runId } }),
    );
    const archiveInspector = vi.spyOn(PostgresBackupDumpRunner.prototype, 'validateArchive');
    await execution.verify({
      ...executeContext,
      idempotencyKey: `backup-verify-${active.id}`,
      jobId: 'backup-verify-1',
      name: 'backup.verify',
      payload: { runId },
    });
    expect(await archiveInspector.mock.results[0]?.value).toEqual({
      hasVistaMigrationLedger: true,
    });
    await execution.verify({
      ...executeContext,
      idempotencyKey: `backup-verify-replay-${active.id}`,
      jobId: 'backup-verify-replay-1',
      name: 'backup.verify',
      payload: { runId },
    });
    await expect(execution.execute(executeContext)).resolves.toMatchObject({ status: 'verified' });
    const runPage = await backup.executionRuns({ page: 1, pageSize: 50 });
    expect(runPage.items).toContainEqual(
      expect.objectContaining({
        id: runId,
        policyCode: active.policyCode,
        status: 'verified',
        independentCopyStatus: 'not_configured',
        verificationStatus: 'verified',
      }),
    );
    await expect(execution.prepareDrTestReminders()).resolves.toMatchObject({
      dueCount: 1,
      notifiedCount: 6,
    });
    await expect(execution.prepareDrTestReminders()).resolves.toEqual({
      dueCount: 1,
      notifiedCount: 0,
    });
    const pastPlanError = await Promise.resolve()
      .then(() =>
        backup.planDrTest(
          {
            plannedFor: new Date(Date.now() - 60_000).toISOString(),
            runId,
            scope: 'Restore Vista data in isolation and verify the application records.',
          },
          'backup-dr-test-plan-past-0001',
          actor,
          metadata,
        ),
      )
      .catch((error: unknown) => error);
    expect(pastPlanError).toBeInstanceOf(ApiErrorException);
    const pastPlanResponse = (pastPlanError as ApiErrorException).getResponse();
    expect(pastPlanResponse).toMatchObject({ code: 'BACKUP_DR_TEST_DETAILS_INVALID' });
    expect(JSON.stringify(pastPlanResponse)).toContain('future planned date');
    const drTestPlannedFor = new Date(Date.now() + 86_400_000).toISOString();
    const drTest = await backup.planDrTest(
      {
        plannedFor: drTestPlannedFor,
        runId,
        scope: 'Restore Vista data in isolation and verify the application records.',
      },
      'backup-dr-test-plan-0001',
      actor,
      metadata,
    );
    expect(drTest).toMatchObject({
      backupRunId: runId,
      rpoTargetMinutes: 45,
      rtoTargetMinutes: 240,
      status: 'planned',
    });
    await expect(
      backup.planDrTest(
        {
          plannedFor: drTestPlannedFor,
          runId,
          scope: 'Restore Vista data in isolation and verify the application records.',
        },
        'backup-dr-test-plan-0001',
        actor,
        metadata,
      ),
    ).resolves.toEqual(drTest);
    expect((await backup.drTests()).items).toContainEqual(drTest);

    await expect(execution.prepareDrTestReminders()).resolves.toMatchObject({
      dueCount: 1,
      notifiedCount: 6,
    });
    await expect(execution.prepareDrTestReminders()).resolves.toEqual({
      dueCount: 1,
      notifiedCount: 0,
    });
    await database
      .getPool()
      .query(`UPDATE backup.dr_test_records SET planned_for=now()-interval '1 day' WHERE id=$1`, [
        drTest.id,
      ]);
    await expect(execution.prepareDrTestReminders()).resolves.toMatchObject({
      dueCount: 1,
      notifiedCount: 6,
    });
    await expect(execution.prepareDrTestReminders()).resolves.toEqual({
      dueCount: 1,
      notifiedCount: 0,
    });
    const drTestReminders = await database.getPool().query<{
      channel: string;
      count: string;
      template_key: string;
    }>(
      `SELECT channel,template_key,count(*)::text AS count
       FROM notifications.messages
       WHERE (channel='in_system' AND template_key='backup.dr-test.due'
              AND recipient_account_id=ANY($1::uuid[]))
          OR (channel='email' AND payload->>'to'=ANY($2::text[])
              AND payload->>'subject' LIKE 'Disaster-recovery test%')
          OR (channel='sms' AND template_key='backup.alert.sms'
              AND payload->>'to'=ANY($3::text[])
              AND (payload->>'body' LIKE 'DR тестът %'
                   OR payload->>'body' LIKE 'Няма записан DR тест%'))
       GROUP BY channel,template_key ORDER BY channel,template_key`,
      [
        [actor.accountId, approver.accountId],
        [actor.email, approver.email],
        ['+359888123456', '+359888654321'],
      ],
    );
    expect(drTestReminders.rows).toEqual([
      { channel: 'email', count: '6', template_key: 'document.delivery' },
      { channel: 'in_system', count: '6', template_key: 'backup.dr-test.due' },
      { channel: 'sms', count: '6', template_key: 'backup.alert.sms' },
    ]);

    const runEvidence = await database.getPool().query<{
      artifact_size_bytes: string;
      encryption_nonce: string;
      status: string;
      verification_status: string;
    }>(
      `SELECT artifact_size_bytes::text,encryption_nonce,status,verification_status
       FROM backup.execution_runs WHERE id=$1`,
      [runId],
    );
    expect(runEvidence.rows[0]).toMatchObject({
      status: 'verified',
      verification_status: 'verified',
    });
    expect(Number(runEvidence.rows[0]?.artifact_size_bytes)).toBeGreaterThan(0);
    expect(runEvidence.rows[0]?.encryption_nonce).toHaveLength(24);
    expect(completedObjects.size).toBe(1);
    const verifiedAlerts = await database.getPool().query<{
      channel: string;
      count: string;
      template_key: string;
    }>(
      `SELECT channel,template_key,count(*)::text AS count
       FROM notifications.messages
       WHERE (channel='in_system' AND template_key='backup.run.verified'
              AND recipient_account_id=ANY($1::uuid[]))
          OR (channel='email' AND payload->>'to'=ANY($2::text[])
              AND payload->>'subject' LIKE 'Backup verified%')
          OR (channel='sms' AND template_key='backup.alert.sms'
              AND payload->>'to'=ANY($3::text[])
              AND payload->>'body' LIKE 'Архивът % е проверен%')
       GROUP BY channel,template_key ORDER BY channel,template_key`,
      [
        [actor.accountId, approver.accountId],
        [actor.email, approver.email],
        ['+359888123456', '+359888654321'],
      ],
    );
    expect(verifiedAlerts.rows).toEqual([
      { channel: 'email', count: '2', template_key: 'document.delivery' },
      { channel: 'in_system', count: '2', template_key: 'backup.run.verified' },
      { channel: 'sms', count: '2', template_key: 'backup.alert.sms' },
    ]);
    const failingExecution = new BackupExecutionService(
      {
        BACKUP_ENCRYPTION_KEY: 'a'.repeat(64),
        BACKUP_ALERT_SMS_RECIPIENTS: '+359888123456,+359888654321',
        BUSINESS_TIMEZONE: 'Europe/Sofia',
        DATABASE_URL: databaseUrl,
        SMS_PROVIDER: 'twilio',
      } as AppEnvironment,
      database,
      storage,
      new AuditService(database),
      queue as never,
      {
        open: () => {
          throw new Error('BACKUP_DUMP_TOOL_UNAVAILABLE');
        },
      } as never,
    );
    const failedScheduledFor = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    const retryableFailure = {
      ...executeContext,
      correlationId: 'backup-failed-run-integration',
      idempotencyKey: `backup-failed-run-${active.id}`,
      jobId: 'backup-failed-run-1',
      payload: { policyId: active.id, scheduledFor: failedScheduledFor },
      retryAllowed: true,
    } as const;
    await expect(failingExecution.execute(retryableFailure)).rejects.toThrow(
      'BACKUP_DUMP_TOOL_UNAVAILABLE',
    );
    const noEarlyFailureAlert = await database.getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM notifications.messages
       WHERE (channel='in_system' AND template_key='backup.run.failed'
              AND recipient_account_id=ANY($1::uuid[]))
          OR (channel='email' AND payload->>'to'=ANY($2::text[])
              AND payload->>'subject' LIKE 'Backup needs attention%')
          OR (channel='sms' AND template_key='backup.alert.sms'
              AND payload->>'to'=ANY($3::text[])
              AND payload->>'body' LIKE 'Архивът % не завърши успешно%')`,
      [
        [actor.accountId, approver.accountId],
        [actor.email, approver.email],
        ['+359888123456', '+359888654321'],
      ],
    );
    expect(noEarlyFailureAlert.rows[0]?.count).toBe('0');
    await expect(
      failingExecution.execute({
        ...retryableFailure,
        attemptNumber: 2,
        jobId: 'backup-failed-run-2',
        retryAllowed: false,
      }),
    ).rejects.toThrow('BACKUP_DUMP_TOOL_UNAVAILABLE');
    const finalFailureAlerts = await database.getPool().query<{ channel: string; count: string }>(
      `SELECT channel,count(*)::text AS count FROM notifications.messages
       WHERE (channel='in_system' AND template_key='backup.run.failed'
              AND recipient_account_id=ANY($1::uuid[]))
          OR (channel='email' AND payload->>'to'=ANY($2::text[])
              AND payload->>'subject' LIKE 'Backup needs attention%')
          OR (channel='sms' AND template_key='backup.alert.sms'
              AND payload->>'to'=ANY($3::text[])
              AND payload->>'body' LIKE 'Архивът % не завърши успешно%')
       GROUP BY channel ORDER BY channel`,
      [
        [actor.accountId, approver.accountId],
        [actor.email, approver.email],
        ['+359888123456', '+359888654321'],
      ],
    );
    expect(finalFailureAlerts.rows).toEqual([
      { channel: 'email', count: '2' },
      { channel: 'in_system', count: '2' },
      { channel: 'sms', count: '2' },
    ]);
    await database
      .getPool()
      .query(`UPDATE backup.policies SET updated_at=now()-interval '3 hours' WHERE id=$1`, [
        active.id,
      ]);
    const missedFirst = await execution.detectMissedRuns({
      ...executeContext,
      correlationId: 'backup-missed-detection-integration',
      idempotencyKey: 'backup-missed-detection-integration-0001',
      jobId: 'backup-missed-detection-1',
      name: 'backup.missed-detect',
      payload: {},
    });
    expect(missedFirst.detectedCount).toBeGreaterThan(0);
    expect(missedFirst.notifiedCount).toBeGreaterThan(0);
    const missedAgain = await execution.detectMissedRuns({
      ...executeContext,
      correlationId: 'backup-missed-detection-integration-replay',
      idempotencyKey: 'backup-missed-detection-integration-0002',
      jobId: 'backup-missed-detection-2',
      name: 'backup.missed-detect',
      payload: {},
    });
    expect(missedAgain).toEqual({ detectedCount: 0, notifiedCount: 0 });
    const missedEvidence = await database.getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM notifications.messages
       WHERE (channel='in_system' AND template_key='backup.schedule.missed'
              AND recipient_account_id=ANY($1::uuid[]))
          OR (channel='email' AND payload->>'to'=ANY($2::text[])
              AND payload->>'subject' LIKE 'Scheduled backup missed%')
          OR (channel='sms' AND template_key='backup.alert.sms'
              AND payload->>'to'=ANY($3::text[])
              AND payload->>'body' LIKE 'Липсва планиран архив %')`,
      [
        [actor.accountId, approver.accountId],
        [actor.email, approver.email],
        ['+359888123456', '+359888654321'],
      ],
    );
    expect(Number(missedEvidence.rows[0]?.count)).toBeGreaterThan(0);
    await expect(
      database
        .getPool()
        .query(`UPDATE backup.execution_events SET details='{}' WHERE run_id=$1`, [runId]),
    ).rejects.toThrow('append-only');

    const restoreRequest = await backup.requestRestore(
      runId,
      { reason: `DR test ${drTest.testCode}: Verify an approved isolated recovery of Vista data.` },
      'backup-restore-request-0001',
      actor,
      metadata,
    );
    expect(restoreRequest.status).toBe('pending_approval');
    await expect(
      backup.decideRestoreApproval(
        restoreRequest.id,
        { decision: 'approve' },
        'backup-restore-self-approval-0001',
        actor,
        metadata,
      ),
    ).rejects.toThrow('A different authorised person must review this restore.');
    const approvedRestore = await backup.decideRestoreApproval(
      restoreRequest.id,
      { decision: 'approve', comment: 'Restore target is isolated from the live database.' },
      'backup-restore-approval-0001',
      approver,
      metadata,
    );
    expect(approvedRestore.status).toBe('approved');

    const restoreWorker = new BackupRestoreWorkerService(
      {
        BACKUP_ENCRYPTION_KEY: 'a'.repeat(64),
        BACKUP_RESTORE_DATABASE_URL: databaseUrl,
      } as AppEnvironment,
      database,
      storage,
      new AuditService(database),
      queue as never,
      new PostgresBackupDumpRunner(),
    );
    await expect(restoreWorker.dispatchApprovedRestores()).resolves.toEqual({
      deduplicatedCount: 0,
      enqueuedCount: 1,
    });
    const restoreResult = await restoreWorker.execute({
      ...executeContext,
      idempotencyKey: `backup-restore-${restoreRequest.id}`,
      jobId: 'backup-restore-integration-1',
      name: 'backup.restore.execute',
      payload: { restoreRequestId: restoreRequest.id },
    });
    expect(restoreResult).toMatchObject({ status: 'completed' });
    const restoredName = String(restoreResult['targetDatabaseName']);
    assertTemporaryRestoreDatabaseName(restoredName);
    const restoredUrl = new URL(databaseUrl);
    restoredUrl.pathname = `/${restoredName}`;
    const restoredPool = new Pool({ connectionString: restoredUrl.toString(), max: 1 });
    try {
      const restoredMigrations = await restoredPool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM platform.schema_migrations',
      );
      expect(Number(restoredMigrations.rows[0]?.count)).toBeGreaterThan(0);
      expect((await backup.restoreRequests()).items).toContainEqual(
        expect.objectContaining({ id: restoreRequest.id, status: 'completed' }),
      );
    } finally {
      await restoredPool.end();
      await adminPool.query(`DROP DATABASE IF EXISTS "${restoredName}" WITH (FORCE)`);
    }

    const fileBytes = Buffer.from('%PDF-1.4\nSigned isolated restore protocol.\n');
    const storageWithFiles = Object.assign(storage, {
      bucketName: vi.fn(() => 'vista-backup-integration'),
      deleteObject: vi.fn((key: string) => {
        completedObjects.delete(key);
      }),
      getObject: vi.fn((key: string) => {
        const object = completedObjects.get(key);
        if (!object) throw new Error('Managed file not found');
        return object;
      }),
      putObject: vi.fn(({ body, key }: { body: Buffer; key: string }) => {
        completedObjects.set(key, body);
      }),
    }) as unknown as ObjectStorageService;
    const managedFiles = new FilesService(
      {
        FILE_ALLOWED_MEDIA_TYPES: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
        FILE_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
        IDEMPOTENCY_TTL_SECONDS: 86_400,
      } as AppEnvironment,
      database,
      new AuditService(database),
      storageWithFiles,
      { event: vi.fn() } as never,
    );
    const protocol = await managedFiles.upload(
      { parentId: drTest.id, parentType: 'backup_dr_test' },
      {
        buffer: fileBytes,
        fileName: 'signed-restore-test.pdf',
        mediaType: 'application/pdf',
        sizeBytes: fileBytes.length,
      },
      'backup-dr-test-protocol-0001',
      actor,
      metadata,
    );
    expect(protocol).toMatchObject({
      mediaType: 'application/pdf',
      parentId: drTest.id,
      parentType: 'backup_dr_test',
      status: 'available',
    });
    await expect(managedFiles.content(protocol.id, approver)).resolves.toMatchObject({
      buffer: fileBytes,
      fileName: 'signed-restore-test.pdf',
      mediaType: 'application/pdf',
    });
    const drResult = await backup.recordDrTest(
      drTest.id,
      {
        actualRpoMinutes: 20,
        actualRtoMinutes: 90,
        evidenceFileId: protocol.id,
        protocolSignedAt: new Date().toISOString(),
        protocolSignedBy: 'Backup Integration Admin',
        restoreRequestId: restoreRequest.id,
        resultSummary: 'Vista records were restored in isolation and checked.',
      },
      'backup-dr-test-result-0001',
      actor,
      metadata,
    );
    expect(drResult).toMatchObject({
      evidenceFileId: protocol.id,
      outcome: 'passed',
      protocolSignedBy: 'Backup Integration Admin',
      restoreRequestId: restoreRequest.id,
      rpoMet: true,
      rtoMet: true,
      status: 'recorded',
    });
    await expect(execution.prepareDrTestReminders()).resolves.toEqual({
      dueCount: 0,
      notifiedCount: 0,
    });
    await expect(
      backup.recordDrTest(
        drTest.id,
        {
          actualRpoMinutes: 20,
          actualRtoMinutes: 90,
          evidenceFileId: protocol.id,
          protocolSignedAt: drResult.protocolSignedAt!,
          protocolSignedBy: 'Backup Integration Admin',
          restoreRequestId: restoreRequest.id,
          resultSummary: 'Vista records were restored in isolation and checked.',
        },
        'backup-dr-test-result-0001',
        actor,
        metadata,
      ),
    ).resolves.toEqual(drResult);
    await expect(
      database
        .getPool()
        .query(`UPDATE backup.dr_test_records SET result_summary='changed' WHERE id=$1`, [
          drTest.id,
        ]),
    ).rejects.toThrow('immutable');
    await expect(
      database
        .getPool()
        .query(`UPDATE backup.dr_test_events SET details='{}' WHERE dr_test_id=$1`, [drTest.id]),
    ).rejects.toThrow('append-only');
    const migrationDirectory = fileURLToPath(
      new URL('../src/database/migrations', import.meta.url),
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0120_backup_database_engine',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0119_backup_webdav_cloud_source',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0118_backup_email_source',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0117_backup_object_source_identity',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0116_backup_file_share_lineage',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0115_backup_independent_copies',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0114_backup_retention_reduction_approval',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0113_backup_restore_point_deletion',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0112_backup_policy_disable_approval',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0111_backup_file_share_source',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0110_backup_granular_file_restore',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0109_backup_compression',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0108_backup_object_storage_restore',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0107_backup_plan_reviews',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).rejects.toThrow(
      'Cannot remove disaster-recovery test records',
    );
    await expect(migrateUp(databasePool, migrationDirectory)).resolves.toEqual([
      '0107_backup_plan_reviews',
      '0108_backup_object_storage_restore',
      '0109_backup_compression',
      '0110_backup_granular_file_restore',
      '0111_backup_file_share_source',
      '0112_backup_policy_disable_approval',
      '0113_backup_restore_point_deletion',
      '0114_backup_retention_reduction_approval',
      '0115_backup_independent_copies',
      '0116_backup_file_share_lineage',
      '0117_backup_object_source_identity',
      '0118_backup_email_source',
      '0119_backup_webdav_cloud_source',
      '0120_backup_database_engine',
    ]);
    expect((await backup.drTests()).items).toContainEqual(drResult);

    const retentionRunIds: string[] = [];
    for (let ageDays = 1; ageDays <= 40; ageDays += 1) {
      const id = randomUUID();
      retentionRunIds.push(id);
      const scheduledFor = new Date(Date.now() - ageDays * 86_400_000);
      const artifactKey = `database/${active.policyCode}/${id}.dump.enc`;
      completedObjects.set(artifactKey, Buffer.from(`retention-test-${id}`));
      await database.getPool().query(
        `INSERT INTO backup.execution_runs (
           id,policy_id,scheduled_for,idempotency_key,backup_type,status,
           verification_status,attempt_count,verification_attempt_count,
           started_at,stored_at,verified_at,artifact_key,artifact_sha256,
           artifact_size_bytes,encryption_nonce,encryption_tag,source_type,database_engine
         ) VALUES ($1,$2,$3,$4,'database_snapshot','verified','verified',1,1,
                   $3,$3,$3,$5,$6,1,$7,$8,'database','postgresql')`,
        [
          id,
          active.id,
          scheduledFor,
          `retention-test:${id}`,
          artifactKey,
          'c'.repeat(64),
          'a'.repeat(24),
          'b'.repeat(32),
        ],
      );
    }
    const retention = await execution.enforceRetention({
      ...executeContext,
      correlationId: 'backup-retention-integration',
      idempotencyKey: 'backup-retention-integration-0001',
      jobId: 'backup-retention-1',
      name: 'backup.retention.enforce',
      payload: {},
    });
    expect(retention.deletedArtifactCount).toBeGreaterThan(0);
    expect(retention.processedCount).toBe(retention.deletedArtifactCount);
    const retentionEvidence = await database.getPool().query<{
      artifact_deleted_at: Date | null;
      id: string;
    }>(
      `SELECT id,artifact_deleted_at FROM backup.execution_runs
       WHERE id=ANY($1::uuid[]) ORDER BY scheduled_for`,
      [retentionRunIds],
    );
    const expiredRun = retentionEvidence.rows.find((row) => row.artifact_deleted_at);
    if (!expiredRun) throw new Error('The retention test requires one expired backup copy');
    expect(completedObjects.has(`database/${active.policyCode}/${expiredRun.id}.dump.enc`)).toBe(
      false,
    );
    expect((await backup.executionRuns({ page: 1, pageSize: 50 })).items).toContainEqual(
      expect.objectContaining({ artifactAvailable: false, id: expiredRun.id }),
    );
    await expect(
      backup.requestRestore(
        expiredRun.id,
        { reason: 'This expired backup must not be offered for restore.' },
        'backup-retention-expired-restore-0001',
        actor,
        metadata,
      ),
    ).rejects.toThrow(
      'Only a verified backup with a configured isolated restore target can be restored.',
    );
    const retentionEvent = await database.getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM backup.execution_events
       WHERE run_id=$1 AND event_type='retention_expired'`,
      [expiredRun.id],
    );
    expect(retentionEvent.rows[0]?.count).toBe('1');
  }, 60_000);

  it('records an immutable annual plan review and reminds reviewers when the plan changes', async () => {
    const execution = new BackupExecutionService(
      {
        BACKUP_ALERT_SMS_RECIPIENTS: '',
        BUSINESS_TIMEZONE: 'Europe/Sofia',
        SMS_PROVIDER: 'disabled',
      } as AppEnvironment,
      database,
      {} as ObjectStorageService,
      new AuditService(database),
      { enqueue: vi.fn() } as never,
      new PostgresBackupDumpRunner(),
    );
    const current = await backup.planReviews();
    expect(current).toMatchObject({ reviewRequired: true, total: 0 });
    expect(current.currentPlanSnapshot.protectedSources).toHaveLength(1);
    expect(current.currentPlanSnapshot.policies).toHaveLength(1);

    await expect(execution.preparePlanReviewReminders()).resolves.toMatchObject({
      dueCount: 1,
      notifiedCount: 4,
    });
    await expect(execution.preparePlanReviewReminders()).resolves.toEqual({
      dueCount: 1,
      notifiedCount: 0,
    });

    const review = await backup.recordPlanReview(
      {
        outcome: 'approved',
        summary: 'Protected sources and approved backup policies were checked against the plan.',
      },
      'backup-plan-review-approved-0001',
      approver,
      metadata,
    );
    const migrationDirectory = fileURLToPath(
      new URL('../src/database/migrations', import.meta.url),
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0120_backup_database_engine',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0119_backup_webdav_cloud_source',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0118_backup_email_source',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0117_backup_object_source_identity',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0116_backup_file_share_lineage',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0115_backup_independent_copies',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0114_backup_retention_reduction_approval',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0113_backup_restore_point_deletion',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0112_backup_policy_disable_approval',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0111_backup_file_share_source',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0110_backup_granular_file_restore',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0109_backup_compression',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0108_backup_object_storage_restore',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).rejects.toThrow(
      'Cannot remove signed backup plan review evidence',
    );
    await expect(migrateUp(databasePool, migrationDirectory)).resolves.toEqual([
      '0108_backup_object_storage_restore',
      '0109_backup_compression',
      '0110_backup_granular_file_restore',
      '0111_backup_file_share_source',
      '0112_backup_policy_disable_approval',
      '0113_backup_restore_point_deletion',
      '0114_backup_retention_reduction_approval',
      '0115_backup_independent_copies',
      '0116_backup_file_share_lineage',
      '0117_backup_object_source_identity',
      '0118_backup_email_source',
      '0119_backup_webdav_cloud_source',
      '0120_backup_database_engine',
    ]);
    await expect(
      backup.recordPlanReview(
        {
          outcome: 'approved',
          summary: 'Protected sources and approved backup policies were checked against the plan.',
        },
        'backup-plan-review-approved-0001',
        approver,
        metadata,
      ),
    ).resolves.toEqual(review);
    expect(review).toMatchObject({
      outcome: 'approved',
      policyCount: 1,
      protectedSourceCount: 1,
      reviewedByName: 'Backup Integration Reviewer',
    });
    expect((await backup.planReviews()).reviewRequired).toBe(false);
    await expect(execution.preparePlanReviewReminders()).resolves.toEqual({
      dueCount: 0,
      notifiedCount: 0,
    });

    await database
      .getPool()
      .query(
        `UPDATE backup.protected_sources SET location='Vista production PostgreSQL' WHERE source_code='VISTA-DB-01'`,
      );
    expect((await backup.planReviews()).reviewRequired).toBe(true);
    await expect(execution.preparePlanReviewReminders()).resolves.toMatchObject({
      dueCount: 1,
      notifiedCount: 4,
    });
    await expect(execution.preparePlanReviewReminders()).resolves.toEqual({
      dueCount: 1,
      notifiedCount: 0,
    });
    const correctiveReview = await backup.recordPlanReview(
      {
        correctiveActions: 'Confirm named data stewards for all protected systems.',
        outcome: 'changes_required',
        summary: 'The plan is accurate, but data-steward ownership needs completion.',
      },
      'backup-plan-review-actions-0001',
      approver,
      metadata,
    );
    expect((await backup.planReviews()).reviewRequired).toBe(true);
    await expect(execution.preparePlanReviewReminders()).resolves.toMatchObject({
      dueCount: 1,
      notifiedCount: 4,
    });
    await expect(execution.preparePlanReviewReminders()).resolves.toEqual({
      dueCount: 1,
      notifiedCount: 0,
    });
    await expect(
      backup.recordPlanReview(
        {
          outcome: 'approved',
          summary: 'The updated plan and named data-steward ownership were checked.',
        },
        'backup-plan-review-followup-0001',
        approver,
        metadata,
      ),
    ).resolves.toMatchObject({ outcome: 'approved' });
    expect((await backup.planReviews()).reviewRequired).toBe(false);

    // Move the review into the past in this disposable database to exercise an
    // overdue annual reminder. Keep the schema's due-after-review constraint.
    const latestReviewId = (await backup.planReviews()).items[0]?.id;
    if (!latestReviewId) throw new Error('The approved follow-up review must be listed');
    await database
      .getPool()
      .query('ALTER TABLE backup.plan_reviews DISABLE TRIGGER backup_plan_reviews_immutable');
    try {
      await database.getPool().query(
        `UPDATE backup.plan_reviews
           SET reviewed_at=reviewed_at-interval '1 year 1 day',
               next_review_due_at=next_review_due_at-interval '1 year 1 day'`,
      );
    } finally {
      await database
        .getPool()
        .query('ALTER TABLE backup.plan_reviews ENABLE TRIGGER backup_plan_reviews_immutable');
    }
    await expect(execution.preparePlanReviewReminders()).resolves.toMatchObject({
      dueCount: 1,
      notifiedCount: 4,
    });
    await expect(execution.preparePlanReviewReminders()).resolves.toEqual({
      dueCount: 1,
      notifiedCount: 0,
    });
    await expect(
      database
        .getPool()
        .query(`UPDATE backup.plan_reviews SET summary='changed' WHERE id=$1`, [review.id]),
    ).rejects.toThrow('backup plan review evidence is immutable');
    const eventEvidence = await database
      .getPool()
      .query<{ audit_count: string; outbox_count: string }>(
        `SELECT
         (SELECT count(*) FROM audit.events WHERE target_id=$1 AND action='backup.plan_review.recorded')::text AS audit_count,
         (SELECT count(*) FROM integration.outbox_events WHERE aggregate_id=$1 AND event_type='backup.plan_review.recorded')::text AS outbox_count`,
        [review.id],
      );
    expect(eventEvidence.rows[0]).toEqual({ audit_count: '1', outbox_count: '1' });
    expect(correctiveReview.correctiveActions).toContain('data stewards');
  });

  it('expires unattended approval requests once and returns the policy to draft', async () => {
    const source = (await backup.sources({ page: 1, pageSize: 50 })).items[0];
    if (!source) throw new Error('The protected-source test must run first');
    const draft = await backup.createPolicy(
      {
        backupType: 'database_snapshot',
        frequency: 'hourly',
        name: 'Expiring database approval',
        policyCode: 'EXPIRING-DB-APPROVAL',
        rpoMinutes: 60,
        rtoMinutes: 240,
        sourceIds: [source.id],
      },
      'backup-policy-expiry-create-0001',
      actor,
      metadata,
    );
    const requested = await backup.requestPolicyApproval(
      draft.id,
      {
        expectedVersion: draft.version,
        justification: 'Test the safe expiry behavior for an unattended request.',
      },
      'backup-policy-expiry-request-0001',
      actor,
      metadata,
    );
    await database.getPool().query(
      `UPDATE backup.approval_requests
       SET requested_at=now()-interval '2 minutes',expires_at=now()-interval '1 minute'
       WHERE target_id=$1 AND status='pending'`,
      [requested.id],
    );

    expect(await backup.policyApprovalRequests()).toEqual({ items: [], total: 0 });
    const policies = await backup.policies({ page: 1, pageSize: 50 });
    expect(policies.items.find(({ id }) => id === draft.id)).toMatchObject({
      status: 'draft',
      version: requested.version + 1,
    });
    await backup.policyApprovalRequests();
    const expiryEvidence = await database
      .getPool()
      .query<{ audit_count: string; outbox_count: string }>(
        `SELECT
         (SELECT count(*) FROM audit.events WHERE action='backup.policy.approval_expired' AND target_id=$1)::text AS audit_count,
         (SELECT count(*) FROM integration.outbox_events WHERE event_type='backup.policy.approval_expired' AND aggregate_id=$1)::text AS outbox_count`,
        [draft.id],
      );
    expect(expiryEvidence.rows[0]).toEqual({ audit_count: '1', outbox_count: '1' });
  });

  it('backs up a configured S3-compatible cloud bucket and restores it only to an approved isolated prefix', async () => {
    const environment = {
      BACKUP_ALERT_SMS_RECIPIENTS: '',
      BACKUP_ENCRYPTION_KEY: 'a'.repeat(64),
      BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON: {
        'CLOUD-DOCS-01': {
          accessKeyId: 'test-read-only-access',
          bucket: 'vista-customer-documents',
          endpoint: 'https://s3.example.invalid',
          forcePathStyle: false,
          region: 'eu-central-1',
          secretAccessKey: 'test-deployment-secret',
        },
      },
      BACKUP_PRIMARY_OBJECT_STORAGE_SOURCE_CODE: 'VISTA-FILES-01',
      BACKUP_RESTORE_DATABASE_URL: '',
      BACKUP_S3_BUCKET: 'vista-backups',
      BUSINESS_TIMEZONE: 'Europe/Sofia',
      DATABASE_URL: databaseUrl,
      IDEMPOTENCY_TTL_SECONDS: 86_400,
      S3_BUCKET: 'vista-files',
      SMS_PROVIDER: 'disabled',
    } as unknown as AppEnvironment;
    backup = new BackupService(
      environment,
      database,
      new AuditService(database),
      {} as ObjectStorageService,
    );
    const source = await backup.createSource(
      {
        dataClassification: 'important',
        encryptedAtSource: false,
        location: 'vista-customer-documents',
        name: 'Customer document cloud bucket',
        sourceCode: 'CLOUD-DOCS-01',
        sourceType: 'object_storage',
      },
      'backup-object-source-create-0001',
      actor,
      metadata,
    );
    const draft = await backup.createPolicy(
      {
        backupType: 'full',
        frequency: 'hourly',
        name: 'Vista files hourly copy',
        policyCode: 'VISTA-FILES-HOURLY',
        compressionEnabled: true,
        rpoMinutes: 60,
        rtoMinutes: 240,
        sourceIds: [source.id],
      },
      'backup-object-policy-create-0001',
      actor,
      metadata,
    );
    const requested = await backup.requestPolicyApproval(
      draft.id,
      {
        expectedVersion: draft.version,
        justification: 'Protect Vista files and verify the isolated recovery path.',
      },
      'backup-object-policy-approval-request-0001',
      actor,
      metadata,
    );
    const approval = (await backup.policyApprovalRequests()).items.find(
      (item) => item.policyId === draft.id,
    );
    if (!approval) throw new Error('Object-storage policy approval was not created');
    const approved = await backup.decidePolicyApproval(
      approval.id,
      { decision: 'approve', comment: 'The file-storage source and restore path were reviewed.' },
      'backup-object-policy-approval-decision-0001',
      approver,
      metadata,
    );
    const active = await backup.activatePolicy(
      approved.id,
      { expectedVersion: approved.version },
      'backup-object-policy-activate-0001',
      actor,
      metadata,
    );
    expect(active).toMatchObject({ id: requested.id, status: 'active' });

    const sourceFiles = new Map([
      [
        'partners/demo-evidence.pdf',
        {
          contentType: 'application/pdf',
          etag: '"demo-evidence-v1"',
          value: Buffer.from('%PDF-1.7 Vista backup evidence'),
        },
      ],
      [
        'partners/contract-notes.txt',
        {
          contentType: 'text/plain',
          etag: '"contract-notes-v1"',
          value: Buffer.from('Vista contract notes'),
        },
      ],
    ]);
    const sourceSend = vi.spyOn(S3Client.prototype, 'send').mockImplementation((command) => {
      const request = command as unknown as {
        constructor: { name: string };
        input: Record<string, unknown>;
      };
      const key = typeof request.input['Key'] === 'string' ? request.input['Key'] : '';
      if (request.input['Bucket'] !== 'vista-customer-documents') {
        throw new Error('Unexpected cloud source bucket');
      }
      if (request.constructor.name === 'ListObjectsV2Command') {
        return {
          Contents: [...sourceFiles].map(([sourceKey, file]) => ({
            ETag: file.etag,
            Key: sourceKey,
            Size: file.value.length,
          })),
          IsTruncated: false,
        } as never;
      }
      const file = sourceFiles.get(key);
      if (!file) throw new Error('NoSuchKey');
      if (request.constructor.name === 'HeadObjectCommand') {
        return {
          ContentLength: file.value.length,
          ContentType: file.contentType,
          ETag: file.etag,
        } as never;
      }
      if (request.constructor.name === 'GetObjectCommand') {
        return {
          Body: Readable.from([file.value]),
          ContentLength: file.value.length,
          ETag: file.etag,
        } as never;
      }
      throw new Error(`Unexpected cloud source command ${request.constructor.name}`);
    });
    const backupArtifacts = new Map<string, Buffer>();
    const uploadParts = new Map<string, Buffer[]>();
    const restoredFiles = new Map<string, Buffer>();
    const storage = {
      abortBackupUpload: vi.fn(({ key }: { key: string }) => {
        uploadParts.delete(key);
      }),
      bucketName: () => 'vista-files',
      completeBackupUpload: vi.fn(({ key }: { key: string }) => {
        backupArtifacts.set(key, Buffer.concat(uploadParts.get(key) ?? []));
      }),
      createBackupUpload: vi.fn((key: string) => {
        uploadParts.set(key, []);
        return `upload-${key}`;
      }),
      deleteBackupObject: vi.fn((key: string) => {
        backupArtifacts.delete(key);
      }),
      deleteRestoredFilePrefix: vi.fn((prefix: string) => {
        for (const key of restoredFiles.keys())
          if (key.startsWith(prefix)) restoredFiles.delete(key);
      }),
      describeFileObject: vi.fn((key: string) => {
        const file = sourceFiles.get(key);
        if (!file) throw new Error('NoSuchKey');
        return { contentType: file.contentType, etag: file.etag, size: file.value.length };
      }),
      getBackupObjectStream: vi.fn((key: string) => {
        const artifact = backupArtifacts.get(key);
        if (!artifact) throw new Error('Backup artifact not found');
        return Readable.from([artifact]);
      }),
      copyBackupObjectToIndependentStore: vi.fn(),
      independentCopyConfigured: vi.fn(() => false),
      independentCopyTargetCode: vi.fn(() => 'independent-vault'),
      getFileObjectStream: vi.fn((key: string) => {
        const file = sourceFiles.get(key);
        if (!file) throw new Error('NoSuchKey');
        return { body: Readable.from([file.value]), etag: file.etag, size: file.value.length };
      }),
      listFileObjects: vi.fn(() =>
        [...sourceFiles].map(([key, file]) => ({ etag: file.etag, key, size: file.value.length })),
      ),
      putRestoredFileObject: vi.fn(async (input: { body: Readable; key: string }) => {
        const chunks: Buffer[] = [];
        for await (const chunk of input.body) chunks.push(Buffer.from(chunk));
        restoredFiles.set(input.key, Buffer.concat(chunks));
      }),
      uploadBackupPart: vi.fn((input: { body: Buffer; key: string; partNumber: number }) => {
        uploadParts.get(input.key)?.push(input.body);
        return `etag-${input.partNumber}`;
      }),
    } as unknown as ObjectStorageService;
    const queue = {
      enqueue: vi.fn((input: EnqueueJobInput) => ({
        deduplicated: false,
        jobId: input.idempotencyKey,
      })),
    };
    const execution = new BackupExecutionService(
      environment,
      database,
      storage,
      new AuditService(database),
      queue as never,
      new PostgresBackupDumpRunner(),
    );
    backup = new BackupService(environment, database, new AuditService(database), storage);
    const createActiveFilePolicy = async (
      backupType: 'differential' | 'incremental',
      code: string,
    ) => {
      const draft = await backup.createPolicy(
        {
          backupType,
          compressionEnabled: true,
          frequency: 'hourly',
          name: `${code} object-store backup`,
          policyCode: code,
          rpoMinutes: 1440,
          rtoMinutes: 1440,
          sourceIds: [source.id],
        },
        `${code}-create`,
        actor,
        metadata,
      );
      const approvalRequest = await backup.requestPolicyApproval(
        draft.id,
        {
          expectedVersion: draft.version,
          justification: `Review the ${backupType} recovery chain for ${code}.`,
        },
        `${code}-approval-request`,
        actor,
        metadata,
      );
      const approval = (await backup.policyApprovalRequests()).items.find(
        ({ policyId }) => policyId === approvalRequest.id,
      );
      if (!approval) throw new Error(`The ${code} policy approval was not created`);
      const approved = await backup.decidePolicyApproval(
        approval.id,
        {
          decision: 'approve',
          comment: 'The object-store backup and isolated restore were reviewed.',
        },
        `${code}-approval-decision`,
        approver,
        metadata,
      );
      return backup.activatePolicy(
        approved.id,
        { expectedVersion: approved.version },
        `${code}-activate`,
        actor,
        metadata,
      );
    };
    let objectRunSequence = 0;
    const executeAndVerify = async (policyId: string, code: string) => {
      objectRunSequence += 1;
      const scheduledFor = new Date(Date.now() + objectRunSequence * 1000).toISOString();
      const result = await execution.execute({
        attemptNumber: 1,
        correlationId: `${code}-execution`,
        enqueuedAt: new Date().toISOString(),
        idempotencyKey: `${code}-run:${policyId}:${objectRunSequence}`,
        jobId: `${code}-job-${objectRunSequence}`,
        maxAttempts: 5,
        name: 'backup.execute',
        payload: { policyId, scheduledFor },
        retryAllowed: true,
      });
      const runId = String(result.runId);
      await expect(
        execution.verify({
          attemptNumber: 1,
          correlationId: `${code}-verification`,
          enqueuedAt: new Date().toISOString(),
          idempotencyKey: `${code}-verify:${runId}`,
          jobId: `${code}-verify-${runId}`,
          maxAttempts: 5,
          name: 'backup.verify',
          payload: { runId },
          retryAllowed: true,
        }),
      ).resolves.toMatchObject({ status: 'verified' });
      return runId;
    };
    const scheduledFor = new Date().toISOString();
    const run = await execution.execute({
      attemptNumber: 1,
      correlationId: 'backup-object-execution',
      enqueuedAt: new Date().toISOString(),
      idempotencyKey: `backup-object-run:${active.id}`,
      jobId: 'backup-object-run-1',
      maxAttempts: 5,
      name: 'backup.execute',
      payload: { policyId: active.id, scheduledFor },
      retryAllowed: true,
    });
    expect(run.status).toBe('stored');
    const runId = String(run.runId);
    expect(run).toMatchObject({ compressionAlgorithm: 'gzip' });
    expect(Number(run.uncompressedSizeBytes)).toBeGreaterThan(0);
    const compressionEvidence = await database.getPool().query<{
      artifact_size_bytes: string;
      compression_algorithm: string;
      uncompressed_size_bytes: string;
    }>(
      `SELECT artifact_size_bytes::text,compression_algorithm,uncompressed_size_bytes::text
       FROM backup.execution_runs WHERE id=$1`,
      [runId],
    );
    expect(compressionEvidence.rows[0]).toMatchObject({
      compression_algorithm: 'gzip',
      uncompressed_size_bytes: run.uncompressedSizeBytes,
    });
    await expect(
      database
        .getPool()
        .query(`UPDATE backup.execution_runs SET compression_algorithm='none' WHERE id=$1`, [
          runId,
        ]),
    ).rejects.toThrow('compression format is immutable');
    await expect(
      database
        .getPool()
        .query(
          `UPDATE backup.execution_runs SET source_bucket_snapshot='other-bucket' WHERE id=$1`,
          [runId],
        ),
    ).rejects.toThrow('object source snapshot is immutable');
    const configuredSources = environment.BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON;
    const sourceCallsBeforeRecovery = sourceSend.mock.calls.length;
    environment.BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON = {};
    await expect(
      execution.execute({
        attemptNumber: 2,
        correlationId: 'backup-object-retry',
        enqueuedAt: new Date().toISOString(),
        idempotencyKey: `backup-object-run:${active.id}`,
        jobId: 'backup-object-retry-1',
        maxAttempts: 5,
        name: 'backup.execute',
        payload: { policyId: active.id, scheduledFor },
        retryAllowed: true,
      }),
    ).resolves.toMatchObject({ runId, status: 'stored' });
    const verification = await execution.verify({
      attemptNumber: 1,
      correlationId: 'backup-object-verification',
      enqueuedAt: new Date().toISOString(),
      idempotencyKey: `backup-object-verify:${runId}`,
      jobId: 'backup-object-verify-1',
      maxAttempts: 5,
      name: 'backup.verify',
      payload: { runId },
      retryAllowed: true,
    });
    expect(verification.status).toBe('verified');
    const listedRun = (await backup.executionRuns({ page: 1, pageSize: 50 })).items.find(
      (item) => item.id === runId,
    );
    expect(listedRun).toMatchObject({
      compressionAlgorithm: 'gzip',
      uncompressedSizeBytes: run.uncompressedSizeBytes,
    });

    const fileOptions = await backup.fileRestoreOptions(runId, 'demo-evidence');
    expect(fileOptions).toEqual({
      items: [
        {
          key: 'partners/demo-evidence.pdf',
          sizeBytes: String(sourceFiles.get('partners/demo-evidence.pdf')?.value.length),
        },
      ],
      total: 1,
    });

    const restoreRequest = await backup.requestRestore(
      runId,
      {
        objectKey: 'partners/demo-evidence.pdf',
        reason: 'Check the restored copy of the Vista customer evidence file.',
      },
      'backup-object-restore-request-0001',
      actor,
      metadata,
    );
    expect(restoreRequest).toMatchObject({
      restoreObjectKey: 'partners/demo-evidence.pdf',
      sourceType: 'object_storage',
    });
    await backup.decideRestoreApproval(
      restoreRequest.id,
      { decision: 'approve', comment: 'The isolated object-store destination was reviewed.' },
      'backup-object-restore-approval-0001',
      approver,
      metadata,
    );
    const restoreQueue = {
      enqueue: vi.fn(() => ({ deduplicated: false, jobId: 'restore-1' })),
    };
    const restoreWorker = new BackupRestoreWorkerService(
      environment,
      database,
      storage,
      new AuditService(database),
      restoreQueue as never,
      new PostgresBackupDumpRunner(),
    );
    const restoreApprovedRun = async (sourceRunId: string, code: string) => {
      const requested = await backup.requestRestore(
        sourceRunId,
        { reason: `Verify the isolated ${code} object-store recovery chain.` },
        `${code}-restore-request`,
        actor,
        metadata,
      );
      await backup.decideRestoreApproval(
        requested.id,
        { decision: 'approve', comment: 'The selected object-store recovery point was reviewed.' },
        `${code}-restore-approval`,
        approver,
        metadata,
      );
      await restoreWorker.dispatchApprovedRestores();
      return restoreWorker.execute({
        attemptNumber: 1,
        correlationId: `${code}-restore`,
        enqueuedAt: new Date().toISOString(),
        idempotencyKey: `${code}-restore:${requested.id}`,
        jobId: `${code}-restore-${requested.id}`,
        maxAttempts: 5,
        name: 'backup.restore.execute',
        payload: { restoreRequestId: requested.id },
        retryAllowed: true,
      });
    };
    await expect(restoreWorker.dispatchApprovedRestores()).resolves.toEqual({
      deduplicatedCount: 0,
      enqueuedCount: 1,
    });
    expect(restoreQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'backup.restore.execute',
        payload: { restoreRequestId: restoreRequest.id },
      }),
    );
    const restored = await restoreWorker.execute({
      attemptNumber: 1,
      correlationId: 'backup-object-restore',
      enqueuedAt: new Date().toISOString(),
      idempotencyKey: `backup-object-restore:${restoreRequest.id}`,
      jobId: 'backup-object-restore-1',
      maxAttempts: 5,
      name: 'backup.restore.execute',
      payload: { restoreRequestId: restoreRequest.id },
      retryAllowed: true,
    });
    expect(restored).toMatchObject({
      objectCount: 1,
      restoredObjectKey: 'partners/demo-evidence.pdf',
      status: 'completed',
    });
    const targetPrefix = String(restored.targetStoragePrefix);
    expect(targetPrefix).toMatch(/^restores\/[a-f0-9]{32}\/attempt-1\/$/u);
    expect(restoredFiles.get(`${targetPrefix}partners/demo-evidence.pdf`)).toEqual(
      sourceFiles.get('partners/demo-evidence.pdf')?.value,
    );
    expect(sourceFiles.get('partners/demo-evidence.pdf')?.value).toEqual(
      Buffer.from('%PDF-1.7 Vista backup evidence'),
    );
    const completedRestore = (await backup.restoreRequests()).items.find(
      ({ id }) => id === restoreRequest.id,
    );
    expect(completedRestore).toMatchObject({
      id: restoreRequest.id,
      restoreObjectKey: 'partners/demo-evidence.pdf',
      sourceType: 'object_storage',
      status: 'completed',
      targetStorageBucket: 'vista-backups',
      targetStoragePrefix: targetPrefix,
    });

    const fullRestoreRequest = await backup.requestRestore(
      runId,
      {
        reason: 'Recover the complete file-store snapshot in isolation.',
      },
      'backup-object-full-restore-request-0001',
      actor,
      metadata,
    );
    expect(fullRestoreRequest.restoreObjectKey).toBeUndefined();
    await backup.decideRestoreApproval(
      fullRestoreRequest.id,
      { decision: 'approve', comment: 'The complete snapshot remains isolated.' },
      'backup-object-full-restore-approval-0001',
      approver,
      metadata,
    );
    await expect(restoreWorker.dispatchApprovedRestores()).resolves.toEqual({
      deduplicatedCount: 0,
      enqueuedCount: 1,
    });
    const fullRestore = await restoreWorker.execute({
      attemptNumber: 1,
      correlationId: 'backup-object-full-restore',
      enqueuedAt: new Date().toISOString(),
      idempotencyKey: `backup-object-full-restore:${fullRestoreRequest.id}`,
      jobId: 'backup-object-full-restore-1',
      maxAttempts: 5,
      name: 'backup.restore.execute',
      payload: { restoreRequestId: fullRestoreRequest.id },
      retryAllowed: true,
    });
    expect(fullRestore).toMatchObject({ objectCount: 2, status: 'completed' });
    const fullTargetPrefix = String(fullRestore.targetStoragePrefix);
    expect(restoredFiles.get(`${fullTargetPrefix}partners/demo-evidence.pdf`)).toEqual(
      sourceFiles.get('partners/demo-evidence.pdf')?.value,
    );
    expect(restoredFiles.get(`${fullTargetPrefix}partners/contract-notes.txt`)).toEqual(
      sourceFiles.get('partners/contract-notes.txt')?.value,
    );
    expect(restoredFiles.get(`${targetPrefix}partners/contract-notes.txt`)).toBeUndefined();
    expect(sourceSend).toHaveBeenCalledTimes(sourceCallsBeforeRecovery);
    environment.BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON = configuredSources;

    sourceFiles.set('partners/unchanged.txt', {
      contentType: 'text/plain',
      etag: '"unchanged-v1"',
      value: Buffer.from('carry this object forward'),
    });
    const incrementalPolicy = await createActiveFilePolicy(
      'incremental',
      'VISTA-FILES-INCREMENTAL',
    );
    const incrementalBaseId = await executeAndVerify(
      incrementalPolicy.id,
      'backup-object-incremental-base',
    );
    const incrementalBase = await database.getPool().query<{
      backup_type: string;
      source_manifest: { format?: string } | null;
    }>(`SELECT backup_type,source_manifest FROM backup.execution_runs WHERE id=$1`, [incrementalBaseId]);
    expect(incrementalBase.rows[0]).toMatchObject({
      backup_type: 'full',
      source_manifest: { format: 'vista-object-store-backup-v3' },
    });

    sourceFiles.set('partners/contract-notes.txt', {
      contentType: 'text/plain',
      etag: '"contract-notes-v2"',
      value: Buffer.from('Revised contract notes'),
    });
    sourceFiles.delete('partners/demo-evidence.pdf');
    sourceFiles.set('partners/new-evidence.pdf', {
      contentType: 'application/pdf',
      etag: '"new-evidence-v1"',
      value: Buffer.from('%PDF-1.7 new evidence'),
    });
    const incrementalRunId = await executeAndVerify(
      incrementalPolicy.id,
      'backup-object-incremental-delta',
    );
    const incrementalEvidence = await database.getPool().query<{
      backup_type: string;
      parent_run_id: string | null;
      source_manifest: { backupType?: string; deletedKeys?: string[]; format?: string } | null;
    }>(
      `SELECT backup_type,parent_run_id,source_manifest
       FROM backup.execution_runs WHERE id=$1`,
      [incrementalRunId],
    );
    expect(incrementalEvidence.rows[0]).toMatchObject({
      backup_type: 'incremental',
      parent_run_id: incrementalBaseId,
      source_manifest: {
        backupType: 'incremental',
        deletedKeys: ['partners/demo-evidence.pdf'],
        format: 'vista-object-store-backup-v3',
      },
    });
    const incrementalCatalog = await backup.fileRestoreOptions(incrementalRunId, 'partners');
    expect(incrementalCatalog.items.map(({ key }) => key).sort()).toEqual([
      'partners/contract-notes.txt',
      'partners/new-evidence.pdf',
      'partners/unchanged.txt',
    ]);
    await expect(
      backup.requestArtifactDeletion(
        incrementalBaseId,
        { reason: 'This base must remain for the later object-store restore.' },
        'backup-object-incremental-base-delete',
        actor,
        metadata,
      ),
    ).rejects.toThrow('This restore point is a base for a later backup.');

    const incrementalRestore = await restoreApprovedRun(
      incrementalRunId,
      'backup-object-incremental',
    );
    expect(incrementalRestore).toMatchObject({ objectCount: 3, status: 'completed' });
    const incrementalPrefix = String(incrementalRestore.targetStoragePrefix);
    expect(restoredFiles.get(`${incrementalPrefix}partners/contract-notes.txt`)).toEqual(
      Buffer.from('Revised contract notes'),
    );
    expect(restoredFiles.get(`${incrementalPrefix}partners/unchanged.txt`)).toEqual(
      Buffer.from('carry this object forward'),
    );
    expect(restoredFiles.get(`${incrementalPrefix}partners/new-evidence.pdf`)).toEqual(
      Buffer.from('%PDF-1.7 new evidence'),
    );
    expect(restoredFiles.has(`${incrementalPrefix}partners/demo-evidence.pdf`)).toBe(false);
    expect(sourceFiles.has('partners/demo-evidence.pdf')).toBe(false);

    const differentialPolicy = await createActiveFilePolicy(
      'differential',
      'VISTA-FILES-DIFFERENTIAL',
    );
    const differentialBaseId = await executeAndVerify(
      differentialPolicy.id,
      'backup-object-differential-base',
    );
    const baselineContract = sourceFiles.get('partners/contract-notes.txt');
    if (!baselineContract) throw new Error('The contract fixture must exist in the full baseline');
    sourceFiles.set('partners/contract-notes.txt', {
      contentType: 'text/plain',
      etag: '"contract-notes-temporary"',
      value: Buffer.from('temporary contract revision'),
    });
    sourceFiles.set('partners/differential-temporary.txt', {
      contentType: 'text/plain',
      etag: '"differential-temporary-v1"',
      value: Buffer.from('created after the full baseline'),
    });
    const firstDifferentialId = await executeAndVerify(
      differentialPolicy.id,
      'backup-object-differential-first',
    );
    sourceFiles.set('partners/contract-notes.txt', baselineContract);
    sourceFiles.delete('partners/unchanged.txt');
    sourceFiles.delete('partners/differential-temporary.txt');
    sourceFiles.set('partners/differential-final.txt', {
      contentType: 'text/plain',
      etag: '"differential-final-v1"',
      value: Buffer.from('present in the selected differential snapshot'),
    });
    const differentialRunId = await executeAndVerify(
      differentialPolicy.id,
      'backup-object-differential-latest',
    );
    const differentialEvidence = await database.getPool().query<{
      backup_type: string;
      parent_run_id: string | null;
      source_manifest: {
        backupType?: string;
        deletedKeys?: string[];
        format?: string;
        objects?: Array<{ contentIncluded?: boolean; key: string }>;
      } | null;
    }>(
      `SELECT backup_type,parent_run_id,source_manifest
       FROM backup.execution_runs WHERE id=$1`,
      [differentialRunId],
    );
    expect(differentialEvidence.rows[0]).toMatchObject({
      backup_type: 'differential',
      parent_run_id: differentialBaseId,
      source_manifest: {
        backupType: 'differential',
        deletedKeys: ['partners/unchanged.txt'],
        format: 'vista-object-store-backup-v3',
      },
    });
    expect(
      differentialEvidence.rows[0]?.source_manifest?.objects?.find(
        ({ key }) => key === 'partners/contract-notes.txt',
      )?.contentIncluded,
    ).toBe(false);
    expect(firstDifferentialId).not.toBe(differentialBaseId);
    const differentialRestore = await restoreApprovedRun(
      differentialRunId,
      'backup-object-differential',
    );
    expect(differentialRestore).toMatchObject({ objectCount: 3, status: 'completed' });
    const differentialPrefix = String(differentialRestore.targetStoragePrefix);
    expect(restoredFiles.get(`${differentialPrefix}partners/contract-notes.txt`)).toEqual(
      Buffer.from('Revised contract notes'),
    );
    expect(restoredFiles.get(`${differentialPrefix}partners/differential-final.txt`)).toEqual(
      Buffer.from('present in the selected differential snapshot'),
    );
    expect(restoredFiles.has(`${differentialPrefix}partners/unchanged.txt`)).toBe(false);
    expect(restoredFiles.has(`${differentialPrefix}partners/differential-temporary.txt`)).toBe(
      false,
    );
    expect(sourceFiles.get('partners/contract-notes.txt')?.value).toEqual(
      Buffer.from('Revised contract notes'),
    );
    const originalSource = configuredSources['CLOUD-DOCS-01'];
    if (!originalSource) throw new Error('The cloud-source fixture must be configured');
    environment.BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON = {
      ...configuredSources,
      'CLOUD-DOCS-01': { ...originalSource, endpoint: 'https://other-s3.example.invalid' },
    };
    const replacementBaseId = await executeAndVerify(
      incrementalPolicy.id,
      'backup-object-replaced-source',
    );
    const identities = await database.getPool().query<{
      backup_type: string;
      id: string;
      parent_run_id: string | null;
      source_bucket_snapshot: string | null;
      source_identity_snapshot: string | null;
    }>(
      `SELECT id,backup_type,parent_run_id,source_bucket_snapshot,source_identity_snapshot
       FROM backup.execution_runs WHERE id=ANY($1::uuid[])`,
      [[incrementalBaseId, replacementBaseId]],
    );
    const previousBase = identities.rows.find(({ id }) => id === incrementalBaseId);
    const replacementBase = identities.rows.find(({ id }) => id === replacementBaseId);
    expect(replacementBase).toMatchObject({
      backup_type: 'full',
      parent_run_id: null,
      source_bucket_snapshot: 'vista-customer-documents',
    });
    expect(replacementBase?.source_identity_snapshot).not.toBe(
      previousBase?.source_identity_snapshot,
    );
  });

  webDavCloudBackupTest = async () => {
    const rootPath = '/dav/team/Shared/';
    const sourceFiles = new Map([
      ['invoice.pdf', Buffer.from('%PDF-1.7 WebDAV invoice')],
      ['notes.txt', Buffer.from('cloud service notes')],
    ]);
    const sourceEtags = new Map([
      ['invoice.pdf', '"invoice-v1"'],
      ['notes.txt', '"notes-v1"'],
    ]);
    const environment = {
      BACKUP_ALERT_SMS_RECIPIENTS: '',
      BACKUP_ENCRYPTION_KEY: 'a'.repeat(64),
      BACKUP_RESTORE_DATABASE_URL: '',
      BACKUP_S3_BUCKET: 'vista-backups',
      BACKUP_WEBDAV_SOURCE_CONFIGS_JSON: {
        'CLOUD-DAV-01': {
          endpoint: 'http://cloud.example.invalid/dav/team/',
          password: 'integration-secret-only',
          username: 'backup-reader',
        },
      },
      BUSINESS_TIMEZONE: 'Europe/Sofia',
      DATABASE_URL: databaseUrl,
      IDEMPOTENCY_TTL_SECONDS: 86_400,
      S3_BUCKET: 'vista-files',
      SMS_PROVIDER: 'disabled',
      VISTA_DEPLOYMENT_STAGE: 'local',
    } as unknown as AppEnvironment;
    const storageArtifacts = new Map<string, Buffer>();
    const uploads = new Map<string, Buffer[]>();
    const restoredFiles = new Map<string, Buffer>();
    const storage = {
      abortBackupUpload: vi.fn(({ key }: { key: string }) => uploads.delete(key)),
      bucketName: () => 'vista-backups',
      completeBackupUpload: vi.fn(({ key }: { key: string }) => {
        storageArtifacts.set(key, Buffer.concat(uploads.get(key) ?? []));
      }),
      createBackupUpload: vi.fn((key: string) => {
        uploads.set(key, []);
        return `upload-${key}`;
      }),
      deleteRestoredFilePrefix: vi.fn((prefix: string) => {
        for (const key of restoredFiles.keys()) {
          if (key.startsWith(prefix)) restoredFiles.delete(key);
        }
      }),
      getBackupObjectStream: vi.fn((key: string) => {
        const artifact = storageArtifacts.get(key);
        if (!artifact) throw new Error('Backup artifact not found');
        return Readable.from([artifact]);
      }),
      independentCopyConfigured: vi.fn(() => false),
      putRestoredFileObject: vi.fn(async ({ body, key }: { body: Readable; key: string }) => {
        const chunks: Buffer[] = [];
        for await (const chunk of body) chunks.push(Buffer.from(chunk));
        restoredFiles.set(key, Buffer.concat(chunks));
      }),
      uploadBackupPart: vi.fn(
        ({ body, key, partNumber }: { body: Buffer; key: string; partNumber: number }) => {
          uploads.get(key)?.push(body);
          return `etag-${partNumber}`;
        },
      ),
    } as unknown as ObjectStorageService;
    const audit = new AuditService(database);
    backup = new BackupService(environment, database, audit, storage);
    const source = await backup.createSource(
      {
        dataClassification: 'important',
        encryptedAtSource: true,
        location: 'Shared',
        name: 'Cloud shared documents',
        sourceCode: 'CLOUD-DAV-01',
        sourceType: 'cloud_service',
      },
      'backup-webdav-source-create-0001',
      actor,
      metadata,
    );
    const draft = await backup.createPolicy(
      {
        backupType: 'incremental',
        compressionEnabled: true,
        frequency: 'hourly',
        name: 'Cloud shared documents hourly copy',
        policyCode: 'CLOUD-DAV-HOURLY',
        rpoMinutes: 1440,
        rtoMinutes: 1440,
        sourceIds: [source.id],
      },
      'backup-webdav-policy-create-0001',
      actor,
      metadata,
    );
    const approvalRequest = await backup.requestPolicyApproval(
      draft.id,
      {
        expectedVersion: draft.version,
        justification: 'Protect the configured cloud folder and check isolated recovery.',
      },
      'backup-webdav-policy-approval-request-0001',
      actor,
      metadata,
    );
    const approval = (await backup.policyApprovalRequests()).items.find(
      ({ policyId }) => policyId === approvalRequest.id,
    );
    if (!approval) throw new Error('The WebDAV backup approval was not created');
    const approved = await backup.decidePolicyApproval(
      approval.id,
      { decision: 'approve', comment: 'The cloud folder and isolated recovery were reviewed.' },
      'backup-webdav-policy-approval-decision-0001',
      approver,
      metadata,
    );
    const active = await backup.activatePolicy(
      approved.id,
      { expectedVersion: approved.version },
      'backup-webdav-policy-activate-0001',
      actor,
      metadata,
    );
    const webDavFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      await Promise.resolve();
      const requestUrl = input instanceof Request ? input.url : input.toString();
      const url = new URL(requestUrl);
      if (url.origin !== 'http://cloud.example.invalid') {
        throw new Error('Unexpected outbound cloud request');
      }
      if (init?.method === 'PROPFIND') {
        const entries =
          url.pathname === rootPath
            ? [
                davXmlEntry(rootPath, { collection: true }),
                ...[...sourceFiles].map(([key, content]) =>
                  davXmlEntry(`${rootPath}${key}`, {
                    contentType: key.endsWith('.pdf') ? 'application/pdf' : 'text/plain',
                    etag: sourceEtags.get(key) ?? '',
                    size: content.length,
                  }),
                ),
              ]
            : [...sourceFiles]
                .filter(([key]) => `${rootPath}${key}` === url.pathname)
                .map(([key, content]) =>
                  davXmlEntry(url.pathname, {
                    contentType: key.endsWith('.pdf') ? 'application/pdf' : 'text/plain',
                    etag: sourceEtags.get(key) ?? '',
                    size: content.length,
                  }),
                );
        return new Response(
          `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${entries.join('')}</d:multistatus>`,
          {
            status: 207,
          },
        );
      }
      if (init?.method === 'GET') {
        const key = url.pathname.slice(rootPath.length);
        const content = sourceFiles.get(key);
        if (!content) return new Response(null, { status: 404 });
        return new Response(content, {
          headers: {
            'content-length': String(content.length),
            etag: sourceEtags.get(key) ?? '',
          },
        });
      }
      return new Response(null, { status: 405 });
    });
    expect(webDavFetch).toBeDefined();
    const queue = {
      enqueue: vi.fn((input: EnqueueJobInput) => ({
        deduplicated: false,
        jobId: input.idempotencyKey,
      })),
    };
    const execution = new BackupExecutionService(
      environment,
      database,
      storage,
      audit,
      queue as never,
      new PostgresBackupDumpRunner(),
    );
    const executionContext = {
      attemptNumber: 1,
      correlationId: 'backup-webdav-e2e',
      enqueuedAt: new Date().toISOString(),
      idempotencyKey: 'backup-webdav-run-0001',
      jobId: 'backup-webdav-job-0001',
      maxAttempts: 5,
      name: 'backup.execute',
      payload: { policyId: active.id, scheduledFor: new Date(Date.now() + 60_000).toISOString() },
      retryAllowed: true,
    };
    const stored = await execution.execute(executionContext);
    const runId = String(stored.runId);
    await expect(
      execution.verify({
        ...executionContext,
        idempotencyKey: 'backup-webdav-verify-0001',
        jobId: 'backup-webdav-verify-job-0001',
        name: 'backup.verify',
        payload: { runId },
      }),
    ).resolves.toMatchObject({ status: 'verified' });
    const manifest = await backup.fileRestoreOptions(runId, 'invoice');
    expect(manifest.items).toEqual([
      { key: 'invoice.pdf', sizeBytes: String(sourceFiles.get('invoice.pdf')?.length) },
    ]);

    const restoreRequest = await backup.requestRestore(
      runId,
      {
        objectKey: 'invoice.pdf',
        reason: 'Recover this invoice into isolated storage for review.',
      },
      'backup-webdav-restore-request-0001',
      actor,
      metadata,
    );
    await backup.decideRestoreApproval(
      restoreRequest.id,
      { decision: 'approve', comment: 'The isolated recovery location was reviewed.' },
      'backup-webdav-restore-approval-0001',
      approver,
      metadata,
    );
    const restoreWorker = new BackupRestoreWorkerService(
      environment,
      database,
      storage,
      audit,
      queue as never,
      new PostgresBackupDumpRunner(),
    );
    const restored = await restoreWorker.execute({
      ...executionContext,
      idempotencyKey: `backup-webdav-restore:${restoreRequest.id}`,
      jobId: `backup-webdav-restore-${restoreRequest.id}`,
      name: 'backup.restore.execute',
      payload: { restoreRequestId: restoreRequest.id },
    });
    expect(restored).toMatchObject({
      objectCount: 1,
      restoredObjectKey: 'invoice.pdf',
      status: 'completed',
    });
    const targetPrefix = String(restored.targetStoragePrefix);
    expect(restoredFiles.get(`${targetPrefix}invoice.pdf`)).toEqual(sourceFiles.get('invoice.pdf'));
    expect(restoredFiles.has(`${targetPrefix}notes.txt`)).toBe(false);
    expect(sourceFiles.get('invoice.pdf')).toEqual(Buffer.from('%PDF-1.7 WebDAV invoice'));
  };

  it('backs up a server snapshot from a mounted folder and restores it to isolated storage', async () => {
    const fileShareRoot = await mkdtemp(join(tmpdir(), 'vista-backup-share-e2e-'));
    fileShareRoots.push(fileShareRoot);
    const financeFolder = join(fileShareRoot, 'finance');
    await mkdir(join(financeFolder, 'reports'), { recursive: true });
    await writeFile(join(financeFolder, 'reports', 'monthly.csv'), 'month,total\nOctober,42\n');
    await writeFile(join(financeFolder, 'notes.txt'), 'Do not overwrite the source folder.');

    const source = await backup.createSource(
      {
        dataClassification: 'important',
        encryptedAtSource: false,
        location: 'finance',
        name: 'Mounted finance share',
        sourceCode: 'VISTA-FINANCE-SHARE',
        sourceType: 'server',
      },
      'backup-share-source-create-0001',
      actor,
      metadata,
    );
    const draft = await backup.createPolicy(
      {
        backupType: 'full',
        compressionEnabled: true,
        frequency: 'hourly',
        name: 'Finance share hourly backup',
        policyCode: 'FINANCE-SHARE-HOURLY',
        rpoMinutes: 1440,
        rtoMinutes: 1440,
        sourceIds: [source.id],
      },
      'backup-share-policy-create-0001',
      actor,
      metadata,
    );
    const environment = {
      BACKUP_ALERT_SMS_RECIPIENTS: '',
      BACKUP_ENCRYPTION_KEY: 'a'.repeat(64),
      BACKUP_FILE_SOURCE_ROOT: fileShareRoot,
      BACKUP_RESTORE_DATABASE_URL: '',
      BACKUP_S3_BUCKET: 'vista-backups',
      BUSINESS_TIMEZONE: 'Europe/Sofia',
      DATABASE_URL: databaseUrl,
      IDEMPOTENCY_TTL_SECONDS: 86_400,
      SMS_PROVIDER: 'disabled',
    } as AppEnvironment;
    const backupWithSourceRoot = new BackupService(
      environment,
      database,
      new AuditService(database),
      {} as ObjectStorageService,
    );
    const backupWithoutSourceRoot = new BackupService(
      { ...environment, BACKUP_FILE_SOURCE_ROOT: '' },
      database,
      new AuditService(database),
      {} as ObjectStorageService,
    );
    await expect(
      backupWithoutSourceRoot.requestPolicyApproval(
        draft.id,
        {
          expectedVersion: draft.version,
          justification: 'Protect the mounted finance share and test its recovery path.',
        },
        'backup-share-policy-approval-no-root-0001',
        actor,
        metadata,
      ),
    ).rejects.toThrow('read-only snapshot folder');
    const requested = await backupWithSourceRoot.requestPolicyApproval(
      draft.id,
      {
        expectedVersion: draft.version,
        justification: 'Protect the mounted finance share and test its recovery path.',
      },
      'backup-share-policy-approval-request-0001',
      actor,
      metadata,
    );
    const approval = (await backup.policyApprovalRequests()).items.find(
      (item) => item.policyId === draft.id,
    );
    if (!approval) throw new Error('Shared-folder policy approval was not created');
    const approved = await backupWithSourceRoot.decidePolicyApproval(
      approval.id,
      {
        decision: 'approve',
        comment: 'The mounted share and isolated restore path were reviewed.',
      },
      'backup-share-policy-approval-decision-0001',
      approver,
      metadata,
    );
    const active = await backupWithSourceRoot.activatePolicy(
      approved.id,
      { expectedVersion: approved.version },
      'backup-share-policy-activate-0001',
      actor,
      metadata,
    );
    expect(active).toMatchObject({ id: requested.id, status: 'active' });

    const artifacts = new Map<string, Buffer>();
    const uploadParts = new Map<string, Buffer[]>();
    const restoredFiles = new Map<string, Buffer>();
    const deleteBackupObject = vi.fn((key: string) => {
      artifacts.delete(key);
    });
    const storage = {
      abortBackupUpload: vi.fn(({ key }: { key: string }) => {
        uploadParts.delete(key);
      }),
      bucketName: () => 'vista-files',
      completeBackupUpload: vi.fn(({ key }: { key: string }) => {
        artifacts.set(key, Buffer.concat(uploadParts.get(key) ?? []));
      }),
      createBackupUpload: vi.fn((key: string) => {
        uploadParts.set(key, []);
        return `upload-${key}`;
      }),
      deleteBackupObject,
      deleteRestoredFilePrefix: vi.fn((prefix: string) => {
        for (const key of restoredFiles.keys()) {
          if (key.startsWith(prefix)) restoredFiles.delete(key);
        }
      }),
      getBackupObjectStream: vi.fn((key: string) => {
        const artifact = artifacts.get(key);
        if (!artifact) throw new Error('Backup artifact not found');
        return Readable.from([artifact]);
      }),
      copyBackupObjectToIndependentStore: vi.fn(),
      independentCopyConfigured: vi.fn(() => false),
      independentCopyTargetCode: vi.fn(() => 'independent-vault'),
      putRestoredFileObject: vi.fn(async (input: { body: Readable; key: string }) => {
        const chunks: Buffer[] = [];
        for await (const chunk of input.body) chunks.push(Buffer.from(chunk));
        restoredFiles.set(input.key, Buffer.concat(chunks));
      }),
      uploadBackupPart: vi.fn(
        ({ body, key, partNumber }: { body: Buffer; key: string; partNumber: number }) => {
          uploadParts.get(key)?.push(body);
          return `etag-${partNumber}`;
        },
      ),
    } as unknown as ObjectStorageService;
    const queue = {
      enqueue: vi.fn((input: EnqueueJobInput) => ({
        deduplicated: false,
        jobId: input.idempotencyKey,
      })),
    };
    const execution = new BackupExecutionService(
      environment,
      database,
      storage,
      new AuditService(database),
      queue as never,
      new PostgresBackupDumpRunner(),
    );
    const scheduledFor = new Date().toISOString();
    const executionContext = {
      attemptNumber: 1,
      correlationId: 'backup-share-execution',
      enqueuedAt: new Date().toISOString(),
      idempotencyKey: `backup-share-run:${active.id}`,
      jobId: 'backup-share-run-1',
      maxAttempts: 5,
      name: 'backup.execute',
      payload: { policyId: active.id, scheduledFor },
      retryAllowed: true,
    } as const;
    const run = await execution.execute(executionContext);
    expect(run).toMatchObject({ compressionAlgorithm: 'gzip', status: 'stored' });
    const runId = String(run.runId);
    await execution.verify({
      ...executionContext,
      idempotencyKey: `backup-share-verify:${runId}`,
      jobId: 'backup-share-verify-1',
      name: 'backup.verify',
      payload: { runId },
    });
    const verifiedRun = (
      await backupWithSourceRoot.executionRuns({ page: 1, pageSize: 50 })
    ).items.find(({ id }) => id === runId);
    expect(verifiedRun).toMatchObject({ sourceType: 'file_share', status: 'verified' });

    const backupWithArtifactStorage = new BackupService(
      environment,
      database,
      new AuditService(database),
      storage,
    );
    const files = await backupWithArtifactStorage.fileRestoreOptions(runId, 'monthly');
    expect(files).toEqual({
      items: [
        {
          key: 'reports/monthly.csv',
          sizeBytes: String(Buffer.byteLength('month,total\nOctober,42\n')),
        },
      ],
      total: 1,
    });
    await writeFile(join(financeFolder, 'reports', 'monthly.csv'), 'changed after the backup');

    const fileRequest = await backupWithSourceRoot.requestRestore(
      runId,
      {
        objectKey: 'reports/monthly.csv',
        reason: 'Recover the verified monthly finance report into isolation.',
      },
      'backup-share-file-restore-request-0001',
      actor,
      metadata,
    );
    await backupWithSourceRoot.decideRestoreApproval(
      fileRequest.id,
      { decision: 'approve', comment: 'The selected file will be restored separately.' },
      'backup-share-file-restore-approval-0001',
      approver,
      metadata,
    );
    const restoreQueue = {
      enqueue: vi.fn(() => ({ deduplicated: false, jobId: 'restore-share-1' })),
    };
    const restoreWorker = new BackupRestoreWorkerService(
      environment,
      database,
      storage,
      new AuditService(database),
      restoreQueue as never,
      new PostgresBackupDumpRunner(),
    );
    await expect(restoreWorker.dispatchApprovedRestores()).resolves.toEqual({
      deduplicatedCount: 0,
      enqueuedCount: 1,
    });
    const restored = await restoreWorker.execute({
      attemptNumber: 1,
      correlationId: 'backup-share-file-restore',
      enqueuedAt: new Date().toISOString(),
      idempotencyKey: `backup-share-file-restore:${fileRequest.id}`,
      jobId: 'backup-share-file-restore-1',
      maxAttempts: 5,
      name: 'backup.restore.execute',
      payload: { restoreRequestId: fileRequest.id },
      retryAllowed: true,
    });
    expect(restored).toMatchObject({
      objectCount: 1,
      restoredObjectKey: 'reports/monthly.csv',
      status: 'completed',
    });
    const fileTargetPrefix = String(restored.targetStoragePrefix);
    expect(restoredFiles.get(`${fileTargetPrefix}reports/monthly.csv`)).toEqual(
      Buffer.from('month,total\nOctober,42\n'),
    );
    expect(await readFile(join(financeFolder, 'reports', 'monthly.csv'), 'utf8')).toBe(
      'changed after the backup',
    );

    const fullRequest = await backupWithSourceRoot.requestRestore(
      runId,
      { reason: 'Recover the full finance share snapshot into isolation.' },
      'backup-share-full-restore-request-0001',
      actor,
      metadata,
    );
    await backupWithSourceRoot.decideRestoreApproval(
      fullRequest.id,
      { decision: 'approve', comment: 'The complete finance share copy stays isolated.' },
      'backup-share-full-restore-approval-0001',
      approver,
      metadata,
    );
    const fullRestore = await restoreWorker.execute({
      attemptNumber: 1,
      correlationId: 'backup-share-full-restore',
      enqueuedAt: new Date().toISOString(),
      idempotencyKey: `backup-share-full-restore:${fullRequest.id}`,
      jobId: 'backup-share-full-restore-1',
      maxAttempts: 5,
      name: 'backup.restore.execute',
      payload: { restoreRequestId: fullRequest.id },
      retryAllowed: true,
    });
    expect(fullRestore).toMatchObject({ objectCount: 2, status: 'completed' });
    const fullTargetPrefix = String(fullRestore.targetStoragePrefix);
    expect(restoredFiles.get(`${fullTargetPrefix}notes.txt`)).toEqual(
      Buffer.from('Do not overwrite the source folder.'),
    );
    expect(restoredFiles.get(`${fullTargetPrefix}reports/monthly.csv`)).toEqual(
      Buffer.from('month,total\nOctober,42\n'),
    );

    const migrationDirectory = fileURLToPath(
      new URL('../src/database/migrations', import.meta.url),
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0120_backup_database_engine',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0119_backup_webdav_cloud_source',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0118_backup_email_source',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).rejects.toThrow(
      'Cannot remove object-storage source identity while backup evidence exists',
    );
    await expect(migrateUp(databasePool, migrationDirectory)).resolves.toEqual([
      '0118_backup_email_source',
      '0119_backup_webdav_cloud_source',
      '0120_backup_database_engine',
    ]);

    const deletionRequest = await backupWithArtifactStorage.requestArtifactDeletion(
      runId,
      { reason: 'This temporary finance-share snapshot is no longer needed.' },
      'backup-share-artifact-deletion-request-0001',
      actor,
      metadata,
    );
    expect(deletionRequest.status).toBe('pending_approval');
    expect(artifacts.size).toBeGreaterThan(0);
    await expect(
      backupWithArtifactStorage.decideArtifactDeletion(
        deletionRequest.id,
        { decision: 'approve' },
        'backup-share-artifact-deletion-self-approval-0001',
        actor,
        metadata,
      ),
    ).rejects.toThrow('A different authorised person must review this restore-point deletion.');
    await expect(
      backupWithArtifactStorage.requestRestore(
        runId,
        { reason: 'Restore the snapshot while its removal request is awaiting review.' },
        'backup-share-restore-during-deletion-0001',
        actor,
        metadata,
      ),
    ).rejects.toThrow('This restore point has a removal request in progress');
    await expect(
      backupWithArtifactStorage.decideArtifactDeletion(
        deletionRequest.id,
        { decision: 'approve', comment: 'The separate backup copy is no longer needed.' },
        'backup-share-artifact-deletion-approval-0001',
        approver,
        metadata,
      ),
    ).resolves.toMatchObject({
      approvedByName: 'Backup Integration Reviewer',
      id: deletionRequest.id,
      status: 'approved',
    });
    deleteBackupObject.mockImplementationOnce(() => {
      throw new Error('Temporary object-store failure');
    });
    const deletionJobContext = {
      attemptNumber: 1,
      correlationId: 'backup-share-artifact-deletion-dispatch',
      enqueuedAt: new Date().toISOString(),
      idempotencyKey: 'backup-share-artifact-deletion-dispatch-0001',
      jobId: 'backup-share-artifact-deletion-dispatch-1',
      maxAttempts: 5,
      name: 'backup.restore.dispatch',
      payload: {},
      retryAllowed: true,
    } as const;
    await expect(execution.dispatchApprovedArtifactDeletions(deletionJobContext)).resolves.toEqual({
      completedCount: 0,
      failedCount: 1,
      processedCount: 1,
      retryScheduledCount: 0,
    });
    expect(artifacts.size).toBeGreaterThan(0);
    const failedDeletion = await database.getPool().query<{
      attempt_count: number;
      error_code: string;
      status: string;
    }>(
      `SELECT attempt_count,error_code,status
       FROM backup.artifact_deletion_requests WHERE id=$1`,
      [deletionRequest.id],
    );
    expect(failedDeletion.rows[0]).toMatchObject({
      attempt_count: 1,
      error_code: 'BACKUP_ARTIFACT_DELETE_FAILED',
      status: 'failed',
    });
    await expect(
      execution.dispatchApprovedArtifactDeletions({
        ...deletionJobContext,
        idempotencyKey: 'backup-share-artifact-deletion-dispatch-0002',
        jobId: 'backup-share-artifact-deletion-dispatch-2',
      }),
    ).resolves.toEqual({
      completedCount: 1,
      failedCount: 0,
      processedCount: 1,
      retryScheduledCount: 0,
    });
    expect(artifacts.size).toBe(0);
    const deletedRun = (
      await backupWithArtifactStorage.executionRuns({ page: 1, pageSize: 50 })
    ).items.find((item) => item.id === runId);
    expect(deletedRun).toMatchObject({
      artifactAvailable: false,
      artifactDeletedReason: 'approved_restore_point_deletion',
      id: runId,
    });
    await expect(
      backupWithArtifactStorage.requestRestore(
        runId,
        { reason: 'Restore the removed finance-share snapshot.' },
        'backup-share-restore-after-deletion-0001',
        actor,
        metadata,
      ),
    ).rejects.toThrow(
      'Only a verified backup with a configured isolated restore target can be restored.',
    );
    const deletionEvidence = await database.getPool().query<{
      approval_status: string;
      event_types: string[];
      request_status: string;
    }>(
      `SELECT approval.status AS approval_status,request.status AS request_status,
          ARRAY(SELECT event.event_type FROM backup.artifact_deletion_events event
                WHERE event.request_id=request.id ORDER BY event.occurred_at,event.id) AS event_types
       FROM backup.artifact_deletion_requests request
       JOIN backup.approval_requests approval ON approval.id=request.approval_request_id
       WHERE request.id=$1`,
      [deletionRequest.id],
    );
    expect(deletionEvidence.rows[0]).toEqual({
      approval_status: 'executed',
      event_types: ['requested', 'approved', 'started', 'failed', 'started', 'completed'],
      request_status: 'completed',
    });
    await expect(
      database
        .getPool()
        .query(
          `UPDATE backup.artifact_deletion_events SET details='{}'::jsonb WHERE request_id=$1`,
          [deletionRequest.id],
        ),
    ).rejects.toThrow('append-only');
    await expect(
      execution.dispatchApprovedArtifactDeletions({
        attemptNumber: 1,
        correlationId: 'backup-share-artifact-deletion-replay',
        enqueuedAt: new Date().toISOString(),
        idempotencyKey: 'backup-share-artifact-deletion-dispatch-0003',
        jobId: 'backup-share-artifact-deletion-dispatch-3',
        maxAttempts: 5,
        name: 'backup.restore.dispatch',
        payload: {},
        retryAllowed: true,
      }),
    ).resolves.toMatchObject({ completedCount: 0, processedCount: 0 });
    expect(deleteBackupObject).toHaveBeenCalledTimes(2);

    await writeFile(join(financeFolder, 'unchanged.txt'), 'Preserve this across the delta.');
    const activateSharePolicy = async (backupType: 'incremental' | 'differential') => {
      const draft = await backupWithSourceRoot.createPolicy(
        {
          backupType,
          compressionEnabled: true,
          frequency: 'hourly',
          name: `Finance share ${backupType} backup`,
          policyCode: `FINANCE-SHARE-${backupType.toUpperCase()}`,
          rpoMinutes: 60,
          rtoMinutes: 1440,
          sourceIds: [source.id],
        },
        `backup-share-${backupType}-policy-create-0001`,
        actor,
        metadata,
      );
      const requestedPolicy = await backupWithSourceRoot.requestPolicyApproval(
        draft.id,
        {
          expectedVersion: draft.version,
          justification: `Protect the finance share with ${backupType} backups and tested recovery.`,
        },
        `backup-share-${backupType}-policy-request-0001`,
        actor,
        metadata,
      );
      const approval = (await backupWithSourceRoot.policyApprovalRequests()).items.find(
        ({ policyId }) => policyId === requestedPolicy.id,
      );
      if (!approval) throw new Error(`${backupType} policy approval was not created`);
      const approvedPolicy = await backupWithSourceRoot.decidePolicyApproval(
        approval.id,
        {
          decision: 'approve',
          comment: `The full baseline and ${backupType} restore were reviewed.`,
        },
        `backup-share-${backupType}-policy-approve-0001`,
        approver,
        metadata,
      );
      return backupWithSourceRoot.activatePolicy(
        approvedPolicy.id,
        { expectedVersion: approvedPolicy.version },
        `backup-share-${backupType}-policy-activate-0001`,
        actor,
        metadata,
      );
    };
    const incrementalActive = await activateSharePolicy('incremental');

    const executeShareRun = async (
      policyId: string,
      mode: 'incremental' | 'differential',
      sequence: number,
    ) => {
      const scheduledFor = new Date(Date.now() + sequence).toISOString();
      const context = {
        attemptNumber: 1,
        correlationId: `backup-share-${mode}-run-${sequence}`,
        enqueuedAt: new Date().toISOString(),
        idempotencyKey: `backup-share-${mode}-run:${sequence}`,
        jobId: `backup-share-${mode}-run-${sequence}`,
        maxAttempts: 5,
        name: 'backup.execute' as const,
        payload: { policyId, scheduledFor },
        retryAllowed: true,
      };
      const executionResult = await execution.execute(context);
      const incrementalRunId = String(executionResult.runId);
      await execution.verify({
        ...context,
        correlationId: `backup-share-${mode}-verify-${sequence}`,
        idempotencyKey: `backup-share-${mode}-verify:${sequence}`,
        jobId: `backup-share-${mode}-verify-${sequence}`,
        name: 'backup.verify',
        payload: { runId: incrementalRunId },
      });
      return {
        id: incrementalRunId,
        ...(await backupWithArtifactStorage.executionRuns({ page: 1, pageSize: 100 })).items.find(
          ({ id }) => id === incrementalRunId,
        ),
      };
    };

    const baselineRun = await executeShareRun(incrementalActive.id, 'incremental', 1);
    expect(baselineRun).toMatchObject({ backupType: 'full', sourceType: 'file_share' });
    await writeFile(join(financeFolder, 'reports', 'monthly.csv'), 'month,total\nDecember,99\n');
    await rm(join(financeFolder, 'notes.txt'));
    await writeFile(join(financeFolder, 'reports', 'new.csv'), 'new report');
    const deltaRun = await executeShareRun(incrementalActive.id, 'incremental', 2);
    expect(deltaRun).toMatchObject({ backupType: 'incremental', sourceType: 'file_share' });
    const lineage = await database.getPool().query<{
      backup_type: string;
      parent_run_id: string | null;
      source_manifest: { files: Array<{ contentIncluded: boolean; key: string }> } | null;
    }>(
      `SELECT backup_type,parent_run_id,source_manifest
       FROM backup.execution_runs WHERE id=$1`,
      [deltaRun.id],
    );
    expect(lineage.rows[0]?.parent_run_id).toBe(baselineRun.id);
    expect(
      lineage.rows[0]?.source_manifest?.files.map(({ key, contentIncluded }) => [
        key,
        contentIncluded,
      ]),
    ).toEqual([
      ['reports/monthly.csv', true],
      ['reports/new.csv', true],
      ['unchanged.txt', false],
    ]);
    await expect(
      backupWithArtifactStorage.requestArtifactDeletion(
        baselineRun.id,
        { reason: 'Remove the baseline while its incremental restore point is retained.' },
        'backup-share-incremental-delete-base-0001',
        actor,
        metadata,
      ),
    ).rejects.toThrow('This restore point is a base for a later backup');

    const deltaRestoreRequest = await backupWithArtifactStorage.requestRestore(
      deltaRun.id,
      { reason: 'Recover the current finance share snapshot into isolation.' },
      'backup-share-incremental-restore-request-0001',
      actor,
      metadata,
    );
    await backupWithArtifactStorage.decideRestoreApproval(
      deltaRestoreRequest.id,
      { decision: 'approve', comment: 'Restore the complete verified incremental chain.' },
      'backup-share-incremental-restore-approve-0001',
      approver,
      metadata,
    );
    const deltaRestore = await restoreWorker.execute({
      attemptNumber: 1,
      correlationId: 'backup-share-incremental-restore',
      enqueuedAt: new Date().toISOString(),
      idempotencyKey: `backup-share-incremental-restore:${deltaRestoreRequest.id}`,
      jobId: 'backup-share-incremental-restore-1',
      maxAttempts: 5,
      name: 'backup.restore.execute',
      payload: { restoreRequestId: deltaRestoreRequest.id },
      retryAllowed: true,
    });
    expect(deltaRestore).toMatchObject({ objectCount: 3, status: 'completed' });
    const deltaTargetPrefix = String(deltaRestore.targetStoragePrefix);
    expect(restoredFiles.get(`${deltaTargetPrefix}reports/monthly.csv`)).toEqual(
      Buffer.from('month,total\nDecember,99\n'),
    );
    expect(restoredFiles.get(`${deltaTargetPrefix}reports/new.csv`)).toEqual(
      Buffer.from('new report'),
    );
    expect(restoredFiles.get(`${deltaTargetPrefix}unchanged.txt`)).toEqual(
      Buffer.from('Preserve this across the delta.'),
    );
    expect(restoredFiles.has(`${deltaTargetPrefix}notes.txt`)).toBe(false);
    expect(await readFile(join(financeFolder, 'reports', 'monthly.csv'), 'utf8')).toBe(
      'month,total\nDecember,99\n',
    );

    const differentialActive = await activateSharePolicy('differential');
    const differentialBase = await executeShareRun(differentialActive.id, 'differential', 3);
    expect(differentialBase).toMatchObject({ backupType: 'full', sourceType: 'file_share' });
    await writeFile(join(financeFolder, 'reports', 'monthly.csv'), 'month,total\nJanuary,100\n');
    await writeFile(join(financeFolder, 'reports', 'diff-one.csv'), 'first differential change');
    const firstDifferential = await executeShareRun(differentialActive.id, 'differential', 4);
    expect(firstDifferential).toMatchObject({
      backupType: 'differential',
      sourceType: 'file_share',
    });
    await writeFile(join(financeFolder, 'reports', 'monthly.csv'), 'month,total\nDecember,99\n');
    await rm(join(financeFolder, 'reports', 'diff-one.csv'));
    await writeFile(join(financeFolder, 'reports', 'diff-two.csv'), 'second differential change');
    const differentialRun = await executeShareRun(differentialActive.id, 'differential', 5);
    const differentialLineage = await database.getPool().query<{
      backup_type: string;
      parent_run_id: string | null;
      source_manifest: {
        deletedKeys: string[];
        files: Array<{ contentIncluded: boolean; key: string }>;
      } | null;
    }>(
      `SELECT backup_type,parent_run_id,source_manifest
       FROM backup.execution_runs WHERE id=$1`,
      [differentialRun.id],
    );
    expect(differentialRun.backupType).toBe('differential');
    expect(differentialLineage.rows[0]?.parent_run_id).toBe(differentialBase.id);
    expect(differentialLineage.rows[0]?.source_manifest?.deletedKeys).toEqual([]);
    expect(
      differentialLineage.rows[0]?.source_manifest?.files.map(({ key, contentIncluded }) => [
        key,
        contentIncluded,
      ]),
    ).toEqual([
      ['reports/diff-two.csv', true],
      ['reports/monthly.csv', false],
      ['reports/new.csv', false],
      ['unchanged.txt', false],
    ]);
    const differentialRestoreRequest = await backupWithArtifactStorage.requestRestore(
      differentialRun.id,
      { reason: 'Recover the approved finance share differential into isolation.' },
      'backup-share-differential-restore-request-0001',
      actor,
      metadata,
    );
    await backupWithArtifactStorage.decideRestoreApproval(
      differentialRestoreRequest.id,
      { decision: 'approve', comment: 'The full base and latest differential were reviewed.' },
      'backup-share-differential-restore-approve-0001',
      approver,
      metadata,
    );
    const differentialRestore = await restoreWorker.execute({
      attemptNumber: 1,
      correlationId: 'backup-share-differential-restore',
      enqueuedAt: new Date().toISOString(),
      idempotencyKey: `backup-share-differential-restore:${differentialRestoreRequest.id}`,
      jobId: 'backup-share-differential-restore-1',
      maxAttempts: 5,
      name: 'backup.restore.execute',
      payload: { restoreRequestId: differentialRestoreRequest.id },
      retryAllowed: true,
    });
    expect(differentialRestore).toMatchObject({ objectCount: 4, status: 'completed' });
    const differentialTargetPrefix = String(differentialRestore.targetStoragePrefix);
    expect(restoredFiles.get(`${differentialTargetPrefix}reports/monthly.csv`)).toEqual(
      Buffer.from('month,total\nDecember,99\n'),
    );
    expect(restoredFiles.get(`${differentialTargetPrefix}reports/diff-two.csv`)).toEqual(
      Buffer.from('second differential change'),
    );
    expect(restoredFiles.has(`${differentialTargetPrefix}reports/diff-one.csv`)).toBe(false);
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0120_backup_database_engine',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0119_backup_webdav_cloud_source',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0118_backup_email_source',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).rejects.toThrow(
      'Cannot remove object-storage source identity while backup evidence exists',
    );
    await expect(migrateUp(databasePool, migrationDirectory)).resolves.toEqual([
      '0118_backup_email_source',
      '0119_backup_webdav_cloud_source',
      '0120_backup_database_engine',
    ]);
  }, 30_000);

  it('reduces an active schedule retention only after independent, version-checked approval', async () => {
    const source = (await backup.sources({ page: 1, pageSize: 50 })).items[0];
    if (!source) throw new Error('The protected-source test must run first');
    const draft = await backup.createPolicy(
      {
        backupType: 'database_snapshot',
        frequency: 'hourly',
        name: 'Retention approval integration schedule',
        policyCode: 'RETENTION-APPROVAL-TEST',
        rpoMinutes: 60,
        rtoMinutes: 240,
        sourceIds: [source.id],
      },
      'backup-retention-policy-create-0001',
      actor,
      metadata,
    );
    const submitted = await backup.requestPolicyApproval(
      draft.id,
      {
        expectedVersion: draft.version,
        justification: 'Activate this schedule for the retention approval test.',
      },
      'backup-retention-policy-approval-request-0001',
      actor,
      metadata,
    );
    const activationApproval = (await backup.policyApprovalRequests()).items.find(
      (item) => item.policyId === draft.id,
    );
    if (!activationApproval) throw new Error('The test schedule approval was not returned');
    const approved = await backup.decidePolicyApproval(
      activationApproval.id,
      { decision: 'approve', comment: 'Approved for isolated integration testing.' },
      'backup-retention-policy-approval-decision-0001',
      approver,
      metadata,
    );
    const active = await backup.activatePolicy(
      approved.id,
      { expectedVersion: approved.version },
      'backup-retention-policy-activate-0001',
      actor,
      metadata,
    );
    expect(active).toMatchObject({
      id: submitted.id,
      retentionDailyCopies: 35,
      retentionMonthlyCopies: 12,
      status: 'active',
    });

    await expect(
      backup.requestPolicyRetentionReduction(
        active.id,
        {
          expectedVersion: active.version,
          justification: 'This proposal attempts to increase daily copies.',
          retentionDailyCopies: 36,
          retentionMonthlyCopies: 12,
        },
        'backup-retention-invalid-increase-0001',
        actor,
        metadata,
      ),
    ).rejects.toThrow('A retention reduction must lower at least one copy count');

    const reductionPending = await backup.requestPolicyRetentionReduction(
      active.id,
      {
        expectedVersion: active.version,
        justification: 'Reduce the archive window after reviewing recovery needs.',
        retentionDailyCopies: 30,
        retentionMonthlyCopies: 10,
      },
      'backup-retention-reduction-request-0001',
      actor,
      metadata,
    );
    expect(reductionPending).toMatchObject({
      retentionDailyCopies: 35,
      retentionMonthlyCopies: 12,
      retentionReductionRequestPending: true,
      status: 'active',
      version: active.version,
    });
    await expect(
      backup.requestPolicyRetentionReduction(
        active.id,
        {
          expectedVersion: active.version,
          justification: 'Do not allow overlapping retention requests.',
          retentionDailyCopies: 28,
          retentionMonthlyCopies: 9,
        },
        'backup-retention-reduction-duplicate-0001',
        actor,
        metadata,
      ),
    ).rejects.toThrow('A retention reduction for this schedule is already awaiting review.');

    const reductionApproval = (await backup.policyApprovalRequests()).items.find(
      (item) => item.action === 'reduce_retention' && item.policyId === active.id,
    );
    expect(reductionApproval).toMatchObject({
      action: 'reduce_retention',
      policyId: active.id,
      previousDailyCopies: 35,
      previousMonthlyCopies: 12,
      proposedDailyCopies: 30,
      proposedMonthlyCopies: 10,
      requestedBy: actor.accountId,
      status: 'pending',
      version: active.version,
    });
    if (!reductionApproval) throw new Error('The retention proposal was not returned');
    await expect(
      backup.decidePolicyApproval(
        reductionApproval.id,
        { decision: 'approve' },
        'backup-retention-reduction-self-approval-0001',
        actor,
        metadata,
      ),
    ).rejects.toThrow('A different authorised person must review this retention reduction.');

    const reduced = await backup.decidePolicyApproval(
      reductionApproval.id,
      { decision: 'approve', comment: 'The lower retention counts were reviewed.' },
      'backup-retention-reduction-approval-0001',
      approver,
      metadata,
    );
    expect(reduced).toMatchObject({
      retentionDailyCopies: 30,
      retentionMonthlyCopies: 10,
      status: 'active',
      version: active.version + 1,
    });
    expect(reduced.retentionReductionRequestPending).toBeUndefined();
    await expect(
      backup.decidePolicyApproval(
        reductionApproval.id,
        { decision: 'approve', comment: 'The lower retention counts were reviewed.' },
        'backup-retention-reduction-approval-0001',
        approver,
        metadata,
      ),
    ).resolves.toEqual(reduced);

    const rejectedPending = await backup.requestPolicyRetentionReduction(
      reduced.id,
      {
        expectedVersion: reduced.version,
        justification: 'Review a further reduction without applying it automatically.',
        retentionDailyCopies: 20,
        retentionMonthlyCopies: 8,
      },
      'backup-retention-reduction-reject-request-0001',
      actor,
      metadata,
    );
    const rejectedApproval = (await backup.policyApprovalRequests()).items.find(
      (item) => item.action === 'reduce_retention' && item.policyId === reduced.id,
    );
    if (!rejectedApproval) throw new Error('The second retention proposal was not returned');
    const rejected = await backup.decidePolicyApproval(
      rejectedApproval.id,
      { decision: 'reject', comment: 'Keep the existing retention window.' },
      'backup-retention-reduction-rejection-0001',
      approver,
      metadata,
    );
    expect(rejected).toMatchObject({
      retentionDailyCopies: 30,
      retentionMonthlyCopies: 10,
      status: 'active',
      version: rejectedPending.version,
    });
    const expiresPending = await backup.requestPolicyRetentionReduction(
      rejected.id,
      {
        expectedVersion: rejected.version,
        justification: 'Exercise expiry without changing the active retention limits.',
        retentionDailyCopies: 18,
        retentionMonthlyCopies: 7,
      },
      'backup-retention-reduction-expire-request-0001',
      actor,
      metadata,
    );
    const expiresApproval = (await backup.policyApprovalRequests()).items.find(
      (item) => item.action === 'reduce_retention' && item.policyId === rejected.id,
    );
    if (!expiresApproval) throw new Error('The expiring retention proposal was not returned');
    await database.getPool().query(
      `UPDATE backup.approval_requests
       SET requested_at=now()-interval '2 minutes',expires_at=now()-interval '1 minute'
       WHERE id=$1`,
      [expiresApproval.id],
    );
    expect(await backup.policyApprovalRequests()).toEqual({ items: [], total: 0 });
    const stillRetained = (await backup.policies({ page: 1, pageSize: 100 })).items.find(
      (policy) => policy.id === rejected.id,
    );
    expect(stillRetained).toMatchObject({
      retentionDailyCopies: 30,
      retentionMonthlyCopies: 10,
      status: 'active',
      version: expiresPending.version,
    });
    const evidence = await database.getPool().query<{
      approved: string;
      expired: string;
      rejected: string;
    }>(
      `SELECT
         (SELECT count(*) FROM audit.events WHERE action='backup.policy.retention_reduction_approved' AND target_id=$1)::text AS approved,
         (SELECT count(*) FROM audit.events WHERE action='backup.policy.retention_reduction_rejected' AND target_id=$1)::text AS rejected,
         (SELECT count(*) FROM audit.events WHERE action='backup.policy.retention_reduction_expired' AND target_id=$1)::text AS expired`,
      [active.id],
    );
    expect(evidence.rows[0]).toEqual({ approved: '1', expired: '1', rejected: '1' });
    const approvedAudit = await database.getPool().query<{
      actor_account_id: string;
      after_daily: string;
      after_monthly: string;
      before_daily: string;
      before_monthly: string;
    }>(
      `SELECT actor_account_id,
              before_data->>'retentionDailyCopies' AS before_daily,
              before_data->>'retentionMonthlyCopies' AS before_monthly,
              after_data->>'retentionDailyCopies' AS after_daily,
              after_data->>'retentionMonthlyCopies' AS after_monthly
       FROM audit.events
       WHERE action='backup.policy.retention_reduction_approved' AND target_id=$1`,
      [active.id],
    );
    expect(approvedAudit.rows[0]).toEqual({
      actor_account_id: approver.accountId,
      after_daily: '30',
      after_monthly: '10',
      before_daily: '35',
      before_monthly: '12',
    });
  });

  it('requires a secret-mapped PostgreSQL connection before approving an additional database schedule', async () => {
    const source = await backup.createSource(
      {
        dataClassification: 'important',
        encryptedAtSource: false,
        location: 'Separate reporting PostgreSQL instance',
        name: 'Reporting database',
        sourceCode: 'REPORTING-DB',
        sourceType: 'database',
      },
      'backup-additional-db-source-0001',
      actor,
      metadata,
    );
    const policy = await backup.createPolicy(
      {
        backupType: 'database_snapshot',
        frequency: 'daily',
        name: 'Reporting database daily backup',
        policyCode: 'REPORTING-DB-DAILY',
        rpoMinutes: 1440,
        rtoMinutes: 1440,
        runTimeLocal: '02:00',
        sourceIds: [source.id],
      },
      'backup-additional-db-policy-0001',
      actor,
      metadata,
    );
    const approvalInput = {
      expectedVersion: policy.version,
      justification: 'Protect the separate reporting database every day.',
    };
    let unconfiguredError: unknown;
    try {
      await backup.requestPolicyApproval(
        policy.id,
        approvalInput,
        'backup-additional-db-approval-unconfigured-0001',
        actor,
        metadata,
      );
    } catch (error) {
      unconfiguredError = error;
    }
    expect(unconfiguredError).toBeInstanceOf(ApiErrorException);
    expect((unconfiguredError as ApiErrorException).getResponse()).toMatchObject({
      code: 'BACKUP_DATABASE_SOURCE_NOT_CONFIGURED',
    });

    backupEnvironment.BACKUP_DATABASE_SOURCE_URLS_JSON = {
      'REPORTING-DB': databaseUrl,
    };
    expect(backupDatabaseSourceUrl('REPORTING-DB', backupEnvironment)).toBe(databaseUrl);
    const configuredBackup = new BackupService(
      backupEnvironment,
      database,
      new AuditService(database),
      {} as ObjectStorageService,
    );
    const approval = await configuredBackup.requestPolicyApproval(
      policy.id,
      approvalInput,
      'backup-additional-db-approval-configured-0001',
      actor,
      metadata,
    );
    const requests = await configuredBackup.policyApprovalRequests();
    const approvalId = requests.items.find((request) => request.policyId === policy.id)?.id;
    if (!approvalId) throw new Error('Reporting database approval was not returned');
    const approved = await configuredBackup.decidePolicyApproval(
      approvalId,
      { decision: 'approve', comment: 'Daily protection approved.' },
      'backup-additional-db-approval-decision-0001',
      approver,
      metadata,
    );
    expect(approved.status).toBe('approved');
    expect(approval.status).toBe('pending_approval');
    await expect(
      configuredBackup.activatePolicy(
        policy.id,
        { expectedVersion: approved.version },
        'backup-additional-db-activate-configured-0001',
        actor,
        metadata,
      ),
    ).resolves.toMatchObject({ status: 'active' });
  }, 60_000);

  it('backs up and restores a non-Vista PostgreSQL source without its original connection', async () => {
    const reportingName = `vista_backup_reporting_test_${randomUUID().replaceAll('-', '')}`;
    assertTemporaryReportingDatabaseName(reportingName);
    await adminPool.query(`CREATE DATABASE "${reportingName}"`);
    const reportingUrl = new URL(databaseUrl);
    reportingUrl.pathname = `/${reportingName}`;
    const reportingPool = new Pool({ connectionString: reportingUrl.toString(), max: 1 });
    let restoredName: string | undefined;
    try {
      await reportingPool.query(
        'CREATE TABLE public.reports (id integer PRIMARY KEY, note text NOT NULL)',
      );
      await reportingPool.query(`INSERT INTO public.reports(id,note) VALUES(1,'Quarterly report')`);
      const mappedUrl = reportingUrl.toString().replace(/^postgresql:/u, 'postgres:');
      const environment = {
        ...backupEnvironment,
        BACKUP_ALERT_SMS_RECIPIENTS: '',
        BACKUP_DATABASE_SOURCE_URLS_JSON: { 'REPORTING-LIVE-DB': mappedUrl },
        BACKUP_RESTORE_DATABASE_URL: databaseUrl,
        BUSINESS_TIMEZONE: 'Europe/Sofia',
        SMS_PROVIDER: 'disabled',
      } as AppEnvironment;
      const artifacts = new Map<string, Buffer>();
      const parts = new Map<string, Buffer[]>();
      const storage = {
        abortBackupUpload: vi.fn(),
        completeBackupUpload: vi.fn(({ key }: { key: string }) => {
          artifacts.set(key, Buffer.concat(parts.get(key) ?? []));
        }),
        createBackupUpload: vi.fn((key: string) => {
          parts.set(key, []);
          return `upload-${key}`;
        }),
        getBackupObjectStream: vi.fn((key: string) => {
          const body = artifacts.get(key);
          if (!body) throw new Error('Backup artifact not found');
          return Readable.from([body]);
        }),
        independentCopyConfigured: vi.fn(() => false),
        uploadBackupPart: vi.fn(({ body, key }: { body: Buffer; key: string }) => {
          parts.get(key)?.push(body);
          return 'part-etag';
        }),
      } as unknown as ObjectStorageService;
      const service = new BackupService(environment, database, new AuditService(database), storage);
      const source = await service.createSource(
        {
          dataClassification: 'important',
          encryptedAtSource: false,
          location: 'Separate reporting database',
          name: 'Reporting database with no Vista schema',
          sourceCode: 'REPORTING-LIVE-DB',
          sourceType: 'database',
        },
        'backup-reporting-live-source',
        actor,
        metadata,
      );
      const policy = await service.createPolicy(
        {
          backupType: 'database_snapshot',
          frequency: 'daily',
          name: 'Reporting daily copy',
          policyCode: 'REPORTING-LIVE-DAILY',
          rpoMinutes: 1440,
          rtoMinutes: 1440,
          runTimeLocal: '02:00',
          sourceIds: [source.id],
        },
        'backup-reporting-live-policy',
        actor,
        metadata,
      );
      await service.requestPolicyApproval(
        policy.id,
        { expectedVersion: policy.version, justification: 'Protect the reporting database.' },
        'backup-reporting-live-approval',
        actor,
        metadata,
      );
      const approval = (await service.policyApprovalRequests()).items.find(
        (entry) => entry.policyId === policy.id,
      );
      if (!approval) throw new Error('Reporting policy approval was not found');
      const approved = await service.decidePolicyApproval(
        approval.id,
        { decision: 'approve' },
        'backup-reporting-live-decision',
        approver,
        metadata,
      );
      await service.activatePolicy(
        policy.id,
        { expectedVersion: approved.version },
        'backup-reporting-live-activate',
        actor,
        metadata,
      );
      const queue = { enqueue: vi.fn().mockResolvedValue({ deduplicated: false, jobId: 'job' }) };
      const runner = new PostgresBackupDumpRunner();
      const execution = new BackupExecutionService(
        environment,
        database,
        storage,
        new AuditService(database),
        queue as never,
        runner,
      );
      const context = {
        attemptNumber: 1,
        correlationId: 'backup-reporting-live',
        enqueuedAt: new Date().toISOString(),
        idempotencyKey: 'backup-reporting-live-run',
        jobId: 'backup-reporting-live-run',
        maxAttempts: 5,
        name: 'backup.execute',
        payload: { policyId: policy.id, scheduledFor: new Date().toISOString() },
        retryAllowed: true,
      } as const;
      const stored = await execution.execute(context);
      const backupRunId = String(stored.runId);
      environment.BACKUP_DATABASE_SOURCE_URLS_JSON = {};
      const archiveInspector = vi.spyOn(PostgresBackupDumpRunner.prototype, 'validateArchive');
      await expect(
        execution.verify({
          ...context,
          idempotencyKey: 'backup-reporting-live-verify',
          name: 'backup.verify',
          payload: { runId: backupRunId },
        }),
      ).resolves.toMatchObject({ status: 'verified' });
      expect(await archiveInspector.mock.results[0]?.value).toEqual({
        hasVistaMigrationLedger: false,
      });
      const request = await service.requestRestore(
        backupRunId,
        { reason: 'Verify the separate reporting database recovery.' },
        'backup-reporting-live-restore',
        actor,
        metadata,
      );
      await service.decideRestoreApproval(
        request.id,
        { decision: 'approve' },
        'backup-reporting-live-restore-approval',
        approver,
        metadata,
      );
      const worker = new BackupRestoreWorkerService(
        environment,
        database,
        storage,
        new AuditService(database),
        queue as never,
        runner,
      );
      const restored = await worker.execute({
        ...context,
        idempotencyKey: 'backup-reporting-live-restore-run',
        name: 'backup.restore.execute',
        payload: { restoreRequestId: request.id },
      });
      expect(restored.status).toBe('completed');
      restoredName = String(restored.targetDatabaseName);
      assertTemporaryRestoreDatabaseName(restoredName);
      const restoredUrl = new URL(databaseUrl);
      restoredUrl.pathname = `/${restoredName}`;
      const recordRecovery = new BackupDatabaseRecoveryService(
        environment,
        database,
        runner,
        new AuditService(database),
      );
      await expect(recordRecovery.tables(request.id)).resolves.toEqual({
        items: [{ name: 'public.reports', primaryKeyColumns: ['id'] }],
      });
      await expect(
        recordRecovery.recoverRecord(
          request.id,
          { primaryKey: { id: '1' }, tableName: 'public.reports' },
          actor,
          metadata,
        ),
      ).resolves.toMatchObject({
        databaseEngine: 'postgresql',
        format: 'vista-database-record-recovery-v1',
        primaryKey: { id: '1' },
        record: { id: 1, note: 'Quarterly report' },
        restoreRequestId: request.id,
        sourceRunId: backupRunId,
        tableName: 'public.reports',
      });
      await expect(
        recordRecovery.recoverRecord(
          request.id,
          { primaryKey: { id: '404' }, tableName: 'public.reports' },
          actor,
          metadata,
        ),
      ).rejects.toMatchObject({
        response: { code: 'BACKUP_RECOVERY_RECORD_NOT_FOUND' },
      });
      const restoredPool = new Pool({ connectionString: restoredUrl.toString(), max: 1 });
      try {
        const rows = await restoredPool.query<{ note: string }>('SELECT note FROM public.reports');
        expect(rows.rows).toEqual([{ note: 'Quarterly report' }]);
        const ledger = await restoredPool.query<{ present: string | null }>(
          "SELECT to_regclass('platform.schema_migrations')::text AS present",
        );
        expect(ledger.rows[0]?.present).toBeNull();
      } finally {
        await restoredPool.end();
      }
    } finally {
      await reportingPool.end();
      if (restoredName) {
        assertTemporaryRestoreDatabaseName(restoredName);
        await adminPool.query(`DROP DATABASE IF EXISTS "${restoredName}" WITH (FORCE)`);
      }
      assertTemporaryReportingDatabaseName(reportingName);
      await adminPool.query(`DROP DATABASE IF EXISTS "${reportingName}" WITH (FORCE)`);
    }
  }, 60_000);

  it('backs up a WebDAV cloud folder and restores one file only to an approved isolated prefix', async () => {
    if (!webDavCloudBackupTest) throw new Error('The WebDAV backup test was not registered');
    await migrateUp(
      databasePool,
      fileURLToPath(new URL('../src/database/migrations', import.meta.url)),
    );
    await webDavCloudBackupTest();
  });

  it('backs up an exported system image and restores it only as an isolated image copy', async () => {
    await migrateUp(
      databasePool,
      fileURLToPath(new URL('../src/database/migrations', import.meta.url)),
    );
    const fileShareRoot = await mkdtemp(join(tmpdir(), 'vista-system-image-e2e-'));
    fileShareRoots.push(fileShareRoot);
    const imageFolder = join(fileShareRoot, 'server', 'exports');
    const imageBytes = Buffer.from([0x51, 0x46, 0x49, 0xfb, 0x00, 0x01, 0x02, 0x03]);
    await mkdir(imageFolder, { recursive: true });
    await writeFile(join(imageFolder, 'vista-server.qcow2'), imageBytes);

    const environment = {
      BACKUP_ALERT_SMS_RECIPIENTS: '',
      BACKUP_ENCRYPTION_KEY: 'a'.repeat(64),
      BACKUP_FILE_SOURCE_ROOT: fileShareRoot,
      BACKUP_RESTORE_DATABASE_URL: databaseUrl,
      BACKUP_S3_BUCKET: 'vista-backups',
      BUSINESS_TIMEZONE: 'Europe/Sofia',
      DATABASE_URL: databaseUrl,
      IDEMPOTENCY_TTL_SECONDS: 86_400,
      S3_BUCKET: 'vista-files',
      SMS_PROVIDER: 'disabled',
      VISTA_DEPLOYMENT_STAGE: 'local',
    } as unknown as AppEnvironment;
    const storedObjects = new Map<string, Buffer>();
    const uploads = new Map<string, Buffer[]>();
    const restoredObjects = new Map<string, Buffer>();
    const storage = {
      abortBackupUpload: vi.fn(({ key }: { key: string }) => uploads.delete(key)),
      bucketName: () => 'vista-backups',
      completeBackupUpload: vi.fn(({ key }: { key: string }) => {
        storedObjects.set(key, Buffer.concat(uploads.get(key) ?? []));
      }),
      createBackupUpload: vi.fn((key: string) => {
        uploads.set(key, []);
        return `upload-${key}`;
      }),
      deleteRestoredFilePrefix: vi.fn((prefix: string) => {
        for (const key of restoredObjects.keys()) {
          if (key.startsWith(prefix)) restoredObjects.delete(key);
        }
      }),
      getBackupObjectStream: vi.fn((key: string) => {
        const artifact = storedObjects.get(key);
        if (!artifact) throw new Error('Backup artifact not found');
        return Readable.from([artifact]);
      }),
      getRestoredFileObjectStream: vi.fn((key: string) => {
        const restored = restoredObjects.get(key);
        if (!restored) return Promise.reject(new Error('Recovered file not found'));
        return Promise.resolve({ body: Readable.from([restored]), size: restored.length });
      }),
      independentCopyConfigured: vi.fn(() => false),
      putRestoredFileObject: vi.fn(async ({ body, key }: { body: Readable; key: string }) => {
        const chunks: Buffer[] = [];
        for await (const chunk of body) chunks.push(Buffer.from(chunk));
        restoredObjects.set(key, Buffer.concat(chunks));
      }),
      uploadBackupPart: vi.fn(({ body, key }: { body: Buffer; key: string }) => {
        uploads.get(key)?.push(body);
        return `etag-${uploads.get(key)?.length ?? 1}`;
      }),
    } as unknown as ObjectStorageService;
    const audit = new AuditService(database);
    const backupWithRoot = new BackupService(environment, database, audit, storage);
    const source = await backupWithRoot.createSource(
      {
        dataClassification: 'important',
        encryptedAtSource: true,
        location: 'server/exports',
        name: 'Vista server image snapshot',
        sourceCode: 'SERVER-IMAGE-01',
        sourceType: 'server',
      },
      'backup-system-image-source-create-0001',
      actor,
      metadata,
    );
    const draft = await backupWithRoot.createPolicy(
      {
        backupType: 'system_image',
        compressionEnabled: true,
        frequency: 'daily',
        name: 'Vista server system image',
        policyCode: 'SERVER-IMAGE-DAILY',
        rpoMinutes: 1440,
        rtoMinutes: 1440,
        runTimeLocal: '02:00',
        sourceIds: [source.id],
      },
      'backup-system-image-policy-create-0001',
      actor,
      metadata,
    );
    const approvalRequest = await backupWithRoot.requestPolicyApproval(
      draft.id,
      { expectedVersion: draft.version, justification: 'Protect the exported server disk image.' },
      'backup-system-image-approval-request-0001',
      actor,
      metadata,
    );
    const approval = (await backupWithRoot.policyApprovalRequests()).items.find(
      ({ policyId }) => policyId === approvalRequest.id,
    );
    if (!approval) throw new Error('The system-image policy approval was not created');
    const approved = await backupWithRoot.decidePolicyApproval(
      approval.id,
      { decision: 'approve', comment: 'The isolated system-image restore is approved.' },
      'backup-system-image-approval-decision-0001',
      approver,
      metadata,
    );
    const active = await backupWithRoot.activatePolicy(
      approved.id,
      { expectedVersion: approved.version },
      'backup-system-image-policy-activate-0001',
      actor,
      metadata,
    );
    const queue = {
      enqueue: vi.fn((input: EnqueueJobInput) => ({
        deduplicated: false,
        jobId: input.idempotencyKey,
      })),
    };
    const execution = new BackupExecutionService(
      environment,
      database,
      storage,
      audit,
      queue as never,
      new PostgresBackupDumpRunner(),
    );
    const context = {
      attemptNumber: 1,
      correlationId: 'backup-system-image-e2e',
      enqueuedAt: new Date().toISOString(),
      idempotencyKey: 'backup-system-image-run-0001',
      jobId: 'backup-system-image-job-0001',
      maxAttempts: 5,
      name: 'backup.execute',
      payload: { policyId: active.id, scheduledFor: new Date(Date.now() + 60_000).toISOString() },
      retryAllowed: true,
    };
    const stored = await execution.execute(context);
    const runId = String(stored.runId);
    await expect(
      execution.verify({
        ...context,
        idempotencyKey: 'backup-system-image-verify-0001',
        jobId: 'backup-system-image-verify-job-0001',
        name: 'backup.verify',
        payload: { runId },
      }),
    ).resolves.toMatchObject({ status: 'verified' });
    expect(await backupWithRoot.fileRestoreOptions(runId, 'qcow2')).toMatchObject({
      items: [{ key: 'vista-server.qcow2', sizeBytes: String(imageBytes.length) }],
      total: 1,
    });

    const restoreRequest = await backupWithRoot.requestRestore(
      runId,
      { objectKey: 'vista-server.qcow2', reason: 'Recover the server image to isolated storage.' },
      'backup-system-image-restore-request-0001',
      actor,
      metadata,
    );
    await backupWithRoot.decideRestoreApproval(
      restoreRequest.id,
      { decision: 'approve', comment: 'The image copy will stay isolated for recovery review.' },
      'backup-system-image-restore-approval-0001',
      approver,
      metadata,
    );
    const restoreWorker = new BackupRestoreWorkerService(
      environment,
      database,
      storage,
      audit,
      queue as never,
      new PostgresBackupDumpRunner(),
    );
    const restored = await restoreWorker.execute({
      ...context,
      idempotencyKey: `backup-system-image-restore:${restoreRequest.id}`,
      jobId: `backup-system-image-restore-${restoreRequest.id}`,
      name: 'backup.restore.execute',
      payload: { restoreRequestId: restoreRequest.id },
    });
    expect(restored).toMatchObject({
      objectCount: 1,
      restoredObjectKey: 'vista-server.qcow2',
      status: 'completed',
    });
    const prefix = String(restored.targetStoragePrefix);
    expect(restoredObjects.get(`${prefix}vista-server.qcow2`)).toEqual(imageBytes);
    const downloaded = await backupWithRoot.restoredFileContent(restoreRequest.id, actor, metadata);
    const downloadedChunks: Buffer[] = [];
    for await (const chunk of downloaded.body) downloadedChunks.push(Buffer.from(chunk));
    expect(downloaded.fileName).toBe('vista-server.qcow2');
    expect(Buffer.concat(downloadedChunks)).toEqual(imageBytes);
    expect(await readFile(join(imageFolder, 'vista-server.qcow2'))).toEqual(imageBytes);
  });
});

describe.skipIf(!runDatabaseTests)('independent backup-copy lifecycle', () => {
  let adminPool: Pool;
  let databasePool: Pool;
  let databaseName: string;
  let databaseUrl: string;
  let database: DatabaseService;

  beforeAll(async () => {
    const sourceUrl = process.env['DATABASE_URL'];
    if (!sourceUrl) throw new Error('DATABASE_URL is required when RUN_DATABASE_TESTS=true');
    adminPool = new Pool({ connectionString: sourceUrl, max: 1 });
    databaseName = `vista_backup_replica_test_${randomUUID().replaceAll('-', '')}`;
    assertTemporaryReplicaDatabaseName(databaseName);
    await adminPool.query(`CREATE DATABASE ${databaseName}`);
    const isolatedUrl = new URL(sourceUrl);
    isolatedUrl.pathname = `/${databaseName}`;
    databaseUrl = isolatedUrl.toString();
    databasePool = new Pool({ connectionString: databaseUrl, max: 2 });
    await migrateUp(
      databasePool,
      fileURLToPath(new URL('../src/database/migrations', import.meta.url)),
    );
    database = new DatabaseService({ DATABASE_URL: databaseUrl } as AppEnvironment);
  });

  afterAll(async () => {
    await database?.onApplicationShutdown();
    await databasePool?.end();
    if (adminPool && databaseName) {
      assertTemporaryReplicaDatabaseName(databaseName);
      await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
      await adminPool.end();
    }
  });

  it('records replica failure and retry, and only marks a run verified after the copy passes', async () => {
    const employeeId = randomUUID();
    const accountId = randomUUID();
    const policyId = randomUUID();
    const runId = randomUUID();
    await database.getPool().query(
      `INSERT INTO identity.employees(id,employee_number,display_name,email)
       VALUES($1,'TEST-BACKUP-REPLICA','Backup Replica Integration','replica-test@example.invalid')`,
      [employeeId],
    );
    await database.getPool().query(
      `INSERT INTO identity.user_accounts(id,employee_id,password_hash)
       VALUES($1,$2,'test-only-hash')`,
      [accountId, employeeId],
    );
    await database.getPool().query(
      `INSERT INTO backup.policies(
         id,policy_code,name,backup_type,frequency,rpo_minutes,rto_minutes,status,created_by,updated_by
       ) VALUES($1,'REPLICA-LIFECYCLE-TEST','Replica lifecycle test',
         'database_snapshot','hourly',60,240,'active',$2,$2)`,
      [policyId, accountId],
    );

    const encryptionKey = Buffer.from('a'.repeat(64), 'hex');
    const nonce = randomBytes(12);
    const plaintext = Buffer.from('isolated test database archive');
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
    const encryptedArtifact = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const artifactKey = 'database/REPLICA-LIFECYCLE-TEST/run.dump.enc';
    const artifactSha256 = createHash('sha256').update(encryptedArtifact).digest('hex');
    const artifactTag = cipher.getAuthTag();
    await database.getPool().query(
      `INSERT INTO backup.execution_runs(
         id,policy_id,scheduled_for,idempotency_key,backup_type,status,verification_status,
         source_type,compression_algorithm,uncompressed_size_bytes,stored_at,artifact_key,
         artifact_sha256,artifact_size_bytes,encryption_nonce,encryption_tag,database_engine,
         independent_copy_status,independent_copy_target_code
       ) VALUES($1,$2,now(),'replica-lifecycle-run','database_snapshot','stored','pending',
         'database','none',$3,now(),$4,$5,$6,$7,$8,'postgresql','pending','backup-vault-eu')`,
      [
        runId,
        policyId,
        plaintext.length,
        artifactKey,
        artifactSha256,
        encryptedArtifact.length,
        nonce.toString('hex'),
        artifactTag.toString('hex'),
      ],
    );

    const independentObjects = new Map<string, Buffer>();
    let failCopyOnce = true;
    const storage = {
      copyBackupObjectToIndependentStore: vi.fn(
        (input: { expectedSha256: string; expectedSizeBytes: number; key: string }) => {
          if (failCopyOnce) {
            failCopyOnce = false;
            return Promise.reject(new Error('BACKUP_REPLICA_TEST_TRANSIENT'));
          }
          if (
            input.key !== artifactKey ||
            input.expectedSizeBytes !== encryptedArtifact.length ||
            input.expectedSha256 !== artifactSha256
          ) {
            return Promise.reject(new Error('BACKUP_REPLICA_TEST_EXPECTATION_MISMATCH'));
          }
          independentObjects.set(input.key, Buffer.from(encryptedArtifact));
          return Promise.resolve();
        },
      ),
      getBackupObjectStream: vi.fn((key: string) => {
        if (key !== artifactKey) throw new Error('Backup artifact not found');
        return Readable.from([encryptedArtifact]);
      }),
      independentCopyConfigured: vi.fn(() => true),
      independentCopyTargetCode: vi.fn(() => 'backup-vault-eu'),
    } as unknown as ObjectStorageService;
    const execution = new BackupExecutionService(
      {
        BACKUP_ALERT_SMS_RECIPIENTS: '',
        BACKUP_ENCRYPTION_KEY: 'a'.repeat(64),
        BACKUP_REPLICA_REQUIRED: true,
        BUSINESS_TIMEZONE: 'Europe/Sofia',
      } as AppEnvironment,
      database,
      storage,
      new AuditService(database),
      { enqueue: vi.fn() } as never,
      { validateArchive: vi.fn().mockResolvedValue(undefined) } as never,
    );
    const verifyContext = {
      attemptNumber: 1,
      correlationId: 'backup-replica-lifecycle-test',
      enqueuedAt: new Date().toISOString(),
      idempotencyKey: 'backup-replica-lifecycle-test-verify-1',
      jobId: 'backup-replica-lifecycle-test-1',
      maxAttempts: 5,
      name: 'backup.verify',
      payload: { runId },
      retryAllowed: true,
    } as const;

    await expect(execution.verify(verifyContext)).rejects.toThrow('BACKUP_REPLICA_TEST_TRANSIENT');
    await expect(
      database.getPool().query<{
        independent_copy_error_code: string | null;
        independent_copy_status: string;
        status: string;
        verification_status: string;
      }>(
        `SELECT status,verification_status,independent_copy_status,independent_copy_error_code
         FROM backup.execution_runs WHERE id=$1`,
        [runId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          independent_copy_error_code: 'BACKUP_REPLICA_TEST_TRANSIENT',
          independent_copy_status: 'failed',
          status: 'stored',
          verification_status: 'failed',
        },
      ],
    });

    await execution.verify({
      ...verifyContext,
      correlationId: 'backup-replica-lifecycle-retry',
      idempotencyKey: 'backup-replica-lifecycle-test-verify-2',
      jobId: 'backup-replica-lifecycle-test-2',
    });
    const finalRun = await database.getPool().query<{
      independent_copy_status: string;
      independent_copy_target_code: string | null;
      independent_copy_verified_at: Date | null;
      status: string;
      verification_status: string;
    }>(
      `SELECT status,verification_status,independent_copy_status,
              independent_copy_target_code,independent_copy_verified_at
       FROM backup.execution_runs WHERE id=$1`,
      [runId],
    );
    expect(finalRun.rows[0]).toMatchObject({
      independent_copy_status: 'verified',
      independent_copy_target_code: 'backup-vault-eu',
      status: 'verified',
      verification_status: 'verified',
    });
    expect(finalRun.rows[0]?.independent_copy_verified_at).toBeInstanceOf(Date);
    expect(independentObjects.get(artifactKey)).toEqual(encryptedArtifact);

    const events = await database.getPool().query<{ count: string; event_type: string }>(
      `SELECT event_type,count(*)::text AS count FROM backup.execution_events WHERE run_id=$1
       GROUP BY event_type ORDER BY event_type`,
      [runId],
    );
    expect(events.rows).toEqual([
      { count: '1', event_type: 'independent_copy_failed' },
      { count: '2', event_type: 'independent_copy_started' },
      { count: '1', event_type: 'independent_copy_verified' },
      { count: '1', event_type: 'verification_failed' },
      { count: '2', event_type: 'verification_started' },
      { count: '1', event_type: 'verified' },
    ]);
    const audit = await database.getPool().query<{ action: string; count: string }>(
      `SELECT action,count(*)::text AS count FROM audit.events
       WHERE target_id=$1 AND action LIKE 'backup.run.independent_copy_%'
       GROUP BY action ORDER BY action`,
      [runId],
    );
    expect(audit.rows).toEqual([
      { action: 'backup.run.independent_copy_failed', count: '1' },
      { action: 'backup.run.independent_copy_started', count: '2' },
      { action: 'backup.run.independent_copy_verified', count: '1' },
    ]);
  }, 60_000);

  it('preserves the verified source bucket when upgrading existing object-storage evidence', async () => {
    const migrationDirectory = fileURLToPath(
      new URL('../src/database/migrations', import.meta.url),
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0120_backup_database_engine',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0119_backup_webdav_cloud_source',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0118_backup_email_source',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0117_backup_object_source_identity',
    );
    const employeeId = randomUUID();
    const accountId = randomUUID();
    const policyId = randomUUID();
    const sourceId = randomUUID();
    await database.getPool().query(
      `INSERT INTO identity.employees(id,employee_number,display_name,email)
       VALUES($1,'TEST-LEGACY-OBJECT','Legacy Object Backup','legacy-object@example.invalid')`,
      [employeeId],
    );
    await database.getPool().query(
      `INSERT INTO identity.user_accounts(id,employee_id,password_hash)
       VALUES($1,$2,'test-only-hash')`,
      [accountId, employeeId],
    );
    await database.getPool().query(
      `INSERT INTO backup.policies(
         id,policy_code,name,backup_type,frequency,rpo_minutes,rto_minutes,status,created_by,updated_by
       ) VALUES($1,'LEGACY-OBJECT-TEST','Legacy object test','full','hourly',60,240,'active',$2,$2)`,
      [policyId, accountId],
    );
    await database.getPool().query(
      `INSERT INTO backup.protected_sources(
         id,source_code,name,source_type,data_classification,location,created_by,updated_by
       ) VALUES($1,'OLD-FILES','Existing managed files','object_storage','important',
         'Vista file store',$2,$2)`,
      [sourceId, accountId],
    );
    await database
      .getPool()
      .query(`INSERT INTO backup.policy_sources(policy_id,source_id,linked_by) VALUES($1,$2,$3)`, [
        policyId,
        sourceId,
        accountId,
      ]);
    const runId = randomUUID();
    await database.getPool().query(
      `INSERT INTO backup.execution_runs(
         id,policy_id,scheduled_for,idempotency_key,backup_type,status,verification_status,
         source_type,compression_algorithm,uncompressed_size_bytes,stored_at,verified_at,
         artifact_key,artifact_sha256,artifact_size_bytes,encryption_nonce,encryption_tag,
         source_manifest
       ) VALUES($1,$2,now(),'legacy-object-source-upgrade','full','verified','verified',
         'object_storage','none',1,now(),now(),'legacy/archive.enc',$3,1,$4,$5,$6::jsonb)`,
      [
        runId,
        policyId,
        'a'.repeat(64),
        'b'.repeat(24),
        'c'.repeat(32),
        JSON.stringify({ sourceBucket: 'legacy-vista-files' }),
      ],
    );
    await expect(migrateUp(databasePool, migrationDirectory)).resolves.toEqual([
      '0117_backup_object_source_identity',
      '0118_backup_email_source',
      '0119_backup_webdav_cloud_source',
      '0120_backup_database_engine',
    ]);
    const run = await database.getPool().query<{
      source_bucket_snapshot: string | null;
      source_identity_snapshot: string | null;
    }>(
      `SELECT source_bucket_snapshot,source_identity_snapshot
       FROM backup.execution_runs WHERE id=$1`,
      [runId],
    );
    expect(run.rows[0]).toEqual({
      source_bucket_snapshot: 'legacy-vista-files',
      source_identity_snapshot: null,
    });
    const legacySource = await database
      .getPool()
      .query<{ source_code_snapshot: string }>(
        `SELECT source_code_snapshot FROM backup.legacy_managed_object_sources WHERE source_id=$1`,
        [sourceId],
      );
    expect(legacySource.rows[0]?.source_code_snapshot).toBe('OLD-FILES');

    const artifacts = new Map<string, Buffer>();
    const parts = new Map<string, Buffer[]>();
    const sourceBody = Buffer.from('existing managed source');
    const storage = {
      abortBackupUpload: vi.fn(),
      bucketName: () => 'legacy-vista-files',
      completeBackupUpload: vi.fn(({ key }: { key: string }) => {
        artifacts.set(key, Buffer.concat(parts.get(key) ?? []));
      }),
      createBackupUpload: vi.fn((key: string) => {
        parts.set(key, []);
        return `upload-${key}`;
      }),
      describeFileObject: vi.fn(() => ({ etag: '"legacy-v1"', size: sourceBody.length })),
      getBackupObjectStream: vi.fn((key: string) => {
        const body = artifacts.get(key);
        if (!body) throw new Error('Backup artifact not found');
        return Readable.from([body]);
      }),
      getFileObjectStream: vi.fn(() => ({
        body: Readable.from([sourceBody]),
        etag: '"legacy-v1"',
        size: sourceBody.length,
      })),
      independentCopyConfigured: vi.fn(() => false),
      listFileObjects: vi.fn(() => [
        { etag: '"legacy-v1"', key: 'legacy.txt', size: sourceBody.length },
      ]),
      uploadBackupPart: vi.fn(({ body, key }: { body: Buffer; key: string }) => {
        parts.get(key)?.push(body);
        return 'part-etag';
      }),
    } as unknown as ObjectStorageService;
    const execution = new BackupExecutionService(
      {
        BACKUP_ENCRYPTION_KEY: 'a'.repeat(64),
        BACKUP_OBJECT_STORAGE_SOURCE_CONFIGS_JSON: {},
        BACKUP_PRIMARY_OBJECT_STORAGE_SOURCE_CODE: 'VISTA-FILES-01',
        BUSINESS_TIMEZONE: 'Europe/Sofia',
        S3_ENDPOINT: 'https://managed.example.invalid',
        S3_REGION: 'eu-central-1',
        SMS_PROVIDER: 'disabled',
      } as unknown as AppEnvironment,
      database,
      storage,
      new AuditService(database),
      {
        enqueue: vi.fn().mockResolvedValue({ deduplicated: false, jobId: 'legacy-verify' }),
      } as never,
      new PostgresBackupDumpRunner(),
    );
    const stored = await execution.execute({
      attemptNumber: 1,
      correlationId: 'legacy-managed-source',
      enqueuedAt: new Date().toISOString(),
      idempotencyKey: 'legacy-managed-source-run',
      jobId: 'legacy-managed-source-run',
      maxAttempts: 5,
      name: 'backup.execute',
      payload: { policyId, scheduledFor: new Date(Date.now() + 1000).toISOString() },
      retryAllowed: true,
    });
    await expect(
      execution.verify({
        attemptNumber: 1,
        correlationId: 'legacy-managed-verify',
        enqueuedAt: new Date().toISOString(),
        idempotencyKey: 'legacy-managed-verify',
        jobId: 'legacy-managed-verify',
        maxAttempts: 5,
        name: 'backup.verify',
        payload: { runId: String(stored.runId) },
        retryAllowed: true,
      }),
    ).resolves.toMatchObject({ status: 'verified' });
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0120_backup_database_engine',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0119_backup_webdav_cloud_source',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).resolves.toBe(
      '0118_backup_email_source',
    );
    await expect(migrateDown(databasePool, migrationDirectory)).rejects.toThrow(
      'Cannot remove object-storage source identity while backup evidence exists',
    );
  });
});

function assertTemporaryDatabaseName(value: string): void {
  if (!/^vista_backup_test_[a-f0-9]{32}$/u.test(value)) {
    throw new Error('Refusing to use an unexpected backup integration database name');
  }
}

function davXmlEntry(
  href: string,
  properties: { collection?: boolean; contentType?: string; etag?: string; size?: number },
): string {
  return `<d:response><d:href>${href}</d:href><d:propstat><d:prop>
    <d:resourcetype>${properties.collection ? '<d:collection/>' : ''}</d:resourcetype>
    ${properties.size === undefined ? '' : `<d:getcontentlength>${properties.size}</d:getcontentlength>`}
    ${properties.etag === undefined ? '' : `<d:getetag>${properties.etag}</d:getetag>`}
    ${properties.contentType === undefined ? '' : `<d:getcontenttype>${properties.contentType}</d:getcontenttype>`}
  </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
}

function assertTemporaryReplicaDatabaseName(value: string): void {
  if (!/^vista_backup_replica_test_[a-f0-9]{32}$/u.test(value)) {
    throw new Error('Refusing to use an unexpected independent-copy integration database name');
  }
}

function assertTemporaryReportingDatabaseName(value: string): void {
  if (!/^vista_backup_reporting_test_[a-f0-9]{32}$/u.test(value)) {
    throw new Error('Refusing to use an unexpected reporting integration database name');
  }
}

function assertTemporaryRestoreDatabaseName(value: string): void {
  if (!/^vista_restore_[a-f0-9]{20}_\d+$/u.test(value)) {
    throw new Error('Refusing to use an unexpected isolated restore database name');
  }
}
