import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AppEnvironment } from '@vista/config';
import type {
  CreatePartnerAddressRequest,
  CreatePartnerBankAccountRequest,
  CreatePartnerContactRequest,
  CreatePartnerRequest,
  PartnerAddress,
  PartnerBankAccount,
  PartnerContact,
  ProductSummary,
  ProductCategory,
  PartnerSummary,
  Unit,
} from '@vista/contracts';
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
  let categoryCreatorToken: string;
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
    const categoryCreatorEmail = `category-creator-${runId}@example.invalid`;
    const viewerEmail = `partner-viewer-${runId}@example.invalid`;
    const creatorId = await createAccount(database, 'creator', creatorEmail, passwordHash);
    const categoryCreatorId = await createAccount(
      database,
      'category-creator',
      categoryCreatorEmail,
      passwordHash,
    );
    const viewerId = await createAccount(database, 'viewer', viewerEmail, passwordHash);
    await grantPermissions(database, creatorId, 'crm', ['view', 'create', 'edit']);
    await grantPermissions(database, categoryCreatorId, 'erp.warehouse', ['view', 'create']);
    await grantPermissions(database, viewerId, 'crm', ['view']);
    creatorToken = await login(application, creatorEmail);
    categoryCreatorToken = await login(application, categoryCreatorEmail);
    viewerToken = await login(application, viewerEmail);
  }, 30_000);

  afterAll(async () => {
    if (application) {
      for (const token of [creatorToken, categoryCreatorToken, viewerToken]) {
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

  it('keeps contacts, addresses, and bank accounts in the canonical profile with auditable idempotent writes', async () => {
    const address: CreatePartnerAddressRequest = {
      addressLine1: '  12   Hristo Botev Blvd. ',
      addressLine2: ' Floor 2 ',
      city: '  Vratsa ',
      countryCode: 'bg',
      postalCode: ' 3000 ',
      type: 'billing',
    };
    const contact: CreatePartnerContactRequest = {
      contactRole: ' accountant ',
      displayName: '  Maria   Petrova ',
      email: ' MARIA.PETROVA@EXAMPLE.INVALID ',
      jobTitle: ' Chief accountant ',
      telephone: ' +359 88 123 4567 ',
    };
    const bankAccount: CreatePartnerBankAccountRequest = {
      bankName: '  Example Bank ',
      bic: ' westgb22 ',
      currencyCode: 'bgn',
      iban: 'GB82 WEST 1234 5698 7654 32',
    };

    const denied = await request(application.getHttpServer())
      .post(`/api/v1/master-data/partners/${primaryPartner.id}/addresses`)
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `address-denied-${runId}`)
      .send(address)
      .expect(403);
    expect(denied.body).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });

    const addressResponse = await request(application.getHttpServer())
      .post(`/api/v1/master-data/partners/${primaryPartner.id}/addresses`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `address-create-${runId}`)
      .send(address)
      .expect(201);
    expect(addressResponse.body).toMatchObject({
      addressLine1: '12 Hristo Botev Blvd.',
      addressLine2: 'Floor 2',
      city: 'Vratsa',
      countryCode: 'BG',
      postalCode: '3000',
      type: 'billing',
    });
    const createdAddress = addressResponse.body as PartnerAddress;

    const addressReplay = await request(application.getHttpServer())
      .post(`/api/v1/master-data/partners/${primaryPartner.id}/addresses`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `address-create-${runId}`)
      .send(address)
      .expect(201);
    expect(addressReplay.body).toEqual(addressResponse.body);

    const contactResponse = await request(application.getHttpServer())
      .post(`/api/v1/master-data/partners/${primaryPartner.id}/contacts`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `contact-create-${runId}`)
      .send(contact)
      .expect(201);
    expect(contactResponse.body).toMatchObject({
      contactRole: 'accountant',
      displayName: 'Maria Petrova',
      email: 'maria.petrova@example.invalid',
      jobTitle: 'Chief accountant',
      telephone: '+359 88 123 4567',
    });
    const createdContact = contactResponse.body as PartnerContact;

    const bankResponse = await request(application.getHttpServer())
      .post(`/api/v1/master-data/partners/${primaryPartner.id}/bank-accounts`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `bank-create-${runId}`)
      .send(bankAccount)
      .expect(201);
    expect(bankResponse.body).toMatchObject({
      bankName: 'Example Bank',
      bic: 'WESTGB22',
      currencyCode: 'BGN',
      iban: 'GB82WEST12345698765432',
    });
    const createdBankAccount = bankResponse.body as PartnerBankAccount;

    const profile = await request(application.getHttpServer())
      .get(`/api/v1/master-data/partners/${primaryPartner.id}/profile`)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(profile.body).toMatchObject({
      addresses: [expect.objectContaining({ id: createdAddress.id })],
      bankAccounts: [expect.objectContaining({ id: createdBankAccount.id })],
      contacts: [expect.objectContaining({ id: createdContact.id })],
      partner: { id: primaryPartner.id, version: 4 },
    });

    const duplicateBank = await request(application.getHttpServer())
      .post(`/api/v1/master-data/partners/${primaryPartner.id}/bank-accounts`)
      .set('authorization', `Bearer ${creatorToken}`)
      .set('idempotency-key', `bank-duplicate-${runId}`)
      .send(bankAccount)
      .expect(409);
    expect(duplicateBank.body).toMatchObject({ error: { code: 'BANK_ACCOUNT_DUPLICATE' } });

    const evidence = await database.query<{ audit_count: string; outbox_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM audit.events
          WHERE action IN (
            'master_data.partner.address.created',
            'master_data.partner.contact.created',
            'master_data.partner.bank_account.created'
          )) AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events
          WHERE aggregate_id = $1
            AND event_type IN (
              'master_data.partner.address.created',
              'master_data.partner.contact.created',
              'master_data.partner.bank_account.created'
            )) AS outbox_count`,
      [primaryPartner.id],
    );
    expect(evidence.rows[0]).toEqual({ audit_count: '3', outbox_count: '3' });
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

  it('creates a controlled category hierarchy without production seed data', async () => {
    await request(application.getHttpServer())
      .get('/api/v1/master-data/product-categories')
      .expect(401);

    const denied = await request(application.getHttpServer())
      .post('/api/v1/master-data/product-categories')
      .set('authorization', `Bearer ${viewerToken}`)
      .set('idempotency-key', `category-denied-${runId}`)
      .send({ name: 'Fiscal devices' })
      .expect(403);
    expect(denied.body).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });

    const rootResponse = await request(application.getHttpServer())
      .post('/api/v1/master-data/product-categories')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `category-root-${runId}`)
      .send({ name: '  Fiscal   devices ', trackingMode: 'serial' })
      .expect(201);
    const root = rootResponse.body as ProductCategory;
    expect(root).toMatchObject({ name: 'Fiscal devices', trackingMode: 'serial', version: 1 });

    const childResponse = await request(application.getHttpServer())
      .post('/api/v1/master-data/product-categories')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `category-child-${runId}`)
      .send({ name: ' Cash registers ', parentId: root.id })
      .expect(201);
    const child = childResponse.body as ProductCategory;
    expect(child).toMatchObject({ name: 'Cash registers', parentId: root.id, version: 1 });

    const replay = await request(application.getHttpServer())
      .post('/api/v1/master-data/product-categories')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `category-child-${runId}`)
      .send({ name: ' Cash registers ', parentId: root.id })
      .expect(201);
    expect(replay.body).toEqual(child);

    const duplicate = await request(application.getHttpServer())
      .post('/api/v1/master-data/product-categories')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `category-duplicate-${runId}`)
      .send({ name: 'cash   registers', parentId: root.id })
      .expect(409);
    expect(duplicate.body).toMatchObject({ error: { code: 'PRODUCT_CATEGORY_DUPLICATE' } });

    const invalidExpiryPolicy = await request(application.getHttpServer())
      .post('/api/v1/master-data/product-categories')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `category-invalid-expiry-${runId}`)
      .send({ name: 'Invalid policy', requiresExpiry: true, trackingMode: 'none' })
      .expect(400);
    expect(invalidExpiryPolicy.body).toMatchObject({
      error: { code: 'PRODUCT_CATEGORY_EXPIRY_REQUIRES_BATCH' },
    });

    const categories = await request(application.getHttpServer())
      .get('/api/v1/master-data/product-categories')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .expect(200);
    expect(categories.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: root.id, name: root.name }),
        expect.objectContaining({ id: child.id, parentId: root.id }),
      ]),
    );

    const evidence = await database.query<{ audit_count: string; outbox_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM audit.events
          WHERE action = 'master_data.product_category.created'
            AND target_id IN ($1, $2)) AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events
          WHERE event_type = 'master_data.product_category.created'
            AND aggregate_id IN ($1, $2)) AS outbox_count`,
      [root.id, child.id],
    );
    expect(evidence.rows[0]).toEqual({ audit_count: '2', outbox_count: '2' });
  });

  it('creates units and products with real barcode identities, retry safety, audit, and outbox evidence', async () => {
    await request(application.getHttpServer()).get('/api/v1/master-data/catalog/units').expect(401);

    const categoryResponse = await request(application.getHttpServer())
      .post('/api/v1/master-data/product-categories')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `catalog-category-${runId}`)
      .send({ name: 'Catalog test category', trackingMode: 'serial' })
      .expect(201);
    const category = categoryResponse.body as ProductCategory;

    const unitInput = { code: ' pcs ', name: ' Pieces ' };
    const unitResponse = await request(application.getHttpServer())
      .post('/api/v1/master-data/catalog/units')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `catalog-unit-${runId}`)
      .send(unitInput)
      .expect(201);
    const unit = unitResponse.body as Unit;
    expect(unit).toMatchObject({ code: 'PCS', name: 'Pieces', version: 1 });

    const unitReplay = await request(application.getHttpServer())
      .post('/api/v1/master-data/catalog/units')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `catalog-unit-${runId}`)
      .send(unitInput)
      .expect(201);
    expect(unitReplay.body).toEqual(unit);

    const unitKeyConflict = await request(application.getHttpServer())
      .post('/api/v1/master-data/catalog/units')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `catalog-unit-${runId}`)
      .send({ ...unitInput, name: 'Different unit' })
      .expect(409);
    expect(unitKeyConflict.body).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });

    const duplicateUnit = await request(application.getHttpServer())
      .post('/api/v1/master-data/catalog/units')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `catalog-unit-duplicate-${runId}`)
      .send({ code: 'PCS', name: 'Other name' })
      .expect(409);
    expect(duplicateUnit.body).toMatchObject({ error: { code: 'UNIT_DUPLICATE' } });

    const productInput = {
      barcodes: [{ barcode: ` 123456${runId.slice(0, 6)} `, barcodeType: 'code128' as const }],
      categoryId: category.id,
      name: '  Catalog   test product ',
      productCode: ' catalog-001 ',
      unitId: unit.id,
    };
    const productResponse = await request(application.getHttpServer())
      .post('/api/v1/master-data/catalog/products')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `catalog-product-${runId}`)
      .send(productInput)
      .expect(201);
    const product = productResponse.body as ProductSummary;
    expect(product).toMatchObject({
      categoryId: category.id,
      name: 'Catalog test product',
      productCode: 'CATALOG-001',
      trackingMode: 'serial',
      unitId: unit.id,
      version: 1,
    });
    expect(product.barcodes).toEqual([
      expect.objectContaining({ barcode: `123456${runId.slice(0, 6)}`, barcodeType: 'code128' }),
    ]);
    expect(product.barcodes[0]?.id).not.toMatch(/^pending-/u);

    const productReplay = await request(application.getHttpServer())
      .post('/api/v1/master-data/catalog/products')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `catalog-product-${runId}`)
      .send(productInput)
      .expect(201);
    expect(productReplay.body).toEqual(product);

    const barcodeDuplicate = await request(application.getHttpServer())
      .post('/api/v1/master-data/catalog/products')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `catalog-barcode-duplicate-${runId}`)
      .send({ ...productInput, name: 'Another catalog product', productCode: 'CATALOG-002' })
      .expect(409);
    expect(barcodeDuplicate.body).toMatchObject({ error: { code: 'PRODUCT_BARCODE_DUPLICATE' } });

    const products = await request(application.getHttpServer())
      .get('/api/v1/master-data/catalog/products')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .expect(200);
    expect(products.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: product.id })]),
    );

    const evidence = await database.query<{ audit_count: string; outbox_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM audit.events
          WHERE action IN ('master_data.unit.created', 'master_data.product.created')
            AND target_id IN ($1, $2)) AS audit_count,
         (SELECT count(*)::text FROM integration.outbox_events
          WHERE event_type IN ('master_data.unit.created', 'master_data.product.created')
            AND aggregate_id IN ($1, $2)) AS outbox_count`,
      [unit.id, product.id],
    );
    expect(evidence.rows[0]).toEqual({ audit_count: '2', outbox_count: '2' });

    const warehouseResponse = await request(application.getHttpServer())
      .post('/api/v1/warehouse/warehouses')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `warehouse-${runId}`)
      .send({ code: ' main ', name: ' Main warehouse ', type: 'standard' })
      .expect(201);
    expect(warehouseResponse.body).toMatchObject({ code: 'MAIN', name: 'Main warehouse' });
    const warehouse = warehouseResponse.body as { id: string };
    const receiptInput = {
      productId: product.id,
      quantity: '2',
      referenceId: `opening-${runId}`,
      serialNumbers: [`device-${runId}-01`, `device-${runId}-02`],
      warehouseId: warehouse.id,
    };
    const receiptResponse = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-receipts')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `receipt-${runId}`)
      .send(receiptInput)
      .expect(201);
    expect(receiptResponse.body).toMatchObject({ productId: product.id, quantity: '2.0000' });
    expect(receiptResponse.body.serialItemIds).toHaveLength(2);
    const receiptReplay = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-receipts')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `receipt-${runId}`)
      .send(receiptInput)
      .expect(201);
    expect(receiptReplay.body).toEqual(receiptResponse.body);
    const missingSerials = await request(application.getHttpServer())
      .post('/api/v1/warehouse/stock-receipts')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .set('idempotency-key', `receipt-missing-serial-${runId}`)
      .send({ ...receiptInput, referenceId: `missing-${runId}`, serialNumbers: [] })
      .expect(400);
    expect(missingSerials.body).toMatchObject({ error: { code: 'SERIAL_TRACKING_REQUIRED' } });
    const balances = await request(application.getHttpServer())
      .get('/api/v1/warehouse/stock-balances')
      .set('authorization', `Bearer ${categoryCreatorToken}`)
      .expect(200);
    expect(balances.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: product.id,
          quantity: '2.0000',
          warehouseId: warehouse.id,
        }),
      ]),
    );
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

async function grantPermissions(
  pool: Pool,
  accountId: string,
  module: 'crm' | 'erp.warehouse',
  actions: Array<'create' | 'edit' | 'view'>,
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
       VALUES ($1, $2, $3)
       ON CONFLICT (module, action) DO UPDATE SET module = EXCLUDED.module
       RETURNING id`,
      [randomUUID(), module, action],
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
