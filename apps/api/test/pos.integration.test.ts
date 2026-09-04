import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AppEnvironment } from '@vista/config';
import type {
  CustomerAdvance,
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
    expect(await migrateDown(database, migrationDirectory)).toBe('0057_pos_receipt_documents');
    expect(await migrateUp(database, migrationDirectory)).toContain('0057_pos_receipt_documents');

    Object.assign(process.env, {
      BUSINESS_TIMEZONE: 'Europe/Sofia',
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
      { cashRegisterId: register?.id, openingCashBgn: '100.00' },
    );
    const beforeStock = await stockQuantity();
    const catalog = await get<PosCatalogPage>(
      application,
      `/api/v1/pos/catalog?shiftId=${opening.id}&search=DEV-ADAPTER-12V`,
      posToken,
    );
    const product = catalog.items.find((item) => item.productCode === 'DEV-ADAPTER-12V');
    expect(product).toMatchObject({ unitPrice: '50.0000', vatTreatment: 'standard_20' });

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
      automaticDiscountTotal: '10.0000',
      baseNetTotal: '100.0000',
      grossTotal: '108.0000',
      netTotal: '90.0000',
      vatTotal: '18.0000',
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
        { amount: '54.00', method: 'cash', tenderedAmount: '64.00' },
        { amount: '54.00', method: 'card' },
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
      automaticDiscountTotal: '10.0000',
      baseNetTotal: '100.0000',
      cashTendered: '64.0000',
      changeAmount: '10.0000',
      fiscalStatus: 'simulated',
      grossTotal: '108.0000',
      status: 'completed',
    });
    expect(sale.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount: '54.0000',
          method: 'cash',
          refundableAmount: '54.0000',
          status: 'completed',
        }),
        expect.objectContaining({
          amount: '54.0000',
          method: 'card',
          refundableAmount: '54.0000',
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
        { amount: '27.00', method: 'cash', originalPaymentId: cashPayment?.id },
        { amount: '27.00', method: 'card', originalPaymentId: cardPayment?.id },
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
      grossTotal: '54.0000',
      originalSaleId: sale.id,
    });
    expect(firstReturn.refunds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: '27.0000', method: 'cash', status: 'completed' }),
        expect.objectContaining({ amount: '27.0000', method: 'card', status: 'simulated' }),
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
      firstReturnPayload,
    );
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
      baseNetTotal: '50.0000',
      grossTotal: '52.8000',
      loyaltyBalance: 300,
      loyaltyDiscountTotal: '1.0000',
      loyaltyPointsRedeemed: 100,
      manualDiscountTotal: '5.0000',
      netTotal: '44.0000',
      vatTotal: '8.8000',
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
        payments: [{ amount: '52.80', method: 'cash', tenderedAmount: '52.80' }],
        shiftId: opening.id,
      },
    );
    expect(commercialSale).toMatchObject({
      grossTotal: '52.8000',
      loyaltyDiscountTotal: '1.0000',
      loyaltyPointsEarned: 52,
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
    expect(ledgerAfterSale.account.balance).toBe(252);
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
            amount: '52.80',
            method: 'cash',
            originalPaymentId: commercialSale.payments[0]?.id,
          },
        ],
        shiftId: opening.id,
      },
    );
    expect(commercialReturn).toMatchObject({
      grossTotal: '52.8000',
      loyaltyPointsEarnedReversed: 52,
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
      advanceBalance: '80.0000',
      availableCredit: '2000.0000',
      outstandingBalance: '0.0000',
    });
    const creditAccount = await put<CustomerPaymentAccount>(
      application,
      `/api/v1/finance/customer-accounts/${customerId}/terms`,
      managerToken,
      `set-customer-credit-${runId}`,
      {
        creditLimitBgn: '70.00',
        expectedVersion: initialAccount?.terms?.version,
        onAccountEnabled: true,
        paymentTermsDays: 14,
        status: 'active',
        validFrom: '2026-01-01',
        validTo: '2030-12-31',
      },
    );
    expect(creditAccount).toMatchObject({
      availableCredit: '70.0000',
      terms: { creditLimitBgn: '70.0000', paymentTermsDays: 14, version: 2 },
    });

    const accountSalePayload = () => ({
      clientTransactionId: randomUUID(),
      customerLocationId: fixtureId('customer-location:alfa-store'),
      customerPartnerId: customerId,
      lines: [{ productId: product?.id, quantity: '1' }],
      payments: [{ amount: '60.00', method: 'on_account' }],
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
      amount: '60.0000',
    });
    expect(accountPayment?.accountDueOn).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    const optionsWithBalance = await get<PosCustomerPaymentOptions>(
      application,
      `/api/v1/pos/customers/${customerId}/payment-options`,
      posToken,
    );
    expect(optionsWithBalance).toMatchObject({
      availableCredit: '10.0000',
      onAccountAvailable: true,
      outstandingBalance: '60.0000',
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
          amount: '60.00',
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
        amount: '30.00',
        customerPartnerId: customerId,
        paymentMethod: 'bank_transfer',
        paymentReference: `TEST-ADV-${runId.slice(0, 8)}`,
        receivedOn: '2026-09-04',
      },
    );
    expect(recordedAdvance).toMatchObject({
      amount: '30.0000',
      availableAmount: '30.0000',
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
          { advanceId: recordedAdvance.id, amount: '30.00', method: 'advance' },
          { amount: '30.00', method: 'on_account' },
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
          amount: '30.0000',
          method: 'advance',
        }),
        expect.objectContaining({ amount: '30.0000', method: 'on_account' }),
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
            amount: '30.00',
            method: 'advance',
            originalPaymentId: advancePayment?.id,
          },
          {
            amount: '30.00',
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
      advanceBalance: '110.0000',
      availableCredit: '70.0000',
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
      unitPrice: '600.0000',
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
        payments: [{ amount: '720.00', method: 'card' }],
        shiftId: opening.id,
      },
    );
    expect(serialSale).toMatchObject({
      customerName: 'Alfa Market Demo Ltd.',
      grossTotal: '720.0000',
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
      bgnGrossTotal: '720.0000',
      customerPartnerId: fixtureId('partner:alfa'),
      documentType: 'invoice',
      grossTotal: '720.0000',
      sourceFiscalReceiptNumber: serialSale.fiscalReceiptNumber,
      sourcePosSaleId: serialSale.id,
      sourcePosSaleNumber: serialSale.saleNumber,
      status: 'draft',
    });
    expect(invoice.lines[0]).toMatchObject({
      grossTotal: '720.0000',
      productId: serialProduct?.id,
      quantity: '1.0000',
      unitCode: 'PCS',
      vatAmount: '120.0000',
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
            amount: '720.00',
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
    expect(refreshedTerminal.currentShift?.expectedCashBgn).toBe('100.0000');

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
      grossReturnsBgn: '1000.8000',
      grossSalesBgn: '1000.8000',
      netRevenueBgn: '0.0000',
      returnCount: 6,
      saleCount: 5,
    });
    expect(overview.products.find((item) => item.productCode === 'DEV-ADAPTER-12V')).toMatchObject({
      grossReturnsBgn: '280.8000',
      grossSalesBgn: '280.8000',
      netRevenueBgn: '0.0000',
      quantityReturned: '5.0000',
      quantitySold: '5.0000',
    });
    expect(overview.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'cash', netBgn: '0.0000' }),
        expect.objectContaining({ method: 'card', netBgn: '0.0000' }),
        expect.objectContaining({ method: 'advance', netBgn: '0.0000' }),
        expect.objectContaining({ method: 'on_account', netBgn: '0.0000' }),
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
      { closingCashBgn: '100.00', version: opening.version },
    );
    expect(closed).toMatchObject({ closingCashBgn: '100.0000', status: 'closed' });
    const zReport = await reports.exportData('pos.z-report', { shiftId: opening.id });
    expect(zReport.rows[0]).toMatchObject({
      closingCashBgn: '100.0000',
      differenceBgn: '0.0000',
      reportType: 'Z',
    });
  }, 20_000);

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
