import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AppEnvironment } from '@vista/config';
import type {
  ErpReportDefinition,
  ErpReportPreview,
  CustomerPriceGroup,
  PriceList,
  PromotionalCampaign,
  SalesPricingReferenceData,
  SalesReferenceData,
  SalesResolvedPrice,
  SalesWorkflow,
  SerialTraceability,
  ServiceSubscriptionContract,
  FinanceBankStatement,
  FinanceAgingReport,
  FinanceCashDailyReport,
  FinanceCashReferenceData,
  FinanceCashVoucher,
  FinanceCustomerDocument,
  FinanceJournalReport,
  FinanceReportDefinition,
  FinanceReportExport,
  FinanceReportExportPage,
  FinanceSupplierPayable,
  FinanceSupplierOffset,
  FinanceSupplierPayment,
  FinanceSupplierReferenceData,
  FinanceReferenceData,
  FinanceTurnoverReport,
  FinanceVatReviewReport,
  NotificationPage,
  OperationsOverview,
  ServiceEquipmentHistory,
  ServiceReferenceData,
  ServiceRequest,
  ServiceRequestPage,
  ServiceReportDefinition,
  ServiceReportExport,
  ServiceReportExportPage,
  ServiceReportOverview,
  ServiceSchedule,
  ServiceTechnicianSchedulePolicy,
  ServiceWorkOrder,
  ServiceWorkOrderPhoto,
  ServiceWorkOrderPage,
  FinancialDocument,
  FinancialDocumentReferenceData,
  LogisticsDelivery,
  LogisticsReferenceData,
  LogisticsReturn,
  LogisticsRoutePlan,
  ManagedFile,
  ServiceCareOverview,
  ServiceInspectionPlan,
  WarrantyClaim,
  CrmTicket,
  CrmTicketReferenceData,
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
import { NotificationDispatcherService } from '../src/notifications/notification-dispatcher.service.js';
import { ObjectStorageService } from '../src/storage/object-storage.service.js';

const runInfrastructureTests = process.env['RUN_INFRASTRUCTURE_TESTS'] === 'true';
const password = 'Vista-Sales-Test-8!';

describe.skipIf(!runInfrastructureTests)('quotation to invoice-draft sales workflow', () => {
  let adminDatabase: Pool;
  let application: INestApplication;
  let creatorAccountId: string;
  let database: Pool;
  let databaseName: string;
  let token: string;
  let viewerAccountId: string;
  let viewerToken: string;
  let customerId: string;
  let customerLocationId: string;
  let cashOperatorId: string;
  let cashRegisterId: string;
  let equipmentId: string;
  let productId: string;
  let serialProductId: string;
  let warehouseId: string;
  let technicianWarehouseId: string;
  let serialNumber: string;
  let salesInvoiceId: string;
  let salesShipmentId: string;
  let serialShipmentLineId: string;
  let registeredLogisticsReturnId: string;
  let registeredLogisticsReturnVersion: number;
  const storedObjects = new Map<string, Buffer>();
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
    expect(await migrateDown(database, migrationDirectory)).toBe('0063_erp_operational_reports');
    expect(await migrateUp(database, migrationDirectory)).toContain('0063_erp_operational_reports');

    Object.assign(process.env, {
      // This suite deliberately sends many invalid/replayed reporting commands.
      // Rate-limit enforcement has its own dedicated integration suite.
      API_RATE_LIMIT_WRITE_MAX: '1000',
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
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ObjectStorageService)
      .useValue({
        bucketName: () => 'vista-integration-test',
        deleteObject: (key: string) => {
          storedObjects.delete(key);
          return Promise.resolve();
        },
        getObject: (key: string) => {
          const value = storedObjects.get(key);
          return value ? Promise.resolve(value) : Promise.reject(new Error('Object not found'));
        },
        ping: () => Promise.resolve(1),
        putObject: ({ body, key }: { body: Buffer; key: string }) => {
          storedObjects.set(key, Buffer.from(body));
          return Promise.resolve();
        },
      })
      .compile();
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
    viewerAccountId = viewerId;
    await grantPermissions(database, creatorId, ['create', 'edit', 'view']);
    await grantPermissions(database, viewerId, ['view']);
    await grantFinancePermissions(database, creatorId, ['create', 'edit', 'view']);
    await grantFinancePermissions(database, viewerId, ['view']);
    await grantServicePermissions(database, creatorId, ['approve', 'create', 'edit', 'view']);
    await grantWarehouseViewPermission(database, creatorId);
    await grantCrmPermissions(database, creatorId, ['create', 'edit', 'view']);
    await grantLogisticsPermissions(database, creatorId, ['create', 'edit', 'view']);
    await grantLogisticsPermissions(database, viewerId, ['view']);
    ({
      customerId,
      customerLocationId,
      equipmentId,
      productId,
      serialNumber,
      serialProductId,
      warehouseId,
    } = await seedSalesData(database, creatorId, runId));
    ({ cashOperatorId, cashRegisterId, technicianWarehouseId } =
      await seedServiceTechnicianWarehouse(database, creatorId, productId, runId));
    await seedServiceSchedulePolicy(database, creatorId, creatorId);
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

  it('saves private report options safely and rejects unapproved fields and periods', async () => {
    const saved = {
      id: randomUUID(),
      name: 'Monthly suppliers',
      definitionKey: 'finance.supplier-turnover',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
      format: 'csv',
      columns: ['partnerName', 'grossBgnTotal'],
    };
    const endpoint = '/api/v1/finance/saved-reports';
    await request(application.getHttpServer()).post(endpoint).send(saved).expect(401);
    await request(application.getHttpServer())
      .post(endpoint)
      .set('authorization', `Bearer ${viewerToken}`)
      .send(saved)
      .expect(403);
    const send = (body: object) =>
      request(application.getHttpServer())
        .post(endpoint)
        .set('authorization', `Bearer ${token}`)
        .send(body);
    const responses = await Promise.all([send(saved), send(saved)]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(responses[0]?.body).toEqual(saved);
    await send({ ...saved, name: 'Different request' }).expect(409);
    for (const invalid of [
      { columns: [] },
      { columns: ['partnerName', 'partnerName'] },
      { columns: ['password_hash'] },
      { dateFrom: '2026-02-30' },
      { dateFrom: '2026-10-01' },
      { dateTo: undefined },
      { dateFrom: '2026-09-01T00:00:00Z' },
      { name: '  ' },
      { sql: 'SELECT * FROM identity.user_accounts' },
    ])
      await send({ ...saved, id: randomUUID(), ...invalid }).expect(400);
    const owner = await request(application.getHttpServer())
      .get(endpoint)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(owner.body.items).toEqual([saved]);
    const other = await request(application.getHttpServer())
      .get(endpoint)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(other.body.total).toBe(0);
    const evidence = await database.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM audit.events WHERE target_id=$1 AND action='report.view.created'",
      [saved.id],
    );
    expect(evidence.rows[0]?.count).toBe(1);
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
    salesShipmentId = shipped.shipment!.id;
    serialShipmentLineId = shipped.shipment!.lines.find(
      (line) => line.productId === serialProductId,
    )!.id;

    const acceptedResponse = await request(application.getHttpServer())
      .post(`/api/v1/sales/handover-certificates/${shipped.handover?.id}/accept`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `sales-handover-${runId}`)
      .send({
        acceptanceNotes: 'Equipment received in good condition.',
        acceptedByName: 'Customer Representative',
        customerLocationId,
        expectedVersion: shipped.handover?.version,
      })
      .expect(200);
    const accepted = acceptedResponse.body as SalesWorkflow;
    expect(accepted.handover).toMatchObject({
      acceptanceNotes: 'Equipment received in good condition.',
      acceptedByName: 'Customer Representative',
      customerLocationId,
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

  it('plans and completes delivery, routes the stop, and receives a repair return safely', async () => {
    const referencesResponse = await request(application.getHttpServer())
      .get('/api/v1/logistics/reference-data')
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    const references = referencesResponse.body as LogisticsReferenceData;
    expect(references).toMatchObject({
      courierConnections: [
        { connected: false, provider: 'econt' },
        { connected: false, provider: 'speedy' },
      ],
    });
    expect(references.shipments).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: salesShipmentId })]),
    );
    expect(references.locations).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: customerLocationId })]),
    );

    await request(application.getHttpServer())
      .post('/api/v1/logistics/deliveries')
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `logistics-viewer-${runId}`)
      .send({})
      .expect(403);

    const deliveryKey = `logistics-delivery-${runId}`;
    const deliveryInput = {
      customerLocationId,
      deliveryMethod: 'company_transport',
      instructions: 'Call the customer before arrival.',
      scheduledEnd: '2026-08-26T09:00:00.000Z',
      scheduledStart: '2026-08-26T07:00:00.000Z',
      shipmentId: salesShipmentId,
    };
    const deliveryResponse = await request(application.getHttpServer())
      .post('/api/v1/logistics/deliveries')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', deliveryKey)
      .send(deliveryInput)
      .expect(201);
    const delivery = deliveryResponse.body as LogisticsDelivery;
    expect(delivery).toMatchObject({
      customerLocationId,
      deliveryMethod: 'company_transport',
      shipmentId: salesShipmentId,
      status: 'planned',
      version: 1,
    });
    const deliveryReplay = await request(application.getHttpServer())
      .post('/api/v1/logistics/deliveries')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', deliveryKey)
      .send(deliveryInput)
      .expect(201);
    expect((deliveryReplay.body as LogisticsDelivery).id).toBe(delivery.id);

    const routeResponse = await request(application.getHttpServer())
      .post('/api/v1/logistics/routes')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `logistics-route-${runId}`)
      .send({
        assignedAccountId: creatorAccountId,
        notes: 'Customer delivery route.',
        routeDate: '2026-08-26',
        stops: [
          {
            deliveryId: delivery.id,
            plannedArrival: '2026-08-26T07:30:00.000Z',
            plannedDurationMinutes: 30,
            stopType: 'delivery',
          },
        ],
        title: 'Vratsa customer run',
      })
      .expect(201);
    const route = routeResponse.body as LogisticsRoutePlan;
    expect(route).toMatchObject({
      assignedAccountId: creatorAccountId,
      status: 'planned',
      stops: [expect.objectContaining({ deliveryId: delivery.id, stopType: 'delivery' })],
    });

    const dispatchedResponse = await request(application.getHttpServer())
      .post(`/api/v1/logistics/deliveries/${delivery.id}/dispatch`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `logistics-dispatch-${runId}`)
      .send({ expectedVersion: delivery.version, note: 'Loaded and checked.' })
      .expect(201);
    const dispatched = dispatchedResponse.body as LogisticsDelivery;
    expect(dispatched).toMatchObject({ status: 'in_transit', version: 2 });

    const completedResponse = await request(application.getHttpServer())
      .post(`/api/v1/logistics/deliveries/${delivery.id}/complete`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `logistics-complete-${runId}`)
      .send({
        deliveredAt: '2026-08-26T08:05:00.000Z',
        expectedVersion: dispatched.version,
        proofNotes: 'Boxes checked at handover.',
        recipientName: 'Customer Representative',
      })
      .expect(201);
    expect(completedResponse.body as LogisticsDelivery).toMatchObject({
      handoverStatus: 'accepted',
      recipientName: 'Customer Representative',
      status: 'delivered',
      version: 3,
    });

    const returnInput = {
      customerLocationId,
      lines: [
        {
          customerEquipmentId: equipmentId,
          destinationWarehouseId: technicianWarehouseId,
          disposition: 'service',
          quantity: '1',
          serialNumbers: [serialNumber],
          serviceType: 'out_of_warranty',
          shipmentLineId: serialShipmentLineId,
        },
      ],
      originalShipmentId: salesShipmentId,
      reason: 'The device does not power on after installation.',
      transportMethod: 'customer_dropoff',
    };
    const returnResponse = await request(application.getHttpServer())
      .post('/api/v1/logistics/returns')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `logistics-return-${runId}`)
      .send(returnInput)
      .expect(201);
    const registeredReturn = returnResponse.body as LogisticsReturn;
    expect(registeredReturn).toMatchObject({
      originalShipmentId: salesShipmentId,
      status: 'registered',
      version: 1,
    });
    registeredLogisticsReturnId = registeredReturn.id;
    registeredLogisticsReturnVersion = registeredReturn.version;

    const evidence = await database.query<{ audit_count: string; outbox_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM audit.events
          WHERE target_id IN ($1, $2, $3) AND action LIKE 'logistics.%') AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events
          WHERE aggregate_id IN ($1, $2, $3) AND event_type LIKE 'logistics.%') AS outbox_count`,
      [delivery.id, route.id, registeredReturn.id],
    );
    expect(evidence.rows[0]).toEqual({ audit_count: '5', outbox_count: '5' });
  });

  it('allocates partial payments once, marks overdue balances, and preserves the collection trail', async () => {
    const originalSalesInvoice = await database.query<{
      subtotal: string;
      total: string;
      vat_total: string;
    }>(
      `SELECT subtotal::text, vat_total::text, total::text
       FROM sales.invoices WHERE id = $1`,
      [salesInvoiceId],
    );
    const originalTotals = originalSalesInvoice.rows[0];
    if (!originalTotals) throw new Error('Sales invoice totals were not available');
    await database.query(
      `UPDATE sales.invoices SET subtotal = 0, vat_total = 0, total = 0 WHERE id = $1`,
      [salesInvoiceId],
    );
    try {
      const zeroReferencesResponse = await request(application.getHttpServer())
        .get('/api/v1/finance/reference-data')
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect((zeroReferencesResponse.body as FinanceReferenceData).invoiceDrafts).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: salesInvoiceId })]),
      );
      const zeroCollectionResponse = await request(application.getHttpServer())
        .post('/api/v1/finance/documents')
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `finance-zero-document-${runId}`)
        .send({ dueDate: '2099-01-01', salesInvoiceId })
        .expect(422);
      expect(zeroCollectionResponse.body.error.code).toBe('FINANCE_ZERO_VALUE_SOURCE');
    } finally {
      await database.query(
        `UPDATE sales.invoices SET subtotal = $2, vat_total = $3, total = $4 WHERE id = $1`,
        [salesInvoiceId, originalTotals.subtotal, originalTotals.vat_total, originalTotals.total],
      );
    }

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

    const supplierInvoiceId = await seedSupplierInvoiceEvidence(
      database,
      creatorAccountId,
      customerId,
      warehouseId,
      productId,
      dueDate,
      runId,
    );
    const supplierReferencesResponse = await request(application.getHttpServer())
      .get('/api/v1/finance/supplier-reference-data')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const supplierReferences = supplierReferencesResponse.body as FinanceSupplierReferenceData;
    expect(supplierReferences.supplierInvoices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: supplierInvoiceId, supplierPartnerId: customerId }),
      ]),
    );
    await request(application.getHttpServer())
      .post('/api/v1/finance/supplier-payables')
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `finance-supplier-viewer-${runId}`)
      .send({ dueDate, supplierInvoiceId })
      .expect(403);
    const payableKey = `finance-supplier-payable-${runId}`;
    const payableResponse = await request(application.getHttpServer())
      .post('/api/v1/finance/supplier-payables')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', payableKey)
      .send({ dueDate, supplierInvoiceId })
      .expect(201);
    let supplierPayable = payableResponse.body as FinanceSupplierPayable;
    expect(supplierPayable).toMatchObject({
      allocatedTotal: '0.0000',
      outstandingTotal: '96.0000',
      paymentStatus: 'unpaid',
      sourceSupplierInvoiceId: supplierInvoiceId,
      supplierPartnerId: customerId,
      total: '96.0000',
    });
    const payableReplay = await request(application.getHttpServer())
      .post('/api/v1/finance/supplier-payables')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', payableKey)
      .send({ dueDate, supplierInvoiceId })
      .expect(201);
    expect((payableReplay.body as FinanceSupplierPayable).id).toBe(supplierPayable.id);

    const advanceResponse = await request(application.getHttpServer())
      .post('/api/v1/finance/supplier-advances')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-supplier-advance-${runId}`)
      .send({
        amount: '30',
        paymentDate: dueDate,
        paymentMethod: 'bank_transfer',
        paymentReference: `ADVANCE-${runId}`,
        supplierPartnerId: customerId,
      })
      .expect(201);
    let advance = advanceResponse.body as FinanceSupplierPayment;
    expect(advance).toMatchObject({
      allocatedTotal: '0.0000',
      amount: '30.0000',
      availableTotal: '30.0000',
      kind: 'advance',
    });
    const allocatedAdvanceResponse = await request(application.getHttpServer())
      .post(`/api/v1/finance/supplier-advances/${advance.id}/allocations`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-supplier-advance-allocation-${runId}`)
      .send({
        amount: '20',
        expectedAdvanceVersion: advance.version,
        expectedPayableVersion: supplierPayable.version,
        supplierPayableId: supplierPayable.id,
      })
      .expect(200);
    advance = allocatedAdvanceResponse.body as FinanceSupplierPayment;
    expect(advance).toMatchObject({
      allocatedTotal: '20.0000',
      availableTotal: '10.0000',
      version: 2,
    });

    const payableAfterAdvanceResponse = await request(application.getHttpServer())
      .get(`/api/v1/finance/supplier-payables/${supplierPayable.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    supplierPayable = payableAfterAdvanceResponse.body as FinanceSupplierPayable;
    expect(supplierPayable).toMatchObject({
      allocatedTotal: '20.0000',
      outstandingTotal: '76.0000',
      paymentStatus: 'partially_paid',
    });

    const supplierPaymentResponse = await request(application.getHttpServer())
      .post(`/api/v1/finance/supplier-payables/${supplierPayable.id}/payments`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-supplier-payment-${runId}`)
      .send({
        amount: '20',
        paymentDate: dueDate,
        paymentMethod: 'card',
        paymentReference: `SUPPLIER-CARD-${runId}`,
      })
      .expect(201);
    supplierPayable = supplierPaymentResponse.body as FinanceSupplierPayable;
    expect(supplierPayable).toMatchObject({
      allocatedTotal: '40.0000',
      outstandingTotal: '56.0000',
      paymentStatus: 'partially_paid',
    });

    const offsetResponse = await request(application.getHttpServer())
      .post('/api/v1/finance/supplier-offsets')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-supplier-offset-${runId}`)
      .send({
        amount: '10',
        customerDocumentId: created.id,
        expectedCustomerDocumentVersion: created.version,
        expectedSupplierPayableVersion: supplierPayable.version,
        offsetDate: dueDate,
        reason: 'Integration-test bilateral compensation',
        supplierPayableId: supplierPayable.id,
      })
      .expect(201);
    const offset = offsetResponse.body as FinanceSupplierOffset;
    expect(offset).toMatchObject({
      amount: '10.0000',
      customerDocumentId: created.id,
      supplierPayableId: supplierPayable.id,
    });
    const offsetReplay = await request(application.getHttpServer())
      .post('/api/v1/finance/supplier-offsets')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-supplier-offset-${runId}`)
      .send({
        amount: '10',
        customerDocumentId: created.id,
        expectedCustomerDocumentVersion: created.version,
        expectedSupplierPayableVersion: supplierPayable.version,
        offsetDate: dueDate,
        reason: 'Integration-test bilateral compensation',
        supplierPayableId: supplierPayable.id,
      })
      .expect(201);
    const replayedOffset = offsetReplay.body as FinanceSupplierOffset;
    expect(replayedOffset.id).toBe(offset.id);
    supplierPayable = (
      await request(application.getHttpServer())
        .get(`/api/v1/finance/supplier-payables/${supplierPayable.id}`)
        .set('authorization', `Bearer ${token}`)
        .expect(200)
    ).body as FinanceSupplierPayable;
    expect(supplierPayable).toMatchObject({
      allocatedTotal: '50.0000',
      outstandingTotal: '46.0000',
    });

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
      allocatedTotal: '110.0000',
      outstandingTotal: '163.6000',
      paymentStatus: 'partially_paid',
    });
    expect(partiallyPaid.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: '100.0000', paymentMethod: 'bank_transfer' }),
        expect.objectContaining({ amount: '10.0000', paymentMethod: 'offset' }),
      ]),
    );

    const cashReferencesResponse = await request(application.getHttpServer())
      .get('/api/v1/finance/cash/reference-data')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const cashReferences = cashReferencesResponse.body as FinanceCashReferenceData;
    const cashRegister = cashReferences.cashRegisters.find((item) => item.id === cashRegisterId);
    expect(cashRegister?.operators.some((item) => item.id === cashOperatorId)).toBe(true);
    expect(cashReferences.openCollections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created.id, outstandingTotal: '163.6000' }),
      ]),
    );
    await request(application.getHttpServer())
      .post('/api/v1/finance/cash/vouchers')
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `finance-cash-viewer-${runId}`)
      .send({})
      .expect(403);

    const cashReceiptInput = {
      amount: '20',
      cashRegisterId,
      customerDocumentId: created.id,
      direction: 'receipt',
      operatorId: cashOperatorId,
      paymentReference: `CASH-${runId}`,
      purpose: 'Customer cash instalment',
      voucherDate: dueDate,
    };
    const cashReceiptResponse = await request(application.getHttpServer())
      .post('/api/v1/finance/cash/vouchers')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-cash-receipt-${runId}`)
      .send(cashReceiptInput)
      .expect(201);
    const cashReceipt = cashReceiptResponse.body as FinanceCashVoucher;
    expect(cashReceipt).toMatchObject({
      amount: '20.0000',
      collectionNumber: created.number,
      customerDocumentId: created.id,
      direction: 'receipt',
      status: 'issued',
    });
    expect(cashReceipt.number).toMatch(/^CRV-/u);
    expect(cashReceipt.paymentNumber).toMatch(/^PAY-/u);
    const cashReceiptReplay = await request(application.getHttpServer())
      .post('/api/v1/finance/cash/vouchers')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-cash-receipt-${runId}`)
      .send(cashReceiptInput)
      .expect(201);
    expect((cashReceiptReplay.body as FinanceCashVoucher).id).toBe(cashReceipt.id);
    await request(application.getHttpServer())
      .post(`/api/v1/finance/cash/vouchers/${cashReceipt.id}/cancel`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-cash-linked-cancel-${runId}`)
      .send({ cancellationReason: 'Linked receipts require reversal.', expectedVersion: 1 })
      .expect(409);

    const concurrentReceipts = await Promise.all(
      ['A', 'B'].map((suffix) =>
        request(application.getHttpServer())
          .post('/api/v1/finance/cash/vouchers')
          .set('authorization', `Bearer ${token}`)
          .set('idempotency-key', `finance-cash-concurrent-${suffix}-${runId}`)
          .send({
            amount: '1',
            cashRegisterId,
            counterpartyName: `Walk-in customer ${suffix}`,
            direction: 'receipt',
            operatorId: cashOperatorId,
            purpose: 'Counter receipt',
            voucherDate: dueDate,
          })
          .expect(201),
      ),
    );
    expect(
      new Set(concurrentReceipts.map(({ body }) => (body as FinanceCashVoucher).number)).size,
    ).toBe(2);

    const cashPaymentResponse = await request(application.getHttpServer())
      .post('/api/v1/finance/cash/vouchers')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-cash-payment-${runId}`)
      .send({
        amount: '5',
        cashRegisterId,
        counterpartyName: 'Office supplier',
        direction: 'payment',
        operatorId: cashOperatorId,
        purpose: 'Office supplies',
        voucherDate: dueDate,
      })
      .expect(201);
    const cashPayment = cashPaymentResponse.body as FinanceCashVoucher;
    expect(cashPayment.number).toMatch(/^CPV-/u);
    const cancelledCashPaymentResponse = await request(application.getHttpServer())
      .post(`/api/v1/finance/cash/vouchers/${cashPayment.id}/cancel`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-cash-payment-cancel-${runId}`)
      .send({ cancellationReason: 'Entered against the wrong expense.', expectedVersion: 1 })
      .expect(200);
    expect(cancelledCashPaymentResponse.body as FinanceCashVoucher).toMatchObject({
      cancellationReason: 'Entered against the wrong expense.',
      status: 'cancelled',
      version: 2,
    });

    const dailyReportResponse = await request(application.getHttpServer())
      .get(`/api/v1/finance/cash/daily-report?cashRegisterId=${cashRegisterId}&date=${dueDate}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const dailyReport = dailyReportResponse.body as FinanceCashDailyReport;
    expect(dailyReport).toMatchObject({
      cashRegisterId,
      closingBalance: '22.0000',
      openingBalance: '0.0000',
      paymentCount: 0,
      paymentTotal: '0.0000',
      receiptCount: 3,
      receiptTotal: '22.0000',
    });
    expect(dailyReport.vouchers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: cashPayment.id, status: 'cancelled' }),
      ]),
    );

    const afterCashResponse = await request(application.getHttpServer())
      .get(`/api/v1/finance/documents/${created.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(afterCashResponse.body as FinanceCustomerDocument).toMatchObject({
      allocatedTotal: '130.0000',
      outstandingTotal: '143.6000',
      paymentStatus: 'partially_paid',
    });
    await request(application.getHttpServer())
      .post(`/api/v1/finance/documents/${created.id}/payments`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-overpayment-${runId}`)
      .send({ ...partialPayment, amount: '144', paymentReference: `OVER-${runId}` })
      .expect(409);

    await database.query(
      `UPDATE finance.customer_documents
       SET document_date = ((now() AT TIME ZONE 'Europe/Sofia')::date - 1),
           due_date = ((now() AT TIME ZONE 'Europe/Sofia')::date - 1)
       WHERE id = $1`,
      [created.id],
    );
    const receivableAgingResponse = await request(application.getHttpServer())
      .get('/api/v1/finance/reports/aging?kind=receivable')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const receivableAging = receivableAgingResponse.body as FinanceAgingReport;
    expect(receivableAging).toMatchObject({
      items: [
        expect.objectContaining({
          bucket: 'days_0_30',
          daysOverdue: 1,
          id: created.id,
          outstandingBgnTotal: '143.6000',
        }),
      ],
      kind: 'receivable',
      totalItems: 1,
      totals: { days0To30: '143.6000', total: '143.6000' },
    });
    const turnoverDateFrom = receivableAging.items[0]?.documentDate;
    if (!turnoverDateFrom) throw new Error('Receivable report did not return its document date');
    const payableAgingResponse = await request(application.getHttpServer())
      .get('/api/v1/finance/reports/aging?kind=payable')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(payableAgingResponse.body as FinanceAgingReport).toMatchObject({
      items: [
        expect.objectContaining({
          bucket: 'current',
          id: supplierPayable.id,
          outstandingBgnTotal: '46.0000',
        }),
      ],
      kind: 'payable',
      totals: { current: '46.0000', total: '46.0000' },
    });
    const customerTurnoverResponse = await request(application.getHttpServer())
      .get(
        `/api/v1/finance/reports/turnover?kind=customer&dateFrom=${turnoverDateFrom}&dateTo=${dueDate}`,
      )
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(customerTurnoverResponse.body as FinanceTurnoverReport).toMatchObject({
      kind: 'customer',
      totals: {
        allocatedBgnTotal: '130.0000',
        documentCount: 1,
        grossBgnTotal: '273.6000',
        outstandingBgnTotal: '143.6000',
      },
    });
    const supplierTurnoverResponse = await request(application.getHttpServer())
      .get(
        `/api/v1/finance/reports/turnover?kind=supplier&dateFrom=${turnoverDateFrom}&dateTo=${dueDate}`,
      )
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(supplierTurnoverResponse.body as FinanceTurnoverReport).toMatchObject({
      kind: 'supplier',
      totals: {
        allocatedBgnTotal: '50.0000',
        documentCount: 1,
        grossBgnTotal: '96.0000',
        outstandingBgnTotal: '46.0000',
      },
    });
    const purchaseJournalResponse = await request(application.getHttpServer())
      .get(
        `/api/v1/finance/reports/journal?kind=purchase&dateFrom=${turnoverDateFrom}&dateTo=${dueDate}`,
      )
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(purchaseJournalResponse.body as FinanceJournalReport).toMatchObject({
      kind: 'purchase',
      totals: {
        documentCount: 1,
        grossBgnTotal: '96.0000',
        incompleteTaxDocuments: 0,
        netBgnTotal: '80.0000',
        vatBgnTotal: '16.0000',
      },
    });
    const vatReviewResponse = await request(application.getHttpServer())
      .get(`/api/v1/finance/reports/vat-review?dateFrom=${turnoverDateFrom}&dateTo=${dueDate}`)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(vatReviewResponse.body as FinanceVatReviewReport).toMatchObject({
      incompletePurchaseDocumentNumbers: [],
      incompletePurchaseDocuments: 0,
      recordedDifferenceBgn: '-16.0000',
      recordedInputVatBgn: '16.0000',
      recordedOutputVatBgn: '0.0000',
    });
    const remindersBeforeStatusJob = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM notifications.messages
       WHERE template_key = 'finance.payment.upcoming'`,
    );
    expect(remindersBeforeStatusJob.rows[0]?.count).toBe('2');

    const handlers = application.get(JobHandlerRegistry);
    const definitionsResponse = await request(application.getHttpServer())
      .get('/api/v1/finance/report-exports/definitions')
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(definitionsResponse.body as FinanceReportDefinition[]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          formats: ['csv', 'xlsx', 'pdf'],
          key: 'finance.supplier-turnover',
          requiresDateRange: true,
        }),
        expect.objectContaining({
          formats: ['csv', 'xlsx', 'pdf'],
          key: 'finance.vat-review',
          requiresDateRange: true,
        }),
      ]),
    );
    await request(application.getHttpServer())
      .post('/api/v1/finance/report-exports')
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `report-viewer-${runId}`)
      .send({
        dateFrom: turnoverDateFrom,
        dateTo: dueDate,
        definitionKey: 'finance.supplier-turnover',
        format: 'xlsx',
      })
      .expect(403);
    const reportKey = `report-export-${runId}`;
    const requestedReportResponse = await request(application.getHttpServer())
      .post('/api/v1/finance/report-exports')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', reportKey)
      .send({
        dateFrom: turnoverDateFrom,
        dateTo: dueDate,
        definitionKey: 'finance.supplier-turnover',
        format: 'xlsx',
      })
      .expect(202);
    const requestedReport = requestedReportResponse.body as FinanceReportExport;
    expect(requestedReport).toMatchObject({
      definitionKey: 'finance.supplier-turnover',
      format: 'xlsx',
      status: 'queued',
    });
    const reportReplay = await request(application.getHttpServer())
      .post('/api/v1/finance/report-exports')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', reportKey)
      .send({
        dateFrom: turnoverDateFrom,
        dateTo: dueDate,
        definitionKey: 'finance.supplier-turnover',
        format: 'xlsx',
      })
      .expect(202);
    expect((reportReplay.body as FinanceReportExport).id).toBe(requestedReport.id);
    const reportJob = {
      attemptNumber: 1,
      correlationId: `report-job-${runId}`,
      enqueuedAt: '2026-08-21T12:00:00.000Z',
      idempotencyKey: `finance-report-export:${requestedReport.id}`,
      jobId: `report-job-${runId}`,
      maxAttempts: 5,
      name: 'report.generate',
      payload: { exportId: requestedReport.id },
      retryAllowed: true,
    };
    await expect(handlers.execute(reportJob)).resolves.toMatchObject({ rowCount: 1 });
    await expect(handlers.execute(reportJob)).resolves.toMatchObject({ rowCount: 1 });
    const reportListResponse = await request(application.getHttpServer())
      .get('/api/v1/finance/report-exports')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const reportList = reportListResponse.body as FinanceReportExportPage;
    expect(reportList).toMatchObject({ total: 1 });
    expect(reportList.items[0]).toMatchObject({
      id: requestedReport.id,
      rowCount: 1,
      status: 'completed',
    });
    expect(reportList.items[0]?.fileName).toMatch(/supplier-turnover.*\.xlsx$/u);
    await request(application.getHttpServer())
      .get(`/api/v1/finance/report-exports/${requestedReport.id}/content`)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(404);
    const downloadedReport = await request(application.getHttpServer())
      .get(`/api/v1/finance/report-exports/${requestedReport.id}/content`)
      .set('authorization', `Bearer ${token}`)
      .expect('content-type', /spreadsheetml/u)
      .expect(200);
    expect(Number(downloadedReport.headers['content-length'])).toBeGreaterThan(2_000);
    const reportEvidence = await database.query<{ audit_count: string; export_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM reporting.export_jobs WHERE id = $1) AS export_count,
         (SELECT count(*)::text FROM audit.events
          WHERE target_id = $1 AND action LIKE 'report.export.%') AS audit_count`,
      [requestedReport.id],
    );
    expect(reportEvidence.rows[0]).toEqual({ audit_count: '3', export_count: '1' });

    const vatExportResponse = await request(application.getHttpServer())
      .post('/api/v1/finance/report-exports')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `vat-report-export-${runId}`)
      .send({
        dateFrom: turnoverDateFrom,
        dateTo: dueDate,
        definitionKey: 'finance.vat-review',
        format: 'csv',
      })
      .expect(202);
    const vatExport = vatExportResponse.body as FinanceReportExport;
    await expect(
      handlers.execute({
        attemptNumber: 1,
        correlationId: `vat-report-job-${runId}`,
        enqueuedAt: '2026-08-21T12:00:00.000Z',
        idempotencyKey: `finance-report-export:${vatExport.id}`,
        jobId: `vat-report-job-${runId}`,
        maxAttempts: 5,
        name: 'report.generate',
        payload: { exportId: vatExport.id },
        retryAllowed: true,
      }),
    ).resolves.toMatchObject({ rowCount: 1 });
    const downloadedVatReport = await request(application.getHttpServer())
      .get(`/api/v1/finance/report-exports/${vatExport.id}/content`)
      .set('authorization', `Bearer ${token}`)
      .expect('content-type', /csv/u)
      .expect(200);
    expect(downloadedVatReport.text).toContain('Recorded input VAT');

    const selectedInput = {
      dateFrom: turnoverDateFrom,
      dateTo: dueDate,
      definitionKey: 'finance.supplier-turnover',
      format: 'csv',
      columns: ['partnerName', 'grossBgnTotal'],
    };
    const selectedResponse = await request(application.getHttpServer())
      .post('/api/v1/finance/report-exports')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `selected-${runId}`)
      .send(selectedInput)
      .expect(202);
    const selected = selectedResponse.body as FinanceReportExport;
    const selectedJob = {
      ...reportJob,
      idempotencyKey: `finance-report-export:${selected.id}`,
      jobId: `selected-${runId}`,
      payload: { exportId: selected.id },
    };
    await handlers.execute(selectedJob);
    await handlers.execute(selectedJob);
    const selectedFile = await request(application.getHttpServer())
      .get(`/api/v1/finance/report-exports/${selected.id}/content`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(selectedFile.text).toContain('Partner,Gross BGN');
    expect(selectedFile.text).not.toContain('Outstanding BGN');
    await request(application.getHttpServer())
      .post('/api/v1/finance/report-exports')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `selected-${runId}`)
      .send({ ...selectedInput, columns: ['partnerName'] })
      .expect(409);
    await request(application.getHttpServer())
      .post('/api/v1/finance/report-exports')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `invalid-selected-${runId}`)
      .send({ ...selectedInput, columns: ['not_a_report_field'] })
      .expect(400);

    const financeJob = {
      attemptNumber: 1,
      correlationId: `finance-job-${runId}`,
      enqueuedAt: '2026-08-14T01:25:00.000Z',
      idempotencyKey: `finance-status-${runId}`,
      jobId: `finance-job-${runId}`,
      maxAttempts: 5,
      name: 'finance.payment-status.detect',
      payload: { scheduledFor: '2026-08-14T01:25:00.000Z' },
      retryAllowed: true,
    };
    const financeJobResult = (await handlers.execute(financeJob)) as {
      notificationCount: number;
      updatedCount: number;
    };
    expect(financeJobResult).toMatchObject({ notificationCount: 1, updatedCount: 1 });
    const replayedFinanceJob = (await handlers.execute(financeJob)) as {
      notificationCount: number;
      updatedCount: number;
    };
    expect(replayedFinanceJob).toMatchObject({ notificationCount: 0, updatedCount: 0 });
    const dispatcher = application.get(NotificationDispatcherService);
    const pendingNotifications = await database.query<{ id: string }>(
      `SELECT id FROM notifications.messages
       WHERE template_key LIKE 'finance.payment.%' AND status = 'pending'
       ORDER BY id`,
    );
    for (const notification of pendingNotifications.rows) {
      await dispatcher.dispatch(notification.id);
    }
    const notificationResponse = await request(application.getHttpServer())
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const notifications = notificationResponse.body as NotificationPage;
    expect(notifications.unreadCount).toBe(3);
    expect(notifications.items.map((message) => message.templateKey).sort()).toEqual([
      'finance.payment.overdue',
      'finance.payment.upcoming',
      'finance.payment.upcoming',
    ]);
    const viewerNotificationResponse = await request(application.getHttpServer())
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect((viewerNotificationResponse.body as NotificationPage).unreadCount).toBe(0);
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
      closingBalance: '1097.6',
      currencyCode: 'BGN',
      lines: [
        {
          amount: '130',
          counterpartyName: `Sales Customer ${runId}`,
          direction: 'incoming',
          paymentReference: `Payment for ${created.number}`,
          transactionDate: dueDate,
          valueDate: dueDate,
        },
        {
          amount: '13.5',
          counterpartyName: `Unrecognized remitter ${runId}`,
          direction: 'incoming',
          paymentReference: `Opaque transfer ${runId}`,
          transactionDate: dueDate,
          valueDate: dueDate,
        },
        {
          amount: '0.1',
          counterpartyName: `Unrecognized remitter ${runId}`,
          direction: 'incoming',
          paymentReference: `Second opaque transfer ${runId}`,
          transactionDate: dueDate,
          valueDate: dueDate,
        },
        {
          amount: '46',
          counterpartyName: `Sales Customer ${runId}`,
          direction: 'outgoing',
          paymentReference: `Payment for ${supplierPayable.number}`,
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
      incomingTotal: '143.6000',
      matchedIncomingCount: 1,
      matchedOutgoingCount: 0,
      status: 'open',
      unmatchedIncomingCount: 2,
      unmatchedOutgoingCount: 1,
    });
    expect(statement.transactions[0]).toMatchObject({
      amount: '130.0000',
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
    expect(unmatched).toMatchObject({ amount: '13.5000', matchStatus: 'unmatched' });
    if (!unmatched) throw new Error('Expected an unmatched bank transaction');
    const candidates = await request(application.getHttpServer())
      .get(`/api/v1/finance/bank-transactions/${unmatched.id}/match-candidates`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(candidates.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          customerDocumentId: created.id,
          referenceMatched: false,
          score: 0,
        }),
      ]),
    );
    const partialMatchResponse = await request(application.getHttpServer())
      .post(`/api/v1/finance/bank-transactions/${unmatched.id}/match`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-bank-match-${runId}`)
      .send({ customerDocumentId: created.id, expectedVersion: unmatched.version })
      .expect(200);
    const partiallyMatchedStatement = partialMatchResponse.body as FinanceBankStatement;
    expect(partiallyMatchedStatement).toMatchObject({
      matchedIncomingCount: 2,
      status: 'open',
      unmatchedIncomingCount: 1,
    });
    const lastUnmatched = partiallyMatchedStatement.transactions[2];
    if (!lastUnmatched) throw new Error('Expected a second unmatched bank transaction');
    const matchedResponse = await request(application.getHttpServer())
      .post(`/api/v1/finance/bank-transactions/${lastUnmatched.id}/match`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-bank-final-match-${runId}`)
      .send({ customerDocumentId: created.id, expectedVersion: lastUnmatched.version })
      .expect(200);
    expect(matchedResponse.body as FinanceBankStatement).toMatchObject({
      matchedIncomingCount: 3,
      status: 'open',
      unmatchedIncomingCount: 0,
      unmatchedOutgoingCount: 1,
    });
    const outgoing = (matchedResponse.body as FinanceBankStatement).transactions.find(
      (transaction) => transaction.direction === 'outgoing',
    );
    if (!outgoing) throw new Error('Expected an outgoing supplier transaction');
    const supplierCandidates = await request(application.getHttpServer())
      .get(`/api/v1/finance/bank-transactions/${outgoing.id}/supplier-match-candidates`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(supplierCandidates.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          referenceMatched: true,
          supplierPayableId: supplierPayable.id,
        }),
      ]),
    );
    const supplierBankMatchResponse = await request(application.getHttpServer())
      .post(`/api/v1/finance/bank-transactions/${outgoing.id}/supplier-match`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-bank-supplier-match-${runId}`)
      .send({
        expectedVersion: outgoing.version,
        mode: 'payable',
        supplierPayableId: supplierPayable.id,
      })
      .expect(200);
    expect(supplierBankMatchResponse.body as FinanceSupplierPayment).toMatchObject({
      amount: '46.0000',
      availableTotal: '0.0000',
      kind: 'payment',
      sourceBankTransactionId: outgoing.id,
    });
    const reconciledBankResponse = await request(application.getHttpServer())
      .get(`/api/v1/finance/bank-statements/${statement.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(reconciledBankResponse.body as FinanceBankStatement).toMatchObject({
      matchedOutgoingCount: 1,
      status: 'reconciled',
      unmatchedOutgoingCount: 0,
    });
    const matchedOutgoing = (reconciledBankResponse.body as FinanceBankStatement).transactions.find(
      (transaction) => transaction.id === outgoing.id,
    );
    expect(matchedOutgoing).toMatchObject({
      matchStatus: 'matched',
    });
    expect(matchedOutgoing?.supplierMatch?.paymentNumber).toMatch(/^SPAY-/u);
    expect(matchedOutgoing?.supplierMatch?.supplierPayableId).toBe(supplierPayable.id);
    const paidSupplierPayable = (
      await request(application.getHttpServer())
        .get(`/api/v1/finance/supplier-payables/${supplierPayable.id}`)
        .set('authorization', `Bearer ${token}`)
        .expect(200)
    ).body as FinanceSupplierPayable;
    expect(paidSupplierPayable).toMatchObject({
      allocatedTotal: '96.0000',
      outstandingTotal: '0.0000',
      paymentStatus: 'paid',
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
    expect(settled.payments).toHaveLength(6);
    expect(settled.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: '20.0000', paymentMethod: 'cash' }),
        expect.objectContaining({ amount: '130.0000', paymentMethod: 'bank_transfer' }),
        expect.objectContaining({ amount: '10.0000', paymentMethod: 'offset' }),
        expect.objectContaining({ amount: '13.5000', paymentMethod: 'bank_transfer' }),
        expect.objectContaining({ amount: '0.1000', paymentMethod: 'bank_transfer' }),
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
      allocation_count: '6',
      audit_count: '18',
      outbox_count: '18',
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
    const salesJournalResponse = await request(application.getHttpServer())
      .get(`/api/v1/finance/reports/journal?kind=sales&dateFrom=${issueDate}&dateTo=${issueDate}`)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(salesJournalResponse.body as FinanceJournalReport).toMatchObject({
      kind: 'sales',
      totals: {
        documentCount: 1,
        grossBgnTotal: '273.6000',
        incompleteTaxDocuments: 0,
        netBgnTotal: '228.0000',
        vatBgnTotal: '45.6000',
      },
    });
    const combinedVatResponse = await request(application.getHttpServer())
      .get(`/api/v1/finance/reports/vat-review?dateFrom=${issueDate}&dateTo=${issueDate}`)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(combinedVatResponse.body as FinanceVatReviewReport).toMatchObject({
      incompletePurchaseDocumentNumbers: [],
      incompletePurchaseDocuments: 0,
      recordedDifferenceBgn: '29.6000',
      recordedInputVatBgn: '16.0000',
      recordedOutputVatBgn: '45.6000',
    });

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
    const naturalReplay = await request(application.getHttpServer())
      .post('/api/v1/finance/financial-documents')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `financial-document-natural-replay-${runId}`)
      .send(invoiceInput)
      .expect(201);
    expect((naturalReplay.body as FinancialDocument).id).toBe(invoice.id);

    const registerScopedInvoiceResponse = await request(application.getHttpServer())
      .post('/api/v1/finance/financial-documents')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `financial-document-register-scope-${runId}`)
      .send({
        ...invoiceInput,
        cashRegisterId,
        lines: [
          {
            description: 'Register-scoped numbering check',
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
      .expect(201);
    const registerScopedInvoice = registerScopedInvoiceResponse.body as FinancialDocument;
    expect(registerScopedInvoice.number).not.toBe(invoice.number);
    expect(registerScopedInvoice.number).toMatch(/^DINV-.+-[A-F0-9]{12}-\d{4}-\d{6}$/u);

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
    expect(register.body).toMatchObject({ page: 1, pageSize: 10, totalItems: 7 });

    const evidence = await database.query<{ audit_count: string; outbox_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM audit.events
          WHERE action LIKE 'finance.financial-document.%') AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events
          WHERE event_type LIKE 'finance.financial-document.%') AS outbox_count`,
    );
    expect(evidence.rows[0]).toEqual({ audit_count: '8', outbox_count: '8' });
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

  it('manages warranty claims, inspections, reminders, and planned Service visits without duplicate work', async () => {
    await request(application.getHttpServer())
      .get('/api/v1/service/care')
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(403);

    const claimKey = `service-warranty-claim-${runId}`;
    const claimInput = {
      customerEquipmentId: equipmentId,
      customerLocationId,
      customerPartnerId: customerId,
      description: 'The fiscal register display loses contrast during operation.',
    };
    const claimResponse = await request(application.getHttpServer())
      .post('/api/v1/service/warranty-claims')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', claimKey)
      .send(claimInput)
      .expect(201);
    const claim = claimResponse.body as WarrantyClaim;
    expect(claim).toMatchObject({
      customerEquipmentId: equipmentId,
      status: 'received',
      version: 1,
    });
    expect(claim.number).toMatch(/^WCL-\d{4}-\d{6}$/u);

    const claimReplay = await request(application.getHttpServer())
      .post('/api/v1/service/warranty-claims')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', claimKey)
      .send(claimInput)
      .expect(201);
    expect((claimReplay.body as WarrantyClaim).id).toBe(claim.id);

    const reviewResponse = await request(application.getHttpServer())
      .post(`/api/v1/service/warranty-claims/${claim.id}/transition`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-warranty-review-${runId}`)
      .send({ expectedVersion: 1, nextStatus: 'under_review' })
      .expect(200);
    const review = reviewResponse.body as WarrantyClaim;
    expect(review).toMatchObject({ status: 'under_review', version: 2 });

    await request(application.getHttpServer())
      .post(`/api/v1/service/warranty-claims/${claim.id}/transition`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-warranty-missing-note-${runId}`)
      .send({ expectedVersion: 2, nextStatus: 'approved' })
      .expect(400);

    const approvedResponse = await request(application.getHttpServer())
      .post(`/api/v1/service/warranty-claims/${claim.id}/transition`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-warranty-approve-${runId}`)
      .send({
        expectedVersion: 2,
        nextStatus: 'approved',
        note: 'The display fault is covered by the active warranty.',
      })
      .expect(200);
    expect(approvedResponse.body as WarrantyClaim).toMatchObject({
      decisionNote: 'The display fault is covered by the active warranty.',
      status: 'approved',
      version: 3,
    });

    const uploadedResponse = await request(application.getHttpServer())
      .post('/api/v1/files')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-warranty-file-${runId}`)
      .field('parentType', 'warranty_claim')
      .field('parentId', claim.id)
      .attach('file', Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF'), {
        contentType: 'application/pdf',
        filename: 'warranty-assessment.pdf',
      })
      .expect(201);
    const attachment = uploadedResponse.body as ManagedFile;
    expect(attachment).toMatchObject({
      originalName: 'warranty-assessment.pdf',
      parentId: claim.id,
      parentType: 'warranty_claim',
      status: 'available',
    });

    const planKey = `service-inspection-plan-${runId}`;
    const planInput = {
      customerEquipmentId: equipmentId,
      inspectionType: 'technical',
      intervalMonths: 12,
      nextDueDate: '2026-09-02',
      reminderLeadDays: 30,
    };
    const planResponse = await request(application.getHttpServer())
      .post('/api/v1/service/inspection-plans')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', planKey)
      .send(planInput)
      .expect(201);
    const plan = planResponse.body as ServiceInspectionPlan;
    expect(plan).toMatchObject({ nextDueDate: '2026-09-02', version: 1 });

    const planReplay = await request(application.getHttpServer())
      .post('/api/v1/service/inspection-plans')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', planKey)
      .send(planInput)
      .expect(201);
    expect((planReplay.body as ServiceInspectionPlan).id).toBe(plan.id);

    const handlers = application.get(JobHandlerRegistry);
    const inspectionJob = {
      attemptNumber: 1,
      correlationId: `inspection-reminder-${runId}`,
      enqueuedAt: '2026-08-26T01:35:00.000Z',
      idempotencyKey: `inspection-reminder-2026-08-26-${runId}`,
      jobId: `inspection-reminder-${runId}`,
      maxAttempts: 5,
      name: 'service.inspection-reminder.prepare',
      payload: { asOf: '2026-08-26' },
      retryAllowed: true,
    } as const;
    await expect(handlers.execute(inspectionJob)).resolves.toMatchObject({
      notificationCount: 1,
    });
    await expect(handlers.execute({ ...inspectionJob, attemptNumber: 2 })).resolves.toMatchObject({
      deduplicated: true,
      notificationCount: 0,
    });

    const completedPlanResponse = await request(application.getHttpServer())
      .post(`/api/v1/service/inspection-plans/${plan.id}/complete`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-inspection-complete-${runId}`)
      .send({
        completedOn: '2026-09-02',
        expectedVersion: 1,
        notes: 'All technical checks passed.',
        outcome: 'passed',
      })
      .expect(200);
    expect(completedPlanResponse.body as ServiceInspectionPlan).toMatchObject({
      lastCompletedOn: '2026-09-02',
      nextDueDate: '2027-09-02',
      records: [expect.objectContaining({ outcome: 'passed' })],
      version: 2,
    });

    const planVisitJob = {
      attemptNumber: 1,
      correlationId: `plan-visit-${runId}`,
      enqueuedAt: '2026-08-26T01:45:00.000Z',
      idempotencyKey: `plan-visit-2026-08-26-${runId}`,
      jobId: `plan-visit-${runId}`,
      maxAttempts: 5,
      name: 'service.plan-visit.generate',
      payload: { asOf: '2026-08-26' },
      retryAllowed: true,
    } as const;
    await expect(handlers.execute(planVisitJob)).resolves.toMatchObject({ generatedCount: 1 });
    await expect(handlers.execute({ ...planVisitJob, attemptNumber: 2 })).resolves.toMatchObject({
      deduplicated: true,
      generatedCount: 0,
    });

    const overviewResponse = await request(application.getHttpServer())
      .get('/api/v1/service/care')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const overview = overviewResponse.body as ServiceCareOverview;
    expect(overview.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attachments: [expect.objectContaining({ id: attachment.id })],
          id: claim.id,
          status: 'approved',
        }),
      ]),
    );
    expect(overview.inspections).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: plan.id, nextDueDate: '2027-09-02' })]),
    );

    const requestPageResponse = await request(application.getHttpServer())
      .get('/api/v1/service/requests?page=1&pageSize=100')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect((requestPageResponse.body as ServiceRequestPage).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ plannedVisitDate: '2026-10-01', sourceChannel: 'service_plan' }),
      ]),
    );

    const evidence = await database.query<{
      audit_count: string;
      generation_count: string;
      notification_count: string;
      outbox_count: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM audit.events
          WHERE action IN ('service.warranty-claim.created',
            'service.warranty-claim.status-changed', 'service.inspection-plan.created',
            'service.inspection.completed', 'service.plan-visit.generated')) AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events
          WHERE event_type IN ('service.warranty-claim.created',
            'service.warranty-claim.status-changed', 'service.inspection-plan.created',
            'service.inspection.completed', 'service.plan-visit.generated')) AS outbox_count,
         (SELECT count(*)::text FROM service.subscription_visit_generations) AS generation_count,
         (SELECT count(*)::text FROM notifications.messages
          WHERE template_key = 'service.inspection.due') AS notification_count`,
    );
    expect(evidence.rows[0]).toEqual({
      audit_count: '6',
      generation_count: '1',
      notification_count: '1',
      outbox_count: '6',
    });
  });

  it('keeps CRM tickets, SLA events, and ERP Service requests linked without loops', async () => {
    const categoryId = randomUUID();
    const policyId = randomUUID();
    await database.query(
      `INSERT INTO crm.ticket_categories (id, code, name)
       VALUES ($1,$2,'Technical support')`,
      [categoryId, `technical_${runId}`],
    );
    await database.query(
      `INSERT INTO crm.sla_policies (
         id, name, priority, response_minutes, resolution_minutes,
         risk_threshold_percent, escalation_account_id
       ) VALUES ($1,'Integration test SLA','normal',60,240,80,$2)`,
      [policyId, creatorAccountId],
    );

    await request(application.getHttpServer())
      .get('/api/v1/crm/tickets')
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(403);

    const referenceResponse = await request(application.getHttpServer())
      .get('/api/v1/crm/tickets/reference-data')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const references = referenceResponse.body as CrmTicketReferenceData;
    expect(references.categories).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: categoryId })]),
    );
    expect(references.slaPolicies).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: policyId })]),
    );

    const ticketInput = {
      assignedToAccountId: creatorAccountId,
      categoryId,
      channel: 'telephone',
      customerEquipmentId: equipmentId,
      customerLocationId,
      customerPartnerId: customerId,
      description: 'The customer reports a device fault that needs a technician visit.',
      priority: 'normal',
      slaPolicyId: policyId,
      subject: 'Customer device needs inspection',
    };
    const ticketKey = `crm-ticket-${runId}`;
    const createdResponse = await request(application.getHttpServer())
      .post('/api/v1/crm/tickets')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', ticketKey)
      .send(ticketInput)
      .expect(201);
    const created = createdResponse.body as CrmTicket;
    expect(created).toMatchObject({ status: 'new', version: 1 });
    expect(created.number).toMatch(/^TKT-\d{4}-\d{6}$/u);

    const replayResponse = await request(application.getHttpServer())
      .post('/api/v1/crm/tickets')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', ticketKey)
      .send(ticketInput)
      .expect(201);
    expect((replayResponse.body as CrmTicket).id).toBe(created.id);

    const responseResult = await request(application.getHttpServer())
      .post(`/api/v1/crm/tickets/${created.id}/respond`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `crm-ticket-response-${runId}`)
      .send({
        expectedVersion: 1,
        note: 'We have received the issue and are arranging a technician visit.',
      })
      .expect(200);
    expect(responseResult.body as CrmTicket).toMatchObject({
      responseState: 'met',
      status: 'in_progress',
      version: 2,
    });

    const serviceLinkResponse = await request(application.getHttpServer())
      .post(`/api/v1/crm/tickets/${created.id}/service-request`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `crm-ticket-service-${runId}`)
      .send({ expectedVersion: 2, serviceType: 'out_of_warranty' })
      .expect(201);
    const linked = serviceLinkResponse.body as CrmTicket;
    expect(linked.serviceLink?.serviceRequestNumber).toMatch(/^SRV-\d{4}-\d{6}$/u);
    expect(linked.version).toBe(3);

    const loopSafeResponse = await request(application.getHttpServer())
      .post(`/api/v1/crm/tickets/from-service-request/${linked.serviceLink?.serviceRequestId}`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `crm-ticket-loop-${runId}`)
      .send({ categoryId, priority: 'normal', slaPolicyId: policyId })
      .expect(201);
    expect((loopSafeResponse.body as CrmTicket).id).toBe(created.id);

    const serviceRequestResponse = await request(application.getHttpServer())
      .post('/api/v1/service/requests')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `crm-source-service-${runId}`)
      .send({
        customerEquipmentId: equipmentId,
        customerLocationId,
        customerPartnerId: customerId,
        priority: 'normal',
        problemDescription: 'A second customer issue started in the Service team.',
        serviceType: 'out_of_warranty',
        sourceChannel: 'email',
      })
      .expect(201);
    const sourceRequest = serviceRequestResponse.body as ServiceRequest;
    const fromServiceResponse = await request(application.getHttpServer())
      .post(`/api/v1/crm/tickets/from-service-request/${sourceRequest.id}`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `crm-from-service-${runId}`)
      .send({
        assignedToAccountId: creatorAccountId,
        categoryId,
        priority: 'normal',
        slaPolicyId: policyId,
      })
      .expect(201);
    const fromService = fromServiceResponse.body as CrmTicket;
    expect(fromService).toMatchObject({
      serviceLink: { serviceRequestId: sourceRequest.id },
      status: 'new',
    });

    await database.query(
      `UPDATE crm.tickets SET created_at = now() - INTERVAL '5 hours',
         response_due_at = now() - INTERVAL '4 hours',
         resolution_due_at = now() - INTERVAL '1 hour'
       WHERE id = $1`,
      [fromService.id],
    );
    const handlers = application.get(JobHandlerRegistry);
    const slaJob = {
      attemptNumber: 1,
      correlationId: `crm-sla-${runId}`,
      enqueuedAt: '2026-08-26T12:00:00.000Z',
      idempotencyKey: `crm-sla-${runId}`,
      jobId: `crm-sla-${runId}`,
      maxAttempts: 5,
      name: 'crm.sla.evaluate',
      payload: { asOf: new Date(Date.now() + 60_000).toISOString() },
      retryAllowed: true,
    } as const;
    const slaResult = await handlers.execute(slaJob);
    expect(slaResult).toMatchObject({ notificationCount: 2 });
    await expect(handlers.execute({ ...slaJob, attemptNumber: 2 })).resolves.toMatchObject({
      deduplicated: true,
      notificationCount: 0,
    });

    const dispatcher = application.get(NotificationDispatcherService);
    for (const notificationId of (slaResult as { notificationIds: string[] }).notificationIds) {
      await dispatcher.dispatch(notificationId);
    }
    const notificationResponse = await request(application.getHttpServer())
      .get('/api/v1/notifications?page=1&pageSize=100')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect((notificationResponse.body as NotificationPage).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ templateKey: 'crm.ticket.sla.breached' })]),
    );

    const evidence = await database.query<{
      audit_count: string;
      link_count: string;
      notification_count: string;
      outbox_count: string;
      ticket_count: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM crm.tickets) AS ticket_count,
         (SELECT count(*)::text FROM crm.ticket_service_links) AS link_count,
         (SELECT count(*)::text FROM notifications.messages
           WHERE template_key LIKE 'crm.ticket.sla.%') AS notification_count,
         (SELECT count(*)::text FROM audit.events
           WHERE action LIKE 'crm.ticket.%') AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events
           WHERE event_type LIKE 'crm.ticket.%') AS outbox_count`,
    );
    expect(evidence.rows[0]).toEqual({
      audit_count: '4',
      link_count: '2',
      notification_count: '2',
      outbox_count: '4',
      ticket_count: '2',
    });
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

    const schedulePolicyInput = {
      expectedVersion: 1,
      windows: Array.from({ length: 7 }, (_, index) => ({
        capacityMinutes: 540,
        endsAt: '18:00',
        maxVisits: 5,
        startsAt: '08:00',
        weekday: index + 1,
      })),
    };
    await request(application.getHttpServer())
      .put(`/api/v1/service/technicians/${creatorAccountId}/schedule-policy`)
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `service-schedule-viewer-${runId}`)
      .send(schedulePolicyInput)
      .expect(403);
    const schedulePolicyKey = `service-schedule-policy-${runId}`;
    const policyResponse = await request(application.getHttpServer())
      .put(`/api/v1/service/technicians/${creatorAccountId}/schedule-policy`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', schedulePolicyKey)
      .send(schedulePolicyInput)
      .expect(200);
    const schedulePolicy = policyResponse.body as ServiceTechnicianSchedulePolicy;
    expect(schedulePolicy).toMatchObject({
      configured: true,
      technicianAccountId: creatorAccountId,
      version: 2,
    });
    expect(schedulePolicy.windows).toEqual(
      expect.arrayContaining([expect.objectContaining({ capacityMinutes: 540, weekday: 1 })]),
    );
    expect(schedulePolicy.windows).toHaveLength(7);
    const policyReplay = await request(application.getHttpServer())
      .put(`/api/v1/service/technicians/${creatorAccountId}/schedule-policy`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', schedulePolicyKey)
      .send(schedulePolicyInput)
      .expect(200);
    expect((policyReplay.body as ServiceTechnicianSchedulePolicy).version).toBe(2);
    const stalePolicy = await request(application.getHttpServer())
      .put(`/api/v1/service/technicians/${creatorAccountId}/schedule-policy`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-schedule-policy-stale-${runId}`)
      .send(schedulePolicyInput)
      .expect(409);
    expect(stalePolicy.body.error.code).toBe('SERVICE_SCHEDULE_POLICY_VERSION_CONFLICT');

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
      totalPages: 1,
    });
    expect(requestPage.summary.new).toBeGreaterThanOrEqual(2);
    expect(requestPage.total).toBeGreaterThanOrEqual(2);
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

    const conflictingScheduleRequestResponse = await request(application.getHttpServer())
      .post('/api/v1/service/requests')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-schedule-conflict-create-${runId}`)
      .send({
        ...requestInput,
        problemDescription: 'Second visit used to verify technician scheduling controls.',
      })
      .expect(201);
    const conflictingScheduleRequest = conflictingScheduleRequestResponse.body as ServiceRequest;
    const deliveryRouteOverlap = await request(application.getHttpServer())
      .post(`/api/v1/service/requests/${conflictingScheduleRequest.id}/assign`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-route-overlap-${runId}`)
      .send({
        expectedVersion: conflictingScheduleRequest.version,
        scheduledEnd: '2026-08-26T08:00:00.000Z',
        scheduledStart: '2026-08-26T07:30:00.000Z',
        technicianAccountId: creatorAccountId,
        technicianWarehouseId,
      })
      .expect(409);
    expect(deliveryRouteOverlap.body.error.code).toBe('SERVICE_TECHNICIAN_ROUTE_OVERLAP');
    const outsideHours = await request(application.getHttpServer())
      .post(`/api/v1/service/requests/${conflictingScheduleRequest.id}/assign`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-schedule-outside-${runId}`)
      .send({
        expectedVersion: conflictingScheduleRequest.version,
        scheduledEnd: '2099-09-01T05:00:00.000Z',
        scheduledStart: '2099-09-01T04:00:00.000Z',
        technicianAccountId: creatorAccountId,
        technicianWarehouseId,
      })
      .expect(409);
    expect(outsideHours.body.error.code).toBe('SERVICE_TECHNICIAN_OUTSIDE_AVAILABILITY');
    const overlappingVisit = await request(application.getHttpServer())
      .post(`/api/v1/service/requests/${conflictingScheduleRequest.id}/assign`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-schedule-overlap-${runId}`)
      .send({
        expectedVersion: conflictingScheduleRequest.version,
        scheduledEnd: '2099-09-01T10:30:00.000Z',
        scheduledStart: '2099-09-01T09:30:00.000Z',
        technicianAccountId: creatorAccountId,
        technicianWarehouseId,
      })
      .expect(409);
    expect(overlappingVisit.body.error.code).toBe('SERVICE_TECHNICIAN_SCHEDULE_OVERLAP');

    const scheduleResponse = await request(application.getHttpServer())
      .get('/api/v1/service/schedule?dateFrom=2099-09-01&dateTo=2099-09-07')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const schedule = scheduleResponse.body as ServiceSchedule;
    expect(schedule.businessTimezone).toBe('Europe/Sofia');
    expect(schedule.dateFrom).toBe('2099-09-01');
    expect(schedule.dateTo).toBe('2099-09-07');
    expect(schedule.technicians).toHaveLength(1);
    expect(schedule.technicians[0]?.bookedMinutes).toBe(60);
    expect(schedule.technicians[0]?.capacityMinutes).toBe(3780);
    expect(schedule.technicians[0]?.technician.accountId).toBe(creatorAccountId);
    expect(schedule.technicians[0]?.visitCount).toBe(1);
    expect(schedule.technicians[0]?.days).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bookedMinutes: 60,
          capacityMinutes: 540,
          date: '2099-09-01',
          visits: [expect.objectContaining({ workOrderId: assigned.workOrderId })],
        }),
      ]),
    );

    const logisticsReferencesResponse = await request(application.getHttpServer())
      .get('/api/v1/logistics/reference-data')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const logisticsReferences = logisticsReferencesResponse.body as LogisticsReferenceData;
    expect(logisticsReferences.businessTimezone).toBe('Europe/Sofia');
    expect(logisticsReferences.serviceStops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assignedAccountId: creatorAccountId,
          id: assigned.workOrderId,
          scheduledEnd: '2099-09-01T10:00:00.000Z',
          scheduledStart: '2099-09-01T09:00:00.000Z',
        }),
      ]),
    );
    const wrongRouteAssignee = await request(application.getHttpServer())
      .post('/api/v1/logistics/routes')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-route-wrong-assignee-${runId}`)
      .send({
        assignedAccountId: viewerAccountId,
        routeDate: '2099-09-01',
        stops: [
          {
            plannedArrival: '2099-09-01T09:00:00.000Z',
            plannedDurationMinutes: 60,
            serviceWorkOrderId: assigned.workOrderId,
            stopType: 'service',
          },
        ],
        title: 'Wrong technician route',
      })
      .expect(409);
    expect(wrongRouteAssignee.body.error.code).toBe('LOGISTICS_ROUTE_SERVICE_ASSIGNEE_MISMATCH');
    const wrongServiceTime = await request(application.getHttpServer())
      .post('/api/v1/logistics/routes')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-route-wrong-time-${runId}`)
      .send({
        assignedAccountId: creatorAccountId,
        routeDate: '2099-09-01',
        stops: [
          {
            plannedArrival: '2099-09-01T10:00:00.000Z',
            plannedDurationMinutes: 60,
            serviceWorkOrderId: assigned.workOrderId,
            stopType: 'service',
          },
        ],
        title: 'Wrong appointment time',
      })
      .expect(409);
    expect(wrongServiceTime.body.error.code).toBe('LOGISTICS_ROUTE_SERVICE_TIME_MISMATCH');
    const serviceRouteResponse = await request(application.getHttpServer())
      .post('/api/v1/logistics/routes')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-route-${runId}`)
      .send({
        assignedAccountId: creatorAccountId,
        notes: 'Service appointment route.',
        routeDate: '2099-09-01',
        stops: [
          {
            plannedArrival: '2099-09-01T09:00:00.000Z',
            plannedDurationMinutes: 60,
            serviceWorkOrderId: assigned.workOrderId,
            stopType: 'service',
          },
        ],
        title: 'Technician Service route',
      })
      .expect(201);
    expect(serviceRouteResponse.body as LogisticsRoutePlan).toMatchObject({
      assignedAccountId: creatorAccountId,
      routeDate: '2099-09-01',
      stops: [expect.objectContaining({ serviceWorkOrderId: assigned.workOrderId })],
    });

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

    const financeReferencesResponse = await request(application.getHttpServer())
      .get('/api/v1/finance/financial-documents/reference-data')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const financeReferences = financeReferencesResponse.body as FinancialDocumentReferenceData;
    const serviceDraft = financeReferences.serviceDrafts.find((draft) => draft.id === completed.id);
    const financeScope = financeReferences.scopes[0];
    expect(serviceDraft).toMatchObject({
      currencyCode: 'BGN',
      customerPartnerId: customerId,
      linkedDocumentTypes: [],
      number: completed.number,
      total: '57.0000',
    });
    expect(serviceDraft?.lines).toEqual([
      expect.objectContaining({
        description: `Service labour · ${completed.number}`,
        unitPrice: '40.0000',
      }),
      expect.objectContaining({ productId, quantity: '1.0000', unitPrice: '7.0000' }),
      expect.objectContaining({
        description: `Transport · ${completed.number}`,
        unitPrice: '10.0000',
      }),
    ]);
    if (!serviceDraft || !financeScope)
      throw new Error('Completed Service work was not offered to Finance');
    const businessDate = (
      await database.query<{ date: string }>(
        "SELECT (now() AT TIME ZONE 'Europe/Sofia')::date::text AS date",
      )
    ).rows[0]?.date;
    if (!businessDate) throw new Error('Finance business date was not available');
    const serviceInvoiceInput = {
      businessLocationId: financeScope.locationId,
      currencyCode: 'BGN',
      customerPartnerId: customerId,
      documentType: 'invoice',
      dueDate: businessDate,
      exchangeRate: '1',
      issueDate: businessDate,
      legalEntityId: financeScope.legalEntityId,
      lines: serviceDraft.lines,
      rateDate: businessDate,
      rateSource: 'internal_bgn',
      sourceServiceWorkOrderId: completed.id,
      taxEventDate: businessDate,
    };
    const changedChargesResponse = await request(application.getHttpServer())
      .post('/api/v1/finance/financial-documents')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-finance-changed-${runId}`)
      .send({
        ...serviceInvoiceInput,
        lines: serviceDraft.lines.map((line, index) =>
          index === 0 ? { ...line, unitPrice: '41' } : line,
        ),
      })
      .expect(400);
    expect(changedChargesResponse.body.error.code).toBe('FINANCE_SERVICE_CHARGES_CHANGED');

    const serviceFinanceKey = `service-finance-${runId}`;
    const financeDraftResponse = await request(application.getHttpServer())
      .post('/api/v1/finance/financial-documents')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', serviceFinanceKey)
      .send(serviceInvoiceInput)
      .expect(201);
    const financeDraft = financeDraftResponse.body as FinancialDocument;
    expect(financeDraft).toMatchObject({
      bgnGrossTotal: '68.4000',
      bgnNetTotal: '57.0000',
      bgnVatTotal: '11.4000',
      sourceServiceWorkOrderId: completed.id,
      sourceServiceWorkOrderNumber: completed.number,
      status: 'draft',
    });
    const financeDraftReplay = await request(application.getHttpServer())
      .post('/api/v1/finance/financial-documents')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', serviceFinanceKey)
      .send(serviceInvoiceInput)
      .expect(201);
    expect((financeDraftReplay.body as FinancialDocument).id).toBe(financeDraft.id);
    const linkedWorkOrder = (
      await request(application.getHttpServer())
        .get(`/api/v1/service/work-orders/${completed.id}`)
        .set('authorization', `Bearer ${token}`)
        .expect(200)
    ).body as ServiceWorkOrder;
    expect(linkedWorkOrder).toMatchObject({
      financialDocumentId: financeDraft.id,
      financialDocumentNumber: financeDraft.number,
    });

    const serialTraceResponse = await request(application.getHttpServer())
      .get(`/api/v1/warehouse/serial-traceability/${encodeURIComponent(serialNumber)}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const serialTrace = serialTraceResponse.body as SerialTraceability;
    expect(serialTrace).toMatchObject({
      currentCustody: { type: 'customer' },
      customer: { id: customerId },
      customerEquipment: {
        id: equipmentId,
        location: { id: customerLocationId },
        status: 'active',
      },
    });
    expect(serialTrace.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: 'receipt' }),
        expect.objectContaining({ eventType: 'sale' }),
        expect.objectContaining({ eventType: 'handover' }),
        expect.objectContaining({ eventType: 'return_registered' }),
        expect.objectContaining({ eventType: 'service_requested' }),
        expect.objectContaining({ eventType: 'service_scheduled' }),
        expect.objectContaining({ eventType: 'service_started' }),
        expect.objectContaining({ eventType: 'repair_completed' }),
      ]),
    );
    expect(
      serialTrace.events.find((event) => event.eventType === 'repair_completed')?.technician,
    ).toMatchObject({ id: creatorAccountId });

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

  it('reconciles dashboard values with source records and omits unauthorized metrics', async () => {
    const path =
      '/api/v1/operations/overview?dateFrom=2026-01-01&dateTo=2099-12-31&warrantyDays=30';
    await request(application.getHttpServer()).get(path).expect(401);
    const response = await request(application.getHttpServer())
      .get(path)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const summary = response.body as OperationsOverview;
    const expected = await database.query<{
      revenue: string;
      overdue: string;
      service: number;
      warranties: number;
    }>(
      `SELECT
        (SELECT coalesce(sum(CASE WHEN document_type='credit_note' THEN -bgn_net_total ELSE bgn_net_total END),0)::text
         FROM finance.financial_documents WHERE status <> 'cancelled' AND document_type IN ('invoice','credit_note','debit_note')
         AND issue_date BETWEEN '2026-01-01' AND '2099-12-31') AS revenue,
        (SELECT coalesce(sum(round(outstanding_total * exchange_rate,4)),0)::text
         FROM finance.customer_documents WHERE review_state='pending_finance_review' AND outstanding_total>0 AND due_date<$1::date) AS overdue,
        (SELECT count(*)::integer FROM service.requests WHERE status IN ('new','scheduled','in_progress')) AS service,
        (SELECT count(*)::integer FROM master_data.customer_equipment WHERE active
         AND warranty_end_date BETWEEN $1::date AND $1::date+30) AS warranties`,
      [summary.asOf],
    );
    expect(summary).toMatchObject({
      recordedRevenueBgn: expected.rows[0]?.revenue,
      overdueReceivablesBgn: expected.rows[0]?.overdue,
      activeServiceRequests: expected.rows[0]?.service,
      expiringWarranties: expected.rows[0]?.warranties,
    });
    const restricted = await request(application.getHttpServer())
      .get(path)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(restricted.body.activeServiceRequests).toBeUndefined();
    expect(restricted.body.expiringWarranties).toBeUndefined();
    expect(restricted.body.recordedRevenueBgn).toBe(summary.recordedRevenueBgn);
    const crmEmail = `dashboard-crm-${runId}@example.invalid`;
    const crmAccount = await createAccount(
      database,
      crmEmail,
      await application.get(PasswordService).hash(password),
    );
    await grantCrmPermissions(database, crmAccount, ['view']);
    const crmToken = await login(application, crmEmail);
    const crmOnly = await request(application.getHttpServer())
      .get(path)
      .set('authorization', `Bearer ${crmToken}`)
      .expect(200);
    expect(crmOnly.body.recordedRevenueBgn).toBeUndefined();
    expect(crmOnly.body.overdueReceivablesBgn).toBeUndefined();
    expect(crmOnly.body.activeServiceRequests).toBeUndefined();
    expect(crmOnly.body.expiringWarranties).toBe(summary.expiringWarranties);
    await request(application.getHttpServer())
      .get('/api/v1/finance/saved-reports')
      .set('authorization', `Bearer ${crmToken}`)
      .expect(403);
    const empty = await request(application.getHttpServer())
      .get('/api/v1/operations/overview?dateFrom=2100-01-01&dateTo=2100-01-01')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(Number(empty.body.recordedRevenueBgn)).toBe(0);
    for (const query of [
      'dateFrom=2026-02-30&dateTo=2026-03-01',
      'dateFrom=2026-09-30&dateTo=2026-09-01',
      'dateFrom=2026-09-01&dateTo=2026-09-30&warrantyDays=0',
    ]) {
      await request(application.getHttpServer())
        .get(`/api/v1/operations/overview?${query}`)
        .set('authorization', `Bearer ${token}`)
        .expect(400);
    }
  });

  it('saves private dashboard preferences with concurrent retry safety and restores defaults', async () => {
    const path = '/api/v1/operations/overview/preferences';
    const overviewPath = '/api/v1/operations/overview?dateFrom=2026-01-01&dateTo=2026-12-31';
    const input = { hiddenCards: ['recordedRevenueBgn'], version: 0 };
    await request(application.getHttpServer()).put(path).send(input).expect(401);
    const noAccessEmail = `overview-no-access-${runId}@example.invalid`;
    await createAccount(
      database,
      noAccessEmail,
      await application.get(PasswordService).hash(password),
    );
    const noAccessToken = await login(application, noAccessEmail);
    await request(application.getHttpServer())
      .put(path)
      .set('authorization', `Bearer ${noAccessToken}`)
      .send(input)
      .expect(403);
    const saves = await Promise.all(
      [1, 2].map(() =>
        request(application.getHttpServer())
          .put(path)
          .set('authorization', `Bearer ${token}`)
          .send(input)
          .expect(200),
      ),
    );
    expect(saves[0]!.body).toEqual({ ...input, version: 1 });
    expect(saves[1]!.body).toEqual(saves[0]!.body);
    const loaded = await request(application.getHttpServer())
      .get(overviewPath)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(loaded.body.preferences).toEqual(saves[0]!.body);
    const other = await request(application.getHttpServer())
      .get(overviewPath)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(other.body.preferences).toEqual({ hiddenCards: [], version: 0 });
    for (const invalid of [
      { hiddenCards: ['invented'], version: 1 },
      { hiddenCards: ['recordedRevenueBgn', 'recordedRevenueBgn'], version: 1 },
      { hiddenCards: [], version: -1 },
      { ...input, ownerAccountId: randomUUID() },
    ]) {
      await request(application.getHttpServer())
        .put(path)
        .set('authorization', `Bearer ${token}`)
        .send(invalid)
        .expect(400);
    }
    await request(application.getHttpServer())
      .put(path)
      .set('authorization', `Bearer ${token}`)
      .send({ hiddenCards: [], version: 0 })
      .expect(409);
    const audit = await database.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM audit.events WHERE action = 'dashboard.preferences.updated'",
    );
    expect(audit.rows[0]?.count).toBe(1);
    await request(application.getHttpServer())
      .put(path)
      .set('authorization', `Bearer ${token}`)
      .send({ hiddenCards: [], version: 1 })
      .expect(200);
    const reset = await request(application.getHttpServer())
      .get(overviewPath)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(reset.body.preferences).toEqual({ hiddenCards: [], version: 2 });
  });

  it('saves private Service report options with retry safety, validation and approval controls', async () => {
    const endpoint = '/api/v1/service/saved-reports';
    const saved = {
      id: randomUUID(),
      name: 'Service visits',
      definitionKey: 'service.technician-performance',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      format: 'xlsx',
      columns: ['displayName', 'completedCount'],
    };
    const send = (body: object) =>
      request(application.getHttpServer())
        .post(endpoint)
        .set('authorization', `Bearer ${token}`)
        .send(body);
    await request(application.getHttpServer()).post(endpoint).send(saved).expect(401);
    await request(application.getHttpServer())
      .post(endpoint)
      .set('authorization', `Bearer ${viewerToken}`)
      .send(saved)
      .expect(403);
    await request(application.getHttpServer())
      .get(endpoint)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(403);
    const replies = await Promise.all([send(saved), send(saved)]);
    expect(replies.map((reply) => reply.status)).toEqual([201, 201]);
    expect(replies[0]?.body).toEqual(saved);
    await send({ ...saved, name: 'Changed' }).expect(409);
    for (const invalid of [
      { columns: [] },
      { columns: ['displayName', 'displayName'] },
      { columns: ['password_hash'] },
      { columns: ['requestNumber'] },
      { dateFrom: '2026-02-30' },
      { dateFrom: '2027-01-01' },
      { dateTo: undefined },
      { dateFrom: '2026-01-01T00:00:00Z' },
      { name: ' ' },
      { definitionKey: 'finance.supplier-turnover' },
      { sql: 'SELECT 1' },
    ])
      await send({ ...saved, id: randomUUID(), ...invalid }).expect(400);
    const listed = await request(application.getHttpServer())
      .get(endpoint)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(listed.body.items).toEqual([saved]);
    const otherEmail = `service-report-reader-${runId}@example.invalid`;
    const otherId = await createAccount(
      database,
      otherEmail,
      await application.get(PasswordService).hash(password),
    );
    await grantServicePermissions(database, otherId, ['approve']);
    const otherToken = await login(application, otherEmail);
    const other = await request(application.getHttpServer())
      .get(endpoint)
      .set('authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(other.body.total).toBe(0);
    await request(application.getHttpServer())
      .post(endpoint)
      .set('authorization', `Bearer ${otherToken}`)
      .send({ ...saved, id: randomUUID() })
      .expect(403);
    for (const query of ['page=0', 'pageSize=101', 'ownerAccountId=anything']) {
      await request(application.getHttpServer())
        .get(`${endpoint}?${query}`)
        .set('authorization', `Bearer ${token}`)
        .expect(400);
    }
    const audit = await database.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM audit.events WHERE target_id=$1 AND action='report.view.created'",
      [saved.id],
    );
    expect(audit.rows[0]?.count).toBe(1);
  });

  it('saves private CRM report options with retry safety, validation and approval controls', async () => {
    const endpoint = '/api/v1/crm/saved-reports';
    const saved = {
      id: randomUUID(),
      name: 'Customer value',
      definitionKey: 'crm.customer-value',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      format: 'xlsx',
      columns: ['period', 'activeCustomers'],
    };
    const send = (body: object) =>
      request(application.getHttpServer())
        .post(endpoint)
        .set('authorization', `Bearer ${token}`)
        .send(body);
    await request(application.getHttpServer()).post(endpoint).send(saved).expect(401);
    await request(application.getHttpServer())
      .post(endpoint)
      .set('authorization', `Bearer ${viewerToken}`)
      .send(saved)
      .expect(403);
    await request(application.getHttpServer())
      .get(endpoint)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(403);
    const replies = await Promise.all([send(saved), send(saved)]);
    expect(replies.map((reply) => reply.status)).toEqual([201, 201]);
    expect(replies[0]?.body).toEqual(saved);
    await send({ ...saved, name: 'Changed' }).expect(409);
    for (const invalid of [
      { columns: [] },
      { columns: ['period', 'period'] },
      { columns: ['password_hash'] },
      { columns: ['requestNumber'] },
      { dateFrom: '2026-02-30' },
      { dateFrom: '2027-01-01' },
      { dateTo: undefined },
      { dateFrom: '2026-01-01T00:00:00Z' },
      { name: ' ' },
      { definitionKey: 'finance.supplier-turnover' },
      { sql: 'SELECT 1' },
    ])
      await send({ ...saved, id: randomUUID(), ...invalid }).expect(400);
    const listed = await request(application.getHttpServer())
      .get(endpoint)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(listed.body.items).toEqual([saved]);
    const otherEmail = `crm-report-reader-${runId}@example.invalid`;
    const otherId = await createAccount(
      database,
      otherEmail,
      await application.get(PasswordService).hash(password),
    );
    await grantCrmPermissions(database, otherId, ['view']);
    const otherToken = await login(application, otherEmail);
    const other = await request(application.getHttpServer())
      .get(endpoint)
      .set('authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(other.body.total).toBe(0);
    await request(application.getHttpServer())
      .post(endpoint)
      .set('authorization', `Bearer ${otherToken}`)
      .send({ ...saved, id: randomUUID() })
      .expect(403);
    for (const query of ['page=0', 'pageSize=101', 'ownerAccountId=anything']) {
      await request(application.getHttpServer())
        .get(`${endpoint}?${query}`)
        .set('authorization', `Bearer ${token}`)
        .expect(400);
    }
    const audit = await database.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM audit.events WHERE target_id=$1 AND action='report.view.created'",
      [saved.id],
    );
    expect(audit.rows[0]?.count).toBe(1);
  });

  it('summarizes Service work and prepares access-controlled report exports without mixing Finance files', async () => {
    await request(application.getHttpServer())
      .get('/api/v1/service/reports/overview?dateFrom=2026-01-01&dateTo=2099-12-31')
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(403);

    const overviewResponse = await request(application.getHttpServer())
      .get('/api/v1/service/reports/overview?dateFrom=2026-01-01&dateTo=2099-12-31')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const overview = overviewResponse.body as ServiceReportOverview;
    expect(typeof overview.totals.completedRequests).toBe('number');
    expect(typeof overview.totals.laborMinutes).toBe('number');
    expect(typeof overview.totals.totalRequests).toBe('number');
    expect(overview.totals.completedRequests).toBeGreaterThanOrEqual(1);
    expect(overview.totals.laborMinutes).toBeGreaterThanOrEqual(30);
    expect(overview.technicians.length).toBeGreaterThanOrEqual(1);
    expect(typeof overview.technicians[0]?.completedCount).toBe('number');
    expect(typeof overview.technicians[0]?.laborMinutes).toBe('number');

    const definitionsResponse = await request(application.getHttpServer())
      .get('/api/v1/service/report-exports/definitions')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const definitions = definitionsResponse.body as ServiceReportDefinition[];
    expect(definitions.map((definition) => definition.key)).toEqual([
      'service.cost-summary',
      'service.request-register',
      'service.technician-performance',
    ]);

    const exportKey = `service-report-export-${runId}`;
    const exportInput = {
      dateFrom: '2026-01-01',
      dateTo: '2099-12-31',
      definitionKey: 'service.request-register',
      format: 'csv',
      columns: ['requestNumber', 'customerName'],
    };
    const requestedResponse = await request(application.getHttpServer())
      .post('/api/v1/service/report-exports')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', exportKey)
      .send(exportInput)
      .expect(202);
    const requested = requestedResponse.body as ServiceReportExport;
    expect(requested).toMatchObject({
      definitionKey: 'service.request-register',
      format: 'csv',
      status: 'queued',
    });
    const replayResponse = await request(application.getHttpServer())
      .post('/api/v1/service/report-exports')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', exportKey)
      .send(exportInput)
      .expect(202);
    expect((replayResponse.body as ServiceReportExport).id).toBe(requested.id);

    const handlers = application.get(JobHandlerRegistry);
    const reportJob = {
      attemptNumber: 1,
      correlationId: `service-report-job-${runId}`,
      enqueuedAt: '2026-08-26T12:00:00.000Z',
      idempotencyKey: `service-report-export:${requested.id}`,
      jobId: `service-report-job-${runId}`,
      maxAttempts: 5,
      name: 'report.generate',
      payload: { exportId: requested.id },
      retryAllowed: true,
    } as const;
    const generated = (await handlers.execute(reportJob)) as { rowCount: number };
    expect(generated.rowCount).toBeGreaterThanOrEqual(1);
    await expect(handlers.execute({ ...reportJob, attemptNumber: 2 })).resolves.toMatchObject({
      deduplicated: true,
      rowCount: generated.rowCount,
    });

    const serviceListResponse = await request(application.getHttpServer())
      .get('/api/v1/service/report-exports')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const serviceList = serviceListResponse.body as ServiceReportExportPage;
    expect(serviceList).toMatchObject({ total: 1 });
    expect(serviceList.items[0]).toMatchObject({
      id: requested.id,
      status: 'completed',
    });

    const financeListResponse = await request(application.getHttpServer())
      .get('/api/v1/finance/report-exports')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect((financeListResponse.body as FinanceReportExportPage).items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: requested.id })]),
    );

    const downloaded = await request(application.getHttpServer())
      .get(`/api/v1/service/report-exports/${requested.id}/content`)
      .set('authorization', `Bearer ${token}`)
      .expect('content-type', /csv/u)
      .expect(200);
    expect(downloaded.text).toContain('Service request register');
    expect(downloaded.text).toContain('Request');
    expect(downloaded.text).toContain('Customer');
    expect(downloaded.text).not.toContain('Labour BGN');
    expect(downloaded.text).not.toContain('Device and serial');
    const stored = await database.query<{ filters: { columns: string[] } }>(
      'SELECT filters FROM reporting.export_jobs WHERE id = $1',
      [requested.id],
    );
    expect(stored.rows[0]?.filters.columns).toEqual(exportInput.columns);
  });

  it('reports across Procurement, Warehouse, Sales and Logistics with private saved views and all export formats', async () => {
    const ownerEmail = `erp-reports-${runId}@example.invalid`;
    const readerEmail = `erp-report-reader-${runId}@example.invalid`;
    const owner = await createAccount(
      database,
      ownerEmail,
      await application.get(PasswordService).hash(password),
    );
    const reader = await createAccount(
      database,
      readerEmail,
      await application.get(PasswordService).hash(password),
    );
    for (const [accountId, actions] of [
      [owner, ['view', 'create']],
      [reader, ['view']],
    ] as const) {
      const roleId = randomUUID();
      await database.query('INSERT INTO iam.roles (id,code,name) VALUES ($1,$2,$3)', [
        roleId,
        `erp-report-${roleId}`,
        'ERP reports test',
      ]);
      for (const scope of ['procurement', 'warehouse', 'sales', 'logistics'])
        for (const action of actions) {
          const permission = await database.query<{ id: string }>(
            'INSERT INTO iam.permissions (id,module,action) VALUES ($1,$2,$3) ON CONFLICT (module,action) DO UPDATE SET module=EXCLUDED.module RETURNING id',
            [randomUUID(), `erp.${scope}`, action],
          );
          await database.query(
            'INSERT INTO iam.role_permissions (role_id,permission_id) VALUES ($1,$2)',
            [roleId, permission.rows[0]!.id],
          );
        }
      await database.query('INSERT INTO iam.account_roles (account_id,role_id) VALUES ($1,$2)', [
        accountId,
        roleId,
      ]);
    }
    const ownerToken = await login(application, ownerEmail),
      readerToken = await login(application, readerEmail);
    let totalDefinitions = 0;
    for (const scope of ['procurement', 'warehouse', 'sales', 'logistics']) {
      const base = `/api/v1/erp/reports/${scope}`;
      await request(application.getHttpServer()).get(`${base}/definitions`).expect(401);
      const definitionsResponse = await request(application.getHttpServer())
        .get(`${base}/definitions`)
        .set('authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const definitions = definitionsResponse.body as ErpReportDefinition[];
      totalDefinitions += definitions.length;
      for (const [index, definition] of definitions.entries()) {
        const filters = {
          definitionKey: definition.key,
          ...(definition.requiresDateRange ? { dateFrom: '2020-01-01', dateTo: '2100-12-31' } : {}),
        };
        const preview = await request(application.getHttpServer())
          .get(`${base}/preview`)
          .query(filters)
          .set('authorization', `Bearer ${ownerToken}`)
          .expect(200);
        expect((preview.body as ErpReportPreview).columns.map((c) => c.key)).toEqual(
          definition.columns!.map((c) => c.key),
        );
        expect(preview.body.rows.length).toBeLessThanOrEqual(25);
        const empty = await request(application.getHttpServer())
          .get(`${base}/preview`)
          .query({ ...filters, search: 'no-such-report-value-' + runId })
          .set('authorization', `Bearer ${ownerToken}`)
          .expect(200);
        expect(empty.body.total).toBe(0);
        for (const format of index === 0 ? ['csv', 'xlsx', 'pdf'] : ['csv']) {
          const selected = definition.columns!.slice(0, 2);
          const input = { ...filters, columns: selected.map((c) => c.key), format };
          const key = randomUUID();
          const send = () =>
            request(application.getHttpServer())
              .post(`${base}/exports`)
              .set('authorization', `Bearer ${ownerToken}`)
              .set('Idempotency-Key', key)
              .send(input);
          const first = await send().expect(202);
          const replay = await send().expect(202);
          expect(replay.body.id).toBe(first.body.id);
          await request(application.getHttpServer())
            .post(`${base}/exports`)
            .set('authorization', `Bearer ${readerToken}`)
            .set('Idempotency-Key', randomUUID())
            .send(input)
            .expect(403);
          const job = {
            attemptNumber: 1,
            correlationId: randomUUID(),
            enqueuedAt: new Date().toISOString(),
            idempotencyKey: `erp-report:${first.body.id}`,
            jobId: randomUUID(),
            maxAttempts: 5,
            name: 'report.generate',
            payload: { exportId: first.body.id as string },
            retryAllowed: true,
          } as const;
          const handlers = application.get(JobHandlerRegistry);
          await handlers.execute(job);
          await expect(handlers.execute({ ...job, attemptNumber: 2 })).resolves.toMatchObject({
            deduplicated: true,
          });
          await request(application.getHttpServer())
            .get(`${base}/exports/${first.body.id}/content`)
            .set('authorization', `Bearer ${readerToken}`)
            .expect(404);
          const content = await request(application.getHttpServer())
            .get(`${base}/exports/${first.body.id}/content`)
            .set('authorization', `Bearer ${ownerToken}`)
            .expect(200);
          if (format === 'csv')
            expect(content.text.split('\r\n\r\n')[1]?.split('\r\n')[0]).toBe(
              selected.map((c) => c.label).join(','),
            );
          else
            expect(content.headers['content-type']).toContain(
              format === 'pdf' ? 'application/pdf' : 'spreadsheetml',
            );
          const stored = await database.query<{ filters: { columns: string[] } }>(
            'SELECT filters FROM reporting.export_jobs WHERE id=$1',
            [first.body.id],
          );
          expect(stored.rows[0]!.filters.columns).toEqual(input.columns);
        }
        const saved = {
          ...filters,
          id: randomUUID(),
          name: definition.name,
          format: 'csv',
          columns: definition.columns!.slice(0, 2).map((c) => c.key),
        };
        const sendSaved = () =>
          request(application.getHttpServer())
            .post(`${base}/saved`)
            .set('authorization', `Bearer ${ownerToken}`)
            .send(saved);
        const saves = await Promise.all([sendSaved().expect(201), sendSaved().expect(201)]);
        expect(saves[0].body).toEqual(saves[1].body);
        await request(application.getHttpServer())
          .post(`${base}/saved`)
          .set('authorization', `Bearer ${ownerToken}`)
          .send({ ...saved, name: 'Changed' })
          .expect(409);
        const list = await request(application.getHttpServer())
          .get(`${base}/saved`)
          .set('authorization', `Bearer ${readerToken}`)
          .expect(200);
        expect(list.body.total).toBe(0);
        await request(application.getHttpServer())
          .post(`${base}/saved`)
          .set('authorization', `Bearer ${readerToken}`)
          .send({ ...saved, id: randomUUID() })
          .expect(403);
        for (const invalid of [
          { columns: ['password_hash'] },
          { columns: [] },
          { columns: [saved.columns[0], saved.columns[0]] },
          { sql: 'SELECT 1' },
          { name: ' ' },
          { search: 'x'.repeat(121) },
        ]) {
          await request(application.getHttpServer())
            .post(`${base}/saved`)
            .set('authorization', `Bearer ${ownerToken}`)
            .send({ ...saved, id: randomUUID(), ...invalid })
            .expect(400);
        }
        if (definition.requiresDateRange) {
          for (const dateFrom of ['2026-02-30', '2200-01-01'])
            await request(application.getHttpServer())
              .get(`${base}/preview`)
              .query({ ...filters, dateFrom })
              .set('authorization', `Bearer ${ownerToken}`)
              .expect(400);
        } else
          await request(application.getHttpServer())
            .get(`${base}/preview`)
            .query({ ...filters, dateFrom: '2026-01-01', dateTo: '2026-12-31' })
            .set('authorization', `Bearer ${ownerToken}`)
            .expect(400);
      }
      const first = definitions[0]!;
      await request(application.getHttpServer())
        .get(`${base}/preview`)
        .query({
          definitionKey:
            scope === 'sales' ? 'warehouse.stock-balances' : 'sales.quotation-register',
          dateFrom: '2026-01-01',
          dateTo: '2026-12-31',
        })
        .set('authorization', `Bearer ${ownerToken}`)
        .expect(404);
      const ownList = await request(application.getHttpServer())
        .get(`${base}/saved?page=1&pageSize=1`)
        .set('authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(ownList.body.items).toHaveLength(1);
      expect(ownList.body.total).toBe(definitions.length);
      expect(first.key.startsWith(scope + '.')).toBe(true);
    }
    expect(totalDefinitions).toBe(10);
    await request(application.getHttpServer())
      .get('/api/v1/erp/reports/finance/definitions')
      .set('authorization', `Bearer ${ownerToken}`)
      .expect(400);
    await request(application.getHttpServer())
      .get('/api/v1/erp/reports/warehouse/definitions')
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(403);
  }, 60000);

  it('exports CRM field selections through the worker with replay and download protection', async () => {
    const base = '/api/v1/crm/report-exports';
    const definitions = await request(application.getHttpServer())
      .get(`${base}/definitions`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(definitions.body).toHaveLength(4);
    for (const definition of definitions.body as {
      key: string;
      columns: { key: string; label: string }[];
    }[]) {
      expect(definition.columns.length).toBeGreaterThan(1);
      const selected = definition.columns.slice(0, 2);
      const input = {
        definitionKey: definition.key,
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
        columns: selected.map((column) => column.key),
        format: 'csv',
      };
      const invalid = await request(application.getHttpServer())
        .post(base)
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', randomUUID())
        .send({ ...input, columns: ['password_hash'] })
        .expect(400);
      expect(invalid.body.error.code).toBe('REPORT_COLUMNS_INVALID');
      const key = randomUUID();
      const send = () =>
        request(application.getHttpServer())
          .post(base)
          .set('authorization', `Bearer ${token}`)
          .set('idempotency-key', key)
          .send(input);
      const first = await send().expect(202);
      const exportId = (first.body as { id: string }).id;
      const replay = await send().expect(202);
      expect(replay.body.id).toBe(first.body.id);
      const job = {
        attemptNumber: 1,
        correlationId: randomUUID(),
        enqueuedAt: new Date().toISOString(),
        idempotencyKey: `crm-report:${first.body.id}`,
        jobId: randomUUID(),
        maxAttempts: 5,
        name: 'report.generate',
        payload: { exportId },
        retryAllowed: true,
      } as const;
      const handlers = application.get(JobHandlerRegistry);
      await handlers.execute(job);
      await expect(handlers.execute({ ...job, attemptNumber: 2 })).resolves.toMatchObject({
        deduplicated: true,
      });
      await request(application.getHttpServer())
        .get(`${base}/${first.body.id}/content`)
        .set('authorization', `Bearer ${viewerToken}`)
        .expect(403);
      const content = await request(application.getHttpServer())
        .get(`${base}/${first.body.id}/content`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      const table = content.text.split('\r\n\r\n')[1];
      expect(table?.split('\r\n')[0]).toBe(selected.map((column) => column.label).join(','));
      const persisted = await database.query<{ filters: { columns: string[] } }>(
        'SELECT filters FROM reporting.export_jobs WHERE id = $1',
        [first.body.id],
      );
      expect(persisted.rows[0]?.filters.columns).toEqual(input.columns);
    }
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
    const { technicianWarehouseId: firstTechnicianWarehouseId } =
      await seedServiceTechnicianWarehouse(
        database,
        firstTechnicianAccountId,
        productId,
        `scope-one-${runId}`,
      );
    const { technicianWarehouseId: secondTechnicianWarehouseId } =
      await seedServiceTechnicianWarehouse(
        database,
        secondTechnicianAccountId,
        productId,
        `scope-two-${runId}`,
      );
    await seedServiceSchedulePolicy(database, firstTechnicianAccountId, creatorAccountId);
    await seedServiceSchedulePolicy(database, secondTechnicianAccountId, creatorAccountId);
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

    const ownScheduleResponse = await request(application.getHttpServer())
      .get('/api/v1/service/schedule?dateFrom=2099-10-01&dateTo=2099-10-07')
      .set('authorization', `Bearer ${firstTechnicianToken}`)
      .expect(200);
    const ownSchedule = ownScheduleResponse.body as ServiceSchedule;
    expect(ownSchedule.technicians).toHaveLength(1);
    expect(ownSchedule.technicians[0]).toMatchObject({
      technician: { accountId: firstTechnicianAccountId },
      visitCount: 1,
    });
    await request(application.getHttpServer())
      .put(`/api/v1/service/technicians/${firstTechnicianAccountId}/schedule-policy`)
      .set('authorization', `Bearer ${firstTechnicianToken}`)
      .set('idempotency-key', `service-scope-policy-denied-${runId}`)
      .send({ expectedVersion: 1, windows: [] })
      .expect(403);

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

  it('receives a repair return into inventory and opens the linked Service request once', async () => {
    await database.query(
      "UPDATE master_data.customer_equipment SET status = 'active' WHERE id = $1",
      [equipmentId],
    );
    const receiveKey = `logistics-receive-${runId}`;
    const receivedResponse = await request(application.getHttpServer())
      .post(`/api/v1/logistics/returns/${registeredLogisticsReturnId}/receive`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', receiveKey)
      .send({ expectedVersion: registeredLogisticsReturnVersion })
      .expect(201);
    const received = receivedResponse.body as LogisticsReturn;
    expect(received).toMatchObject({ status: 'received', version: 2 });
    expect(received.lines[0]).toMatchObject({
      disposition: 'service',
      serialNumbers: [serialNumber],
    });
    expect(received.lines[0]?.inventoryReturnMovementId).toBeTruthy();
    expect(received.lines[0]?.serviceRequestNumber).toMatch(/^SRV-/u);

    const returnedTraceResponse = await request(application.getHttpServer())
      .get(`/api/v1/warehouse/serial-traceability/${encodeURIComponent(serialNumber)}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const returnedTrace = returnedTraceResponse.body as SerialTraceability;
    expect(returnedTrace.currentCustody.type).toBe('warehouse');
    expect(returnedTrace.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'return_received',
          referenceId: received.number,
        }),
        expect.objectContaining({
          eventType: 'service_requested',
          referenceId: received.lines[0]?.serviceRequestNumber,
        }),
      ]),
    );

    const receiveReplay = await request(application.getHttpServer())
      .post(`/api/v1/logistics/returns/${registeredLogisticsReturnId}/receive`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', receiveKey)
      .send({ expectedVersion: registeredLogisticsReturnVersion })
      .expect(201);
    expect((receiveReplay.body as LogisticsReturn).id).toBe(received.id);

    const evidence = await database.query<{
      audit_count: string;
      outbox_count: string;
      request_count: string;
      return_movement_count: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM audit.events
          WHERE target_id = $1 AND action LIKE 'logistics.return.%') AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events
          WHERE aggregate_id = $1 AND event_type LIKE 'logistics.return.%') AS outbox_count,
         (SELECT count(*)::text FROM service.requests request
          JOIN logistics.reverse_return_lines line ON line.service_request_id = request.id
          WHERE line.reverse_return_id = $1) AS request_count,
         (SELECT count(*)::text FROM inventory.stock_movements movement
          JOIN logistics.reverse_return_lines line ON line.inventory_return_movement_id = movement.id
          WHERE line.reverse_return_id = $1) AS return_movement_count`,
      [received.id],
    );
    expect(evidence.rows[0]).toEqual({
      audit_count: '2',
      outbox_count: '2',
      request_count: '1',
      return_movement_count: '1',
    });
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

async function grantWarehouseViewPermission(pool: Pool, accountId: string) {
  const roleId = randomUUID();
  await pool.query('INSERT INTO iam.roles (id, code, name) VALUES ($1, $2, $3)', [
    roleId,
    `warehouse-${randomUUID()}`,
    'Warehouse trace test role',
  ]);
  const permission = await pool.query<{ id: string }>(
    `INSERT INTO iam.permissions (id, module, action) VALUES ($1, 'erp.warehouse', 'view')
     ON CONFLICT (module, action) DO UPDATE SET module = EXCLUDED.module RETURNING id`,
    [randomUUID()],
  );
  await pool.query('INSERT INTO iam.role_permissions (role_id, permission_id) VALUES ($1, $2)', [
    roleId,
    permission.rows[0]?.id,
  ]);
  await pool.query('INSERT INTO iam.account_roles (account_id, role_id) VALUES ($1, $2)', [
    accountId,
    roleId,
  ]);
}

async function grantCrmPermissions(
  pool: Pool,
  accountId: string,
  actions: Array<'create' | 'edit' | 'view'>,
) {
  const roleId = randomUUID();
  await pool.query('INSERT INTO iam.roles (id, code, name) VALUES ($1, $2, $3)', [
    roleId,
    `crm-${randomUUID()}`,
    'CRM test role',
  ]);
  for (const action of actions) {
    const permission = await pool.query<{ id: string }>(
      `INSERT INTO iam.permissions (id, module, action) VALUES ($1, 'crm', $2)
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

