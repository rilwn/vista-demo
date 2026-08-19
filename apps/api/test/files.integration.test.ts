import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AppEnvironment } from '@vista/config';
import type { ManagedFile, ManagedFilePage } from '@vista/contracts';
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
const password = 'Vista-Files-Test-7!';

describe.skipIf(!runInfrastructureTests)('managed partner files', () => {
  let adminDatabase: Pool;
  let application: INestApplication;
  let database: Pool;
  let databaseName: string;
  let editorToken: string;
  let outsiderToken: string;
  let partnerId: string;
  let storage: ObjectStorageService;
  let viewerToken: string;
  let firstVersion: ManagedFile;
  let secondVersion: ManagedFile;
  const runId = randomUUID().replaceAll('-', '');
  const firstPdf = Buffer.from(`%PDF-1.4\nVista managed file ${runId} v1\n`);
  const secondPdf = Buffer.from(`%PDF-1.4\nVista managed file ${runId} v2\n`);

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
      throw new Error('Database, Redis, and S3 settings are required for managed-file tests');
    }

    adminDatabase = new Pool({ connectionString: sourceDatabaseUrl, max: 1 });
    databaseName = `vista_files_test_${runId}`;
    assertTemporaryDatabaseName(databaseName);
    await adminDatabase.query(`CREATE DATABASE ${databaseName}`);
    const isolatedDatabaseUrl = new URL(sourceDatabaseUrl);
    isolatedDatabaseUrl.pathname = `/${databaseName}`;
    const isolatedRedisUrl = new URL(sourceRedisUrl);
    isolatedRedisUrl.pathname = '/9';

    database = new Pool({ connectionString: isolatedDatabaseUrl.toString(), max: 2 });
    const migrationDirectory = fileURLToPath(
      new URL('../src/database/migrations', import.meta.url),
    );
    await migrateUp(database, migrationDirectory);
    const rolledBack = await migrateDown(database, migrationDirectory);
    if (rolledBack !== '0033_managed_file_versions') {
      throw new Error(`Expected to roll back 0033_managed_file_versions, received ${rolledBack}`);
    }
    const reapplied = await migrateUp(database, migrationDirectory);
    if (!reapplied.includes('0033_managed_file_versions')) {
      throw new Error('Managed-file version migration could not be reapplied');
    }

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
    const outsider = await createAccount(database, 'outsider', passwordHash, runId);
    await grantCrmPermissions(database, editor.accountId, ['edit', 'view']);
    await grantCrmPermissions(database, viewer.accountId, ['view']);
    partnerId = randomUUID();
    await database.query(
      `INSERT INTO master_data.partners (
         id, kind, display_name, uic, created_by, updated_by
       ) VALUES ($1, 'legal_entity', $2, $3, $4, $4)`,
      [
        partnerId,
        `Managed Files Partner ${runId}`,
        `FILES-${runId.slice(0, 12)}`,
        editor.accountId,
      ],
    );
    editorToken = await login(application, editor.email);
    viewerToken = await login(application, viewer.email);
    outsiderToken = await login(application, outsider.email);
  }, 30_000);

  afterAll(async () => {
    if (database && storage) {
      const keys = await database.query<{ storage_key: string }>(
        'SELECT storage_key FROM files.objects',
      );
      for (const row of keys.rows) await storage.deleteObject(row.storage_key);
    }
    if (application) {
      for (const token of [editorToken, viewerToken, outsiderToken]) {
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

  it('inherits partner permissions for lists and upload commands', async () => {
    await request(application.getHttpServer())
      .get(`/api/v1/files?parentType=partner&parentId=${partnerId}`)
      .expect(401);

    const denied = await request(application.getHttpServer())
      .get(`/api/v1/files?parentType=partner&parentId=${partnerId}`)
      .set('authorization', `Bearer ${outsiderToken}`)
      .expect(403);
    expect(denied.body).toMatchObject({ error: { code: 'FILE_PARENT_ACCESS_DENIED' } });

    const viewerUpload = await upload(
      application,
      viewerToken,
      partnerId,
      `viewer-${runId}`,
      firstPdf,
      'agreement.pdf',
    ).expect(403);
    expect(viewerUpload.body).toMatchObject({ error: { code: 'FILE_PARENT_ACCESS_DENIED' } });
  });

  it('stores one structurally inspected file and safely replays the command', async () => {
    const key = `create-${runId}`;
    const created = await upload(
      application,
      editorToken,
      partnerId,
      key,
      firstPdf,
      'agreement.pdf',
    ).expect(201);
    firstVersion = created.body as ManagedFile;
    expect(firstVersion).toMatchObject({
      byteSize: firstPdf.length,
      inspectionMethod: 'structural-signature',
      isCurrent: true,
      mediaType: 'application/pdf',
      originalName: 'agreement.pdf',
      parentId: partnerId,
      parentType: 'partner',
      status: 'available',
      version: 1,
      versionCount: 1,
    });

    const replay = await upload(
      application,
      editorToken,
      partnerId,
      key,
      firstPdf,
      'agreement.pdf',
    ).expect(201);
    expect(replay.body).toMatchObject({ id: firstVersion.id, version: 1 });

    const rows = await database.query<{ total: string }>(
      'SELECT count(*)::text AS total FROM files.objects WHERE parent_id = $1',
      [partnerId],
    );
    expect(rows.rows[0]?.total).toBe('1');
  });

  it('rejects a declared type that does not match the file bytes', async () => {
    const response = await upload(
      application,
      editorToken,
      partnerId,
      `invalid-${runId}`,
      Buffer.from('this is not a PDF'),
      'disguised.pdf',
    ).expect(400);
    expect(response.body).toMatchObject({ error: { code: 'FILE_CONTENT_TYPE_MISMATCH' } });
  });

  it('creates an immutable replacement and exposes authorized version history', async () => {
    const response = await request(application.getHttpServer())
      .post(`/api/v1/files/${firstVersion.id}/versions`)
      .set('authorization', `Bearer ${editorToken}`)
      .set('idempotency-key', `version-${runId}`)
      .attach('file', secondPdf, { contentType: 'application/pdf', filename: 'agreement-v2.pdf' })
      .expect(201);
    secondVersion = response.body as ManagedFile;
    expect(secondVersion).toMatchObject({
      isCurrent: true,
      originalName: 'agreement-v2.pdf',
      version: 2,
      versionCount: 2,
      versionGroupId: firstVersion.versionGroupId,
    });

    const list = await request(application.getHttpServer())
      .get(`/api/v1/files?parentType=partner&parentId=${partnerId}`)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(list.body as ManagedFilePage).toMatchObject({
      items: [expect.objectContaining({ id: secondVersion.id, version: 2, versionCount: 2 })],
      page: 1,
      total: 1,
      totalPages: 1,
    });

    const versions = await request(application.getHttpServer())
      .get(`/api/v1/files/${secondVersion.id}/versions`)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(
      (versions.body as ManagedFile[]).map(({ id, isCurrent, version }) => ({
        id,
        isCurrent,
        version,
      })),
    ).toEqual([
      { id: secondVersion.id, isCurrent: true, version: 2 },
      { id: firstVersion.id, isCurrent: false, version: 1 },
    ]);
  });

  it('downloads exact content and keeps audit/outbox payloads free of file bytes', async () => {
    await request(application.getHttpServer())
      .get(`/api/v1/files/${secondVersion.id}/content`)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect('cache-control', 'private, no-store')
      .expect('content-type', 'application/pdf')
      .expect('x-content-type-options', 'nosniff')
      .expect(200)
      .then((response) => expect(response.body as Buffer).toEqual(secondPdf));

    const sideEffects = await database.query<{ payload: unknown }>(
      `SELECT payload FROM integration.outbox_events WHERE aggregate_type = 'file_object'
       UNION ALL
       SELECT after_data AS payload FROM audit.events WHERE target_type = 'file_object'`,
    );
    expect(sideEffects.rows).toHaveLength(4);
    const serialized = JSON.stringify(sideEffects.rows);
    expect(serialized).not.toContain(secondPdf.toString('utf8'));
    expect(serialized).not.toContain(firstPdf.toString('utf8'));
  });
});

function upload(
  application: INestApplication,
  token: string,
  partnerId: string,
  key: string,
  body: Buffer,
  fileName: string,
) {
  return request(application.getHttpServer())
    .post('/api/v1/files')
    .set('authorization', `Bearer ${token}`)
    .set('idempotency-key', key)
    .field('parentType', 'partner')
    .field('parentId', partnerId)
    .attach('file', body, { contentType: 'application/pdf', filename: fileName });
}

async function createAccount(
  pool: Pool,
  label: string,
  passwordHash: string,
  runId: string,
): Promise<{ accountId: string; email: string }> {
  const employeeId = randomUUID();
  const accountId = randomUUID();
  const email = `files-${label}-${runId}@example.invalid`;
  await pool.query(
    `INSERT INTO identity.employees (id, employee_number, display_name, email)
     VALUES ($1, $2, $3, $4)`,
    [employeeId, `files-${label}-${runId}`, `Files ${label}`, email],
  );
  await pool.query(
    `INSERT INTO identity.user_accounts (id, employee_id, password_hash)
     VALUES ($1, $2, $3)`,
    [accountId, employeeId, passwordHash],
  );
  return { accountId, email };
}

async function grantCrmPermissions(
  pool: Pool,
  accountId: string,
  actions: Array<'edit' | 'view'>,
): Promise<void> {
  const roleId = randomUUID();
  await pool.query(
    `INSERT INTO iam.roles (id, code, name) VALUES ($1, $2, 'Managed-file test role')`,
    [roleId, `test-files-${randomUUID()}`],
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

async function login(application: INestApplication, email: string): Promise<string> {
  const response = await request(application.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.sessionToken as string;
}

function assertTemporaryDatabaseName(value: string): void {
  if (!/^vista_files_test_[a-f0-9]{32}$/u.test(value)) {
    throw new Error('Refusing to operate on an unexpected managed-file test database');
  }
}
