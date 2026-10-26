import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AppEnvironment } from '@vista/config';
import type {
  CustomerAdvance,
  CustomerOperationalOverview,
  CustomerPaymentAccount,
  FinancialDocument,
  PosCatalogPage,
  PosBasketPricing,
  PosCustomerOption,
  PosCustomerPaymentOptions,
  PosDiscountAuthorization,
  PosLoyaltyLedger,
  PosCommercialRule,
  PosQuickAccess,
  PosReportDefinition,
  PosReportOverview,
  PosReturn,
  PosReturnPage,
  PosSale,
  PosSalePage,
  PosShift,
  PosTerminalContext,
  SerialTraceability,
} from '@vista/contracts';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PasswordService } from '../src/auth/password.service.js';
import { configureHttpApplication } from '../src/common/http-application.js';
import { APP_ENVIRONMENT } from '../src/config/config.module.js';
import { bootstrapDevelopmentFixtures, fixtureId } from '../src/database/development-fixtures.js';
import { migrateDown, migrateUp } from '../src/database/migration-runner.js';
import { ObjectStorageService } from '../src/storage/object-storage.service.js';
import { PosReportsService } from '../src/pos/pos-reports.service.js';
import { loadPosInvoiceSettlement } from '../src/finance/pos-invoice-settlement.js';

const runInfrastructureTests = process.env['RUN_INFRASTRUCTURE_TESTS'] === 'true';
const password = 'Vista-Pos-Integration-Test-8!';

