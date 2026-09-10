import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AppEnvironment } from '@vista/config';
import type { CrmInteraction, CrmTask, CrmTimelinePage } from '@vista/contracts';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PasswordService } from '../src/auth/password.service.js';
import { configureHttpApplication } from '../src/common/http-application.js';
import { APP_ENVIRONMENT } from '../src/config/config.module.js';
import { migrateDown, migrateUp } from '../src/database/migration-runner.js';
import { ObjectStorageService } from '../src/storage/object-storage.service.js';

const runInfrastructureTests = process.env['RUN_INFRASTRUCTURE_TESTS'] === 'true';
const password = 'Vista-Crm-Timeline-Test-7!';

describe.skipIf(!runInfrastructureTests)('CRM customer timeline', () => {
  let adminDatabase: Pool;
  let application: INestApplication;
  let database: Pool;
  let databaseName: string;
  let editorToken: string;
  let viewerToken: string;
  let editorAccountId: string;
  let customerId: string;
  let locationId: string;
  let contactId: string;
  let interaction: CrmInteraction;
  let storage: ObjectStorageService;
  let task: CrmTask;
  const runId = randomUUID().replaceAll('-', '');
  const interactionPdf = Buffer.from(`%PDF-1.4\nVista CRM interaction ${runId}\n`);

  beforeAll(async () => {
    const sourceDatabaseUrl = process.env['DATABASE_URL'];
    const sourceRedisUrl = process.env['REDIS_URL'];
    const sourceS3AccessKey = process.env['S3_ACCESS_KEY_ID'];
    const sourceS3Bucket = process.env['S3_BUCKET'];
    const sourceS3Endpoint = process.env['S3_ENDPOINT'];
    const sourceS3Region = process.env['S3_REGION'];
    const sourceS3Secret = process.env['S3_SECRET_ACCESS_KEY'];
    if (
      !sourceDatabaseUrl ||
      !sourceRedisUrl ||
      !sourceS3AccessKey ||
      !sourceS3Bucket ||
      !sourceS3Endpoint ||
      !sourceS3Region ||
      !sourceS3Secret
    ) {
      throw new Error('Database, Redis, and S3 settings are required for CRM timeline tests');
    }
    adminDatabase = new Pool({ connectionString: sourceDatabaseUrl, max: 1 });
    databaseName = `vista_crm_timeline_test_${runId}`;
    assertTemporaryDatabaseName(databaseName);
    await adminDatabase.query(`CREATE DATABASE ${databaseName}`);
    const isolatedDatabaseUrl = new URL(sourceDatabaseUrl);
    isolatedDatabaseUrl.pathname = `/${databaseName}`;
    const isolatedRedisUrl = new URL(sourceRedisUrl);
    isolatedRedisUrl.pathname = '/14';
    database = new Pool({ connectionString: isolatedDatabaseUrl.toString(), max: 2 });
    const migrationDirectory = fileURLToPath(
      new URL('../src/database/migrations', import.meta.url),
    );
    const applied = await migrateUp(database, migrationDirectory);
    if (!applied.includes('0047_crm_customer_timeline')) {
      throw new Error('The CRM timeline migration was not applied');
    }
    // Newer migrations depend on the timeline schema. Roll them back in order
    // in this fresh, disposable database before testing the timeline rollback.
    const rollbackOrder = applied.slice(applied.indexOf('0047_crm_customer_timeline')).reverse();
    for (const expected of rollbackOrder) {
      expect(await migrateDown(database, migrationDirectory)).toBe(expected);
    }
    const reapplied = await migrateUp(database, migrationDirectory);
    expect(reapplied).toEqual([...rollbackOrder].reverse());

    Object.assign(process.env, {
      BUSINESS_TIMEZONE: 'Europe/Sofia',
      CORS_ORIGINS: 'http://localhost:5173',
      DATABASE_URL: isolatedDatabaseUrl.toString(),
      FILE_ALLOWED_MEDIA_TYPES: 'application/pdf,image/jpeg,image/png,image/webp',
      FILE_UPLOAD_MAX_BYTES: String(10 * 1024 * 1024),
      NODE_ENV: 'test',
      REDIS_URL: isolatedRedisUrl.toString(),
      REQUEST_LOGGING_ENABLED: 'false',
      S3_ACCESS_KEY_ID: sourceS3AccessKey,
      S3_BUCKET: sourceS3Bucket,
      S3_ENDPOINT: sourceS3Endpoint,
      S3_FORCE_PATH_STYLE: 'true',
      S3_REGION: sourceS3Region,
      S3_SECRET_ACCESS_KEY: sourceS3Secret,
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
    storage = application.get(ObjectStorageService);

    const passwordHash = await application.get(PasswordService).hash(password);
    const editor = await createAccount(database, 'editor', passwordHash, runId);
    const viewer = await createAccount(database, 'viewer', passwordHash, runId);
    editorAccountId = editor.accountId;
    await grantCrmPermissions(database, editor.accountId, ['view', 'create', 'edit']);
    await grantCrmPermissions(database, viewer.accountId, ['view']);
    customerId = randomUUID();
    locationId = randomUUID();
    contactId = randomUUID();
    await database.query(
      `INSERT INTO master_data.partners (
         id, kind, display_name, uic, created_by, updated_by
       ) VALUES ($1,'legal_entity',$2,$3,$4,$4)`,
      [customerId, `CRM Timeline Customer ${runId}`, `CRM-${runId.slice(0, 12)}`, editorAccountId],
    );
    await database.query(
      `INSERT INTO master_data.partner_roles (partner_id, role, assigned_by)
       VALUES ($1,'customer',$2)`,
      [customerId, editorAccountId],
    );
    await database.query(
      `INSERT INTO master_data.partner_contacts (
         id, partner_id, display_name, telephone
       ) VALUES ($1,$2,'Elena Petrova','+359 888 123 456')`,
      [contactId, customerId],
    );
    await database.query(
      `INSERT INTO master_data.customer_locations (
         id, partner_id, name, location_type, address_line_1, city, created_by, updated_by
       ) VALUES ($1,$2,'Main shop','retail outlet','1 Test Street','Vratsa',$3,$3)`,
      [locationId, customerId, editorAccountId],
    );
    editorToken = await login(application, editor.email);
    viewerToken = await login(application, viewer.email);
  }, 30_000);

  afterAll(async () => {
    if (database && storage) {
      const keys = await database.query<{ storage_key: string }>(
        'SELECT storage_key FROM files.objects',
      );
      for (const row of keys.rows) await storage.deleteObject(row.storage_key);
    }
    if (application) {
      for (const token of [editorToken, viewerToken]) {
        if (token)
          await request(application.getHttpServer())
            .post('/api/v1/auth/logout')
            .set('authorization', `Bearer ${token}`);
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

  it('protects reads and commands and returns customer-scoped reference data', async () => {
    await request(application.getHttpServer())
      .get('/api/v1/crm/timeline/reference-data')
      .expect(401);
    await request(application.getHttpServer())
      .post('/api/v1/crm/interactions')
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `denied-${runId}`)
      .send({
        customerPartnerId: customerId,
        interactionType: 'email',
        notes: 'Viewer must not create this.',
        occurredAt: new Date().toISOString(),
        subject: 'Denied interaction',
      })
      .expect(403);

    const references = await request(application.getHttpServer())
      .get('/api/v1/crm/timeline/reference-data')
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(references.body).toMatchObject({
      businessTimezone: 'Europe/Sofia',
      contacts: [expect.objectContaining({ id: contactId, customerPartnerId: customerId })],
      customers: [expect.objectContaining({ id: customerId })],
      locations: [expect.objectContaining({ id: locationId, customerPartnerId: customerId })],
    });
  });

  it('records one retry-safe interaction and authorizes its attachment parent', async () => {
    const key = `interaction-${runId}`;
    const payload = {
      contactPersonId: contactId,
      customerLocationId: locationId,
      customerPartnerId: customerId,
      interactionType: 'incoming_call',
      notes: 'The customer requested a quotation for an additional device.',
      occurredAt: new Date(Date.now() - 60_000).toISOString(),
      subject: 'Additional device quotation',
    };
    const created = await request(application.getHttpServer())
      .post('/api/v1/crm/interactions')
      .set('authorization', `Bearer ${editorToken}`)
      .set('idempotency-key', key)
      .send(payload)
      .expect(201);
    interaction = created.body as CrmInteraction;
    expect(interaction).toMatchObject({
      contactPersonId: contactId,
      customerLocationId: locationId,
      customerPartnerId: customerId,
      interactionType: 'incoming_call',
      subject: payload.subject,
    });
    const replay = await request(application.getHttpServer())
      .post('/api/v1/crm/interactions')
      .set('authorization', `Bearer ${editorToken}`)
      .set('idempotency-key', key)
      .send(payload)
      .expect(201);
    expect(replay.body).toMatchObject({ id: interaction.id });

    await request(application.getHttpServer())
      .post('/api/v1/files')
      .set('authorization', `Bearer ${editorToken}`)
      .set('idempotency-key', `interaction-file-${runId}`)
      .field('parentType', 'crm_interaction')
      .field('parentId', interaction.id)
      .attach('file', interactionPdf, {
        contentType: 'application/pdf',
        filename: 'customer-request.pdf',
      })
      .expect(201)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          originalName: 'customer-request.pdf',
          parentId: interaction.id,
          parentType: 'crm_interaction',
          status: 'available',
        }),
      );

    await request(application.getHttpServer())
      .get(`/api/v1/files?parentType=crm_interaction&parentId=${interaction.id}`)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          items: [expect.objectContaining({ originalName: 'customer-request.pdf' })],
          total: 1,
        }),
      );
    const rows = await database.query<{ total: string }>(
      'SELECT count(*)::text AS total FROM crm.interactions WHERE id = $1',
      [interaction.id],
    );
    expect(rows.rows[0]?.total).toBe('1');
  });

  it('creates a reminder-backed task once and closes it with immutable history', async () => {
    const dueAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    const reminderAt = new Date(Date.now() + 60 * 60_000).toISOString();
    const key = `task-${runId}`;
    const payload = {
      assignedToAccountId: editorAccountId,
      customerLocationId: locationId,
      customerPartnerId: customerId,
      dueAt,
      notes: 'Include current stock availability and delivery terms.',
      priority: 'high',
      reminderAt,
      title: 'Send the requested quotation',
    };
    const created = await request(application.getHttpServer())
      .post('/api/v1/crm/tasks')
      .set('authorization', `Bearer ${editorToken}`)
      .set('idempotency-key', key)
      .send(payload)
      .expect(201);
    task = created.body as CrmTask;
    expect(task).toMatchObject({
      assignedTo: { id: editorAccountId },
      priority: 'high',
      reminderAt,
      status: 'open',
      version: 1,
    });
    await request(application.getHttpServer())
      .post('/api/v1/crm/tasks')
      .set('authorization', `Bearer ${editorToken}`)
      .set('idempotency-key', key)
      .send(payload)
      .expect(201)
      .expect(({ body }) => expect(body).toMatchObject({ id: task.id }));
    const reminder = await database.query<{ status: string; total: string }>(
      `SELECT count(*)::text AS total, max(message.status) AS status
       FROM crm.task_reminders reminder
       JOIN notifications.messages message ON message.id = reminder.notification_id
       WHERE reminder.task_id = $1`,
      [task.id],
    );
    expect(reminder.rows[0]).toEqual({ status: 'pending', total: '1' });

    const completed = await request(application.getHttpServer())
      .post(`/api/v1/crm/tasks/${task.id}/transition`)
      .set('authorization', `Bearer ${editorToken}`)
      .set('idempotency-key', `complete-${runId}`)
      .send({ expectedVersion: 1, note: 'Quotation sent by email.', status: 'completed' })
      .expect(200);
    task = completed.body as CrmTask;
    expect(task).toMatchObject({ reminderAt, status: 'completed', version: 2 });
    expect(task.history.map((entry) => entry.type)).toEqual(['created', 'completed']);
    const cancelledReminder = await database.query<{ status: string }>(
      `SELECT message.status FROM crm.task_reminders reminder
       JOIN notifications.messages message ON message.id = reminder.notification_id
       WHERE reminder.task_id = $1`,
      [task.id],
    );
    expect(cancelledReminder.rows[0]?.status).toBe('cancelled');
  });

  it('returns one chronological customer history with auditable side effects', async () => {
    const response = await request(application.getHttpServer())
      .get(`/api/v1/crm/timeline?customerPartnerId=${customerId}&customerLocationId=${locationId}`)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    const page = response.body as CrmTimelinePage;
    expect(page.summary).toEqual({ interactions: 1, openTasks: 0, overdueTasks: 0 });
    expect(page.items).toHaveLength(3);
    expect(page.items.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['interaction', 'task_event', 'task_event']),
    );
    const sideEffects = await database.query<{ audit_total: string; outbox_total: string }>(
      `SELECT
         (SELECT count(*)::text FROM audit.events
          WHERE target_type IN ('crm_interaction','crm_task')) AS audit_total,
         (SELECT count(*)::text FROM integration.outbox_events
          WHERE aggregate_type IN ('crm_interaction','crm_task')) AS outbox_total`,
    );
    expect(sideEffects.rows[0]).toEqual({ audit_total: '3', outbox_total: '3' });
  });
});

