import 'reflect-metadata';

import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AppEnvironment } from '@vista/config';
import type {
  AcceptanceProtocol,
  ErpReportDefinition,
  ErpReportPreview,
  CustomerPriceGroup,
  CustomerOperationalOverview,
  PriceList,
  PurchaseOrder,
  PromotionalCampaign,
  SalesPricingReferenceData,
  SalesReferenceData,
  SalesResolvedPrice,
  CustomerLocationProfile,
  SalesWorkflow,
  SerialTraceability,
  ServiceSubscriptionContract,
  FinanceBankStatement,
  FinanceAgingReport,
  FinanceCashDailyReport,
  FinanceCashReferenceData,
  FinanceCashVoucher,
  CustomerPaymentStatusPage,
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
  SupplierInvoice,
  FinancialDocumentReferenceData,
  LogisticsDelivery,
  LogisticsReferenceData,
  LogisticsReturn,
  LogisticsRoutePlan,
  ManagedFile,
  ServiceCareOverview,
  ServiceInspectionPlan,
  WarrantyClaim,
  CrmAfterSalesOverview,
  CrmWarrantyCoverageOffer,
  CrmTicket,
  CrmTicketReferenceData,
  CustomerAdvance,
  CustomerPaymentAccount,
  RecurringInvoiceContract,
  RecurringInvoiceProfileInput,
  FinancialBrandingSettings,
} from '@vista/contracts';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PasswordService } from '../src/auth/password.service.js';
import { configureHttpApplication } from '../src/common/http-application.js';
import { APP_ENVIRONMENT } from '../src/config/config.module.js';
import { migrateDown, migrateUp } from '../src/database/migration-runner.js';
import { allocateOfficialNumber } from '../src/finance/official-numbering.js';
import { FinancialDocumentsService } from '../src/finance/financial-documents.service.js';
import { FinanceReportsService } from '../src/finance/finance-reports.service.js';
import { SalesSubscriptionsService } from '../src/sales/sales-subscriptions.service.js';
import { ApiErrorException } from '../src/common/api-error.exception.js';
import { JobHandlerRegistry } from '../src/jobs/job-handler-registry.service.js';
import { ReportingHubService } from '../src/jobs/reporting-hub.service.js';
import { CourierAdapterService, CourierProviderError } from '../src/logistics/courier-adapters.js';
import { NotificationDispatcherService } from '../src/notifications/notification-dispatcher.service.js';
import { SmtpMailerService, type SmtpMessage } from '../src/notifications/smtp-mailer.service.js';
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
  let supplierId: string;
  let warehouseId: string;
  let technicianWarehouseId: string;
  let serialNumber: string;
  let salesInvoiceId: string;
  let foreignSupplierInvoiceId: string | undefined;
  let acceptanceProtocolPurchaseOrderId: string;
  let acceptanceProtocolReceiptId: string;
  let acceptanceProtocolOrderLineId: string;
  let acceptanceProtocolSupplierInvoiceId: string;
  let salesShipmentId: string;
  let serialShipmentLineId: string;
  let registeredLogisticsReturnId: string;
  let registeredLogisticsReturnVersion: number;
  const storedObjects = new Map<string, Buffer>();
  const deliveredEmails: SmtpMessage[] = [];
  const courierAdapter = {
    create: vi.fn(),
    isConfigured: vi.fn((provider: string) => provider === 'unconfigured-provider'),
    track: vi.fn(),
  };
  let failNextEmailDelivery = false;
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
    expect(await migrateDown(database, migrationDirectory)).toBe('0115_backup_independent_copies');
    expect(await migrateDown(database, migrationDirectory)).toBe(
      '0114_backup_retention_reduction_approval',
    );
    expect(await migrateDown(database, migrationDirectory)).toBe(
      '0113_backup_restore_point_deletion',
    );
    expect(await migrateDown(database, migrationDirectory)).toBe(
      '0112_backup_policy_disable_approval',
    );
    expect(await migrateDown(database, migrationDirectory)).toBe('0111_backup_file_share_source');
    expect(await migrateDown(database, migrationDirectory)).toBe(
      '0110_backup_granular_file_restore',
    );
    expect(await migrateDown(database, migrationDirectory)).toBe('0109_backup_compression');
    expect(await migrateDown(database, migrationDirectory)).toBe(
      '0108_backup_object_storage_restore',
    );
    expect(await migrateDown(database, migrationDirectory)).toBe('0107_backup_plan_reviews');
    expect(await migrateDown(database, migrationDirectory)).toBe('0106_backup_dr_tests');
    expect(await migrateDown(database, migrationDirectory)).toBe('0105_backup_missed_schedules');
    expect(await migrateDown(database, migrationDirectory)).toBe('0104_backup_retention');
    expect(await migrateDown(database, migrationDirectory)).toBe('0103_backup_restore_requests');
    expect(await migrateDown(database, migrationDirectory)).toBe('0102_backup_execution_ledger');
    expect(await migrateDown(database, migrationDirectory)).toBe('0101_backup_policy_approval');
    expect(await migrateDown(database, migrationDirectory)).toBe('0100_backup_inventory_policies');
    expect(await migrateDown(database, migrationDirectory)).toBe(
      '0099_finance_bank_value_date_semantics',
    );
    expect(await migrateDown(database, migrationDirectory)).toBe('0098_pos_offline_sync_audit');
    expect(await migrateDown(database, migrationDirectory)).toBe(
      '0097_pos_card_authorization_lifecycle',
    );
    expect(await migrateDown(database, migrationDirectory)).toBe('0096_pos_datecs_unp_leases');
    expect(await migrateDown(database, migrationDirectory)).toBe('0095_pos_fiscal_return_saga');
    expect(await migrateDown(database, migrationDirectory)).toBe('0094_pos_fiscal_daily_reports');
    expect(await migrateDown(database, migrationDirectory)).toBe('0093_pos_fiscal_sale_saga');
    expect(await migrateDown(database, migrationDirectory)).toBe('0092_logistics_courier_bookings');
    expect(await migrateDown(database, migrationDirectory)).toBe(
      '0091_crm_customer_survey_delivery',
    );
    expect(await migrateDown(database, migrationDirectory)).toBe(
      '0090_crm_warranty_coverage_offers',
    );
    expect(await migrateDown(database, migrationDirectory)).toBe(
      '0089_procurement_acceptance_protocols',
    );
    expect(await migrateDown(database, migrationDirectory)).toBe(
      '0088_supplier_invoice_rate_snapshots',
    );
    expect(await migrateDown(database, migrationDirectory)).toBe(
      '0087_finance_payment_status_register',
    );
    expect(await migrateDown(database, migrationDirectory)).toBe(
      '0086_pos_account_supplier_offsets',
    );
    expect(await migrateDown(database, migrationDirectory)).toBe(
      '0085_pos_account_finance_collections',
    );
    expect(await migrateDown(database, migrationDirectory)).toBe('0084_pos_account_return_refunds');
    expect(await migrateDown(database, migrationDirectory)).toBe('0083_pos_account_collections');
    expect(await migrateDown(database, migrationDirectory)).toBe('0082_collection_corrections');
    expect(await migrateDown(database, migrationDirectory)).toBe(
      '0081_financial_document_branding',
    );
    expect(await migrateDown(database, migrationDirectory)).toBe('0080_recurring_invoice_issuance');
    expect(await migrateDown(database, migrationDirectory)).toBe('0079_finance_collection_sources');
    expect(await migrateDown(database, migrationDirectory)).toBe(
      '0078_finance_proforma_conversion_link',
    );
    expect(await migrateDown(database, migrationDirectory)).toBe(
      '0077_finance_income_outcome_exports',
    );
    expect(await migrateDown(database, migrationDirectory)).toBe(
      '0076_financial_document_issuance',
    );
    expect(await migrateDown(database, migrationDirectory)).toBe('0075_bnb_currency_rates');
    expect(await migrateDown(database, migrationDirectory)).toBe('0074_finance_payment_reversals');
    expect(await migrateDown(database, migrationDirectory)).toBe('0073_bank_duplicate_review');
    expect(await migrateDown(database, migrationDirectory)).toBe('0072_receipt_cost_baseline');
    expect(await migrateDown(database, migrationDirectory)).toBe('0071_service_customer_charges');
    expect(await migrateDown(database, migrationDirectory)).toBe('0070_eur_demo_price_lists');
    expect(await migrateDown(database, migrationDirectory)).toBe('0069_eur_transition');
    expect(await migrateDown(database, migrationDirectory)).toBe('0068_sales_quotation_lifecycle');
    expect(await migrateDown(database, migrationDirectory)).toBe(
      '0067_customer_advance_collection_allocation',
    );
    expect(await migrateDown(database, migrationDirectory)).toBe(
      '0066_subscription_finance_handoff',
    );
    expect(await migrateDown(database, migrationDirectory)).toBe(
      '0065_scheduled_execution_evidence',
    );
    expect(await migrateDown(database, migrationDirectory)).toBe('0064_reporting_hub');
    const restoredMigrations = await migrateUp(database, migrationDirectory);
    expect(restoredMigrations).toContain('0064_reporting_hub');
    expect(restoredMigrations).toContain('0074_finance_payment_reversals');
    expect(restoredMigrations).toContain('0075_bnb_currency_rates');
    expect(restoredMigrations).toContain('0076_financial_document_issuance');
    expect(restoredMigrations).toContain('0077_finance_income_outcome_exports');
    expect(restoredMigrations).toContain('0078_finance_proforma_conversion_link');
    expect(restoredMigrations).toContain('0091_crm_customer_survey_delivery');
    expect(restoredMigrations).toContain('0092_logistics_courier_bookings');
    expect(restoredMigrations).toContain('0093_pos_fiscal_sale_saga');
    expect(restoredMigrations).toContain('0094_pos_fiscal_daily_reports');
    expect(restoredMigrations).toContain('0095_pos_fiscal_return_saga');
    expect(restoredMigrations).toContain('0096_pos_datecs_unp_leases');
    expect(restoredMigrations).toContain('0097_pos_card_authorization_lifecycle');
    expect(restoredMigrations).toContain('0098_pos_offline_sync_audit');
    expect(restoredMigrations).toContain('0099_finance_bank_value_date_semantics');
    expect(restoredMigrations).toContain('0100_backup_inventory_policies');
    expect(restoredMigrations).toContain('0101_backup_policy_approval');
    expect(restoredMigrations).toContain('0102_backup_execution_ledger');
    expect(restoredMigrations).toContain('0103_backup_restore_requests');
    expect(restoredMigrations).toContain('0104_backup_retention');
    expect(restoredMigrations).toContain('0105_backup_missed_schedules');
    expect(restoredMigrations).toContain('0106_backup_dr_tests');
    expect(restoredMigrations).toContain('0107_backup_plan_reviews');
    expect(restoredMigrations).toContain('0108_backup_object_storage_restore');
    expect(restoredMigrations).toContain('0109_backup_compression');
    expect(restoredMigrations).toContain('0110_backup_granular_file_restore');
    expect(restoredMigrations).toContain('0111_backup_file_share_source');
    expect(restoredMigrations).toContain('0112_backup_policy_disable_approval');
    expect(restoredMigrations).toContain('0113_backup_restore_point_deletion');
    expect(restoredMigrations).toContain('0114_backup_retention_reduction_approval');
    expect(restoredMigrations).toContain('0115_backup_independent_copies');

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
    deliveredEmails.length = 0;
    failNextEmailDelivery = false;
    courierAdapter.create.mockReset();
    courierAdapter.isConfigured.mockReset().mockReturnValue(false);
    courierAdapter.track.mockReset();
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
      .overrideProvider(SmtpMailerService)
      .useValue({
        send: (message: SmtpMessage) => {
          if (failNextEmailDelivery) {
            failNextEmailDelivery = false;
            return Promise.reject(new Error('Temporary SMTP outage'));
          }
          deliveredEmails.push(message);
          return Promise.resolve();
        },
      })
      .overrideProvider(CourierAdapterService)
      .useValue(courierAdapter)
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
    await grantFinancePermissions(database, creatorId, ['approve', 'create', 'edit', 'view']);
    await grantFinancePermissions(database, viewerId, ['view']);
    await grantServicePermissions(database, creatorId, ['approve', 'create', 'edit', 'view']);
    await grantWarehouseViewPermission(database, creatorId);
    await grantCrmPermissions(database, creatorId, ['create', 'delete', 'edit', 'view']);
    await grantLogisticsPermissions(database, creatorId, ['create', 'edit', 'view']);
    await grantLogisticsPermissions(database, viewerId, ['view']);
    await grantProcurementPermissions(database, creatorId, ['create', 'edit', 'view']);
    ({
      customerId,
      customerLocationId,
      equipmentId,
      productId,
      serialNumber,
      serialProductId,
      supplierId,
      warehouseId,
    } = await seedSalesData(database, creatorId, runId));
    ({ cashOperatorId, cashRegisterId, technicianWarehouseId } =
      await seedServiceTechnicianWarehouse(database, creatorId, productId, runId));
    await seedServiceSchedulePolicy(database, creatorId, creatorId);
    token = await login(application, `sales-${runId}@example.invalid`);
    viewerToken = await login(application, `sales-viewer-${runId}@example.invalid`);
    await receiveSerialFromSupplier();
  }, 30_000);

  async function receiveSerialFromSupplier() {
    const purchaseOrderResponse = await request(application.getHttpServer())
      .post('/api/v1/procurement/purchase-orders')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `wh01-purchase-order-${runId}`)
      .send({
        currencyCode: 'EUR',
        lines: [
          {
            expectedDeliveryDate: '2099-12-31',
            productId: serialProductId,
            quantity: '1',
            unitPrice: '200',
          },
        ],
        supplierPartnerId: supplierId,
        warehouseId,
      })
      .expect(201);
    const purchaseOrder = purchaseOrderResponse.body as {
      id: string;
      lines: Array<{ id: string; productId: string }>;
    };
    acceptanceProtocolPurchaseOrderId = purchaseOrder.id;
    const orderLine = purchaseOrder.lines.find((line) => line.productId === serialProductId);
    if (!orderLine) throw new Error('Serial purchase-order line was not created');
    acceptanceProtocolOrderLineId = orderLine.id;

    const deliveryReference = `WH01-${runId.slice(0, 12).toUpperCase()}`;
    const receiptResponse = await request(application.getHttpServer())
      .post(`/api/v1/procurement/purchase-orders/${purchaseOrder.id}/receipts`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `wh01-goods-receipt-${runId}`)
      .send({
        lines: [
          {
            orderLineId: orderLine.id,
            quantity: '1',
            serialNumbers: [serialNumber],
            unitCostEur: '120',
          },
        ],
        supplierDeliveryReference: deliveryReference,
      })
      .expect(201);
    acceptanceProtocolReceiptId = (receiptResponse.body as { id: string }).id;

    const traceResponse = await request(application.getHttpServer())
      .get(`/api/v1/warehouse/serial-traceability/${encodeURIComponent(serialNumber)}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const trace = traceResponse.body as SerialTraceability;
    expect(trace.inventoryRecordLinked).toBe(true);
    expect(trace.status).toBe('available');
    const receiptEvent = trace.events.find(
      (event) => event.eventType === 'receipt' && event.referenceId === deliveryReference,
    );
    expect(receiptEvent?.referenceType).toBe('Supplier delivery');
    expect(receiptEvent?.supplier?.id).toBe(supplierId);
    const stockEvidence = await database.query<{
      quantity: string | null;
      serialStatus: string;
      serialWarehouseId: string;
    }>(
      `SELECT item.status AS "serialStatus", item.warehouse_id AS "serialWarehouseId",
              balance.quantity::text AS quantity
       FROM inventory.serialized_items item
       LEFT JOIN inventory.stock_balances balance
         ON balance.warehouse_id = item.warehouse_id AND balance.product_id = item.product_id
       WHERE item.serial_number = $1`,
      [serialNumber],
    );
    expect(stockEvidence.rows[0]).toEqual({
      quantity: '1.0000',
      serialStatus: 'available',
      serialWarehouseId: warehouseId,
    });
    const salesReferences = await request(application.getHttpServer())
      .get('/api/v1/sales/reference-data')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect((salesReferences.body as SalesReferenceData).serials).toContainEqual(
      expect.objectContaining({ serialNumber, warehouseId }),
    );
  }

  afterAll(async () => {
    if (application) await application.close();
    if (database) await database.end();
    if (adminDatabase && databaseName) {
      assertTemporaryDatabaseName(databaseName);
      await adminDatabase.query(`DROP DATABASE IF EXISTS ${databaseName}`);
      await adminDatabase.end();
    }
  });

  it('creates a retry-safe, immutable acceptance protocol from the posted goods receipt', async () => {
    const endpoint = `/api/v1/procurement/goods-receipts/${acceptanceProtocolReceiptId}/acceptance-protocol`;
    await request(application.getHttpServer())
      .post(endpoint)
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `acceptance-viewer-${runId}`)
      .send({})
      .expect(403);

    const invoiceResponse = await request(application.getHttpServer())
      .post('/api/v1/procurement/supplier-invoices')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `acceptance-protocol-invoice-${runId}`)
      .send({
        invoiceDate: '2099-12-31',
        invoiceNumber: `ACCEPT-${runId.slice(0, 16)}`,
        lines: [
          {
            orderLineId: acceptanceProtocolOrderLineId,
            quantity: '1',
            unitPrice: '200',
            vatRate: '20',
            vatTreatment: 'standard_20',
          },
        ],
        purchaseOrderId: acceptanceProtocolPurchaseOrderId,
      })
      .expect(201);
    acceptanceProtocolSupplierInvoiceId = (invoiceResponse.body as { id: string }).id;

    const before = await database.query<{ quantity: string }>(
      `SELECT quantity::text FROM inventory.stock_balances
       WHERE warehouse_id = $1 AND product_id = $2`,
      [warehouseId, serialProductId],
    );
    const [created, concurrentCreate] = await Promise.all([
      request(application.getHttpServer())
        .post(endpoint)
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `acceptance-protocol-${runId}`)
        .send({ supplierInvoiceId: acceptanceProtocolSupplierInvoiceId })
        .expect(201),
      request(application.getHttpServer())
        .post(endpoint)
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `acceptance-protocol-race-${runId}`)
        .send({ supplierInvoiceId: acceptanceProtocolSupplierInvoiceId })
        .expect(201),
    ]);
    const createdProtocol = created.body as AcceptanceProtocol;
    const concurrentProtocol = concurrentCreate.body as AcceptanceProtocol;
    expect(concurrentProtocol.id).toBe(createdProtocol.id);
    expect(createdProtocol).toMatchObject({
      goodsReceiptId: acceptanceProtocolReceiptId,
      purchaseOrderId: acceptanceProtocolPurchaseOrderId,
      supplierPartnerId: supplierId,
      supplierInvoice: {
        id: acceptanceProtocolSupplierInvoiceId,
        invoiceDate: '2099-12-31',
        invoiceNumber: `ACCEPT-${runId.slice(0, 16)}`,
      },
      lines: [
        expect.objectContaining({
          acceptedQuantity: '1.0000',
          cumulativeReceivedQuantity: '1.0000',
          outstandingQuantity: '0.0000',
          previouslyReceivedQuantity: '0.0000',
          productId: serialProductId,
          serialNumbers: [serialNumber],
        }),
      ],
    });
    expect(createdProtocol.protocolNumber).toMatch(/^GRP-\d{4}-\d{6}$/u);

    const retried = await request(application.getHttpServer())
      .post(endpoint)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `acceptance-protocol-${runId}`)
      .send({ supplierInvoiceId: acceptanceProtocolSupplierInvoiceId })
      .expect(201);
    expect((retried.body as AcceptanceProtocol).id).toBe(createdProtocol.id);

    const secondKeyRetry = await request(application.getHttpServer())
      .post(endpoint)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `acceptance-protocol-replay-${runId}`)
      .send({ supplierInvoiceId: acceptanceProtocolSupplierInvoiceId })
      .expect(201);
    expect((secondKeyRetry.body as AcceptanceProtocol).id).toBe(createdProtocol.id);

    const read = await request(application.getHttpServer())
      .get(endpoint)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(read.body as AcceptanceProtocol).toEqual(createdProtocol);
    await expect(
      database.query(
        'UPDATE procurement.acceptance_protocols SET protocol_number = $2 WHERE id = $1',
        [createdProtocol.id, 'GRP-2099-999999'],
      ),
    ).rejects.toThrow('procurement acceptance protocols are immutable');
    const after = await database.query<{ quantity: string }>(
      `SELECT quantity::text FROM inventory.stock_balances
       WHERE warehouse_id = $1 AND product_id = $2`,
      [warehouseId, serialProductId],
    );
    expect(after.rows).toEqual(before.rows);

    const order = await request(application.getHttpServer())
      .get(`/api/v1/procurement/purchase-orders/${acceptanceProtocolPurchaseOrderId}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const createdOrder = order.body as PurchaseOrder;
    expect(createdOrder.receipts[0]?.acceptanceProtocol).toEqual({
      id: createdProtocol.id,
      protocolNumber: createdProtocol.protocolNumber,
    });
  });

  it('saves private report options safely and rejects unapproved fields and periods', async () => {
    const saved = {
      id: randomUUID(),
      name: 'Monthly suppliers',
      definitionKey: 'finance.supplier-turnover',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
      format: 'csv',
      columns: ['partnerName', 'grossEurTotal'],
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
      currencyCode: 'EUR',
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

    // Legacy equipment entries may have a serial but no linked catalog product.
    // Accepting the sale must reconcile that link before creating the warranty card.
    await database.query(
      `UPDATE master_data.customer_equipment SET product_id = NULL WHERE id = $1`,
      [equipmentId],
    );

    const handoverAcceptance = {
      acceptanceNotes: 'Equipment received in good condition.',
      acceptedByName: 'Customer Representative',
      customerLocationId,
      expectedVersion: shipped.handover?.version,
    };
    const acceptedResponse = await request(application.getHttpServer())
      .post(`/api/v1/sales/handover-certificates/${shipped.handover?.id}/accept`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `sales-handover-${runId}`)
      .send(handoverAcceptance)
      .expect(200);
    const accepted = acceptedResponse.body as SalesWorkflow;
    expect(accepted.handover).toMatchObject({
      acceptanceNotes: 'Equipment received in good condition.',
      acceptedByName: 'Customer Representative',
      customerLocationId,
      status: 'accepted',
      version: 2,
    });
    const acceptedReplay = await request(application.getHttpServer())
      .post(`/api/v1/sales/handover-certificates/${shipped.handover?.id}/accept`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `sales-handover-${runId}`)
      .send(handoverAcceptance)
      .expect(200);
    expect((acceptedReplay.body as SalesWorkflow).handover?.status).toBe('accepted');

    const reconciledEquipment = await database.query<{
      product_id: string | null;
      serialized_item_id: string | null;
    }>(
      `SELECT product_id, serialized_item_id
       FROM master_data.customer_equipment WHERE id = $1`,
      [equipmentId],
    );
    expect(reconciledEquipment.rows[0]?.product_id).toBe(serialProductId);
    expect(reconciledEquipment.rows[0]?.serialized_item_id).toBeTruthy();
    const afterSales = await request(application.getHttpServer())
      .get('/api/v1/crm/after-sales')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const afterSalesOverview = afterSales.body as CrmAfterSalesOverview;
    const cardsForSerial = afterSalesOverview.warrantyCards.filter(
      (card) => card.serialNumber === serialNumber,
    );
    expect(cardsForSerial).toHaveLength(1);
    expect(afterSalesOverview.warrantyCardReconciliation).toEqual({
      eligibleSoldSerials: 1,
      missingCards: 0,
      registeredSoldSerials: 1,
    });
    expect(cardsForSerial[0]).toMatchObject({
      customerEquipmentId: equipmentId,
      customerLocationId,
      customerPartnerId: customerId,
      handoverNumber: accepted.handover?.number,
      warrantyEndsOn: '2027-01-01',
      warrantyStartsOn: '2026-01-01',
    });

    // Simulate a historical incomplete register, then reconcile only from recorded sales.
    await database.query('DELETE FROM crm.warranty_cards WHERE customer_equipment_id = $1', [
      equipmentId,
    ]);
    const warrantyGap = await request(application.getHttpServer())
      .get('/api/v1/crm/after-sales')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect((warrantyGap.body as CrmAfterSalesOverview).warrantyCardReconciliation).toEqual({
      eligibleSoldSerials: 1,
      missingCards: 1,
      registeredSoldSerials: 0,
    });
    await request(application.getHttpServer())
      .post('/api/v1/crm/after-sales/warranty-cards/reconcile')
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `warranty-reconcile-denied-${runId}`)
      .send({})
      .expect(403);
    const reconciliationKey = `warranty-reconcile-${runId}`;
    const reconciliation = await request(application.getHttpServer())
      .post('/api/v1/crm/after-sales/warranty-cards/reconcile')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', reconciliationKey)
      .send({})
      .expect(200);
    expect(reconciliation.body).toEqual({ cardsCreated: 1 });
    const reconciliationReplay = await request(application.getHttpServer())
      .post('/api/v1/crm/after-sales/warranty-cards/reconcile')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', reconciliationKey)
      .send({})
      .expect(200);
    expect(reconciliationReplay.body).toEqual({ cardsCreated: 1 });
    const emptyReconciliation = await request(application.getHttpServer())
      .post('/api/v1/crm/after-sales/warranty-cards/reconcile')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `warranty-reconcile-empty-${runId}`)
      .send({})
      .expect(200);
    expect(emptyReconciliation.body).toEqual({ cardsCreated: 0 });
    const reconciledOverview = await request(application.getHttpServer())
      .get('/api/v1/crm/after-sales')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const reconciledWarrantyOverview = reconciledOverview.body as CrmAfterSalesOverview;
    expect(reconciledWarrantyOverview.warrantyCardReconciliation).toEqual({
      eligibleSoldSerials: 1,
      missingCards: 0,
      registeredSoldSerials: 1,
    });
    expect(
      reconciledWarrantyOverview.warrantyCards.filter((card) => card.serialNumber === serialNumber),
    ).toHaveLength(1);
    const cardCount = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM crm.warranty_cards WHERE customer_equipment_id = $1`,
      [equipmentId],
    );
    expect(cardCount.rows[0]?.count).toBe('1');

    const warrantyCard = reconciledWarrantyOverview.warrantyCards.find(
      (card) => card.serialNumber === serialNumber,
    );
    expect(warrantyCard).toBeTruthy();
    const contractsBeforeOffer = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM sales.service_subscription_contracts
       WHERE customer_partner_id = $1`,
      [customerId],
    );
    const offerInput = {
      coverageStartsOn: '2027-01-02',
      durationMonths: 12,
      offerType: 'extended_warranty',
      quotedAmount: '240.00',
      terms: 'Coverage includes parts and labour for the extended period.',
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    };
    await request(application.getHttpServer())
      .post(`/api/v1/crm/after-sales/warranty-cards/${warrantyCard!.id}/coverage-offers`)
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `warranty-offer-denied-${runId}`)
      .send(offerInput)
      .expect(403);
    const offerKey = `warranty-coverage-offer-${runId}`;
    const offerResponse = await request(application.getHttpServer())
      .post(`/api/v1/crm/after-sales/warranty-cards/${warrantyCard!.id}/coverage-offers`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', offerKey)
      .send(offerInput)
      .expect(201);
    const coverageOffer = offerResponse.body as CrmWarrantyCoverageOffer;
    expect(coverageOffer).toMatchObject({
      coverageStartsOn: offerInput.coverageStartsOn,
      currencyCode: 'EUR',
      customerPartnerId: customerId,
      durationMonths: 12,
      offerType: 'extended_warranty',
      quotedAmount: '240.00',
      serialNumber,
      status: 'draft',
      validUntil: offerInput.validUntil,
      warrantyCardId: warrantyCard!.id,
      warrantyEndsOn: '2027-01-01',
    });
    expect(coverageOffer.number).toMatch(/^WOF-\d{4}-\d{6}$/u);
    const offerReplay = await request(application.getHttpServer())
      .post(`/api/v1/crm/after-sales/warranty-cards/${warrantyCard!.id}/coverage-offers`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', offerKey)
      .send(offerInput)
      .expect(201);
    expect((offerReplay.body as CrmWarrantyCoverageOffer).id).toBe(coverageOffer.id);
    const offerInOverview = await request(application.getHttpServer())
      .get('/api/v1/crm/after-sales')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect((offerInOverview.body as CrmAfterSalesOverview).coverageOffers).toEqual([
      expect.objectContaining({ id: coverageOffer.id, status: 'draft' }),
    ]);
    const sharedOfferResponse = await request(application.getHttpServer())
      .post(`/api/v1/crm/after-sales/coverage-offers/${coverageOffer.id}/status`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `warranty-coverage-offer-share-${runId}`)
      .send({ nextStatus: 'offered' })
      .expect(200);
    const sharedOffer = sharedOfferResponse.body as CrmWarrantyCoverageOffer;
    expect(sharedOffer.status).toBe('offered');
    const acceptedOfferResponse = await request(application.getHttpServer())
      .post(`/api/v1/crm/after-sales/coverage-offers/${coverageOffer.id}/status`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `warranty-coverage-offer-accept-${runId}`)
      .send({ nextStatus: 'accepted' })
      .expect(200);
    expect((acceptedOfferResponse.body as CrmWarrantyCoverageOffer).status).toBe('accepted');
    await request(application.getHttpServer())
      .post(`/api/v1/crm/after-sales/coverage-offers/${coverageOffer.id}/status`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `warranty-coverage-offer-invalid-${runId}`)
      .send({ nextStatus: 'declined' })
      .expect(409);
    await expect(
      database.query(`UPDATE crm.warranty_coverage_offers SET quoted_amount = 1 WHERE id = $1`, [
        coverageOffer.id,
      ]),
    ).rejects.toThrow('immutable');
    const contractsAfterOffer = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM sales.service_subscription_contracts
       WHERE customer_partner_id = $1`,
      [customerId],
    );
    expect(contractsAfterOffer.rows[0]?.count).toBe(contractsBeforeOffer.rows[0]?.count);

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

  it('rejects past quotation dates and keeps expired drafts unconfirmable', async () => {
    const server = application.getHttpServer() as Parameters<typeof request>[0];
    const invalid = await request(server)
      .post('/api/v1/sales/quotations')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `sales-expired-input-${runId}`)
      .send({ ...quotationInput(), validUntil: '2000-01-01' })
      .expect(400);
    expect(invalid.body).toMatchObject({
      error: { code: 'SALES_QUOTATION_VALIDITY_DATE_INVALID' },
    });

    const createdResponse = await request(server)
      .post('/api/v1/sales/quotations')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `sales-expired-draft-${runId}`)
      .send(quotationInput())
      .expect(201);
    const created = createdResponse.body as SalesWorkflow;
    await database.query(
      `UPDATE sales.quotations SET valid_until = '2000-01-01'::date WHERE id = $1`,
      [created.id],
    );

    const expired = await request(server)
      .get(`/api/v1/sales/workflows/${created.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(expired.body).toMatchObject({ id: created.id, status: 'expired' });

    const confirmation = await request(server)
      .post(`/api/v1/sales/quotations/${created.id}/confirm`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `sales-expired-confirm-${runId}`)
      .send({
        lines: created.lines.map((line) => ({
          quotationLineId: line.id,
          ...(line.productId === serialProductId ? { serialNumbers: [serialNumber] } : {}),
        })),
      })
      .expect(409);
    expect(confirmation.body).toMatchObject({ error: { code: 'SALES_QUOTATION_EXPIRED' } });
    const persisted = await database.query<{ status: string }>(
      `SELECT status FROM sales.quotations WHERE id = $1`,
      [created.id],
    );
    expect(persisted.rows[0]?.status).toBe('draft');
  });

  it('revises and cancels quotations with version checks, retained snapshots, and a printable PDF', async () => {
    const server = application.getHttpServer() as Parameters<typeof request>[0];
    const createdResponse = await request(server)
      .post('/api/v1/sales/quotations')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `sales-revision-create-${runId}`)
      .send(quotationInput())
      .expect(201);
    const created = createdResponse.body as SalesWorkflow;
    expect(created.version).toBe(1);

    const referencesResponse = await request(server)
      .get('/api/v1/sales/reference-data')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const references = referencesResponse.body as SalesReferenceData;
    expect(
      references.availability.find(
        (item) => item.productId === productId && item.warehouseId === warehouseId,
      )?.quantity,
    ).toMatch(/^\d+(?:\.\d+)?$/u);

    const revisionKey = `sales-revision-update-${runId}`;
    const revisedInput = {
      ...quotationInput(),
      expectedVersion: created.version,
      overallDiscountPercent: '7',
    };
    const revisedResponse = await request(server)
      .put(`/api/v1/sales/quotations/${created.id}`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', revisionKey)
      .send(revisedInput)
      .expect(200);
    const revised = revisedResponse.body as SalesWorkflow;
    expect(revised).toMatchObject({
      id: created.id,
      overallDiscountPercent: '7.0000',
      status: 'draft',
      version: 2,
    });
    const replayedRevision = await request(server)
      .put(`/api/v1/sales/quotations/${created.id}`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', revisionKey)
      .send(revisedInput)
      .expect(200);
    expect((replayedRevision.body as SalesWorkflow).version).toBe(2);

    const staleRevision = await request(server)
      .put(`/api/v1/sales/quotations/${created.id}`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `sales-revision-stale-${runId}`)
      .send({ ...revisedInput, expectedVersion: 1 })
      .expect(409);
    expect(staleRevision.body).toMatchObject({
      error: { code: 'SALES_QUOTATION_VERSION_CONFLICT' },
    });

    const pdf = await request(server)
      .get(`/api/v1/sales/quotations/${created.id}/pdf`)
      .set('authorization', `Bearer ${token}`)
      .expect(200)
      .expect('Content-Type', /application\/pdf/u);
    expect(pdf.headers['content-disposition']).toContain(`${created.number}.pdf`);
    expect(Number(pdf.headers['content-length'])).toBeGreaterThan(500);

    const quotationRecipient = `quotation-${runId}@example.invalid`;
    const quotationEmailKey = `sales-quotation-email-${runId}`;
    const queuedQuotationEmail = await request(server)
      .post(`/api/v1/sales/quotations/${created.id}/email`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', quotationEmailKey)
      .send({ expectedVersion: revised.version, recipientEmail: quotationRecipient })
      .expect(202);
    expect(queuedQuotationEmail.body).toMatchObject({
      recipientEmail: quotationRecipient,
      status: 'queued',
    });
    await request(server)
      .post(`/api/v1/sales/quotations/${created.id}/email`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', quotationEmailKey)
      .send({ expectedVersion: revised.version, recipientEmail: quotationRecipient })
      .expect(202);
    const queuedQuotationMessage = await database.query<{
      id: string;
      payload: { attachment?: { contentBase64: string; fileName: string }; text: string };
    }>(
      `SELECT id, payload FROM notifications.messages
       WHERE channel = 'email' AND payload->>'to' = $1`,
      [quotationRecipient],
    );
    expect(queuedQuotationMessage.rows).toHaveLength(1);
    expect(queuedQuotationMessage.rows[0]?.payload).toMatchObject({
      attachment: { fileName: `${created.number}.pdf` },
    });
    expect(queuedQuotationMessage.rows[0]?.payload.text).toContain('Прикачена е Вашата оферта');
    const quotationMessage = queuedQuotationMessage.rows[0];
    if (!quotationMessage) throw new Error('Quotation email was not queued');
    const emailCountBeforeQuotationDelivery = deliveredEmails.length;
    await application.get(NotificationDispatcherService).dispatch(quotationMessage.id, true);
    expect(deliveredEmails).toHaveLength(emailCountBeforeQuotationDelivery + 1);
    expect(deliveredEmails.at(-1)).toMatchObject({
      attachment: { fileName: `${created.number}.pdf`, mediaType: 'application/pdf' },
      subject: `Quotation / Оферта ${created.number}`,
      to: quotationRecipient,
    });
    expect(deliveredEmails.at(-1)?.attachment?.content.subarray(0, 4).toString()).toBe('%PDF');

    const historyBeforeCancel = await database.query<{
      versions: number[];
      snapshots: number;
    }>(
      `SELECT array_agg(version ORDER BY version) AS versions,
              count(*)::integer AS snapshots
       FROM sales.quotation_revisions WHERE quotation_id = $1`,
      [created.id],
    );
    expect(historyBeforeCancel.rows[0]).toEqual({ versions: [1, 2], snapshots: 2 });

    const cancelInput = {
      expectedVersion: revised.version,
      reason: 'Customer changed the request.',
    };
    const cancelledResponse = await request(server)
      .post(`/api/v1/sales/quotations/${created.id}/cancel`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `sales-revision-cancel-${runId}`)
      .send(cancelInput)
      .expect(200);
    const cancelled = cancelledResponse.body as SalesWorkflow;
    expect(cancelled).toMatchObject({
      cancellationReason: cancelInput.reason,
      status: 'cancelled',
      version: 3,
    });
    const replayedCancel = await request(server)
      .post(`/api/v1/sales/quotations/${created.id}/cancel`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `sales-revision-cancel-${runId}`)
      .send(cancelInput)
      .expect(200);
    expect((replayedCancel.body as SalesWorkflow).version).toBe(3);

    await request(server)
      .put(`/api/v1/sales/quotations/${created.id}`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `sales-revision-after-cancel-${runId}`)
      .send({ ...quotationInput(), expectedVersion: 3 })
      .expect(409);
    const historyAfterCancel = await database.query<{ versions: number[]; snapshots: number }>(
      `SELECT array_agg(version ORDER BY version) AS versions,
              count(*)::integer AS snapshots
       FROM sales.quotation_revisions WHERE quotation_id = $1`,
      [created.id],
    );
    expect(historyAfterCancel.rows[0]).toEqual({ versions: [1, 2, 3], snapshots: 3 });
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

    courierAdapter.isConfigured.mockImplementation((provider: string) => provider === 'speedy');
    courierAdapter.create.mockRejectedValueOnce(
      new CourierProviderError('The booking result could not be confirmed.', 'uncertain'),
    );
    const courierEvents = [
      {
        description: 'Shipment accepted',
        occurredAt: '2026-08-26T08:00:00+00:00',
        place: 'Vratsa',
        status: 'accepted',
      },
    ];
    courierAdapter.track.mockResolvedValue({
      events: courierEvents,
      providerStatus: 'Shipment accepted',
    });

    const deliveryKey = `logistics-delivery-${runId}`;
    const deliveryInput = {
      customerLocationId,
      deliveryMethod: 'speedy',
      instructions: 'Call the customer before arrival.',
      parcelCount: 1,
      parcelWeightKg: '2.500',
      recipientName: 'Customer Representative',
      recipientPhone: '+359888123456',
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
      courierBooking: { status: 'pending' },
      deliveryMethod: 'speedy',
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

    await request(application.getHttpServer())
      .post(`/api/v1/logistics/deliveries/${delivery.id}/courier-booking`)
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `logistics-courier-viewer-${runId}`)
      .expect(403);
    const uncertainBookingResponse = await request(application.getHttpServer())
      .post(`/api/v1/logistics/deliveries/${delivery.id}/courier-booking`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `logistics-courier-book-${runId}`);
    expect(uncertainBookingResponse.status, JSON.stringify(uncertainBookingResponse.body)).toBe(
      200,
    );
    const uncertainBooking = uncertainBookingResponse;
    expect(uncertainBooking.body as LogisticsDelivery).toMatchObject({
      courierBooking: {
        attemptCount: 1,
        lastError: 'The booking result could not be confirmed.',
        status: 'needs_review',
      },
    });
    await request(application.getHttpServer())
      .post(`/api/v1/logistics/deliveries/${delivery.id}/courier-booking`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `logistics-courier-book-retry-${runId}`)
      .expect(409);
    expect(courierAdapter.create).toHaveBeenCalledTimes(1);

    const reconciled = await request(application.getHttpServer())
      .post(`/api/v1/logistics/deliveries/${delivery.id}/courier-booking/reconcile`)
      .set('authorization', `Bearer ${token}`)
      .send({ providerReference: 'SP-2026-000001' })
      .expect(200);
    expect(reconciled.body as LogisticsDelivery).toMatchObject({
      courierBooking: {
        events: courierEvents,
        providerReference: 'SP-2026-000001',
        status: 'booked',
      },
    });
    await request(application.getHttpServer())
      .post(`/api/v1/logistics/deliveries/${delivery.id}/courier-booking/reconcile`)
      .set('authorization', `Bearer ${token}`)
      .send({ providerReference: 'SP-2026-000001' })
      .expect(200);
    expect(courierAdapter.track).toHaveBeenCalledTimes(1);

    const tracked = await request(application.getHttpServer())
      .post(`/api/v1/logistics/deliveries/${delivery.id}/courier-tracking`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(tracked.body as LogisticsDelivery).toMatchObject({
      courierBooking: {
        events: courierEvents,
        providerStatus: 'Shipment accepted',
        status: 'booked',
      },
    });
    const eventCount = await database.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM logistics.delivery_courier_tracking_events WHERE delivery_id=$1',
      [delivery.id],
    );
    expect(eventCount.rows[0]?.count).toBe('1');
    courierAdapter.track.mockRejectedValueOnce(
      new CourierProviderError('Tracking is temporarily unavailable.', 'unavailable'),
    );
    const failedTracking = await request(application.getHttpServer())
      .post(`/api/v1/logistics/deliveries/${delivery.id}/courier-tracking`)
      .set('authorization', `Bearer ${token}`)
      .expect(409);
    expect(failedTracking.body).toMatchObject({
      error: { code: 'LOGISTICS_COURIER_TRACKING_FAILED' },
    });
    const storedTrackingFailure = await database.query<{
      courier_last_checked_at: string | null;
      courier_last_error: string | null;
    }>(
      'SELECT courier_last_checked_at::text, courier_last_error FROM logistics.deliveries WHERE id=$1',
      [delivery.id],
    );
    expect(storedTrackingFailure.rows[0]).toMatchObject({
      courier_last_error: 'Tracking is temporarily unavailable.',
    });
    expect(storedTrackingFailure.rows[0]?.courier_last_checked_at).toBeTruthy();

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
    expect(evidence.rows[0]).toEqual({ audit_count: '10', outbox_count: '10' });
  });

  it('uses each supplier invoice rate snapshot in EUR journals, VAT and finance exports', async () => {
    const invoiceDate = '2099-09-03';
    const dueDate = '2099-09-10';
    await database.query(
      `INSERT INTO finance.currency_rates (currency_code, rate_date, eur_per_unit)
       VALUES ('USD', $1, 0.92000000)
       ON CONFLICT (currency_code, rate_date) DO UPDATE
       SET eur_per_unit = EXCLUDED.eur_per_unit`,
      [invoiceDate],
    );
    const orderResponse = await request(application.getHttpServer())
      .post('/api/v1/procurement/purchase-orders')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `foreign-purchase-order-${runId}`)
      .send({
        currencyCode: 'USD',
        lines: [
          {
            expectedDeliveryDate: dueDate,
            productId,
            quantity: '2',
            unitPrice: '10',
          },
        ],
        supplierPartnerId: supplierId,
        warehouseId,
      })
      .expect(201);
    const purchaseOrder = orderResponse.body as {
      id: string;
      lines: Array<{ id: string; productId: string }>;
    };
    const orderLine = purchaseOrder.lines[0];
    if (!orderLine) throw new Error('Foreign-currency order line was missing');
    const invoiceResponse = await request(application.getHttpServer())
      .post('/api/v1/procurement/supplier-invoices')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `foreign-supplier-invoice-${runId}`)
      .send({
        invoiceDate,
        invoiceNumber: `USD-${runId.slice(0, 12)}`,
        lines: [
          {
            orderLineId: orderLine.id,
            quantity: '2',
            unitPrice: '10',
            vatRate: '20',
            vatTreatment: 'standard_20',
          },
        ],
        purchaseOrderId: purchaseOrder.id,
      })
      .expect(201);
    const invoice = invoiceResponse.body as SupplierInvoice;
    foreignSupplierInvoiceId = invoice.id;
    expect(invoice).toMatchObject({
      currencyCode: 'USD',
      exchangeRate: '0.92000000',
      rateDate: invoiceDate,
      rateSource: 'BNB',
      total: '24.0000',
    });
    await expect(
      database.query(
        `UPDATE procurement.supplier_invoices
         SET exchange_rate = 0.93000000 WHERE id = $1`,
        [invoice.id],
      ),
    ).rejects.toThrow('supplier invoice exchange-rate snapshots cannot be changed');

    const journalResponse = await request(application.getHttpServer())
      .get(
        `/api/v1/finance/reports/journal?kind=purchase&dateFrom=${invoiceDate}&dateTo=${invoiceDate}`,
      )
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(journalResponse.body as FinanceJournalReport).toMatchObject({
      items: [
        expect.objectContaining({
          exchangeRate: '0.92000000',
          grossEurTotal: '22.0800',
          netEurTotal: '18.4000',
          number: invoice.invoiceNumber,
          taxBreakdownComplete: true,
          vatEurTotal: '3.6800',
        }),
      ],
      totals: {
        documentCount: 1,
        grossEurTotal: '22.0800',
        incompleteTaxDocuments: 0,
        netEurTotal: '18.4000',
        vatEurTotal: '3.6800',
      },
    });
    const vatResponse = await request(application.getHttpServer())
      .get(`/api/v1/finance/reports/vat-review?dateFrom=${invoiceDate}&dateTo=${invoiceDate}`)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(vatResponse.body as FinanceVatReviewReport).toMatchObject({
      incompletePurchaseDocumentNumbers: [],
      incompletePurchaseDocuments: 0,
      recordedDifferenceEur: '-3.6800',
      recordedInputVatEur: '3.6800',
      recordedOutputVatEur: '0.0000',
    });

    const exportData = await application.get(FinanceReportsService).exportData('finance.outcome', {
      dateFrom: invoiceDate,
      dateTo: invoiceDate,
    });
    expect(exportData.rows).toEqual([
      expect.objectContaining({
        currencyCode: 'USD',
        exchangeRate: '0.92000000',
        eurNetTotal: '18.4000',
        eurTotal: '22.0800',
        eurVatTotal: '3.6800',
        netTotal: '20.0000',
        total: '24.0000',
        vatTotal: '4.0000',
      }),
    ]);
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

    const searchedCollections = await request(application.getHttpServer())
      .get(`/api/v1/finance/documents/search?search=${encodeURIComponent(created.number)}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(searchedCollections.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.id, number: created.number })]),
    );

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

    const futureState = await database.query(
      `SELECT (SELECT count(*)::text FROM finance.payments) AS customer_payments,
              (SELECT count(*)::text FROM finance.supplier_payments) AS supplier_payments,
              (SELECT count(*)::text FROM finance.payment_allocations) AS customer_allocations,
              (SELECT count(*)::text FROM finance.supplier_payment_allocations) AS supplier_allocations`,
    );
    for (const [endpoint, input] of [
      [
        `supplier-payables/${supplierPayable.id}/payments`,
        {
          amount: '1',
          paymentDate: '2099-12-31',
          paymentMethod: 'bank_transfer',
        },
      ],
      [
        'supplier-offsets',
        {
          amount: '1',
          customerDocumentId: created.id,
          supplierPayableId: supplierPayable.id,
          expectedCustomerDocumentVersion: created.version,
          expectedSupplierPayableVersion: supplierPayable.version,
          offsetDate: '2099-12-31',
          reason: 'QA future-date rejection',
        },
      ],
    ] as const) {
      const rejected = await request(application.getHttpServer())
        .post(`/api/v1/finance/${endpoint}`)
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `future-date-${endpoint}-${runId}`)
        .send(input)
        .expect(400);
      expect(rejected.body.error.code).toBe('FINANCE_PAYMENT_FUTURE_DATE_INVALID');
    }
    const afterFutureState = await database.query(
      `SELECT (SELECT count(*)::text FROM finance.payments) AS customer_payments,
              (SELECT count(*)::text FROM finance.supplier_payments) AS supplier_payments,
              (SELECT count(*)::text FROM finance.payment_allocations) AS customer_allocations,
              (SELECT count(*)::text FROM finance.supplier_payment_allocations) AS supplier_allocations`,
    );
    expect(afterFutureState.rows).toEqual(futureState.rows);

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

    const customerAdvanceResponse = await request(application.getHttpServer())
      .post('/api/v1/finance/customer-accounts/advances')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-customer-advance-${runId}`)
      .send({
        amount: '10',
        customerPartnerId: customerId,
        paymentMethod: 'bank_transfer',
        paymentReference: `CUSTOMER-ADV-${runId}`,
        receivedOn: dueDate,
      })
      .expect(201);
    const customerAdvance = customerAdvanceResponse.body as CustomerAdvance;
    expect(customerAdvance).toMatchObject({ amount: '10.0000', availableAmount: '10.0000' });
    const accountBeforeAllocation = await request(application.getHttpServer())
      .get(`/api/v1/finance/customer-accounts/${customerId}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(accountBeforeAllocation.body as CustomerPaymentAccount).toMatchObject({
      advances: [expect.objectContaining({ id: customerAdvance.id, availableAmount: '10.0000' })],
      openReceivables: [
        expect.objectContaining({
          allocatedTotal: '10.0000',
          id: created.id,
          outstandingTotal: '263.6000',
        }),
      ],
    });
    const advanceAllocationInput = { amount: '10', customerAdvanceId: customerAdvance.id };
    await request(application.getHttpServer())
      .post(`/api/v1/finance/documents/${created.id}/advance-allocations`)
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `customer-advance-viewer-${runId}`)
      .send(advanceAllocationInput)
      .expect(403);
    await request(application.getHttpServer())
      .post(`/api/v1/finance/documents/${created.id}/advance-allocations`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `customer-advance-too-large-${runId}`)
      .send({ amount: '11', customerAdvanceId: customerAdvance.id })
      .expect(409);
    const concurrentAdvanceAllocations = await Promise.all(
      ['first', 'second'].map((attempt) =>
        request(application.getHttpServer())
          .post(`/api/v1/finance/documents/${created.id}/advance-allocations`)
          .set('authorization', `Bearer ${token}`)
          .set('idempotency-key', `customer-advance-race-${attempt}-${runId}`)
          .send({ amount: '7', customerAdvanceId: customerAdvance.id }),
      ),
    );
    expect(concurrentAdvanceAllocations.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    const remainingAdvanceAllocation = { amount: '3', customerAdvanceId: customerAdvance.id };
    const advanceAllocationResponse = await request(application.getHttpServer())
      .post(`/api/v1/finance/documents/${created.id}/advance-allocations`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `customer-advance-allocation-${runId}`)
      .send(remainingAdvanceAllocation)
      .expect(201);
    const afterAdvanceAllocation = advanceAllocationResponse.body as FinanceCustomerDocument;
    expect(afterAdvanceAllocation).toMatchObject({
      allocatedTotal: '20.0000',
      outstandingTotal: '253.6000',
    });
    expect(afterAdvanceAllocation.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount: '3.0000',
          paymentDate: dueDate,
          paymentMethod: 'bank_transfer',
          paymentReference: `CUSTOMER-ADV-${runId}`,
          sourceCustomerAdvanceNumber: customerAdvance.number,
        }),
        expect.objectContaining({
          amount: '7.0000',
          paymentDate: dueDate,
          paymentMethod: 'bank_transfer',
          paymentReference: `CUSTOMER-ADV-${runId}`,
          sourceCustomerAdvanceNumber: customerAdvance.number,
        }),
      ]),
    );
    const advanceAllocationReplay = await request(application.getHttpServer())
      .post(`/api/v1/finance/documents/${created.id}/advance-allocations`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `customer-advance-allocation-${runId}`)
      .send(remainingAdvanceAllocation)
      .expect(201);
    expect((advanceAllocationReplay.body as FinanceCustomerDocument).allocatedTotal).toBe(
      '20.0000',
    );
    const customerAdvanceAllocationLedger = await database.query<{
      applied_total: string;
      payment_count: string;
    }>(
      `SELECT COALESCE(sum(entry.amount), 0)::text AS applied_total,
              (SELECT count(DISTINCT payment.id)::text
               FROM finance.payments payment
               JOIN finance.payment_allocations allocation ON allocation.payment_id = payment.id
               WHERE payment.source_customer_advance_id = $1
                 AND allocation.customer_document_id = $2) AS payment_count
       FROM finance.customer_advance_entries entry
       WHERE entry.advance_id = $1 AND entry.customer_document_id = $2
         AND entry.entry_type = 'applied'`,
      [customerAdvance.id, created.id],
    );
    expect(customerAdvanceAllocationLedger.rows[0]).toEqual({
      applied_total: '10.0000',
      payment_count: '2',
    });
    const accountAfterAllocation = await request(application.getHttpServer())
      .get(`/api/v1/finance/customer-accounts/${customerId}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(accountAfterAllocation.body as CustomerPaymentAccount).toMatchObject({
      advanceBalance: '0.0000',
      advances: [],
      openReceivables: [
        expect.objectContaining({
          allocatedTotal: '20.0000',
          id: created.id,
          outstandingTotal: '253.6000',
        }),
      ],
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
      allocatedTotal: '120.0000',
      outstandingTotal: '153.6000',
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
        expect.objectContaining({ id: created.id, outstandingTotal: '153.6000' }),
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
    const insufficientCash = await request(application.getHttpServer())
      .post('/api/v1/finance/cash/vouchers')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-cash-insufficient-${runId}`)
      .send({
        ...cashReceiptInput,
        customerDocumentId: undefined,
        counterpartyName: 'Office supplier',
        direction: 'payment',
        amount: '5000',
      })
      .expect(409);
    expect(insufficientCash.body.error.code).toBe('FINANCE_CASH_INSUFFICIENT_BALANCE');

    const futurePayment = await request(application.getHttpServer())
      .post(`/api/v1/finance/documents/${created.id}/payments`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-future-payment-${runId}`)
      .send({ amount: '1', paymentMethod: 'bank_transfer', paymentDate: '2099-12-31' })
      .expect(400);
    expect(futurePayment.body.error.code).toBe('FINANCE_PAYMENT_FUTURE_DATE_INVALID');
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
    const concurrentPayments = await Promise.all(
      ['A', 'B'].map((suffix) =>
        request(application.getHttpServer())
          .post('/api/v1/finance/cash/vouchers')
          .set('authorization', `Bearer ${token}`)
          .set('idempotency-key', `cash-no-overdraft-${suffix}-${runId}`)
          .send({
            amount: '12',
            cashRegisterId,
            counterpartyName: 'Office supplier',
            direction: 'payment',
            operatorId: cashOperatorId,
            purpose: 'Concurrent expense',
            voucherDate: dueDate,
          }),
      ),
    );
    expect(concurrentPayments.map((result) => result.status).sort()).toEqual([201, 409]);
    const winner = concurrentPayments.find((result) => result.status === 201)
      ?.body as FinanceCashVoucher;
    await request(application.getHttpServer())
      .post(`/api/v1/finance/cash/vouchers/${winner.id}/cancel`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `cash-concurrency-cleanup-${runId}`)
      .send({ cancellationReason: 'Concurrency verification complete.', expectedVersion: 1 })
      .expect(200);
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
      allocatedTotal: '140.0000',
      outstandingTotal: '133.6000',
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
          outstandingEurTotal: '133.6000',
        }),
      ],
      kind: 'receivable',
      totalItems: 1,
      totals: { days0To30: '133.6000', total: '133.6000' },
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
          outstandingEurTotal: '46.0000',
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
        allocatedEurTotal: '140.0000',
        documentCount: 1,
        grossEurTotal: '273.6000',
        outstandingEurTotal: '133.6000',
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
        allocatedEurTotal: '50.0000',
        documentCount: 1,
        grossEurTotal: '96.0000',
        outstandingEurTotal: '46.0000',
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
        grossEurTotal: '96.0000',
        incompleteTaxDocuments: 0,
        netEurTotal: '80.0000',
        vatEurTotal: '16.0000',
      },
    });
    const vatReviewResponse = await request(application.getHttpServer())
      .get(`/api/v1/finance/reports/vat-review?dateFrom=${turnoverDateFrom}&dateTo=${dueDate}`)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(vatReviewResponse.body as FinanceVatReviewReport).toMatchObject({
      incompletePurchaseDocumentNumbers: [],
      incompletePurchaseDocuments: 0,
      recordedDifferenceEur: '-16.0000',
      recordedInputVatEur: '16.0000',
      recordedOutputVatEur: '0.0000',
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
        expect.objectContaining({
          formats: ['csv', 'xlsx', 'pdf'],
          key: 'finance.income',
          requiresDateRange: true,
        }),
        expect.objectContaining({
          formats: ['csv', 'xlsx', 'pdf'],
          key: 'finance.outcome',
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

    for (const format of ['csv', 'xlsx'] as const) {
      for (const definitionKey of ['finance.income', 'finance.outcome'] as const) {
        const jobKey = `${definitionKey.replaceAll('.', '-')}-${format}-${runId}`;
        const exportResponse = await request(application.getHttpServer())
          .post('/api/v1/finance/report-exports')
          .set('authorization', `Bearer ${token}`)
          .set('idempotency-key', jobKey)
          .send({ dateFrom: turnoverDateFrom, dateTo: dueDate, definitionKey, format })
          .expect(202);
        const exportRecord = exportResponse.body as FinanceReportExport;
        const reportResult = (await handlers.execute({
          attemptNumber: 1,
          correlationId: jobKey,
          enqueuedAt: '2026-08-21T12:00:00.000Z',
          idempotencyKey: `finance-report-export:${exportRecord.id}`,
          jobId: jobKey,
          maxAttempts: 5,
          name: 'report.generate',
          payload: { exportId: exportRecord.id },
          retryAllowed: true,
        })) as { rowCount?: number };
        expect(typeof reportResult.rowCount).toBe('number');
        const downloaded = await request(application.getHttpServer())
          .get(`/api/v1/finance/report-exports/${exportRecord.id}/content`)
          .set('authorization', `Bearer ${token}`)
          .expect('content-type', format === 'csv' ? /csv/u : /spreadsheetml/u)
          .expect(200);
        if (format === 'csv') {
          expect(downloaded.text).toContain(
            'Transaction number,Invoice number,Invoice date,Partner,Account code,Net amount,VAT amount,VAT rate(s),Total amount,Currency,EUR rate,Net EUR,VAT EUR,Total EUR,Payment date',
          );
        } else {
          expect(Number(downloaded.headers['content-length'])).toBeGreaterThan(2_000);
          expect(downloaded.headers['content-disposition']).toContain('.xlsx');
        }
      }
    }

    const selectedInput = {
      dateFrom: turnoverDateFrom,
      dateTo: dueDate,
      definitionKey: 'finance.supplier-turnover',
      format: 'csv',
      columns: ['partnerName', 'grossEurTotal'],
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
    expect(selectedFile.text).toContain('Partner,Gross EUR');
    expect(selectedFile.text).not.toContain('Outstanding EUR');
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
      closingBalance: '1087.6',
      currencyCode: 'EUR',
      lines: [
        {
          amount: '120',
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
    const priorValueDate = new Date(`${dueDate}T00:00:00.000Z`);
    priorValueDate.setUTCDate(priorValueDate.getUTCDate() - 1);
    const priorValueDateStatement = await request(application.getHttpServer())
      .post('/api/v1/finance/bank-statements')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `prior-value-date-${runId}`)
      .send({
        ...statementInput,
        closingBalance: '1001',
        lines: [
          {
            amount: '1',
            counterpartyName: 'Prior value date test',
            direction: 'incoming',
            paymentReference: `Prior value date ${runId}`,
            transactionDate: dueDate,
            valueDate: priorValueDate.toISOString().slice(0, 10),
          },
        ],
        statementReference: `PRIOR-VALUE-${runId}`,
      })
      .expect(201);
    expect((priorValueDateStatement.body as FinanceBankStatement).transactions[0]).toMatchObject({
      transactionDate: dueDate,
      valueDate: priorValueDate.toISOString().slice(0, 10),
    });
    const futureStatementResponse = await request(application.getHttpServer())
      .post('/api/v1/finance/bank-statements')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `future-bank-create-${runId}`)
      .send({
        ...statementInput,
        statementReference: `FUTURE-${runId}`,
        closingBalance: '1000',
        lines: ['incoming', 'outgoing'].map((direction) => ({
          amount: '1',
          counterpartyName: 'QA pending transfer',
          direction,
          paymentReference: `Unrecognized future transfer ${runId}`,
          transactionDate: dueDate,
          valueDate: '2099-12-31',
        })),
      })
      .expect(201);
    const futureStatement = futureStatementResponse.body as FinanceBankStatement;
    for (const transaction of futureStatement.transactions) {
      const incoming = transaction.direction === 'incoming';
      const rejected = await request(application.getHttpServer())
        .post(
          `/api/v1/finance/bank-transactions/${transaction.id}/${incoming ? 'match' : 'supplier-match'}`,
        )
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `future-bank-match-${transaction.id}-${runId}`)
        .send(
          incoming
            ? { customerDocumentId: created.id, expectedVersion: transaction.version }
            : {
                mode: 'payable',
                supplierPayableId: supplierPayable.id,
                expectedVersion: transaction.version,
              },
        )
        .expect(400);
      expect(rejected.body.error.code).toBe('FINANCE_PAYMENT_FUTURE_DATE_INVALID');
    }
    const afterFutureMatch = (
      await request(application.getHttpServer())
        .get(`/api/v1/finance/bank-statements/${futureStatement.id}`)
        .set('authorization', `Bearer ${token}`)
        .expect(200)
    ).body as FinanceBankStatement;
    expect(afterFutureMatch.transactions.every((line) => line.matchStatus === 'unmatched')).toBe(
      true,
    );

    const bankKey = `finance-bank-create-${runId}`;
    const statementResponse = await request(application.getHttpServer())
      .post('/api/v1/finance/bank-statements')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', bankKey)
      .send(statementInput)
      .expect(201);
    const statement = statementResponse.body as FinanceBankStatement;
    expect(statement).toMatchObject({
      incomingTotal: '133.6000',
      matchedIncomingCount: 1,
      matchedOutgoingCount: 0,
      status: 'open',
      unmatchedIncomingCount: 2,
      unmatchedOutgoingCount: 1,
    });
    expect(statement.transactions[0]).toMatchObject({
      amount: '120.0000',
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
    expect(settled.payments).toHaveLength(8);
    expect(settled.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: '20.0000', paymentMethod: 'cash' }),
        expect.objectContaining({ amount: '120.0000', paymentMethod: 'bank_transfer' }),
        expect.objectContaining({
          amount: '3.0000',
          paymentMethod: 'bank_transfer',
          sourceCustomerAdvanceNumber: customerAdvance.number,
        }),
        expect.objectContaining({
          amount: '7.0000',
          paymentMethod: 'bank_transfer',
          sourceCustomerAdvanceNumber: customerAdvance.number,
        }),
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

    const originalCashPayment = settled.payments.find(
      (payment) => payment.paymentMethod === 'cash',
    );
    if (!originalCashPayment) throw new Error('Expected the recorded cash payment');
    const deniedPaymentReversal = await request(application.getHttpServer())
      .post(`/api/v1/finance/documents/${created.id}/payments/${originalCashPayment.id}/reverse`)
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `finance-reversal-denied-${runId}`)
      .send({ expectedDocumentVersion: settled.version, reason: 'Correcting a duplicate entry.' })
      .expect(403);
    expect(deniedPaymentReversal.body.error.code).toBe('PERMISSION_DENIED');
    const reversalRequest = {
      expectedDocumentVersion: settled.version,
      reason: 'Correcting a duplicate cash entry.',
    };
    const reversedDocumentResponse = await request(application.getHttpServer())
      .post(`/api/v1/finance/documents/${created.id}/payments/${originalCashPayment.id}/reverse`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-reversal-${runId}`)
      .send(reversalRequest)
      .expect(200);
    const reversedDocument = reversedDocumentResponse.body as FinanceCustomerDocument;
    expect(reversedDocument).toMatchObject({
      allocatedTotal: '253.6000',
      outstandingTotal: '20.0000',
      paymentStatus: 'overdue',
    });
    const reversedPayment = reversedDocument.payments.find(
      (payment) => payment.id === originalCashPayment.id,
    );
    expect(reversedPayment?.reversal?.reason).toBe(reversalRequest.reason);
    expect(reversedPayment?.reversal?.reversedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    const reversalReplay = await request(application.getHttpServer())
      .post(`/api/v1/finance/documents/${created.id}/payments/${originalCashPayment.id}/reverse`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-reversal-${runId}`)
      .send(reversalRequest)
      .expect(200);
    expect(
      (reversalReplay.body as FinanceCustomerDocument).payments.find(
        (payment) => payment.id === originalCashPayment.id,
      )?.reversal?.number,
    ).toBe(reversedPayment?.reversal?.number);
    await request(application.getHttpServer())
      .post(`/api/v1/finance/documents/${created.id}/payments/${originalCashPayment.id}/reverse`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-reversal-second-key-${runId}`)
      .send({ ...reversalRequest, expectedDocumentVersion: reversedDocument.version })
      .expect(409);

    const repeatedOutgoingResponse = await request(application.getHttpServer())
      .post('/api/v1/finance/bank-statements')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-bank-repeat-${runId}`)
      .send({
        ...statementInput,
        closingBalance: '954',
        lines: [statementInput.lines[3]!],
        openingBalance: '1000',
        statementReference: `STATEMENT-REPEAT-${runId}`,
      })
      .expect(201);
    const repeatedStatement = repeatedOutgoingResponse.body as FinanceBankStatement;
    const repeatedOutgoing = repeatedStatement.transactions[0];
    expect(repeatedOutgoing).toMatchObject({
      matchStatus: 'unmatched',
      possibleDuplicate: true,
    });
    if (!repeatedOutgoing) throw new Error('Expected a repeated outgoing bank line');
    const duplicateMatchRejected = await request(application.getHttpServer())
      .post(`/api/v1/finance/bank-transactions/${repeatedOutgoing.id}/supplier-match`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-bank-repeat-unreviewed-${runId}`)
      .send({
        expectedVersion: repeatedOutgoing.version,
        mode: 'advance',
        supplierPartnerId: supplierPayable.supplierPartnerId,
      })
      .expect(409);
    expect(duplicateMatchRejected.body.error.code).toBe(
      'FINANCE_BANK_POSSIBLE_DUPLICATE_REVIEW_REQUIRED',
    );
    const confirmedSeparateTransfer = await request(application.getHttpServer())
      .post(`/api/v1/finance/bank-transactions/${repeatedOutgoing.id}/supplier-match`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-bank-repeat-reviewed-${runId}`)
      .send({
        expectedVersion: repeatedOutgoing.version,
        mode: 'advance',
        reviewPossibleDuplicate: true,
        supplierPartnerId: supplierPayable.supplierPartnerId,
      })
      .expect(200);
    expect(confirmedSeparateTransfer.body as FinanceSupplierPayment).toMatchObject({
      amount: '46.0000',
      kind: 'advance',
      sourceBankTransactionId: repeatedOutgoing.id,
    });
    const reviewedStatement = await request(application.getHttpServer())
      .get(`/api/v1/finance/bank-statements/${repeatedStatement.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect((reviewedStatement.body as FinanceBankStatement).transactions[0]).toMatchObject({
      matchStatus: 'matched',
    });

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
      allocation_count: '8',
      audit_count: '28',
      outbox_count: '28',
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
    await database.query(
      `INSERT INTO finance.currency_rates (currency_code, rate_date, eur_per_unit)
       VALUES ('USD', $1, 0.92000000)`,
      [issueDate],
    );
    const exchangeRateResponse = await request(application.getHttpServer())
      .get(
        `/api/v1/finance/financial-documents/exchange-rate?currencyCode=USD&rateDate=${issueDate}`,
      )
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(exchangeRateResponse.body).toEqual({
      currencyCode: 'USD',
      exchangeRate: '0.92000000',
      rateDate: issueDate,
      rateSource: 'BNB',
    });
    const invoiceInput = {
      businessLocationId: scope.locationId,
      currencyCode: 'EUR',
      customerPartnerId: customerId,
      documentType: 'invoice',
      dueDate: issueDate,
      exchangeRate: '1',
      issueDate,
      legalEntityId: scope.legalEntityId,
      rateDate: issueDate,
      rateSource: 'internal_eur',
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
      currencyCode: 'EUR',
      documentType: 'invoice',
      exchangeRate: '1.00000000',
      grossTotal: '273.6000',
      sourceSalesInvoiceId: salesInvoiceId,
      status: 'draft',
    });
    expect(invoice).not.toHaveProperty('officialNumber');
    const analyticsWithDraft = await request(application.getHttpServer())
      .get(`/api/v1/crm/analytics/overview?dateFrom=${issueDate}&dateTo=${issueDate}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(analyticsWithDraft.body.totalNetRevenueEur).toBe('0.00');
    expect(analyticsWithDraft.body.customerMetrics.activeCustomers).toBe(0);
    expect(invoice.number).toMatch(/^DINV-[A-Z0-9-]+-ALL-REG-ALL-OPS-[A-F0-9]{12}-\d{4}-\d{6}$/u);
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
        documentCount: 0,
        grossEurTotal: '0',
        incompleteTaxDocuments: 0,
        netEurTotal: '0',
        vatEurTotal: '0',
      },
    });
    const combinedVatResponse = await request(application.getHttpServer())
      .get(`/api/v1/finance/reports/vat-review?dateFrom=${issueDate}&dateTo=${issueDate}`)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(combinedVatResponse.body as FinanceVatReviewReport).toMatchObject({
      incompletePurchaseDocumentNumbers: [],
      incompletePurchaseDocuments: 0,
      recordedDifferenceEur: '-16.0000',
      recordedInputVatEur: '16.0000',
      recordedOutputVatEur: '0.0000',
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
    expect(registerScopedInvoice.number).toMatch(
      /^DINV-[A-Z0-9-]+-[A-Z0-9-]+-ALL-OPS-[A-F0-9]{12}-\d{4}-\d{6}$/u,
    );

    const manualInput = {
      ...invoiceInput,
      sourceSalesInvoiceId: undefined,
      lines: [
        {
          description: 'Rate verification',
          discountPercent: '0',
          productId,
          quantity: '1',
          unitCode,
          unitPrice: '10',
          vatTreatment: 'standard_20',
        },
      ],
    };
    const invalidRate = await request(application.getHttpServer())
      .post('/api/v1/finance/financial-documents')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `qa-foreign-rate-${runId}`)
      .send({ ...manualInput, currencyCode: 'USD', exchangeRate: '1', rateSource: 'internal_eur' })
      .expect(400);
    expect(invalidRate.body.error.code).toBe('FINANCE_RATE_SOURCE_INVALID');

    const foreignDraftResponse = await request(application.getHttpServer())
      .post('/api/v1/finance/financial-documents')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `financial-document-usd-${runId}`)
      .send({
        ...manualInput,
        currencyCode: 'USD',
        exchangeRate: '1',
        rateSource: 'BNB',
      })
      .expect(201);
    expect(foreignDraftResponse.body as FinancialDocument).toMatchObject({
      currencyCode: 'USD',
      eurGrossTotal: '11.0400',
      exchangeRate: '0.92000000',
      grossTotal: '12.0000',
      rateDate: issueDate,
      rateSource: 'BNB',
    });

    const creditInput = {
      ...manualInput,
      documentType: 'credit_note',
      correctionOfDocumentId: registerScopedInvoice.id,
      correctionReason: 'QA correction verification',
      dueDate: undefined,
    };
    const excessiveCredit = await request(application.getHttpServer())
      .post('/api/v1/finance/financial-documents')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `qa-excessive-credit-${runId}`)
      .send({ ...creditInput, lines: [{ ...manualInput.lines[0], unitPrice: '1000' }] })
      .expect(400);
    expect(excessiveCredit.body.error.code).toBe('FINANCE_CREDIT_EXCEEDS_ORIGINAL');
    const excessiveQuantity = await request(application.getHttpServer())
      .post('/api/v1/finance/financial-documents')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `qa-excessive-credit-quantity-${runId}`)
      .send({ ...creditInput, lines: [{ ...manualInput.lines[0], quantity: '2', unitPrice: '1' }] })
      .expect(400);
    expect(excessiveQuantity.body.error.code).toBe('FINANCE_CREDIT_QUANTITY_EXCEEDS_ORIGINAL');

    const correctionResponse = await request(application.getHttpServer())
      .post('/api/v1/finance/financial-documents')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `financial-document-credit-${runId}`)
      .send({
        businessLocationId: scope.locationId,
        correctionOfDocumentId: invoice.id,
        correctionReason: 'One damaged unit was returned before legal issuance.',
        currencyCode: 'EUR',
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
        rateSource: 'internal_eur',
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
    expect(register.body).toMatchObject({ page: 1, pageSize: 10, totalItems: 8 });

    const searchedDocuments = await request(application.getHttpServer())
      .get(`/api/v1/finance/financial-documents?search=${encodeURIComponent(proformaNumbers[0]!)}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(searchedDocuments.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ number: proformaNumbers[0] })]),
    );

    const evidence = await database.query<{ audit_count: string; outbox_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM audit.events
          WHERE action LIKE 'finance.financial-document.%') AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events
          WHERE event_type LIKE 'finance.financial-document.%') AS outbox_count`,
    );
    expect(evidence.rows[0]).toEqual({ audit_count: '9', outbox_count: '9' });

    const concurrentCredits = await Promise.all(
      ['A', 'B'].map((suffix) =>
        request(application.getHttpServer())
          .post('/api/v1/finance/financial-documents')
          .set('authorization', `Bearer ${token}`)
          .set('idempotency-key', `qa-concurrent-credit-${suffix}-${runId}`)
          .send({ ...creditInput, lines: [{ ...manualInput.lines[0], quantity: '0.6' }] }),
      ),
    );
    expect(concurrentCredits.map((result) => result.status).sort()).toEqual([201, 400]);
    const successfulCredit = concurrentCredits.find((result) => result.status === 201)
      ?.body as FinancialDocument;
    const replayCredit = await request(application.getHttpServer())
      .post('/api/v1/finance/financial-documents')
      .set('authorization', `Bearer ${token}`)
      .set(
        'idempotency-key',
        `qa-concurrent-credit-${concurrentCredits[0]?.status === 201 ? 'A' : 'B'}-${runId}`,
      )
      .send({ ...creditInput, lines: [{ ...manualInput.lines[0], quantity: '0.6' }] })
      .expect(201);
    expect(replayCredit.body.id).toBe(successfulCredit.id);
    await request(application.getHttpServer())
      .post(`/api/v1/finance/financial-documents/${successfulCredit.id}/cancel`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `qa-credit-cleanup-${runId}`)
      .send({ cancellationReason: 'QA concurrency verification completed.', expectedVersion: 1 })
      .expect(200);

    await request(application.getHttpServer())
      .post(`/api/v1/finance/financial-documents/${invoice.id}/issue`)
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `financial-document-issue-denied-${runId}`)
      .send({ expectedVersion: 1 })
      .expect(403);
    const issueKey = `financial-document-issue-${runId}`;
    const issuedResponse = await request(application.getHttpServer())
      .post(`/api/v1/finance/financial-documents/${invoice.id}/issue`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', issueKey)
      .send({ expectedVersion: 1 })
      .expect(200);
    const issuedInvoice = issuedResponse.body as FinancialDocument;
    expect(issuedInvoice).toMatchObject({
      officialNumber: '0000000001',
      status: 'issued',
      version: 2,
    });
    expect(issuedInvoice.issuedAt).toBeTruthy();

    const officialPdf = await request(application.getHttpServer())
      .get(`/api/v1/finance/financial-documents/${invoice.id}/pdf`)
      .set('authorization', `Bearer ${token}`)
      .expect('Content-Type', /application\/pdf/u)
      .expect(200);
    expect(Number(officialPdf.headers['content-length'])).toBeGreaterThan(500);
    const officialPdfContent = Buffer.from(officialPdf.body as Buffer);
    expect(officialPdfContent.subarray(0, 4).toString()).toBe('%PDF');

    const documentRecipient = `document-${runId}@example.invalid`;
    const documentEmailKey = `financial-document-email-${runId}`;
    const queuedDocumentEmail = await request(application.getHttpServer())
      .post(`/api/v1/finance/financial-documents/${invoice.id}/email`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', documentEmailKey)
      .send({ expectedVersion: issuedInvoice.version, recipientEmail: documentRecipient })
      .expect(202);
    expect(queuedDocumentEmail.body).toMatchObject({
      recipientEmail: documentRecipient,
      status: 'queued',
    });
    await request(application.getHttpServer())
      .post(`/api/v1/finance/financial-documents/${invoice.id}/email`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', documentEmailKey)
      .send({ expectedVersion: issuedInvoice.version, recipientEmail: documentRecipient })
      .expect(202);
    const queuedDocumentMessages = await database.query<{
      attempt_count: number;
      id: string;
      payload: { attachment?: { contentBase64: string; fileName: string }; text: string };
      status: string;
    }>(
      `SELECT id, status, attempt_count, payload FROM notifications.messages
       WHERE channel = 'email' AND payload->>'to' = $1`,
      [documentRecipient],
    );
    expect(queuedDocumentMessages.rows).toHaveLength(1);
    const queuedDocumentMessage = queuedDocumentMessages.rows[0];
    if (!queuedDocumentMessage) throw new Error('Financial document email was not queued');
    expect(queuedDocumentMessage).toMatchObject({ status: 'pending', attempt_count: 0 });
    expect(queuedDocumentMessage.payload).toMatchObject({
      attachment: { fileName: `${issuedInvoice.officialNumber}.pdf` },
    });
    expect(queuedDocumentMessage.payload.text).toContain('Прикачен е Вашият документ');

    failNextEmailDelivery = true;
    const notificationDispatcher = application.get(NotificationDispatcherService);
    await expect(notificationDispatcher.dispatch(queuedDocumentMessage.id, true)).rejects.toThrow(
      'Temporary SMTP outage',
    );
    const retryableEmail = await database.query<{ attempt_count: number; status: string }>(
      'SELECT status, attempt_count FROM notifications.messages WHERE id = $1',
      [queuedDocumentMessage.id],
    );
    expect(retryableEmail.rows[0]).toEqual({ status: 'pending', attempt_count: 1 });
    const emailCountBeforeDocumentDelivery = deliveredEmails.length;
    await notificationDispatcher.dispatch(queuedDocumentMessage.id, true);
    expect(deliveredEmails).toHaveLength(emailCountBeforeDocumentDelivery + 1);
    expect(deliveredEmails.at(-1)).toMatchObject({
      attachment: { fileName: `${issuedInvoice.officialNumber}.pdf`, mediaType: 'application/pdf' },
      to: documentRecipient,
    });
    expect(deliveredEmails.at(-1)?.attachment?.content.subarray(0, 4).toString()).toBe('%PDF');
    const deliveredDocumentEmail = await database.query<{ attempt_count: number; status: string }>(
      'SELECT status, attempt_count FROM notifications.messages WHERE id = $1',
      [queuedDocumentMessage.id],
    );
    expect(deliveredDocumentEmail.rows[0]).toEqual({ status: 'delivered', attempt_count: 2 });

    const issueReplay = await request(application.getHttpServer())
      .post(`/api/v1/finance/financial-documents/${invoice.id}/issue`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', issueKey)
      .send({ expectedVersion: 1 })
      .expect(200);
    expect((issueReplay.body as FinancialDocument).officialNumber).toBe('0000000001');
    await request(application.getHttpServer())
      .post(`/api/v1/finance/financial-documents/${invoice.id}/cancel`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `financial-document-issued-cancel-${runId}`)
      .send({ cancellationReason: 'This must not cancel a legal document.', expectedVersion: 2 })
      .expect(409);

    const issuedCorrectionResponse = await request(application.getHttpServer())
      .post('/api/v1/finance/financial-documents')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `financial-document-issued-credit-${runId}`)
      .send({
        ...creditInput,
        correctionOfDocumentId: invoice.id,
        correctionReason: 'Correction against the issued invoice.',
      });
    expect(issuedCorrectionResponse.status, JSON.stringify(issuedCorrectionResponse.body)).toBe(
      201,
    );
    const issuedCorrectionDraft = issuedCorrectionResponse.body as FinancialDocument;
    const issuedCorrection = (
      await request(application.getHttpServer())
        .post(`/api/v1/finance/financial-documents/${issuedCorrectionDraft.id}/issue`)
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `financial-document-issued-credit-issue-${runId}`)
        .send({ expectedVersion: 1 })
        .expect(200)
    ).body as FinancialDocument;
    expect(issuedCorrection).toMatchObject({
      correctionOf: { id: invoice.id },
      officialNumber: '0000000002',
      status: 'issued',
    });

    const concurrentIssueDrafts = await Promise.all(
      ['A', 'B'].map(async (suffix) => {
        const response = await request(application.getHttpServer())
          .post('/api/v1/finance/financial-documents')
          .set('authorization', `Bearer ${token}`)
          .set('idempotency-key', `concurrent-issued-invoice-${suffix}-${runId}`)
          .send(manualInput)
          .expect(201);
        return response.body as FinancialDocument;
      }),
    );
    const concurrentlyIssued = await Promise.all(
      concurrentIssueDrafts.map((draft, index) =>
        request(application.getHttpServer())
          .post(`/api/v1/finance/financial-documents/${draft.id}/issue`)
          .set('authorization', `Bearer ${token}`)
          .set('idempotency-key', `concurrent-issued-number-${index}-${runId}`)
          .send({ expectedVersion: 1 })
          .expect(200),
      ),
    );
    const concurrentOfficialNumbers = concurrentlyIssued.map(
      ({ body }) => (body as FinancialDocument).officialNumber,
    );
    expect(new Set(concurrentOfficialNumbers).size).toBe(2);
    expect(concurrentOfficialNumbers.sort()).toEqual(['0000000003', '0000000004']);

    const issuedIncomeExport = (
      await request(application.getHttpServer())
        .post('/api/v1/finance/report-exports')
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `issued-income-export-${runId}`)
        .send({
          dateFrom: issueDate,
          dateTo: issueDate,
          definitionKey: 'finance.income',
          format: 'csv',
        })
        .expect(202)
    ).body as FinanceReportExport;
    const reportHandlers = application.get(JobHandlerRegistry);
    await reportHandlers.execute({
      attemptNumber: 1,
      correlationId: `issued-income-export-job-${runId}`,
      enqueuedAt: new Date().toISOString(),
      idempotencyKey: `finance-report-export:${issuedIncomeExport.id}`,
      jobId: `issued-income-export-job-${runId}`,
      maxAttempts: 5,
      name: 'report.generate',
      payload: { exportId: issuedIncomeExport.id },
      retryAllowed: true,
    });
    const issuedIncomeCsv = await request(application.getHttpServer())
      .get(`/api/v1/finance/report-exports/${issuedIncomeExport.id}/content`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(issuedIncomeCsv.text).toContain('0000000001,0000000001,');
    const invoiceExportRow = issuedIncomeCsv.text
      .split(/\r?\n/u)
      .find((line: string) => line.startsWith('0000000001,0000000001,'));
    expect(invoiceExportRow?.split(',')[4]).toBe('');
    expect(issuedIncomeCsv.text).not.toContain(registerScopedInvoice.number);
  });

  it('collects a standalone proforma and converts it once after partial bank settlements', async () => {
    const date = (
      await database.query<{ date: string }>(
        "SELECT (now() AT TIME ZONE 'Europe/Sofia')::date::text AS date",
      )
    ).rows[0]!.date;
    const refs = (
      await request(application.getHttpServer())
        .get('/api/v1/finance/financial-documents/reference-data')
        .set('authorization', `Bearer ${token}`)
        .expect(200)
    ).body as FinancialDocumentReferenceData;
    const scope = refs.scopes[0]!;
    const draft = (
      await request(application.getHttpServer())
        .post('/api/v1/finance/financial-documents')
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `standalone-proforma-${runId}`)
        .send({
          businessLocationId: scope.locationId,
          legalEntityId: scope.legalEntityId,
          customerPartnerId: customerId,
          documentType: 'proforma',
          currencyCode: 'EUR',
          issueDate: date,
          taxEventDate: date,
          dueDate: date,
          rateDate: date,
          exchangeRate: '1',
          rateSource: 'internal_eur',
          lines: [
            {
              description: 'Standalone service fee',
              unitCode: 'SERVICE',
              quantity: '1',
              unitPrice: '20',
              discountPercent: '0',
              vatTreatment: 'standard_20',
            },
          ],
        })
        .expect(201)
    ).body as FinancialDocument;
    const issued = (
      await request(application.getHttpServer())
        .post(`/api/v1/finance/financial-documents/${draft.id}/issue`)
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `standalone-issue-${runId}`)
        .send({ expectedVersion: 1 })
        .expect(200)
    ).body as FinancialDocument;
    expect(issued.collection?.id).toBeTruthy();
    const collectionId = issued.collection!.id;
    const readCollection = async () =>
      (
        await request(application.getHttpServer())
          .get(`/api/v1/finance/documents/${collectionId}`)
          .set('authorization', `Bearer ${token}`)
          .expect(200)
      ).body as FinanceCustomerDocument;
    expect(await readCollection()).toMatchObject({
      total: '24.0000',
      paymentStatus: 'unpaid',
      sourceInvoiceNumber: issued.number,
      financialDocument: { id: issued.id },
    });
    expect(await readCollection()).not.toHaveProperty('sourceSalesInvoiceId');
    const unpaidStatus = await request(application.getHttpServer())
      .get(
        `/api/v1/finance/customer-accounts/payment-status?search=${encodeURIComponent(issued.number)}&status=unpaid`,
      )
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(unpaidStatus.body as CustomerPaymentStatusPage).toMatchObject({
      totalItems: 1,
      items: [
        expect.objectContaining({
          id: collectionId,
          number: issued.number,
          sourceType: 'issued_document',
          paymentStatus: 'unpaid',
          paidTotal: '0.0000',
          outstandingTotal: '24.0000',
        }),
      ],
    });
    const staleLink = await request(application.getHttpServer())
      .post(`/api/v1/finance/financial-documents/${draft.id}/collection`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `standalone-stale-${runId}`)
      .send({ expectedVersion: issued.version + 1 })
      .expect(409);
    expect(staleLink.body.error.code).toBe('FINANCE_DOCUMENT_VERSION_CONFLICT');
    await assertGuardedDowngrade(
      database,
      '0079_finance_collection_sources',
      'Cannot downgrade Finance while non-Sales collection records exist',
    );
    await request(application.getHttpServer())
      .post(`/api/v1/finance/financial-documents/${draft.id}/collection`)
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `standalone-denied-${runId}`)
      .send({ expectedVersion: issued.version })
      .expect(403);
    for (const [index, amount] of ['10', '14'].entries()) {
      const key = `standalone-bank-${index}-${runId}`;
      const input = {
        accountIban: 'BG76DEMO00000000000000',
        bankName: 'Finance test bank',
        openingBalance: '0',
        closingBalance: amount,
        currencyCode: 'EUR',
        statementDate: date,
        statementReference: key,
        lines: [
          {
            amount,
            counterpartyName: 'Finance test customer',
            direction: 'incoming',
            paymentReference: issued.number,
            transactionDate: date,
            valueDate: date,
          },
        ],
      };
      const statement = (
        await request(application.getHttpServer())
          .post('/api/v1/finance/bank-statements')
          .set('authorization', `Bearer ${token}`)
          .set('idempotency-key', key)
          .send(input)
          .expect(201)
      ).body as FinanceBankStatement;
      expect(statement.transactions[0]?.matchStatus).toBe('matched');
      await request(application.getHttpServer())
        .post('/api/v1/finance/bank-statements')
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', key)
        .send(input)
        .expect(201);
      const collection = await readCollection();
      expect(collection.paymentStatus).toBe(index === 0 ? 'partially_paid' : 'paid');
      const status = index === 0 ? 'partially_paid' : 'paid';
      const paymentStatus = await request(application.getHttpServer())
        .get(
          `/api/v1/finance/customer-accounts/payment-status?search=${encodeURIComponent(issued.number)}&status=${status}`,
        )
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect((paymentStatus.body as CustomerPaymentStatusPage).items[0]).toMatchObject({
        id: collectionId,
        paymentStatus: status,
        outstandingTotal: collection.outstandingTotal,
        paidTotal: collection.allocatedTotal,
      });
    }
    const paid = await readCollection();
    expect(paid).toMatchObject({
      outstandingTotal: '0.0000',
      payments: [expect.anything(), expect.anything()],
      financialDocument: { type: 'invoice', status: 'issued' },
    });
    const converted = (
      await database.query<{ count: number }>(
        'SELECT count(*)::integer AS count FROM finance.financial_documents WHERE converted_from_document_id = $1',
        [issued.id],
      )
    ).rows[0];
    expect(converted?.count).toBe(1);
    const opened = (
      await request(application.getHttpServer())
        .get(`/api/v1/finance/financial-documents/${paid.financialDocument!.id}`)
        .set('authorization', `Bearer ${token}`)
        .expect(200)
    ).body as FinancialDocument;
    expect(opened.collection?.id).toBe(collectionId);
    const reopened = (
      await request(application.getHttpServer())
        .post(`/api/v1/finance/financial-documents/${issued.id}/collection`)
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `paid-proforma-reopen-${runId}`)
        .send({ expectedVersion: issued.version })
        .expect(200)
    ).body as FinancialDocument;
    expect(reopened.collection?.id).toBe(collectionId);
    const accounts = await request(application.getHttpServer())
      .get(`/api/v1/finance/customer-accounts/${customerId}`)
      .set('authorization', `Bearer ${token}`);
    expect(accounts.status).toBe(200);
  });

  it('allocates separate official number ranges per register/operator scope without duplicates', async () => {
    const date = (
      await database.query<{ date: string }>(
        "SELECT (now() AT TIME ZONE 'Europe/Sofia')::date::text AS date",
      )
    ).rows[0]!.date;
    const refs = (
      await request(application.getHttpServer())
        .get('/api/v1/finance/financial-documents/reference-data')
        .set('authorization', `Bearer ${token}`)
        .expect(200)
    ).body as FinancialDocumentReferenceData;
    const scope = refs.scopes[0]!;
    const drafts = await Promise.all(
      [false, false, true, true].map(
        async (register, index) =>
          (
            await request(application.getHttpServer())
              .post('/api/v1/finance/financial-documents')
              .set('authorization', `Bearer ${token}`)
              .set('idempotency-key', `range-draft-${index}-${runId}`)
              .send({
                businessLocationId: scope.locationId,
                legalEntityId: scope.legalEntityId,
                ...(register ? { cashRegisterId, operatorId: cashOperatorId } : {}),
                customerPartnerId: customerId,
                documentType: 'invoice',
                currencyCode: 'EUR',
                issueDate: date,
                taxEventDate: date,
                dueDate: date,
                rateDate: date,
                exchangeRate: '1',
                rateSource: 'internal_eur',
                lines: [
                  {
                    description: 'Range test',
                    unitCode: 'SERVICE',
                    quantity: '1',
                    unitPrice: '10',
                    discountPercent: '0',
                    vatTreatment: 'standard_20',
                  },
                ],
              })
              .expect(201)
          ).body as FinancialDocument,
      ),
    );
    const issued = await Promise.all(
      drafts.map(
        async (draft, index) =>
          (
            await request(application.getHttpServer())
              .post(`/api/v1/finance/financial-documents/${draft.id}/issue`)
              .set('authorization', `Bearer ${token}`)
              .set('idempotency-key', `range-issue-${index}-${runId}`)
              .send({ expectedVersion: 1 })
              .expect(200)
          ).body as FinancialDocument,
      ),
    );
    expect(new Set(issued.map((doc) => doc.officialNumber)).size).toBe(4);
    for (const pair of [issued.slice(0, 2), issued.slice(2)]) {
      const values = pair.map((doc) => Number(doc.officialNumber)).sort((a, b) => a - b);
      expect(values[1]! - values[0]!).toBe(1);
    }
    expect(
      Math.abs(Number(issued[0]!.officialNumber) - Number(issued[2]!.officialNumber)),
    ).toBeGreaterThan(1);
    expect(issued.every((doc) => Boolean(doc.collection))).toBe(true);
    const series = (
      await database.query<{ count: number }>(
        `SELECT count(DISTINCT official_number_series_id)::integer AS count
       FROM finance.financial_documents WHERE id = ANY($1::uuid[])`,
        [issued.map((doc) => doc.id)],
      )
    ).rows[0];
    expect(series?.count).toBe(2);
  });

  it('renews exhausted number ranges above the legacy watermark and stops at ten digits', async () => {
    const scope = (
      await database.query<{ legal_entity_id: string; business_location_id: string }>(
        'SELECT legal_entity_id, business_location_id FROM finance.official_number_series LIMIT 1',
      )
    ).rows[0]!;
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const watermark = (
        await client.query<{ next_value: string }>(
          'SELECT next_value::text FROM finance.official_document_sequences WHERE legal_entity_id = $1',
          [scope.legal_entity_id],
        )
      ).rows[0]!;
      await client.query(
        `UPDATE finance.official_number_series SET next_value = range_end + 1
        WHERE legal_entity_id = $1`,
        [scope.legal_entity_id],
      );
      const input = {
        legalEntityId: scope.legal_entity_id,
        businessLocationId: scope.business_location_id,
      };
      const next = await allocateOfficialNumber(client, input, 2);
      expect(BigInt(next.number)).toBe(BigInt(watermark.next_value));
      const second = await allocateOfficialNumber(client, input, 2);
      expect(BigInt(second.number)).toBe(BigInt(next.number) + 1n);
      const renewed = await allocateOfficialNumber(client, input, 2);
      expect(BigInt(renewed.number)).toBe(BigInt(next.number) + 2n);
      await client.query(
        'UPDATE finance.official_number_series SET next_value = range_end + 1 WHERE id = $1',
        [next.seriesId],
      );
      await client.query(
        'UPDATE finance.official_document_sequences SET next_value = 9999999999 WHERE legal_entity_id = $1',
        [scope.legal_entity_id],
      );
      expect((await allocateOfficialNumber(client, input, 1000)).number).toBe('9999999999');
      await expect(allocateOfficialNumber(client, input, 1000)).rejects.toThrow(
        'The document number range is exhausted.',
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it.each(['cash', 'advance', 'offset'] as const)(
    'converts a fully settled manual proforma through %s exactly once',
    async (method) => {
      const date = (
        await database.query<{ date: string }>(
          "SELECT (now() AT TIME ZONE 'Europe/Sofia')::date::text AS date",
        )
      ).rows[0]!.date;
      const scope = (
        await request(application.getHttpServer())
          .get('/api/v1/finance/financial-documents/reference-data')
          .set('authorization', `Bearer ${token}`)
          .expect(200)
      ).body.scopes[0] as FinancialDocumentReferenceData['scopes'][number];
      const draft = (
        await request(application.getHttpServer())
          .post('/api/v1/finance/financial-documents')
          .set('authorization', `Bearer ${token}`)
          .set('idempotency-key', `settlement-draft-${method}-${runId}`)
          .send({
            businessLocationId: scope.locationId,
            legalEntityId: scope.legalEntityId,
            customerPartnerId: customerId,
            documentType: 'proforma',
            currencyCode: 'EUR',
            issueDate: date,
            taxEventDate: date,
            dueDate: date,
            rateDate: date,
            exchangeRate: '1',
            rateSource: 'internal_eur',
            lines: [
              {
                description: 'Service charge',
                unitCode: 'SERVICE',
                quantity: '1',
                unitPrice: '20',
                discountPercent: '0',
                vatTreatment: 'standard_20',
              },
            ],
          })
          .expect(201)
      ).body as FinancialDocument;
      // Emulate an older issued proforma without a collection, then repair it
      // using the same guarded endpoint available from its preview.
      const issuePath = method === 'advance' ? 'collection' : 'issue';
      if (method === 'advance')
        await database.query(
          `UPDATE finance.financial_documents SET status = 'issued', issued_at = now(),
        issued_by = $2, version = 2 WHERE id = $1`,
          [draft.id, creatorAccountId],
        );
      const issueInput = { expectedVersion: method === 'advance' ? 2 : 1 };
      const issue = () =>
        request(application.getHttpServer())
          .post(`/api/v1/finance/financial-documents/${draft.id}/${issuePath}`)
          .set('authorization', `Bearer ${token}`)
          .set('idempotency-key', `settlement-issue-${method}-${runId}`)
          .send(issueInput)
          .expect(200);
      const issued = (await issue()).body as FinancialDocument;
      expect(((await issue()).body as FinancialDocument).collection?.id).toBe(
        issued.collection?.id,
      );
      const id = issued.collection!.id;
      const before = (
        await request(application.getHttpServer())
          .get(`/api/v1/finance/documents/${id}`)
          .set('authorization', `Bearer ${token}`)
          .expect(200)
      ).body as FinanceCustomerDocument;
      const cancelled = await request(application.getHttpServer())
        .post(`/api/v1/finance/documents/${id}/cancel`)
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `settlement-cancel-${method}-${runId}`)
        .send({
          expectedVersion: before.version,
          cancellationReason: 'Must not detach an issued document',
        })
        .expect(409);
      expect(cancelled.body.error.code).toBe('FINANCE_ISSUED_COLLECTION_CANNOT_CANCEL');
      let path: string;
      let input: object;
      if (method === 'cash') {
        path = '/api/v1/finance/cash/vouchers';
        input = {
          amount: '24',
          cashRegisterId,
          customerDocumentId: id,
          direction: 'receipt',
          operatorId: cashOperatorId,
          purpose: 'Proforma settlement',
          voucherDate: date,
        };
      } else if (method === 'advance') {
        const advance = (
          await request(application.getHttpServer())
            .post('/api/v1/finance/customer-accounts/advances')
            .set('authorization', `Bearer ${token}`)
            .set('idempotency-key', `settlement-advance-${runId}`)
            .send({
              amount: '24',
              customerPartnerId: customerId,
              paymentMethod: 'bank_transfer',
              receivedOn: date,
            })
            .expect(201)
        ).body as CustomerAdvance;
        path = `/api/v1/finance/documents/${id}/advance-allocations`;
        input = { amount: '24', customerAdvanceId: advance.id };
      } else {
        const supplierInvoiceId = await seedSupplierInvoiceEvidence(
          database,
          creatorAccountId,
          customerId,
          warehouseId,
          productId,
          date,
          `${runId}-offset-proforma`,
        );
        const payable = (
          await request(application.getHttpServer())
            .post('/api/v1/finance/supplier-payables')
            .set('authorization', `Bearer ${token}`)
            .set('idempotency-key', `settlement-payable-${runId}`)
            .send({ dueDate: date, supplierInvoiceId })
            .expect(201)
        ).body as FinanceSupplierPayable;
        path = '/api/v1/finance/supplier-offsets';
        input = {
          amount: '24',
          customerDocumentId: id,
          expectedCustomerDocumentVersion: before.version,
          expectedSupplierPayableVersion: payable.version,
          offsetDate: date,
          reason: 'Bilateral proforma settlement',
          supplierPayableId: payable.id,
        };
      }
      const send = () =>
        request(application.getHttpServer())
          .post(path)
          .set('authorization', `Bearer ${token}`)
          .set('idempotency-key', `settlement-pay-${method}-${runId}`)
          .send(input)
          .expect(201);
      await send();
      await send();
      const paid = (
        await request(application.getHttpServer())
          .get(`/api/v1/finance/documents/${id}`)
          .set('authorization', `Bearer ${token}`)
          .expect(200)
      ).body as FinanceCustomerDocument;
      expect(paid).toMatchObject({
        paymentStatus: 'paid',
        outstandingTotal: '0.0000',
        financialDocument: { status: 'issued', type: 'invoice' },
      });
      expect(paid.payments).toHaveLength(1);
      const invoices = await database.query(
        'SELECT id FROM finance.financial_documents WHERE converted_from_document_id = $1',
        [draft.id],
      );
      expect(invoices.rowCount).toBe(1);
    },
  );

  it('applies dated BNB rates to foreign-currency Finance drafts and payables', async () => {
    const rateDate = (
      await database.query<{ date: string }>(
        "SELECT (now() AT TIME ZONE 'Europe/Sofia')::date::text AS date",
      )
    ).rows[0]?.date;
    if (!rateDate) throw new Error('Finance test date is unavailable');
    await database.query(
      `INSERT INTO finance.currency_rates (currency_code, rate_date, eur_per_unit)
       VALUES ('GBP', $1, 1.10000000)`,
      [rateDate],
    );

    const rateResponse = await request(application.getHttpServer())
      .get(
        `/api/v1/finance/financial-documents/exchange-rate?currencyCode=GBP&rateDate=${rateDate}`,
      )
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(rateResponse.body).toEqual({
      currencyCode: 'GBP',
      exchangeRate: '1.10000000',
      rateDate,
      rateSource: 'BNB',
    });

    const referenceData = (
      await request(application.getHttpServer())
        .get('/api/v1/finance/financial-documents/reference-data')
        .set('authorization', `Bearer ${token}`)
        .expect(200)
    ).body as FinancialDocumentReferenceData;
    const scope = referenceData.scopes[0];
    const unitCode = referenceData.products.find((product) => product.id === productId)?.unitCode;
    if (!scope || !unitCode)
      throw new Error('Finance references are unavailable for the rate test');

    const financialDraft = await request(application.getHttpServer())
      .post('/api/v1/finance/financial-documents')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `financial-document-usd-snapshot-${runId}`)
      .send({
        businessLocationId: scope.locationId,
        currencyCode: 'GBP',
        customerPartnerId: customerId,
        documentType: 'invoice',
        dueDate: rateDate,
        exchangeRate: '1',
        issueDate: rateDate,
        legalEntityId: scope.legalEntityId,
        lines: [
          {
            description: 'Foreign-currency rate check',
            discountPercent: '0',
            productId,
            quantity: '1',
            unitCode,
            unitPrice: '10',
            vatTreatment: 'standard_20',
          },
        ],
        rateDate,
        rateSource: 'BNB',
        taxEventDate: rateDate,
      })
      .expect(201);
    expect(financialDraft.body as FinancialDocument).toMatchObject({
      currencyCode: 'GBP',
      eurGrossTotal: '13.2000',
      exchangeRate: '1.10000000',
      grossTotal: '12.0000',
      rateDate,
      rateSource: 'BNB',
    });

    const customerOverview = async () =>
      (
        await request(application.getHttpServer())
          .get(`/api/v1/master-data/partners/${customerId}/customer-overview`)
          .set('authorization', `Bearer ${token}`)
          .expect(200)
      ).body as CustomerOperationalOverview;
    const beforeForeignIssue = await customerOverview();
    await request(application.getHttpServer())
      .post(
        `/api/v1/finance/financial-documents/${(financialDraft.body as FinancialDocument).id}/issue`,
      )
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `foreign-overview-issue-${runId}`)
      .send({ expectedVersion: (financialDraft.body as FinancialDocument).version })
      .expect(200);
    const afterForeignIssue = await customerOverview();
    expect(
      Number(afterForeignIssue.summary.outstandingEur) -
        Number(beforeForeignIssue.summary.outstandingEur),
    ).toBeCloseTo(13.2, 4);
    expect(afterForeignIssue.summary.openReceivables).toBe(
      beforeForeignIssue.summary.openReceivables + 1,
    );

    const supplierInvoiceId = await seedSupplierInvoiceEvidence(
      database,
      creatorAccountId,
      customerId,
      warehouseId,
      productId,
      rateDate,
      `usd-${runId}`,
      'GBP',
    );
    const payableResponse = await request(application.getHttpServer())
      .post('/api/v1/finance/supplier-payables')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-supplier-payable-usd-${runId}`)
      .send({ dueDate: rateDate, supplierInvoiceId })
      .expect(201);
    const payable = payableResponse.body as FinanceSupplierPayable;
    expect(payable).toMatchObject({
      currencyCode: 'GBP',
      eurTotal: '105.6000',
      exchangeRate: '1.10000000',
      rateDate,
      rateSource: 'BNB',
      total: '96.0000',
    });

    const paymentResponse = await request(application.getHttpServer())
      .post(`/api/v1/finance/supplier-payables/${payable.id}/payments`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `finance-supplier-payment-usd-${runId}`)
      .send({ amount: '10', paymentDate: rateDate, paymentMethod: 'bank_transfer' })
      .expect(201);
    expect(paymentResponse.body).toMatchObject({
      allocatedTotal: '10.0000',
      currencyCode: 'GBP',
      outstandingTotal: '86.0000',
      payments: [expect.objectContaining({ amount: '10.0000', currencyCode: 'GBP' })],
    });
  });

  it('protects historical cash balances and rejects future advances', async () => {
    const businessDate = (
      await database.query<{ date: string }>(
        "SELECT (now() AT TIME ZONE 'Europe/Sofia')::date::text AS date",
      )
    ).rows[0]?.date;
    if (!businessDate) throw new Error('Finance test date is unavailable');
    const base = {
      cashRegisterId,
      operatorId: cashOperatorId,
      counterpartyName: 'QA cash control',
      purpose: 'Historical balance verification',
      voucherDate: businessDate,
    };
    const create = (suffix: string, input: object) =>
      request(application.getHttpServer())
        .post('/api/v1/finance/cash/vouchers')
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `qa-cash-history-${suffix}-${runId}`)
        .send({ ...base, ...input });
    const receipt = (await create('receipt', { amount: '1000', direction: 'receipt' }).expect(201))
      .body as FinanceCashVoucher;
    const available = (
      await database.query<{ amount: string }>(
        `SELECT sum(CASE WHEN direction = 'receipt' THEN amount ELSE -amount END)::text AS amount
         FROM finance.cash_vouchers WHERE cash_register_id = $1 AND status = 'issued'`,
        [cashRegisterId],
      )
    ).rows[0]?.amount;
    if (!available) throw new Error('Cash balance is unavailable');
    const payment = (
      await create('payment', { amount: available, direction: 'payment' }).expect(201)
    ).body as FinanceCashVoucher;
    const cancel = (voucher: FinanceCashVoucher, suffix: string) =>
      request(application.getHttpServer())
        .post(`/api/v1/finance/cash/vouchers/${voucher.id}/cancel`)
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `qa-cash-history-cancel-${suffix}-${runId}`)
        .send({ cancellationReason: 'QA cash control verification.', expectedVersion: 1 });
    const rejectedCancellation = await cancel(receipt, 'blocked').expect(409);
    expect(rejectedCancellation.body.error.code).toBe('FINANCE_CASH_INSUFFICIENT_BALANCE');
    const backdated = await create('backdated', {
      amount: '1',
      direction: 'payment',
      voucherDate: '2000-01-01',
    }).expect(409);
    expect(backdated.body.error.code).toBe('FINANCE_CASH_INSUFFICIENT_BALANCE');
    await cancel(payment, 'payment').expect(200);
    await cancel(receipt, 'receipt').expect(200);

    for (const [endpoint, input] of [
      ['customer-accounts/advances', { customerPartnerId: customerId, receivedOn: '2099-12-31' }],
      ['supplier-advances', { supplierPartnerId: customerId, paymentDate: '2099-12-31' }],
    ] as const) {
      const rejected = await request(application.getHttpServer())
        .post(`/api/v1/finance/${endpoint}`)
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `qa-future-${endpoint}-${runId}`)
        .send({ ...input, amount: '1', paymentMethod: 'bank_transfer' })
        .expect(400);
      expect(rejected.body.error.code).toBe('FINANCE_PAYMENT_FUTURE_DATE_INVALID');
    }
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
        currencyCode: 'eur',
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
      currencyCode: 'EUR',
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
        `/api/v1/sales/prices/resolve?asOf=2099-06-01&currencyCode=EUR&customerPartnerId=${customerId}&productId=${productId}`,
      )
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(resolvedResponse.body as SalesResolvedPrice).toMatchObject({
      matched: true,
      priceListId: groupPrice.id,
      priority: 20,
      unitPrice: '25.0000',
    });
    const financePricePath = `/api/v1/finance/financial-documents/prices/resolve?asOf=2099-06-01&currencyCode=EUR&customerPartnerId=${customerId}&productId=${productId}`;
    await request(application.getHttpServer()).get(financePricePath).expect(401);
    const financePrice = await request(application.getHttpServer())
      .get(financePricePath)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(financePrice.body).toEqual(resolvedResponse.body);
    const financeForeignPrice = await request(application.getHttpServer())
      .get(financePricePath.replace('currencyCode=EUR', 'currencyCode=USD'))
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(financeForeignPrice.body).toMatchObject({ currencyCode: 'USD', matched: false });

    const differentCurrencyResponse = await request(application.getHttpServer())
      .get(
        `/api/v1/sales/prices/resolve?asOf=2099-06-01&currencyCode=USD&customerPartnerId=${customerId}&productId=${productId}`,
      )
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(differentCurrencyResponse.body as SalesResolvedPrice).toMatchObject({
      currencyCode: 'USD',
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
        `/api/v1/sales/prices/resolve?asOf=2099-06-01&currencyCode=EUR&customerPartnerId=${customerId}&productId=${productId}`,
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

    const billingDraft = contract.invoiceDrafts[0];
    if (!billingDraft) throw new Error('Subscription billing draft missing');
    const financeReferences = await request(application.getHttpServer())
      .get('/api/v1/finance/financial-documents/reference-data')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(financeReferences.body.subscriptionDrafts).toContainEqual(
      expect.objectContaining({
        id: billingDraft.id,
        number: billingDraft.number,
        amount: '135.0000',
      }),
    );
    const subscriptionScope = (financeReferences.body as FinancialDocumentReferenceData).scopes[0];
    if (!subscriptionScope) throw new Error('Subscription Finance scope missing');
    const subscriptionInvoiceInput = {
      businessLocationId: subscriptionScope.locationId,
      legalEntityId: subscriptionScope.legalEntityId,
      customerPartnerId: customerId,
      documentType: 'invoice',
      currencyCode: 'EUR',
      exchangeRate: '1',
      rateSource: 'internal_eur',
      issueDate: '2026-08-12',
      dueDate: '2026-08-26',
      rateDate: '2026-08-12',
      taxEventDate: '2026-08-01',
      sourceSubscriptionDraftId: billingDraft.id,
      lines: [
        {
          description: 'Subscription review',
          unitCode: 'SERVICE',
          quantity: '1',
          unitPrice: '135',
          discountPercent: '0',
          vatTreatment: 'standard_20',
        },
      ],
    };
    await request(application.getHttpServer())
      .post('/api/v1/finance/financial-documents')
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `sub-finance-denied-${runId}`)
      .send(subscriptionInvoiceInput)
      .expect(403);
    await request(application.getHttpServer())
      .post('/api/v1/finance/financial-documents')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `sub-finance-charge-${runId}`)
      .send({
        ...subscriptionInvoiceInput,
        lines: [{ ...subscriptionInvoiceInput.lines[0], unitPrice: '1' }],
      })
      .expect(400);
    const prepared = await Promise.all(
      [1, 2].map((attempt) =>
        request(application.getHttpServer())
          .post('/api/v1/finance/financial-documents')
          .set('authorization', `Bearer ${token}`)
          .set('idempotency-key', `sub-finance-${attempt}-${runId}`)
          .send(subscriptionInvoiceInput)
          .expect(201),
      ),
    );
    const preparedDraft = prepared[0]?.body as FinancialDocument;
    expect(preparedDraft.id).toBe((prepared[1]?.body as FinancialDocument).id);
    expect(prepared[0]?.body).toMatchObject({
      sourceSubscriptionDraftId: billingDraft.id,
      sourceSubscriptionDraftNumber: billingDraft.number,
      netTotal: '135.0000',
      grossTotal: '162.0000',
    });
    const register = await request(application.getHttpServer())
      .get(`/api/v1/finance/financial-documents?search=${encodeURIComponent(preparedDraft.number)}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(register.body.items).toContainEqual(expect.objectContaining({ id: preparedDraft.id }));
    const linkedReferences = await request(application.getHttpServer())
      .get('/api/v1/finance/financial-documents/reference-data')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(linkedReferences.body.subscriptionDrafts).toContainEqual(
      expect.objectContaining({
        id: billingDraft.id,
        linkedDocumentId: preparedDraft.id,
      }),
    );
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

    const visitContractResponse = await request(application.getHttpServer())
      .post('/api/v1/sales/subscriptions')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-visit-contract-${runId}`)
      .send({
        ...subscriptionInput(),
        nextInvoiceDate: '2026-10-02',
        validFrom: '2026-10-02',
        validTo: '2026-10-02',
      })
      .expect(201);
    const visitContract = visitContractResponse.body as ServiceSubscriptionContract;

    const planVisitJob = {
      attemptNumber: 1,
      correlationId: `plan-visit-${runId}`,
      enqueuedAt: '2026-10-02T01:45:00.000Z',
      idempotencyKey: `plan-visit-2026-10-02-${runId}`,
      jobId: `plan-visit-${runId}`,
      maxAttempts: 5,
      name: 'service.plan-visit.generate',
      payload: { asOf: '2026-10-02' },
      retryAllowed: true,
    } as const;
    const visitGeneration = await handlers.execute(planVisitJob);
    expect(visitGeneration).toMatchObject({ generatedCount: 1 });
    const generatedVisit = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM service.subscription_visit_generations
       WHERE subscription_contract_id = $1
         AND customer_equipment_id = $2
         AND planned_date = '2026-10-02'`,
      [visitContract.id, equipmentId],
    );
    expect(generatedVisit.rows[0]?.count).toBe('1');
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
      expect.arrayContaining([
        expect.objectContaining({
          id: plan.id,
          isOverdue: false,
          nextDueDate: '2027-09-02',
        }),
      ]),
    );

    const businessDates = await database.query<{ today: string; yesterday: string }>(
      `SELECT (now() AT TIME ZONE $1)::date::text AS today,
              ((now() AT TIME ZONE $1)::date - 1)::text AS yesterday`,
      ['Europe/Sofia'],
    );
    const { today: businessDate, yesterday } = businessDates.rows[0]!;
    await database.query(
      'UPDATE service.equipment_inspection_plans SET next_due_date = $2 WHERE id = $1',
      [plan.id, businessDate],
    );
    const dueTodayResponse = await request(application.getHttpServer())
      .get('/api/v1/service/care')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect((dueTodayResponse.body as ServiceCareOverview).inspections).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: plan.id, isOverdue: false })]),
    );
    await database.query(
      'UPDATE service.equipment_inspection_plans SET next_due_date = $2 WHERE id = $1',
      [plan.id, yesterday],
    );
    const overdueInspectionResponse = await request(application.getHttpServer())
      .get('/api/v1/service/care')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect((overdueInspectionResponse.body as ServiceCareOverview).inspections).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: plan.id, isOverdue: true })]),
    );

    const requestPageResponse = await request(application.getHttpServer())
      .get('/api/v1/service/requests?page=1&pageSize=100')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect((requestPageResponse.body as ServiceRequestPage).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          plannedVisitDate: '2026-10-02',
          sourceChannel: 'service_plan',
          subscriptionContractId: visitContract.id,
        }),
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
       ) VALUES ($1,'Integration test SLA','normal',240,960,75,$2)`,
      [policyId, viewerAccountId],
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
      `UPDATE crm.tickets SET created_at = '2026-08-26T08:00:00Z'::timestamptz,
         response_due_at = '2026-08-26T12:00:00Z'::timestamptz,
         resolution_due_at = '2026-08-28T08:00:00Z'::timestamptz
       WHERE id = $1`,
      [fromService.id],
    );
    const handlers = application.get(JobHandlerRegistry);
    const slaJob = {
      attemptNumber: 1,
      correlationId: `crm-sla-${runId}`,
      enqueuedAt: '2026-08-26T11:01:00.000Z',
      idempotencyKey: `crm-sla-risk-${runId}`,
      jobId: `crm-sla-risk-${runId}`,
      maxAttempts: 5,
      name: 'crm.sla.evaluate',
      payload: { asOf: '2026-08-26T11:01:00.000Z' },
      retryAllowed: true,
    } as const;
    const riskResult = await handlers.execute(slaJob);
    // Four business hours starts at 11:00 Sofia; 75% elapsed by 14:00.
    // Both the ticket owner and CRM escalation contact receive the at-risk alert.
    expect(riskResult).toMatchObject({ notificationCount: 2 });
    const riskRecipients = await database.query<{ recipient_account_id: string }>(
      `SELECT recipient_account_id
       FROM crm.sla_events
       WHERE ticket_id = $1 AND timer_type = 'response' AND event_type = 'at_risk'
       ORDER BY recipient_account_id`,
      [fromService.id],
    );
    expect(riskRecipients.rows.map((row) => row.recipient_account_id)).toEqual(
      [creatorAccountId, viewerAccountId].sort(),
    );
    await expect(handlers.execute({ ...slaJob, attemptNumber: 2 })).resolves.toMatchObject({
      deduplicated: true,
      notificationCount: 0,
    });

    const breachJob = {
      ...slaJob,
      idempotencyKey: `crm-sla-breached-${runId}`,
      jobId: `crm-sla-breached-${runId}`,
      payload: { asOf: '2026-08-26T12:01:00.000Z' },
    } as const;
    const breachResult = await handlers.execute(breachJob);
    expect(breachResult).toMatchObject({ notificationCount: 2 });
    await expect(handlers.execute({ ...breachJob, attemptNumber: 2 })).resolves.toMatchObject({
      deduplicated: true,
      notificationCount: 0,
    });

    const resolutionRiskJob = {
      ...slaJob,
      enqueuedAt: '2026-08-27T12:01:00.000Z',
      idempotencyKey: `crm-sla-resolution-risk-${runId}`,
      jobId: `crm-sla-resolution-risk-${runId}`,
      payload: { asOf: '2026-08-27T12:01:00.000Z' },
    } as const;
    const resolutionRiskResult = await handlers.execute(resolutionRiskJob);
    expect(resolutionRiskResult).toMatchObject({
      notificationCount: 2,
    });
    await expect(
      handlers.execute({ ...resolutionRiskJob, attemptNumber: 2 }),
    ).resolves.toMatchObject({
      deduplicated: true,
      notificationCount: 0,
    });

    const resolutionBreachJob = {
      ...slaJob,
      enqueuedAt: '2026-08-28T08:01:00.000Z',
      idempotencyKey: `crm-sla-resolution-breach-${runId}`,
      jobId: `crm-sla-resolution-breach-${runId}`,
      payload: { asOf: '2026-08-28T08:01:00.000Z' },
    } as const;
    const resolutionBreachResult = await handlers.execute(resolutionBreachJob);
    expect(resolutionBreachResult).toMatchObject({
      notificationCount: 2,
    });
    await expect(
      handlers.execute({ ...resolutionBreachJob, attemptNumber: 2 }),
    ).resolves.toMatchObject({
      deduplicated: true,
      notificationCount: 0,
    });

    const dispatcher = application.get(NotificationDispatcherService);
    for (const notificationId of [
      ...(riskResult as { notificationIds: string[] }).notificationIds,
      ...(breachResult as { notificationIds: string[] }).notificationIds,
      ...(resolutionRiskResult as { notificationIds: string[] }).notificationIds,
      ...(resolutionBreachResult as { notificationIds: string[] }).notificationIds,
    ]) {
      await dispatcher.dispatch(notificationId);
    }
    const notificationResponse = await request(application.getHttpServer())
      .get('/api/v1/notifications?page=1&pageSize=100')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect((notificationResponse.body as NotificationPage).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ templateKey: 'crm.ticket.sla.at_risk' }),
        expect.objectContaining({ templateKey: 'crm.ticket.sla.breached' }),
      ]),
    );
    const escalationNotificationsResponse = await request(application.getHttpServer())
      .get('/api/v1/notifications?page=1&pageSize=100')
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    const escalationNotifications = (escalationNotificationsResponse.body as NotificationPage)
      .items;
    expect(
      escalationNotifications.some(
        (notification) =>
          notification.templateKey === 'crm.ticket.sla.breached' &&
          notification.payload['ticketId'] === fromService.id,
      ),
    ).toBe(true);

    const ticketDetailResponse = await request(application.getHttpServer())
      .get(`/api/v1/crm/tickets/${fromService.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const ticketDetail = ticketDetailResponse.body as CrmTicket;
    expect(ticketDetail.slaEvents).toHaveLength(8);
    expect(ticketDetail.slaEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          deliveryStatus: 'delivered',
          eventType: 'at_risk',
          timerType: 'resolution',
        }),
        expect.objectContaining({
          deliveryStatus: 'delivered',
          eventType: 'breached',
          timerType: 'response',
        }),
        expect.objectContaining({
          deliveryStatus: 'delivered',
          eventType: 'breached',
          timerType: 'resolution',
        }),
      ]),
    );

    const evidence = await database.query<{
      audit_count: string;
      sla_event_count: string;
      link_count: string;
      notification_count: string;
      delivered_count: string;
      outbox_count: string;
      ticket_count: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM crm.tickets) AS ticket_count,
         (SELECT count(*)::text FROM crm.ticket_service_links) AS link_count,
         (SELECT count(*)::text FROM notifications.messages
           WHERE payload->>'ticketId' = $1) AS notification_count,
         (SELECT count(*)::text FROM notifications.messages
           WHERE payload->>'ticketId' = $1 AND status = 'delivered') AS delivered_count,
         (SELECT count(*)::text FROM crm.sla_events WHERE ticket_id = $1::uuid) AS sla_event_count,
         (SELECT count(*)::text FROM audit.events
          WHERE action LIKE 'crm.ticket.%') AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events
          WHERE event_type LIKE 'crm.ticket.%') AS outbox_count`,
      [fromService.id],
    );
    expect(evidence.rows[0]).toEqual({
      audit_count: '4',
      delivered_count: '8',
      link_count: '2',
      notification_count: '8',
      outbox_count: '4',
      sla_event_count: '8',
      ticket_count: '2',
    });
  });

  it('carries a service request through technician work, evidence, parts, signature, and serial history', async () => {
    await request(application.getHttpServer())
      .get('/api/v1/service/reference-data')
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(403);

    const batchPart = await seedServiceBatchPart(
      database,
      creatorAccountId,
      technicianWarehouseId,
      runId,
    );

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
        expect.objectContaining({
          availableBatches: [
            expect.objectContaining({
              availableQuantity: '5.0000',
              batchNumber: batchPart.batchNumber,
              expiresAt: '2099-01-31',
            }),
          ],
          productId: batchPart.productId,
          trackingMode: 'batch',
          warehouseId: technicianWarehouseId,
        }),
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

    const serviceTicketCategoryId = randomUUID();
    const serviceTicketPolicyId = randomUUID();
    await database.query(
      `INSERT INTO crm.ticket_categories (id, code, name)
       VALUES ($1,$2,'Service completion integration')`,
      [serviceTicketCategoryId, `svc_done_${runId.slice(0, 20)}`],
    );
    await database.query(
      `INSERT INTO crm.sla_policies (id, name, response_minutes, resolution_minutes)
       VALUES ($1,'Service completion integration SLA',60,240)`,
      [serviceTicketPolicyId],
    );
    const linkedCrmTicketResponse = await request(application.getHttpServer())
      .post(`/api/v1/crm/tickets/from-service-request/${created.id}`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `crm-ticket-for-service-${runId}`)
      .send({
        categoryId: serviceTicketCategoryId,
        priority: 'normal',
        slaPolicyId: serviceTicketPolicyId,
      })
      .expect(201);
    const linkedCrmTicket = linkedCrmTicketResponse.body as CrmTicket;
    const linkedCorrelationId = linkedCrmTicket.serviceLink?.correlationId;
    if (!linkedCorrelationId) throw new Error('CRM ticket is missing its Service correlation ID');
    expect(linkedCrmTicket).toMatchObject({
      serviceLink: { correlationId: linkedCorrelationId, serviceRequestId: created.id },
      status: 'new',
    });

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
    expect(requestPage.summary.new).toBeGreaterThanOrEqual(1);
    expect(requestPage.total).toBeGreaterThanOrEqual(1);
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

    const overdueAppointment = await database.query<{ date: string }>(
      `UPDATE service.work_orders
       SET scheduled_start = now() - interval '2 hours',
           scheduled_end = now() - interval '1 hour'
       WHERE id = $1
       RETURNING to_char(scheduled_start AT TIME ZONE 'Europe/Sofia', 'YYYY-MM-DD') AS date`,
      [assigned.workOrderId],
    );
    const overdueDate = overdueAppointment.rows[0]!.date;
    const overdueRequestPageResponse = await request(application.getHttpServer())
      .get('/api/v1/service/requests?page=1&pageSize=100')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect((overdueRequestPageResponse.body as ServiceRequestPage).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.id, isOverdue: true })]),
    );
    const overdueWorkOrderResponse = await request(application.getHttpServer())
      .get(`/api/v1/service/work-orders/${assigned.workOrderId}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(overdueWorkOrderResponse.body as ServiceWorkOrder).toMatchObject({ isOverdue: true });
    const overdueScheduleResponse = await request(application.getHttpServer())
      .get(`/api/v1/service/schedule?dateFrom=${overdueDate}&dateTo=${overdueDate}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const overdueSchedule = overdueScheduleResponse.body as ServiceSchedule;
    const overdueDay = overdueSchedule.technicians[0]?.days.find((day) => day.date === overdueDate);
    expect(overdueDay?.visits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ isOverdue: true, workOrderId: assigned.workOrderId }),
      ]),
    );

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
    expect(started).toMatchObject({ isOverdue: true, status: 'in_progress' });
    const equipmentDuringRepairResponse = await request(application.getHttpServer())
      .get(`/api/v1/master-data/partners/${customerId}/locations`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const equipmentDuringRepair = (equipmentDuringRepairResponse.body as CustomerLocationProfile[])
      .flatMap((profile) => profile.equipment)
      .find((item) => item.id === equipmentId);
    if (!equipmentDuringRepair) throw new Error('Equipment disappeared after Service work started');
    expect(equipmentDuringRepair).toMatchObject({ active: true, status: 'under_repair' });
    const statusChangeDuringRepair = await request(application.getHttpServer())
      .put(
        `/api/v1/master-data/partners/${customerId}/locations/${customerLocationId}/equipment/${equipmentId}`,
      )
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `crm-equipment-status-during-repair-${runId}`)
      .send({
        deviceName: equipmentDuringRepair.deviceName,
        expectedVersion: equipmentDuringRepair.version,
        purchaseDate: equipmentDuringRepair.purchaseDate,
        status: 'active',
        warrantyEndsOn: equipmentDuringRepair.warrantyEndsOn,
        warrantyStartsOn: equipmentDuringRepair.warrantyStartsOn,
      })
      .expect(409);
    expect(statusChangeDuringRepair.body.error.code).toBe('CUSTOMER_EQUIPMENT_SERVICE_WORK_OPEN');
    const deactivationDuringRepair = await request(application.getHttpServer())
      .post(
        `/api/v1/master-data/partners/${customerId}/locations/${customerLocationId}/equipment/${equipmentId}/deactivate`,
      )
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `crm-equipment-deactivate-during-repair-${runId}`)
      .send({ expectedVersion: equipmentDuringRepair.version })
      .expect(409);
    expect(deactivationDuringRepair.body.error.code).toBe('CUSTOMER_EQUIPMENT_SERVICE_WORK_OPEN');
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
    const temporaryRole = await grantServicePermissions(database, viewerAccountId, [
      'view',
      'edit',
    ]);
    const unassignedToken = await login(application, `sales-viewer-${runId}@example.invalid`);
    try {
      for (const key of [`service-photo-${runId}`, `unassigned-photo-${runId}`]) {
        await request(application.getHttpServer())
          .post(`/api/v1/service/work-orders/${started.id}/photos`)
          .set('authorization', `Bearer ${unassignedToken}`)
          .set('idempotency-key', key)
          .attach('photo', tinyPng, { contentType: 'image/png', filename: 'display-check.png' })
          .expect(403);
      }
    } finally {
      await request(application.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('authorization', `Bearer ${unassignedToken}`);
      await database.query('DELETE FROM iam.account_roles WHERE account_id=$1 AND role_id=$2', [
        viewerAccountId,
        temporaryRole,
      ]);
    }
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
      customerLaborChargeEur: '50',
      customerTransportChargeEur: '0',
      expectedVersion: ready.version,
      laborCostEur: '40',
      parts: [
        { customerUnitPriceEur: '15', productId, quantity: '1' },
        {
          batchNumber: batchPart.batchNumber,
          customerUnitPriceEur: '20',
          productId: batchPart.productId,
          quantity: '1',
        },
      ],
      signatureImageDataUrl: `data:image/png;base64,${tinyPng.toString('base64')}`,
      signerName: 'Elena Stoyanova',
      timeEntries: [
        { minutes: 30, note: 'On-site repair and verification.', workDate: '2026-08-14' },
      ],
      transportCostEur: '10',
    };
    const unknownBatch = await request(application.getHttpServer())
      .post(`/api/v1/service/work-orders/${ready.id}/complete`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-unknown-batch-${runId}`)
      .send({
        ...completionInput,
        parts: [
          {
            batchNumber: `UNKNOWN-${runId.slice(0, 8)}`,
            customerUnitPriceEur: '20',
            productId: batchPart.productId,
            quantity: '1',
          },
        ],
      })
      .expect(404);
    expect(unknownBatch.body.error.code).toBe('INVENTORY_BATCH_NOT_FOUND');
    const unchangedWorkOrder = await request(application.getHttpServer())
      .get(`/api/v1/service/work-orders/${ready.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(unchangedWorkOrder.body).toMatchObject({
      status: 'in_progress',
      version: ready.version,
    });
    const unchangedBatchBalance = await database.query<{ quantity: string }>(
      `SELECT balance.quantity::text
       FROM inventory.batch_stock_balances balance
       JOIN inventory.batches batch ON batch.id = balance.batch_id
       WHERE balance.warehouse_id = $1 AND batch.product_id = $2 AND batch.batch_number = $3`,
      [technicianWarehouseId, batchPart.productId, batchPart.batchNumber],
    );
    expect(unchangedBatchBalance.rows[0]?.quantity).toBe('5.0000');

    const forbiddenWarrantyTransport = await request(application.getHttpServer())
      .post(`/api/v1/service/work-orders/${ready.id}/complete`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-warranty-transport-${runId}`)
      .send({ ...completionInput, customerTransportChargeEur: '5' })
      .expect(400);
    expect(forbiddenWarrantyTransport.body.error.code).toBe(
      'SERVICE_WARRANTY_TRANSPORT_CHARGE_NOT_ALLOWED',
    );

    const completionKey = `service-complete-${runId}`.padEnd(200, 'x');
    const completedResponse = await request(application.getHttpServer())
      .post(`/api/v1/service/work-orders/${ready.id}/complete`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', completionKey)
      .send(completionInput)
      .expect(200);
    const completed = completedResponse.body as ServiceWorkOrder;
    expect(completed).toMatchObject({
      laborCostEur: '40.0000',
      laborMinutes: 30,
      partsCostEur: '14.0000',
      customerChargeRecorded: true,
      customerLaborChargeEur: '50.0000',
      customerPartsChargeEur: '35.0000',
      customerTransportChargeEur: '0.0000',
      photos: [expect.objectContaining({ fileName: 'display-check.png' })],
      signature: { signerName: 'Elena Stoyanova' },
      status: 'completed',
      totalCostEur: '64.0000',
      totalCustomerChargeEur: '85.0000',
      transportCostEur: '10.0000',
    });
    expect(completed.totalCustomerChargeEur).not.toBe(completed.totalCostEur);
    const completedServiceReport = await request(application.getHttpServer())
      .get('/api/v1/service/reports/overview?dateFrom=2026-01-01&dateTo=2099-12-31')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(completedServiceReport.body.totals.completedRequests).toBeGreaterThanOrEqual(1);
    expect(completedServiceReport.body.totals.laborMinutes).toBeGreaterThanOrEqual(30);
    const technicianSummary = (
      completedServiceReport.body as {
        technicians: Array<{ completedCount: unknown; laborMinutes: unknown }>;
      }
    ).technicians[0];
    expect(typeof technicianSummary?.completedCount).toBe('number');
    expect(typeof technicianSummary?.laborMinutes).toBe('number');
    const afterServiceOverviewResponse = await request(application.getHttpServer())
      .get('/api/v1/crm/after-sales')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const afterServiceOverview = afterServiceOverviewResponse.body as CrmAfterSalesOverview;
    expect(afterServiceOverview.surveySources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: completed.id,
          label: `${completed.number} · completed Service job`,
          sourceKind: 'service',
        }),
      ]),
    );
    expect(
      afterServiceOverview.surveySources.find((source) => source.id === completed.id)
        ?.recipientEmails,
    ).toContain(`client-${runId}@example.test`);
    const surveyKey = `service-survey-${runId}`;
    const surveyInput = {
      recipientEmail: `client-${runId}@example.test`,
      sourceId: completed.id,
      sourceKind: 'service',
    };
    const sentSurveyResponse = await request(application.getHttpServer())
      .post('/api/v1/crm/after-sales/surveys')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', surveyKey)
      .send(surveyInput)
      .expect(201);
    const sentSurvey = sentSurveyResponse.body as CrmAfterSalesOverview['surveys'][number];
    expect(typeof sentSurvey.customerName).toBe('string');
    expect(sentSurvey).toMatchObject({
      sourceKind: 'service',
      status: 'awaiting_response',
      sourceLabel: completed.number,
      recipientEmail: surveyInput.recipientEmail,
    });
    expect(['pending', 'processing', 'delivered']).toContain(sentSurvey.deliveryStatus);
    const surveyReplayResponse = await request(application.getHttpServer())
      .post('/api/v1/crm/after-sales/surveys')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', surveyKey)
      .send(surveyInput)
      .expect(201);
    expect((surveyReplayResponse.body as CrmAfterSalesOverview['surveys'][number]).id).toBe(
      sentSurvey.id,
    );
    await request(application.getHttpServer())
      .post('/api/v1/crm/after-sales/surveys')
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `service-survey-viewer-${runId}`)
      .send(surveyInput)
      .expect(403);
    const duplicateSurveyResponse = await request(application.getHttpServer())
      .post('/api/v1/crm/after-sales/surveys')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-survey-duplicate-${runId}`)
      .send(surveyInput)
      .expect(409);
    expect(duplicateSurveyResponse.body.error.code).toBe('CRM_SURVEY_ALREADY_SENT');
    const queuedSurveyEmail = await database.query<{ payload: { text: string } }>(
      `SELECT message.payload
       FROM crm.customer_surveys survey
       JOIN notifications.messages message ON message.id = survey.email_notification_id
       WHERE survey.id = $1`,
      [sentSurvey.id],
    );
    const publicLink = queuedSurveyEmail.rows[0]?.payload.text.match(
      /\/survey\/([A-Za-z0-9_-]{43})\?lang=bg/u,
    );
    const surveyToken = publicLink?.[1];
    expect(surveyToken).toBeTruthy();
    const storedToken = await database.query<{ response_token_hash: string }>(
      'SELECT response_token_hash FROM crm.customer_surveys WHERE id = $1',
      [sentSurvey.id],
    );
    expect(storedToken.rows[0]?.response_token_hash).toBe(
      createHash('sha256')
        .update(surveyToken ?? '')
        .digest('hex'),
    );
    const publicSurveyResponse = await request(application.getHttpServer())
      .get(`/api/v1/crm/public-surveys/${surveyToken}`)
      .expect(200);
    expect(publicSurveyResponse.body).toMatchObject({
      number: sentSurvey.number,
      sourceKind: 'service',
      status: 'awaiting_response',
    });
    expect(publicSurveyResponse.body.customerName).toBeUndefined();
    await database.query(
      `UPDATE crm.customer_surveys
       SET response_expires_at = now() - interval '1 minute'
       WHERE id = $1`,
      [sentSurvey.id],
    );
    const expiredSurveyRead = await request(application.getHttpServer())
      .get(`/api/v1/crm/public-surveys/${surveyToken}`)
      .expect(200);
    expect(expiredSurveyRead.body.status).toBe('expired');
    await request(application.getHttpServer())
      .post(`/api/v1/crm/public-surveys/${surveyToken}/response`)
      .send({ score: 8 })
      .expect(410);
    await database.query(
      `UPDATE crm.customer_surveys
       SET response_expires_at = now() + interval '1 day'
       WHERE id = $1`,
      [sentSurvey.id],
    );
    const recordedPublicSurvey = await request(application.getHttpServer())
      .post(`/api/v1/crm/public-surveys/${surveyToken}/response`)
      .send({ comment: 'The repair was handled well.', score: 9 })
      .expect(200);
    expect(recordedPublicSurvey.body).toMatchObject({ score: 9, status: 'responded' });
    const publicSurveyReplay = await request(application.getHttpServer())
      .post(`/api/v1/crm/public-surveys/${surveyToken}/response`)
      .send({ comment: 'This replay must not replace the first answer.', score: 1 })
      .expect(200);
    expect(publicSurveyReplay.body).toMatchObject({ score: 9, status: 'responded' });
    await request(application.getHttpServer())
      .post(`/api/v1/crm/public-surveys/${'x'.repeat(43)}/response`)
      .send({ score: 8 })
      .expect(404);
    await request(application.getHttpServer())
      .post(`/api/v1/crm/after-sales/surveys/${sentSurvey.id}/response`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-survey-response-after-public-${runId}`)
      .send({ score: 1 })
      .expect(409);
    const afterResponseOverview = (
      await request(application.getHttpServer())
        .get('/api/v1/crm/after-sales')
        .set('authorization', `Bearer ${token}`)
        .expect(200)
    ).body as CrmAfterSalesOverview;
    expect(afterResponseOverview.surveySources).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: completed.id })]),
    );
    expect(afterResponseOverview.surveys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: sentSurvey.id, score: 9, status: 'responded' }),
      ]),
    );
    expect(afterResponseOverview.nps).toMatchObject({ promoters: 1, responses: 1, score: 100 });
    const resolvedTicketResponse = await request(application.getHttpServer())
      .get(`/api/v1/crm/tickets/${linkedCrmTicket.id}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const resolvedTicket = resolvedTicketResponse.body as CrmTicket;
    expect(typeof resolvedTicket.resolvedAt).toBe('string');
    expect(resolvedTicket).toMatchObject({
      serviceLink: {
        correlationId: linkedCorrelationId,
        serviceRequestId: created.id,
      },
      status: 'resolved',
      version: linkedCrmTicket.version + 1,
    });
    expect(
      resolvedTicket.history.some(
        (entry) =>
          entry.status === 'resolved' &&
          entry.type === 'status_change' &&
          entry.note?.includes(created.number),
      ),
    ).toBe(true);
    const duplicateLinkResponse = await request(application.getHttpServer())
      .post(`/api/v1/crm/tickets/from-service-request/${created.id}`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `crm-ticket-for-service-replay-${runId}`)
      .send({
        categoryId: serviceTicketCategoryId,
        priority: 'normal',
        slaPolicyId: serviceTicketPolicyId,
      })
      .expect(201);
    expect(duplicateLinkResponse.body).toMatchObject({
      id: linkedCrmTicket.id,
      status: 'resolved',
      version: resolvedTicket.version,
    });
    const correlatedResolutionEvidence = await database.query<{
      audit_count: string;
      correlation_id: string | null;
      history_count: string;
      outbox_count: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM crm.ticket_history
          WHERE ticket_id = $1 AND status = 'resolved') AS history_count,
         (SELECT count(*)::text FROM integration.outbox_events
          WHERE aggregate_type = 'crm_ticket' AND aggregate_id = $1
            AND event_type = 'crm.ticket.resolved-by-service') AS outbox_count,
         (SELECT correlation_id FROM integration.outbox_events
          WHERE aggregate_type = 'crm_ticket' AND aggregate_id = $1
            AND event_type = 'crm.ticket.resolved-by-service') AS correlation_id,
         (SELECT count(*)::text FROM audit.events
          WHERE action = 'crm.ticket.resolved-by-service' AND target_id = $1) AS audit_count`,
      [linkedCrmTicket.id],
    );
    expect(correlatedResolutionEvidence.rows[0]).toEqual({
      audit_count: '1',
      correlation_id: linkedCrmTicket.serviceLink?.correlationId,
      history_count: '1',
      outbox_count: '1',
    });
    const equipmentAfterRepairResponse = await request(application.getHttpServer())
      .get(`/api/v1/master-data/partners/${customerId}/locations`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const equipmentAfterRepair = (equipmentAfterRepairResponse.body as CustomerLocationProfile[])
      .flatMap((profile) => profile.equipment)
      .find((item) => item.id === equipmentId);
    if (!equipmentAfterRepair)
      throw new Error('Equipment disappeared after Service work completed');
    expect(equipmentAfterRepair).toMatchObject({ active: true, status: 'active' });
    expect(completed.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId, quantity: '1.0000' }),
        expect.objectContaining({
          batchNumber: batchPart.batchNumber,
          productId: batchPart.productId,
          quantity: '1.0000',
        }),
      ]),
    );
    const serviceMovementJournal = await request(application.getHttpServer())
      .get(
        `/api/v1/warehouse/stock-movements?warehouseId=${technicianWarehouseId}&productId=${productId}&movementType=issue&search=${encodeURIComponent(ready.number)}`,
      )
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(serviceMovementJournal.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          movementType: 'issue',
          productId,
          quantity: '-1.0000',
          referenceLabel: ready.number,
          referenceType: 'Repair',
          sourceHref: '/modules/erp.service/work-orders',
          warehouseId: technicianWarehouseId,
        }),
      ]),
    );
    const batchMovement = await database.query<{ batch_id: string | null; quantity: string }>(
      `SELECT movement.batch_id, movement.quantity::text
       FROM inventory.stock_movements movement
       WHERE movement.reference_type = 'repair' AND movement.reference_id = $1
         AND movement.product_id = $2`,
      [ready.id, batchPart.productId],
    );
    expect(batchMovement.rows).toEqual([
      expect.objectContaining({ batch_id: batchPart.batchId, quantity: '1.0000' }),
    ]);
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

    const claimResponse = await request(application.getHttpServer())
      .post('/api/v1/service/warranty-claims')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-history-claim-${runId}`)
      .send({
        customerEquipmentId: equipmentId,
        customerLocationId,
        customerPartnerId: customerId,
        description: 'Intermittent fiscal display connection recorded for history testing.',
        serviceRequestId: created.id,
      })
      .expect(201);
    const claim = claimResponse.body as WarrantyClaim;
    const reviewedClaimResponse = await request(application.getHttpServer())
      .post(`/api/v1/service/warranty-claims/${claim.id}/transition`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-history-claim-review-${runId}`)
      .send({
        expectedVersion: claim.version,
        nextStatus: 'under_review',
        note: 'The device is undergoing technical review.',
      })
      .expect(200);
    const reviewedClaim = reviewedClaimResponse.body as WarrantyClaim;
    const unassignedRequestResponse = await request(application.getHttpServer())
      .post('/api/v1/service/requests')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-history-unassigned-request-${runId}`)
      .send({
        ...requestInput,
        problemDescription: 'Unassigned request retained in equipment history.',
        serviceType: 'out_of_warranty',
      })
      .expect(201);
    const unassignedRequest = unassignedRequestResponse.body as ServiceRequest;

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
    const equipmentHistory = (historyResponse.body as ServiceEquipmentHistory).events;
    const repairEvent = equipmentHistory.find(
      (event) => event.eventType === 'repair' && event.referenceNumber === completed.number,
    );
    expect(repairEvent).toBeDefined();
    expect(repairEvent?.status).toBe('completed');
    expect(repairEvent?.workOrderNumber).toBe(completed.number);
    expect(repairEvent?.technicianName).toBeTruthy();
    expect(repairEvent?.completedAt).toBeTruthy();
    expect(repairEvent?.occurredAt).toBe(repairEvent?.completedAt);
    const batchPartHistory = repairEvent?.parts.find(
      (part) => part.productId === batchPart.productId,
    );
    expect(batchPartHistory?.batchNumber).toBe(batchPart.batchNumber);
    expect(equipmentHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'warranty_claim',
          referenceNumber: reviewedClaim.number,
          status: 'under_review',
        }),
        expect.objectContaining({
          eventType: 'service_request',
          referenceNumber: unassignedRequest.number,
          status: 'new',
        }),
        expect.objectContaining({ eventType: 'sale' }),
      ]),
    );
    const historyTimestamps = equipmentHistory.map((event) => Date.parse(event.occurredAt));
    expect(historyTimestamps).toEqual([...historyTimestamps].sort((left, right) => right - left));
    expect(equipmentHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'warranty_claim',
          referenceNumber: claim.number,
          status: 'received',
        }),
      ]),
    );

    const financeReferencesResponse = await request(application.getHttpServer())
      .get('/api/v1/finance/financial-documents/reference-data')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const financeReferences = financeReferencesResponse.body as FinancialDocumentReferenceData;
    const serviceDraft = financeReferences.serviceDrafts.find((draft) => draft.id === completed.id);
    const financeScope = financeReferences.scopes[0];
    expect(serviceDraft).toMatchObject({
      currencyCode: 'EUR',
      customerPartnerId: customerId,
      linkedDocumentTypes: [],
      number: completed.number,
      total: '85.0000',
    });
    expect(serviceDraft?.lines).toHaveLength(3);
    expect(serviceDraft?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: `Service labour · ${completed.number}`,
          unitPrice: '50.0000',
        }),
        expect.objectContaining({ productId, quantity: '1.0000', unitPrice: '15.0000' }),
        expect.objectContaining({
          productId: batchPart.productId,
          quantity: '1.0000',
          unitPrice: '20.0000',
        }),
      ]),
    );
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
      currencyCode: 'EUR',
      customerPartnerId: customerId,
      documentType: 'invoice',
      dueDate: businessDate,
      exchangeRate: '1',
      issueDate: businessDate,
      legalEntityId: financeScope.legalEntityId,
      lines: serviceDraft.lines,
      rateDate: businessDate,
      rateSource: 'internal_eur',
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
      eurGrossTotal: '102.0000',
      eurNetTotal: '85.0000',
      eurVatTotal: '17.0000',
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
      financialDocumentStatus: 'draft',
    });

    const issuedServiceInvoice = (
      await request(application.getHttpServer())
        .post(`/api/v1/finance/financial-documents/${financeDraft.id}/issue`)
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `service-finance-issue-${runId}`)
        .send({ expectedVersion: financeDraft.version })
        .expect(200)
    ).body as FinancialDocument;
    expect(typeof issuedServiceInvoice.officialNumber).toBe('string');
    expect(issuedServiceInvoice.sourceServiceWorkOrderId).toBe(completed.id);
    expect(issuedServiceInvoice.status).toBe('issued');
    expect(typeof issuedServiceInvoice.collection?.id).toBe('string');
    expect(typeof issuedServiceInvoice.collection?.number).toBe('string');

    const issuedServiceWorkOrder = (
      await request(application.getHttpServer())
        .get(`/api/v1/service/work-orders/${completed.id}`)
        .set('authorization', `Bearer ${token}`)
        .expect(200)
    ).body as ServiceWorkOrder;
    expect(issuedServiceWorkOrder).toMatchObject({
      financialDocumentId: financeDraft.id,
      financialDocumentNumber: issuedServiceInvoice.officialNumber,
      financialDocumentStatus: 'issued',
    });

    const serviceReferenceAfterIssue = (
      await request(application.getHttpServer())
        .get('/api/v1/finance/financial-documents/reference-data')
        .set('authorization', `Bearer ${token}`)
        .expect(200)
    ).body as FinancialDocumentReferenceData;
    expect(
      serviceReferenceAfterIssue.serviceDrafts.find((draft) => draft.id === completed.id)
        ?.linkedDocumentTypes,
    ).toContain('invoice');
    const duplicateServiceInvoice = await request(application.getHttpServer())
      .post('/api/v1/finance/financial-documents')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-finance-duplicate-${runId}`)
      .send(serviceInvoiceInput)
      .expect(409);
    expect(duplicateServiceInvoice.body.error.code).toBe('FINANCE_SERVICE_INVOICE_ALREADY_ISSUED');

    const serviceCollectionId = issuedServiceInvoice.collection?.id;
    if (!serviceCollectionId) throw new Error('Issued Service invoice has no collection record');
    const unpaidServiceCollection = (
      await request(application.getHttpServer())
        .get(`/api/v1/finance/documents/${serviceCollectionId}`)
        .set('authorization', `Bearer ${token}`)
        .expect(200)
    ).body as FinanceCustomerDocument;
    expect(unpaidServiceCollection).toMatchObject({
      financialDocument: { id: financeDraft.id, number: issuedServiceInvoice.officialNumber },
      outstandingTotal: '102.0000',
      paymentStatus: 'unpaid',
      total: '102.0000',
    });

    const servicePayment = {
      amount: '102',
      paymentDate: businessDate,
      paymentMethod: 'bank_transfer',
      paymentReference: `SERVICE-${runId}`,
    };
    const paidServiceCollection = (
      await request(application.getHttpServer())
        .post(`/api/v1/finance/documents/${serviceCollectionId}/payments`)
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `service-finance-payment-${runId}`)
        .send(servicePayment)
        .expect(201)
    ).body as FinanceCustomerDocument;
    expect(paidServiceCollection).toMatchObject({
      financialDocument: { id: financeDraft.id, number: issuedServiceInvoice.officialNumber },
      outstandingTotal: '0.0000',
      paymentStatus: 'paid',
      total: '102.0000',
    });
    const servicePaymentReplay = (
      await request(application.getHttpServer())
        .post(`/api/v1/finance/documents/${serviceCollectionId}/payments`)
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `service-finance-payment-${runId}`)
        .send(servicePayment)
        .expect(201)
    ).body as FinanceCustomerDocument;
    expect(servicePaymentReplay.payments.map((payment) => payment.id)).toEqual(
      paidServiceCollection.payments.map((payment) => payment.id),
    );
    const paidServiceStatus = await request(application.getHttpServer())
      .get(
        `/api/v1/finance/customer-accounts/payment-status?search=${encodeURIComponent(issuedServiceInvoice.officialNumber ?? '')}&status=paid`,
      )
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(paidServiceStatus.body).toMatchObject({
      totalItems: 1,
      items: [
        expect.objectContaining({
          number: issuedServiceInvoice.officialNumber,
          outstandingTotal: '0.0000',
          paymentStatus: 'paid',
        }),
      ],
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

    const equipmentBeforeRetirementResponse = await request(application.getHttpServer())
      .get(`/api/v1/master-data/partners/${customerId}/locations`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const equipmentBeforeRetirement = (
      equipmentBeforeRetirementResponse.body as CustomerLocationProfile[]
    )
      .flatMap((profile) => profile.equipment)
      .find((item) => item.id === equipmentId);
    if (!equipmentBeforeRetirement) throw new Error('Equipment disappeared before retirement');
    const retiredEquipmentResponse = await request(application.getHttpServer())
      .put(
        `/api/v1/master-data/partners/${customerId}/locations/${customerLocationId}/equipment/${equipmentId}`,
      )
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `crm-equipment-retire-${runId}`)
      .send({
        deviceName: equipmentBeforeRetirement.deviceName,
        expectedVersion: equipmentBeforeRetirement.version,
        purchaseDate: equipmentBeforeRetirement.purchaseDate,
        status: 'retired',
        warrantyEndsOn: equipmentBeforeRetirement.warrantyEndsOn,
        warrantyStartsOn: equipmentBeforeRetirement.warrantyStartsOn,
      })
      .expect(200);
    expect(retiredEquipmentResponse.body).toMatchObject({ active: true, status: 'retired' });
    const retiredReferenceResponse = await request(application.getHttpServer())
      .get('/api/v1/service/reference-data')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect((retiredReferenceResponse.body as ServiceReferenceData).equipment).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ active: true, id: equipmentId, status: 'retired' }),
      ]),
    );
    const retiredServiceRequest = await request(application.getHttpServer())
      .post('/api/v1/service/requests')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `service-retired-equipment-${runId}`)
      .send({
        ...requestInput,
        problemDescription: 'A retired device must remain in history, not new work.',
      })
      .expect(400);
    expect(retiredServiceRequest.body.error.code).toBe('SERVICE_EQUIPMENT_REFERENCE_INVALID');
    const retiredHistoryResponse = await request(application.getHttpServer())
      .get(`/api/v1/service/equipment/${equipmentId}/history`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect((retiredHistoryResponse.body as ServiceEquipmentHistory).events).toEqual(
      expect.arrayContaining([expect.objectContaining({ referenceNumber: completed.number })]),
    );

    const evidence = await database.query<{
      audit_count: string;
      batch_quantity: string;
      outbox_count: string;
      part_usage_count: string;
      stock_quantity: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM service.work_order_part_usages WHERE work_order_id = $1) AS part_usage_count,
         (SELECT quantity::text FROM inventory.stock_balances WHERE warehouse_id = $2 AND product_id = $3) AS stock_quantity,
         (SELECT balance.quantity::text FROM inventory.batch_stock_balances balance
           JOIN inventory.batches batch ON batch.id = balance.batch_id
           WHERE balance.warehouse_id = $2 AND batch.product_id = $4 AND batch.batch_number = $5) AS batch_quantity,
         (SELECT count(*)::text FROM audit.events WHERE action LIKE 'service.%') AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events WHERE event_type LIKE 'service.%') AS outbox_count`,
      [completed.id, technicianWarehouseId, productId, batchPart.productId, batchPart.batchNumber],
    );
    expect(evidence.rows[0]).toMatchObject({
      batch_quantity: '4.0000',
      part_usage_count: '2',
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
        (SELECT coalesce(sum(CASE WHEN document_type='credit_note' THEN -eur_net_total ELSE eur_net_total END),0)::text
         FROM finance.financial_documents WHERE status NOT IN ('draft', 'cancelled')
         AND official_number IS NOT NULL AND document_type IN ('invoice','credit_note','debit_note')
         AND issue_date BETWEEN '2026-01-01' AND '2099-12-31') AS revenue,
        (SELECT coalesce(sum(round(outstanding_total * exchange_rate,4)),0)::text
         FROM finance.customer_documents WHERE review_state='pending_finance_review' AND outstanding_total>0 AND due_date<$1::date) AS overdue,
        (SELECT count(*)::integer FROM service.requests WHERE status IN ('new','scheduled','in_progress')) AS service,
        (SELECT count(*)::integer FROM master_data.customer_equipment WHERE active
         AND warranty_end_date BETWEEN $1::date AND $1::date+30) AS warranties`,
      [summary.asOf],
    );
    expect(summary).toMatchObject({
      recordedRevenueEur: expected.rows[0]?.revenue,
      overdueReceivablesEur: expected.rows[0]?.overdue,
      activeServiceRequests: expected.rows[0]?.service,
      expiringWarranties: expected.rows[0]?.warranties,
    });
    const restricted = await request(application.getHttpServer())
      .get(path)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(restricted.body.activeServiceRequests).toBeUndefined();
    expect(restricted.body.expiringWarranties).toBeUndefined();
    expect(restricted.body.recordedRevenueEur).toBe(summary.recordedRevenueEur);
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
    expect(crmOnly.body.recordedRevenueEur).toBeUndefined();
    expect(crmOnly.body.overdueReceivablesEur).toBeUndefined();
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
    expect(Number(empty.body.recordedRevenueEur)).toBe(0);
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
    const input = { hiddenCards: ['recordedRevenueEur'], version: 0 };
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
      { hiddenCards: ['recordedRevenueEur', 'recordedRevenueEur'], version: 1 },
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
    expect(
      overview.technicians.every(
        (technician) =>
          Number.isFinite(technician.completedCount) && Number.isFinite(technician.laborMinutes),
      ),
    ).toBe(true);

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
    expect(downloaded.text).not.toContain('Labour EUR');
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
    const ownHistoryResponse = await request(application.getHttpServer())
      .get(`/api/v1/service/equipment/${firstScope.equipmentId}/history`)
      .set('authorization', `Bearer ${firstTechnicianToken}`)
      .expect(200);
    const ownHistory = (ownHistoryResponse.body as ServiceEquipmentHistory).events;
    expect(ownHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'service_visit',
          referenceNumber: firstAssigned.workOrderNumber,
        }),
      ]),
    );
    expect(
      ownHistory.every(
        (event) => event.eventType !== 'sale' && event.eventType !== 'warranty_claim',
      ),
    ).toBe(true);

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

  it('converts a paid Sales proforma to one linked official invoice exactly once', async () => {
    const businessDate = (
      await database.query<{ date: string }>(
        "SELECT (now() AT TIME ZONE 'Europe/Sofia')::date::text AS date",
      )
    ).rows[0]?.date;
    if (!businessDate) throw new Error('Finance test date is unavailable');

    const quotation = (
      await request(application.getHttpServer())
        .post('/api/v1/sales/quotations')
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `proforma-conversion-quotation-${runId}`)
        .send({
          currencyCode: 'EUR',
          customerPartnerId: customerId,
          lines: [
            {
              discountPercent: '0',
              productId,
              quantity: '1',
              unitPrice: '20',
              vatTreatment: 'standard_20',
            },
          ],
          overallDiscountPercent: '0',
          validUntil: '2099-12-31',
          warehouseId,
        })
        .expect(201)
    ).body as SalesWorkflow;
    const confirmed = (
      await request(application.getHttpServer())
        .post(`/api/v1/sales/quotations/${quotation.id}/confirm`)
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `proforma-conversion-confirm-${runId}`)
        .send({ lines: quotation.lines.map((line) => ({ quotationLineId: line.id })) })
        .expect(201)
    ).body as SalesWorkflow;
    const shipped = (
      await request(application.getHttpServer())
        .post(`/api/v1/sales/orders/${confirmed.order?.id}/shipments`)
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `proforma-conversion-shipment-${runId}`)
        .send({ lines: confirmed.order?.lines.map((line) => ({ orderLineId: line.id })) })
        .expect(201)
    ).body as SalesWorkflow;
    if (!shipped.handover)
      throw new Error('The shipped order did not produce a handover certificate');
    const handedOver = await request(application.getHttpServer())
      .post(`/api/v1/sales/handover-certificates/${shipped.handover.id}/accept`)
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `proforma-conversion-handover-${runId}`)
      .send({
        acceptedByName: 'Finance Integration Tester',
        customerLocationId,
        expectedVersion: shipped.handover.version,
      })
      .expect(200);
    expect((handedOver.body as SalesWorkflow).handover?.status).toBe('accepted');
    const invoiced = (
      await request(application.getHttpServer())
        .post(`/api/v1/sales/orders/${shipped.order?.id}/invoice-draft`)
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `proforma-conversion-sales-invoice-${runId}`)
        .expect(201)
    ).body as SalesWorkflow;
    const salesInvoiceId = invoiced.invoice?.id;
    if (!salesInvoiceId) throw new Error('The handed-over order did not produce a Sales invoice');

    const financeReferences = (
      await request(application.getHttpServer())
        .get('/api/v1/finance/financial-documents/reference-data')
        .set('authorization', `Bearer ${token}`)
        .expect(200)
    ).body as FinancialDocumentReferenceData;
    const scope = financeReferences.scopes[0];
    if (!scope) throw new Error('A Finance issuing scope was not available');
    const proformaDraft = (
      await request(application.getHttpServer())
        .post('/api/v1/finance/financial-documents')
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `proforma-conversion-document-${runId}`)
        .send({
          businessLocationId: scope.locationId,
          currencyCode: 'EUR',
          customerPartnerId: customerId,
          documentType: 'proforma',
          dueDate: businessDate,
          exchangeRate: '1',
          issueDate: businessDate,
          legalEntityId: scope.legalEntityId,
          rateDate: businessDate,
          rateSource: 'internal_eur',
          sourceSalesInvoiceId: salesInvoiceId,
          taxEventDate: businessDate,
        })
        .expect(201)
    ).body as FinancialDocument;
    const proforma = (
      await request(application.getHttpServer())
        .post(`/api/v1/finance/financial-documents/${proformaDraft.id}/issue`)
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `proforma-conversion-issue-${runId}`)
        .send({ expectedVersion: proformaDraft.version })
        .expect(200)
    ).body as FinancialDocument;
    expect(proforma).toMatchObject({ documentType: 'proforma', status: 'issued' });
    expect(proforma).not.toHaveProperty('officialNumber');

    const collection = (
      await request(application.getHttpServer())
        .post('/api/v1/finance/documents')
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `proforma-conversion-collection-${runId}`)
        .send({ dueDate: businessDate, salesInvoiceId })
        .expect(201)
    ).body as FinanceCustomerDocument;
    const paymentKey = `proforma-conversion-payment-${runId}`;
    const paymentInput = {
      amount: collection.total,
      paymentDate: businessDate,
      paymentMethod: 'bank_transfer',
      paymentReference: `PROFORMA-${runId}`,
    };
    const paid = (
      await request(application.getHttpServer())
        .post(`/api/v1/finance/documents/${collection.id}/payments`)
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', paymentKey)
        .send(paymentInput)
        .expect(201)
    ).body as FinanceCustomerDocument;
    expect(paid).toMatchObject({
      financialDocument: { status: 'issued', type: 'invoice' },
      outstandingTotal: '0.0000',
      paymentStatus: 'paid',
    });

    const replay = (
      await request(application.getHttpServer())
        .post(`/api/v1/finance/documents/${collection.id}/payments`)
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', paymentKey)
        .send(paymentInput)
        .expect(201)
    ).body as FinanceCustomerDocument;
    expect(replay.financialDocument?.id).toBe(paid.financialDocument?.id);

    const converted = await database.query<{
      conversion_count: string;
      official_number: string;
      source_proforma_id: string;
    }>(
      `SELECT count(*)::text AS conversion_count,
              max(invoice.official_number) AS official_number,
              max(invoice.converted_from_document_id::text) AS source_proforma_id
       FROM finance.financial_documents invoice
       WHERE invoice.converted_from_document_id = $1`,
      [proforma.id],
    );
    expect(converted.rows[0]).toEqual({
      conversion_count: '1',
      official_number: paid.financialDocument?.number,
      source_proforma_id: proforma.id,
    });
  });

  function quotationInput() {
    return {
      currencyCode: 'EUR',
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
      currencyCode: 'EUR',
      customerLocationId,
      customerPartnerId: customerId,
      equipmentIds: [equipmentId],
      includedServices: ['Preventive maintenance', 'Remote support'],
      nextInvoiceDate: '2026-08-01',
      validFrom: '2026-01-01',
      visitFrequencyMonths: 3,
    };
  }
  it('schedules private saved reports atomically, delivers once, and persists private dashboard layouts', async () => {
    const email = `hub-${runId}@example.invalid`;
    const creatorAccountId = await createAccount(
      database,
      email,
      await application.get(PasswordService).hash(password),
    );
    await grantFinancePermissions(database, creatorAccountId, ['view', 'create']);
    const token = await login(application, email);
    const saved = {
      id: randomUUID(),
      name: 'Scheduled supplier review',
      definitionKey: 'finance.supplier-turnover',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
      format: 'csv',
      columns: ['partnerName', 'grossEurTotal'],
    };
    const auth = { authorization: `Bearer ${token}` };
    const server = application.getHttpServer() as Parameters<typeof request>[0];
    await request(server).post('/api/v1/finance/saved-reports').set(auth).send(saved).expect(201);
    const library = await request(server).get('/api/v1/reporting/views').set(auth).expect(200);
    expect(library.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: saved.id, scope: 'finance', canCreate: true }),
      ]),
    );
    const other = await request(server)
      .get('/api/v1/reporting/views')
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect((other.body as { items: { id: string }[] }).items.some((v) => v.id === saved.id)).toBe(
      false,
    );
    const time = await database.query<{ local: string }>(
      `SELECT to_char((now()-interval '2 minutes') AT TIME ZONE 'Europe/Sofia','YYYY-MM-DD"T"HH24:MI') local`,
    );
    const input = {
      id: randomUUID(),
      viewId: saved.id,
      scope: 'finance',
      name: 'Daily supplier review',
      cadence: 'daily',
      period: 'previous_day',
      firstRunLocal: time.rows[0]!.local,
    };
    const send = () => request(server).post('/api/v1/reporting/schedules').set(auth).send(input);
    const [first, replay] = await Promise.all([send(), send()]);
    expect(first.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    await request(server)
      .post('/api/v1/reporting/schedules')
      .set(auth)
      .send({ ...input, name: 'Changed' })
      .expect(409);
    await request(server)
      .post('/api/v1/reporting/schedules')
      .set('authorization', `Bearer ${viewerToken}`)
      .send({ ...input, id: randomUUID() })
      .expect(403);
    const scheduler = application.get(ReportingHubService);
    await Promise.all([scheduler.dispatchDue(), scheduler.dispatchDue()]);
    const history = await request(server)
      .get(`/api/v1/reporting/schedules/${input.id}/runs`)
      .set(auth)
      .expect(200);
    expect(history.body.total).toBe(1);
    const exportId = history.body.items[0].export.id as string;
    const filters = await database.query<{ filters: { dateFrom: string; dateTo: string } }>(
      'SELECT filters FROM reporting.export_jobs WHERE id=$1',
      [exportId],
    );
    const dates = await database.query<{ day: string }>(
      `SELECT (($1::timestamp)::date-1)::text AS "day"`,
      [input.firstRunLocal],
    );
    expect(filters.rows[0]!.filters).toMatchObject({
      dateFrom: dates.rows[0]!.day,
      dateTo: dates.rows[0]!.day,
    });
    const job = {
      attemptNumber: 1,
      correlationId: randomUUID(),
      enqueuedAt: new Date().toISOString(),
      idempotencyKey: `hub:${exportId}`,
      jobId: randomUUID(),
      maxAttempts: 5,
      name: 'report.generate',
      payload: { exportId },
      retryAllowed: true,
    } as const;
    await application.get(JobHandlerRegistry).execute(job);
    await application.get(JobHandlerRegistry).execute({ ...job, attemptNumber: 2 });
    await request(server)
      .get(`/api/v1/reporting/exports/finance/${exportId}/content`)
      .set(auth)
      .expect(200);
    await request(server)
      .get(`/api/v1/reporting/schedules/${input.id}/runs`)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(404);
    expect(
      (
        await database.query('SELECT id FROM notifications.messages WHERE idempotency_key=$1', [
          `report-ready:${exportId}`,
        ])
      ).rowCount,
    ).toBe(1);
    const paused = await request(server)
      .put(`/api/v1/reporting/schedules/${input.id}/state`)
      .set(auth)
      .send({ enabled: false, version: 0 })
      .expect(200);
    expect(paused.body.enabled).toBe(false);
    await request(server)
      .put(`/api/v1/reporting/schedules/${input.id}/state`)
      .set(auth)
      .send({ enabled: true, version: 0 })
      .expect(409);
    await request(server)
      .put(`/api/v1/reporting/schedules/${input.id}/state`)
      .set(auth)
      .send({ enabled: true, version: (paused.body as { version: number }).version })
      .expect(200);
    const secondInput = { ...input, id: randomUUID(), name: 'Queued permission check' };
    await request(server)
      .post('/api/v1/reporting/schedules')
      .set(auth)
      .send(secondInput)
      .expect(201);
    await scheduler.dispatchDue();
    const queued = (
      await database.query<{ export_id: string }>(
        'SELECT export_id FROM reporting.report_schedule_runs WHERE schedule_id=$1',
        [secondInput.id],
      )
    ).rows[0]!.export_id;
    // A schedule loses execution authority as soon as the underlying permission is revoked.
    await database.query(
      "UPDATE reporting.report_schedules SET next_run_at=now()-interval '1 minute' WHERE id=$1",
      [input.id],
    );
    await database.query(
      `DELETE FROM iam.role_permissions rp USING iam.permissions p,iam.account_roles ar WHERE rp.permission_id=p.id AND rp.role_id=ar.role_id AND ar.account_id=$1 AND p.module='erp.finance' AND p.action='create'`,
      [creatorAccountId],
    );
    await scheduler.dispatchDue();
    await expect(
      application.get(JobHandlerRegistry).execute({
        ...job,
        jobId: randomUUID(),
        idempotencyKey: `hub:${queued}`,
        payload: { exportId: queued },
      }),
    ).rejects.toThrow();
    expect(
      (
        await database.query<{ status: string }>(
          'SELECT status FROM reporting.export_jobs WHERE id=$1',
          [queued],
        )
      ).rows[0]!.status,
    ).toBe('failed');
    expect(
      (
        await database.query(
          'SELECT enabled,error_code FROM reporting.report_schedules WHERE id=$1',
          [input.id],
        )
      ).rows[0],
    ).toEqual({ enabled: false, error_code: 'REPORT_ACCESS_CHANGED' });
    await grantFinancePermissions(database, creatorAccountId, ['create']);
    // A permanently invalid saved configuration must not starve other due schedules.
    const invalidInput = { ...input, id: randomUUID(), name: 'Retired field check' };
    await request(server)
      .post('/api/v1/reporting/schedules')
      .set(auth)
      .send(invalidInput)
      .expect(201);
    await database.query(
      `UPDATE reporting.report_schedules SET configuration=jsonb_set(configuration,'{columns}','["retiredField"]'::jsonb) WHERE id=$1`,
      [invalidInput.id],
    );
    await scheduler.dispatchDue();
    expect(
      (
        await database.query<{ error_code: string }>(
          'SELECT error_code FROM reporting.report_schedules WHERE id=$1',
          [invalidInput.id],
        )
      ).rows[0]!.error_code,
    ).toBe('REPORT_CONFIGURATION_CHANGED');
    const pref = '/api/v1/reporting/dashboards/finance';
    await request(server)
      .put(pref)
      .set(auth)
      .send({ hiddenCards: ['unknown'], version: 0 })
      .expect(400);
    const layout = await request(server)
      .put(pref)
      .set(auth)
      .send({ hiddenCards: ['total'], version: 0 })
      .expect(200);
    expect(layout.body).toEqual({ hiddenCards: ['total'], version: 1 });
    await request(server)
      .put(pref)
      .set(auth)
      .send({ hiddenCards: ['current'], version: 0 })
      .expect(409);
    expect(
      (await request(server).get(pref).set('authorization', `Bearer ${viewerToken}`).expect(200))
        .body.hiddenCards,
    ).toEqual([]);
    await request(server).put(pref).set(auth).send({ hiddenCards: [], version: 1 }).expect(200);
    const anchors = await database.query<{ feb: string; mar: string; dst: string }>(
      `SELECT ('2027-01-31 09:00'::timestamp+interval '1 month')::date::text feb,('2027-01-31 09:00'::timestamp+2*interval '1 month')::date::text mar, (('2027-03-27 09:00'::timestamp+interval '1 day') AT TIME ZONE 'Europe/Sofia') AT TIME ZONE 'UTC' AS dst`,
    );
    expect(anchors.rows[0]).toMatchObject({ feb: '2027-02-28', mar: '2027-03-31' });
  });
  async function recurringFixture(label: string) {
    const today = (
      await database.query<{ date: string }>(
        "SELECT (now() AT TIME ZONE 'Europe/Sofia')::date::text AS date",
      )
    ).rows[0]!.date;
    const ownerEmail = `recurring-${label}-${runId}@example.invalid`;
    const ownerId = await createAccount(
      database,
      ownerEmail,
      await application.get(PasswordService).hash(password),
    );
    await grantFinancePermissions(database, ownerId, ['view', 'create', 'edit']);
    const ownerToken = await login(application, ownerEmail);
    const contract = (
      await request(application.getHttpServer())
        .post('/api/v1/sales/subscriptions')
        .set('authorization', `Bearer ${token}`)
        .set('idempotency-key', `recurring-contract-${label}-${runId}`)
        .send({
          ...subscriptionInput(),
          validFrom: today,
          nextInvoiceDate: today,
          billingAmount: '50',
        })
        .expect(201)
    ).body as ServiceSubscriptionContract;
    const refs = (
      await request(application.getHttpServer())
        .get('/api/v1/finance/financial-documents/reference-data')
        .set('authorization', `Bearer ${ownerToken}`)
        .expect(200)
    ).body as FinancialDocumentReferenceData;
    const scope = refs.scopes[0]!;
    const input: RecurringInvoiceProfileInput = {
      enabled: true,
      legalEntityId: scope.legalEntityId,
      businessLocationId: scope.locationId,
      firstBillingDate: today,
      paymentTermsDays: 14,
      vatTreatment: 'standard_20',
      contractVersion: contract.version,
    };
    const context = {
      attemptNumber: 1,
      correlationId: randomUUID(),
      enqueuedAt: new Date().toISOString(),
      idempotencyKey: `recurring-job-${label}-${runId}`,
      jobId: randomUUID(),
      maxAttempts: 5,
      name: 'sales.subscription-invoice.generate',
      payload: { asOf: today, contractId: contract.id },
      retryAllowed: true,
    } as const;
    const save = (body: RecurringInvoiceProfileInput, key: string) =>
      request(application.getHttpServer())
        .put(`/api/v1/finance/recurring-invoices/${contract.id}`)
        .set('authorization', `Bearer ${ownerToken}`)
        .set('idempotency-key', key)
        .send(body);
    const read = async () =>
      (
        await request(application.getHttpServer())
          .get(`/api/v1/finance/recurring-invoices/${contract.id}`)
          .set('authorization', `Bearer ${ownerToken}`)
          .expect(200)
      ).body as RecurringInvoiceContract;
    return { today, ownerId, ownerToken, contract, input, context, save, read };
  }

  async function correctionFixture(label: string) {
    const fixture = await recurringFixture(`correction-${label}`);
    const server = application.getHttpServer() as Parameters<typeof request>[0];
    const auth = { authorization: `Bearer ${fixture.ownerToken}` };
    const refs = (
      await request(server)
        .get('/api/v1/finance/financial-documents/reference-data')
        .set(auth)
        .expect(200)
    ).body as FinancialDocumentReferenceData;
    const line = {
      description: 'Collection correction test',
      productId,
      unitCode: refs.products.find((item) => item.id === productId)!.unitCode,
      quantity: '10',
      unitPrice: '10',
      discountPercent: '0',
      vatTreatment: 'standard_20',
    };
    const input = {
      legalEntityId: fixture.input.legalEntityId,
      businessLocationId: fixture.input.businessLocationId,
      customerPartnerId: customerId,
      documentType: 'invoice',
      issueDate: fixture.today,
      taxEventDate: fixture.today,
      dueDate: fixture.today,
      currencyCode: 'EUR',
      exchangeRate: '1',
      rateDate: fixture.today,
      rateSource: 'internal_eur',
      lines: [line],
    };
    const create = async (body: object) =>
      (
        await request(server)
          .post('/api/v1/finance/financial-documents')
          .set(auth)
          .set('idempotency-key', randomUUID())
          .send(body)
          .expect(201)
      ).body as FinancialDocument;
    const issue = (document: FinancialDocument, key = randomUUID()) =>
      request(server)
        .post(`/api/v1/finance/financial-documents/${document.id}/issue`)
        .set(auth)
        .set('idempotency-key', key)
        .send({ expectedVersion: document.version });
    const draft = await create(input);
    const original = (await issue(draft).expect(200)).body as FinancialDocument;
    const collectionId = original.collection!.id;
    const read = async () =>
      (await request(server).get(`/api/v1/finance/documents/${collectionId}`).set(auth).expect(200))
        .body as FinanceCustomerDocument;
    const note = (type: 'credit_note' | 'debit_note', quantity: string) =>
      create({
        ...input,
        documentType: type,
        dueDate: undefined,
        correctionOfDocumentId: original.id,
        correctionReason: `${type} for ${quantity} items`,
        lines: [{ ...line, quantity }],
      });
    const pay = (amount: string, version: number) =>
      request(server)
        .post(`/api/v1/finance/documents/${collectionId}/payments`)
        .set(auth)
        .set('idempotency-key', randomUUID())
        .send({
          amount,
          expectedDocumentVersion: version,
          paymentMethod: 'bank_transfer',
          paymentDate: fixture.today,
          paymentReference: `Correction test ${randomUUID()}`,
        });
    return {
      ...fixture,
      server,
      auth,
      create,
      issue,
      input,
      original,
      collectionId,
      read,
      note,
      pay,
    };
  }

  it('applies only issued notes, preserves original payments and exposes customer credit without inventing a refund', async () => {
    const f = await correctionFixture('balances');
    const advancesBefore = (
      await database.query(
        'SELECT id FROM finance.customer_advances WHERE customer_partner_id=$1',
        [customerId],
      )
    ).rowCount;
    const originalBefore = (
      await database.query<Record<string, unknown>>(
        'SELECT gross_total,eur_gross_total,exchange_rate,version FROM finance.financial_documents WHERE id=$1',
        [f.original.id],
      )
    ).rows[0];
    expect(
      (
        await request(f.server)
          .get('/api/v1/finance/financial-documents/reference-data')
          .set(f.auth)
          .expect(200)
      ).body.correctionDocuments,
    ).toContainEqual(
      expect.objectContaining({ id: f.original.id, number: f.original.officialNumber }),
    );
    let collection = await f.read();
    collection = (await f.pay('60', collection.version).expect(201))
      .body as FinanceCustomerDocument;
    const first = await f.note('credit_note', '2');
    const turnover = async () =>
      (
        await request(f.server)
          .get(
            `/api/v1/finance/reports/turnover?kind=customer&dateFrom=${f.today}&dateTo=${f.today}`,
          )
          .set(f.auth)
          .expect(200)
      ).body as FinanceTurnoverReport;
    const turnoverBefore = (await turnover()).items.find(
      (row) => row.partnerId === customerId,
    )!.grossEurTotal;
    expect(await f.read()).toMatchObject({
      total: '120.0000',
      allocatedTotal: '60.0000',
      outstandingTotal: '60.0000',
      creditTotal: '0.0000',
      corrections: [],
    });
    await request(f.server)
      .post(`/api/v1/finance/financial-documents/${first.id}/issue`)
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', randomUUID())
      .send({ expectedVersion: first.version })
      .expect(403);
    const issueKey = randomUUID();
    const issued = (await f.issue(first, issueKey).expect(200)).body as FinancialDocument;
    expect(issued.collection?.id).toBe(f.collectionId);
    await f.issue(first, issueKey).expect(200);
    await f.issue(first).expect(409);
    await f.issue(issued).expect(200);
    collection = await f.read();
    expect(collection).toMatchObject({
      total: '120.0000',
      creditTotal: '24.0000',
      debitTotal: '0.0000',
      adjustedTotal: '96.0000',
      allocatedTotal: '60.0000',
      outstandingTotal: '36.0000',
      overpaidTotal: '0.0000',
      paymentStatus: 'partially_paid',
    });
    expect(collection.corrections).toHaveLength(1);
    expect(
      Number((await turnover()).items.find((row) => row.partnerId === customerId)!.grossEurTotal) -
        Number(turnoverBefore),
    ).toBe(-24);
    expect(collection.corrections![0]).toMatchObject({
      documentId: first.id,
      number: issued.officialNumber,
      amount: '24.0000',
      eurAmount: '24.0000',
    });
    const cancelled = await f.note('credit_note', '1');
    await request(f.server)
      .post(`/api/v1/finance/financial-documents/${cancelled.id}/cancel`)
      .set(f.auth)
      .set('idempotency-key', randomUUID())
      .send({ expectedVersion: 1, cancellationReason: 'No longer needed' })
      .expect(200);
    expect((await f.read()).creditTotal).toBe('24.0000');
    const debit = await f.note('debit_note', '1');
    await f.issue(debit).expect(200);
    collection = await f.read();
    expect(collection).toMatchObject({
      adjustedTotal: '108.0000',
      outstandingTotal: '48.0000',
      debitTotal: '12.0000',
    });
    const excess = await f.pay('49', collection.version).expect(409);
    expect(excess.body.error.code).toBe('FINANCE_ALLOCATION_EXCEEDS_BALANCE');
    collection = (await f.pay('48', collection.version).expect(201))
      .body as FinanceCustomerDocument;
    const lateCredit = await f.note('credit_note', '1');
    await f.issue(lateCredit).expect(200);
    collection = await f.read();
    expect(collection).toMatchObject({
      total: '120.0000',
      adjustedTotal: '96.0000',
      creditTotal: '36.0000',
      allocatedTotal: '108.0000',
      outstandingTotal: '0.0000',
      overpaidTotal: '12.0000',
      paymentStatus: 'paid',
    });
    expect(collection.payments.map((payment) => payment.amount)).toEqual(
      expect.arrayContaining(['60.0000', '48.0000']),
    );
    expect(collection.payments).toHaveLength(2);
    expect(
      (
        await database.query(
          'SELECT gross_total,eur_gross_total,exchange_rate,version FROM finance.financial_documents WHERE id=$1',
          [f.original.id],
        )
      ).rows[0],
    ).toEqual(originalBefore);
    for (const command of [
      'UPDATE finance.collection_corrections SET amount=1 WHERE correction_document_id=$1',
      'DELETE FROM finance.collection_corrections WHERE correction_document_id=$1',
    ])
      await expect(database.query(command, [first.id])).rejects.toThrow('append-only');
    expect(
      (
        await database.query(
          'SELECT id FROM finance.customer_advances WHERE customer_partner_id=$1',
          [customerId],
        )
      ).rowCount,
    ).toBe(advancesBefore);
    const extraDebit = await f.note('debit_note', '2');
    await f.issue(extraDebit).expect(200);
    collection = await f.read();
    expect(collection).toMatchObject({
      adjustedTotal: '120.0000',
      allocatedTotal: '108.0000',
      outstandingTotal: '12.0000',
      overpaidTotal: '0.0000',
      paymentStatus: 'partially_paid',
    });
    await grantFinancePermissions(database, f.ownerId, ['approve']);
    const payment = collection.payments.find((item) => item.amount === '48.0000')!;
    const reversed = (
      await request(f.server)
        .post(`/api/v1/finance/documents/${f.collectionId}/payments/${payment.id}/reverse`)
        .set(f.auth)
        .set('idempotency-key', randomUUID())
        .send({
          expectedDocumentVersion: collection.version,
          reason: 'Incorrect transfer reference',
        })
        .expect(200)
    ).body as FinanceCustomerDocument;
    expect(reversed).toMatchObject({
      allocatedTotal: '60.0000',
      outstandingTotal: '60.0000',
      creditTotal: '36.0000',
      debitTotal: '36.0000',
    });
    await assertGuardedDowngrade(
      database,
      '0082_collection_corrections',
      'Cannot downgrade collection corrections',
    );
  });

  it('serializes correction issues and payments, and rolls back a failed balance posting with its legal number', async () => {
    const f = await correctionFixture('retry');
    const a = await f.note('credit_note', '2');
    const b = await f.note('credit_note', '1');
    await Promise.all([f.issue(a).expect(200), f.issue(b).expect(200)]);
    let collection = await f.read();
    expect(collection).toMatchObject({
      creditTotal: '36.0000',
      adjustedTotal: '84.0000',
      outstandingTotal: '84.0000',
    });
    expect(collection.corrections).toHaveLength(2);
    const c = await f.note('credit_note', '1');
    const [payment, credit] = await Promise.all([f.pay('60', collection.version), f.issue(c)]);
    expect(credit.status).toBe(200);
    expect([201, 409]).toContain(payment.status);
    collection = await f.read();
    if (payment.status === 409)
      collection = (await f.pay('60', collection.version).expect(201))
        .body as FinanceCustomerDocument;
    expect(collection).toMatchObject({
      creditTotal: '48.0000',
      adjustedTotal: '72.0000',
      allocatedTotal: '60.0000',
      outstandingTotal: '12.0000',
    });
    const retry = await f.note('debit_note', '1');
    const numbering = () =>
      database.query<{ id: string; next_value: string }>(
        'SELECT id,next_value::text FROM finance.official_number_series WHERE legal_entity_id=$1 ORDER BY id',
        [f.input.legalEntityId],
      );
    const numbersBefore = (await numbering()).rows;
    await database.query(
      `CREATE FUNCTION finance.fail_test_correction() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.correction_document_id='${retry.id}'::uuid THEN RAISE EXCEPTION 'test correction unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_test_correction BEFORE INSERT ON finance.collection_corrections FOR EACH ROW EXECUTE FUNCTION finance.fail_test_correction()`,
    );
    try {
      await f.issue(retry).expect(500);
    } finally {
      await database.query(
        'DROP TRIGGER fail_test_correction ON finance.collection_corrections; DROP FUNCTION finance.fail_test_correction()',
      );
    }
    expect(
      (
        await database.query(
          'SELECT status,official_number FROM finance.financial_documents WHERE id=$1',
          [retry.id],
        )
      ).rows[0],
    ).toEqual({ status: 'draft', official_number: null });
    expect((await numbering()).rows).toEqual(numbersBefore);
    expect((await f.read()).outstandingTotal).toBe('12.0000');
    await f.issue(retry).expect(200);
    expect(await f.read()).toMatchObject({
      debitTotal: '12.0000',
      adjustedTotal: '84.0000',
      outstandingTotal: '24.0000',
    });
    expect(
      (
        await database.query(
          "SELECT id FROM integration.outbox_events WHERE event_type='finance.collection.corrected' AND aggregate_id=$1",
          [f.collectionId],
        )
      ).rowCount,
    ).toBe(4);
  });

  it.each(['cash', 'advance', 'offset', 'bank'] as const)(
    'settles only the corrected balance through %s without duplicate allocations',
    async (method) => {
      const f = await correctionFixture(method);
      await f.issue(await f.note('credit_note', '2')).expect(200);
      const before = await f.read();
      let path: string;
      let input: object;
      if (method === 'cash') {
        path = '/api/v1/finance/cash/vouchers';
        input = {
          amount: '96',
          cashRegisterId,
          customerDocumentId: f.collectionId,
          direction: 'receipt',
          operatorId: cashOperatorId,
          purpose: 'Corrected invoice settlement',
          voucherDate: f.today,
        };
      } else if (method === 'advance') {
        const advance = (
          await request(f.server)
            .post('/api/v1/finance/customer-accounts/advances')
            .set(f.auth)
            .set('idempotency-key', randomUUID())
            .send({
              amount: '96',
              customerPartnerId: customerId,
              paymentMethod: 'bank_transfer',
              receivedOn: f.today,
            })
            .expect(201)
        ).body as CustomerAdvance;
        path = `/api/v1/finance/documents/${f.collectionId}/advance-allocations`;
        input = { amount: '96', customerAdvanceId: advance.id };
      } else if (method === 'offset') {
        const supplierInvoiceId = await seedSupplierInvoiceEvidence(
          database,
          f.ownerId,
          customerId,
          warehouseId,
          productId,
          f.today,
          `${runId}-corrected-offset`,
        );
        const payable = (
          await request(f.server)
            .post('/api/v1/finance/supplier-payables')
            .set(f.auth)
            .set('idempotency-key', randomUUID())
            .send({ dueDate: f.today, supplierInvoiceId })
            .expect(201)
        ).body as FinanceSupplierPayable;
        path = '/api/v1/finance/supplier-offsets';
        input = {
          amount: '96',
          customerDocumentId: f.collectionId,
          expectedCustomerDocumentVersion: before.version,
          expectedSupplierPayableVersion: payable.version,
          offsetDate: f.today,
          reason: 'Bilateral corrected invoice settlement',
          supplierPayableId: payable.id,
        };
      } else {
        path = '/api/v1/finance/bank-statements';
        input = {
          accountIban: 'BG76DEMO00000000000000',
          bankName: 'Correction test bank',
          openingBalance: '0',
          closingBalance: '96',
          currencyCode: 'EUR',
          statementDate: f.today,
          statementReference: `CORRECTION-${runId}`,
          lines: [
            {
              amount: '96',
              counterpartyName: 'Correction test customer',
              direction: 'incoming',
              paymentReference: f.original.officialNumber,
              transactionDate: f.today,
              valueDate: f.today,
            },
          ],
        };
      }
      const key = randomUUID();
      const send = () =>
        request(f.server)
          .post(path)
          .set(f.auth)
          .set('idempotency-key', key)
          .send(input)
          .expect(201);
      await send();
      await send();
      const paid = await f.read();
      expect(paid).toMatchObject({
        total: '120.0000',
        creditTotal: '24.0000',
        adjustedTotal: '96.0000',
        allocatedTotal: '96.0000',
        outstandingTotal: '0.0000',
        overpaidTotal: '0.0000',
        paymentStatus: 'paid',
      });
      expect(paid.payments).toHaveLength(1);
    },
  );

  it('issues approved recurring periods once through the scheduler with scoped numbering and collections', async () => {
    const fixture = await recurringFixture('scheduled');
    const { contract, ownerToken, input, context } = fixture;
    const registry = application.get(JobHandlerRegistry);
    await registry.execute(context);
    expect((await fixture.read()).periods[0]).toMatchObject({
      status: 'waiting',
      amount: '50.0000',
    });
    await request(application.getHttpServer())
      .put(`/api/v1/finance/recurring-invoices/${contract.id}`)
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `recurring-denied-${runId}`)
      .send(input)
      .expect(403);
    const saved = (await fixture.save(input, `recurring-save-${runId}`).expect(200))
      .body as RecurringInvoiceContract;
    expect(saved.profile).toMatchObject({
      enabled: true,
      contractVersion: contract.version,
      version: 1,
    });
    expect(
      (
        (await fixture.save(input, `recurring-save-${runId}`).expect(200))
          .body as RecurringInvoiceContract
      ).profile?.version,
    ).toBe(1);
    const execute = (suffix: string) =>
      registry.execute({
        ...context,
        idempotencyKey: `${context.idempotencyKey}:${suffix}`,
        jobId: randomUUID(),
      });
    await Promise.all([execute('a'), execute('b')]);
    const complete = await fixture.read();
    expect(complete.periods).toHaveLength(1);
    expect(complete.periods[0]?.status).toBe('issued');
    expect(complete.periods[0]?.document?.number).toMatch(/^\d{10}$/u);
    const documentId = complete.periods[0]!.document!.id;
    const document = (
      await request(application.getHttpServer())
        .get(`/api/v1/finance/financial-documents/${documentId}`)
        .set('authorization', `Bearer ${ownerToken}`)
        .expect(200)
    ).body as FinancialDocument;
    expect(document).toMatchObject({
      status: 'issued',
      netTotal: '50.0000',
      vatTotal: '10.0000',
      grossTotal: '60.0000',
      sourceSubscriptionDraftId: complete.periods[0]!.id,
      issueDate: fixture.today,
      taxEventDate: fixture.today,
    });
    expect(document.collection?.id).toBeTruthy();
    const collection = (
      await request(application.getHttpServer())
        .get(`/api/v1/finance/documents/${document.collection!.id}`)
        .set('authorization', `Bearer ${ownerToken}`)
        .expect(200)
    ).body as FinanceCustomerDocument;
    expect(collection).toMatchObject({
      total: '60.0000',
      outstandingTotal: '60.0000',
      paymentStatus: 'unpaid',
      financialDocument: { id: documentId },
    });
    expect(collection.dueDate).toBe(
      (
        await database.query<{ date: string }>('SELECT ($1::date+14)::text AS date', [
          fixture.today,
        ])
      ).rows[0]!.date,
    );
    await execute('replay');
    expect(
      (
        await database.query(
          'SELECT id FROM finance.financial_documents WHERE source_subscription_draft_id=$1',
          [complete.periods[0]!.id],
        )
      ).rowCount,
    ).toBe(1);
    await assertGuardedDowngrade(
      database,
      '0080_recurring_invoice_issuance',
      'Cannot downgrade recurring invoicing while approved profiles or issuance history exist',
    );
    const stale = await fixture
      .save({ ...input, expectedVersion: 9 }, `recurring-stale-${runId}`)
      .expect(409);
    expect(stale.body.error.code).toBe('RECURRING_VERSION_CONFLICT');
    await fixture
      .save({ ...input, enabled: false, expectedVersion: 1 }, `recurring-disable-${runId}`)
      .expect(200);
  });

  it('retains failed billing periods, rolls back all invoice effects and recovers on a worker retry', async () => {
    const fixture = await recurringFixture('retry');
    await fixture.save(fixture.input, `recurring-retry-save-${runId}`).expect(200);
    const issue = vi
      .spyOn(application.get(FinancialDocumentsService), 'issue')
      .mockRejectedValueOnce(
        new ApiErrorException('RECURRING_TEST_UNAVAILABLE', 'Temporary test outage.', 503),
      );
    try {
      await expect(application.get(JobHandlerRegistry).execute(fixture.context)).rejects.toThrow(
        'Recurring invoice processing needs a retry',
      );
    } finally {
      issue.mockRestore();
    }
    const pending = await fixture.read();
    expect(pending.periods[0]).toMatchObject({
      status: 'retry',
      errorCode: 'RECURRING_TEST_UNAVAILABLE',
    });
    expect(
      (
        await database.query(
          'SELECT id FROM finance.financial_documents WHERE source_subscription_draft_id=$1',
          [pending.periods[0]!.id],
        )
      ).rowCount,
    ).toBe(0);
    await application.get(JobHandlerRegistry).execute({ ...fixture.context, attemptNumber: 2 });
    const recovered = await fixture.read();
    expect(recovered.periods[0]?.status).toBe('issued');
    expect(
      (
        await database.query<{ attempt_count: number }>(
          'SELECT attempt_count FROM finance.recurring_invoice_runs WHERE billing_draft_id=$1',
          [pending.periods[0]!.id],
        )
      ).rows[0]?.attempt_count,
    ).toBe(2);
    await fixture
      .save(
        { ...fixture.input, enabled: false, expectedVersion: 1 },
        `recurring-retry-disable-${runId}`,
      )
      .expect(200);
  });

  it('requires review after contract or access changes and leaves manually prepared periods untouched', async () => {
    const fixture = await recurringFixture('review');
    await fixture.save(fixture.input, `recurring-review-save-${runId}`).expect(200);
    await application.get(SalesSubscriptionsService).generateDueInvoiceDrafts(fixture.context);
    const draftId = (await fixture.read()).periods[0]!.id;
    const manual = (
      await request(application.getHttpServer())
        .post('/api/v1/finance/financial-documents')
        .set('authorization', `Bearer ${fixture.ownerToken}`)
        .set('idempotency-key', `recurring-manual-${runId}`)
        .send({
          businessLocationId: fixture.input.businessLocationId,
          legalEntityId: fixture.input.legalEntityId,
          customerPartnerId: customerId,
          documentType: 'invoice',
          sourceSubscriptionDraftId: draftId,
          currencyCode: 'EUR',
          issueDate: fixture.today,
          dueDate: fixture.today,
          taxEventDate: fixture.today,
          rateDate: fixture.today,
          exchangeRate: '1',
          rateSource: 'internal_eur',
          lines: [
            {
              description: 'Reviewed charge',
              quantity: '1',
              unitCode: 'SERVICE',
              unitPrice: '50',
              discountPercent: '0',
              vatTreatment: 'standard_20',
            },
          ],
        })
        .expect(201)
    ).body as FinancialDocument;
    const registry = application.get(JobHandlerRegistry);
    await registry.execute(fixture.context);
    expect((await fixture.read()).periods[0]).toMatchObject({
      status: 'manual_review',
      errorCode: 'FINANCE_RECURRING_MANUAL_DRAFT',
      document: { id: manual.id },
    });
    await database.query(
      'UPDATE sales.service_subscription_contracts SET version=version+1 WHERE id=$1',
      [fixture.contract.id],
    );
    await registry.execute({
      ...fixture.context,
      idempotencyKey: `${fixture.context.idempotencyKey}:changed`,
    });
    expect((await fixture.read()).periods[0]?.errorCode).toBe('RECURRING_CONTRACT_CHANGED');
    await fixture
      .save(
        { ...fixture.input, contractVersion: 2, expectedVersion: 1 },
        `recurring-review-renew-${runId}`,
      )
      .expect(200);
    await database.query(
      `DELETE FROM iam.role_permissions selected USING iam.permissions permission,iam.account_roles role
      WHERE selected.permission_id=permission.id AND selected.role_id=role.role_id AND role.account_id=$1 AND permission.module='erp.finance' AND permission.action='edit'`,
      [fixture.ownerId],
    );
    await registry.execute({
      ...fixture.context,
      idempotencyKey: `${fixture.context.idempotencyKey}:revoked`,
    });
    expect((await fixture.read()).periods[0]?.errorCode).toBe('RECURRING_ACCESS_CHANGED');
    const stillDraft = (
      await request(application.getHttpServer())
        .get(`/api/v1/finance/financial-documents/${manual.id}`)
        .set('authorization', `Bearer ${fixture.ownerToken}`)
        .expect(200)
    ).body as FinancialDocument;
    expect(stillDraft.status).toBe('draft');
    expect(stillDraft.officialNumber).toBeUndefined();
  });

  it('stops automatic retries after five failed attempts and lets Finance recover the same period explicitly', async () => {
    const fixture = await recurringFixture('retry-limit');
    await fixture.save(fixture.input, `recurring-limit-save-${runId}`).expect(200);
    const registry = application.get(JobHandlerRegistry);
    const issue = vi
      .spyOn(application.get(FinancialDocumentsService), 'issue')
      .mockRejectedValue(
        new ApiErrorException('RECURRING_TEST_UNAVAILABLE', 'Temporary test outage.', 503),
      );
    try {
      for (let attempt = 1; attempt <= 5; attempt++) {
        const run = registry.execute({ ...fixture.context, attemptNumber: attempt });
        if (attempt < 5)
          await expect(run).rejects.toThrow('Recurring invoice processing needs a retry');
        else await expect(run).resolves.toMatchObject({ reviewCount: 1, retryCount: 0 });
      }
      await registry.execute({
        ...fixture.context,
        idempotencyKey: `${fixture.context.idempotencyKey}:next-day`,
      });
      expect(issue).toHaveBeenCalledTimes(5);
      expect((await fixture.read()).periods[0]).toMatchObject({
        status: 'needs_review',
        errorCode: 'RECURRING_TEST_UNAVAILABLE',
      });
    } finally {
      issue.mockRestore();
    }
    const run = () =>
      request(application.getHttpServer())
        .post(`/api/v1/finance/recurring-invoices/${fixture.contract.id}/run`)
        .set('authorization', `Bearer ${fixture.ownerToken}`)
        .set('idempotency-key', `recurring-limit-recover-${runId}`)
        .send();
    const recovered = await run().expect(200);
    expect(recovered.body).toMatchObject({ issuedCount: 1, retryCount: 0 });
    expect((await run().expect(200)).body).toEqual(recovered.body);
    const period = (await fixture.read()).periods[0]!;
    expect(period.status).toBe('issued');
    expect(
      (
        await database.query(
          'SELECT id FROM finance.financial_documents WHERE source_subscription_draft_id=$1',
          [period.id],
        )
      ).rowCount,
    ).toBe(1);
    await fixture
      .save(
        { ...fixture.input, enabled: false, expectedVersion: 1 },
        `recurring-limit-disable-${runId}`,
      )
      .expect(200);
    // An acknowledged request can be replayed after settings change without generating new source periods.
    expect((await run().expect(200)).body).toEqual(recovered.body);
  });

  it('keeps an earlier period manual when a newly approved contract has a different billing cycle', async () => {
    const fixture = await recurringFixture('cycle-change');
    await fixture.save(fixture.input, `recurring-cycle-save-${runId}`).expect(200);
    await application.get(SalesSubscriptionsService).generateDueInvoiceDrafts(fixture.context);
    await database.query(
      'UPDATE sales.service_subscription_contracts SET billing_frequency_months=billing_frequency_months+1,version=version+1 WHERE id=$1',
      [fixture.contract.id],
    );
    await fixture
      .save(
        { ...fixture.input, contractVersion: 2, expectedVersion: 1 },
        `recurring-cycle-renew-${runId}`,
      )
      .expect(200);
    await application.get(JobHandlerRegistry).execute(fixture.context);
    const period = (await fixture.read()).periods[0]!;
    expect(period).toMatchObject({
      status: 'needs_review',
      errorCode: 'RECURRING_BILLING_CHANGED',
    });
    expect(
      (
        await database.query(
          'SELECT id FROM finance.financial_documents WHERE source_subscription_draft_id=$1',
          [period.id],
        )
      ).rowCount,
    ).toBe(0);
  });

  it('secures company images, freezes issued branding and retries the same emailed PDF after settings change', async () => {
    const fixture = await recurringFixture('branding');
    const server = application.getHttpServer() as Parameters<typeof request>[0];
    const auth = { authorization: `Bearer ${fixture.ownerToken}` };
    const companyId = fixture.input.legalEntityId;
    const endpoint = `/api/v1/finance/document-branding/${companyId}`;
    expect((await request(server).get(endpoint).set(auth).expect(200)).body).toMatchObject({
      version: 0,
      legalEntityId: companyId,
    });
    await request(server).get(endpoint).set('authorization', `Bearer ${token}`).expect(200);
    await request(server)
      .put(endpoint)
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `branding-denied-${runId}`)
      .send({ expectedVersion: 0 })
      .expect(403);
    await request(server).put(endpoint).set(auth).send({ expectedVersion: 0 }).expect(400);
    const brandingPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQt9D/DwACZgF+JMBukQAAAABJRU5ErkJggg==',
      'base64',
    );
    const upload = (name: string, parentId = companyId, bytes = brandingPng) =>
      request(server)
        .post('/api/v1/files')
        .set(auth)
        .set('idempotency-key', `branding-upload-${name}-${runId}`)
        .field('parentType', 'financial_branding')
        .field('parentId', parentId)
        .attach('file', bytes, { filename: `${name}.png`, contentType: 'image/png' });
    const logo = (await upload('logo').expect(201)).body as ManagedFile;
    const signature = (await upload('signature').expect(201)).body as ManagedFile;
    const invalidImage = await upload('invalid', companyId, Buffer.from('not a PNG')).expect(400);
    expect(invalidImage.body.error.code).toBe('FILE_CONTENT_TYPE_MISMATCH');
    const saveBody = {
      expectedVersion: 0,
      logoFileId: logo.id,
      signatureFileId: signature.id,
      signatoryName: 'QA sample signer',
      signatureConfirmed: true,
    };
    await request(server)
      .put(endpoint)
      .set(auth)
      .set('idempotency-key', `branding-unconfirmed-${runId}`)
      .send({ ...saveBody, signatureConfirmed: false })
      .expect(400);
    const saveKey = `branding-save-${runId}`;
    const saved = (
      await request(server)
        .put(endpoint)
        .set(auth)
        .set('idempotency-key', saveKey)
        .send(saveBody)
        .expect(200)
    ).body as FinancialBrandingSettings;
    expect(saved).toMatchObject({
      version: 1,
      logo: { id: logo.id, checksumSha256: logo.checksumSha256 },
      signature: { id: signature.id },
      signatoryName: 'QA sample signer',
    });
    expect(
      (
        await request(server)
          .put(endpoint)
          .set(auth)
          .set('idempotency-key', saveKey)
          .send(saveBody)
          .expect(200)
      ).body,
    ).toEqual(saved);
    const stale = await request(server)
      .put(endpoint)
      .set(auth)
      .set('idempotency-key', `branding-stale-${runId}`)
      .send(saveBody)
      .expect(409);
    expect(stale.body.error.code).toBe('FINANCE_BRANDING_VERSION_CONFLICT');
    const anotherCompany = randomUUID();
    await database.query(
      'INSERT INTO organization.legal_entities (id,code,name,created_by,updated_by) VALUES ($1,$2,$3,$4,$4)',
      [anotherCompany, `BRAND-${runId.slice(0, 20)}`, 'Other branding company', fixture.ownerId],
    );
    const wrongParent = await request(server)
      .put(`/api/v1/finance/document-branding/${anotherCompany}`)
      .set(auth)
      .set('idempotency-key', `branding-wrong-parent-${runId}`)
      .send({ expectedVersion: 0, logoFileId: logo.id })
      .expect(400);
    expect(wrongParent.body.error.code).toBe('FINANCE_BRANDING_FILE_INVALID');

    const refs = (
      await request(server)
        .get('/api/v1/finance/financial-documents/reference-data')
        .set(auth)
        .expect(200)
    ).body as FinancialDocumentReferenceData;
    const unitCode = refs.products.find((item) => item.id === productId)!.unitCode;
    const draftInput = {
      businessLocationId: fixture.input.businessLocationId,
      legalEntityId: companyId,
      customerPartnerId: customerId,
      documentType: 'invoice',
      issueDate: fixture.today,
      taxEventDate: fixture.today,
      dueDate: fixture.today,
      currencyCode: 'EUR',
      rateDate: fixture.today,
      rateSource: 'internal_eur',
      exchangeRate: '1',
      lines: [
        {
          description: 'Branding test / Проверка на оформлението',
          productId,
          unitCode,
          quantity: '1',
          unitPrice: '50',
          discountPercent: '0',
          vatTreatment: 'standard_20',
        },
      ],
    };
    const draft = (
      await request(server)
        .post('/api/v1/finance/financial-documents')
        .set(auth)
        .set('idempotency-key', `branding-draft-${runId}`)
        .send(draftInput)
        .expect(201)
    ).body as FinancialDocument;
    expect(draft.branding).toEqual({
      version: 1,
      logo: saved.logo,
      signature: saved.signature,
      signatoryName: saved.signatoryName,
    });
    const draftPdf = await request(server)
      .get(`/api/v1/finance/financial-documents/${draft.id}/pdf`)
      .set(auth)
      .expect(200);
    const draftBytes = draftPdf.body as Buffer;
    expect(draftBytes.subarray(0, 4).toString()).toBe('%PDF');
    const staleIssue = await request(server)
      .post(`/api/v1/finance/financial-documents/${draft.id}/issue`)
      .set(auth)
      .set('idempotency-key', `branding-issue-stale-${runId}`)
      .send({ expectedVersion: 1, expectedBrandingVersion: 0 })
      .expect(409);
    expect(staleIssue.body.error.code).toBe('FINANCE_BRANDING_VERSION_CONFLICT');
    const issued = (
      await request(server)
        .post(`/api/v1/finance/financial-documents/${draft.id}/issue`)
        .set(auth)
        .set('idempotency-key', `branding-issue-${runId}`)
        .send({ expectedVersion: 1, expectedBrandingVersion: 1 })
        .expect(200)
    ).body as FinancialDocument;
    expect(issued.branding).toEqual(draft.branding);
    const issuedPdf = await request(server)
      .get(`/api/v1/finance/financial-documents/${draft.id}/pdf`)
      .set(auth)
      .expect(200);
    const issuedBytes = issuedPdf.body as Buffer;
    expect(
      (issuedBytes.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length,
    ).toBeGreaterThan((draftBytes.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length);
    await expect(
      database.query(
        "UPDATE finance.financial_documents SET branding_snapshot='{}'::jsonb WHERE id=$1",
        [draft.id],
      ),
    ).rejects.toThrow('Issued document branding cannot be changed');

    await fixture.save(fixture.input, `branding-recurring-profile-${runId}`).expect(200);
    await application.get(JobHandlerRegistry).execute(fixture.context);
    const recurringId = (await fixture.read()).periods[0]!.document!.id;
    const recurringDocument = (
      await request(server)
        .get(`/api/v1/finance/financial-documents/${recurringId}`)
        .set(auth)
        .expect(200)
    ).body as FinancialDocument;
    expect(recurringDocument.branding).toEqual(issued.branding);
    const proformaDraft = (
      await request(server)
        .post('/api/v1/finance/financial-documents')
        .set(auth)
        .set('idempotency-key', `branding-proforma-${runId}`)
        .send({ ...draftInput, documentType: 'proforma' })
        .expect(201)
    ).body as FinancialDocument;
    const proforma = (
      await request(server)
        .post(`/api/v1/finance/financial-documents/${proformaDraft.id}/issue`)
        .set(auth)
        .set('idempotency-key', `branding-proforma-issue-${runId}`)
        .send({ expectedVersion: 1, expectedBrandingVersion: 1 })
        .expect(200)
    ).body as FinancialDocument;
    const collection = (
      await request(server)
        .get(`/api/v1/finance/documents/${proforma.collection!.id}`)
        .set(auth)
        .expect(200)
    ).body as FinanceCustomerDocument;
    await request(server)
      .post(`/api/v1/finance/documents/${collection.id}/payments`)
      .set(auth)
      .set('idempotency-key', `branding-proforma-payment-${runId}`)
      .send({
        amount: '60',
        paymentMethod: 'bank_transfer',
        paymentDate: fixture.today,
      })
      .expect(201);
    const paidProforma = (
      await request(server)
        .get(`/api/v1/finance/financial-documents/${proforma.id}`)
        .set(auth)
        .expect(200)
    ).body as FinancialDocument;
    const converted = (
      await request(server)
        .get(`/api/v1/finance/financial-documents/${paidProforma.convertedToDocumentId!}`)
        .set(auth)
        .expect(200)
    ).body as FinancialDocument;
    expect(converted.branding).toEqual(issued.branding);

    const recipient = `branding-${runId}@example.invalid`;
    const emailKey = `branding-email-${runId}`;
    const emailBody = { expectedVersion: issued.version, recipientEmail: recipient };
    await request(server)
      .post(`/api/v1/finance/financial-documents/${draft.id}/email`)
      .set(auth)
      .set('idempotency-key', emailKey)
      .send(emailBody)
      .expect(202);
    const mail = (
      await database.query<{ id: string; payload: { attachment: { contentBase64: string } } }>(
        "SELECT id,payload FROM notifications.messages WHERE channel='email' AND payload->>'to'=$1",
        [recipient],
      )
    ).rows[0]!;
    const queuedBytes = Buffer.from(mail.payload.attachment.contentBase64, 'base64');
    expect(
      (queuedBytes.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length,
    ).toBeGreaterThan(1);
    // A quarantined asset must not prevent Finance from opening settings to remove its binding.
    await database.query("UPDATE files.objects SET status='quarantined' WHERE id=$1", [logo.id]);
    await request(server).get(endpoint).set(auth).expect(200);
    await request(server)
      .put(endpoint)
      .set(auth)
      .set('idempotency-key', `branding-clear-${runId}`)
      .send({ expectedVersion: 1 })
      .expect(200);
    await database.query("UPDATE files.objects SET status='available' WHERE id=$1", [logo.id]);
    const afterChange = (
      await request(server)
        .get(`/api/v1/finance/financial-documents/${draft.id}`)
        .set(auth)
        .expect(200)
    ).body as FinancialDocument;
    expect(afterChange.branding).toEqual(issued.branding);
    const newDraft = (
      await request(server)
        .post('/api/v1/finance/financial-documents')
        .set(auth)
        .set('idempotency-key', `branding-unbranded-${runId}`)
        .send(draftInput)
        .expect(201)
    ).body as FinancialDocument;
    expect(newDraft.branding).toEqual({ version: 2 });
    // Idempotent replay does not render with changed settings or enqueue a second email.
    await request(server)
      .post(`/api/v1/finance/financial-documents/${draft.id}/email`)
      .set(auth)
      .set('idempotency-key', emailKey)
      .send(emailBody)
      .expect(202);
    failNextEmailDelivery = true;
    const dispatcher = application.get(NotificationDispatcherService);
    await expect(dispatcher.dispatch(mail.id, true)).rejects.toThrow('Temporary SMTP outage');
    const deliveredBefore = deliveredEmails.length;
    await dispatcher.dispatch(mail.id, true);
    await dispatcher.dispatch(mail.id, true);
    expect(deliveredEmails).toHaveLength(deliveredBefore + 1);
    expect(deliveredEmails.at(-1)?.attachment?.content).toEqual(queuedBytes);
    // Storage corruption must never silently remove a required saved image.
    const key = (
      await database.query<{ storage_key: string }>(
        'SELECT storage_key FROM files.objects WHERE id=$1',
        [logo.id],
      )
    ).rows[0]!.storage_key;
    const original = storedObjects.get(key)!;
    storedObjects.set(key, Buffer.from('tampered'));
    try {
      await request(server)
        .get(`/api/v1/finance/financial-documents/${draft.id}/pdf`)
        .set(auth)
        .expect(503);
    } finally {
      storedObjects.set(key, original);
    }
    await request(server)
      .get(`/api/v1/finance/financial-documents/${draft.id}/pdf`)
      .set(auth)
      .expect(200);
    await assertGuardedDowngrade(
      database,
      '0081_financial_document_branding',
      'Cannot downgrade document branding while settings, assets or document snapshots exist',
    );
  }, 15_000);

  it('creates the supplier payable from the supplier invoice rate snapshot', async () => {
    if (!foreignSupplierInvoiceId)
      throw new Error('The foreign-currency supplier invoice was not created earlier');
    const response = await request(application.getHttpServer())
      .post('/api/v1/finance/supplier-payables')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', `foreign-supplier-payable-${runId}`)
      .send({ dueDate: '2099-09-10', supplierInvoiceId: foreignSupplierInvoiceId })
      .expect(201);
    expect(response.body as FinanceSupplierPayable).toMatchObject({
      currencyCode: 'USD',
      eurTotal: '22.0800',
      exchangeRate: '0.92000000',
      rateDate: '2099-09-03',
      rateSource: 'BNB',
      total: '24.0000',
    });
  });
});