describe.skipIf(!runInfrastructureTests)('POS split payment and linked return lifecycle', () => {
  let adminDatabase: Pool;
  let application: INestApplication;
  let database: Pool;
  let databaseName: string;
  let managerToken: string;
  let posToken: string;
  let viewerToken: string;
  const runId = randomUUID().replaceAll('-', '');

  beforeAll(async () => {
    const sourceDatabaseUrl = process.env['DATABASE_URL'];
    const sourceRedisUrl = process.env['REDIS_URL'];
    if (!sourceDatabaseUrl || !sourceRedisUrl)
      throw new Error('Database and Redis settings are required for POS integration tests');

    adminDatabase = new Pool({ connectionString: sourceDatabaseUrl, max: 1 });
    databaseName = `vista_pos_test_${runId}`;
    assertTemporaryDatabaseName(databaseName);
    await adminDatabase.query(`CREATE DATABASE ${databaseName}`);
    const isolatedDatabaseUrl = new URL(sourceDatabaseUrl);
    isolatedDatabaseUrl.pathname = `/${databaseName}`;
    const isolatedRedisUrl = new URL(sourceRedisUrl);
    isolatedRedisUrl.pathname = '/10';
    database = new Pool({ connectionString: isolatedDatabaseUrl.toString(), max: 3 });
    const migrationDirectory = fileURLToPath(
      new URL('../src/database/migrations', import.meta.url),
    );
    const applied = await migrateUp(database, migrationDirectory);
    expect(applied).toContain('0057_pos_receipt_documents');
    expect(await migrateDown(database, migrationDirectory)).toBe(applied.at(-1));
    expect(await migrateUp(database, migrationDirectory)).toEqual([applied.at(-1)]);

    Object.assign(process.env, {
      BUSINESS_TIMEZONE: 'Europe/Sofia',
      API_RATE_LIMIT_REDIS_PREFIX: `vista:pos-integration:${runId}`,
      CORS_ORIGINS: 'http://localhost:5174',
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

    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ObjectStorageService)
      .useValue({
        bucketName: () => 'vista-pos-integration-test',
        deleteObject: () => Promise.resolve(),
        getObject: () => Promise.reject(new Error('Object not found')),
        ping: () => Promise.resolve(1),
        putObject: () => Promise.resolve(),
      })
      .compile();
    application = module.createNestApplication();
    configureHttpApplication(application, application.get<AppEnvironment>(APP_ENVIRONMENT));
    await application.init();

    const passwordHash = await application.get(PasswordService).hash(password);
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      await bootstrapDevelopmentFixtures(client, passwordHash);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    posToken = await login(application, 'pos.operator@vista.local');
    managerToken = await login(application, 'manager@vista.local');
    viewerToken = await login(application, 'viewer@vista.local');
  }, 40_000);

  afterAll(async () => {
    if (application) {
      for (const token of [posToken, managerToken, viewerToken]) {
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

  it('saves private POS period reports with validated fields and idempotent audit', async () => {
    const endpoint = '/api/v1/pos/saved-reports';
    const body = {
      id: randomUUID(),
      name: 'Product review',
      definitionKey: 'pos.product-sales',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      format: 'xlsx',
      columns: ['productName', 'netRevenueEur'],
    };
    const send = (input: object) =>
      request(application.getHttpServer())
        .post(endpoint)
        .set('authorization', `Bearer ${posToken}`)
        .send(input);
    await request(application.getHttpServer()).post(endpoint).send(body).expect(401);
    await request(application.getHttpServer())
      .post(endpoint)
      .set('authorization', `Bearer ${viewerToken}`)
      .send(body)
      .expect(403);
    const results = await Promise.all([send(body), send(body)]);
    expect(results.map((result) => result.status)).toEqual([201, 201]);
    expect(results[0]?.body).toEqual(body);
    await send({ ...body, name: 'Changed' }).expect(409);
    for (const invalid of [
      { columns: [] },
      { columns: ['password_hash'] },
      { columns: ['productName', 'productName'] },
      { columns: ['cashier'] },
      { dateFrom: '2026-02-30' },
      { dateFrom: '2027-01-01' },
      { dateFrom: '2026-01-01T00:00:00Z' },
      { dateTo: undefined },
      { name: ' ' },
      { sql: 'SELECT 1' },
      { definitionKey: 'pos.x-report', shiftId: randomUUID() },
      { definitionKey: 'pos.z-report', shiftId: randomUUID() },
    ])
      await send({ ...body, id: randomUUID(), ...invalid }).expect(400);
    const list = await request(application.getHttpServer())
      .get(endpoint)
      .set('authorization', `Bearer ${posToken}`)
      .expect(200);
    expect(list.body.items).toEqual([body]);
    await request(application.getHttpServer())
      .get(endpoint)
      .set('authorization', `Bearer ${managerToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.total).toBe(0));
    await request(application.getHttpServer())
      .post(endpoint)
      .set('authorization', `Bearer ${managerToken}`)
      .send({ ...body, id: randomUUID() })
      .expect(403);
    // Grant a second test account POS access only inside this isolated database.
    const grant = await database.query(
      'INSERT INTO iam.account_roles(account_id,role_id,assigned_by) SELECT $1,role_id,$1 FROM iam.account_roles WHERE account_id=$2 ON CONFLICT DO NOTHING',
      [fixtureId('account:finance'), fixtureId('account:pos-operator')],
    );
    expect(grant.rowCount).toBeGreaterThan(0);
    const otherToken = await login(application, 'finance@vista.local');
    const other = await request(application.getHttpServer())
      .get(endpoint)
      .set('authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(other.body.total).toBe(0);
    await request(application.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('authorization', `Bearer ${otherToken}`)
      .expect(204);
    const audit = await database.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM audit.events WHERE target_id=$1 AND action='report.view.created'",
      [body.id],
    );
    expect(audit.rows[0]?.count).toBe(1);
    const defs = await request(application.getHttpServer())
      .get('/api/v1/pos/report-exports/definitions')
      .set('authorization', `Bearer ${posToken}`)
      .expect(200);
    expect((defs.body as PosReportDefinition[]).filter((item) => item.columns)).toHaveLength(7);
    const key = randomUUID();
    const input = {
      definitionKey: body.definitionKey,
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
      columns: body.columns,
      format: 'csv',
    };
    const exportSend = () =>
      request(application.getHttpServer())
        .post('/api/v1/pos/report-exports')
        .set('authorization', `Bearer ${posToken}`)
        .set('idempotency-key', key)
        .send(input);
    const first = await exportSend().expect(202);
    const again = await exportSend().expect(202);
    expect(again.body.id).toBe(first.body.id);
    const row = await database.query<{ filters: { columns: string[] } }>(
      'SELECT filters FROM reporting.export_jobs WHERE id=$1',
      [first.body.id],
    );
    expect(row.rows[0]?.filters.columns).toEqual(body.columns);
    const secondPosToken = await login(application, 'finance@vista.local');
    const privateExports = await request(application.getHttpServer())
      .get('/api/v1/pos/report-exports?page=1&pageSize=1')
      .set('authorization', `Bearer ${secondPosToken}`)
      .expect(200);
    expect(privateExports.body.total).toBe(0);
    await request(application.getHttpServer())
      .get(`/api/v1/pos/report-exports/${first.body.id}/content`)
      .set('authorization', `Bearer ${secondPosToken}`)
      .expect(404);
    await request(application.getHttpServer())
      .post(`/api/v1/pos/report-exports/${first.body.id}/retry`)
      .set('authorization', `Bearer ${secondPosToken}`)
      .expect(404);
    await request(application.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('authorization', `Bearer ${secondPosToken}`)
      .expect(204);
  });

  it('protects the assigned terminal and return commands with POS permissions', async () => {
    await request(application.getHttpServer()).get('/api/v1/pos/terminal-context').expect(401);
    await request(application.getHttpServer())
      .get('/api/v1/pos/terminal-context')
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(403);
    await request(application.getHttpServer())
      .post('/api/v1/pos/returns')
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `denied-return-${runId}`)
      .send({})
      .expect(403);
    await request(application.getHttpServer())
      .post(`/api/v1/pos/sales/${randomUUID()}/invoice-draft`)
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `denied-pos-invoice-${runId}`)
      .expect(403);
  });

  it('lets Sales maintain dated POS offers with versioned audit evidence', async () => {
    const created = await post<PosCommercialRule>(
      application,
      '/api/v1/sales/pos-commercial-rules',
      managerToken,
      `create-pos-offer-${runId}`,
      {
        code: `PRINT-${runId.slice(0, 8).toUpperCase()}`,
        discountType: 'percentage',
        discountValue: '12.5000',
        items: [
          {
            productId: fixtureId('catalog:product:print-head'),
            requiredQuantity: '2.0000',
          },
        ],
        name: 'Two print heads save 12.5%',
        priority: 30,
        ruleType: 'quantity',
        validFrom: '2026-01-01',
        validTo: '2030-12-31',
      },
    );
    expect(created).toMatchObject({
      active: true,
      discountValue: '12.5000',
      name: 'Two print heads save 12.5%',
      version: 1,
    });

    const updated = await put<PosCommercialRule>(
      application,
      `/api/v1/sales/pos-commercial-rules/${created.id}`,
      managerToken,
      `update-pos-offer-${runId}`,
      {
        active: false,
        code: created.code,
        discountType: created.discountType,
        discountValue: created.discountValue,
        items: created.items.map((item) => ({
          productId: item.productId,
          requiredQuantity: item.requiredQuantity,
        })),
        name: created.name,
        priority: created.priority,
        ruleType: created.ruleType,
        validFrom: created.validFrom,
        validTo: created.validTo,
        version: created.version,
      },
    );
    expect(updated).toMatchObject({ active: false, version: 2 });
    const rules = await get<PosCommercialRule[]>(
      application,
      '/api/v1/sales/pos-commercial-rules',
      managerToken,
    );
    expect(rules.find((item) => item.id === created.id)).toMatchObject({
      active: false,
      version: 2,
    });
    const audit = await database.query<{ action: string }>(
      `SELECT action FROM audit.events WHERE target_id = $1 ORDER BY occurred_at`,
      [created.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      'sales.pos_commercial_rule.created',
      'sales.pos_commercial_rule.updated',
    ]);
  });

  it('completes and replays a split sale, then restores stock through partial linked returns', async () => {
    const terminal = await get<PosTerminalContext>(
      application,
      '/api/v1/pos/terminal-context',
      posToken,
    );
    const register = terminal.registers[0];
    expect(register).toMatchObject({
      paymentTerminalMode: 'simulator',
      serviceReturnWarehouseId: fixtureId('warehouse:service'),
      warehouseId: fixtureId('warehouse:central'),
    });

    const opening = await post<PosShift>(
      application,
      '/api/v1/pos/shifts',
      posToken,
      `open-pos-shift-${runId}`,
      { cashRegisterId: register?.id, openingCashEur: '100.00' },
    );
    const beforeStock = await stockQuantity();
    const catalog = await get<PosCatalogPage>(
      application,
      `/api/v1/pos/catalog?shiftId=${opening.id}&search=DEV-ADAPTER-12V`,
      posToken,
    );
    const product = catalog.items.find((item) => item.productCode === 'DEV-ADAPTER-12V');
    expect(product).toMatchObject({ unitPrice: '25.5646', vatTreatment: 'standard_20' });

    const initialQuickAccess = await get<PosQuickAccess>(
      application,
      `/api/v1/pos/quick-access?shiftId=${opening.id}`,
      posToken,
    );
    expect(initialQuickAccess.items.length).toBeGreaterThan(0);
    const quickAccessKey = `pos-quick-access-${runId}`;
    const quickAccess = await put<PosQuickAccess>(
      application,
      '/api/v1/pos/quick-access',
      posToken,
      quickAccessKey,
      { productIds: [product?.id], shiftId: opening.id },
    );
    expect(quickAccess.productIds).toEqual([product?.id]);
    expect(
      (
        await put<PosQuickAccess>(
          application,
          '/api/v1/pos/quick-access',
          posToken,
          quickAccessKey,
          { productIds: [product?.id], shiftId: opening.id },
        )
      ).productIds,
    ).toEqual([product?.id]);

    const automaticPricing = await post<PosBasketPricing>(
      application,
      '/api/v1/pos/baskets/price',
      posToken,
      `price-automatic-offer-${runId}`,
      {
        lines: [{ productId: product?.id, quantity: '2' }],
        shiftId: opening.id,
      },
    );
    expect(automaticPricing).toMatchObject({
      automaticDiscountTotal: '5.1129',
      baseNetTotal: '51.1292',
      grossTotal: '55.2196',
      netTotal: '46.0163',
      vatTotal: '9.2033',
    });
    expect(automaticPricing.lines[0]?.pricingAdjustments[0]).toMatchObject({
      code: 'DEMO-QTY-ADAPTER',
      label: 'Two adapters save 10%',
      source: 'automatic',
    });

    const salePayload = {
      clientTransactionId: randomUUID(),
      lines: [{ productId: product?.id, quantity: '2' }],
      payments: [
        { amount: '27.6098', method: 'cash', tenderedAmount: '32.7200' },
        { amount: '27.6098', method: 'card' },
      ],
      shiftId: opening.id,
    };
    const saleKey = `split-pos-sale-${runId}`;
    const sale = await post<PosSale>(
      application,
      '/api/v1/pos/sales',
      posToken,
      saleKey,
      salePayload,
    );
    expect(sale).toMatchObject({
      automaticDiscountTotal: '5.1129',
      baseNetTotal: '51.1292',
      cashTendered: '32.7200',
      changeAmount: '5.1102',
      fiscalStatus: 'simulated',
      grossTotal: '55.2196',
      status: 'completed',
    });
    expect(sale.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount: '27.6098',
          method: 'cash',
          refundableAmount: '27.6098',
          status: 'completed',
        }),
        expect.objectContaining({
          amount: '27.6098',
          method: 'card',
          refundableAmount: '27.6098',
          status: 'simulated',
        }),
      ]),
    );
    const replayedSale = await post<PosSale>(
      application,
      '/api/v1/pos/sales',
      posToken,
      saleKey,
      salePayload,
    );
    expect(replayedSale.id).toBe(sale.id);
    const lookupPath = `/api/v1/pos/sales/by-transaction/${salePayload.clientTransactionId}`;
    expect((await get<PosSale>(application, lookupPath, posToken)).id).toBe(sale.id);
    await request(application.getHttpServer()).get(lookupPath).expect(401);
    await request(application.getHttpServer())
      .get(lookupPath)
      .set('Authorization', `Bearer ${managerToken}`)
      // A view-only manager cannot recover another operator's client transaction.
      // The endpoint deliberately hides records outside the authenticated operator.
      .expect(404);
    await request(application.getHttpServer())
      .get('/api/v1/pos/sales/by-transaction/not-a-uuid')
      .set('Authorization', `Bearer ${posToken}`)
      .expect(400);
    await request(application.getHttpServer())
      .get(`/api/v1/pos/sales/by-transaction/${randomUUID()}`)
      .set('Authorization', `Bearer ${posToken}`)
      .expect(404);
    expect(await stockQuantity()).toBe(beforeStock - 2);

    const saleLine = sale.lines[0];
    const cashPayment = sale.payments.find((payment) => payment.method === 'cash');
    const cardPayment = sale.payments.find((payment) => payment.method === 'card');
    const firstReturnPayload = {
      lines: [
        {
          disposition: 'restock',
          originalSaleLineId: saleLine?.id,
          quantity: '1',
        },
      ],
      originalSaleId: sale.id,
      reason: 'Customer changed their order',
      refunds: [
        { amount: '13.8048', method: 'cash', originalPaymentId: cashPayment?.id },
        { amount: '13.8049', method: 'card', originalPaymentId: cardPayment?.id },
      ],
      shiftId: opening.id,
    };
    const firstReturnKey = `first-pos-return-${runId}`;
    const firstReturn = await post<PosReturn>(
      application,
      '/api/v1/pos/returns',
      posToken,
      firstReturnKey,
      firstReturnPayload,
    );
    expect(firstReturn).toMatchObject({
      grossTotal: '27.6097',
      originalSaleId: sale.id,
    });
    expect(firstReturn.refunds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: '13.8048', method: 'cash', status: 'completed' }),
        expect.objectContaining({ amount: '13.8049', method: 'card', status: 'simulated' }),
      ]),
    );
    const replayedReturn = await post<PosReturn>(
      application,
      '/api/v1/pos/returns',
      posToken,
      firstReturnKey,
      firstReturnPayload,
    );
    expect(replayedReturn.id).toBe(firstReturn.id);
    expect(await stockQuantity()).toBe(beforeStock - 1);

    const secondReturn = await post<PosReturn>(
      application,
      '/api/v1/pos/returns',
      posToken,
      `second-pos-return-${runId}`,
      {
        ...firstReturnPayload,
        refunds: [
          { amount: '13.8050', method: 'cash', originalPaymentId: cashPayment?.id },
          { amount: '13.8049', method: 'card', originalPaymentId: cardPayment?.id },
        ],
      },
    );
    expect(secondReturn.grossTotal).toBe('27.6099');
    expect(secondReturn.id).not.toBe(firstReturn.id);
    expect(await stockQuantity()).toBe(beforeStock);

    const customers = await get<PosCustomerOption[]>(
      application,
      '/api/v1/pos/customers?search=Alfa%20Market',
      posToken,
    );
    const loyaltyCustomer = customers.find((item) => item.id === fixtureId('partner:alfa'));
    expect(loyaltyCustomer?.loyalty).toMatchObject({
      balance: 300,
      cardNumber: 'VISTA-DEMO-ALFA',
      programName: 'Vista Rewards',
      status: 'active',
    });
    const discountAuthorization = await post<PosDiscountAuthorization>(
      application,
      '/api/v1/pos/discount-authorizations',
      posToken,
      `authorize-pos-discount-${runId}`,
      {
        approverEmail: 'manager@vista.local',
        approverPassword: password,
        customerPartnerId: fixtureId('partner:alfa'),
        discountType: 'fixed_amount',
        discountValue: '5.00',
        lines: [{ productId: product?.id, quantity: '1' }],
        reason: 'Customer care adjustment',
        shiftId: opening.id,
      },
    );
    expect(discountAuthorization).toMatchObject({
      approverName: 'Vista Demo Manager',
      discountType: 'fixed_amount',
      discountValue: '5.0000',
      reason: 'Customer care adjustment',
    });
    const commercialPricing = await post<PosBasketPricing>(
      application,
      '/api/v1/pos/baskets/price',
      posToken,
      `price-approved-discount-${runId}`,
      {
        customerPartnerId: fixtureId('partner:alfa'),
        lines: [{ productId: product?.id, quantity: '1' }],
        loyaltyPointsToRedeem: 100,
        manualDiscount: {
          authorizationId: discountAuthorization.id,
          discountType: 'fixed_amount',
          discountValue: '5.00',
        },
        shiftId: opening.id,
      },
    );
    expect(commercialPricing).toMatchObject({
      baseNetTotal: '25.5646',
      grossTotal: '24.0655',
      loyaltyBalance: 300,
      loyaltyDiscountTotal: '0.5100',
      loyaltyPointsRedeemed: 100,
      manualDiscountTotal: '5.0000',
      netTotal: '20.0546',
      vatTotal: '4.0109',
    });
    const commercialSale = await post<PosSale>(
      application,
      '/api/v1/pos/sales',
      posToken,
      `commercial-pos-sale-${runId}`,
      {
        clientTransactionId: randomUUID(),
        customerLocationId: fixtureId('customer-location:alfa-store'),
        customerPartnerId: fixtureId('partner:alfa'),
        lines: [{ productId: product?.id, quantity: '1' }],
        loyaltyPointsToRedeem: 100,
        manualDiscount: {
          authorizationId: discountAuthorization.id,
          discountType: 'fixed_amount',
          discountValue: '5.00',
        },
        payments: [{ amount: '24.0655', method: 'cash', tenderedAmount: '24.0655' }],
        shiftId: opening.id,
      },
    );
    expect(commercialSale).toMatchObject({
      grossTotal: '24.0655',
      loyaltyDiscountTotal: '0.5100',
      loyaltyPointsEarned: 48,
      loyaltyPointsRedeemed: 100,
      manualDiscountTotal: '5.0000',
    });
    await post<PosSale>(application, '/api/v1/pos/sales', posToken, `reuse-pos-discount-${runId}`, {
      ...salePayload,
      clientTransactionId: randomUUID(),
      lines: [{ productId: product?.id, quantity: '1' }],
      manualDiscount: {
        authorizationId: discountAuthorization.id,
        discountType: 'fixed_amount',
        discountValue: '5.00',
      },
    }).then(
      () => {
        throw new Error('A consumed discount authorization was accepted');
      },
      (error: unknown) => expect(String(error)).toContain('409'),
    );
    const ledgerAfterSale = await get<PosLoyaltyLedger>(
      application,
      `/api/v1/pos/loyalty/customers/${fixtureId('partner:alfa')}`,
      posToken,
    );
    expect(ledgerAfterSale.account.balance).toBe(248);
    expect(ledgerAfterSale.entries.map((entry) => entry.entryType)).toEqual(
      expect.arrayContaining(['adjustment', 'earned', 'redeemed']),
    );
    const commercialReturn = await post<PosReturn>(
      application,
      '/api/v1/pos/returns',
      posToken,
      `commercial-pos-return-${runId}`,
      {
        lines: [
          {
            disposition: 'restock',
            originalSaleLineId: commercialSale.lines[0]?.id,
            quantity: '1',
          },
        ],
        originalSaleId: commercialSale.id,
        reason: 'Customer cancelled the discounted purchase',
        refunds: [
          {
            amount: '24.0655',
            method: 'cash',
            originalPaymentId: commercialSale.payments[0]?.id,
          },
        ],
        shiftId: opening.id,
      },
    );
    expect(commercialReturn).toMatchObject({
      grossTotal: '24.0655',
      loyaltyPointsEarnedReversed: 48,
      loyaltyPointsRedeemedRestored: 100,
    });
    const ledgerAfterReturn = await get<PosLoyaltyLedger>(
      application,
      `/api/v1/pos/loyalty/customers/${fixtureId('partner:alfa')}`,
      posToken,
    );
    expect(ledgerAfterReturn.account.balance).toBe(300);
    expect(ledgerAfterReturn.entries.map((entry) => entry.entryType)).toEqual(
      expect.arrayContaining(['earned_reversed', 'redemption_restored']),
    );
    await expect(
      database.query(
        `UPDATE pos.loyalty_points_ledger SET points = points + 1
         WHERE loyalty_account_id = $1`,
        [ledgerAfterReturn.account.id],
      ),
    ).rejects.toThrow('Loyalty ledger entries are append-only');

    const customerId = fixtureId('partner:alfa');
    const accounts = await get<CustomerPaymentAccount[]>(
      application,
      '/api/v1/finance/customer-accounts',
      managerToken,
    );
    const initialAccount = accounts.find((account) => account.customerPartnerId === customerId);
    expect(initialAccount).toMatchObject({
      advanceBalance: '40.9034',
      availableCredit: '1022.5838',
      outstandingBalance: '0.0000',
    });
    const creditAccount = await put<CustomerPaymentAccount>(
      application,
      `/api/v1/finance/customer-accounts/${customerId}/terms`,
      managerToken,
      `set-customer-credit-${runId}`,
      {
        creditLimitEur: '50.00',
        expectedVersion: initialAccount?.terms?.version,
        onAccountEnabled: true,
        paymentTermsDays: 14,
        status: 'active',
        validFrom: '2026-01-01',
        validTo: '2030-12-31',
      },
    );
    expect(creditAccount).toMatchObject({
      availableCredit: '50.0000',
      terms: { creditLimitEur: '50.0000', paymentTermsDays: 14, version: 2 },
    });

    const accountSalePayload = () => ({
      clientTransactionId: randomUUID(),
      customerLocationId: fixtureId('customer-location:alfa-store'),
      customerPartnerId: customerId,
      lines: [{ productId: product?.id, quantity: '1' }],
      payments: [{ amount: '30.6775', method: 'on_account' }],
      shiftId: opening.id,
    });
    const concurrentSales = await Promise.allSettled([
      post<PosSale>(
        application,
        '/api/v1/pos/sales',
        posToken,
        `account-sale-a-${runId}`,
        accountSalePayload(),
      ),
      post<PosSale>(
        application,
        '/api/v1/pos/sales',
        posToken,
        `account-sale-b-${runId}`,
        accountSalePayload(),
      ),
    ]);
    const acceptedAccountSales = concurrentSales.filter(
      (result): result is PromiseFulfilledResult<PosSale> => result.status === 'fulfilled',
    );
    expect(acceptedAccountSales).toHaveLength(1);
    expect(concurrentSales.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const accountSale = acceptedAccountSales[0]!.value;
    const accountPayment = accountSale.payments.find((payment) => payment.method === 'on_account');
    expect(accountPayment).toMatchObject({
      adapter: 'customer-account',
      amount: '30.6775',
    });
    expect(accountPayment?.accountDueOn).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    const optionsWithBalance = await get<PosCustomerPaymentOptions>(
      application,
      `/api/v1/pos/customers/${customerId}/payment-options`,
      posToken,
    );
    expect(optionsWithBalance).toMatchObject({
      availableCredit: '19.3225',
      onAccountAvailable: true,
      outstandingBalance: '30.6775',
      paymentTermsDays: 14,
    });
    await post<PosReturn>(application, '/api/v1/pos/returns', posToken, `account-return-${runId}`, {
      lines: [
        {
          disposition: 'restock',
          originalSaleLineId: accountSale.lines[0]?.id,
          quantity: '1',
        },
      ],
      originalSaleId: accountSale.id,
      reason: 'Customer cancelled the account purchase',
      refunds: [
        {
          amount: '30.6775',
          method: 'on_account',
          originalPaymentId: accountPayment?.id,
        },
      ],
      shiftId: opening.id,
    });

    const recordedAdvance = await post<CustomerAdvance>(
      application,
      '/api/v1/finance/customer-accounts/advances',
      managerToken,
      `record-customer-advance-${runId}`,
      {
        amount: '15.3388',
        customerPartnerId: customerId,
        paymentMethod: 'bank_transfer',
        paymentReference: `TEST-ADV-${runId.slice(0, 8)}`,
        receivedOn: '2026-09-04',
      },
    );
    expect(recordedAdvance).toMatchObject({
      amount: '15.3388',
      availableAmount: '15.3388',
    });
    expect(recordedAdvance.number).toMatch(/^ADV-\d{4}-/u);
    const customerSale = await post<PosSale>(
      application,
      '/api/v1/pos/sales',
      posToken,
      `customer-payment-sale-${runId}`,
      {
        clientTransactionId: randomUUID(),
        customerLocationId: fixtureId('customer-location:alfa-store'),
        customerPartnerId: customerId,
        lines: [{ productId: product?.id, quantity: '1' }],
        payments: [
          { advanceId: recordedAdvance.id, amount: '15.3388', method: 'advance' },
          { amount: '15.3387', method: 'on_account' },
        ],
        shiftId: opening.id,
      },
    );
    const advancePayment = customerSale.payments.find((payment) => payment.method === 'advance');
    const remainderPayment = customerSale.payments.find(
      (payment) => payment.method === 'on_account',
    );
    expect(customerSale.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          advanceId: recordedAdvance.id,
          advanceNumber: recordedAdvance.number,
          amount: '15.3388',
          method: 'advance',
        }),
        expect.objectContaining({ amount: '15.3387', method: 'on_account' }),
      ]),
    );
    await post<PosReturn>(
      application,
      '/api/v1/pos/returns',
      posToken,
      `customer-payment-return-${runId}`,
      {
        lines: [
          {
            disposition: 'restock',
            originalSaleLineId: customerSale.lines[0]?.id,
            quantity: '1',
          },
        ],
        originalSaleId: customerSale.id,
        reason: 'Customer returned the advance purchase',
        refunds: [
          {
            amount: '15.3388',
            method: 'advance',
            originalPaymentId: advancePayment?.id,
          },
          {
            amount: '15.3387',
            method: 'on_account',
            originalPaymentId: remainderPayment?.id,
          },
        ],
        shiftId: opening.id,
      },
    );
    const restoredAccount = await get<CustomerPaymentAccount>(
      application,
      `/api/v1/finance/customer-accounts/${customerId}`,
      managerToken,
    );
    expect(restoredAccount).toMatchObject({
      advanceBalance: '56.2422',
      availableCredit: '50.0000',
      outstandingBalance: '0.0000',
    });
    expect(restoredAccount.entries.map((entry) => entry.entryType)).toEqual(
      expect.arrayContaining(['charge', 'return_credit']),
    );
    await expect(
      database.query(
        `UPDATE finance.customer_advance_entries SET amount = amount + 1
         WHERE advance_id = $1`,
        [recordedAdvance.id],
      ),
    ).rejects.toThrow('Customer account and advance ledger entries are append-only');
    await expect(
      database.query(`DELETE FROM finance.customer_account_entries WHERE pos_sale_id = $1`, [
        customerSale.id,
      ]),
    ).rejects.toThrow('Customer account and advance ledger entries are append-only');

    const serialCatalog = await get<PosCatalogPage>(
      application,
      `/api/v1/pos/catalog?shiftId=${opening.id}&search=DEV-FISCAL-X1`,
      posToken,
    );
    const serialProduct = serialCatalog.items.find((item) => item.productCode === 'DEV-FISCAL-X1');
    const serialNumber = serialProduct?.serialNumbers[0];
    expect(serialProduct).toMatchObject({
      trackingMode: 'serial',
      unitPrice: '306.7751',
      vatTreatment: 'standard_20',
    });
    expect(serialNumber).toBeTruthy();
    const serialSale = await post<PosSale>(
      application,
      '/api/v1/pos/sales',
      posToken,
      `serial-pos-sale-${runId}`,
      {
        clientTransactionId: randomUUID(),
        customerLocationId: fixtureId('customer-location:alfa-store'),
        customerPartnerId: fixtureId('partner:alfa'),
        lines: [
          {
            productId: serialProduct?.id,
            quantity: '1',
            serialNumbers: [serialNumber],
          },
        ],
        payments: [{ amount: '368.1301', method: 'card' }],
        shiftId: opening.id,
      },
    );
    expect(serialSale).toMatchObject({
      customerName: 'Alfa Market Demo Ltd.',
      grossTotal: '368.1301',
    });
    expect(serialSale.lines[0]?.serialNumbers).toEqual([serialNumber]);
    expect(serialSale.warrantyCards).toEqual([
      expect.objectContaining({
        customerName: 'Alfa Market Demo Ltd.',
        productName: 'Demo Fiscal Register X1',
        serialNumber,
      }),
    ]);

    const [invoice, concurrentInvoice] = await Promise.all([
      post<FinancialDocument>(
        application,
        `/api/v1/pos/sales/${serialSale.id}/invoice-draft`,
        posToken,
        `pos-receipt-invoice-a-${runId}`,
        {},
      ),
      post<FinancialDocument>(
        application,
        `/api/v1/pos/sales/${serialSale.id}/invoice-draft`,
        posToken,
        `pos-receipt-invoice-b-${runId}`,
        {},
      ),
    ]);
    expect(concurrentInvoice.id).toBe(invoice.id);
    expect(invoice).toMatchObject({
      eurGrossTotal: '368.1301',
      customerPartnerId: fixtureId('partner:alfa'),
      documentType: 'invoice',
      grossTotal: '368.1301',
      sourceFiscalReceiptNumber: serialSale.fiscalReceiptNumber,
      sourcePosSaleId: serialSale.id,
      sourcePosSaleNumber: serialSale.saleNumber,
      status: 'draft',
    });
    expect(invoice.lines[0]).toMatchObject({
      grossTotal: '368.1301',
      productId: serialProduct?.id,
      quantity: '1.0000',
      unitCode: 'PCS',
      vatAmount: '61.3550',
    });
    const card = serialSale.warrantyCards[0];
    const warrantyPdf = await request(application.getHttpServer())
      .get(`/api/v1/pos/sales/${serialSale.id}/warranty-cards/${card?.id}/pdf`)
      .set('authorization', `Bearer ${posToken}`)
      .expect(200)
      .expect('content-type', /application\/pdf/u);
    expect(
      Buffer.from(warrantyPdf.body as Uint8Array)
        .subarray(0, 5)
        .toString('ascii'),
    ).toBe('%PDF-');

    const serviceReturn = await post<PosReturn>(
      application,
      '/api/v1/pos/returns',
      posToken,
      `service-pos-return-${runId}`,
      {
        lines: [
          {
            disposition: 'service',
            originalSaleLineId: serialSale.lines[0]?.id,
            quantity: '1',
            serialNumbers: [serialNumber],
          },
        ],
        originalSaleId: serialSale.id,
        reason: 'Device requires inspection',
        refunds: [
          {
            amount: '368.1301',
            method: 'card',
            originalPaymentId: serialSale.payments[0]?.id,
          },
        ],
        shiftId: opening.id,
      },
    );
    expect(serviceReturn.lines[0]).toMatchObject({
      destinationWarehouseId: fixtureId('warehouse:service'),
      disposition: 'service',
      serialNumbers: [serialNumber],
    });
    const serialState = await database.query<{
      active: boolean;
      equipment_status: string;
      item_status: string;
      warehouse_id: string;
    }>(
      `SELECT item.status AS item_status, item.warehouse_id,
         equipment.status AS equipment_status, equipment.active
       FROM inventory.serialized_items item
       JOIN master_data.customer_equipment equipment
         ON equipment.serialized_item_id = item.id AND equipment.active
       WHERE item.serial_number = $1`,
      [serialNumber],
    );
    expect(serialState.rows).toEqual([
      {
        active: true,
        equipment_status: 'under_repair',
        item_status: 'available',
        warehouse_id: fixtureId('warehouse:service'),
      },
    ]);
    if (!serialNumber) throw new Error('The test sale must have a serial number');
    const trace = await get<SerialTraceability>(
      application,
      `/api/v1/warehouse/serial-traceability/${encodeURIComponent(serialNumber)}`,
      managerToken,
    );
    expect(trace.currentCustody.type).toBe('service');
    expect(trace.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'sale',
          referenceType: 'POS sale',
          referenceId: serialSale.saleNumber,
        }),
        expect.objectContaining({
          eventType: 'return_received',
          referenceType: 'POS return',
          referenceId: serviceReturn.returnNumber,
        }),
      ]),
    );
    expect(
      trace.events.find((event) => event.referenceId === serviceReturn.returnNumber)?.details,
    ).toEqual(
      expect.arrayContaining([
        { label: 'Original POS sale', value: serialSale.saleNumber },
        { label: 'Reversal', value: serviceReturn.fiscalReversalNumber },
      ]),
    );

    const sales = await get<PosSalePage>(application, '/api/v1/pos/sales', posToken);
    const completedSale = sales.items.find((item) => item.id === sale.id);
    expect(completedSale).toMatchObject({ fiscalStatus: 'reversed', status: 'returned' });
    expect(completedSale?.lines[0]).toMatchObject({
      returnableQuantity: '0.0000',
      returnedQuantity: '2.0000',
    });
    expect(completedSale?.payments.map((payment) => payment.refundableAmount)).toEqual([
      '0.0000',
      '0.0000',
    ]);
    expect(sales.items.find((item) => item.id === serialSale.id)?.invoiceDocument).toMatchObject({
      id: invoice.id,
      sourceFiscalReceiptNumber: serialSale.fiscalReceiptNumber,
    });

    const returns = await get<PosReturnPage>(application, '/api/v1/pos/returns', posToken);
    expect(returns.items.filter((item) => item.originalSaleId === sale.id)).toHaveLength(2);
    const refreshedTerminal = await get<PosTerminalContext>(
      application,
      '/api/v1/pos/terminal-context',
      posToken,
    );
    expect(refreshedTerminal.currentShift?.expectedCashEur).toBe('100.0000');

    const evidence = await database.query<{
      audit_count: string;
      fiscal_count: string;
      outbox_count: string;
      return_count: string;
      sale_count: string;
    }>(
      `SELECT
         (SELECT count(*) FROM audit.events WHERE target_id IN ($1, $2, $3))::text AS audit_count,
         (SELECT count(*) FROM pos.fiscal_operations WHERE sale_id = $1)::text AS fiscal_count,
         (SELECT count(*) FROM integration.outbox_events
           WHERE aggregate_id IN ($1, $2, $3))::text AS outbox_count,
         (SELECT count(*) FROM pos.returns WHERE original_sale_id = $1)::text AS return_count,
         (SELECT count(*) FROM pos.sales WHERE id = $1)::text AS sale_count`,
      [sale.id, firstReturn.id, secondReturn.id],
    );
    expect(evidence.rows[0]).toEqual({
      audit_count: '3',
      fiscal_count: '3',
      outbox_count: '3',
      return_count: '2',
      sale_count: '1',
    });

    const overview = await get<PosReportOverview>(
      application,
      '/api/v1/pos/reports/overview?dateFrom=2026-01-01&dateTo=2026-12-31',
      posToken,
    );
    expect(overview.totals).toMatchObject({
      grossReturnsEur: '508.7702',
      grossSalesEur: '508.7702',
      netRevenueEur: '0.0000',
      returnCount: 6,
      saleCount: 5,
    });
    expect(overview.products.find((item) => item.productCode === 'DEV-ADAPTER-12V')).toMatchObject({
      grossReturnsEur: '140.6401',
      grossSalesEur: '140.6401',
      netRevenueEur: '0.0000',
      quantityReturned: '5.0000',
      quantitySold: '5.0000',
    });
    expect(overview.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'cash', netEur: '0.0000' }),
        expect.objectContaining({ method: 'card', netEur: '0.0000' }),
        expect.objectContaining({ method: 'advance', netEur: '0.0000' }),
        expect.objectContaining({ method: 'on_account', netEur: '0.0000' }),
      ]),
    );
    const definitions = await get<PosReportDefinition[]>(
      application,
      '/api/v1/pos/report-exports/definitions',
      posToken,
    );
    expect(definitions).toHaveLength(9);
    expect(definitions.find((item) => item.key === 'pos.x-report')).toMatchObject({
      requiresDateRange: false,
      requiresShift: true,
    });
    const managerOverview = await get<PosReportOverview>(
      application,
      '/api/v1/pos/reports/overview?dateFrom=2026-01-01&dateTo=2026-12-31',
      managerToken,
    );
    expect(managerOverview.totals).toEqual(overview.totals);
    const managerDefinitions = await get<PosReportDefinition[]>(
      application,
      '/api/v1/pos/report-exports/definitions',
      managerToken,
    );
    expect(managerDefinitions.map((item) => item.key)).toEqual(
      expect.arrayContaining(['pos.x-report', 'pos.z-report', 'pos.location-comparison']),
    );
    const reports = application.get(PosReportsService);
    const xReport = await reports.exportData('pos.x-report', {
      asOf: new Date().toISOString(),
      shiftId: opening.id,
    });
    expect(xReport.rows[0]).toMatchObject({
      reportType: 'X',
      shiftNumber: opening.shiftNumber,
    });

    const closed = await post<PosShift>(
      application,
      `/api/v1/pos/shifts/${opening.id}/close`,
      posToken,
      `close-pos-shift-${runId}`,
      { closingCashEur: '100.00', version: opening.version },
    );
    expect(closed).toMatchObject({ closingCashEur: '100.0000', status: 'closed' });
    expect((await get<PosSale>(application, lookupPath, posToken)).id).toBe(sale.id);
    const zReport = await reports.exportData('pos.z-report', { shiftId: opening.id });
    expect(zReport.rows[0]).toMatchObject({
      closingCashEur: '100.0000',
      differenceEur: '0.0000',
      reportType: 'Z',
    });
  }, 20_000);

  it('reconciles POS invoice payments, deferred credit and refunds without duplicating money or collections', async () => {
    const customerId = fixtureId('partner:alfa');
    const terminal = await get<PosTerminalContext>(
      application,
      '/api/v1/pos/terminal-context',
      posToken,
    );
    const shift = await post<PosShift>(application, '/api/v1/pos/shifts', posToken, randomUUID(), {
      cashRegisterId: terminal.registers[0]!.id,
      openingCashEur: '100',
    });
    const createSale = (payments: object[]) =>
      post<PosSale>(application, '/api/v1/pos/sales', posToken, randomUUID(), {
        clientTransactionId: randomUUID(),
        shiftId: shift.id,
        customerPartnerId: customerId,
        lines: [{ productId: fixtureId('catalog:product:adapter'), quantity: '1' }],
        payments,
      });
    const prepare = (sale: PosSale) =>
      post<FinancialDocument>(
        application,
        `/api/v1/pos/sales/${sale.id}/invoice-draft`,
        posToken,
        randomUUID(),
        {},
      );
    const read = (id: string) =>
      get<FinancialDocument>(
        application,
        `/api/v1/finance/financial-documents/${id}`,
        managerToken,
      );
    const issue = (document: FinancialDocument, key = randomUUID()) =>
      request(application.getHttpServer())
        .post(`/api/v1/finance/financial-documents/${document.id}/issue`)
        .set('authorization', `Bearer ${managerToken}`)
        .set('idempotency-key', key)
        .send({ expectedVersion: document.version });
    const evidence = () =>
      database.query<{ payments: number; collections: number; stock: number }>(
        `SELECT (SELECT count(*)::int FROM finance.payments) AS payments,(SELECT count(*)::int FROM finance.customer_documents) AS collections,(SELECT count(*)::int FROM inventory.stock_movements) AS stock`,
      );
    const cash = await createSale([{ method: 'cash', amount: '30.6775', tenderedAmount: '50' }]);
    const draft = await prepare(cash);
    expect(draft.posSettlement).toMatchObject({
      originalTotal: '30.6775',
      paidAtCheckout: '30.6775',
      deferredAtCheckout: '0.0000',
      outstandingTotal: '0.0000',
      status: 'paid',
      returnState: 'none',
    });
    const before = (await evidence()).rows;
    await database.query(
      'UPDATE pos.payments SET amount=amount+1,tendered_amount=tendered_amount+1 WHERE sale_id=$1',
      [cash.id],
    );
    try {
      expect((await read(draft.id)).posSettlement?.status).toBe('needs_review');
      const conflict = await issue(draft).expect(409);
      expect(conflict.body.error.code).toBe('FINANCE_POS_SETTLEMENT_NEEDS_REVIEW');
      expect((await read(draft.id)).status).toBe('draft');
    } finally {
      await database.query(
        'UPDATE pos.payments SET amount=amount-1,tendered_amount=tendered_amount-1 WHERE sale_id=$1',
        [cash.id],
      );
    }
    await request(application.getHttpServer())
      .post(`/api/v1/finance/financial-documents/${draft.id}/issue`)
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', randomUUID())
      .send({ expectedVersion: draft.version })
      .expect(403);
    const issued = (await issue(draft).expect(200)).body as FinancialDocument;
    expect(issued.posSettlement?.status).toBe('paid');
    expect(issued).not.toHaveProperty('collection');
    await issue(issued).expect(200);
    expect((await prepare(cash)).id).toBe(issued.id);
    expect((await evidence()).rows).toEqual(before);
    await request(application.getHttpServer())
      .post(`/api/v1/finance/financial-documents/${issued.id}/collection`)
      .set('authorization', `Bearer ${managerToken}`)
      .set('idempotency-key', randomUUID())
      .send({ expectedVersion: issued.version })
      .expect(400);
    const refreshed = (
      await get<PosSalePage>(application, '/api/v1/pos/sales', posToken)
    ).items.find((sale) => sale.id === cash.id)!;
    expect(refreshed.invoiceDocument).toMatchObject({
      id: issued.id,
      number: issued.officialNumber,
      status: 'issued',
    });
    const returned = await post<PosReturn>(
      application,
      '/api/v1/pos/returns',
      posToken,
      randomUUID(),
      {
        originalSaleId: cash.id,
        shiftId: shift.id,
        reason: 'Returned for settlement verification',
        refunds: [{ originalPaymentId: cash.payments[0]!.id, method: 'cash', amount: '15.3387' }],
        lines: [{ originalSaleLineId: cash.lines[0]!.id, quantity: '0.5', disposition: 'restock' }],
      },
    );
    const partial = await read(issued.id);
    expect(partial.posSettlement).toMatchObject({
      refundedTotal: returned.grossTotal,
      returnState: 'partial',
      status: 'paid',
      returnCount: 1,
      outstandingTotal: '0.0000',
    });
    expect(partial.posSettlement!.returns[0]).toMatchObject({
      id: returned.id,
      number: returned.returnNumber,
      amount: returned.grossTotal,
    });
    expect(partial.grossTotal).toBe(issued.grossTotal);
    expect(partial.version).toBe(issued.version);

    const splitSale = await createSale([
      { method: 'cash', amount: '15.3387', tenderedAmount: '20' },
      { method: 'card', amount: '15.3388' },
    ]);
    const splitDraft = await prepare(splitSale);
    const splitInvoice = (await issue(splitDraft).expect(200)).body as FinancialDocument;
    expect(splitInvoice.posSettlement).toMatchObject({
      status: 'paid',
      paidAtCheckout: '30.6775',
      outstandingTotal: '0.0000',
    });
    expect(splitInvoice.posSettlement?.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'cash', amount: '15.3387' }),
        expect.objectContaining({ method: 'card', amount: '15.3388' }),
      ]),
    );
    await post<PosReturn>(application, '/api/v1/pos/returns', posToken, randomUUID(), {
      originalSaleId: splitSale.id,
      shiftId: shift.id,
      reason: 'Return split checkout through the original payment methods',
      refunds: splitSale.payments.map((payment) => ({
        originalPaymentId: payment.id,
        method: payment.method,
        amount: payment.amount,
      })),
      lines: [
        { originalSaleLineId: splitSale.lines[0]!.id, quantity: '1', disposition: 'restock' },
      ],
    });
    const splitRefunded = (await read(splitInvoice.id)).posSettlement;
    expect(splitRefunded).toMatchObject({
      status: 'paid',
      returnState: 'full',
      refundedTotal: '30.6775',
      netPaidTotal: '0.0000',
    });
    expect(splitRefunded?.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'cash', refundedAmount: '15.3387' }),
        expect.objectContaining({ method: 'card', refundedAmount: '15.3388' }),
      ]),
    );

    const advance = await post<CustomerAdvance>(
      application,
      '/api/v1/finance/customer-accounts/advances',
      managerToken,
      randomUUID(),
      {
        amount: '15.3388',
        customerPartnerId: customerId,
        paymentMethod: 'bank_transfer',
        receivedOn: new Date().toISOString().slice(0, 10),
      },
    );
    const creditSale = await createSale([
      { method: 'advance', advanceId: advance.id, amount: '15.3388' },
      { method: 'on_account', amount: '15.3387' },
    ]);
    const creditDraft = await prepare(creditSale);
    const creditInvoice = (await issue(creditDraft).expect(200)).body as FinancialDocument;
    expect(creditInvoice.posSettlement).toMatchObject({
      paidAtCheckout: '15.3388',
      deferredAtCheckout: '15.3387',
      outstandingTotal: '15.3387',
      status: 'partially_paid',
    });
    expect(creditInvoice).not.toHaveProperty('collection');
    const accountBefore = await get<CustomerPaymentAccount>(
      application,
      `/api/v1/finance/customer-accounts/${customerId}`,
      managerToken,
    );
    expect(accountBefore.outstandingBalance).toBe('15.3387');
    await post<PosReturn>(application, '/api/v1/pos/returns', posToken, randomUUID(), {
      originalSaleId: creditSale.id,
      shiftId: shift.id,
      reason: 'Returned deferred and advance purchase',
      refunds: creditSale.payments.map((payment) => ({
        originalPaymentId: payment.id,
        method: payment.method,
        amount: payment.amount,
      })),
      lines: [
        { originalSaleLineId: creditSale.lines[0]!.id, quantity: '1', disposition: 'restock' },
      ],
    });
    const refunded = await read(creditInvoice.id);
    expect(refunded.posSettlement).toMatchObject({
      originalTotal: '30.6775',
      refundedTotal: '15.3388',
      deferredReleased: '15.3387',
      netPaidTotal: '0.0000',
      outstandingTotal: '0.0000',
      netSaleTotal: '0.0000',
      returnState: 'full',
      status: 'paid',
    });
    expect(refunded.grossTotal).toBe('30.6775');
    expect(
      (
        await get<CustomerPaymentAccount>(
          application,
          `/api/v1/finance/customer-accounts/${customerId}`,
          managerToken,
        )
      ).outstandingBalance,
    ).toBe('0.0000');
    expect(
      (
        await get<FinancialDocument>(
          application,
          `/api/v1/finance/financial-documents/${creditInvoice.id}`,
          viewerToken,
        )
      ).posSettlement,
    ).toEqual(refunded.posSettlement);
    const unpaidSale = await createSale([{ method: 'on_account', amount: '30.6775' }]);
    const unpaidDraft = await prepare(unpaidSale);
    const [unpaidIssued, reopened] = await Promise.all([
      issue(unpaidDraft).expect(200),
      prepare(unpaidSale),
    ]);
    expect(reopened.id).toBe(unpaidDraft.id);
    expect((unpaidIssued.body as FinancialDocument).posSettlement).toMatchObject({
      paidAtCheckout: '0.0000',
      deferredAtCheckout: '30.6775',
      outstandingTotal: '30.6775',
      status: 'unpaid',
    });
    const client = await database.connect();
    try {
      expect((await loadPosInvoiceSettlement(client, unpaidSale.id, '2099-12-31'))?.status).toBe(
        'overdue',
      );
    } finally {
      client.release();
    }
    await request(application.getHttpServer())
      .get(`/api/v1/finance/financial-documents/${creditInvoice.id}`)
      .set('authorization', `Bearer ${posToken}`)
      .expect(403);
  }, 20000);

  it('collects and reverses deferred POS payments once, then reconciles collected returns and linked repayments', async () => {
    const customerId = fixtureId('partner:alfa');
    const terms = (
      await get<CustomerPaymentAccount>(
        application,
        `/api/v1/finance/customer-accounts/${customerId}`,
        managerToken,
      )
    ).terms!;
    await request(application.getHttpServer())
      .put(`/api/v1/finance/customer-accounts/${customerId}/terms`)
      .set('authorization', `Bearer ${managerToken}`)
      .set('idempotency-key', randomUUID())
      .send({
        creditLimitEur: '1000',
        onAccountEnabled: true,
        paymentTermsDays: terms.paymentTermsDays,
        validFrom: terms.validFrom,
        status: 'active',
        expectedVersion: terms.version,
      })
      .expect(200);
    const terminal = await get<PosTerminalContext>(
      application,
      '/api/v1/pos/terminal-context',
      posToken,
    );
    const shift = terminal.currentShift!;
    const sale = await post<PosSale>(application, '/api/v1/pos/sales', posToken, randomUUID(), {
      clientTransactionId: randomUUID(),
      shiftId: shift.id,
      customerPartnerId: customerId,
      lines: [{ productId: fixtureId('catalog:product:adapter'), quantity: '1' }],
      payments: [{ method: 'on_account', amount: '30.6775' }],
    });
    const invoice = await post<FinancialDocument>(
      application,
      `/api/v1/pos/sales/${sale.id}/invoice-draft`,
      posToken,
      randomUUID(),
      {},
    );
    const path = `/api/v1/finance/customer-accounts/${customerId}/pos-sales/${sale.id}/payments`;
    const paymentDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Sofia',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const requestPayment = (
      key: string,
      amount = '10',
      expected = '30.6775',
      token = managerToken,
    ) =>
      request(application.getHttpServer())
        .post(path)
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', key)
        .send({
          amount,
          expectedOutstanding: expected,
          paymentDate,
          paymentMethod: 'bank_transfer',
          paymentReference: 'POS-COLLECTION-TEST',
        });
    await requestPayment(randomUUID(), '10', '30.6775', viewerToken).expect(403);
    await requestPayment(randomUUID(), '10', '30.6775', posToken).expect(403);
    for (const invalidDate of ['2000-01-01', '9999-12-31']) {
      const invalid = await requestPayment(randomUUID())
        .send({ paymentDate: invalidDate })
        .expect(400);
      expect(invalid.body.error.code).toBe('POS_ACCOUNT_PAYMENT_DATE_INVALID');
    }
    await requestPayment(randomUUID(), '31').expect(409);
    const key = randomUUID();
    const [one, two] = await Promise.all([
      requestPayment(key).expect(201),
      requestPayment(key).expect(201),
    ]);
    expect(one.body).toEqual(two.body);
    let account = one.body as CustomerPaymentAccount;
    let receivable = account.posReceivables!.find((row) => row.saleId === sale.id)!;
    expect(receivable).toMatchObject({
      paidTotal: '10.0000',
      outstandingTotal: '20.6775',
      status: 'partially_paid',
    });
    const payment = receivable.payments[0]!;
    await requestPayment(randomUUID()).expect(409);
    const source = await get<FinancialDocument>(
      application,
      `/api/v1/finance/financial-documents/${invoice.id}`,
      managerToken,
    );
    expect(source.posSettlement).toMatchObject({
      collectedTotal: '10.0000',
      outstandingTotal: '20.6775',
      status: 'partially_paid',
    });
    expect(source.grossTotal).toBe(invoice.grossTotal);
    const returnPayload = {
      originalSaleId: sale.id,
      shiftId: shift.id,
      reason: 'Return the fully collected account purchase',
      lines: [{ originalSaleLineId: sale.lines[0]!.id, quantity: '1', disposition: 'restock' }],
      refunds: [
        { originalPaymentId: sale.payments[0]!.id, method: 'on_account', amount: '30.6775' },
      ],
    };
    const reversePath = `${path}/${payment.id}/reverse`;
    const reverse = (key: string, token = managerToken) =>
      request(application.getHttpServer())
        .post(reversePath)
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', key)
        .send({
          reason: 'Incorrect payment reference recorded during testing',
          expectedOutstanding: '20.6775',
        });
    await reverse(randomUUID(), viewerToken).expect(403);
    await reverse(randomUUID()).expect(403);
    const roleId = randomUUID();
    await database.query(
      `INSERT INTO iam.roles(id,code,name) VALUES($1,$2,'POS collection test approver')`,
      [roleId, `pos-collection-${runId}`],
    );
    const permission = (
      await database.query<{ id: string }>(
        `INSERT INTO iam.permissions(id,module,action) VALUES($1,'erp.finance','approve')
      ON CONFLICT(module,action) DO UPDATE SET module=excluded.module RETURNING id`,
        [randomUUID()],
      )
    ).rows[0]!.id;
    await database.query('INSERT INTO iam.role_permissions(role_id,permission_id) VALUES($1,$2)', [
      roleId,
      permission,
    ]);
    await database.query('INSERT INTO iam.account_roles(account_id,role_id) VALUES($1,$2)', [
      fixtureId('account:manager'),
      roleId,
    ]);
    managerToken = await login(application, 'manager@vista.local');
    const reversalKey = randomUUID();
    account = (await reverse(reversalKey).expect(200)).body as CustomerPaymentAccount;
    await reverse(reversalKey).expect(200);
    receivable = account.posReceivables!.find((row) => row.saleId === sale.id)!;
    expect(receivable).toMatchObject({
      outstandingTotal: '30.6775',
      paidTotal: '0.0000',
      status: 'unpaid',
    });
    expect(receivable.payments[0]!.reversal?.reason).toContain('Incorrect payment');
    const overview = await get<CustomerOperationalOverview>(
      application,
      `/api/v1/master-data/partners/${customerId}/customer-overview`,
      managerToken,
    );
    expect(overview.payments.find((row) => row.id === payment.id)).toMatchObject({
      reversalNumber: receivable.payments[0]!.reversal!.number,
      paymentReference: 'POS-COLLECTION-TEST',
    });
    const expectedOverview = (
      await database.query<{ total: string; count: string }>(
        `SELECT (coalesce(sum(round(outstanding_total*exchange_rate,4)),0)+$2::numeric)::text AS total,
          (count(*) FILTER(WHERE outstanding_total>0)+$3::integer)::text AS count
         FROM finance.customer_documents
         WHERE customer_partner_id=$1 AND review_state='pending_finance_review'`,
        [
          customerId,
          account.outstandingBalance,
          account.posReceivables!.filter((row) => Number(row.outstandingTotal) > 0).length,
        ],
      )
    ).rows[0]!;
    expect(overview.summary.outstandingEur).toBe(expectedOverview.total);
    expect(overview.summary.openReceivables).toBe(Number(expectedOverview.count));
    const concurrent = await Promise.all([
      requestPayment(randomUUID(), '20'),
      requestPayment(randomUUID(), '20'),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([201, 409]);
    account = (await requestPayment(randomUUID(), '10.6775', '10.6775').expect(201))
      .body as CustomerPaymentAccount;
    expect(account.posReceivables!.find((row) => row.saleId === sale.id)).toMatchObject({
      paidTotal: '30.6775',
      outstandingTotal: '0.0000',
      status: 'paid',
    });
    const options = await get<PosCustomerPaymentOptions>(
      application,
      `/api/v1/pos/customers/${customerId}/payment-options`,
      posToken,
    );
    expect(options.outstandingBalance).toBe(account.outstandingBalance);
    const counts = (
      await database.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM finance.customer_documents WHERE financial_document_id=$1',
        [invoice.id],
      )
    ).rows;
    expect(counts[0]?.count).toBe('0');
    await expect(
      database.query(
        `INSERT INTO finance.payments(id,payment_number,customer_partner_id,payment_date,payment_method,
      currency_code,amount,recorded_by,source_pos_sale_id) VALUES($1,$2,$3,CURRENT_DATE,'bank_transfer','EUR',1,$4,$5)`,
        [randomUUID(), `ORPHAN-${runId}`, customerId, fixtureId('account:manager'), sale.id],
      ),
    ).rejects.toThrow('requires its account entry');
    const partialSale = await post<PosSale>(
      application,
      '/api/v1/pos/sales',
      posToken,
      randomUUID(),
      {
        clientTransactionId: randomUUID(),
        shiftId: shift.id,
        customerPartnerId: customerId,
        lines: [{ productId: fixtureId('catalog:product:adapter'), quantity: '1' }],
        payments: [{ method: 'on_account', amount: '30.6775' }],
      },
    );
    const lateInvoiceDraft = await post<FinancialDocument>(
      application,
      `/api/v1/pos/sales/${partialSale.id}/invoice-draft`,
      posToken,
      randomUUID(),
      {},
    );
    await post<CustomerPaymentAccount>(
      application,
      `/api/v1/finance/customer-accounts/${customerId}/pos-sales/${partialSale.id}/payments`,
      managerToken,
      randomUUID(),
      { amount: '10', expectedOutstanding: '30.6775', paymentMethod: 'cash', paymentDate },
    );
    await post<PosReturn>(application, '/api/v1/pos/returns', posToken, randomUUID(), {
      originalSaleId: partialSale.id,
      shiftId: shift.id,
      reason: 'Return only the unpaid portion of the account sale',
      lines: [
        { originalSaleLineId: partialSale.lines[0]!.id, quantity: '0.5', disposition: 'restock' },
      ],
      refunds: [
        { originalPaymentId: partialSale.payments[0]!.id, method: 'on_account', amount: '15.3387' },
      ],
    });
    const partiallyReturned = await get<CustomerPaymentAccount>(
      application,
      `/api/v1/finance/customer-accounts/${customerId}`,
      managerToken,
    );
    expect(
      partiallyReturned.posReceivables!.find((row) => row.saleId === partialSale.id),
    ).toMatchObject({ returnCredit: '15.3387', paidTotal: '10.0000', outstandingTotal: '5.3388' });
    const lateIssue = await request(application.getHttpServer())
      .post(`/api/v1/finance/financial-documents/${lateInvoiceDraft.id}/issue`)
      .set('authorization', `Bearer ${managerToken}`)
      .set('idempotency-key', randomUUID())
      .send({ expectedVersion: lateInvoiceDraft.version })
      .expect(409);
    expect(lateIssue.body.error.code).toBe('FINANCE_POS_INVOICE_AFTER_RETURN');
    await expect(
      database.query("UPDATE finance.financial_documents SET status='issued' WHERE id=$1", [
        lateInvoiceDraft.id,
      ]),
    ).rejects.toThrow('cannot be issued after the sale has been returned');
    await request(application.getHttpServer())
      .post(`/api/v1/finance/financial-documents/${lateInvoiceDraft.id}/cancel`)
      .set('authorization', `Bearer ${managerToken}`)
      .set('idempotency-key', randomUUID())
      .send({
        expectedVersion: lateInvoiceDraft.version,
        cancellationReason: 'Sale returned before invoice issuance',
      })
      .expect(200);

    const issued = (
      await request(application.getHttpServer())
        .post(`/api/v1/finance/financial-documents/${invoice.id}/issue`)
        .set('authorization', `Bearer ${managerToken}`)
        .set('idempotency-key', randomUUID())
        .send({ expectedVersion: invoice.version })
        .expect(200)
    ).body as FinancialDocument;
    const stockBeforeReturn = await stockQuantity(),
      returnKey = randomUUID();
    const completedReturn = await post<PosReturn>(
      application,
      '/api/v1/pos/returns',
      posToken,
      returnKey,
      returnPayload,
    );
    expect(
      (
        await post<PosReturn>(
          application,
          '/api/v1/pos/returns',
          posToken,
          returnKey,
          returnPayload,
        )
      ).id,
    ).toBe(completedReturn.id);
    expect(await stockQuantity()).toBe(stockBeforeReturn + 1);
    const readAccount = () =>
      get<CustomerPaymentAccount>(
        application,
        `/api/v1/finance/customer-accounts/${customerId}`,
        managerToken,
      );
    const saleAccount = (value: CustomerPaymentAccount) =>
      value.posReceivables!.find((item) => item.saleId === sale.id)!;
    const liability = saleAccount(await readAccount()).returnCredits![0]!;
    expect(liability).toMatchObject({
      returnId: completedReturn.id,
      releasedTotal: '0.0000',
      refundDue: '30.6775',
      refundedTotal: '0.0000',
    });
    expect(
      (
        await get<FinancialDocument>(
          application,
          `/api/v1/finance/financial-documents/${issued.id}`,
          managerToken,
        )
      ).posSettlement,
    ).toMatchObject({
      status: 'refund_due',
      refundDue: '30.6775',
      outstandingTotal: '0.0000',
      netSaleTotal: '0.0000',
      netPaidTotal: '30.6775',
    });
    const refundPath = `/api/v1/finance/customer-accounts/${customerId}/pos-sales/${sale.id}/returns/${completedReturn.id}/refunds`;
    await request(application.getHttpServer())
      .post(
        `/api/v1/finance/customer-accounts/not-a-uuid/pos-sales/${sale.id}/returns/${completedReturn.id}/refunds`,
      )
      .set('authorization', `Bearer ${managerToken}`)
      .set('idempotency-key', randomUUID())
      .send({})
      .expect(400);
    const repay = (key: string, amount = '10', expected = '30.6775', token = managerToken) =>
      request(application.getHttpServer())
        .post(refundPath)
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', key)
        .send({
          amount,
          expectedRefundDue: expected,
          refundedOn: paymentDate,
          paymentMethod: 'bank_transfer',
          paymentReference: 'BANK-REPAYMENT-TEST-01',
        });
    await repay(randomUUID(), '10', '30.6775', viewerToken).expect(403);
    await repay(randomUUID(), '10', '30.6775', posToken).expect(403);
    expect((await repay(randomUUID()).expect(409)).body.error.code).toBe(
      'POS_ACCOUNT_REFUND_CREDIT_REQUIRED',
    );
    const noteKey = randomUUID();
    await request(application.getHttpServer())
      .post('/api/v1/finance/financial-documents/from-pos-return/not-a-uuid')
      .set('authorization', `Bearer ${managerToken}`)
      .set('idempotency-key', randomUUID())
      .send({})
      .expect(400);
    const note = await post<FinancialDocument>(
      application,
      `/api/v1/finance/financial-documents/from-pos-return/${completedReturn.id}`,
      managerToken,
      noteKey,
      {},
    );
    const duplicateNote = await post<FinancialDocument>(
      application,
      `/api/v1/finance/financial-documents/from-pos-return/${completedReturn.id}`,
      managerToken,
      randomUUID(),
      {},
    );
    expect(duplicateNote.id).toBe(note.id);
    expect(note).toMatchObject({
      documentType: 'credit_note',
      grossTotal: issued.grossTotal,
      netTotal: issued.netTotal,
      vatTotal: issued.vatTotal,
      sourcePosReturnId: completedReturn.id,
      correctionOf: { id: issued.id },
    });
    await request(application.getHttpServer())
      .post(`/api/v1/finance/financial-documents/${note.id}/issue`)
      .set('authorization', `Bearer ${managerToken}`)
      .set('idempotency-key', randomUUID())
      .send({ expectedVersion: note.version })
      .expect(200);
    // Any failure in payment allocation rolls back the repayment, number, audit and outbox.
    await database.query(`CREATE FUNCTION finance.test_refund_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'Injected refund allocation failure'; END; $$;
      CREATE TRIGGER test_refund_failure BEFORE INSERT ON finance.pos_account_refund_allocations FOR EACH ROW EXECUTE FUNCTION finance.test_refund_failure()`);
    const failedKey = randomUUID();
    try {
      await repay(failedKey).expect(500);
      expect(
        (
          await database.query('SELECT 1 FROM finance.pos_account_refunds WHERE pos_return_id=$1', [
            completedReturn.id,
          ])
        ).rowCount,
      ).toBe(0);
    } finally {
      await database.query(
        'DROP TRIGGER test_refund_failure ON finance.pos_account_refund_allocations;DROP FUNCTION finance.test_refund_failure()',
      );
    }
    const [paidOnce, paidAgain] = await Promise.all([
      repay(failedKey).expect(201),
      repay(failedKey).expect(201),
    ]);
    expect(paidOnce.body).toEqual(paidAgain.body);
    let returnCredit = saleAccount(paidOnce.body as CustomerPaymentAccount).returnCredits![0]!;
    expect(returnCredit).toMatchObject({ refundedTotal: '10.0000', refundDue: '20.6775' });
    expect(returnCredit.refunds).toHaveLength(1);
    expect(returnCredit.refunds[0]!.payments).toHaveLength(1);
    await repay(randomUUID()).expect(409);
    await repay(randomUUID(), '21', '20.6775').expect(409);
    await repay(randomUUID(), '1', '20.6775').send({ refundedOn: '9999-12-31' }).expect(409);
    const finalRepayments = await Promise.all([
      repay(randomUUID(), '20.6775', '20.6775'),
      repay(randomUUID(), '20.6775', '20.6775'),
    ]);
    expect(finalRepayments.map((item) => item.status).sort()).toEqual([201, 409]);
    returnCredit = saleAccount(await readAccount()).returnCredits![0]!;
    expect(returnCredit).toMatchObject({ refundedTotal: '30.6775', refundDue: '0.0000' });
    expect(returnCredit.refunds).toHaveLength(2);
    await expect(
      database.query("UPDATE finance.financial_documents SET status='cancelled' WHERE id=$1", [
        note.id,
      ]),
    ).rejects.toThrow('with recorded repayments cannot be cancelled');
    const settled = await get<FinancialDocument>(
      application,
      `/api/v1/finance/financial-documents/${invoice.id}`,
      managerToken,
    );
    expect(settled).toMatchObject({
      grossTotal: issued.grossTotal,
      officialNumber: issued.officialNumber,
      version: issued.version,
    });
    expect(settled.posSettlement).toMatchObject({
      status: 'paid',
      netPaidTotal: '0.0000',
      netSaleTotal: '0.0000',
      refundedTotal: '30.6775',
      refundDue: '0.0000',
    });
    expect(
      (await reverse(randomUUID()).send({ expectedOutstanding: '0' }).expect(409)).body.error.code,
    ).toBe('POS_ACCOUNT_PAYMENT_RETURNED');
    await expect(
      database.query(
        'UPDATE finance.pos_account_refunds SET amount=amount+1 WHERE pos_return_id=$1',
        [completedReturn.id],
      ),
    ).rejects.toThrow('append-only');
    const partiallyCollectedReturn = await post<PosReturn>(
      application,
      '/api/v1/pos/returns',
      posToken,
      randomUUID(),
      {
        originalSaleId: partialSale.id,
        shiftId: shift.id,
        reason: 'Return the remaining partially collected purchase',
        lines: [
          { originalSaleLineId: partialSale.lines[0]!.id, quantity: '0.5', disposition: 'restock' },
        ],
        refunds: [
          {
            originalPaymentId: partialSale.payments[0]!.id,
            method: 'on_account',
            amount: '15.3388',
          },
        ],
      },
    );
    const partialSaleReceivable = (await readAccount()).posReceivables!.find(
      (item) => item.saleId === partialSale.id,
    );
    expect(partialSaleReceivable).toMatchObject({
      returnCredit: '20.6775',
      outstandingTotal: '0.0000',
      refundDue: '10.0000',
    });
    expect(
      partialSaleReceivable?.returnCredits?.find(
        (credit) => credit.returnId === partiallyCollectedReturn.id,
      ),
    ).toMatchObject({
      releasedTotal: '5.3388',
      refundDue: '10.0000',
    });
    await post<CustomerPaymentAccount>(
      application,
      `/api/v1/finance/customer-accounts/${customerId}/pos-sales/${partialSale.id}/returns/${partiallyCollectedReturn.id}/refunds`,
      managerToken,
      randomUUID(),
      {
        amount: '10',
        expectedRefundDue: '10',
        refundedOn: paymentDate,
        paymentMethod: 'cash',
        paymentReference: 'CASH-REPAYMENT-NO-INVOICE',
      },
    );
    await expect(
      database.query('UPDATE finance.payments SET amount=amount+1 WHERE id=$1', [payment.id]),
    ).rejects.toThrow('immutable');
    await expect(
      migrateDown(database, fileURLToPath(new URL('../src/database/migrations', import.meta.url))),
    ).rejects.toThrow('Cannot discard');
  }, 40000);

  async function stockQuantity(): Promise<number> {
    const result = await database.query<{ quantity: string }>(
      `SELECT quantity::text FROM inventory.stock_balances
       WHERE warehouse_id = $1 AND product_id = $2`,
      [fixtureId('warehouse:central'), fixtureId('catalog:product:adapter')],
    );
    return Number(result.rows[0]?.quantity ?? '0');
  }
});

async function login(application: INestApplication, email: string): Promise<string> {
  const response = await request(application.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.sessionToken as string;
}

async function get<T>(application: INestApplication, path: string, token: string): Promise<T> {
  const response = await request(application.getHttpServer())
    .get(path)
    .set('authorization', `Bearer ${token}`)
    .expect(200);
  return response.body as T;
}

async function post<T>(
  application: INestApplication,
  path: string,
  token: string,
  idempotencyKey: string,
  body: object,
): Promise<T> {
  const response = await request(application.getHttpServer())
    .post(path)
    .set('authorization', `Bearer ${token}`)
    .set('idempotency-key', idempotencyKey)
    .send(body)
    .expect((response) => {
      if (response.status < 200 || response.status >= 300)
        throw new Error(`${response.status}: ${JSON.stringify(response.body)}`);
    });
  return response.body as T;
}

async function put<T>(
  application: INestApplication,
  path: string,
  token: string,
  idempotencyKey: string,
  body: object,
): Promise<T> {
  const response = await request(application.getHttpServer())
    .put(path)
    .set('authorization', `Bearer ${token}`)
    .set('idempotency-key', idempotencyKey)
    .send(body)
    .expect((response) => {
      if (response.status < 200 || response.status >= 300)
        throw new Error(`${response.status}: ${JSON.stringify(response.body)}`);
    });
  return response.body as T;
}

function assertTemporaryDatabaseName(value: string) {
  if (!/^vista_pos_test_[a-f0-9]{32}$/u.test(value))
    throw new Error('Refusing to operate on an unexpected POS test database');
}