async function createAccount(
  pool: Pool,
  label: string,
  passwordHash: string,
  runId: string,
): Promise<{ accountId: string; email: string }> {
  const employeeId = randomUUID();
  const accountId = randomUUID();
  const email = `crm-timeline-${label}-${runId}@example.invalid`;
  await pool.query(
    `INSERT INTO identity.employees (id, employee_number, display_name, email)
     VALUES ($1,$2,$3,$4)`,
    [employeeId, `crm-timeline-${label}-${runId}`, `CRM Timeline ${label}`, email],
  );
  await pool.query(
    `INSERT INTO identity.user_accounts (id, employee_id, password_hash) VALUES ($1,$2,$3)`,
    [accountId, employeeId, passwordHash],
  );
  return { accountId, email };
}

async function grantCrmPermissions(
  pool: Pool,
  accountId: string,
  actions: Array<'create' | 'edit' | 'view'>,
) {
  const roleId = randomUUID();
  await pool.query(
    `INSERT INTO iam.roles (id, code, name) VALUES ($1,$2,'CRM timeline test role')`,
    [roleId, `test-crm-timeline-${randomUUID()}`],
  );
  for (const action of actions) {
    const permission = await pool.query<{ id: string }>(
      `INSERT INTO iam.permissions (id, module, action) VALUES ($1,'crm',$2)
       ON CONFLICT (module, action) DO UPDATE SET module = EXCLUDED.module RETURNING id`,
      [randomUUID(), action],
    );
    await pool.query('INSERT INTO iam.role_permissions (role_id, permission_id) VALUES ($1,$2)', [
      roleId,
      permission.rows[0]?.id,
    ]);
  }
  await pool.query('INSERT INTO iam.account_roles (account_id, role_id) VALUES ($1,$2)', [
    accountId,
    roleId,
  ]);
}

async function login(application: INestApplication, email: string): Promise<string> {
  const response = await request(application.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.sessionToken as string;
}

function assertTemporaryDatabaseName(value: string) {
  if (!/^vista_crm_timeline_test_[a-f0-9]{32}$/u.test(value)) {
    throw new Error('Refusing to operate on an unexpected CRM timeline test database');
  }
}
