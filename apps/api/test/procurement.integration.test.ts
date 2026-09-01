import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AppEnvironment } from '@vista/config';
import type {
  GoodsReceipt,
  ProcurementReferenceData,
  ProcurementSupplierRecord,
  PurchaseOrder,
  SupplierClaim,
  SupplierInvoice,
} from '@vista/contracts';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PasswordService } from '../src/auth/password.service.js';
import { configureHttpApplication } from '../src/common/http-application.js';
import { APP_ENVIRONMENT } from '../src/config/config.module.js';
import { fixtureId } from '../src/database/development-fixtures.js';
import { migrateDown, migrateUp } from '../src/database/migration-runner.js';

const runInfrastructureTests = process.env['RUN_INFRASTRUCTURE_TESTS'] === 'true';
const password = 'Vista-Procurement-Test-7!';

describe.skipIf(!runInfrastructureTests)('purchase order to warehouse receipt', () => {
  let adminDatabase: Pool;
  let application: INestApplication;
  let creatorToken: string;
  let database: Pool;
  let databaseName: string;
  let supplierId: string;
  let warehouseId: string;
  let ordinaryProductId: string;
  let serialProductId: string;
  let viewerToken: string;
  const runId = randomUUID().replaceAll('-', '');

  beforeAll(async () => {
    const sourceDatabaseUrl = process.env['DATABASE_URL'];
    const sourceRedisUrl = process.env['REDIS_URL'];
    if (!sourceDatabaseUrl || !sourceRedisUrl) {
      throw new Error('DATABASE_URL and REDIS_URL are required for procurement integration tests');
    }
    adminDatabase = new Pool({ connectionString: sourceDatabaseUrl, max: 1 });
    databaseName = `vista_procurement_test_${randomUUID().replaceAll('-', '')}`;
    assertTemporaryDatabaseName(databaseName);
    await adminDatabase.query(`CREATE DATABASE ${databaseName}`);
    const isolatedDatabaseUrl = new URL(sourceDatabaseUrl);
    isolatedDatabaseUrl.pathname = `/${databaseName}`;
    const isolatedRedisUrl = new URL(sourceRedisUrl);
    isolatedRedisUrl.pathname = '/11';
    database = new Pool({ connectionString: isolatedDatabaseUrl.toString(), max: 3 });
    const migrationDirectory = fileURLToPath(
      new URL('../src/database/migrations', import.meta.url),
    );
    await migrateUp(database, migrationDirectory);
    const laterMigrationsRolledBack: string[] = [];
    let salesRolledBack = await migrateDown(database, migrationDirectory);
    while (salesRolledBack && salesRolledBack !== '0026_sales_workflow_foundation') {
      laterMigrationsRolledBack.push(salesRolledBack);
      salesRolledBack = await migrateDown(database, migrationDirectory);
    }
    if (salesRolledBack !== '0026_sales_workflow_foundation')
      throw new Error(`Expected migration 0026 rollback, received ${salesRolledBack ?? 'none'}`);
    if (!laterMigrationsRolledBack.includes('0046_serial_lifecycle_traceability'))
      throw new Error('The serial lifecycle migration was not exercised during rollback');
    const rolledBack = await migrateDown(database, migrationDirectory);
    if (rolledBack !== '0025_procurement_supplier_controls')
      throw new Error(`Expected migration 0025 rollback, received ${rolledBack ?? 'none'}`);
    const reapplied = await migrateUp(database, migrationDirectory);
    if (
      !reapplied.includes('0025_procurement_supplier_controls') ||
      !reapplied.includes('0026_sales_workflow_foundation') ||
      !reapplied.includes('0046_serial_lifecycle_traceability')
    )
      throw new Error('Migrations 0025 and 0026 could not be reapplied');

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
    const creatorId = await createAccount(
      database,
      `procurement-creator-${runId}@example.invalid`,
      passwordHash,
    );
    const viewerId = await createAccount(
      database,
      `procurement-viewer-${runId}@example.invalid`,
      passwordHash,
    );
    await grantPermissions(database, creatorId, ['view', 'create', 'edit']);
    await grantPermissions(database, viewerId, ['view']);
    ({ ordinaryProductId, serialProductId, supplierId, warehouseId } = await seedMasterData(
      database,
      creatorId,
      runId,
    ));
    creatorToken = await login(application, `procurement-creator-${runId}@example.invalid`);
    viewerToken = await login(application, `procurement-viewer-${runId}@example.invalid`);
  }, 30_000);

  afterAll(async () => {
    if (application) {
      await application.close();
    }
    if (database) await database.end();
    if (adminDatabase && databaseName) {
      assertTemporaryDatabaseName(databaseName);
      await adminDatabase.query(`DROP DATABASE IF EXISTS ${databaseName}`);
      await adminDatabase.end();
    }
  });

  it('protects procurement commands while exposing ERP-owned reference data', async () => {
    await request(application.getHttpServer())
      .get('/api/v1/procurement/reference-data')
      .expect(401);
    const references = await request(application.getHttpServer())
      .get('/api/v1/procurement/reference-data')
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    const body = references.body as ProcurementReferenceData;
    expect(body.suppliers).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: supplierId })]),
    );
    expect(body.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: serialProductId, trackingMode: 'serial' }),
      ]),
    );
    await request(application.getHttpServer())
      .post('/api/v1/procurement/purchase-orders')
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `viewer-denied-${runId}`)
      .send(orderInput())
      .expect(403);
  });

  it('creates an idempotent order, receives it in stages, and writes inventory once', async () => {
    const createKey = `purchase-order-${runId}`;
    const createdResponse = await request(application.getHttpServer())
      .post('/api/v1/procurement/purchase-orders')
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', createKey)
      .send(orderInput())
      .expect(201);
    const created = createdResponse.body as PurchaseOrder;
    expect(created).toMatchObject({
      currencyCode: 'BGN',
      status: 'open',
      supplierPartnerId: supplierId,
      warehouseId,
    });
    expect(created.lines).toHaveLength(2);
    const replay = await request(application.getHttpServer())
      .post('/api/v1/procurement/purchase-orders')
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', createKey)
      .send(orderInput())
      .expect(201);
    expect((replay.body as PurchaseOrder).id).toBe(created.id);

    const ordinaryLine = required(
      created.lines.find((line) => line.productId === ordinaryProductId),
      'Ordinary product order line was not returned',
    );
    const serialLine = required(
      created.lines.find((line) => line.productId === serialProductId),
      'Serial product order line was not returned',
    );
    const firstReceiptInput = {
      lines: [{ orderLineId: ordinaryLine.id, quantity: '2' }],
      supplierDeliveryReference: `DEL-${runId.slice(0, 8)}-1`,
    };
    const firstReceiptKey = `goods-receipt-1-${runId}`;
    const firstReceiptResponse = await request(application.getHttpServer())
      .post(`/api/v1/procurement/purchase-orders/${created.id}/receipts`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', firstReceiptKey)
      .send(firstReceiptInput)
      .expect(201);
    const firstReceipt = firstReceiptResponse.body as GoodsReceipt;
    expect(firstReceipt.lines[0]).toMatchObject({
      productId: ordinaryProductId,
      quantity: '2.0000',
      unitCostBgn: '10.0000',
    });
    const receiptReplay = await request(application.getHttpServer())
      .post(`/api/v1/procurement/purchase-orders/${created.id}/receipts`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', firstReceiptKey)
      .send(firstReceiptInput)
      .expect(201);
    expect((receiptReplay.body as GoodsReceipt).id).toBe(firstReceipt.id);

    const partial = await request(application.getHttpServer())
      .get(`/api/v1/procurement/purchase-orders/${created.id}`)
      .set('authorization', `Bearer ${creatorToken}`)
      .expect(200);
    expect(partial.body).toMatchObject({ status: 'partially_received' });
    expect(
      (partial.body as PurchaseOrder).lines.find((line) => line.id === ordinaryLine.id),
    ).toMatchObject({ deliveredQuantity: '2.0000', invoicedQuantity: '0.0000' });

    await request(application.getHttpServer())
      .post(`/api/v1/procurement/purchase-orders/${created.id}/receipts`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `over-receipt-${runId}`)
      .send({ lines: [{ orderLineId: ordinaryLine.id, quantity: '4' }] })
      .expect(409);

    await request(application.getHttpServer())
      .post(`/api/v1/procurement/purchase-orders/${created.id}/receipts`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `goods-receipt-2-${runId}`)
      .send({
        lines: [
          { orderLineId: ordinaryLine.id, quantity: '3' },
          {
            orderLineId: serialLine.id,
            quantity: '1',
            serialNumbers: [`VISTA-PROC-${runId}`],
          },
        ],
        supplierDeliveryReference: `DEL-${runId.slice(0, 8)}-2`,
      })
      .expect(201);

    const completedResponse = await request(application.getHttpServer())
      .get(`/api/v1/procurement/purchase-orders/${created.id}`)
      .set('authorization', `Bearer ${creatorToken}`)
      .expect(200);
    const completed = completedResponse.body as PurchaseOrder;
    expect(completed.status).toBe('received');
    expect(completed.receipts).toHaveLength(2);
    expect(completed.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          deliveredQuantity: '5.0000',
          invoicedQuantity: '0.0000',
          productId: ordinaryProductId,
        }),
        expect.objectContaining({ deliveredQuantity: '1.0000', productId: serialProductId }),
      ]),
    );
    const list = await request(application.getHttpServer())
      .get('/api/v1/procurement/purchase-orders?status=received')
      .set('authorization', `Bearer ${creatorToken}`)
      .expect(200);
    expect(list.body).toMatchObject({ page: 1, total: 1, totalPages: 1 });

    const balances = await database.query<{
      product_id: string;
      quantity: string;
    }>(
      `SELECT product_id, quantity::text FROM inventory.stock_balances
       WHERE warehouse_id = $1 ORDER BY product_id`,
      [warehouseId],
    );
    expect(balances.rows).toEqual(
      expect.arrayContaining([
        { product_id: ordinaryProductId, quantity: '5.0000' },
        { product_id: serialProductId, quantity: '1.0000' },
      ]),
    );
    const evidence = await database.query<{
      audit_count: string;
      movement_count: string;
      order_count: string;
      receipt_count: string;
      receipt_line_count: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM procurement.purchase_orders) AS order_count,
         (SELECT count(*)::text FROM procurement.goods_receipts) AS receipt_count,
         (SELECT count(*)::text FROM procurement.goods_receipt_lines) AS receipt_line_count,
         (SELECT count(*)::text FROM inventory.stock_movements
          WHERE reference_type = 'purchase_order_receipt') AS movement_count,
         (SELECT count(*)::text FROM audit.events
          WHERE action IN ('procurement.purchase_order.created', 'procurement.goods.received')) AS audit_count`,
    );
    expect(evidence.rows[0]).toEqual({
      audit_count: '3',
      movement_count: '3',
      order_count: '1',
      receipt_count: '2',
      receipt_line_count: '3',
    });

    const duplicateOrderResponse = await request(application.getHttpServer())
      .post('/api/v1/procurement/purchase-orders')
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `duplicate-serial-order-${runId}`)
      .send({
        currencyCode: 'BGN',
        lines: [
          {
            expectedDeliveryDate: '2099-08-29',
            productId: serialProductId,
            quantity: '1',
            unitPrice: '250',
          },
        ],
        supplierPartnerId: supplierId,
        warehouseId,
      })
      .expect(201);
    const duplicateOrder = duplicateOrderResponse.body as PurchaseOrder;
    const duplicateOrderLine = required(
      duplicateOrder.lines[0],
      'Duplicate-serial order line was not returned',
    );
    const duplicateSerial = `VISTA-PROC-${runId}`;
    const duplicateReceipt = await request(application.getHttpServer())
      .post(`/api/v1/procurement/purchase-orders/${duplicateOrder.id}/receipts`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `duplicate-serial-receipt-${runId}`)
      .send({
        lines: [
          {
            orderLineId: duplicateOrderLine.id,
            quantity: '1',
            serialNumbers: [duplicateSerial],
          },
        ],
      })
      .expect(409);
    expect(duplicateReceipt.body).toMatchObject({
      error: {
        code: 'SERIAL_NUMBER_ALREADY_REGISTERED',
        details: [
          {
            field: 'serialNumbers',
            message: `${duplicateSerial.toUpperCase()} is already registered`,
          },
        ],
      },
    });
    expect(duplicateReceipt.body.error.message).toContain(duplicateSerial.toUpperCase());
    const unchangedOrder = await request(application.getHttpServer())
      .get(`/api/v1/procurement/purchase-orders/${duplicateOrder.id}`)
      .set('authorization', `Bearer ${creatorToken}`)
      .expect(200);
    expect(unchangedOrder.body).toMatchObject({ status: 'open' });
    expect((unchangedOrder.body as PurchaseOrder).lines[0]).toMatchObject({
      deliveredQuantity: '0.0000',
    });
  });

  it('maintains supplier terms and evaluations, matches invoices, and tracks claims', async () => {
    const supplierList = await request(application.getHttpServer())
      .get('/api/v1/procurement/suppliers')
      .set('authorization', `Bearer ${creatorToken}`)
      .expect(200);
    const initialSupplier = required(
      (supplierList.body as ProcurementSupplierRecord[]).find(
        (supplier) => supplier.profile.supplierPartnerId === supplierId,
      ),
      'Supplier record was not returned',
    );
    expect(initialSupplier.profile).toMatchObject({ version: 0 });

    await request(application.getHttpServer())
      .put(`/api/v1/procurement/suppliers/${supplierId}/commercial-profile`)
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `supplier-terms-denied-${runId}`)
      .send({ deliveryTerms: 'DAP warehouse', expectedVersion: 0, paymentTermsDays: 30 })
      .expect(403);
    const termsKey = `supplier-terms-${runId}`;
    const terms = await request(application.getHttpServer())
      .put(`/api/v1/procurement/suppliers/${supplierId}/commercial-profile`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', termsKey)
      .send({ deliveryTerms: 'DAP warehouse', expectedVersion: 0, paymentTermsDays: 30 })
      .expect(200);
    expect(terms.body).toMatchObject({
      deliveryTerms: 'DAP warehouse',
      paymentTermsDays: 30,
      version: 1,
    });
    const termsReplay = await request(application.getHttpServer())
      .put(`/api/v1/procurement/suppliers/${supplierId}/commercial-profile`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', termsKey)
      .send({ deliveryTerms: 'DAP warehouse', expectedVersion: 0, paymentTermsDays: 30 })
      .expect(200);
    expect(termsReplay.body).toEqual(terms.body);

    await request(application.getHttpServer())
      .post(`/api/v1/procurement/suppliers/${supplierId}/evaluations`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `supplier-evaluation-${runId}`)
      .send({ notes: 'Delivery and documentation met expectations.', score: 4 })
      .expect(201);

    const orderResponse = await request(application.getHttpServer())
      .post('/api/v1/procurement/purchase-orders')
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `matched-order-${runId}`)
      .send({
        currencyCode: 'BGN',
        lines: [
          {
            expectedDeliveryDate: '2099-09-01',
            productId: ordinaryProductId,
            quantity: '2',
            unitPrice: '12',
          },
        ],
        supplierPartnerId: supplierId,
        warehouseId,
      })
      .expect(201);
    const order = orderResponse.body as PurchaseOrder;
    const orderLine = required(order.lines[0], 'Matched order line was not returned');
    const receiptResponse = await request(application.getHttpServer())
      .post(`/api/v1/procurement/purchase-orders/${order.id}/receipts`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `matched-receipt-${runId}`)
      .send({
        lines: [{ orderLineId: orderLine.id, quantity: '2' }],
        supplierDeliveryReference: `MATCH-${runId.slice(0, 8)}`,
      })
      .expect(201);
    const receipt = receiptResponse.body as GoodsReceipt;
    const receiptLine = required(receipt.lines[0], 'Matched receipt line was not returned');

    const invoiceInput = {
      invoiceDate: '2099-09-02',
      invoiceNumber: `SUP-${runId.slice(0, 12)}`,
      lines: [
        {
          orderLineId: orderLine.id,
          quantity: '2',
          unitPrice: '12',
          vatTreatment: 'zero',
        },
      ],
      purchaseOrderId: order.id,
    };
    const invoiceKey = `supplier-invoice-${runId}`;
    const invoiceResponse = await request(application.getHttpServer())
      .post('/api/v1/procurement/supplier-invoices')
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', invoiceKey)
      .send(invoiceInput)
      .expect(201);
    const invoice = invoiceResponse.body as SupplierInvoice;
    expect(invoice).toMatchObject({ currencyCode: 'BGN', total: '24.0000' });
    const invoiceReplay = await request(application.getHttpServer())
      .post('/api/v1/procurement/supplier-invoices')
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', invoiceKey)
      .send(invoiceInput)
      .expect(201);
    expect((invoiceReplay.body as SupplierInvoice).id).toBe(invoice.id);

    const compared = await request(application.getHttpServer())
      .get(`/api/v1/procurement/purchase-orders/${order.id}`)
      .set('authorization', `Bearer ${creatorToken}`)
      .expect(200);
    expect((compared.body as PurchaseOrder).lines[0]).toMatchObject({
      deliveredQuantity: '2.0000',
      invoicedQuantity: '2.0000',
      orderedQuantity: '2.0000',
    });
    expect((compared.body as PurchaseOrder).supplierInvoices).toHaveLength(1);

    const claimResponse = await request(application.getHttpServer())
      .post('/api/v1/procurement/supplier-claims')
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `supplier-claim-${runId}`)
      .send({
        description: 'Outer packaging and one unit were damaged on arrival.',
        goodsReceiptLineId: receiptLine.id,
        quantity: '1',
        type: 'damaged',
      })
      .expect(201);
    const claim = claimResponse.body as SupplierClaim;
    expect(claim).toMatchObject({ status: 'open', type: 'damaged', version: 1 });
    expect(claim.statusHistory).toHaveLength(1);

    const submittedResponse = await request(application.getHttpServer())
      .post(`/api/v1/procurement/supplier-claims/${claim.id}/status`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `supplier-claim-submit-${runId}`)
      .send({ expectedVersion: 1, note: 'Sent to supplier.', status: 'submitted' })
      .expect(200);
    const submitted = submittedResponse.body as SupplierClaim;
    expect(submitted).toMatchObject({ status: 'submitted', version: 2 });
    expect(submitted.statusHistory).toHaveLength(2);

    await request(application.getHttpServer())
      .post('/api/v1/procurement/supplier-claims')
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `supplier-claim-excess-${runId}`)
      .send({
        description: 'Duplicate quantity check.',
        goodsReceiptLineId: receiptLine.id,
        quantity: '2',
        type: 'non_conforming',
      })
      .expect(409);

    const finalSupplier = await request(application.getHttpServer())
      .get(`/api/v1/procurement/suppliers/${supplierId}`)
      .set('authorization', `Bearer ${creatorToken}`)
      .expect(200);
    expect((finalSupplier.body as ProcurementSupplierRecord).evaluations).toEqual(
      expect.arrayContaining([expect.objectContaining({ score: 4 })]),
    );
    const evidence = await database.query<{ audit_count: string; outbox_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM audit.events
          WHERE action IN (
            'procurement.supplier.profile.updated', 'procurement.supplier.evaluated',
            'procurement.supplier_invoice.recorded', 'procurement.supplier_claim.created',
            'procurement.supplier_claim.status_changed'
          )) AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events
          WHERE event_type IN (
            'procurement.supplier.profile.updated', 'procurement.supplier.evaluated',
            'procurement.supplier_invoice.recorded', 'procurement.supplier_claim.created',
            'procurement.supplier_claim.status_changed'
          )) AS outbox_count`,
    );
    expect(evidence.rows[0]).toEqual({ audit_count: '5', outbox_count: '5' });
  });

  function orderInput() {
    return {
      currencyCode: 'bgn',
      lines: [
        {
          expectedDeliveryDate: '2099-08-20',
          productId: ordinaryProductId,
          quantity: '5',
          unitPrice: '10',
        },
        {
          expectedDeliveryDate: '2099-08-22',
          productId: serialProductId,
          quantity: '1',
          unitPrice: '250',
        },
      ],
      supplierPartnerId: supplierId,
      warehouseId,
    };
  }
});