async function assertGuardedDowngrade(pool: Pool, migration: string, message: string) {
  const sql = await readFile(
    new URL(`../src/database/migrations/${migration}.down.sql`, import.meta.url),
    'utf8',
  );
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await expect(client.query(sql)).rejects.toThrow(message);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

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
  actions: Array<'approve' | 'create' | 'edit' | 'view'>,
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
  actions: Array<'approve' | 'create' | 'edit' | 'view'>,
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
  return roleId;
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
  actions: Array<'create' | 'delete' | 'edit' | 'view'>,
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

async function grantProcurementPermissions(
  pool: Pool,
  accountId: string,
  actions: Array<'create' | 'edit' | 'view'>,
) {
  const roleId = randomUUID();
  await pool.query('INSERT INTO iam.roles (id, code, name) VALUES ($1, $2, $3)', [
    roleId,
    `procurement-${randomUUID()}`,
    'Procurement trace test role',
  ]);
  for (const action of actions) {
    const permission = await pool.query<{ id: string }>(
      `INSERT INTO iam.permissions (id, module, action) VALUES ($1, 'erp.procurement', $2)
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
  currencyCode = 'EUR',
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
     ) VALUES ($1, $2, $3, $4, 'received', $5, $5)`,
    [purchaseOrderId, supplierPartnerId, warehouseId, currencyCode, actorId],
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
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      supplierInvoiceId,
      purchaseOrderId,
      supplierPartnerId,
      `SUP-${runId}`,
      invoiceDate,
      currencyCode,
      actorId,
    ],
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
  const supplierId = randomUUID();
  const warehouseId = randomUUID();
  const ordinaryCategoryId = randomUUID();
  const serialCategoryId = randomUUID();
  const unitId = randomUUID();
  const productId = randomUUID();
  const serialProductId = randomUUID();
  const serialNumber = `VISTA-SALE-${runId}`.toUpperCase();
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
    `INSERT INTO master_data.partner_contacts (
       partner_id, display_name, email, contact_role
     ) VALUES ($1, 'Sales test contact', $2, 'accountant')`,
    [customerId, `client-${runId}@example.test`],
  );
  await pool.query(
    `INSERT INTO master_data.partners (id, kind, display_name, created_by, updated_by)
     VALUES ($1, 'legal_entity', $2, $3, $3)`,
    [supplierId, `Trace Supplier ${runId}`, actorId],
  );
  await pool.query(
    "INSERT INTO master_data.partner_roles (partner_id, role, assigned_by) VALUES ($1, 'supplier', $2)",
    [supplierId, actorId],
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
  await pool.query(
    `INSERT INTO inventory.stock_movements (id, warehouse_id, product_id, movement_type, quantity, reference_type, reference_id, actor_account_id, correlation_id, unit_cost_eur)
     VALUES ($1, $2, $3, 'receipt', 10, 'sales_test_seed', $4, $5, $6, 8)`,
    [ordinaryMovement, warehouseId, productId, `ordinary-${runId}`, actorId, randomUUID()],
  );
  await pool.query(
    `INSERT INTO inventory.stock_balances (warehouse_id, product_id, quantity, average_unit_cost_eur)
     VALUES ($1, $2, 10, 8)`,
    [warehouseId, productId],
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
    supplierId,
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
       actor_account_id, correlation_id, unit_cost_eur
     ) VALUES ($1, $2, $3, 'receipt', 5, 'service_test_seed', $4, $5, $6, 7)`,
    [movementId, warehouseId, productId, `technician-${runId}`, accountId, randomUUID()],
  );
  await pool.query(
    `INSERT INTO inventory.stock_balances (warehouse_id, product_id, quantity, average_unit_cost_eur)
     VALUES ($1, $2, 5, 7)`,
    [warehouseId, productId],
  );
  return {
    cashOperatorId: operatorId,
    cashRegisterId,
    technicianWarehouseId: warehouseId,
  };
}

async function seedServiceBatchPart(
  pool: Pool,
  accountId: string,
  warehouseId: string,
  runId: string,
) {
  const categoryId = randomUUID();
  const productId = randomUUID();
  const batchId = randomUUID();
  const movementId = randomUUID();
  const batchNumber = `SERVICE-LOT-${runId.slice(0, 8).toUpperCase()}`;
  const unit = await pool.query<{ id: string }>(
    'SELECT id FROM master_data.units ORDER BY id LIMIT 1',
  );
  const unitId = unit.rows[0]?.id;
  if (!unitId) throw new Error('A unit is required to seed a Service batch part.');

  await pool.query(
    `INSERT INTO master_data.product_categories (
       id, name, tracking_mode, requires_expiry, created_by, updated_by
     ) VALUES ($1, $2, 'batch', false, $3, $3)`,
    [categoryId, `Service batch parts ${runId.slice(0, 8)}`, accountId],
  );
  await pool.query(
    `INSERT INTO master_data.products (
       id, product_code, name, category_id, unit_id, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [
      productId,
      `SVC-BATCH-${runId.slice(0, 8).toUpperCase()}`,
      'Service batch part',
      categoryId,
      unitId,
      accountId,
    ],
  );
  await pool.query(
    'INSERT INTO inventory.batches (id, product_id, batch_number, expires_at) VALUES ($1, $2, $3, $4)',
    [batchId, productId, batchNumber, '2099-01-31'],
  );
  await pool.query(
    `INSERT INTO inventory.stock_movements (
       id, warehouse_id, product_id, movement_type, quantity, reference_type, reference_id,
       actor_account_id, correlation_id, unit_cost_eur, batch_id
     ) VALUES ($1, $2, $3, 'receipt', 5, 'service_batch_test_seed', $4, $5, $6, 7, $7)`,
    [movementId, warehouseId, productId, `batch-${runId}`, accountId, randomUUID(), batchId],
  );
  await pool.query(
    `INSERT INTO inventory.stock_balances (warehouse_id, product_id, quantity, average_unit_cost_eur)
     VALUES ($1, $2, 5, 7)`,
    [warehouseId, productId],
  );
  await pool.query(
    `INSERT INTO inventory.batch_stock_balances (warehouse_id, batch_id, quantity)
     VALUES ($1, $2, 5)`,
    [warehouseId, batchId],
  );
  return { batchId, batchNumber, productId };
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
