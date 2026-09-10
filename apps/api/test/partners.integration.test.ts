import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AppEnvironment } from '@vista/config';
import type {
  CreatePartnerAddressRequest,
  CreatePartnerBankAccountRequest,
  CreatePartnerContactRequest,
  CreatePartnerRequest,
  BusinessBranch,
  BusinessLocation,
  BusinessOperator,
  BackgroundJobSummary,
  BackgroundJobTelemetry,
  CashRegister,
  CustomerEquipment,
  CustomerLocation,
  CustomerLocationProfile,
  LegalBusinessEntity,
  OrganizationTopology,
  PartnerAddress,
  PartnerBankAccount,
  PartnerContact,
  ProductSummary,
  ProductCategory,
  SerialTraceability,
  StockIssue,
  StockReservation,
  StockReturn,
  PartnerSummary,
  Unit,
} from '@vista/contracts';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PasswordService } from '../src/auth/password.service.js';
import { configureHttpApplication } from '../src/common/http-application.js';
import { APP_ENVIRONMENT } from '../src/config/config.module.js';
import { migrateDown, migrateUp } from '../src/database/migration-runner.js';
import { IntegrationEventDispatcherService } from '../src/integration/integration-event-dispatcher.service.js';
import { lowStockEventType } from '../src/integration/low-stock-notification.consumer.js';
import { OutboxPublisherService } from '../src/integration/outbox-publisher.service.js';
import { NotificationDispatcherService } from '../src/notifications/notification-dispatcher.service.js';
import { JobHandlerRegistry } from '../src/jobs/job-handler-registry.service.js';
import { JobQueueService } from '../src/jobs/job-queue.service.js';
import { namedBackgroundJobs } from '../src/jobs/named-background-jobs.js';

const runInfrastructureTests = process.env['RUN_INFRASTRUCTURE_TESTS'] === 'true';
const password = 'Vista-Partner-Test-7!';

