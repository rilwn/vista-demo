import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  ProductTrackingMode,
  ReceiveStockRequest,
  StockBalance,
  StockReceipt,
  Warehouse,
} from '@vista/contracts';
import type { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service.js';
import type {
  AuthenticationContext,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { DatabaseService } from '../database/database.service.js';

type WarehouseRow = {
  id: string;
  code: string;
  name: string;
  warehouse_type: Warehouse['type'];
  active: boolean;
  version: number;
};
type ProductRow = { id: string; tracking_mode: ProductTrackingMode; requires_expiry: boolean };
type Replay = { request_hash: string; status: string; response_body: unknown };

@Injectable()
export class InventoryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}
  async warehouses(): Promise<Warehouse[]> {
    const result = await this.database
      .getPool()
      .query<WarehouseRow>(
        'SELECT id, code, name, warehouse_type, active, version FROM master_data.warehouses WHERE active ORDER BY upper(code), id',
      );
    return result.rows.map(warehouse);
  }
  async balances(): Promise<StockBalance[]> {
    const result = await this.database
      .getPool()
      .query<{ warehouse_id: string; product_id: string; quantity: string }>(
        'SELECT warehouse_id, product_id, quantity::text FROM inventory.stock_balances ORDER BY warehouse_id, product_id',
      );
    return result.rows.map((row) => ({
      warehouseId: row.warehouse_id,
      productId: row.product_id,
      quantity: row.quantity,
    }));
  }
  async createWarehouse(
    input: { code: string; name: string; type?: Warehouse['type'] | undefined },
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<Warehouse> {
    const normalized = {
      code: cleanCode(input.code, 'WAREHOUSE_CODE_REQUIRED'),
      name: clean(input.name, 'WAREHOUSE_NAME_REQUIRED'),
      type: input.type ?? 'standard',
    };
    return this.command('warehouse.create', key, normalized, async (client) => {
      const inserted = await client.query<WarehouseRow>(
        'INSERT INTO master_data.warehouses (code, name, warehouse_type, created_by, updated_by) VALUES ($1, $2, $3, $4, $4) RETURNING id, code, name, warehouse_type, active, version',
        [normalized.code, normalized.name, normalized.type, auth.accountId],
      );
      const result = warehouse(required(inserted.rows[0], 'Warehouse insert failed'));
      await this.sideEffects(
        client,
        'warehouse',
        result.id,
        'master_data.warehouse.created',
        result,
        auth,
        metadata,
        validKey(key),
      );
      return result;
    });
  }
  async receive(
    input: ReceiveStockRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<StockReceipt> {
    const normalized = normalizeReceipt(input);
    return this.command('stock-receipt.create', key, normalized, async (client) => {
      const [warehouseResult, productResult] = await Promise.all([
        client.query<{ id: string }>(
          'SELECT id FROM master_data.warehouses WHERE id = $1 AND active FOR KEY SHARE',
          [normalized.warehouseId],
        ),
        client.query<ProductRow>(
          'SELECT p.id, c.tracking_mode, c.requires_expiry FROM master_data.products p JOIN master_data.product_categories c ON c.id = p.category_id WHERE p.id = $1 AND p.active AND c.active FOR KEY SHARE',
          [normalized.productId],
        ),
      ]);
      if (!warehouseResult.rowCount)
        throw new ApiErrorException(
          'WAREHOUSE_NOT_FOUND',
          'The selected warehouse was not found',
          HttpStatus.NOT_FOUND,
        );
      const product = productResult.rows[0];
      if (!product)
        throw new ApiErrorException(
          'PRODUCT_NOT_FOUND',
          'The selected product was not found',
          HttpStatus.NOT_FOUND,
        );
      validateTracking(product, normalized);
      const movementId = randomUUID();
      await client.query(
        "INSERT INTO inventory.stock_movements (id, warehouse_id, product_id, movement_type, quantity, reference_type, reference_id, actor_account_id, correlation_id) VALUES ($1, $2, $3, 'receipt', $4, 'manual_receipt', $5, $6, $7)",
        [
          movementId,
          normalized.warehouseId,
          normalized.productId,
          normalized.quantity,
          normalized.referenceId,
          auth.accountId,
          metadata.correlationId,
        ],
      );
      await client.query(
        'INSERT INTO inventory.stock_balances (warehouse_id, product_id, quantity) VALUES ($1, $2, $3) ON CONFLICT (warehouse_id, product_id) DO UPDATE SET quantity = inventory.stock_balances.quantity + EXCLUDED.quantity, updated_at = now()',
        [normalized.warehouseId, normalized.productId, normalized.quantity],
      );
      let batchId: string | undefined;
      if (normalized.batchNumber) {
        const batch = await client.query<{ id: string }>(
          'INSERT INTO inventory.batches (product_id, batch_number, expires_at) VALUES ($1, $2, $3) ON CONFLICT (product_id, batch_number) DO UPDATE SET expires_at = COALESCE(inventory.batches.expires_at, EXCLUDED.expires_at) RETURNING id',
          [normalized.productId, normalized.batchNumber, normalized.expiresAt ?? null],
        );
        batchId = required(batch.rows[0], 'Batch insert failed').id;
        await client.query(
          'INSERT INTO inventory.batch_stock_balances (warehouse_id, batch_id, quantity) VALUES ($1, $2, $3) ON CONFLICT (warehouse_id, batch_id) DO UPDATE SET quantity = inventory.batch_stock_balances.quantity + EXCLUDED.quantity, updated_at = now()',
          [normalized.warehouseId, batchId, normalized.quantity],
        );
      }
      const serialItemIds: string[] = [];
      for (const serialNumber of normalized.serialNumbers) {
        const serial = await client.query<{ id: string }>(
          'INSERT INTO inventory.serialized_items (product_id, serial_number, warehouse_id, received_movement_id) VALUES ($1, $2, $3, $4) RETURNING id',
          [normalized.productId, serialNumber, normalized.warehouseId, movementId],
        );
        serialItemIds.push(required(serial.rows[0], 'Serial insert failed').id);
      }
      const result: StockReceipt = {
        id: movementId,
        warehouseId: normalized.warehouseId,
        productId: normalized.productId,
        quantity: normalized.quantity,
        serialItemIds,
        ...(batchId ? { batchId } : {}),
      };
      await this.sideEffects(
        client,
        'stock_movement',
        movementId,
        'inventory.stock.received',
        result,
        auth,
        metadata,
        validKey(key),
      );
      return result;
    });
  }
  private async command<T>(
    scope: string,
    key: string | undefined,
    payload: object,
    action: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const idempotencyKey = validKey(key);
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const replay = await claim(client, scope, idempotencyKey, hash);
      if (replay) {
        await client.query('COMMIT');
        return replay as T;
      }
      const result = await action(client);
      await client.query(
        "UPDATE platform.idempotency_keys SET status = 'completed', response_status = 201, response_body = $3 WHERE scope = $1 AND idempotency_key = $2",
        [scope, idempotencyKey, result],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (unique(error))
        throw new ApiErrorException(
          'INVENTORY_DUPLICATE',
          'A warehouse code, serial number, or receipt reference already exists',
          HttpStatus.CONFLICT,
        );
      throw error;
    } finally {
      client.release();
    }
  }
  private async sideEffects(
    client: PoolClient,
    type: string,
    id: string,
    event: string,
    payload: object,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    idempotencyKey: string,
  ) {
    await client.query(
      'INSERT INTO integration.outbox_events (id, aggregate_type, aggregate_id, event_type, event_version, correlation_id, idempotency_key, payload) VALUES ($1, $2, $3, $4, 1, $5, $6, $7)',
      [
        randomUUID(),
        type,
        id,
        event,
        metadata.correlationId,
        `${event}:${idempotencyKey}`,
        payload,
      ],
    );
    await this.audit.append(
      {
        action: event,
        actorAccountId: auth.accountId,
        after: payload as Record<string, unknown>,
        correlationId: metadata.correlationId,
        targetId: id,
        targetType: type,
        ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
        ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
      },
      client,
    );
  }
}
function warehouse(row: WarehouseRow): Warehouse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.warehouse_type,
    active: row.active,
    version: row.version,
  };
}
function clean(value: string, code: string) {
  const result = value.trim().replace(/\s+/gu, ' ');
  if (!result)
    throw new ApiErrorException(code, 'A required value is missing', HttpStatus.BAD_REQUEST);
  return result;
}
function cleanCode(value: string, code: string) {
  return clean(value, code).replace(/\s+/gu, '').toUpperCase();
}
function required<T>(value: T | undefined, message: string): T {
  if (!value) throw new Error(message);
  return value;
}
function validKey(key: string | undefined) {
  if (!key || !/^[A-Za-z0-9._:-]{8,128}$/u.test(key))
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_REQUIRED',
      'A valid Idempotency-Key is required',
      HttpStatus.BAD_REQUEST,
    );
  return key;
}
async function claim(
  client: PoolClient,
  scope: string,
  key: string,
  hash: string,
): Promise<unknown | undefined> {
  const inserted = await client.query(
    "INSERT INTO platform.idempotency_keys (scope, idempotency_key, request_hash, status, expires_at) VALUES ($1, $2, $3, 'processing', now() + interval '24 hours') ON CONFLICT DO NOTHING RETURNING idempotency_key",
    [scope, key, hash],
  );
  if (inserted.rowCount) return undefined;
  const existing = await client.query<Replay>(
    'SELECT request_hash, status, response_body FROM platform.idempotency_keys WHERE scope = $1 AND idempotency_key = $2 FOR UPDATE',
    [scope, key],
  );
  const row = existing.rows[0];
  if (!row || row.request_hash !== hash)
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_CONFLICT',
      'The idempotency key was already used for a different request',
      HttpStatus.CONFLICT,
    );
  if (row.status === 'completed') return row.response_body;
  throw new ApiErrorException(
    'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    'The original request is still being processed',
    HttpStatus.CONFLICT,
  );
}
function normalizeReceipt(input: ReceiveStockRequest) {
  const serialNumbers = [
    ...new Set(
      (input.serialNumbers ?? []).map((value) => cleanCode(value, 'SERIAL_NUMBER_REQUIRED')),
    ),
  ];
  if (serialNumbers.length !== (input.serialNumbers ?? []).length)
    throw new ApiErrorException(
      'SERIAL_NUMBER_DUPLICATE',
      'Each serial number can appear only once in a receipt',
      HttpStatus.BAD_REQUEST,
    );
  return {
    warehouseId: input.warehouseId,
    productId: input.productId,
    quantity: input.quantity,
    referenceId: clean(input.referenceId, 'RECEIPT_REFERENCE_REQUIRED'),
    serialNumbers,
    ...(input.batchNumber
      ? { batchNumber: clean(input.batchNumber, 'BATCH_NUMBER_REQUIRED') }
      : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  };
}
function validateTracking(product: ProductRow, input: ReturnType<typeof normalizeReceipt>) {
  if (
    product.tracking_mode === 'serial' &&
    (input.serialNumbers.length === 0 || input.serialNumbers.length !== Number(input.quantity))
  )
    throw new ApiErrorException(
      'SERIAL_TRACKING_REQUIRED',
      'Serial-tracked receipts need one serial number per whole unit',
      HttpStatus.BAD_REQUEST,
    );
  if (product.tracking_mode !== 'serial' && input.serialNumbers.length)
    throw new ApiErrorException(
      'SERIAL_TRACKING_NOT_ALLOWED',
      'This product category does not allow serial numbers',
      HttpStatus.BAD_REQUEST,
    );
  if (product.tracking_mode === 'batch' && !input.batchNumber)
    throw new ApiErrorException(
      'BATCH_TRACKING_REQUIRED',
      'Batch-tracked receipts require a batch number',
      HttpStatus.BAD_REQUEST,
    );
  if (product.tracking_mode !== 'batch' && input.batchNumber)
    throw new ApiErrorException(
      'BATCH_TRACKING_NOT_ALLOWED',
      'This product category does not allow batches',
      HttpStatus.BAD_REQUEST,
    );
  if (product.requires_expiry && !input.expiresAt)
    throw new ApiErrorException(
      'EXPIRY_REQUIRED',
      'This product category requires an expiry date',
      HttpStatus.BAD_REQUEST,
    );
}
function unique(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}
