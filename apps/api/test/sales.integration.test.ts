import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AppEnvironment } from '@vista/config';
import type {
  CustomerPriceGroup,
  PriceList,
  PromotionalCampaign,
  SalesPricingReferenceData,
  SalesReferenceData,
  SalesResolvedPrice,
  SalesWorkflow,
  ServiceSubscriptionContract,
} from '@vista/contracts';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PasswordService } from '../src/auth/password.service.js';
import { configureHttpApplication } from '../src/common/http-application.js';
import { APP_ENVIRONMENT } from '../src/config/config.module.js';
import { migrateDown, migrateUp } from '../src/database/migration-runner.js';
import { JobHandlerRegistry } from '../src/jobs/job-handler-registry.service.js';

const runInfrastructureTests = process.env['RUN_INFRASTRUCTURE_TESTS'] === 'true';
const password = 'Vista-Sales-Test-8!';

describe.skipIf(!runInfrastructureTests)('quotation to invoice-draft sales workflow', () => {
  let adminDatabase: Pool;
  let application: INestApplication;
  let database: Pool;
  let databaseName: string;
  let token: string;
  let viewerToken: string;
  let customerId: string;
  let customerLocationId: string;
  let equipmentId: string;
  let productId: string;
  let serialProductId: string;
  let warehouseId: string;
  let serialNumber: string;
  const runId = randomUUID().replaceAll('-', '');

  beforeAll(async () => {
    const sourceDatabaseUrl = process.env['DATABASE_URL'];
    const sourceRedisUrl = process.env['REDIS_URL'];
    if (!sourceDatabaseUrl || !sourceRedisUrl)
      throw new Error('DATABASE_URL and REDIS_URL are required for sales integration tests');
    adminDatabase = new Pool({ connectionString: sourceDatabaseUrl, max: 1 });
    databaseName = `vista_sales_test_${randomUUID().replaceAll('-', '')}`;
    assertTemporaryDatabaseName(databaseName);
    await adminDatabase.query(`CREATE DATABASE ${databaseName}`);
    const isolatedDatabaseUrl = new URL(sourceDatabaseUrl);
    isolatedDatabaseUrl.pathname = `/${databaseName}`;
    const isolatedRedisUrl = new URL(sourceRedisUrl);
    isolatedRedisUrl.pathname = '/12';
    database = new Pool({ connectionString: isolatedDatabaseUrl.toString(), max: 3 });
    const migrationDirectory = fileURLToPath(
      new URL('../src/database/migrations', import.meta.url),
    );
    await migrateUp(database, migrationDirectory);
    expect(await migrateDown(database, migrationDirectory)).toBe(
      '0028_sales_subscriptions_handover',
    );
    expect(await migrateUp(database, migrationDirectory)).toContain(
      '0028_sales_subscriptions_handover',
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
    const creatorId = await createAccount(database, `sales-${runId}@example.invalid`, passwordHash);
    const viewerId = await createAccount(
      database,
      `sales-viewer-${runId}@example.invalid`,
      passwordHash,
    );
    await grantPermissions(database, creatorId, ['create', 'edit', 'view']);
    await grantPermissions(database, viewerId, ['view']);
    ({
      customerId,
      customerLocationId,
      equipmentId,
      productId,
      serialNumber,
      serialProductId,
      warehouseId,
    } = await seedSalesData(database, creatorId, runId));
    token = await login(application, `sales-${runId}@example.invalid`);
    viewerToken = await login(application, `sales-viewer-${runId}@example.invalid`);
  }, 30_000);

  afterAll(async () => {
    if (application) await application.close();
    if (database) await database.end();
    if (adminDatabase && databaseName) {
      assertTemporaryDatabaseName(databaseName);
      await adminDatabase.query(`DROP DATABASE IF EXISTS ${databaseName}`);
      await adminDatabase.end();
    }
  });

  it('protects sales commands and exposes ERP-owned customer, product, and stock choices', async () => {
    await request(application.getHttpServer()).get('/api/v1/sales/reference-data').expect(401);
    const references = await request(application.getHttpServer())
      .get('/api/v1/sales/reference-data')
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    const referenceData = references.body as SalesReferenceData;
    expect(referenceData.customers.some((customer) => customer.id === customerId)).toBe(true);
    expect(referenceData.serials.some((serial) => serial.serialNumber === serialNumber)).toBe(true);
    await request(application.getHttpServer())
      .post('/api/v1/sales/quotations')
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `sales-viewer-${runId}`)
      .send(quotationInput())
      .expect(403);
  });

  it('creates, confirms, ships, and prepares an invoice draft exactly once', async () => {
    const key = `sales-quotation-${runId}`;
    const createdResponse = await request(application.getHttpServer())
      .post('/api/v1/sales/quotations')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', key)
      .send(quotationInput())
      .expect(201);
    const created = createdResponse.body as SalesWorkflow;
    expect(created).toMatchObject({
      currencyCode: 'BGN',
      overallDiscountPercent: '5.0000',
      status: 'draft',
      subtotal: '228.0000',
      vatTotal: '45.6000',
      total: '273.6000',
    });
    const replay = await request(application.getHttpServer())
      .post('/api/v1/sales/quotations')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', key)
      .send(quotationInput())
      .expect(201);
    expect((replay.body as SalesWorkflow).id).toBe(created.id);

    const confirmedResponse = await request(application.getHttpServer())
      .post(`/api/v1/sales/quotations/${created.id}/confirm`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `sales-confirm-${runId}`)
      .send({
        lines: created.lines.map((line) => ({
          quotationLineId: line.id,
          ...(line.productId === serialProductId ? { serialNumbers: [serialNumber] } : {}),
        })),
      })
      .expect(201);
    const confirmed = confirmedResponse.body as SalesWorkflow;
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.order?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: serialProductId,
          reservedSerialNumbers: [serialNumber],
        }),
      ]),
    );

    const shippedResponse = await request(application.getHttpServer())
      .post(`/api/v1/sales/orders/${confirmed.order?.id}/shipments`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `sales-shipment-${runId}`)
      .send({ lines: confirmed.order?.lines.map((line) => ({ orderLineId: line.id })) })
      .expect(201);
    const shipped = shippedResponse.body as SalesWorkflow;
    expect(shipped.status).toBe('shipped');
    expect(shipped.shipment?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: serialProductId, serialNumbers: [serialNumber] }),
      ]),
    );
    expect(shipped.handover).toMatchObject({ status: 'prepared', version: 1 });
    expect(shipped.handover?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: serialProductId,
          serialNumbers: [serialNumber],
        }),
      ]),
    );

    const acceptedResponse = await request(application.getHttpServer())
      .post(`/api/v1/sales/handover-certificates/${shipped.handover?.id}/accept`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `sales-handover-${runId}`)
      .send({
        acceptanceNotes: 'Equipment received in good condition.',
        acceptedByName: 'Customer Representative',
        expectedVersion: shipped.handover?.version,
      })
      .expect(200);
    const accepted = acceptedResponse.body as SalesWorkflow;
    expect(accepted.handover).toMatchObject({
      acceptanceNotes: 'Equipment received in good condition.',
      acceptedByName: 'Customer Representative',
      status: 'accepted',
      version: 2,
    });

    const invoicedResponse = await request(application.getHttpServer())
      .post(`/api/v1/sales/orders/${accepted.order?.id}/invoice-draft`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `sales-invoice-${runId}`)
      .expect(201);
    const invoiced = invoicedResponse.body as SalesWorkflow;
    expect(invoiced).toMatchObject({ status: 'invoiced', invoice: { status: 'draft' } });
    expect(invoiced.invoice?.total).toBe('273.6000');

    const evidence = await database.query<{
      audit_count: string;
      outbox_count: string;
      reservation_count: string;
      serial_status: string;
      stock_quantity: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM audit.events WHERE action LIKE 'sales.%') AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events WHERE event_type LIKE 'sales.%') AS outbox_count,
         (SELECT count(*)::text FROM inventory.stock_reservations WHERE reference_type = 'sales_order' AND status = 'consumed') AS reservation_count,
         (SELECT status FROM inventory.serialized_items WHERE serial_number = $1) AS serial_status,
         (SELECT quantity::text FROM inventory.stock_balances WHERE warehouse_id = $2 AND product_id = $3) AS stock_quantity`,
      [serialNumber, warehouseId, productId],
    );
    expect(evidence.rows[0]).toEqual({
      audit_count: '6',
      outbox_count: '6',
      reservation_count: '2',
      serial_status: 'issued',
      stock_quantity: '8.0000',
    });
  });

  it('maintains scoped price lists and resolves one deterministic future price', async () => {
    await request(application.getHttpServer())
      .post('/api/v1/sales/customer-groups')
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `pricing-viewer-${runId}`)
      .send({ code: `VIEW-${runId.slice(0, 8)}`, customerPartnerIds: [], name: 'Denied' })
      .expect(403);

    const referencesResponse = await request(application.getHttpServer())
      .get('/api/v1/sales/pricing/reference-data')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const references = referencesResponse.body as SalesPricingReferenceData;
    expect(references.customers.some((customer) => customer.id === customerId)).toBe(true);
    expect(references.products.some((product) => product.id === productId)).toBe(true);

    const groupInput = {
      code: `TRADE-${runId.slice(0, 8)}`,
      customerPartnerIds: [customerId],
      name: `Trade customers ${runId}`,
    };
    const groupKey = `pricing-group-${runId}`;
    const groupResponse = await request(application.getHttpServer())
      .post('/api/v1/sales/customer-groups')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', groupKey)
      .send(groupInput)
      .expect(201);
    const group = groupResponse.body as CustomerPriceGroup;
    const groupReplay = await request(application.getHttpServer())
      .post('/api/v1/sales/customer-groups')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', groupKey)
      .send(groupInput)
      .expect(201);
    expect((groupReplay.body as CustomerPriceGroup).id).toBe(group.id);

    const campaignResponse = await request(application.getHttpServer())
      .post('/api/v1/sales/promotional-campaigns')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `pricing-campaign-${runId}`)
      .send({
        code: `SUMMER-${runId.slice(0, 8)}`,
        name: `Summer campaign ${runId}`,
        validFrom: '2099-05-01',
        validTo: '2099-08-31',
      })
      .expect(201);
    const campaign = campaignResponse.body as PromotionalCampaign;

    const generalResponse = await request(application.getHttpServer())
      .post('/api/v1/sales/price-lists')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `pricing-general-${runId}`)
      .send({
        code: `GENERAL-${runId.slice(0, 8)}`,
        currencyCode: 'bgn',
        lines: [{ productId, unitPrice: '30' }],
        name: `General prices ${runId}`,
        priority: 10,
        scope: 'all_customers',
        validFrom: '2099-01-01',
        validTo: '2099-12-31',
      })
      .expect(201);
    expect((generalResponse.body as PriceList).lines[0]?.unitPrice).toBe('30.0000');

    const groupPriceInput = {
      campaignId: campaign.id,
      code: `TRADE-PL-${runId.slice(0, 8)}`,
      currencyCode: 'BGN',
      customerGroupId: group.id,
      lines: [{ productId, unitPrice: '25' }],
      name: `Trade campaign prices ${runId}`,
      priority: 20,
      scope: 'customer_group',
      validFrom: '2099-01-01',
      validTo: '2099-12-31',
    };
    const groupPriceResponse = await request(application.getHttpServer())
      .post('/api/v1/sales/price-lists')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `pricing-trade-${runId}`)
      .send(groupPriceInput)
      .expect(201);
    const groupPrice = groupPriceResponse.body as PriceList;

    const resolvedResponse = await request(application.getHttpServer())
      .get(
        `/api/v1/sales/prices/resolve?asOf=2099-06-01&currencyCode=BGN&customerPartnerId=${customerId}&productId=${productId}`,
      )
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(resolvedResponse.body as SalesResolvedPrice).toMatchObject({
      matched: true,
      priceListId: groupPrice.id,
      priority: 20,
      unitPrice: '25.0000',
    });

    const differentCurrencyResponse = await request(application.getHttpServer())
      .get(
        `/api/v1/sales/prices/resolve?asOf=2099-06-01&currencyCode=EUR&customerPartnerId=${customerId}&productId=${productId}`,
      )
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(differentCurrencyResponse.body as SalesResolvedPrice).toMatchObject({
      currencyCode: 'EUR',
      matched: false,
      productId,
    });

    const updatedGroupResponse = await request(application.getHttpServer())
      .put(`/api/v1/sales/customer-groups/${group.id}`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `pricing-group-update-${runId}`)
      .send({
        active: true,
        customerPartnerIds: [customerId],
        name: `${group.name} updated`,
        version: group.version,
      })
      .expect(200);
    expect((updatedGroupResponse.body as CustomerPriceGroup).version).toBe(2);

    const updatedPriceResponse = await request(application.getHttpServer())
      .put(`/api/v1/sales/price-lists/${groupPrice.id}`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `pricing-list-update-${runId}`)
      .send({
        ...groupPriceInput,
        active: true,
        lines: [{ productId, unitPrice: '24' }],
        version: groupPrice.version,
      })
      .expect(200);
    const updatedPrice = updatedPriceResponse.body as PriceList;
    expect(updatedPrice).toMatchObject({ version: 2, lines: [{ unitPrice: '24.0000' }] });

    await request(application.getHttpServer())
      .put(`/api/v1/sales/price-lists/${groupPrice.id}`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `pricing-list-stale-${runId}`)
      .send({ ...groupPriceInput, active: true, version: groupPrice.version })
      .expect(409);

    await request(application.getHttpServer())
      .put(`/api/v1/sales/promotional-campaigns/${campaign.id}`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `pricing-campaign-update-${runId}`)
      .send({
        active: false,
        name: campaign.name,
        validFrom: campaign.validFrom,
        validTo: campaign.validTo,
        version: campaign.version,
      })
      .expect(200);

    const fallbackResponse = await request(application.getHttpServer())
      .get(
        `/api/v1/sales/prices/resolve?asOf=2099-06-01&currencyCode=BGN&customerPartnerId=${customerId}&productId=${productId}`,
      )
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(fallbackResponse.body as SalesResolvedPrice).toMatchObject({
      matched: true,
      priceListId: (generalResponse.body as PriceList).id,
      unitPrice: '30.0000',
    });

    const evidence = await database.query<{
      audit_count: string;
      outbox_count: string;
      price_list_count: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM audit.events WHERE action IN (
           'sales.customer_price_group.created', 'sales.customer_price_group.updated',
           'sales.promotional_campaign.created', 'sales.promotional_campaign.updated',
           'sales.price_list.created', 'sales.price_list.updated'
         )) AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events WHERE event_type IN (
           'sales.customer_price_group.created', 'sales.customer_price_group.updated',
           'sales.promotional_campaign.created', 'sales.promotional_campaign.updated',
           'sales.price_list.created', 'sales.price_list.updated'
         )) AS outbox_count,
         (SELECT count(*)::text FROM sales.price_lists) AS price_list_count`,
    );
    expect(evidence.rows[0]).toEqual({
      audit_count: '7',
      outbox_count: '7',
      price_list_count: '2',
    });
  });

  it('keeps location-and-device subscriptions versioned and generates recurring drafts once', async () => {
    await request(application.getHttpServer())
      .post('/api/v1/sales/subscriptions')
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `subscription-viewer-${runId}`)
      .send(subscriptionInput())
      .expect(403);

    const references = await request(application.getHttpServer())
      .get('/api/v1/sales/subscriptions/reference-data')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(references.body.locations).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: customerLocationId })]),
    );
    expect(references.body.equipment).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: equipmentId })]),
    );

    const key = `subscription-create-${runId}`;
    const createdResponse = await request(application.getHttpServer())
      .post('/api/v1/sales/subscriptions')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', key)
      .send(subscriptionInput())
      .expect(201);
    const created = createdResponse.body as ServiceSubscriptionContract;
    expect(created).toMatchObject({
      active: true,
      billingAmount: '120.0000',
      customerLocationId,
      customerPartnerId: customerId,
      equipment: [expect.objectContaining({ id: equipmentId })],
      includedServices: ['Preventive maintenance', 'Remote support'],
      invoiceDrafts: [],
      version: 1,
    });

    const replay = await request(application.getHttpServer())
      .post('/api/v1/sales/subscriptions')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', key)
      .send(subscriptionInput())
      .expect(201);
    expect((replay.body as ServiceSubscriptionContract).id).toBe(created.id);

    const updatedResponse = await request(application.getHttpServer())
      .put(`/api/v1/sales/subscriptions/${created.id}`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `subscription-update-${runId}`)
      .send({ ...subscriptionInput(), active: true, billingAmount: '135', expectedVersion: 1 })
      .expect(200);
    expect(updatedResponse.body).toMatchObject({ billingAmount: '135.0000', version: 2 });

    await request(application.getHttpServer())
      .put(`/api/v1/sales/subscriptions/${created.id}`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `subscription-stale-${runId}`)
      .send({ ...subscriptionInput(), active: true, expectedVersion: 1 })
      .expect(409);

    const handlers = application.get(JobHandlerRegistry);
    const context = {
      attemptNumber: 1,
      correlationId: `subscription-job-${runId}`,
      enqueuedAt: '2026-08-12T08:00:00.000Z',
      idempotencyKey: `subscription-2026-08-${runId}`,
      jobId: `subscription-job-${runId}`,
      maxAttempts: 5,
      name: 'sales.subscription-invoice.generate',
      payload: { asOf: '2026-08-12' },
      retryAllowed: true,
    };
    await expect(handlers.execute(context)).resolves.toMatchObject({ generatedCount: 1 });
    await expect(handlers.execute({ ...context, attemptNumber: 2 })).resolves.toMatchObject({
      deduplicated: true,
      generatedCount: 0,
    });

    const contractResponse = await request(application.getHttpServer())
      .get(`/api/v1/sales/subscriptions/${created.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const contract = contractResponse.body as ServiceSubscriptionContract;
    expect(contract.invoiceDrafts).toHaveLength(1);
    expect(contract.invoiceDrafts[0]).toMatchObject({
      amount: '135.0000',
      billingDate: '2026-08-01',
      status: 'draft',
    });
    expect(contract.nextInvoiceDate).toBe('2026-09-01');

    const evidence = await database.query<{
      audit_count: string;
      draft_count: string;
      outbox_count: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM sales.subscription_invoice_drafts
          WHERE contract_id = $1) AS draft_count,
         (SELECT count(*)::text FROM audit.events
          WHERE action LIKE 'sales.subscription%') AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events
          WHERE event_type LIKE 'sales.subscription%') AS outbox_count`,
      [created.id],
    );
    expect(evidence.rows[0]).toEqual({ audit_count: '3', draft_count: '1', outbox_count: '3' });
  });

  function quotationInput() {
    return {
      currencyCode: 'BGN',
      customerPartnerId: customerId,
      lines: [
        {
          discountPercent: '0',
          productId,
          quantity: '2',
          unitPrice: '20',
          vatTreatment: 'standard_20',
        },
        {
          discountPercent: '0',
          productId: serialProductId,
          quantity: '1',
          unitPrice: '200',
          vatTreatment: 'standard_20',
        },
      ],
      overallDiscountPercent: '5',
      validUntil: '2099-12-31',
      warehouseId,
    };
  }

  function subscriptionInput() {
    return {
      billingAmount: '120',
      billingFrequencyMonths: 1,
      currencyCode: 'BGN',
      customerLocationId,
      customerPartnerId: customerId,
      equipmentIds: [equipmentId],
      includedServices: ['Preventive maintenance', 'Remote support'],
      nextInvoiceDate: '2026-08-01',
      validFrom: '2026-01-01',
      visitFrequencyMonths: 3,
    };
  }
});

