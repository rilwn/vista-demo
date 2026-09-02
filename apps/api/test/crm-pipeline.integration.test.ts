import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AppEnvironment } from '@vista/config';
import type { CrmLead, CrmOpportunity, CrmOpportunityPage } from '@vista/contracts';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PasswordService } from '../src/auth/password.service.js';
import { configureHttpApplication } from '../src/common/http-application.js';
import { APP_ENVIRONMENT } from '../src/config/config.module.js';
import { migrateDown, migrateUp } from '../src/database/migration-runner.js';

const runInfrastructureTests = process.env['RUN_INFRASTRUCTURE_TESTS'] === 'true';
const password = 'Vista-Crm-Pipeline-Test-8!';

describe.skipIf(!runInfrastructureTests)('CRM lead and opportunity pipeline', () => {
  let adminDatabase: Pool;
  let application: INestApplication;
  let database: Pool;
  let databaseName: string;
  let editorAccountId: string;
  let editorToken: string;
  let viewerToken: string;
  let convertedCustomerId: string;
  let lead: CrmLead;
  let opportunity: CrmOpportunity;
  let warehouseId: string;
  const runId = randomUUID().replaceAll('-', '');

  beforeAll(async () => {
    const sourceDatabaseUrl = process.env['DATABASE_URL'];
    const sourceRedisUrl = process.env['REDIS_URL'];
    if (!sourceDatabaseUrl || !sourceRedisUrl)
      throw new Error('Database and Redis settings are required for CRM pipeline tests');
    adminDatabase = new Pool({ connectionString: sourceDatabaseUrl, max: 1 });
    databaseName = `vista_crm_pipeline_test_${runId}`;
    assertTemporaryDatabaseName(databaseName);
    await adminDatabase.query(`CREATE DATABASE ${databaseName}`);
    const isolatedDatabaseUrl = new URL(sourceDatabaseUrl);
    isolatedDatabaseUrl.pathname = `/${databaseName}`;
    const isolatedRedisUrl = new URL(sourceRedisUrl);
    isolatedRedisUrl.pathname = '/15';
    database = new Pool({ connectionString: isolatedDatabaseUrl.toString(), max: 3 });
    const migrationDirectory = fileURLToPath(
      new URL('../src/database/migrations', import.meta.url),
    );
    const applied = await migrateUp(database, migrationDirectory);
    expect(applied).toContain('0048_crm_lead_opportunity_pipeline');
    expect(await migrateDown(database, migrationDirectory)).toBe(
      '0048_crm_lead_opportunity_pipeline',
    );
    expect(await migrateUp(database, migrationDirectory)).toContain(
      '0048_crm_lead_opportunity_pipeline',
    );

    Object.assign(process.env, {
      BUSINESS_TIMEZONE: 'Europe/Sofia',
      CORS_ORIGINS: 'http://localhost:5173',
      DATABASE_URL: isolatedDatabaseUrl.toString(),
      NODE_ENV: 'test',
      REDIS_URL: isolatedRedisUrl.toString(),
      REQUEST_LOGGING_ENABLED: 'false',
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
    const editor = await createAccount(database, 'editor', passwordHash, runId);
    const viewer = await createAccount(database, 'viewer', passwordHash, runId);
    editorAccountId = editor.accountId;
    await grantCrmPermissions(database, editor.accountId, ['view', 'create', 'edit']);
    await grantCrmPermissions(database, viewer.accountId, ['view']);
    warehouseId = randomUUID();
    await database.query(
      `INSERT INTO master_data.warehouses (
         id, code, name, created_by, updated_by
       ) VALUES ($1,$2,'CRM pipeline test warehouse',$3,$3)`,
      [warehouseId, `CRM-${runId.slice(0, 12)}`, editorAccountId],
    );
    editorToken = await login(application, editor.email);
    viewerToken = await login(application, viewer.email);
  }, 30_000);

  afterAll(async () => {
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

  it('protects pipeline reads and commands with CRM permissions', async () => {
    await request(application.getHttpServer())
      .get('/api/v1/crm/pipeline/reference-data')
      .expect(401);
    await request(application.getHttpServer())
      .post('/api/v1/crm/leads')
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `denied-${runId}`)
      .send({
        contactName: 'Denied user',
        organizationName: 'Denied prospect',
        ownerAccountId: editorAccountId,
        source: 'telephone',
        telephone: '+359 000 000 000',
      })
      .expect(403);
    await request(application.getHttpServer())
      .get('/api/v1/crm/pipeline/reference-data')
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          assignees: [expect.objectContaining({ id: editorAccountId })],
          businessTimezone: 'Europe/Sofia',
          customers: [],
        }),
      );
  });

  it('registers and qualifies one retry-safe lead with optimistic concurrency', async () => {
    const payload = {
      contactName: 'Petar Dimitrov',
      email: `petar-${runId}@example.invalid`,
      notes: 'Interested in a fiscal device and annual service coverage.',
      organizationName: `North Shop ${runId.slice(0, 8)} Ltd.`,
      ownerAccountId: editorAccountId,
      source: 'trade_exhibition',
      sourceDetails: 'Vratsa retail technology exhibition',
      telephone: '+359 888 200 300',
    };
    const key = `lead-${runId}`;
    const created = await request(application.getHttpServer())
      .post('/api/v1/crm/leads')
      .set('authorization', `Bearer ${editorToken}`)
      .set('idempotency-key', key)
      .send(payload)
      .expect(201);
    lead = created.body as CrmLead;
    expect(lead.number).toMatch(/^LEAD-\d{4}-\d{6}$/u);
    expect(lead).toMatchObject({
      contactName: payload.contactName,
      organizationName: payload.organizationName,
      status: 'new',
      version: 1,
    });
    await request(application.getHttpServer())
      .post('/api/v1/crm/leads')
      .set('authorization', `Bearer ${editorToken}`)
      .set('idempotency-key', key)
      .send(payload)
      .expect(201)
      .expect(({ body }) => expect(body).toMatchObject({ id: lead.id }));
    const qualified = await request(application.getHttpServer())
      .post(`/api/v1/crm/leads/${lead.id}/qualify`)
      .set('authorization', `Bearer ${editorToken}`)
      .set('idempotency-key', `qualify-${runId}`)
      .send({ expectedVersion: 1, note: 'Need, budget, and decision maker confirmed.' })
      .expect(200);
    lead = qualified.body as CrmLead;
    expect(lead).toMatchObject({ status: 'qualified', version: 2 });
    expect(lead.history.map((item) => item.type)).toEqual(['created', 'qualified']);
    await request(application.getHttpServer())
      .get('/api/v1/crm/leads?page=1&pageSize=25')
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          items: [expect.objectContaining({ id: lead.id })],
          total: 1,
          totalPages: 1,
        }),
      );
    await request(application.getHttpServer())
      .post(`/api/v1/crm/leads/${lead.id}/qualify`)
      .set('authorization', `Bearer ${editorToken}`)
      .set('idempotency-key', `qualify-stale-${runId}`)
      .send({ expectedVersion: 1 })
      .expect(409);
  });

  it('converts the qualified lead to one canonical customer and opportunity', async () => {
    const payload = {
      createOpportunity: true,
      expectedVersion: lead.version,
      newCustomer: {
        displayName: lead.organizationName,
        kind: 'legal_entity',
        uic: `CRM${runId.slice(0, 12)}`,
        vatNumber: `BGCRM${runId.slice(0, 10)}`,
      },
      note: 'Customer details confirmed during qualification.',
      opportunity: {
        description: 'One fiscal device with installation and annual service.',
        estimatedRevenueBgn: '1800.00',
        expectedCloseOn: '2026-10-30',
        ownerAccountId: editorAccountId,
        probabilityPercent: 40,
        title: 'Fiscal device and service package',
      },
    };
    const key = `convert-${runId}`;
    const converted = await request(application.getHttpServer())
      .post(`/api/v1/crm/leads/${lead.id}/convert`)
      .set('authorization', `Bearer ${editorToken}`)
      .set('idempotency-key', key)
      .send(payload)
      .expect(200);
    lead = converted.body.lead as CrmLead;
    opportunity = converted.body.opportunity as CrmOpportunity;
    convertedCustomerId = converted.body.customer.id as string;
    expect(lead).toMatchObject({
      convertedCustomer: { id: convertedCustomerId, name: payload.newCustomer.displayName },
      status: 'converted',
      version: 3,
    });
    expect(opportunity).toMatchObject({
      customer: { id: convertedCustomerId },
      estimatedRevenueBgn: '1800.00',
      probabilityPercent: 40,
      sourceLeadId: lead.id,
      stage: 'qualified',
      version: 1,
      weightedRevenueBgn: '720.00',
    });
    await request(application.getHttpServer())
      .post(`/api/v1/crm/leads/${lead.id}/convert`)
      .set('authorization', `Bearer ${editorToken}`)
      .set('idempotency-key', key)
      .send(payload)
      .expect(200)
      .expect(({ body }) => expect(body.opportunity).toMatchObject({ id: opportunity.id }));
    const canonical = await database.query<{
      contacts: string;
      customers: string;
      partners: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM master_data.partners WHERE id = $1) AS partners,
         (SELECT count(*)::text FROM master_data.partner_roles
          WHERE partner_id = $1 AND role = 'customer') AS customers,
         (SELECT count(*)::text FROM master_data.partner_contacts
          WHERE partner_id = $1) AS contacts`,
      [convertedCustomerId],
    );
    expect(canonical.rows[0]).toEqual({ contacts: '1', customers: '1', partners: '1' });
  });

  it('links the matching Sales quotation and validates audited pipeline movement', async () => {
    const quotationId = randomUUID();
    await database.query(
      `INSERT INTO sales.quotations (
         id, quotation_number, customer_partner_id, warehouse_id, valid_until,
         currency_code, subtotal, vat_total, total, created_by
       ) VALUES ($1,$2,$3,$4,'2026-10-31','BGN',1500,300,1800,$5)`,
      [quotationId, `Q-${runId.slice(0, 18)}`, convertedCustomerId, warehouseId, editorAccountId],
    );
    const linked = await request(application.getHttpServer())
      .post(`/api/v1/crm/opportunities/${opportunity.id}/quotations`)
      .set('authorization', `Bearer ${editorToken}`)
      .set('idempotency-key', `link-${runId}`)
      .send({ expectedVersion: 1, quotationId })
      .expect(200);
    opportunity = linked.body as CrmOpportunity;
    expect(opportunity).toMatchObject({
      quotations: [expect.objectContaining({ id: quotationId, total: '1800.0000' })],
      version: 2,
    });

    for (const [stage, probability] of [
      ['quotation_sent', 60],
      ['negotiation', 75],
      ['won', 100],
    ] as const) {
      const moved = await request(application.getHttpServer())
        .post(`/api/v1/crm/opportunities/${opportunity.id}/stage`)
        .set('authorization', `Bearer ${editorToken}`)
        .set('idempotency-key', `move-${stage}-${runId}`)
        .send({
          expectedVersion: opportunity.version,
          note: stage === 'won' ? 'Customer accepted the quotation.' : undefined,
          probabilityPercent: probability,
          stage,
        })
        .expect(200);
      opportunity = moved.body as CrmOpportunity;
    }
    expect(opportunity).toMatchObject({ probabilityPercent: 100, stage: 'won', version: 5 });
    expect(opportunity.history.map((item) => item.type)).toEqual([
      'created',
      'quotation_linked',
      'stage_changed',
      'stage_changed',
      'stage_changed',
    ]);
    const pipeline = await request(application.getHttpServer())
      .get('/api/v1/crm/opportunities?page=1&pageSize=100')
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    const page = pipeline.body as CrmOpportunityPage;
    expect(page.summary).toMatchObject({ openCount: 0, wonRevenueBgn: '1800.00' });
    expect(page).toMatchObject({ total: 1, totalPages: 1 });
    expect(page.items[0]).toMatchObject({ id: opportunity.id, stage: 'won' });
    const sideEffects = await database.query<{ audit_total: string; outbox_total: string }>(
      `SELECT
         (SELECT count(*)::text FROM audit.events
          WHERE target_type IN ('crm_lead','crm_opportunity','partner')) AS audit_total,
         (SELECT count(*)::text FROM integration.outbox_events
          WHERE aggregate_type IN ('crm_lead','crm_opportunity','partner')) AS outbox_total`,
    );
    expect(Number(sideEffects.rows[0]?.audit_total)).toBeGreaterThanOrEqual(9);
    expect(sideEffects.rows[0]?.outbox_total).toBe(sideEffects.rows[0]?.audit_total);
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
  const email = `crm-pipeline-${label}-${runId}@example.invalid`;
  await pool.query(
    `INSERT INTO identity.employees (id, employee_number, display_name, email)
     VALUES ($1,$2,$3,$4)`,
    [employeeId, `crm-pipeline-${label}-${runId}`, `CRM Pipeline ${label}`, email],
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
    `INSERT INTO iam.roles (id, code, name) VALUES ($1,$2,'CRM pipeline test role')`,
    [roleId, `test-crm-pipeline-${randomUUID()}`],
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
  if (!/^vista_crm_pipeline_test_[a-f0-9]{32}$/u.test(value))
    throw new Error('Refusing to operate on an unexpected CRM pipeline test database');
}
