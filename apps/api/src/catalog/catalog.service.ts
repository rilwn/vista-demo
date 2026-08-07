import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  CreateProductRequest,
  CreateUnitRequest,
  ProductBarcode,
  ProductSummary,
  ProductTrackingMode,
  Unit,
} from '@vista/contracts';
import type { PoolClient } from 'pg';

import { AuditService } from '../audit/audit.service.js';
import type {
  AuthenticationContext,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';

type UnitRow = Unit;

interface ProductRow {
  active: boolean;
  barcodes: ProductBarcode[];
  category_id: string;
  created_at: Date | string;
  id: string;
  name: string;
  product_code: string;
  tracking_mode: ProductTrackingMode;
  unit_id: string;
  updated_at: Date | string;
  version: number;
}

interface IdempotencyRow {
  request_hash: string;
  response_body: unknown;
  status: 'completed' | 'failed' | 'processing';
}

interface NormalizedUnitInput {
  code: string;
  name: string;
}

interface NormalizedProductInput {
  barcodes: Array<{ barcode: string; barcodeType: ProductBarcode['barcodeType'] }>;
  categoryId: string;
  name: string;
  productCode: string;
  unitId: string;
}

@Injectable()
export class CatalogService {
  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async units(): Promise<Unit[]> {
    const result = await this.database.getPool().query<UnitRow>(
      `SELECT id, code, name, active, version
       FROM master_data.units
       WHERE active = true
       ORDER BY code, id`,
    );
    return result.rows;
  }

  async products(): Promise<ProductSummary[]> {
    const result = await this.database.getPool().query<ProductRow>(
      `SELECT p.id, p.product_code, p.name, p.category_id, p.unit_id, p.active,
              p.version, p.created_at, p.updated_at, category.tracking_mode,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'id', barcode.id,
                  'barcode', barcode.barcode,
                  'barcodeType', barcode.barcode_type,
                  'active', barcode.active
                ) ORDER BY barcode.barcode, barcode.id)
                FROM master_data.product_barcodes barcode
                WHERE barcode.product_id = p.id AND barcode.active
              ), '[]'::json) AS barcodes
       FROM master_data.products p
       JOIN master_data.product_categories category ON category.id = p.category_id
       WHERE p.active
       ORDER BY p.name, p.id`,
    );
    return result.rows.map(mapProduct);
  }

  async createUnit(
    input: CreateUnitRequest,
    idempotencyKey: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<Unit> {
    const normalized = normalizeUnit(input);
    return this.executeCommand(
      'unit',
      idempotencyKey,
      normalized,
      authentication,
      metadata,
      async (client) => {
        const inserted = await client.query<UnitRow>(
          `INSERT INTO master_data.units (code, name, created_by, updated_by)
           VALUES ($1, $2, $3, $3)
           RETURNING id, code, name, active, version`,
          [normalized.code, normalized.name, authentication.accountId],
        );
        const unit = inserted.rows[0];
        if (!unit) throw new Error('Unit insert did not return a row');
        return unit;
      },
      isUnit,
    );
  }

  async createProduct(
    input: CreateProductRequest,
    idempotencyKey: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<ProductSummary> {
    const normalized = normalizeProduct(input);
    return this.executeCommand(
      'product',
      idempotencyKey,
      normalized,
      authentication,
      metadata,
      async (client) => {
        const category = await client.query<{ tracking_mode: ProductTrackingMode }>(
          `SELECT tracking_mode
           FROM master_data.product_categories
           WHERE id = $1 AND active = true`,
          [normalized.categoryId],
        );
        const categoryRow = category.rows[0];
        if (!categoryRow) {
          throw new ApiErrorException(
            'PRODUCT_CATEGORY_NOT_FOUND',
            'The product category was not found',
            HttpStatus.NOT_FOUND,
          );
        }

        const unit = await client.query<{ id: string }>(
          `SELECT id FROM master_data.units WHERE id = $1 AND active = true`,
          [normalized.unitId],
        );
        if (!unit.rowCount) {
          throw new ApiErrorException(
            'PRODUCT_UNIT_NOT_FOUND',
            'The product unit was not found',
            HttpStatus.NOT_FOUND,
          );
        }

        const inserted = await client.query<Omit<ProductRow, 'barcodes' | 'tracking_mode'>>(
          `INSERT INTO master_data.products (
             product_code, name, category_id, unit_id, created_by, updated_by
           ) VALUES ($1, $2, $3, $4, $5, $5)
           RETURNING id, product_code, name, category_id, unit_id, active, version, created_at, updated_at`,
          [
            normalized.productCode,
            normalized.name,
            normalized.categoryId,
            normalized.unitId,
            authentication.accountId,
          ],
        );
        const product = inserted.rows[0];
        if (!product) throw new Error('Product insert did not return a row');

        const barcodes: ProductBarcode[] = [];
        for (const barcode of normalized.barcodes) {
          const barcodeInserted = await client.query<{
            active: boolean;
            barcode: string;
            barcode_type: ProductBarcode['barcodeType'];
            id: string;
          }>(
            `INSERT INTO master_data.product_barcodes (
               product_id, barcode, barcode_type, created_by
             ) VALUES ($1, $2, $3, $4)
             RETURNING id, barcode, barcode_type, active`,
            [product.id, barcode.barcode, barcode.barcodeType, authentication.accountId],
          );
          const barcodeRow = barcodeInserted.rows[0];
          if (!barcodeRow) throw new Error('Product barcode insert did not return a row');
          barcodes.push({
            active: barcodeRow.active,
            barcode: barcodeRow.barcode,
            barcodeType: barcodeRow.barcode_type,
            id: barcodeRow.id,
          });
        }

        return {
          active: product.active,
          barcodes,
          categoryId: product.category_id,
          createdAt: new Date(product.created_at).toISOString(),
          id: product.id,
          name: product.name,
          productCode: product.product_code,
          trackingMode: categoryRow.tracking_mode,
          unitId: product.unit_id,
          updatedAt: new Date(product.updated_at).toISOString(),
          version: product.version,
        };
      },
      isProduct,
    );
  }

  private async executeCommand<T extends Unit | ProductSummary>(
    kind: 'product' | 'unit',
    idempotencyKey: string | undefined,
    input: object,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    create: (client: PoolClient) => Promise<T>,
    isResponse: (value: unknown) => value is T,
  ): Promise<T> {
    const key = validateIdempotencyKey(idempotencyKey);
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const replay = await claimIdempotency(
        client,
        `master-data.catalog.${kind}.create`,
        key,
        requestHash,
        this.environment.IDEMPOTENCY_TTL_SECONDS,
        isResponse,
      );
      if (replay) {
        await client.query('COMMIT');
        return replay;
      }

      const result = await create(client);
      await client.query(
        `INSERT INTO integration.outbox_events (
           id, aggregate_type, aggregate_id, event_type, event_version,
           correlation_id, idempotency_key, payload
         ) VALUES ($1, $2, $3, $4, 1, $5, $6, $7)`,
        [
          randomUUID(),
          kind,
          result.id,
          `master_data.${kind}.created`,
          metadata.correlationId,
          `catalog.${kind}.created:${key}`,
          result,
        ],
      );
      await this.audit.append(
        {
          action: `master_data.${kind}.created`,
          actorAccountId: authentication.accountId,
          after: { ...result },
          correlationId: metadata.correlationId,
          ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
          targetId: result.id,
          targetType: kind,
          ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
        },
        client,
      );
      await completeIdempotency(client, `master-data.catalog.${kind}.create`, key, result);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUnitDuplicate(error)) {
        throw new ApiErrorException(
          'UNIT_DUPLICATE',
          'A unit with this code or name already exists',
          HttpStatus.CONFLICT,
        );
      }
      if (isProductDuplicate(error)) {
        throw new ApiErrorException(
          'PRODUCT_DUPLICATE',
          'A product with this code already exists',
          HttpStatus.CONFLICT,
        );
      }
      if (isBarcodeDuplicate(error)) {
        throw new ApiErrorException(
          'PRODUCT_BARCODE_DUPLICATE',
          'A barcode is already assigned to a product',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

async function claimIdempotency<T>(
  client: PoolClient,
  scope: string,
  key: string,
  requestHash: string,
  ttlSeconds: number,
  isResponse: (value: unknown) => value is T,
): Promise<T | undefined> {
  const inserted = await client.query(
    `INSERT INTO platform.idempotency_keys (
       scope, idempotency_key, request_hash, status, expires_at
     ) VALUES ($1, $2, $3, 'processing', now() + ($4 * interval '1 second'))
     ON CONFLICT DO NOTHING
     RETURNING idempotency_key`,
    [scope, key, requestHash, ttlSeconds],
  );
  if (inserted.rowCount === 1) return undefined;

  const existing = await client.query<IdempotencyRow>(
    `SELECT request_hash, status, response_body
     FROM platform.idempotency_keys
     WHERE scope = $1 AND idempotency_key = $2
     FOR UPDATE`,
    [scope, key],
  );
  const row = existing.rows[0];
  if (!row || row.request_hash !== requestHash) {
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_CONFLICT',
      'The idempotency key was already used for a different request',
      HttpStatus.CONFLICT,
    );
  }
  if (row.status === 'completed' && isResponse(row.response_body)) return row.response_body;
  throw new ApiErrorException(
    'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    'The original request is still being processed',
    HttpStatus.CONFLICT,
  );
}

async function completeIdempotency<T>(
  client: PoolClient,
  scope: string,
  key: string,
  response: T,
): Promise<void> {
  await client.query(
    `UPDATE platform.idempotency_keys
     SET status = 'completed', response_status = 201, response_body = $3
     WHERE scope = $1 AND idempotency_key = $2`,
    [scope, key, response],
  );
}

function normalizeUnit(input: CreateUnitRequest): NormalizedUnitInput {
  const code = input.code.trim().replace(/\s+/gu, '').toUpperCase();
  const name = normalizeText(input.name);
  if (!code || !name) {
    throw new ApiErrorException(
      'UNIT_FIELDS_REQUIRED',
      'Unit code and name are required',
      HttpStatus.BAD_REQUEST,
    );
  }
  return { code, name };
}

function normalizeProduct(input: CreateProductRequest): NormalizedProductInput {
  const name = normalizeText(input.name);
  const productCode = input.productCode.trim().replace(/\s+/gu, '').toUpperCase();
  if (!name || !productCode) {
    throw new ApiErrorException(
      'PRODUCT_FIELDS_REQUIRED',
      'Product code and name are required',
      HttpStatus.BAD_REQUEST,
    );
  }
  const seenBarcodes = new Set<string>();
  const barcodes = (input.barcodes ?? []).map((inputBarcode) => {
    const barcode = inputBarcode.barcode.trim();
    if (!barcode) {
      throw new ApiErrorException(
        'PRODUCT_BARCODE_REQUIRED',
        'Product barcodes cannot be blank',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (seenBarcodes.has(barcode)) {
      throw new ApiErrorException(
        'PRODUCT_BARCODE_DUPLICATE',
        'A barcode can be listed only once for a product',
        HttpStatus.BAD_REQUEST,
      );
    }
    seenBarcodes.add(barcode);
    return { barcode, barcodeType: inputBarcode.barcodeType ?? 'other' };
  });
  return { barcodes, categoryId: input.categoryId, name, productCode, unitId: input.unitId };
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

function validateIdempotencyKey(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(value)) {
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_REQUIRED',
      'Provide an Idempotency-Key with 8 to 128 safe characters',
      HttpStatus.BAD_REQUEST,
    );
  }
  return value;
}

function mapProduct(row: ProductRow): ProductSummary {
  return {
    active: row.active,
    barcodes: Array.isArray(row.barcodes) ? row.barcodes : [],
    categoryId: row.category_id,
    createdAt: new Date(row.created_at).toISOString(),
    id: row.id,
    name: row.name,
    productCode: row.product_code,
    trackingMode: row.tracking_mode,
    unitId: row.unit_id,
    updatedAt: new Date(row.updated_at).toISOString(),
    version: row.version,
  };
}

function isUnit(value: unknown): value is Unit {
  return hasStringId(value) && hasString(value, 'code') && hasString(value, 'name');
}

function isProduct(value: unknown): value is ProductSummary {
  return (
    hasStringId(value) &&
    hasString(value, 'productCode') &&
    hasString(value, 'categoryId') &&
    hasString(value, 'unitId') &&
    hasString(value, 'trackingMode')
  );
}

function hasStringId(value: unknown): value is { id: string } {
  return hasString(value, 'id');
}

function hasString(value: unknown, key: string): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    key in value &&
    typeof (value as Record<string, unknown>)[key] === 'string'
  );
}

function isUnitDuplicate(error: unknown): boolean {
  return isUniqueViolation(error) && /units_(code|name)_unique/u.test(databaseConstraint(error));
}

function isProductDuplicate(error: unknown): boolean {
  return isUniqueViolation(error) && databaseConstraint(error) === 'products_code_unique';
}

function isBarcodeDuplicate(error: unknown): boolean {
  return isUniqueViolation(error) && databaseConstraint(error) === 'product_barcodes_value_unique';
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}

function databaseConstraint(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    typeof (error as { constraint?: unknown }).constraint === 'string'
    ? (error as { constraint: string }).constraint
    : '';
}