describe.skipIf(!runInfrastructureTests)('partner master-data vertical slice', () => {
  let adminDatabase: Pool;
  let application: INestApplication;
  let creatorToken: string;
  let categoryCreatorToken: string;
  let categoryCreatorAccountId: string;
  let database: Pool;
  let databaseName: string;
  let primaryPartner: PartnerSummary;
  let viewerToken: string;
  const runId = randomUUID().replaceAll('-', '');
  const primaryInput: CreatePartnerRequest = {
    companyRepresentative: '  Elena   Ivanova ',
    displayName: `  Vista   Partner ${runId}  `,
    kind: 'legal_entity',
    roles: ['supplier', 'customer'],
    uic: `uic-${runId.slice(0, 12)}`,
    vatNumber: `bg-${runId.slice(0, 12)}`,
  };

  beforeAll(async () => {
    const sourceDatabaseUrl = process.env['DATABASE_URL'];
    const sourceRedisUrl = process.env['REDIS_URL'];
    if (!sourceDatabaseUrl || !sourceRedisUrl) {
      throw new Error('DATABASE_URL and REDIS_URL are required for partner integration tests');
    }

    adminDatabase = new Pool({ connectionString: sourceDatabaseUrl, max: 1 });
    databaseName = `vista_partner_test_${randomUUID().replaceAll('-', '')}`;
    assertTemporaryDatabaseName(databaseName);
    await adminDatabase.query(`CREATE DATABASE ${databaseName}`);
    const isolatedDatabaseUrl = new URL(sourceDatabaseUrl);
    isolatedDatabaseUrl.pathname = `/${databaseName}`;
    const isolatedRedisUrl = new URL(sourceRedisUrl);
    isolatedRedisUrl.pathname = '/13';

    database = new Pool({ connectionString: isolatedDatabaseUrl.toString(), max: 2 });
    const migrationDirectory = fileURLToPath(
      new URL('../src/database/migrations', import.meta.url),
    );
    await migrateUp(database, migrationDirectory);
    const laterMigrationsRolledBack: string[] = [];
    let salesRolledBack = await migrateDown(database, migrationDirectory);
    while (salesRolledBack && salesRolledBack !== '0026_sales_workflow_foundation') {
      laterMigrationsRolledBack.push(salesRolledBack);
      salesRolledBack = await migrateDown(database, migrationDirectory);
    }
    if (salesRolledBack !== '0026_sales_workflow_foundation') {
      throw new Error('Expected to roll back sales workflow before supplier controls');
    }
    if (!laterMigrationsRolledBack.includes('0046_serial_lifecycle_traceability')) {
      throw new Error('The serial lifecycle migration was not exercised during rollback');
    }
    const supplierControlsRolledBack = await migrateDown(database, migrationDirectory);
    if (supplierControlsRolledBack !== '0025_procurement_supplier_controls') {
      throw new Error('Expected to roll back supplier controls before procurement receiving');
    }
    const procurementRolledBack = await migrateDown(database, migrationDirectory);
    if (procurementRolledBack !== '0024_procurement_purchase_receiving') {
      throw new Error('The procurement migration was not the latest rollback target');
    }
    const passwordRolledBack = await migrateDown(database, migrationDirectory);
    if (passwordRolledBack !== '0023_employee_password_change') {
      throw new Error('The password-change migration could not be rolled back before event tests');
    }
    const rolledBack = await migrateDown(database, migrationDirectory);
    if (rolledBack !== '0022_reliable_integration_events') {
      throw new Error('The reliable integration migration was not the latest rollback target');
    }
    const reapplied = await migrateUp(database, migrationDirectory);
    if (
      !reapplied.includes('0022_reliable_integration_events') ||
      !reapplied.includes('0023_employee_password_change') ||
      !reapplied.includes('0024_procurement_purchase_receiving') ||
      !reapplied.includes('0025_procurement_supplier_controls') ||
      !reapplied.includes('0026_sales_workflow_foundation') ||
      !reapplied.includes('0046_serial_lifecycle_traceability')
    ) {
      throw new Error('The reliable integration and dependent migrations could not be reapplied');
    }
    Object.assign(process.env, {
      BUSINESS_TIMEZONE: 'Europe/Sofia',
      CORS_ORIGINS: 'http://localhost:5173',
      DATABASE_URL: isolatedDatabaseUrl.toString(),
      NODE_ENV: 'test',
      REDIS_URL: isolatedRedisUrl.toString(),
      REQUEST_LOGGING_ENABLED: 'false',
      S3_ACCESS_KEY_ID: 'test',
      S3_BUCKET: 'vista-test',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_SECRET_ACCESS_KEY: 'test-secret',
      SESSION_SECRET: 'a-test-session-secret-at-least-32-characters',
      SMTP_FROM: 'test@example.invalid',
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1025',
      TOTP_ENCRYPTION_KEY: 'a-test-totp-key-with-at-least-32-characters',
    });

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    application = module.createNestApplication();
    configureHttpApplication(application, application.get<AppEnvironment>(APP_ENVIRONMENT));
    await application.init();

    const passwordHash = await application.get(PasswordService).hash(password);
    const creatorEmail = `partner-creator-${runId}@example.invalid`;
    const categoryCreatorEmail = `category-creator-${runId}@example.invalid`;
    const viewerEmail = `partner-viewer-${runId}@example.invalid`;
    const creatorId = await createAccount(database, 'creator', creatorEmail, passwordHash);
    categoryCreatorAccountId = await createAccount(
      database,
      'category-creator',
      categoryCreatorEmail,
      passwordHash,
    );
    const viewerId = await createAccount(database, 'viewer', viewerEmail, passwordHash);
    await grantPermissions(database, creatorId, 'crm', ['view', 'create', 'edit', 'delete']);
    await grantPermissions(database, categoryCreatorAccountId, 'erp.warehouse', [
      'view',
      'create',
      'edit',
      'approve',
    ]);
    await grantPermissions(database, categoryCreatorAccountId, 'platform.organization', [
      'view',
      'create',
    ]);
    await grantPermissions(database, categoryCreatorAccountId, 'platform', ['view', 'edit']);
    await grantPermissions(database, viewerId, 'crm', ['view']);
    creatorToken = await login(application, creatorEmail);
    categoryCreatorToken = await login(application, categoryCreatorEmail);
    viewerToken = await login(application, viewerEmail);
  }, 30_000);

  afterAll(async () => {
    if (application) {
      for (const token of [creatorToken, categoryCreatorToken, viewerToken]) {
        if (token) {
          await request(application.getHttpServer())
            .post('/api/v1/auth/logout')
            .set('authorization', `Bearer ${token}`);
        }
      }
      await application.close();
    }
    if (database) await database.end();
    if (adminDatabase && databaseName) {
      assertTemporaryDatabaseName(databaseName);
      await adminDatabase.query(`DROP DATABASE IF EXISTS ${databaseName}`);
      await adminDatabase.end();
    }
  });

  it('protects the registry and enforces create permission in the backend', async () => {
    await request(application.getHttpServer()).get('/api/v1/master-data/partners').expect(401);

    const denied = await request(application.getHttpServer())
      .post('/api/v1/master-data/partners')
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `denied-${runId}`)
      .send(primaryInput)
      .expect(403);
    expect(denied.body).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
  });

  it('exposes payload-free background job lifecycle metrics only to platform operators', async () => {
    await request(application.getHttpServer())
      .get('/api/v1/platform/jobs/metrics/prometheus')
      .expect(401);
    await request(application.getHttpServer())
      .get('/api/v1/platform/jobs/metrics/prometheus')
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(403);
    await request(application.getHttpServer()).get('/api/v1/platform/jobs/metrics').expect(401);
    await request(application.getHttpServer())
      .get('/api/v1/platform/jobs/metrics')
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(403);

    const jobs = application.get(JobQueueService);
    const job = await jobs.enqueue({
      correlationId: `job${runId}`,
      idempotencyKey: `job-visibility-${runId}`,
      name: 'operations.visibility-test',
      payload: { never: 'returned-by-the-api' },
    });
    try {
      const telemetry = await request(application.getHttpServer())
        .get('/api/v1/platform/jobs/metrics')
        .set('authorization', `Bearer ${categoryCreatorToken}`)
        .expect(200);
      const telemetryBody = telemetry.body as BackgroundJobTelemetry;
      const exported = await request(application.getHttpServer())
        .get('/api/v1/platform/jobs/metrics/prometheus')
        .set('authorization', `Bearer ${categoryCreatorToken}`)
        .expect(200);
      expect(exported.headers['content-type']).toContain('text/plain');
      expect(exported.headers['cache-control']).toBe('no-store');
      expect(exported.text).toContain('# TYPE vista_jobs gauge');
      expect(exported.text).not.toContain('returned-by-the-api');
      for (const value of [
        telemetryBody.active,
        telemetryBody.completed,
        telemetryBody.delayed,
        telemetryBody.failed,
        telemetryBody.waiting,
      ]) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
      expect(typeof telemetryBody.paused).toBe('boolean');
      expect(Number.isNaN(Date.parse(telemetryBody.timestamp))).toBe(false);

      const summary = await request(application.getHttpServer())
        .get(`/api/v1/platform/jobs/${job.jobId}`)
        .set('authorization', `Bearer ${categoryCreatorToken}`)
        .expect(200);
      const summaryBody = summary.body as BackgroundJobSummary;
      expect(summaryBody).toMatchObject({
        attemptsMade: 0,
        id: job.jobId,
        name: 'operations.visibility-test',
        state: 'waiting',
      });
      expect(summaryBody).not.toHaveProperty('payload');

      const missing = await request(application.getHttpServer())
        .get('/api/v1/platform/jobs/does-not-exist')
        .set('authorization', `Bearer ${categoryCreatorToken}`)
        .expect(404);
      expect(missing.body).toMatchObject({ error: { code: 'BACKGROUND_JOB_NOT_FOUND' } });
    } finally {
      await jobs.remove(job.jobId);
    }
  });

  it('registers every named scheduled handler and deduplicates its durable trigger', async () => {
    const handlers = application.get(JobHandlerRegistry);
    const expectedNames = [...namedBackgroundJobs].sort();
    expect(handlers.registeredNames()).toEqual(
      [...expectedNames, 'integration.event.consume', 'notification.dispatch'].sort(),
    );

    for (const name of expectedNames) {
      const context = {
        attemptNumber: 1,
        correlationId: `scheduled${runId}`,
        enqueuedAt: '2026-08-10T08:00:00.000Z',
        idempotencyKey: `${name}-${runId}`,
        jobId: `job-${name}-${runId}`,
        maxAttempts: 5,
        name,
        payload: { scheduledFor: '2026-08-10T08:00:00.000Z' },
        retryAllowed: true,
      };
      await expect(handlers.execute(context)).resolves.toMatchObject({ deduplicated: false });
      await expect(handlers.execute(context)).resolves.toMatchObject({ deduplicated: true });
    }

    const evidence = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM integration.outbox_events
       WHERE aggregate_type = 'scheduled_job' AND correlation_id = $1`,
      [`scheduled${runId}`],
    );
    expect(evidence.rows[0]?.count).toBe(String(expectedNames.length));
  });

  it('publishes ordered events, deduplicates consumption, recovers claims, and retains poison messages', async () => {
    const publisher = application.get(OutboxPublisherService);
    const dispatcher = application.get(IntegrationEventDispatcherService);
    const aggregateId = randomUUID();
    const firstId = randomUUID();
    const secondId = randomUUID();
    const validPayload = {
      availableQuantity: '1.0000',
      cycleNumber: '1',
      minimumQuantity: '2.0000',
      productId: aggregateId,
      recipientAccountId: categoryCreatorAccountId,
      recommendedQuantity: '4.0000',
      targetQuantity: '5.0000',
      warehouseId: randomUUID(),
    };
    await database.query(
      `INSERT INTO integration.outbox_events (
         id, aggregate_type, aggregate_id, event_type, event_version,
         correlation_id, idempotency_key, payload, occurred_at
       ) VALUES
         ($1, 'inventory_product', $3, $4, 1, $5, $6, $7, now() - interval '2 seconds'),
         ($2, 'inventory_product', $3, $4, 1, $5, $8, $9, now() - interval '1 second')`,
      [
        firstId,
        secondId,
        aggregateId,
        lowStockEventType,
        `integration${runId}`,
        `ordered-first-${runId}`,
        validPayload,
        `ordered-second-${runId}`,
        { ...validPayload, cycleNumber: '2' },
      ],
    );

    await publisher.publishAvailable();
    const orderedBefore = await database.query<{ id: string; status: string }>(
      `SELECT id, status FROM integration.outbox_events
       WHERE id = ANY($1::uuid[]) ORDER BY sequence_number`,
      [[firstId, secondId]],
    );
    expect(orderedBefore.rows).toEqual([
      { id: firstId, status: 'published' },
      { id: secondId, status: 'pending' },
    ]);
    await dispatcher.dispatch(firstId, true);
    await dispatcher.dispatch(firstId, true);
    await publisher.publishAvailable();
    await dispatcher.dispatch(secondId, true);
    const consumed = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM notifications.messages
       WHERE idempotency_key = ANY($1::varchar[])`,
      [[firstId, secondId]],
    );
    expect(consumed.rows[0]?.count).toBe('2');

    const recoveredId = randomUUID();
    await database.query(
      `INSERT INTO integration.outbox_events (
         id, aggregate_type, aggregate_id, event_type, event_version,
         correlation_id, idempotency_key, payload, status, processing_started_at
       ) VALUES ($1, 'inventory_product', $2, $3, 1, $4, $5, $6,
                 'publishing', now() - interval '10 minutes')`,
      [
        recoveredId,
        randomUUID(),
        lowStockEventType,
        `integration${runId}`,
        `recovered-${runId}`,
        { ...validPayload, cycleNumber: '3', productId: randomUUID() },
      ],
    );
    await publisher.publishAvailable();
    await dispatcher.dispatch(recoveredId, true);
    const recovered = await database.query<{ status: string }>(
      'SELECT status FROM integration.outbox_events WHERE id = $1',
      [recoveredId],
    );
    expect(recovered.rows[0]?.status).toBe('completed');

    const poisonId = randomUUID();
    await database.query(
      `INSERT INTO integration.outbox_events (
         id, aggregate_type, aggregate_id, event_type, event_version,
         correlation_id, idempotency_key, payload
       ) VALUES ($1, 'inventory_product', $2, $3, 1, $4, $5, $6)`,
      [
        poisonId,
        randomUUID(),
        lowStockEventType,
        `integration${runId}`,
        `poison-${runId}`,
        { productId: randomUUID() },
      ],
    );
    await publisher.publishAvailable();
    await expect(dispatcher.dispatch(poisonId, false)).rejects.toThrow();

    await request(application.getHttpServer())
      .get('/api/v1/platform/integrations/metrics')
      .expect(401);
    const denied = await request(application.getHttpServer())
      .get('/api/v1/platform/integrations/metrics')
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(403);
    expect(denied.body).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
    const detail = await request(application.getHttpServer())
      .get(`/api/v1/platform/integrations/events/${poisonId}`)
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .expect(200);
    expect(detail.body).toMatchObject({
      deliveries: [expect.objectContaining({ status: 'dead_letter' })],
      id: poisonId,
      replayCount: 0,
      status: 'dead_letter',
    });
    expect(JSON.stringify(detail.body)).not.toContain('recipientAccountId');

    const replayed = await request(application.getHttpServer())
      .post(`/api/v1/platform/integrations/events/${poisonId}/replay`)
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `replay-poison-${runId}`)
      .send({ expectedReplayCount: 0 })
      .expect(200);
    expect(replayed.body).toMatchObject({ id: poisonId, replayCount: 1 });
    await expect(dispatcher.dispatch(poisonId, false)).rejects.toThrow();
    const audit = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit.events
       WHERE action = 'integration.event.replayed' AND target_id = $1`,
      [poisonId],
    );
    expect(audit.rows[0]?.count).toBe('1');
  });

  it('creates normalized canonical partner data with roles, audit, and outbox atomically', async () => {
    const response = await request(application.getHttpServer())
      .post('/api/v1/master-data/partners')
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `partner-create-${runId}`)
      .send(primaryInput)
      .expect(201);

    primaryPartner = response.body as PartnerSummary;
    expect(primaryPartner).toMatchObject({
      companyRepresentative: 'Elena Ivanova',
      displayName: `Vista Partner ${runId}`,
      kind: 'legal_entity',
      roles: ['customer', 'supplier'],
      uic: `UIC-${runId.slice(0, 12).toUpperCase()}`,
      vatNumber: `BG-${runId.slice(0, 12).toUpperCase()}`,
      version: 1,
    });

    const evidence = await database.query<{
      audit_count: string;
      outbox_count: string;
      role_count: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM audit.events
          WHERE action = 'master_data.partner.created' AND target_id = $1) AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events
          WHERE event_type = 'master_data.partner.created' AND aggregate_id = $1) AS outbox_count,
         (SELECT count(*)::text FROM master_data.partner_roles
          WHERE partner_id = $1) AS role_count`,
      [primaryPartner.id],
    );
    expect(evidence.rows[0]).toEqual({ audit_count: '1', outbox_count: '1', role_count: '2' });
  });

  it('replays the original response for the same idempotent command', async () => {
    const replay = await request(application.getHttpServer())
      .post('/api/v1/master-data/partners')
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `partner-create-${runId}`)
      .send(primaryInput)
      .expect(201);
    expect(replay.body).toEqual(primaryPartner);

    const counts = await database.query<{ audit_count: string; partner_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM master_data.partners WHERE id = $1) AS partner_count,
         (SELECT count(*)::text FROM audit.events
          WHERE action = 'master_data.partner.created' AND target_id = $1) AS audit_count`,
      [primaryPartner.id],
    );
    expect(counts.rows[0]).toEqual({ audit_count: '1', partner_count: '1' });
  });

  it('rejects idempotency-key reuse with a different normalized request', async () => {
    const conflict = await request(application.getHttpServer())
      .post('/api/v1/master-data/partners')
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `partner-create-${runId}`)
      .send({ ...primaryInput, displayName: 'A different company' })
      .expect(409);
    expect(conflict.body).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });
  });

  it('warns and blocks normalized legal-name and UIC duplicates without merging', async () => {
    const duplicate = await request(application.getHttpServer())
      .post('/api/v1/master-data/partners')
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `partner-duplicate-${runId}`)
      .send({
        displayName: `vista    partner ${runId}`,
        kind: 'legal_entity',
        roles: ['partner'],
        uic: primaryInput.uic?.toUpperCase(),
      })
      .expect(409);
    expect(duplicate.body).toMatchObject({
      error: { code: 'PARTNER_DUPLICATE_CANDIDATE' },
    });

    const candidates = await request(application.getHttpServer())
      .get('/api/v1/master-data/partners/duplicates')
      .query({ name: primaryInput.displayName, uic: primaryInput.uic })
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(candidates.body.candidates).toEqual([
      expect.objectContaining({ id: primaryPartner.id, matchedBy: ['name', 'uic'] }),
    ]);
  });

  it('allows individuals with the same display name while retaining immutable IDs', async () => {
    const individualInput: CreatePartnerRequest = {
      displayName: 'Ivan Petrov',
      kind: 'individual',
      roles: ['customer'],
    };
    const first = await createPartner(
      application,
      creatorToken,
      `individual-a-${runId}`,
      individualInput,
    );
    const second = await createPartner(
      application,
      creatorToken,
      `individual-b-${runId}`,
      individualInput,
    );
    expect(first.id).not.toBe(second.id);
  });

  it('maintains partners with optimistic versions and reversible deactivation', async () => {
    const created = await createPartner(application, creatorToken, `maintain-${runId}`, {
      displayName: `Maintenance Partner ${runId}`,
      kind: 'legal_entity',
      roles: ['partner'],
      uic: `maint-${runId.slice(0, 12)}`,
    });
    const updateInput = {
      companyRepresentative: 'Updated Representative',
      displayName: `Maintenance Partner Updated ${runId}`,
      expectedVersion: created.version,
      kind: 'legal_entity',
      roles: ['customer', 'partner'],
      uic: `maint-${runId.slice(0, 12)}`,
      vatNumber: `bg-maint-${runId.slice(0, 8)}`,
    };
    const updatedResponse = await request(application.getHttpServer())
      .put(`/api/v1/master-data/partners/${created.id}`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `maintain-update-${runId}`)
      .send(updateInput)
      .expect(200);
    const updated = updatedResponse.body as PartnerSummary;
    expect(updated).toMatchObject({
      displayName: `Maintenance Partner Updated ${runId}`,
      roles: ['customer', 'partner'],
      version: 2,
    });
    await request(application.getHttpServer())
      .put(`/api/v1/master-data/partners/${created.id}`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `maintain-stale-${runId}`)
      .send({ ...updateInput, displayName: 'Stale update' })
      .expect(409)
      .expect(({ body }) =>
        expect(body).toMatchObject({ error: { code: 'PARTNER_VERSION_CONFLICT' } }),
      );
    const deactivatedResponse = await request(application.getHttpServer())
      .post(`/api/v1/master-data/partners/${created.id}/deactivate`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `maintain-deactivate-${runId}`)
      .send({ expectedVersion: updated.version })
      .expect(200);
    const deactivated = deactivatedResponse.body as PartnerSummary;
    expect(deactivated).toMatchObject({ active: false, version: 3 });
    const deactivatedReplay = await request(application.getHttpServer())
      .post(`/api/v1/master-data/partners/${created.id}/deactivate`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `maintain-deactivate-${runId}`)
      .send({ expectedVersion: updated.version })
      .expect(200);
    expect(deactivatedReplay.body).toEqual(deactivated);
    const reactivated = await request(application.getHttpServer())
      .post(`/api/v1/master-data/partners/${created.id}/reactivate`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `maintain-reactivate-${runId}`)
      .send({ expectedVersion: deactivated.version })
      .expect(200);
    expect(reactivated.body).toMatchObject({ active: true, version: 4 });
    const evidence = await database.query<{ audit_count: string; outbox_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM audit.events WHERE target_id = $1 AND action IN
           ('master_data.partner.updated', 'master_data.partner.deactivated', 'master_data.partner.reactivated')) AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events WHERE aggregate_id = $1 AND event_type IN
           ('master_data.partner.updated', 'master_data.partner.deactivated', 'master_data.partner.reactivated')) AS outbox_count`,
      [created.id],
    );
    expect(evidence.rows[0]).toEqual({ audit_count: '3', outbox_count: '3' });
  });

  it('keeps contacts, addresses, and bank accounts in the canonical profile with auditable idempotent writes', async () => {
    const address: CreatePartnerAddressRequest = {
      addressLine1: '  12   Hristo Botev Blvd. ',
      addressLine2: ' Floor 2 ',
      city: '  Vratsa ',
      countryCode: 'bg',
      postalCode: ' 3000 ',
      type: 'billing',
    };
    const contact: CreatePartnerContactRequest = {
      contactRole: ' accountant ',
      displayName: '  Maria   Petrova ',
      email: ' MARIA.PETROVA@EXAMPLE.INVALID ',
      jobTitle: ' Chief accountant ',
      telephone: ' +359 88 123 4567 ',
    };
    const bankAccount: CreatePartnerBankAccountRequest = {
      bankName: '  Example Bank ',
      bic: ' westgb22 ',
      currencyCode: 'bgn',
      iban: 'GB82 WEST 1234 5698 7654 32',
    };

    const denied = await request(application.getHttpServer())
      .post(`/api/v1/master-data/partners/${primaryPartner.id}/addresses`)
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `address-denied-${runId}`)
      .send(address)
      .expect(403);
    expect(denied.body).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });

    const addressResponse = await request(application.getHttpServer())
      .post(`/api/v1/master-data/partners/${primaryPartner.id}/addresses`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `address-create-${runId}`)
      .send(address)
      .expect(201);
    expect(addressResponse.body).toMatchObject({
      addressLine1: '12 Hristo Botev Blvd.',
      addressLine2: 'Floor 2',
      city: 'Vratsa',
      countryCode: 'BG',
      postalCode: '3000',
      type: 'billing',
    });
    const createdAddress = addressResponse.body as PartnerAddress;

    const addressReplay = await request(application.getHttpServer())
      .post(`/api/v1/master-data/partners/${primaryPartner.id}/addresses`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `address-create-${runId}`)
      .send(address)
      .expect(201);
    expect(addressReplay.body).toEqual(addressResponse.body);

    const contactResponse = await request(application.getHttpServer())
      .post(`/api/v1/master-data/partners/${primaryPartner.id}/contacts`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `contact-create-${runId}`)
      .send(contact)
      .expect(201);
    expect(contactResponse.body).toMatchObject({
      contactRole: 'accountant',
      displayName: 'Maria Petrova',
      email: 'maria.petrova@example.invalid',
      jobTitle: 'Chief accountant',
      telephone: '+359 88 123 4567',
    });
    const createdContact = contactResponse.body as PartnerContact;

    const bankResponse = await request(application.getHttpServer())
      .post(`/api/v1/master-data/partners/${primaryPartner.id}/bank-accounts`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `bank-create-${runId}`)
      .send(bankAccount)
      .expect(201);
    expect(bankResponse.body).toMatchObject({
      bankName: 'Example Bank',
      bic: 'WESTGB22',
      currencyCode: 'BGN',
      iban: 'GB82WEST12345698765432',
    });
    const createdBankAccount = bankResponse.body as PartnerBankAccount;

    const profile = await request(application.getHttpServer())
      .get(`/api/v1/master-data/partners/${primaryPartner.id}/profile`)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(profile.body).toMatchObject({
      addresses: [expect.objectContaining({ id: createdAddress.id })],
      bankAccounts: [expect.objectContaining({ id: createdBankAccount.id })],
      contacts: [expect.objectContaining({ id: createdContact.id })],
      partner: { id: primaryPartner.id, version: 4 },
    });

    const duplicateBank = await request(application.getHttpServer())
      .post(`/api/v1/master-data/partners/${primaryPartner.id}/bank-accounts`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `bank-duplicate-${runId}`)
      .send(bankAccount)
      .expect(409);
    expect(duplicateBank.body).toMatchObject({ error: { code: 'BANK_ACCOUNT_DUPLICATE' } });

    const evidence = await database.query<{ audit_count: string; outbox_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM audit.events
          WHERE action IN (
            'master_data.partner.address.created',
            'master_data.partner.contact.created',
            'master_data.partner.bank_account.created'
          )) AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events
          WHERE aggregate_id = $1
            AND event_type IN (
              'master_data.partner.address.created',
              'master_data.partner.contact.created',
              'master_data.partner.bank_account.created'
            )) AS outbox_count`,
      [primaryPartner.id],
    );
    expect(evidence.rows[0]).toEqual({ audit_count: '3', outbox_count: '3' });
  });

  it('registers customer locations and installed equipment with contact, warranty, audit, and retry evidence', async () => {
    const denied = await request(application.getHttpServer())
      .post(`/api/v1/master-data/partners/${primaryPartner.id}/locations`)
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `location-denied-${runId}`)
      .send({
        addressLine1: '1 Industrial Road',
        city: 'Vratsa',
        locationType: 'Fuel station',
        name: 'North site',
      })
      .expect(403);
    expect(denied.body).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });

    const contactResponse = await request(application.getHttpServer())
      .post(`/api/v1/master-data/partners/${primaryPartner.id}/contacts`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `asset-contact-${runId}`)
      .send({
        contactRole: 'technical contact',
        displayName: '  Georgi   Dimitrov ',
        telephone: ' +359 88 555 0101 ',
      })
      .expect(201);
    const responsibleContact = contactResponse.body as PartnerContact;

    const locationInput = {
      addressLine1: '  1   Industrial Road ',
      addressLine2: ' Service entrance ',
      city: ' Vratsa ',
      countryCode: 'bg',
      locationType: ' Fuel station ',
      name: '  North   site ',
      postalCode: '3000',
      responsibleContactId: responsibleContact.id,
    };
    const locationResponse = await request(application.getHttpServer())
      .post(`/api/v1/master-data/partners/${primaryPartner.id}/locations`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `location-create-${runId}`)
      .send(locationInput)
      .expect(201);
    const location = locationResponse.body as CustomerLocation;
    expect(location).toMatchObject({
      addressLine1: '1 Industrial Road',
      addressLine2: 'Service entrance',
      city: 'Vratsa',
      countryCode: 'BG',
      locationType: 'Fuel station',
      name: 'North site',
      partnerId: primaryPartner.id,
      responsibleContact: { id: responsibleContact.id, displayName: 'Georgi Dimitrov' },
      version: 1,
    });

    const replay = await request(application.getHttpServer())
      .post(`/api/v1/master-data/partners/${primaryPartner.id}/locations`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `location-create-${runId}`)
      .send(locationInput)
      .expect(201);
    expect(replay.body).toEqual(location);

    const equipmentInput = {
      deviceName: '  Legacy fiscal device ',
      purchaseDate: '2025-01-15',
      serialNumber: ` EXT-${runId}-01 `,
      status: 'active',
      warrantyEndsOn: '2027-01-15',
      warrantyStartsOn: '2025-01-15',
    };
    const equipmentResponse = await request(application.getHttpServer())
      .post(`/api/v1/master-data/partners/${primaryPartner.id}/locations/${location.id}/equipment`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `equipment-create-${runId}`)
      .send(equipmentInput)
      .expect(201);
    const equipment = equipmentResponse.body as CustomerEquipment;
    expect(equipment).toMatchObject({
      customerLocationId: location.id,
      deviceName: 'Legacy fiscal device',
      purchaseDate: '2025-01-15',
      serialNumber: `EXT-${runId}-01`,
      status: 'active',
      warrantyEndsOn: '2027-01-15',
      warrantyStartsOn: '2025-01-15',
    });
    expect(equipment).not.toHaveProperty('serializedItemId');

    const duplicateSerial = await request(application.getHttpServer())
      .post(`/api/v1/master-data/partners/${primaryPartner.id}/locations/${location.id}/equipment`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `equipment-duplicate-${runId}`)
      .send({ ...equipmentInput, deviceName: 'Duplicate serial attempt' })
      .expect(409);
    expect(duplicateSerial.body).toMatchObject({
      error: { code: 'CUSTOMER_EQUIPMENT_SERIAL_DUPLICATE' },
    });

    const locations = await request(application.getHttpServer())
      .get(`/api/v1/master-data/partners/${primaryPartner.id}/locations`)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    const locationProfiles = locations.body as CustomerLocationProfile[];
    expect(locationProfiles).toHaveLength(1);
    expect(locationProfiles[0]?.location.id).toBe(location.id);
    expect(locationProfiles[0]?.equipment[0]?.id).toBe(equipment.id);

    const currentProfile = required(locationProfiles[0], 'Customer location profile missing');
    const updatedLocationResponse = await request(application.getHttpServer())
      .put(`/api/v1/master-data/partners/${primaryPartner.id}/locations/${location.id}`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `location-update-${runId}`)
      .send({
        ...locationInput,
        addressLine1: '2 Industrial Road',
        expectedVersion: currentProfile.location.version,
        name: 'North service site',
      })
      .expect(200);
    const updatedLocation = updatedLocationResponse.body as CustomerLocation;
    expect(updatedLocation).toMatchObject({
      addressLine1: '2 Industrial Road',
      name: 'North service site',
      version: currentProfile.location.version + 1,
    });
    const updatedEquipmentResponse = await request(application.getHttpServer())
      .put(
        `/api/v1/master-data/partners/${primaryPartner.id}/locations/${location.id}/equipment/${equipment.id}`,
      )
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `equipment-update-${runId}`)
      .send({
        deviceName: 'Legacy fiscal device serviced',
        expectedVersion: equipment.version,
        purchaseDate: equipment.purchaseDate,
        status: 'under_repair',
        warrantyEndsOn: equipment.warrantyEndsOn,
        warrantyStartsOn: equipment.warrantyStartsOn,
      })
      .expect(200);
    const updatedEquipment = updatedEquipmentResponse.body as CustomerEquipment;
    expect(updatedEquipment).toMatchObject({
      deviceName: 'Legacy fiscal device serviced',
      serialNumber: equipment.serialNumber,
      status: 'under_repair',
      version: equipment.version + 1,
    });
    const refreshedProfilesResponse = await request(application.getHttpServer())
      .get(`/api/v1/master-data/partners/${primaryPartner.id}/locations`)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    const refreshedProfile = required(
      (refreshedProfilesResponse.body as CustomerLocationProfile[])[0],
      'Updated customer location profile missing',
    );
    const blockedLocationDeactivation = await request(application.getHttpServer())
      .post(`/api/v1/master-data/partners/${primaryPartner.id}/locations/${location.id}/deactivate`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `location-deactivate-blocked-${runId}`)
      .send({ expectedVersion: refreshedProfile.location.version })
      .expect(409);
    expect(blockedLocationDeactivation.body).toMatchObject({
      error: { code: 'CUSTOMER_LOCATION_HAS_ACTIVE_EQUIPMENT' },
    });
    const deactivatedEquipmentResponse = await request(application.getHttpServer())
      .post(
        `/api/v1/master-data/partners/${primaryPartner.id}/locations/${location.id}/equipment/${equipment.id}/deactivate`,
      )
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `equipment-deactivate-${runId}`)
      .send({ expectedVersion: updatedEquipment.version })
      .expect(200);
    const deactivatedEquipment = deactivatedEquipmentResponse.body as CustomerEquipment;
    expect(deactivatedEquipment).toMatchObject({ active: false, version: 3 });
    const afterEquipmentDeactivation = await request(application.getHttpServer())
      .get(`/api/v1/master-data/partners/${primaryPartner.id}/locations`)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    const deactivationProfile = required(
      (afterEquipmentDeactivation.body as CustomerLocationProfile[])[0],
      'Deactivation profile missing',
    );
    const deactivatedLocationResponse = await request(application.getHttpServer())
      .post(`/api/v1/master-data/partners/${primaryPartner.id}/locations/${location.id}/deactivate`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `location-deactivate-${runId}`)
      .send({ expectedVersion: deactivationProfile.location.version })
      .expect(200);
    const deactivatedLocation = deactivatedLocationResponse.body as CustomerLocation;
    expect(deactivatedLocation.active).toBe(false);
    const reactivatedLocationResponse = await request(application.getHttpServer())
      .post(`/api/v1/master-data/partners/${primaryPartner.id}/locations/${location.id}/reactivate`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `location-reactivate-${runId}`)
      .send({ expectedVersion: deactivatedLocation.version })
      .expect(200);
    const reactivatedLocation = reactivatedLocationResponse.body as CustomerLocation;
    expect(reactivatedLocation.active).toBe(true);
    const reactivatedEquipment = await request(application.getHttpServer())
      .post(
        `/api/v1/master-data/partners/${primaryPartner.id}/locations/${location.id}/equipment/${equipment.id}/reactivate`,
      )
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `equipment-reactivate-${runId}`)
      .send({ expectedVersion: deactivatedEquipment.version })
      .expect(200);
    expect(reactivatedEquipment.body).toMatchObject({ active: true, version: 4 });

    const maintenanceEvidence = await database.query<{ audit_count: string; outbox_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM audit.events WHERE target_id IN ($1, $2) AND action IN
           ('master_data.customer_location.updated', 'master_data.customer_location.deactivated',
            'master_data.customer_location.reactivated', 'master_data.customer_equipment.updated',
            'master_data.customer_equipment.deactivated', 'master_data.customer_equipment.reactivated')) AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events WHERE aggregate_id IN ($1, $2) AND event_type IN
           ('master_data.customer_location.updated', 'master_data.customer_location.deactivated',
            'master_data.customer_location.reactivated', 'master_data.customer_equipment.updated',
            'master_data.customer_equipment.deactivated', 'master_data.customer_equipment.reactivated')) AS outbox_count`,
      [location.id, equipment.id],
    );
    expect(maintenanceEvidence.rows[0]).toEqual({ audit_count: '6', outbox_count: '6' });

    const evidence = await database.query<{ audit_count: string; outbox_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM audit.events
          WHERE action IN (
            'master_data.customer_location.created',
            'master_data.customer_equipment.created'
          ) AND target_id IN ($1, $2)) AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events
          WHERE event_type IN (
            'master_data.customer_location.created',
            'master_data.customer_equipment.created'
          ) AND aggregate_id IN ($1, $2)) AS outbox_count`,
      [location.id, equipment.id],
    );
    expect(evidence.rows[0]).toEqual({ audit_count: '2', outbox_count: '2' });
  });

  it('supports server-side search, role filtering, pagination, and deterministic sorting', async () => {
    const response = await request(application.getHttpServer())
      .get('/api/v1/master-data/partners')
      .query({ direction: 'asc', page: 1, pageSize: 10, role: 'supplier', search: 'Vista Partner' })
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(response.body).toMatchObject({ page: 1, pageSize: 10, total: 1, totalPages: 1 });
    expect(response.body.items).toEqual([expect.objectContaining({ id: primaryPartner.id })]);

    await request(application.getHttpServer())
      .get(`/api/v1/master-data/partners/${primaryPartner.id}`)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
  });

  it('builds an empty configurable organization topology and links warehouses without seeded assumptions', async () => {
    await request(application.getHttpServer()).get('/api/v1/organization/topology').expect(401);
    await request(application.getHttpServer())
      .post('/api/v1/organization/legal-entities')
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `organization-denied-${runId}`)
      .send({ code: 'VS', name: 'Vista Service Ltd.' })
      .expect(403);

    const entityInput = {
      code: ` vs-${runId.slice(0, 6)} `,
      name: '  Vista   Service Ltd. ',
      uic: `UIC-${runId.slice(0, 10)}`,
      vatNumber: ` bg-${runId.slice(0, 10)} `,
    };
    const entityResponse = await request(application.getHttpServer())
      .post('/api/v1/organization/legal-entities')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `legal-entity-${runId}`)
      .send(entityInput)
      .expect(201);
    const entity = entityResponse.body as LegalBusinessEntity;
    expect(entity).toMatchObject({
      code: `VS-${runId.slice(0, 6).toUpperCase()}`,
      name: 'Vista Service Ltd.',
      vatNumber: `BG-${runId.slice(0, 10).toUpperCase()}`,
    });
    const entityReplay = await request(application.getHttpServer())
      .post('/api/v1/organization/legal-entities')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `legal-entity-${runId}`)
      .send(entityInput)
      .expect(201);
    expect(entityReplay.body).toEqual(entity);

    const branchResponse = await request(application.getHttpServer())
      .post(`/api/v1/organization/legal-entities/${entity.id}/branches`)
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `branch-${runId}`)
      .send({ code: 'VRC', name: 'Vratsa operations' })
      .expect(201);
    const branch = branchResponse.body as BusinessBranch;

    const locationResponse = await request(application.getHttpServer())
      .post(`/api/v1/organization/branches/${branch.id}/locations`)
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `business-location-${runId}`)
      .send({
        addressLine1: '1 Operations Blvd.',
        city: 'Vratsa',
        code: `VRC-${runId.slice(0, 5)}`,
        locationType: 'Service and retail center',
        name: 'Vratsa center',
        postalCode: '3000',
      })
      .expect(201);
    const location = locationResponse.body as BusinessLocation;

    const operatorResponse = await request(application.getHttpServer())
      .post(`/api/v1/organization/locations/${location.id}/operators`)
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `operator-${runId}`)
      .send({ accountId: categoryCreatorAccountId, code: 'OP-01' })
      .expect(201);
    const operator = operatorResponse.body as BusinessOperator;
    expect(operator).toMatchObject({
      accountId: categoryCreatorAccountId,
      businessLocationId: location.id,
      displayName: 'Partner category-creator',
    });

    const registerResponse = await request(application.getHttpServer())
      .post(`/api/v1/organization/locations/${location.id}/registers`)
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `cash-register-${runId}`)
      .send({ code: 'POS-01', name: 'Front counter', operatorIds: [operator.id, operator.id] })
      .expect(201);
    const cashRegister = registerResponse.body as CashRegister;
    expect(cashRegister.operatorIds).toEqual([operator.id]);

    const warehouseResponse = await request(application.getHttpServer())
      .post('/api/v1/warehouse/warehouses')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `topology-warehouse-${runId}`)
      .send({
        businessLocationId: location.id,
        code: `VRC-WH-${runId.slice(0, 4)}`,
        name: 'Vratsa service warehouse',
        technicianOperatorId: operator.id,
        type: 'technician',
      })
      .expect(201);
    expect(warehouseResponse.body).toMatchObject({
      businessLocationId: location.id,
      technicianOperatorId: operator.id,
      type: 'technician',
    });

    const topologyResponse = await request(application.getHttpServer())
      .get('/api/v1/organization/topology')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .expect(200);
    const topology = topologyResponse.body as OrganizationTopology;
    expect(topology.legalEntities).toEqual([expect.objectContaining({ id: entity.id })]);
    expect(topology.branches).toEqual([expect.objectContaining({ id: branch.id })]);
    expect(topology.locations).toEqual([expect.objectContaining({ id: location.id })]);
    expect(topology.operators).toEqual([expect.objectContaining({ id: operator.id })]);
    expect(topology.cashRegisters).toEqual([
      expect.objectContaining({ id: cashRegister.id, operatorIds: [operator.id] }),
    ]);

    const membersResponse = await request(application.getHttpServer())
      .get('/api/v1/organization/members')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .expect(200);
    expect(membersResponse.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ accountId: categoryCreatorAccountId })]),
    );

    const evidence = await database.query<{ audit_count: string; outbox_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM audit.events
          WHERE target_id = ANY($1::uuid[])) AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events
          WHERE aggregate_id = ANY($1::uuid[])) AS outbox_count`,
      [[entity.id, branch.id, location.id, operator.id, cashRegister.id]],
    );
    expect(evidence.rows[0]).toEqual({ audit_count: '5', outbox_count: '5' });
  });

  it('creates a controlled category hierarchy without production seed data', async () => {
    await request(application.getHttpServer())
      .get('/api/v1/master-data/product-categories')
      .expect(401);

    const denied = await request(application.getHttpServer())
      .post('/api/v1/master-data/product-categories')
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `category-denied-${runId}`)
      .send({ name: 'Fiscal devices' })
      .expect(403);
    expect(denied.body).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });

    const rootResponse = await request(application.getHttpServer())
      .post('/api/v1/master-data/product-categories')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `category-root-${runId}`)
      .send({ name: '  Fiscal   devices ', trackingMode: 'serial' })
      .expect(201);
    const root = rootResponse.body as ProductCategory;
    expect(root).toMatchObject({ name: 'Fiscal devices', trackingMode: 'serial', version: 1 });

    const childResponse = await request(application.getHttpServer())
      .post('/api/v1/master-data/product-categories')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `category-child-${runId}`)
      .send({ name: ' Cash registers ', parentId: root.id })
      .expect(201);
    const child = childResponse.body as ProductCategory;
    expect(child).toMatchObject({ name: 'Cash registers', parentId: root.id, version: 1 });

    const replay = await request(application.getHttpServer())
      .post('/api/v1/master-data/product-categories')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `category-child-${runId}`)
      .send({ name: ' Cash registers ', parentId: root.id })
      .expect(201);
    expect(replay.body).toEqual(child);

    const duplicate = await request(application.getHttpServer())
      .post('/api/v1/master-data/product-categories')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `category-duplicate-${runId}`)
      .send({ name: 'cash   registers', parentId: root.id })
      .expect(409);
    expect(duplicate.body).toMatchObject({ error: { code: 'PRODUCT_CATEGORY_DUPLICATE' } });

    const invalidExpiryPolicy = await request(application.getHttpServer())
      .post('/api/v1/master-data/product-categories')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `category-invalid-expiry-${runId}`)
      .send({ name: 'Invalid policy', requiresExpiry: true, trackingMode: 'none' })
      .expect(400);
    expect(invalidExpiryPolicy.body).toMatchObject({
      error: { code: 'PRODUCT_CATEGORY_EXPIRY_REQUIRES_BATCH' },
    });

    const categories = await request(application.getHttpServer())
      .get('/api/v1/master-data/product-categories')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .expect(200);
    expect(categories.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: root.id, name: root.name }),
        expect.objectContaining({ id: child.id, parentId: root.id }),
      ]),
    );

    const evidence = await database.query<{ audit_count: string; outbox_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM audit.events
          WHERE action = 'master_data.product_category.created'
            AND target_id IN ($1, $2)) AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events
          WHERE event_type = 'master_data.product_category.created'
            AND aggregate_id IN ($1, $2)) AS outbox_count`,
      [root.id, child.id],
    );
    expect(evidence.rows[0]).toEqual({ audit_count: '2', outbox_count: '2' });
  });

  it('creates units and products with real barcode identities, retry safety, audit, and outbox evidence', async () => {
    await request(application.getHttpServer()).get('/api/v1/master-data/catalog/units').expect(401);

    const categoryResponse = await request(application.getHttpServer())
      .post('/api/v1/master-data/product-categories')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `catalog-category-${runId}`)
      .send({ name: 'Catalog test category', trackingMode: 'serial' })
      .expect(201);
    const category = categoryResponse.body as ProductCategory;

    const unitInput = { code: ' pcs ', name: ' Pieces ' };
    const unitResponse = await request(application.getHttpServer())
      .post('/api/v1/master-data/catalog/units')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `catalog-unit-${runId}`)
      .send(unitInput)
      .expect(201);
    const unit = unitResponse.body as Unit;
    expect(unit).toMatchObject({ code: 'PCS', name: 'Pieces', version: 1 });

    const unitReplay = await request(application.getHttpServer())
      .post('/api/v1/master-data/catalog/units')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `catalog-unit-${runId}`)
      .send(unitInput)
      .expect(201);
    expect(unitReplay.body).toEqual(unit);

    const unitKeyConflict = await request(application.getHttpServer())
      .post('/api/v1/master-data/catalog/units')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `catalog-unit-${runId}`)
      .send({ ...unitInput, name: 'Different unit' })
      .expect(409);
    expect(unitKeyConflict.body).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });

    const duplicateUnit = await request(application.getHttpServer())
      .post('/api/v1/master-data/catalog/units')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `catalog-unit-duplicate-${runId}`)
      .send({ code: 'PCS', name: 'Other name' })
      .expect(409);
    expect(duplicateUnit.body).toMatchObject({ error: { code: 'UNIT_DUPLICATE' } });

    const productInput = {
      barcodes: [{ barcode: ` 123456${runId.slice(0, 6)} `, barcodeType: 'code128' as const }],
      categoryId: category.id,
      name: '  Catalog   test product ',
      productCode: ' catalog-001 ',
      unitId: unit.id,
    };
    const productResponse = await request(application.getHttpServer())
      .post('/api/v1/master-data/catalog/products')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `catalog-product-${runId}`)
      .send(productInput)
      .expect(201);
    const product = productResponse.body as ProductSummary;
    expect(product).toMatchObject({
      categoryId: category.id,
      name: 'Catalog test product',
      productCode: 'CATALOG-001',
      trackingMode: 'serial',
      unitId: unit.id,
      version: 1,
    });
    expect(product.barcodes).toEqual([
      expect.objectContaining({ barcode: `123456${runId.slice(0, 6)}`, barcodeType: 'code128' }),
    ]);
    expect(product.barcodes[0]?.id).not.toMatch(/^pending-/u);

    const productReplay = await request(application.getHttpServer())
      .post('/api/v1/master-data/catalog/products')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `catalog-product-${runId}`)
      .send(productInput)
      .expect(201);
    expect(productReplay.body).toEqual(product);

    const barcodeDuplicate = await request(application.getHttpServer())
      .post('/api/v1/master-data/catalog/products')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `catalog-barcode-duplicate-${runId}`)
      .send({ ...productInput, name: 'Another catalog product', productCode: 'CATALOG-002' })
      .expect(409);
    expect(barcodeDuplicate.body).toMatchObject({ error: { code: 'PRODUCT_BARCODE_DUPLICATE' } });

    const products = await request(application.getHttpServer())
      .get('/api/v1/master-data/catalog/products')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .expect(200);
    expect(products.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: product.id })]),
    );

    const evidence = await database.query<{ audit_count: string; outbox_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM audit.events
          WHERE action IN ('master_data.unit.created', 'master_data.product.created')
            AND target_id IN ($1, $2)) AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events
          WHERE event_type IN ('master_data.unit.created', 'master_data.product.created')
            AND aggregate_id IN ($1, $2)) AS outbox_count`,
      [unit.id, product.id],
    );
    expect(evidence.rows[0]).toEqual({ audit_count: '2', outbox_count: '2' });

    const warehouseResponse = await request(application.getHttpServer())
      .post('/api/v1/warehouse/warehouses')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `warehouse-${runId}`)
      .send({ code: ' main ', name: ' Main warehouse ', type: 'standard' })
      .expect(201);
    expect(warehouseResponse.body).toMatchObject({ code: 'MAIN', name: 'Main warehouse' });
    const warehouse = warehouseResponse.body as { id: string };
    const technicianWarehouseResponse = await request(application.getHttpServer())
      .post('/api/v1/warehouse/warehouses')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `warehouse-technician-${runId}`)
      .send({ code: ' tech-1 ', name: ' Technician 1 ', type: 'technician' })
      .expect(201);
    const technicianWarehouse = technicianWarehouseResponse.body as { id: string };
    const receiptInput = {
      productId: product.id,
      quantity: '3',
      referenceId: `opening-${runId}`,
      serialNumbers: [`device-${runId}-01`, `device-${runId}-02`, `device-${runId}-03`],
      supplierPartnerId: primaryPartner.id,
      warehouseId: warehouse.id,
    };
    const receiptResponse = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-receipts')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `receipt-${runId}`)
      .send(receiptInput)
      .expect(201);
    expect(receiptResponse.body).toMatchObject({ productId: product.id, quantity: '3.0000' });
    expect(receiptResponse.body.serialItemIds).toHaveLength(3);
    const receiptReplay = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-receipts')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `receipt-${runId}`)
      .send(receiptInput)
      .expect(201);
    expect(receiptReplay.body).toEqual(receiptResponse.body);
    const missingSerials = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-receipts')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `receipt-missing-serial-${runId}`)
      .send({ ...receiptInput, referenceId: `missing-${runId}`, serialNumbers: [] })
      .expect(400);
    expect(missingSerials.body).toMatchObject({ error: { code: 'SERIAL_TRACKING_REQUIRED' } });
    const balances = await request(application.getHttpServer())
      .get('/api/v1/warehouse/stock-balances')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .expect(200);
    expect(balances.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: product.id,
          quantity: '3.0000',
          warehouseId: warehouse.id,
        }),
      ]),
    );

    const batchCategoryResponse = await request(application.getHttpServer())
      .post('/api/v1/master-data/product-categories')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `batch-category-${runId}`)
      .send({ name: 'Expiry consumables', requiresExpiry: true, trackingMode: 'batch' })
      .expect(201);
    const batchCategory = batchCategoryResponse.body as ProductCategory;
    const batchProductResponse = await request(application.getHttpServer())
      .post('/api/v1/master-data/catalog/products')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `batch-product-${runId}`)
      .send({
        categoryId: batchCategory.id,
        name: 'Batch consumable',
        productCode: `BATCH-${runId.slice(0, 10)}`,
        unitId: unit.id,
      })
      .expect(201);
    const batchProduct = batchProductResponse.body as ProductSummary;
    const missingExpiry = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-receipts')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `batch-receipt-missing-expiry-${runId}`)
      .send({
        batchNumber: `LOT-${runId.slice(0, 8)}`,
        productId: batchProduct.id,
        quantity: '1.5',
        referenceId: `batch-missing-expiry-${runId}`,
        warehouseId: warehouse.id,
      })
      .expect(400);
    expect(missingExpiry.body).toMatchObject({ error: { code: 'EXPIRY_REQUIRED' } });
    const batchReceipt = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-receipts')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `batch-receipt-${runId}`)
      .send({
        batchNumber: `LOT-${runId.slice(0, 8)}`,
        expiresAt: '2027-12-31',
        productId: batchProduct.id,
        quantity: '1.5',
        referenceId: `batch-receipt-${runId}`,
        warehouseId: warehouse.id,
      })
      .expect(201);
    expect(batchReceipt.body).toMatchObject({
      productId: batchProduct.id,
      quantity: '1.5000',
    });
    expect(batchReceipt.body.batchId).toMatch(/^[0-9a-f-]{36}$/u);

    const transfer = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-transfers')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `transfer-${runId}`)
      .send({
        fromWarehouseId: warehouse.id,
        productId: product.id,
        quantity: '1',
        referenceId: `transfer-${runId}`,
        serialNumbers: [`device-${runId}-02`],
        toWarehouseId: technicianWarehouse.id,
      })
      .expect(201);
    expect(transfer.body).toMatchObject({
      fromWarehouseId: warehouse.id,
      productId: product.id,
      quantity: '1.0000',
      toWarehouseId: technicianWarehouse.id,
    });
    expect(transfer.body.serialItemIds).toHaveLength(1);

    const serialIssue = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-issues')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `serial-issue-${runId}`)
      .send({
        productId: product.id,
        quantity: '1',
        reason: 'sale',
        referenceId: `serial-sale-${runId}`,
        serialNumbers: [`device-${runId}-01`],
        warehouseId: warehouse.id,
      })
      .expect(201);
    expect(serialIssue.body).toMatchObject({
      productId: product.id,
      quantity: '1.0000',
      reason: 'sale',
    });
    expect(serialIssue.body.serialItemIds).toHaveLength(1);
    const duplicateSerialIssue = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-issues')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `serial-issue-duplicate-${runId}`)
      .send({
        productId: product.id,
        quantity: '1',
        reason: 'sale',
        referenceId: `serial-sale-duplicate-${runId}`,
        serialNumbers: [`device-${runId}-01`],
        warehouseId: warehouse.id,
      })
      .expect(409);
    expect(duplicateSerialIssue.body).toMatchObject({ error: { code: 'SERIAL_NOT_AVAILABLE' } });
    const oversell = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-issues')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `serial-issue-oversell-${runId}`)
      .send({
        productId: product.id,
        quantity: '2',
        reason: 'sale',
        referenceId: `serial-sale-oversell-${runId}`,
        serialNumbers: [`device-${runId}-02`, `device-${runId}-03`],
        warehouseId: warehouse.id,
      })
      .expect(409);
    expect(oversell.body).toMatchObject({ error: { code: 'INSUFFICIENT_STOCK' } });

    const untrackedCategoryResponse = await request(application.getHttpServer())
      .post('/api/v1/master-data/product-categories')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `untracked-category-${runId}`)
      .send({ name: 'Stocktake supplies', trackingMode: 'none' })
      .expect(201);
    const untrackedCategory = untrackedCategoryResponse.body as ProductCategory;
    const untrackedProductResponse = await request(application.getHttpServer())
      .post('/api/v1/master-data/catalog/products')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `untracked-product-${runId}`)
      .send({
        categoryId: untrackedCategory.id,
        name: 'Untracked stocktake supply',
        productCode: `COUNT-${runId.slice(0, 10)}`,
        unitId: unit.id,
      })
      .expect(201);
    const untrackedProduct = untrackedProductResponse.body as ProductSummary;
    await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-receipts')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `untracked-receipt-${runId}`)
      .send({
        productId: untrackedProduct.id,
        quantity: '5',
        referenceId: `untracked-opening-${runId}`,
        warehouseId: warehouse.id,
      })
      .expect(201);

    const stocktakeResponse = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stocktakes')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `stocktake-open-${runId}`)
      .send({ referenceId: `annual-count-${runId}`, warehouseId: warehouse.id })
      .expect(201);
    const stocktake = stocktakeResponse.body as { id: string };
    const duplicateStocktake = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stocktakes')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `stocktake-open-duplicate-${runId}`)
      .send({ referenceId: `duplicate-count-${runId}`, warehouseId: warehouse.id })
      .expect(409);
    expect(duplicateStocktake.body).toMatchObject({
      error: { code: 'STOCKTAKE_ALREADY_OPEN' },
    });
    const movementDuringCount = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-receipts')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `stocktake-frozen-receipt-${runId}`)
      .send({
        productId: untrackedProduct.id,
        quantity: '1',
        referenceId: `stocktake-frozen-${runId}`,
        warehouseId: warehouse.id,
      })
      .expect(409);
    expect(movementDuringCount.body).toMatchObject({
      error: { code: 'WAREHOUSE_STOCKTAKE_OPEN' },
    });

    await request(application.getHttpServer())
      .post(`/api/v1/warehouse/stocktakes/${stocktake.id}/counts`)
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `stocktake-count-serial-${runId}`)
      .send({ countedQuantity: '0', productId: product.id, serialNumbers: [] })
      .expect(201);
    await request(application.getHttpServer())
      .post(`/api/v1/warehouse/stocktakes/${stocktake.id}/counts`)
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `stocktake-count-batch-${runId}`)
      .send({
        batches: [
          {
            batchNumber: `LOT-${runId.slice(0, 8)}`,
            countedQuantity: '1',
            expiresAt: '2027-12-31',
          },
        ],
        countedQuantity: '1',
        productId: batchProduct.id,
      })
      .expect(201);
    await request(application.getHttpServer())
      .post(`/api/v1/warehouse/stocktakes/${stocktake.id}/counts`)
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `stocktake-count-untracked-${runId}`)
      .send({ countedQuantity: '4', productId: untrackedProduct.id })
      .expect(201);

    const completedStocktake = await request(application.getHttpServer())
      .post(`/api/v1/warehouse/stocktakes/${stocktake.id}/complete`)
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `stocktake-complete-${runId}`)
      .expect(201);
    expect(completedStocktake.body).toMatchObject({ id: stocktake.id, status: 'completed' });
    const completedReplay = await request(application.getHttpServer())
      .post(`/api/v1/warehouse/stocktakes/${stocktake.id}/complete`)
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `stocktake-complete-${runId}`)
      .expect(201);
    expect(completedReplay.body).toEqual(completedStocktake.body);

    const adjusted = await database.query<{
      batch_quantity: string;
      serial_status: string;
      untracked_quantity: string;
    }>(
      `SELECT
         (SELECT quantity::text FROM inventory.batch_stock_balances WHERE warehouse_id = $1 AND batch_id = $2) AS batch_quantity,
         (SELECT status FROM inventory.serialized_items WHERE product_id = $3 AND serial_number = $4) AS serial_status,
         (SELECT quantity::text FROM inventory.stock_balances WHERE warehouse_id = $1 AND product_id = $5) AS untracked_quantity`,
      [
        warehouse.id,
        batchReceipt.body.batchId,
        product.id,
        `DEVICE-${runId.toUpperCase()}-03`,
        untrackedProduct.id,
      ],
    );
    expect(adjusted.rows[0]).toEqual({
      batch_quantity: '1.0000',
      serial_status: 'missing',
      untracked_quantity: '4.0000',
    });
    const stocktakeEvidence = await database.query<{ audit_count: string; movement_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM audit.events WHERE target_id = $1::uuid) AS audit_count,
         (SELECT count(*)::text FROM inventory.stock_movements WHERE reference_type = 'stocktake' AND reference_id = $2::varchar) AS movement_count`,
      [stocktake.id, stocktake.id],
    );
    expect(stocktakeEvidence.rows[0]).toEqual({ audit_count: '5', movement_count: '3' });

    const reservationInput = {
      productId: untrackedProduct.id,
      quantity: '3',
      referenceId: `order-${runId}`,
      referenceType: 'sales_order',
      warehouseId: warehouse.id,
    };
    const reservationResponse = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-reservations')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `reservation-${runId}`)
      .send(reservationInput)
      .expect(201);
    const stockReservation = reservationResponse.body as StockReservation;
    expect(reservationResponse.body).toMatchObject({
      initialQuantity: '3.0000',
      remainingQuantity: '3.0000',
      status: 'active',
    });
    const reservationReplay = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-reservations')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `reservation-${runId}`)
      .send(reservationInput)
      .expect(201);
    expect(reservationReplay.body).toEqual(reservationResponse.body);
    const reservedIssueBlocked = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-issues')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `reservation-blocked-issue-${runId}`)
      .send({
        productId: untrackedProduct.id,
        quantity: '2',
        reason: 'sale',
        referenceId: `unreserved-sale-${runId}`,
        warehouseId: warehouse.id,
      })
      .expect(409);
    expect(reservedIssueBlocked.body).toMatchObject({
      error: { code: 'INSUFFICIENT_AVAILABLE_STOCK' },
    });
    const reservedIssue = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-issues')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `reservation-consume-${runId}`)
      .send({
        productId: untrackedProduct.id,
        quantity: '2',
        reason: 'sale',
        referenceId: `reserved-sale-${runId}`,
        reservationId: stockReservation.id,
        warehouseId: warehouse.id,
      })
      .expect(201);
    expect(reservedIssue.body).toMatchObject({ reservationId: stockReservation.id });
    const partialReservation = await database.query<{ remaining_quantity: string; status: string }>(
      `SELECT remaining_quantity::text, status FROM inventory.stock_reservations WHERE id = $1`,
      [stockReservation.id],
    );
    expect(partialReservation.rows[0]).toEqual({
      remaining_quantity: '1.0000',
      status: 'active',
    });
    const releasedReservation = await request(application.getHttpServer())
      .post(`/api/v1/warehouse/stock-reservations/${stockReservation.id}/release`)
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `reservation-release-${runId}`)
      .expect(200);
    expect(releasedReservation.body).toMatchObject({
      remainingQuantity: '1.0000',
      status: 'released',
    });

    const serialReservation = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-reservations')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `serial-reservation-${runId}`)
      .send({
        productId: product.id,
        quantity: '1',
        referenceId: `service-${runId}`,
        referenceType: 'service_request',
        serialNumbers: [`device-${runId}-02`],
        warehouseId: technicianWarehouse.id,
      })
      .expect(201);
    expect(serialReservation.body.serialItemIds).toHaveLength(1);
    const reservedTransfer = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-transfers')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `reserved-transfer-${runId}`)
      .send({
        fromWarehouseId: technicianWarehouse.id,
        productId: product.id,
        quantity: '1',
        referenceId: `reserved-transfer-${runId}`,
        serialNumbers: [`device-${runId}-02`],
        toWarehouseId: warehouse.id,
      })
      .expect(409);
    expect(reservedTransfer.body).toMatchObject({
      error: { code: 'INSUFFICIENT_AVAILABLE_STOCK' },
    });
    await request(application.getHttpServer())
      .post(`/api/v1/warehouse/stock-reservations/${serialReservation.body.id}/release`)
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `serial-reservation-release-${runId}`)
      .expect(200);
    const repairIssueResponse = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-issues')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `serial-repair-issue-${runId}`)
      .send({
        customerPartnerId: primaryPartner.id,
        productId: product.id,
        quantity: '1',
        reason: 'repair',
        referenceId: `repair-${runId}`,
        serialNumbers: [`device-${runId}-02`],
        technicianAccountId: categoryCreatorAccountId,
        warehouseId: technicianWarehouse.id,
      })
      .expect(201);
    const repairIssue = repairIssueResponse.body as StockIssue;
    const serialTrace = await request(application.getHttpServer())
      .get(`/api/v1/warehouse/serial-traceability/device-${runId}-02`)
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .expect(200);
    expect(serialTrace.body).toMatchObject({
      currentWarehouse: { id: technicianWarehouse.id },
      product: { id: product.id },
      serialNumber: `DEVICE-${runId.toUpperCase()}-02`,
      status: 'issued',
    });
    expect(serialTrace.body.events).toEqual([
      expect.objectContaining({
        eventType: 'receipt',
        supplier: { displayName: primaryPartner.displayName, id: primaryPartner.id },
      }),
      expect.objectContaining({
        eventType: 'transfer',
        fromWarehouse: { id: warehouse.id, displayName: 'Main warehouse' },
        toWarehouse: { id: technicianWarehouse.id, displayName: 'Technician 1' },
      }),
      expect.objectContaining({
        customer: { displayName: primaryPartner.displayName, id: primaryPartner.id },
        eventType: 'issue',
        technician: {
          displayName: 'Partner category-creator',
          id: categoryCreatorAccountId,
        },
      }),
    ]);
    const returnInput = {
      destinationWarehouseId: technicianWarehouse.id,
      disposition: 'restock',
      originalIssueId: repairIssue.id,
      quantity: '1',
      referenceId: `return-${runId}`,
      serialNumbers: [`device-${runId}-02`],
    };
    const stockReturn = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-returns')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `stock-return-${runId}`)
      .send(returnInput)
      .expect(201);
    expect(stockReturn.body).toMatchObject({
      destinationWarehouseId: technicianWarehouse.id,
      disposition: 'restock',
      originalIssueId: repairIssue.id,
      productId: product.id,
      quantity: '1.0000',
    });
    const postedReturn = stockReturn.body as StockReturn;
    expect(postedReturn.serialItemIds).toHaveLength(1);
    const returnReplay = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-returns')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `stock-return-${runId}`)
      .send(returnInput)
      .expect(201);
    expect(returnReplay.body).toEqual(stockReturn.body);
    const excessiveReturn = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-returns')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `stock-return-excess-${runId}`)
      .send({ ...returnInput, referenceId: `return-excess-${runId}` })
      .expect(409);
    expect(excessiveReturn.body).toMatchObject({
      error: { code: 'RETURN_QUANTITY_EXCEEDS_ISSUE' },
    });
    const returnedTrace = await request(application.getHttpServer())
      .get(`/api/v1/warehouse/serial-traceability/device-${runId}-02`)
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .expect(200);
    expect(returnedTrace.body).toMatchObject({
      currentWarehouse: { id: technicianWarehouse.id },
      status: 'available',
    });
    const returnedSerialTrace = returnedTrace.body as SerialTraceability;
    expect(returnedSerialTrace.events.at(-1)).toMatchObject({
      eventType: 'return_received',
      movementId: postedReturn.id,
      referenceId: `return-${runId}`,
    });
    const unknownSerialTrace = await request(application.getHttpServer())
      .get(`/api/v1/warehouse/serial-traceability/unknown-${runId}`)
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .expect(404);
    expect(unknownSerialTrace.body).toMatchObject({ error: { code: 'SERIAL_NOT_FOUND' } });

    const valuedReceipt = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-receipts')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `valued-receipt-${runId}`)
      .send({
        productId: untrackedProduct.id,
        quantity: '2',
        referenceId: `valued-receipt-${runId}`,
        unitCostBgn: '10',
        warehouseId: warehouse.id,
      })
      .expect(201);
    expect(valuedReceipt.body).toMatchObject({
      totalCostBgn: '20.0000',
      unitCostBgn: '10.0000',
    });
    const valuedIssue = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-issues')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `valued-issue-${runId}`)
      .send({
        productId: untrackedProduct.id,
        quantity: '1',
        reason: 'repair',
        referenceId: `valued-issue-${runId}`,
        warehouseId: warehouse.id,
      })
      .expect(201);
    expect(valuedIssue.body).toMatchObject({
      totalCostBgn: '5.0000',
      unitCostBgn: '5.0000',
    });
    const stockSettings = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-settings')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `stock-settings-${runId}`)
      .send({
        alertRecipientAccountIds: [categoryCreatorAccountId],
        minimumQuantity: '3',
        productId: untrackedProduct.id,
        targetQuantity: '7',
        warehouseId: warehouse.id,
      })
      .expect(200);
    expect(stockSettings.body).toMatchObject({
      alertRecipientAccountIds: [categoryCreatorAccountId],
      minimumQuantity: '3.0000',
      targetQuantity: '7.0000',
      version: 1,
    });
    const replenishment = await request(application.getHttpServer())
      .get('/api/v1/warehouse/replenishment')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .expect(200);
    expect(replenishment.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          availableQuantity: '3.0000',
          lowStock: true,
          physicalQuantity: '3.0000',
          productId: untrackedProduct.id,
          recommendedQuantity: '4.0000',
          reservedQuantity: '0.0000',
        }),
      ]),
    );
    await deliverIntegrationEvents(application, database);
    const firstLowStockAlert = await database.query<{
      attempt_count: number;
      cycle_number: string;
      id: string;
      status: string;
    }>(
      `SELECT message.id, message.attempt_count, message.payload->>'cycleNumber' AS cycle_number,
         message.status
       FROM notifications.messages message
       WHERE message.template_key = 'inventory.low_stock'
         AND message.recipient_account_id = $1
         AND message.payload->>'warehouseId' = $2
         AND message.payload->>'productId' = $3`,
      [categoryCreatorAccountId, warehouse.id, untrackedProduct.id],
    );
    expect(firstLowStockAlert.rows).toHaveLength(1);
    expect(firstLowStockAlert.rows[0]).toMatchObject({
      attempt_count: 0,
      cycle_number: '1',
      status: 'pending',
    });
    const dispatcher = application.get(NotificationDispatcherService);
    const firstAlertId = firstLowStockAlert.rows[0]?.id;
    if (!firstAlertId) throw new Error('Expected a low-stock notification');
    await dispatcher.dispatch(firstAlertId);
    await request(application.getHttpServer())
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .expect(200);
    await request(application.getHttpServer())
      .post(`/api/v1/notifications/${firstAlertId}/read`)
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .expect(200);
    await request(application.getHttpServer())
      .post(`/api/v1/notifications/${firstAlertId}/read`)
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .expect(200);
    const deliveryEvidence = await database.query<{
      attempt_count: number;
      read_at: Date | null;
      status: string;
    }>('SELECT attempt_count, status, read_at FROM notifications.messages WHERE id = $1', [
      firstAlertId,
    ]);
    expect(deliveryEvidence.rows[0]).toMatchObject({ attempt_count: 1, status: 'delivered' });
    expect(deliveryEvidence.rows[0]?.read_at).toBeInstanceOf(Date);
    await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-receipts')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `low-stock-recovery-${runId}`)
      .send({
        productId: untrackedProduct.id,
        quantity: '1',
        referenceId: `low-stock-recovery-${runId}`,
        unitCostBgn: '5',
        warehouseId: warehouse.id,
      })
      .expect(201);
    await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-issues')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `low-stock-relapse-${runId}`)
      .send({
        productId: untrackedProduct.id,
        quantity: '1',
        reason: 'repair',
        referenceId: `low-stock-relapse-${runId}`,
        warehouseId: warehouse.id,
      })
      .expect(201);
    await deliverIntegrationEvents(application, database);
    const alertCycles = await database.query<{ cycle_number: string }>(
      `SELECT message.payload->>'cycleNumber' AS cycle_number
       FROM notifications.messages message
       WHERE message.template_key = 'inventory.low_stock'
         AND message.recipient_account_id = $1
         AND message.payload->>'warehouseId' = $2
         AND message.payload->>'productId' = $3
       ORDER BY (message.payload->>'cycleNumber')::bigint`,
      [categoryCreatorAccountId, warehouse.id, untrackedProduct.id],
    );
    expect(alertCycles.rows).toEqual([{ cycle_number: '1' }, { cycle_number: '2' }]);
    const valuedBalances = await request(application.getHttpServer())
      .get('/api/v1/warehouse/stock-balances')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .expect(200);
    expect(valuedBalances.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          averageUnitCostBgn: '5.0000',
          inventoryValueBgn: '15.0000',
          productId: untrackedProduct.id,
          quantity: '3.0000',
        }),
      ]),
    );
  });
});

async function deliverIntegrationEvents(
  application: INestApplication,
  database: Pool,
): Promise<void> {
  await application.get(OutboxPublisherService).publishAvailable();
  const events = await database.query<{ id: string }>(
    `SELECT id FROM integration.outbox_events
     WHERE event_type = $1 AND status = 'published' ORDER BY occurred_at, id`,
    [lowStockEventType],
  );
  const dispatcher = application.get(IntegrationEventDispatcherService);
  for (const event of events.rows) await dispatcher.dispatch(event.id, true);
}

async function createPartner(
  application: INestApplication,
  token: string,
  idempotencyKey: string,
  input: CreatePartnerRequest,
): Promise<PartnerSummary> {
  const response = await request(application.getHttpServer())
    .post('/api/v1/master-data/partners')
    .set('authorization', `Bearer ${token}`)
    .set('idempotency-key', idempotencyKey)
    .send(input)
    .expect(201);
  return response.body as PartnerSummary;
}

async function login(application: INestApplication, email: string): Promise<string> {
  const response = await request(application.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.sessionToken as string;
}

async function createAccount(
  pool: Pool,
  label: string,
  email: string,
  passwordHash: string,
): Promise<string> {
  const employeeId = randomUUID();
  const accountId = randomUUID();
  await pool.query(
    `INSERT INTO identity.employees (id, employee_number, display_name, email)
     VALUES ($1, $2, $3, $4)`,
    [employeeId, `${label}-${randomUUID()}`, `Partner ${label}`, email],
  );
  await pool.query(
    `INSERT INTO identity.user_accounts (id, employee_id, password_hash)
     VALUES ($1, $2, $3)`,
    [accountId, employeeId, passwordHash],
  );
  return accountId;
}

async function grantPermissions(
  pool: Pool,
  accountId: string,
  module: 'crm' | 'erp.warehouse' | 'platform' | 'platform.organization',
  actions: Array<'approve' | 'create' | 'delete' | 'edit' | 'view'>,
): Promise<void> {
  const roleId = randomUUID();
  await pool.query(
    `INSERT INTO iam.roles (id, code, name)
     VALUES ($1, $2, 'Partner integration test role')`,
    [roleId, `test-partner-${randomUUID()}`],
  );
  for (const action of actions) {
    const permission = await pool.query<{ id: string }>(
      `INSERT INTO iam.permissions (id, module, action)
       VALUES ($1, $2, $3)
       ON CONFLICT (module, action) DO UPDATE SET module = EXCLUDED.module
       RETURNING id`,
      [randomUUID(), module, action],
    );
    await pool.query('INSERT INTO iam.role_permissions (role_id, permission_id) VALUES ($1, $2)', [
      roleId,
      permission.rows[0]?.id,
    ]);
  }
  await pool.query('INSERT INTO iam.account_roles (account_id, role_id) VALUES ($1, $2)', [
    accountId,
    roleId,
  ]);
}

function assertTemporaryDatabaseName(value: string): void {
  if (!/^vista_partner_test_[a-f0-9]{32}$/u.test(value)) {
    throw new Error('Refusing to operate on an unexpected partner test database');
  }
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
