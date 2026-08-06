import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AppEnvironment } from '@vista/config';
import type { CreatePartnerRequest, PartnerSummary } from '@vista/contracts';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PasswordService } from '../src/auth/password.service.js';
import { configureHttpApplication } from '../src/common/http-application.js';
import { APP_ENVIRONMENT } from '../src/config/config.module.js';
import { migrateUp } from '../src/database/migration-runner.js';

const runInfrastructureTests = process.env['RUN_INFRASTRUCTURE_TESTS'] === 'true';
const password = 'Vista-Partner-Test-7!';

describe.skipIf(!runInfrastructureTests)('partner master-data vertical slice', () => {
  let adminDatabase: Pool;
  let application: INestApplication;
  let creatorToken: string;
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
    await migrateUp(
      database,
      fileURLToPath(new URL('../src/database/migrations', import.meta.url)),
    );
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
    const viewerEmail = `partner-viewer-${runId}@example.invalid`;
    const creatorId = await createAccount(database, 'creator', creatorEmail, passwordHash);
    const viewerId = await createAccount(database, 'viewer', viewerEmail, passwordHash);
    await grantCrmPermissions(database, creatorId, ['view', 'create']);
    await grantCrmPermissions(database, viewerId, ['view']);
    creatorToken = await login(application, creatorEmail);
    viewerToken = await login(application, viewerEmail);
  }, 30_000);

  afterAll(async () => {
    if (application) {
      for (const token of [creatorToken, viewerToken]) {
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
      await adminDatabase.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
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
});

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

async function grantCrmPermissions(
  pool: Pool,
  accountId: string,
  actions: Array<'create' | 'view'>,
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
       VALUES ($1, 'crm', $2)
       ON CONFLICT (module, action) DO UPDATE SET module = EXCLUDED.module
       RETURNING id`,
      [randomUUID(), action],
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
