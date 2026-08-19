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
  FinanceBankStatement,
  FinanceCustomerDocument,
  FinanceReferenceData,
  ServiceEquipmentHistory,
  ServiceReferenceData,
  ServiceRequest,
  ServiceRequestPage,
  ServiceWorkOrder,
  ServiceWorkOrderPhoto,
  ServiceWorkOrderPage,
  FinancialDocument,
  FinancialDocumentReferenceData,
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
  let creatorAccountId: string;
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
  let technicianWarehouseId: string;
  let serialNumber: string;
  let salesInvoiceId: string;
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
      '0035_finance_bank_reconciliation',
    );
    expect(await migrateUp(database, migrationDirectory)).toContain(
      '0035_finance_bank_reconciliation',
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
    creatorAccountId = creatorId;
    const viewerId = await createAccount(
      database,
      `sales-viewer-${runId}@example.invalid`,
      passwordHash,
    );
    await grantPermissions(database, creatorId, ['create', 'edit', 'view']);
    await grantPermissions(database, viewerId, ['view']);
    await grantFinancePermissions(database, creatorId, ['create', 'edit', 'view']);
    await grantFinancePermissions(database, viewerId, ['view']);
    await grantServicePermissions(database, creatorId, ['approve', 'create', 'edit', 'view']);
    ({
      customerId,
      customerLocationId,
      equipmentId,
      productId,
      serialNumber,
      serialProductId,
      warehouseId,
    } = await seedSalesData(database, creatorId, runId));
    technicianWarehouseId = await seedServiceTechnicianWarehouse(
      database,
      creatorId,
      productId,
      runId,
    );
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
    salesInvoiceId = invoiced.invoice!.id;

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

  it('allocates partial payments once, marks overdue balances, and preserves the collection trail', async () => {
    const referencesResponse = await request(application.getHttpServer())
      .get('/api/v1/finance/reference-data')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const references = referencesResponse.body as FinanceReferenceData;
    expect(references.invoiceDrafts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: salesInvoiceId, total: '273.6000' })]),
    );

    const businessDateResult = await database.query<{ date: string }>(
      "SELECT (now() AT TIME ZONE 'Europe/Sofia')::date::text AS date",
    );
    const dueDate = businessDateResult.rows[0]?.date;
    if (!dueDate) throw new Error('Could not determine the finance test business date');
    const createKey = `finance-document-${runId}`;
    const createdResponse = await request(application.getHttpServer())
      .post('/api/v1/finance/documents')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', createKey)
      .send({ dueDate, salesInvoiceId })
      .expect(201);
    const created = createdResponse.body as FinanceCustomerDocument;
    expect(created).toMatchObject({
      allocatedTotal: '0.0000',
      outstandingTotal: '273.6000',
      paymentStatus: 'unpaid',
      sourceSalesInvoiceId: salesInvoiceId,
      total: '273.6000',
    });
    const createReplay = await request(application.getHttpServer())
      .post('/api/v1/finance/documents')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', createKey)
      .send({ dueDate, salesInvoiceId })
      .expect(201);
    expect((createReplay.body as FinanceCustomerDocument).id).toBe(created.id);

    const partialPayment = {
      amount: '100',
      notes: 'Customer paid the first instalment.',
      paymentDate: dueDate,
      paymentMethod: 'bank_transfer',
      paymentReference: `BANK-${runId}`,
    };
    const partialResponse = await request(application.getHttpServer())
      .post(`/api/v1/finance/documents/${created.id}/payments`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-payment-partial-${runId}`)
      .send(partialPayment)
      .expect(201);
    const partiallyPaid = partialResponse.body as FinanceCustomerDocument;
    expect(partiallyPaid).toMatchObject({
      allocatedTotal: '100.0000',
      outstandingTotal: '173.6000',
      paymentStatus: 'partially_paid',
      payments: [expect.objectContaining({ amount: '100.0000', paymentMethod: 'bank_transfer' })],
    });
    await request(application.getHttpServer())
      .post(`/api/v1/finance/documents/${created.id}/payments`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-overpayment-${runId}`)
      .send({ ...partialPayment, amount: '174', paymentReference: `OVER-${runId}` })
      .expect(409);

    await database.query(
      `UPDATE finance.customer_documents
       SET document_date = ((now() AT TIME ZONE 'Europe/Sofia')::date - 1),
           due_date = ((now() AT TIME ZONE 'Europe/Sofia')::date - 1)
       WHERE id = $1`,
      [created.id],
    );
    const handlers = application.get(JobHandlerRegistry);
    await expect(
      handlers.execute({
        attemptNumber: 1,
        correlationId: `finance-job-${runId}`,
        enqueuedAt: '2026-08-14T01:25:00.000Z',
        idempotencyKey: `finance-status-${runId}`,
        jobId: `finance-job-${runId}`,
        maxAttempts: 5,
        name: 'finance.payment-status.detect',
        payload: { scheduledFor: '2026-08-14T01:25:00.000Z' },
        retryAllowed: true,
      }),
    ).resolves.toMatchObject({ updatedCount: 1 });
    const overdueResponse = await request(application.getHttpServer())
      .get(`/api/v1/finance/documents/${created.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect((overdueResponse.body as FinanceCustomerDocument).paymentStatus).toBe('overdue');

    await request(application.getHttpServer())
      .post('/api/v1/finance/bank-statements')
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `finance-bank-viewer-${runId}`)
      .send({})
      .expect(403);
    const statementInput = {
      accountIban: 'BG76DEMO00000000000000',
      bankName: 'Vista integration bank',
      closingBalance: '1173.6',
      currencyCode: 'BGN',
      lines: [
        {
          amount: '160',
          counterpartyName: `Sales Customer ${runId}`,
          direction: 'incoming',
          paymentReference: `Payment for ${created.number}`,
          transactionDate: dueDate,
          valueDate: dueDate,
        },
        {
          amount: '13.6',
          counterpartyName: `Sales Customer ${runId}`,
          direction: 'incoming',
          paymentReference: `Customer transfer ${runId}`,
          transactionDate: dueDate,
          valueDate: dueDate,
        },
      ],
      openingBalance: '1000',
      statementDate: dueDate,
      statementReference: `STATEMENT-${runId}`,
    };
    const bankKey = `finance-bank-create-${runId}`;
    const statementResponse = await request(application.getHttpServer())
      .post('/api/v1/finance/bank-statements')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', bankKey)
      .send(statementInput)
      .expect(201);
    const statement = statementResponse.body as FinanceBankStatement;
    expect(statement).toMatchObject({
      incomingTotal: '173.6000',
      matchedIncomingCount: 1,
      status: 'open',
      unmatchedIncomingCount: 1,
    });
    expect(statement.transactions[0]).toMatchObject({
      match: { documentNumber: created.number, method: 'automatic_reference' },
      matchStatus: 'matched',
    });
    const replay = await request(application.getHttpServer())
      .post('/api/v1/finance/bank-statements')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', bankKey)
      .send(statementInput)
      .expect(201);
    expect((replay.body as FinanceBankStatement).id).toBe(statement.id);
    const unmatched = statement.transactions[1];
    expect(unmatched).toMatchObject({ amount: '13.6000', matchStatus: 'unmatched' });
    if (!unmatched) throw new Error('Expected an unmatched bank transaction');
    const candidates = await request(application.getHttpServer())
      .get(`/api/v1/finance/bank-transactions/${unmatched.id}/match-candidates`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(candidates.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ customerDocumentId: created.id })]),
    );
    const matchedResponse = await request(application.getHttpServer())
      .post(`/api/v1/finance/bank-transactions/${unmatched.id}/match`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-bank-match-${runId}`)
      .send({ customerDocumentId: created.id, expectedVersion: unmatched.version })
      .expect(200);
    expect(matchedResponse.body as FinanceBankStatement).toMatchObject({
      matchedIncomingCount: 2,
      status: 'reconciled',
      unmatchedIncomingCount: 0,
    });
    const settledResponse = await request(application.getHttpServer())
      .get(`/api/v1/finance/documents/${created.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const settled = settledResponse.body as FinanceCustomerDocument;
    expect(settled).toMatchObject({
      allocatedTotal: '273.6000',
      outstandingTotal: '0.0000',
      paymentStatus: 'paid',
    });
    expect(settled.payments).toHaveLength(3);
    expect(settled.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: '160.0000', paymentMethod: 'bank_transfer' }),
        expect.objectContaining({ amount: '13.6000', paymentMethod: 'bank_transfer' }),
      ]),
    );
    await request(application.getHttpServer())
      .post(`/api/v1/finance/documents/${created.id}/cancel`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-cancel-${runId}`)
      .send({
        cancellationReason: 'This should remain unavailable after payment.',
        expectedVersion: settled.version,
      })
      .expect(409);

    const evidence = await database.query<{
      allocation_count: string;
      audit_count: string;
      outbox_count: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM finance.payment_allocations WHERE customer_document_id = $1) AS allocation_count,
         (SELECT count(*)::text FROM audit.events WHERE action LIKE 'finance.%') AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events WHERE event_type LIKE 'finance.%') AS outbox_count`,
      [created.id],
    );
    expect(evidence.rows[0]).toEqual({
      allocation_count: '3',
      audit_count: '6',
      outbox_count: '6',
    });
  });

  it('prepares structured invoice and correction drafts with immutable VAT and rate snapshots', async () => {
    await request(application.getHttpServer())
      .post('/api/v1/finance/financial-documents')
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `financial-document-viewer-${runId}`)
      .send({})
      .expect(403);

    const referenceResponse = await request(application.getHttpServer())
      .get('/api/v1/finance/financial-documents/reference-data')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const references = referenceResponse.body as FinancialDocumentReferenceData;
    const scope = references.scopes[0];
    expect(scope).toBeDefined();
    expect(references.salesDrafts.some((draft) => draft.id === salesInvoiceId)).toBe(true);
    if (!scope) throw new Error('Financial document test scope was not created');

    const businessDateResult = await database.query<{ date: string }>(
      "SELECT (now() AT TIME ZONE 'Europe/Sofia')::date::text AS date",
    );
    const issueDate = businessDateResult.rows[0]?.date;
    if (!issueDate) throw new Error('Could not determine the financial document business date');
    const invoiceInput = {
      businessLocationId: scope.locationId,
      currencyCode: 'BGN',
      customerPartnerId: customerId,
      documentType: 'invoice',
      dueDate: issueDate,
      exchangeRate: '1',
      issueDate,
      legalEntityId: scope.legalEntityId,
      rateDate: issueDate,
      rateSource: 'internal_bgn',
      sourceSalesInvoiceId: salesInvoiceId,
      taxEventDate: issueDate,
    };
    const key = `financial-document-invoice-${runId}`;
    const createdResponse = await request(application.getHttpServer())
      .post('/api/v1/finance/financial-documents')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', key)
      .send(invoiceInput)
      .expect(201);
    const invoice = createdResponse.body as FinancialDocument;
    expect(invoice).toMatchObject({
      currencyCode: 'BGN',
      documentType: 'invoice',
      exchangeRate: '1.00000000',
      grossTotal: '273.6000',
      sourceSalesInvoiceId: salesInvoiceId,
      status: 'draft',
    });
    expect(invoice).not.toHaveProperty('officialNumber');
    expect(invoice.number).toMatch(/^DINV-/u);
    expect(invoice.vatSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ vatRate: '20.0000', vatTreatment: 'standard_20' }),
      ]),
    );

    const replay = await request(application.getHttpServer())
      .post('/api/v1/finance/financial-documents')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', key)
      .send(invoiceInput)
      .expect(201);
    expect((replay.body as FinancialDocument).id).toBe(invoice.id);
    const refreshedReferences = (
      await request(application.getHttpServer())
        .get('/api/v1/finance/financial-documents/reference-data')
        .set('authorization', `Bearer ${token}`)
        .expect(200)
    ).body as FinancialDocumentReferenceData;
    expect(
      refreshedReferences.salesDrafts.find((draft) => draft.id === salesInvoiceId)
        ?.linkedDocumentTypes,
    ).toContain('invoice');

    const unitCode = references.products.find((product) => product.id === productId)?.unitCode;
    if (!unitCode) throw new Error('Financial document test product unit was not found');
    const correctionResponse = await request(application.getHttpServer())
      .post('/api/v1/finance/financial-documents')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `financial-document-credit-${runId}`)
      .send({
        businessLocationId: scope.locationId,
        correctionOfDocumentId: invoice.id,
        correctionReason: 'One damaged unit was returned before legal issuance.',
        currencyCode: 'BGN',
        customerPartnerId: customerId,
        documentType: 'credit_note',
        exchangeRate: '1',
        issueDate,
        legalEntityId: scope.legalEntityId,
        lines: [
          {
            description: 'Receipt rolls',
            discountPercent: '0',
            productId,
            quantity: '1',
            unitCode,
            unitPrice: '10',
            vatTreatment: 'standard_20',
          },
        ],
        rateDate: issueDate,
        rateSource: 'internal_bgn',
        taxEventDate: issueDate,
      })
      .expect(201);
    const correction = correctionResponse.body as FinancialDocument;
    expect(correction).toMatchObject({
      correctionOf: { id: invoice.id },
      documentType: 'credit_note',
      grossTotal: '12.0000',
      status: 'draft',
    });

    const cancelledResponse = await request(application.getHttpServer())
      .post(`/api/v1/finance/financial-documents/${correction.id}/cancel`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `financial-document-cancel-${runId}`)
      .send({ cancellationReason: 'Test correction no longer required.', expectedVersion: 1 })
      .expect(200);
    expect(cancelledResponse.body as FinancialDocument).toMatchObject({
      cancellationReason: 'Test correction no longer required.',
      status: 'cancelled',
      version: 2,
    });

    const concurrentProformas = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        request(application.getHttpServer())
          .post('/api/v1/finance/financial-documents')
          .set('authorization', `Bearer ${token}`)
          .set('idempotency-key', `financial-document-proforma-${index}-${runId}`)
          .send({
            ...invoiceInput,
            documentType: 'proforma',
            lines: [
              {
                description: `Concurrent numbering check ${index + 1}`,
                discountPercent: '0',
                productId,
                quantity: '1',
                unitCode,
                unitPrice: '10',
                vatTreatment: 'standard_20',
              },
            ],
            sourceSalesInvoiceId: undefined,
          })
          .expect(201),
      ),
    );
    const proformaNumbers = concurrentProformas.map(
      ({ body }) => (body as FinancialDocument).number,
    );
    expect(new Set(proformaNumbers).size).toBe(4);
    expect(
      proformaNumbers
        .map((number) => Number(number.slice(number.lastIndexOf('-') + 1)))
        .sort((left, right) => left - right),
    ).toEqual([1, 2, 3, 4]);

    const register = await request(application.getHttpServer())
      .get('/api/v1/finance/financial-documents?page=1&pageSize=10')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(register.body).toMatchObject({ page: 1, pageSize: 10, totalItems: 6 });

    const evidence = await database.query<{ audit_count: string; outbox_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM audit.events
          WHERE action LIKE 'finance.financial-document.%') AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events
          WHERE event_type LIKE 'finance.financial-document.%') AS outbox_count`,
    );
    expect(evidence.rows[0]).toEqual({ audit_count: '7', outbox_count: '7' });
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

  it('carries a service request through technician work, evidence, parts, signature, and serial history', async () => {
    await request(application.getHttpServer())
      .get('/api/v1/service/reference-data')
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(403);

    const referencesResponse = await request(application.getHttpServer())
      .get('/api/v1/service/reference-data')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const references = referencesResponse.body as ServiceReferenceData;
    expect(references.businessTimezone).toBe('Europe/Sofia');
    expect(references.equipment).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: equipmentId })]),
    );
    expect(references.technicians).toEqual(
      expect.arrayContaining([expect.objectContaining({ warehouseId: technicianWarehouseId })]),
    );
    expect(references.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId, warehouseId: technicianWarehouseId }),
      ]),
    );

    const requestInput = {
      customerEquipmentId: equipmentId,
      customerLocationId,
      customerPartnerId: customerId,
      priority: 'high',
      problemDescription: 'Fiscal display intermittently loses connection.',
      serviceType: 'warranty',
      sourceChannel: 'telephone',
    };
    const createKey = `service-request-${runId}`;
    const createdResponse = await request(application.getHttpServer())
      .post('/api/v1/service/requests')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', createKey)
      .send(requestInput)
      .expect(201);
    const created = createdResponse.body as ServiceRequest;
    expect(created).toMatchObject({
      customerEquipmentId: equipmentId,
      serviceType: 'warranty',
      status: 'new',
    });
    const createReplay = await request(application.getHttpServer())
      .post('/api/v1/service/requests')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', createKey)
      .send(requestInput)
      .expect(201);
    expect((createReplay.body as ServiceRequest).id).toBe(created.id);

    const requestPageResponse = await request(application.getHttpServer())
      .get('/api/v1/service/requests?page=1&pageSize=25')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const requestPage = requestPageResponse.body as ServiceRequestPage;
    expect(requestPage).toMatchObject({
      page: 1,
      pageSize: 25,
      summary: { new: 1 },
      total: 1,
      totalPages: 1,
    });
    expect(requestPage.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.id })]),
    );

    const assignedResponse = await request(application.getHttpServer())
      .post(`/api/v1/service/requests/${created.id}/assign`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-assign-${runId}`)
      .send({
        expectedVersion: created.version,
        scheduledEnd: '2099-09-01T10:00:00.000Z',
        scheduledStart: '2099-09-01T09:00:00.000Z',
        technicianAccountId: creatorAccountId,
        technicianWarehouseId,
      })
      .expect(201);
    const assigned = assignedResponse.body as ServiceRequest;
    expect(assigned.status).toBe('scheduled');
    expect(assigned.workOrderId).toBeTypeOf('string');
    expect(assigned.workOrderNumber).toMatch(/^WO-/u);
    if (!assigned.workOrderId) throw new Error('Assigned request did not include a work order.');

    const scheduledResponse = await request(application.getHttpServer())
      .get(`/api/v1/service/work-orders/${assigned.workOrderId}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const scheduled = scheduledResponse.body as ServiceWorkOrder;
    const startKey = `service-start-${runId}`;
    const startInput = { expectedVersion: scheduled.version };
    const startedResponse = await request(application.getHttpServer())
      .post(`/api/v1/service/work-orders/${scheduled.id}/start`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', startKey)
      .send(startInput)
      .expect(200);
    const started = startedResponse.body as ServiceWorkOrder;
    expect(started.status).toBe('in_progress');
    const startReplay = await request(application.getHttpServer())
      .post(`/api/v1/service/work-orders/${scheduled.id}/start`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', startKey)
      .send(startInput)
      .expect(200);
    expect((startReplay.body as ServiceWorkOrder).id).toBe(started.id);

    const photoResponse = await request(application.getHttpServer())
      .post(`/api/v1/service/work-orders/${started.id}/photos`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-photo-${runId}`)
      .attach('photo', tinyPng, { contentType: 'image/png', filename: 'display-check.png' })
      .expect(201);
    expect(photoResponse.body as ServiceWorkOrderPhoto).toMatchObject({
      fileName: 'display-check.png',
      mediaType: 'image/png',
    });
    const photo = photoResponse.body as ServiceWorkOrderPhoto;
    const photoReplay = await request(application.getHttpServer())
      .post(`/api/v1/service/work-orders/${started.id}/photos`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-photo-${runId}`)
      .attach('photo', tinyPng, { contentType: 'image/png', filename: 'display-check.png' })
      .expect(201);
    expect((photoReplay.body as ServiceWorkOrderPhoto).id).toBe(photo.id);
    const downloadedPhoto = await request(application.getHttpServer())
      .get(`/api/v1/service/work-orders/${started.id}/photos/${photo.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect('content-type', /image\/png/u)
      .expect(200);
    expect(downloadedPhoto.body).toEqual(tinyPng);

    const conflictingRequestResponse = await request(application.getHttpServer())
      .post('/api/v1/service/requests')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-conflicting-request-${runId}`)
      .send({
        ...requestInput,
        problemDescription: 'A second reported fault while the first repair is active.',
      })
      .expect(201);
    const conflictingRequest = conflictingRequestResponse.body as ServiceRequest;
    const conflictingAssignmentResponse = await request(application.getHttpServer())
      .post(`/api/v1/service/requests/${conflictingRequest.id}/assign`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-conflicting-assign-${runId}`)
      .send({
        expectedVersion: conflictingRequest.version,
        scheduledEnd: '2099-09-02T10:00:00.000Z',
        scheduledStart: '2099-09-02T09:00:00.000Z',
        technicianAccountId: creatorAccountId,
        technicianWarehouseId,
      })
      .expect(201);
    const conflictingAssignment = conflictingAssignmentResponse.body as ServiceRequest;
    const conflictingWorkOrderResponse = await request(application.getHttpServer())
      .get(`/api/v1/service/work-orders/${conflictingAssignment.workOrderId}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const conflictingWorkOrder = conflictingWorkOrderResponse.body as ServiceWorkOrder;
    const conflictingStart = await request(application.getHttpServer())
      .post(`/api/v1/service/work-orders/${conflictingWorkOrder.id}/start`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-conflicting-start-${runId}`)
      .send({ expectedVersion: conflictingWorkOrder.version })
      .expect(409);
    expect(conflictingStart.body.error.code).toBe('SERVICE_EQUIPMENT_ALREADY_IN_SERVICE');
    const cancelledConflict = await request(application.getHttpServer())
      .post(`/api/v1/service/requests/${conflictingAssignment.id}/cancel`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-conflicting-cancel-${runId}`)
      .send({
        cancellationReason: 'Duplicate request while the active repair is in progress.',
        expectedVersion: conflictingAssignment.version,
      })
      .expect(200);
    expect((cancelledConflict.body as ServiceRequest).status).toBe('cancelled');

    const readyResponse = await request(application.getHttpServer())
      .get(`/api/v1/service/work-orders/${started.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const ready = readyResponse.body as ServiceWorkOrder;
    const completionInput = {
      completionNotes: 'Repaired the display connection and verified normal operation.',
      expectedVersion: ready.version,
      laborCostBgn: '40',
      parts: [{ productId, quantity: '1' }],
      signatureImageDataUrl: `data:image/png;base64,${tinyPng.toString('base64')}`,
      signerName: 'Elena Stoyanova',
      timeEntries: [
        { minutes: 30, note: 'On-site repair and verification.', workDate: '2026-08-14' },
      ],
      transportCostBgn: '10',
    };
    const completionKey = `service-complete-${runId}`.padEnd(200, 'x');
    const completedResponse = await request(application.getHttpServer())
      .post(`/api/v1/service/work-orders/${ready.id}/complete`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', completionKey)
      .send(completionInput)
      .expect(200);
    const completed = completedResponse.body as ServiceWorkOrder;
    expect(completed).toMatchObject({
      laborCostBgn: '40.0000',
      laborMinutes: 30,
      parts: [expect.objectContaining({ productId, quantity: '1.0000' })],
      partsCostBgn: '7.0000',
      photos: [expect.objectContaining({ fileName: 'display-check.png' })],
      signature: { signerName: 'Elena Stoyanova' },
      status: 'completed',
      totalCostBgn: '57.0000',
      transportCostBgn: '10.0000',
    });
    const completionReplay = await request(application.getHttpServer())
      .post(`/api/v1/service/work-orders/${ready.id}/complete`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', completionKey)
      .send(completionInput)
      .expect(200);
    expect((completionReplay.body as ServiceWorkOrder).id).toBe(completed.id);
    const downloadedSignature = await request(application.getHttpServer())
      .get(`/api/v1/service/work-orders/${completed.id}/signature`)
      .set('authorization', `Bearer ${token}`)
      .expect('content-type', /image\/png/u)
      .expect(200);
    expect(downloadedSignature.body).toEqual(tinyPng);

    const mineResponse = await request(application.getHttpServer())
      .get('/api/v1/service/work-orders/my')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect((mineResponse.body as ServiceWorkOrderPage).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: completed.id })]),
    );
    const historyResponse = await request(application.getHttpServer())
      .get(`/api/v1/service/equipment/${equipmentId}/history`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect((historyResponse.body as ServiceEquipmentHistory).events).toEqual(
      expect.arrayContaining([expect.objectContaining({ workOrderNumber: completed.number })]),
    );

    await database.query(
      "UPDATE master_data.customer_equipment SET status = 'retired' WHERE id = $1",
      [equipmentId],
    );
    const retiredReferenceResponse = await request(application.getHttpServer())
      .get('/api/v1/service/reference-data')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect((retiredReferenceResponse.body as ServiceReferenceData).equipment).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ active: true, id: equipmentId, status: 'retired' }),
      ]),
    );
    const retiredHistoryResponse = await request(application.getHttpServer())
      .get(`/api/v1/service/equipment/${equipmentId}/history`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect((retiredHistoryResponse.body as ServiceEquipmentHistory).events).toEqual(
      expect.arrayContaining([expect.objectContaining({ workOrderNumber: completed.number })]),
    );

    const evidence = await database.query<{
      audit_count: string;
      outbox_count: string;
      part_usage_count: string;
      stock_quantity: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM service.work_order_part_usages WHERE work_order_id = $1) AS part_usage_count,
         (SELECT quantity::text FROM inventory.stock_balances WHERE warehouse_id = $2 AND product_id = $3) AS stock_quantity,
         (SELECT count(*)::text FROM audit.events WHERE action LIKE 'service.%') AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events WHERE event_type LIKE 'service.%') AS outbox_count`,
      [completed.id, technicianWarehouseId, productId],
    );
    expect(evidence.rows[0]).toMatchObject({
      part_usage_count: '1',
      stock_quantity: '4.0000',
    });
    expect(Number(evidence.rows[0]?.audit_count)).toBeGreaterThanOrEqual(5);
    expect(Number(evidence.rows[0]?.outbox_count)).toBeGreaterThanOrEqual(5);
  });

  it('limits a technician without service approval to assigned work and preserves dispatcher oversight', async () => {
    const firstTechnicianAccountId = await createAccount(
      database,
      `service-tech-one-${runId}@example.invalid`,
      await application.get(PasswordService).hash(password),
    );
    const secondTechnicianAccountId = await createAccount(
      database,
      `service-tech-two-${runId}@example.invalid`,
      await application.get(PasswordService).hash(password),
    );
    await grantServicePermissions(database, firstTechnicianAccountId, ['edit', 'view']);
    await grantServicePermissions(database, secondTechnicianAccountId, ['edit', 'view']);
    const firstTechnicianWarehouseId = await seedServiceTechnicianWarehouse(
      database,
      firstTechnicianAccountId,
      productId,
      `scope-one-${runId}`,
    );
    const secondTechnicianWarehouseId = await seedServiceTechnicianWarehouse(
      database,
      secondTechnicianAccountId,
      productId,
      `scope-two-${runId}`,
    );
    const firstTechnicianToken = await login(
      application,
      `service-tech-one-${runId}@example.invalid`,
    );

    const firstScope = await seedSalesData(database, creatorAccountId, `scope-one-${runId}`);
    const secondScope = await seedSalesData(database, creatorAccountId, `scope-two-${runId}`);
    const firstRequestInput = {
      customerEquipmentId: firstScope.equipmentId,
      customerLocationId: firstScope.customerLocationId,
      customerPartnerId: firstScope.customerId,
      priority: 'normal',
      problemDescription: 'Technician one visit.',
      serviceType: 'warranty',
      sourceChannel: 'telephone',
    };
    const secondRequestInput = {
      customerEquipmentId: secondScope.equipmentId,
      customerLocationId: secondScope.customerLocationId,
      customerPartnerId: secondScope.customerId,
      priority: 'normal',
      problemDescription: 'Technician two visit.',
      serviceType: 'warranty',
      sourceChannel: 'telephone',
    };
    const firstCreatedResponse = await request(application.getHttpServer())
      .post('/api/v1/service/requests')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-scope-one-create-${runId}`)
      .send(firstRequestInput)
      .expect(201);
    const firstCreated = firstCreatedResponse.body as ServiceRequest;
    const secondCreatedResponse = await request(application.getHttpServer())
      .post('/api/v1/service/requests')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-scope-two-create-${runId}`)
      .send(secondRequestInput)
      .expect(201);
    const secondCreated = secondCreatedResponse.body as ServiceRequest;

    const firstAssignedResponse = await request(application.getHttpServer())
      .post(`/api/v1/service/requests/${firstCreated.id}/assign`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-scope-one-assign-${runId}`)
      .send({
        expectedVersion: firstCreated.version,
        scheduledEnd: '2099-10-01T10:00:00.000Z',
        scheduledStart: '2099-10-01T09:00:00.000Z',
        technicianAccountId: firstTechnicianAccountId,
        technicianWarehouseId: firstTechnicianWarehouseId,
      })
      .expect(201);
    const firstAssigned = firstAssignedResponse.body as ServiceRequest;
    const secondAssignedResponse = await request(application.getHttpServer())
      .post(`/api/v1/service/requests/${secondCreated.id}/assign`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-scope-two-assign-${runId}`)
      .send({
        expectedVersion: secondCreated.version,
        scheduledEnd: '2099-10-02T10:00:00.000Z',
        scheduledStart: '2099-10-02T09:00:00.000Z',
        technicianAccountId: secondTechnicianAccountId,
        technicianWarehouseId: secondTechnicianWarehouseId,
      })
      .expect(201);
    const secondAssigned = secondAssignedResponse.body as ServiceRequest;
    if (!firstAssigned.workOrderId || !secondAssigned.workOrderId)
      throw new Error('The scoped service requests must receive work orders.');

    const ownReferencesResponse = await request(application.getHttpServer())
      .get('/api/v1/service/reference-data')
      .set('authorization', `Bearer ${firstTechnicianToken}`)
      .expect(200);
    const ownReferences = ownReferencesResponse.body as ServiceReferenceData;
    expect(ownReferences.equipment).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: firstScope.equipmentId })]),
    );
    expect(ownReferences.equipment).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: secondScope.equipmentId })]),
    );
    expect(ownReferences.technicians).toEqual([
      expect.objectContaining({ accountId: firstTechnicianAccountId }),
    ]);

    const ownRequestsResponse = await request(application.getHttpServer())
      .get('/api/v1/service/requests?page=1&pageSize=25')
      .set('authorization', `Bearer ${firstTechnicianToken}`)
      .expect(200);
    const ownRequests = ownRequestsResponse.body as ServiceRequestPage;
    expect(ownRequests).toMatchObject({ total: 1, totalPages: 1 });
    expect(ownRequests.items).toEqual([expect.objectContaining({ id: firstAssigned.id })]);
    await request(application.getHttpServer())
      .get(`/api/v1/service/requests/${firstAssigned.id}`)
      .set('authorization', `Bearer ${firstTechnicianToken}`)
      .expect(200);
    const unrelatedRequest = await request(application.getHttpServer())
      .get(`/api/v1/service/requests/${secondAssigned.id}`)
      .set('authorization', `Bearer ${firstTechnicianToken}`)
      .expect(403);
    expect(unrelatedRequest.body.error.code).toBe('SERVICE_REQUEST_ACCESS_DENIED');

    const ownWorkResponse = await request(application.getHttpServer())
      .get('/api/v1/service/work-orders?page=1&pageSize=25')
      .set('authorization', `Bearer ${firstTechnicianToken}`)
      .expect(200);
    const ownWork = ownWorkResponse.body as ServiceWorkOrderPage;
    expect(ownWork).toMatchObject({ total: 1, totalPages: 1 });
    expect(ownWork.items).toEqual([expect.objectContaining({ id: firstAssigned.workOrderId })]);
    const unrelatedWorkOrder = await request(application.getHttpServer())
      .get(`/api/v1/service/work-orders/${secondAssigned.workOrderId}`)
      .set('authorization', `Bearer ${firstTechnicianToken}`)
      .expect(403);
    expect(unrelatedWorkOrder.body.error.code).toBe('SERVICE_WORK_ORDER_ACCESS_DENIED');
    const unrelatedEvidence = await request(application.getHttpServer())
      .get(`/api/v1/service/work-orders/${secondAssigned.workOrderId}/signature`)
      .set('authorization', `Bearer ${firstTechnicianToken}`)
      .expect(403);
    expect(unrelatedEvidence.body.error.code).toBe('SERVICE_WORK_ORDER_ACCESS_DENIED');
    const unrelatedHistory = await request(application.getHttpServer())
      .get(`/api/v1/service/equipment/${secondScope.equipmentId}/history`)
      .set('authorization', `Bearer ${firstTechnicianToken}`)
      .expect(403);
    expect(unrelatedHistory.body.error.code).toBe('SERVICE_EQUIPMENT_ACCESS_DENIED');

    const prohibitedDispatch = await request(application.getHttpServer())
      .post(`/api/v1/service/requests/${secondAssigned.id}/assign`)
      .set('authorization', `Bearer ${firstTechnicianToken}`)
      .set('idempotency-key', `service-scope-dispatch-denied-${runId}`)
      .send({
        expectedVersion: secondAssigned.version,
        scheduledEnd: '2099-10-03T10:00:00.000Z',
        scheduledStart: '2099-10-03T09:00:00.000Z',
        technicianAccountId: firstTechnicianAccountId,
        technicianWarehouseId: firstTechnicianWarehouseId,
      })
      .expect(403);
    expect(prohibitedDispatch.body.error.code).toBe('SERVICE_DISPATCH_APPROVAL_REQUIRED');
    const prohibitedCancellation = await request(application.getHttpServer())
      .post(`/api/v1/service/requests/${secondAssigned.id}/cancel`)
      .set('authorization', `Bearer ${firstTechnicianToken}`)
      .set('idempotency-key', `service-scope-cancel-denied-${runId}`)
      .send({
        cancellationReason: 'This is not assigned to the technician.',
        expectedVersion: secondAssigned.version,
      })
      .expect(403);
    expect(prohibitedCancellation.body.error.code).toBe('SERVICE_DISPATCH_APPROVAL_REQUIRED');

    const prohibitedOwnCancellation = await request(application.getHttpServer())
      .post(`/api/v1/service/requests/${firstAssigned.id}/cancel`)
      .set('authorization', `Bearer ${firstTechnicianToken}`)
      .set('idempotency-key', `service-scope-cancel-own-${runId}`)
      .send({
        cancellationReason: 'The assigned technician cannot complete this visit.',
        expectedVersion: firstAssigned.version,
      })
      .expect(403);
    expect(prohibitedOwnCancellation.body.error.code).toBe('SERVICE_DISPATCH_APPROVAL_REQUIRED');

    const dispatcherCancellation = await request(application.getHttpServer())
      .post(`/api/v1/service/requests/${firstAssigned.id}/cancel`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-scope-cancel-dispatcher-${runId}`)
      .send({
        cancellationReason: 'The assigned technician cannot complete this visit.',
        expectedVersion: firstAssigned.version,
      })
      .expect(200);
    expect((dispatcherCancellation.body as ServiceRequest).status).toBe('cancelled');

    const dispatcherWorkResponse = await request(application.getHttpServer())
      .get('/api/v1/service/work-orders?page=1&pageSize=100')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect((dispatcherWorkResponse.body as ServiceWorkOrderPage).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstAssigned.workOrderId }),
        expect.objectContaining({ id: secondAssigned.workOrderId }),
      ]),
    );
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

async function grantFinancePermissions(
  pool: Pool,
  accountId: string,
  actions: Array<'create' | 'edit' | 'view'>,
) {
  const roleId = randomUUID();
  await pool.query('INSERT INTO iam.roles (id, code, name) VALUES ($1, $2, $3)', [
    roleId,
    `finance-${randomUUID()}`,
    'Finance test role',
  ]);
  for (const action of actions) {
    const permission = await pool.query<{ id: string }>(
      `INSERT INTO iam.permissions (id, module, action) VALUES ($1, 'erp.finance', $2)
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

async function grantServicePermissions(
  pool: Pool,
  accountId: string,
  actions: Array<'approve' | 'create' | 'edit' | 'view'>,
) {
  const roleId = randomUUID();
  await pool.query('INSERT INTO iam.roles (id, code, name) VALUES ($1, $2, $3)', [
    roleId,
    `service-${randomUUID()}`,
    'Service test role',
  ]);
  for (const action of actions) {
    const permission = await pool.query<{ id: string }>(
      `INSERT INTO iam.permissions (id, module, action) VALUES ($1, 'erp.service', $2)
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
    `INSERT INTO master_data.partner_addresses (
       partner_id, address_type, address_line_1, city, country_code
     ) VALUES ($1, 'billing', '1 Customer Street', 'Vratsa', 'BG')`,
    [customerId],
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
     VALUES ($1, $2, $3, $4, $4)`,
    [
      unitId,
      `SU${runId.slice(0, 8).replaceAll('-', '').toUpperCase()}`,
      `Pieces ${runId}`,
      actorId,
    ],
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

async function seedServiceTechnicianWarehouse(
  pool: Pool,
  accountId: string,
  productId: string,
  runId: string,
) {
  const entityId = randomUUID();
  const branchId = randomUUID();
  const locationId = randomUUID();
  const operatorId = randomUUID();
  const warehouseId = randomUUID();
  await pool.query(
    `INSERT INTO organization.legal_entities (id, code, name, created_by, updated_by)
     VALUES ($1, $2, 'Service test entity', $3, $3)`,
    [entityId, `SE-${runId.slice(0, 8).toUpperCase()}`, accountId],
  );
  await pool.query(
    `INSERT INTO organization.branches (id, legal_entity_id, code, name, created_by, updated_by)
     VALUES ($1, $2, $3, 'Service test branch', $4, $4)`,
    [branchId, entityId, `SB-${runId.slice(0, 8).toUpperCase()}`, accountId],
  );
  await pool.query(
    `INSERT INTO organization.business_locations (
       id, branch_id, code, name, location_type, address_line_1, city, created_by, updated_by
     ) VALUES ($1, $2, $3, 'Service test base', 'Service center', '1 Technician Street',
       'Vratsa', $4, $4)`,
    [locationId, branchId, `SL-${runId.slice(0, 8).toUpperCase()}`, accountId],
  );
  await pool.query(
    `INSERT INTO organization.operators (
       id, business_location_id, account_id, code, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $3, $3)`,
    [operatorId, locationId, accountId, `TECH-${runId.slice(0, 8).toUpperCase()}`],
  );
  await pool.query(
    `INSERT INTO master_data.warehouses (
       id, code, name, warehouse_type, business_location_id, technician_operator_id, created_by, updated_by
     ) VALUES ($1, $2, 'Service technician warehouse', 'technician', $3, $4, $5, $5)`,
    [warehouseId, `TW-${runId.slice(0, 8).toUpperCase()}`, locationId, operatorId, accountId],
  );
  const movementId = randomUUID();
  await pool.query(
    `INSERT INTO inventory.stock_movements (
       id, warehouse_id, product_id, movement_type, quantity, reference_type, reference_id,
       actor_account_id, correlation_id, unit_cost_bgn
     ) VALUES ($1, $2, $3, 'receipt', 5, 'service_test_seed', $4, $5, $6, 7)`,
    [movementId, warehouseId, productId, `technician-${runId}`, accountId, randomUUID()],
  );
  await pool.query(
    `INSERT INTO inventory.stock_balances (warehouse_id, product_id, quantity, average_unit_cost_bgn)
     VALUES ($1, $2, 5, 7)`,
    [warehouseId, productId],
  );
  return warehouseId;
}

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8SAAAAABJRU5ErkJggg==',
  'base64',
);

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