async function createAccount(pool: Pool, email: string, passwordHash: string) {
  const employeeId = randomUUID();
  const accountId = randomUUID();
  await pool.query(
    `INSERT INTO identity.employees (id, employee_number, display_name, email)
     VALUES ($1, $2, 'Sales tester', $3)`,
    [employeeId, `SALES-${randomUUID()}`, email],
  );
  await pool.query(
    'INSERT INTO identity.user_accounts (id, employee_id, password_hash) VALUES ($1, $2, $3)',
    [accountId, employeeId, passwordHash],
  );
  return accountId;
}

async function grantPermissions(
  pool: Pool,
  accountId: string,
  actions: Array<'create' | 'edit' | 'view'>,
) {
  const roleId = randomUUID();
  await pool.query('INSERT INTO iam.roles (id, code, name) VALUES ($1, $2, $3)', [
    roleId,
    `sales-${randomUUID()}`,
    'Sales test role',
  ]);
  for (const action of actions) {
    const permission = await pool.query<{ id: string }>(
      `INSERT INTO iam.permissions (id, module, action) VALUES ($1, 'erp.sales', $2)
       ON CONFLICT (module, action) DO UPDATE SET module = EXCLUDED.module RETURNING id`,
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

async function seedSalesData(pool: Pool, actorId: string, runId: string) {
  const customerId = randomUUID();
  const customerLocationId = randomUUID();
  const equipmentId = randomUUID();
  const warehouseId = randomUUID();
  const ordinaryCategoryId = randomUUID();
  const serialCategoryId = randomUUID();
  const unitId = randomUUID();
  const productId = randomUUID();
  const serialProductId = randomUUID();
  const serialNumber = `VISTA-SALE-${runId}`;
  await pool.query(
    `INSERT INTO master_data.partners (id, kind, display_name, created_by, updated_by)
     VALUES ($1, 'legal_entity', $2, $3, $3)`,
    [customerId, `Sales Customer ${runId}`, actorId],
  );
  await pool.query(
    "INSERT INTO master_data.partner_roles (partner_id, role, assigned_by) VALUES ($1, 'customer', $2)",
    [customerId, actorId],
  );
  await pool.query(
    `INSERT INTO master_data.warehouses (id, code, name, created_by, updated_by)
     VALUES ($1, $2, 'Sales warehouse', $3, $3)`,
    [warehouseId, `SW-${runId.slice(0, 8).toUpperCase()}`, actorId],
  );
  await pool.query(
    `INSERT INTO master_data.product_categories (id, name, tracking_mode, created_by, updated_by)
     VALUES ($1, $2, 'none', $3, $3), ($4, $5, 'serial', $3, $3)`,
    [
      ordinaryCategoryId,
      `Sales ordinary ${runId}`,
      actorId,
      serialCategoryId,
      `Sales serial ${runId}`,
    ],
  );
  await pool.query(
    `INSERT INTO master_data.units (id, code, name, created_by, updated_by)
     VALUES ($1, $2, 'Pieces', $3, $3)`,
    [unitId, `SU${runId.slice(0, 6).toUpperCase()}`, actorId],
  );
  await pool.query(
    `INSERT INTO master_data.products (id, product_code, name, category_id, unit_id, created_by, updated_by)
     VALUES ($1, $2, 'Receipt rolls', $3, $4, $5, $5),
            ($6, $7, 'Fiscal register', $8, $4, $5, $5)`,
    [
      productId,
      `ROLL-${runId.slice(0, 8)}`,
      ordinaryCategoryId,
      unitId,
      actorId,
      serialProductId,
      `REG-${runId.slice(0, 8)}`,
      serialCategoryId,
    ],
  );
  const ordinaryMovement = randomUUID();
  const serialMovement = randomUUID();
  await pool.query(
    `INSERT INTO inventory.stock_movements (id, warehouse_id, product_id, movement_type, quantity, reference_type, reference_id, actor_account_id, correlation_id, unit_cost_bgn)
     VALUES ($1, $2, $3, 'receipt', 10, 'sales_test_seed', $4, $5, $6, 8),
            ($7, $2, $8, 'receipt', 1, 'sales_test_seed', $9, $5, $10, 120)`,
    [
      ordinaryMovement,
      warehouseId,
      productId,
      `ordinary-${runId}`,
      actorId,
      randomUUID(),
      serialMovement,
      serialProductId,
      `serial-${runId}`,
      randomUUID(),
    ],
  );
  await pool.query(
    `INSERT INTO inventory.stock_balances (warehouse_id, product_id, quantity, average_unit_cost_bgn)
     VALUES ($1, $2, 10, 8), ($1, $3, 1, 120)`,
    [warehouseId, productId, serialProductId],
  );
  await pool.query(
    `INSERT INTO inventory.serialized_items (product_id, serial_number, warehouse_id, received_movement_id)
     VALUES ($1, $2, $3, $4)`,
    [serialProductId, serialNumber, warehouseId, serialMovement],
  );
  await pool.query(
    `INSERT INTO master_data.customer_locations (
       id, partner_id, name, location_type, address_line_1, city, created_by, updated_by
     ) VALUES ($1, $2, 'Vratsa service location', 'Retail outlet', '1 Service Street',
       'Vratsa', $3, $3)`,
    [customerLocationId, customerId, actorId],
  );
  await pool.query(
    `INSERT INTO master_data.customer_equipment (
       id, customer_location_id, product_id, device_name, serial_number,
       purchase_date, warranty_start_date, warranty_end_date, created_by, updated_by
     ) VALUES ($1, $2, $3, 'Installed fiscal register', $4, '2026-01-01',
       '2026-01-01', '2027-01-01', $5, $5)`,
    [equipmentId, customerLocationId, serialProductId, `INSTALLED-${runId}`, actorId],
  );
  return {
    customerId,
    customerLocationId,
    equipmentId,
    productId,
    serialNumber,
    serialProductId,
    warehouseId,
  };
}

async function login(application: INestApplication, email: string) {
  const response = await request(application.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.sessionToken as string;
}

function assertTemporaryDatabaseName(value: string) {
  if (!/^vista_sales_test_[a-f0-9]{32}$/u.test(value))
    throw new Error('Refusing to operate on an unexpected sales test database');
}
