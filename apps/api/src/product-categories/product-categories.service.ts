import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  CreateProductCategoryRequest,
  ProductCategory,
  ProductTrackingMode,
} from '@vista/contracts';
import type { Pool, PoolClient } from 'pg';

import { AuditService } from '../audit/audit.service.js';
import type {
  AuthenticationContext,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';

interface ProductCategoryRow {
  active: boolean;
  created_at: Date | string;
  id: string;
  name: string;
  normalized_name: string;
  parent_id: string | null;
  requires_expiry: boolean;
  tracking_mode: ProductTrackingMode;
  updated_at: Date | string;
  version: number;
}

interface IdempotencyRow {
  request_hash: string;
  response_body: unknown;
  status: 'completed' | 'failed' | 'processing';
}

interface NormalizedCategoryInput {
  name: string;
  parentId?: string;
  requiresExpiry: boolean;
  trackingMode: ProductTrackingMode;
}

@Injectable()
export class ProductCategoriesService {
  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(): Promise<ProductCategory[]> {
    const result = await this.database.getPool().query<ProductCategoryRow>(
      `SELECT id, parent_id, name, normalized_name, tracking_mode, requires_expiry,
              active, version, created_at, updated_at
       FROM master_data.product_categories
       WHERE active = true
       ORDER BY parent_id NULLS FIRST, normalized_name, id`,
    );
    return result.rows.map(mapCategory);
  }

  async create(
    input: CreateProductCategoryRequest,
    idempotencyKey: string | undefined,
    authentication: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<ProductCategory> {
    const key = validateIdempotencyKey(idempotencyKey);
    const normalized = normalizeInput(input);
    const requestHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const replay = await claimIdempotency(
        client,
        key,
        requestHash,
        this.environment.IDEMPOTENCY_TTL_SECONDS,
      );
      if (replay) {
        await client.query('COMMIT');
        return replay;
      }

      if (normalized.parentId) {
        const parent = await findCategory(client, normalized.parentId);
        if (!parent || !parent.active) {
          throw new ApiErrorException(
            'PRODUCT_CATEGORY_PARENT_NOT_FOUND',
            'The selected parent category was not found',
            HttpStatus.NOT_FOUND,
          );
        }
      }

      const parentLock = normalized.parentId ?? 'root';
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `product-category:${parentLock}:${normalizedName(normalized.name)}`,
      ]);
      const duplicate = await client.query<{ id: string }>(
        `SELECT id
         FROM master_data.product_categories
         WHERE parent_id IS NOT DISTINCT FROM $1 AND normalized_name = $2
         LIMIT 1`,
        [normalized.parentId ?? null, normalizedName(normalized.name)],
      );
      if (duplicate.rowCount) {
        throw new ApiErrorException(
          'PRODUCT_CATEGORY_DUPLICATE',
          'A category with this name already exists under the selected parent',
          HttpStatus.CONFLICT,
        );
      }

      const inserted = await client.query<ProductCategoryRow>(
        `INSERT INTO master_data.product_categories (
           parent_id, name, tracking_mode, requires_expiry, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING id, parent_id, name, normalized_name, tracking_mode, requires_expiry,
                   active, version, created_at, updated_at`,
        [
          normalized.parentId ?? null,
          normalized.name,
          normalized.trackingMode,
          normalized.requiresExpiry,
          authentication.accountId,
        ],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error('Product category insert did not return a row');
      const category = mapCategory(row);

      await client.query(
        `INSERT INTO integration.outbox_events (
           id, aggregate_type, aggregate_id, event_type, event_version,
           correlation_id, idempotency_key, payload
         ) VALUES ($1, 'product_category', $2, 'master_data.product_category.created', 1, $3, $4, $5)`,
        [
          randomUUID(),
          category.id,
          metadata.correlationId,
          `product-category.created:${key}`,
          category,
        ],
      );
      await this.audit.append(
        {
          action: 'master_data.product_category.created',
          actorAccountId: authentication.accountId,
          after: { ...category },
          correlationId: metadata.correlationId,
          ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
          targetId: category.id,
          targetType: 'product_category',
          ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
        },
        client,
      );
      await completeIdempotency(client, key, category);
      await client.query('COMMIT');
      return category;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueCategoryViolation(error)) {
        throw new ApiErrorException(
          'PRODUCT_CATEGORY_DUPLICATE',
          'A category with this name already exists under the selected parent',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

async function claimIdempotency(
  client: PoolClient,
  key: string,
  requestHash: string,
  ttlSeconds: number,
): Promise<ProductCategory | undefined> {
  const scope = 'master-data.product-categories.create';
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
  if (row.status === 'completed' && isProductCategory(row.response_body)) {
    return row.response_body;
  }
  throw new ApiErrorException(
    'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    'The original request is still being processed',
    HttpStatus.CONFLICT,
  );
}

async function completeIdempotency(
  client: PoolClient,
  key: string,
  response: ProductCategory,
): Promise<void> {
  await client.query(
    `UPDATE platform.idempotency_keys
     SET status = 'completed', response_status = 201, response_body = $2
     WHERE scope = 'master-data.product-categories.create' AND idempotency_key = $1`,
    [key, response],
  );
}

async function findCategory(
  client: Pool | PoolClient,
  id: string,
): Promise<ProductCategoryRow | undefined> {
  const result = await client.query<ProductCategoryRow>(
    `SELECT id, parent_id, name, normalized_name, tracking_mode, requires_expiry,
            active, version, created_at, updated_at
     FROM master_data.product_categories
     WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

function normalizeInput(input: CreateProductCategoryRequest): NormalizedCategoryInput {
  const name = input.name.trim().replace(/\s+/gu, ' ');
  if (!name) {
    throw new ApiErrorException(
      'PRODUCT_CATEGORY_NAME_REQUIRED',
      'The category name is required',
      HttpStatus.BAD_REQUEST,
    );
  }
  const trackingMode = input.trackingMode ?? 'none';
  const requiresExpiry = input.requiresExpiry ?? false;
  if (requiresExpiry && trackingMode !== 'batch') {
    throw new ApiErrorException(
      'PRODUCT_CATEGORY_EXPIRY_REQUIRES_BATCH',
      'Expiration tracking requires batch tracking',
      HttpStatus.BAD_REQUEST,
    );
  }
  return {
    name,
    requiresExpiry,
    trackingMode,
    ...(input.parentId ? { parentId: input.parentId } : {}),
  };
}

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
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

function mapCategory(row: ProductCategoryRow): ProductCategory {
  return {
    active: row.active,
    createdAt: new Date(row.created_at).toISOString(),
    id: row.id,
    name: row.name,
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    requiresExpiry: row.requires_expiry,
    trackingMode: row.tracking_mode,
    updatedAt: new Date(row.updated_at).toISOString(),
    version: row.version,
  };
}

function isProductCategory(value: unknown): value is ProductCategory {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ProductCategory>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.active === 'boolean' &&
    typeof candidate.requiresExpiry === 'boolean' &&
    (candidate.trackingMode === 'none' ||
      candidate.trackingMode === 'serial' ||
      candidate.trackingMode === 'batch') &&
    typeof candidate.version === 'number'
  );
}

function isUniqueCategoryViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