async function grantLogisticsPermissions(
  pool: Pool,
  accountId: string,
  actions: Array<'create' | 'edit' | 'view'>,
) {
  const roleId = randomUUID();
  await pool.query('INSERT INTO iam.roles (id, code, name) VALUES ($1, $2, $3)', [
    roleId,
    `logistics-${randomUUID()}`,
    'Logistics test role',
  ]);
  for (const action of actions) {
    const permission = await pool.query<{ id: string }>(
      `INSERT INTO iam.permissions (id, module, action) VALUES ($1, 'erp.logistics', $2)
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

async function seedSupplierInvoiceEvidence(
  pool: Pool,
  actorId: string,
  supplierPartnerId: string,
  warehouseId: string,
  productId: string,
  invoiceDate: string,
  runId: string,
) {
  const purchaseOrderId = randomUUID();
  const purchaseOrderLineId = randomUUID();
  const supplierInvoiceId = randomUUID();

  await pool.query(
    `INSERT INTO master_data.partner_roles (partner_id, role, assigned_by)
     VALUES ($1, 'supplier', $2)
     ON CONFLICT DO NOTHING`,
    [supplierPartnerId, actorId],
  );
  await pool.query(
    `INSERT INTO procurement.purchase_orders (
       id, supplier_partner_id, warehouse_id, currency_code, status, created_by, updated_by
     ) VALUES ($1, $2, $3, 'BGN', 'received', $4, $4)`,
    [purchaseOrderId, supplierPartnerId, warehouseId, actorId],
  );
  await pool.query(
    `INSERT INTO procurement.purchase_order_lines (
       id, purchase_order_id, product_id, ordered_quantity, delivered_quantity,
       invoiced_quantity, unit_price, expected_delivery_date
     ) VALUES ($1, $2, $3, 1, 1, 1, 80, $4)`,
    [purchaseOrderLineId, purchaseOrderId, productId, invoiceDate],
  );
  await pool.query(
    `INSERT INTO procurement.supplier_invoices (
       id, purchase_order_id, supplier_partner_id, supplier_invoice_number,
       invoice_date, currency_code, recorded_by
     ) VALUES ($1, $2, $3, $4, $5, 'BGN', $6)`,
    [supplierInvoiceId, purchaseOrderId, supplierPartnerId, `SUP-${runId}`, invoiceDate, actorId],
  );
  await pool.query(
    `INSERT INTO procurement.supplier_invoice_lines (
       id, supplier_invoice_id, purchase_order_id, purchase_order_line_id,
       quantity, unit_price, vat_treatment, vat_rate
     ) VALUES ($1, $2, $3, $4, 1, 80, 'standard_20', 20)`,
    [randomUUID(), supplierInvoiceId, purchaseOrderId, purchaseOrderLineId],
  );

  return supplierInvoiceId;
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
    [equipmentId, customerLocationId, serialProductId, serialNumber, actorId],
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
  const cashRegisterId = randomUUID();
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
    `INSERT INTO organization.cash_registers (
       id, business_location_id, code, name, created_by, updated_by
     ) VALUES ($1, $2, $3, 'Finance test cash register', $4, $4)`,
    [cashRegisterId, locationId, `CASH-${runId.slice(0, 8).toUpperCase()}`, accountId],
  );
  await pool.query(
    `INSERT INTO organization.cash_register_operators (
       cash_register_id, operator_id, business_location_id, assigned_by
     ) VALUES ($1, $2, $3, $4)`,
    [cashRegisterId, operatorId, locationId, accountId],
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
  return {
    cashOperatorId: operatorId,
    cashRegisterId,
    technicianWarehouseId: warehouseId,
  };
}

async function seedServiceSchedulePolicy(
  pool: Pool,
  technicianAccountId: string,
  actorAccountId: string,
) {
  await pool.query(
    `INSERT INTO service.technician_schedule_policies (
       technician_account_id, created_by, updated_by
     ) VALUES ($1, $2, $2)`,
    [technicianAccountId, actorAccountId],
  );
  await pool.query(
    `INSERT INTO service.technician_schedule_windows (
       technician_account_id, weekday, starts_at, ends_at, capacity_minutes, max_visits
     )
     SELECT $1, weekday, TIME '00:00', TIME '23:59', 1439, 100
     FROM generate_series(1, 7) AS weekday`,
    [technicianAccountId],
  );
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