async function createAccount(pool: Pool, email: string, passwordHash: string): Promise<string> {
  const employeeId = randomUUID();
  const accountId = randomUUID();
  await pool.query(
    `INSERT INTO identity.employees (id, employee_number, display_name, email)
     VALUES ($1, $2, 'Procurement tester', $3)`,
    [employeeId, `PROC-${randomUUID()}`, email],
  );
  await pool.query(
    `INSERT INTO identity.user_accounts (id, employee_id, password_hash)
     VALUES ($1, $2, $3)`,
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
  await pool.query(
    `INSERT INTO iam.roles (id, code, name) VALUES ($1, $2, 'Procurement test role')`,
    [roleId, `procurement-${randomUUID()}`],
  );
  for (const action of actions) {
    const permission = await pool.query<{ id: string }>(
      `INSERT INTO iam.permissions (id, module, action)
       VALUES ($1, 'erp.procurement', $2)
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

async function seedMasterData(pool: Pool, actorId: string, runId: string) {
  // Exercise the same stable PostgreSQL UUIDs exposed by the development UI,
  // not only random version-4 identifiers generated inside the test.
  const supplierId = fixtureId('partner:supplier');
  const warehouseId = fixtureId('warehouse:central');
  const ordinaryCategoryId = randomUUID();
  const serialCategoryId = randomUUID();
  const unitId = randomUUID();
  const ordinaryProductId = fixtureId('catalog:product:adapter');
  const serialProductId = fixtureId('catalog:product:fiscal-register');
  await pool.query(
    `INSERT INTO master_data.partners (id, kind, display_name, created_by, updated_by)
     VALUES ($1, 'legal_entity', $2, $3, $3)`,
    [supplierId, `Procurement Supplier ${runId}`, actorId],
  );
  await pool.query(
    `INSERT INTO master_data.partner_roles (partner_id, role, assigned_by)
     VALUES ($1, 'supplier', $2)`,
    [supplierId, actorId],
  );
  await pool.query(
    `INSERT INTO master_data.warehouses (id, code, name, created_by, updated_by)
     VALUES ($1, $2, 'Procurement warehouse', $3, $3)`,
    [warehouseId, `PW-${runId.slice(0, 8).toUpperCase()}`, actorId],
  );
  await pool.query(
    `INSERT INTO master_data.product_categories (
       id, name, tracking_mode, created_by, updated_by
     ) VALUES ($1, $2, 'none', $3, $3), ($4, $5, 'serial', $3, $3)`,
    [ordinaryCategoryId, `Ordinary ${runId}`, actorId, serialCategoryId, `Serial ${runId}`],
  );
  await pool.query(
    `INSERT INTO master_data.units (id, code, name, created_by, updated_by)
     VALUES ($1, $2, 'Pieces', $3, $3)`,
    [unitId, `PC${runId.slice(0, 6).toUpperCase()}`, actorId],
  );
  await pool.query(
    `INSERT INTO master_data.products (
       id, product_code, name, category_id, unit_id, created_by, updated_by
     ) VALUES
       ($1, $2, 'Receipt paper', $3, $4, $5, $5),
       ($6, $7, 'Fiscal device', $8, $4, $5, $5)`,
    [
      ordinaryProductId,
      `PAPER-${runId.slice(0, 8)}`,
      ordinaryCategoryId,
      unitId,
      actorId,
      serialProductId,
      `FISCAL-${runId.slice(0, 8)}`,
      serialCategoryId,
    ],
  );
  return { ordinaryProductId, serialProductId, supplierId, warehouseId };
}

async function login(application: INestApplication, email: string): Promise<string> {
  const response = await request(application.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.sessionToken as string;
}

function assertTemporaryDatabaseName(value: string) {
  if (!/^vista_procurement_test_[a-f0-9]{32}$/u.test(value))
    throw new Error('Refusing to operate on an unexpected procurement test database');
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
