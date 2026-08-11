import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  ProductTrackingMode,
  CreateStockReservationRequest,
  ConfigureStockSettingsRequest,
  IssueStockRequest,
  StockIssue,
  ReceiveStockRequest,
  ReturnStockRequest,
  ReplenishmentStatus,
  SerialTraceability,
  SerialTraceEvent,
  StockBalance,
  StockReceipt,
  StockReservation,
  StockReturn,
  StockSettings,
  StockTransfer,
  TransferStockRequest,
  OpenStocktakeRequest,
  RecordStocktakeCountRequest,
  Stocktake,
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
import { lowStockEventType } from '../integration/low-stock-notification.consumer.js';

type WarehouseRow = {
  business_location_id: string | null;
  id: string;
  code: string;
  name: string;
  technician_operator_id: string | null;
  warehouse_type: Warehouse['type'];
  active: boolean;
  version: number;
};
type ProductRow = { id: string; tracking_mode: ProductTrackingMode; requires_expiry: boolean };
type ReservationRow = {
  id: string;
  initial_quantity: string;
  product_id: string;
  reference_id: string;
  reference_type: StockReservation['referenceType'];
  remaining_quantity: string;
  status: StockReservation['status'];
  warehouse_id: string;
};
type Replay = { request_hash: string; status: string; response_body: unknown };
type TraceMovementRow = {
  actor_id: string;
  actor_name: string;
  customer_id: string | null;
  customer_name: string | null;
  event_type: 'issue' | 'receipt' | 'return' | 'stocktake';
  movement_id: string;
  occurred_at: string;
  reference_id: string;
  reference_type: string;
  supplier_id: string | null;
  supplier_name: string | null;
  technician_id: string | null;
  technician_name: string | null;
  unit_cost_bgn: string;
  warehouse_id: string;
  warehouse_name: string;
};
type TraceTransferRow = Omit<
  TraceMovementRow,
  | 'customer_id'
  | 'customer_name'
  | 'event_type'
  | 'supplier_id'
  | 'supplier_name'
  | 'technician_id'
  | 'technician_name'
> & {
  from_warehouse_id: string;
  from_warehouse_name: string;
  to_warehouse_id: string;
  to_warehouse_name: string;
};
const traceMovementSelect = `SELECT movement.id AS movement_id,
  CASE WHEN movement.movement_type = 'receipt' THEN 'receipt'
       WHEN movement.movement_type = 'issue' THEN 'issue'
       WHEN movement.movement_type = 'return_in' THEN 'return'
       ELSE 'stocktake' END AS event_type,
  movement.occurred_at::text, movement.reference_type, movement.reference_id,
  movement.unit_cost_bgn::text, warehouse.id AS warehouse_id,
  warehouse.name AS warehouse_name, actor.id AS actor_id,
  employee.display_name AS actor_name, supplier.id AS supplier_id,
  supplier.display_name AS supplier_name, customer.id AS customer_id,
  customer.display_name AS customer_name, technician.id AS technician_id,
  technician_employee.display_name AS technician_name
FROM inventory.stock_movements movement
JOIN master_data.warehouses warehouse ON warehouse.id = movement.warehouse_id
JOIN identity.user_accounts actor ON actor.id = movement.actor_account_id
JOIN identity.employees employee ON employee.id = actor.employee_id
LEFT JOIN master_data.partners supplier ON supplier.id = movement.supplier_partner_id
LEFT JOIN master_data.partners customer ON customer.id = movement.customer_partner_id
LEFT JOIN identity.user_accounts technician ON technician.id = movement.technician_account_id
LEFT JOIN identity.employees technician_employee ON technician_employee.id = technician.employee_id`;

@Injectable()
export class InventoryService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}
  async warehouses(): Promise<Warehouse[]> {
    const result = await this.database.getPool().query<WarehouseRow>(
      `SELECT id, code, name, warehouse_type, business_location_id,
           technician_operator_id, active, version
         FROM master_data.warehouses WHERE active ORDER BY upper(code), id`,
    );
    return result.rows.map(warehouse);
  }
  async balances(): Promise<StockBalance[]> {
    const result = await this.database.getPool().query<{
      available_quantity: string;
      average_unit_cost_bgn: string;
      inventory_value_bgn: string;
      product_id: string;
      quantity: string;
      reserved_quantity: string;
      warehouse_id: string;
    }>(
      `SELECT balance.warehouse_id, balance.product_id, balance.quantity::text,
           balance.average_unit_cost_bgn::text,
           round(balance.quantity * balance.average_unit_cost_bgn, 4)::text AS inventory_value_bgn,
           COALESCE(reserved.quantity, 0)::numeric(18, 4)::text AS reserved_quantity,
           GREATEST(balance.quantity - COALESCE(reserved.quantity, 0), 0)::numeric(18, 4)::text AS available_quantity
         FROM inventory.stock_balances balance
         LEFT JOIN (
           SELECT warehouse_id, product_id, sum(remaining_quantity) AS quantity
           FROM inventory.stock_reservations WHERE status = 'active'
           GROUP BY warehouse_id, product_id
         ) reserved ON reserved.warehouse_id = balance.warehouse_id AND reserved.product_id = balance.product_id
         ORDER BY balance.warehouse_id, balance.product_id`,
    );
    return result.rows.map((row) => ({
      availableQuantity: row.available_quantity,
      averageUnitCostBgn: row.average_unit_cost_bgn,
      inventoryValueBgn: row.inventory_value_bgn,
      warehouseId: row.warehouse_id,
      productId: row.product_id,
      quantity: row.quantity,
      reservedQuantity: row.reserved_quantity,
    }));
  }
  async replenishment(): Promise<ReplenishmentStatus[]> {
    const result = await this.database.getPool().query<{
      available_quantity: string;
      low_stock: boolean;
      minimum_quantity: string;
      physical_quantity: string;
      product_id: string;
      recommended_quantity: string;
      reserved_quantity: string;
      target_quantity: string;
      warehouse_id: string;
    }>(
      `SELECT warehouse_id, product_id, physical_quantity::text, reserved_quantity::text,
         available_quantity::text, minimum_quantity::text, target_quantity::text,
         low_stock, recommended_quantity::text
       FROM inventory.stock_replenishment_status
       ORDER BY low_stock DESC, warehouse_id, product_id`,
    );
    return result.rows.map((row) => ({
      availableQuantity: row.available_quantity,
      lowStock: row.low_stock,
      minimumQuantity: row.minimum_quantity,
      physicalQuantity: row.physical_quantity,
      productId: row.product_id,
      recommendedQuantity: row.recommended_quantity,
      reservedQuantity: row.reserved_quantity,
      targetQuantity: row.target_quantity,
      warehouseId: row.warehouse_id,
    }));
  }
  async serialTraceability(serialNumber: string): Promise<SerialTraceability> {
    const normalized = cleanCode(serialNumber, 'SERIAL_NUMBER_REQUIRED');
    const item = await this.database.getPool().query<{
      current_warehouse_id: string;
      current_warehouse_name: string;
      issued_movement_id: string | null;
      product_id: string;
      product_name: string;
      received_movement_id: string;
      serial_item_id: string;
      serial_number: string;
      status: SerialTraceability['status'];
      stocktake_movement_id: string | null;
    }>(
      `SELECT item.id AS serial_item_id, item.serial_number, item.status,
         item.received_movement_id, item.issued_movement_id, item.stocktake_movement_id,
         product.id AS product_id, product.name AS product_name,
         warehouse.id AS current_warehouse_id, warehouse.name AS current_warehouse_name
       FROM inventory.serialized_items item
       JOIN master_data.products product ON product.id = item.product_id
       JOIN master_data.warehouses warehouse ON warehouse.id = item.warehouse_id
       WHERE upper(item.serial_number) = $1`,
      [normalized],
    );
    const row = item.rows[0];
    if (!row)
      throw new ApiErrorException(
        'SERIAL_NOT_FOUND',
        'The serial number was not found',
        HttpStatus.NOT_FOUND,
      );
    const returnEvents = await this.database.getPool().query<{
      original_issue_movement_id: string;
      return_movement_id: string;
    }>(
      `SELECT original_issue_movement_id, return_movement_id
       FROM inventory.serial_item_return_events
       WHERE serialized_item_id = $1`,
      [row.serial_item_id],
    );
    const movementIds = [
      row.received_movement_id,
      row.issued_movement_id,
      row.stocktake_movement_id,
      ...returnEvents.rows.flatMap((event) => [
        event.original_issue_movement_id,
        event.return_movement_id,
      ]),
    ].filter((id): id is string => Boolean(id));
    const [movements, transfers] = await Promise.all([
      this.database.getPool().query<TraceMovementRow>(
        `${traceMovementSelect}
         WHERE movement.id = ANY($1::uuid[])`,
        [movementIds],
      ),
      this.database.getPool().query<TraceTransferRow>(
        `SELECT event.transfer_out_movement_id AS movement_id,
           movement.occurred_at::text, movement.reference_type, movement.reference_id,
           movement.unit_cost_bgn::text, movement.warehouse_id,
           source.name AS warehouse_name, source.id AS from_warehouse_id,
           source.name AS from_warehouse_name, destination.id AS to_warehouse_id,
           destination.name AS to_warehouse_name, actor.id AS actor_id,
           employee.display_name AS actor_name
         FROM inventory.serial_item_transfer_events event
         JOIN inventory.stock_movements movement ON movement.id = event.transfer_out_movement_id
         JOIN master_data.warehouses source ON source.id = event.from_warehouse_id
         JOIN master_data.warehouses destination ON destination.id = event.to_warehouse_id
         JOIN identity.user_accounts actor ON actor.id = movement.actor_account_id
         JOIN identity.employees employee ON employee.id = actor.employee_id
         WHERE event.serialized_item_id = $1`,
        [row.serial_item_id],
      ),
    ]);
    const events: SerialTraceEvent[] = [
      ...movements.rows.map(traceMovement),
      ...transfers.rows.map(traceTransfer),
    ].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    return {
      currentWarehouse: { id: row.current_warehouse_id, displayName: row.current_warehouse_name },
      events,
      product: { id: row.product_id, displayName: row.product_name },
      serialItemId: row.serial_item_id,
      serialNumber: row.serial_number,
      status: row.status,
    };
  }
  async createWarehouse(
    input: {
      businessLocationId?: string | undefined;
      code: string;
      name: string;
      technicianOperatorId?: string | undefined;
      type?: Warehouse['type'] | undefined;
    },
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<Warehouse> {
    const normalized = {
      businessLocationId: input.businessLocationId,
      code: cleanCode(input.code, 'WAREHOUSE_CODE_REQUIRED'),
      name: clean(input.name, 'WAREHOUSE_NAME_REQUIRED'),
      technicianOperatorId: input.technicianOperatorId,
      type: input.type ?? 'standard',
    };
    if (normalized.technicianOperatorId && !normalized.businessLocationId)
      throw new ApiErrorException(
        'WAREHOUSE_OPERATOR_LOCATION_REQUIRED',
        'A technician operator requires a business location',
        HttpStatus.BAD_REQUEST,
      );
    if (normalized.technicianOperatorId && normalized.type !== 'technician')
      throw new ApiErrorException(
        'WAREHOUSE_OPERATOR_TYPE_INVALID',
        'A technician operator can only own a technician warehouse',
        HttpStatus.BAD_REQUEST,
      );
    return this.command('warehouse.create', key, normalized, async (client) => {
      if (normalized.businessLocationId)
        await requireBusinessLocation(client, normalized.businessLocationId);
      if (normalized.technicianOperatorId && normalized.businessLocationId)
        await requireTechnicianOperator(
          client,
          normalized.technicianOperatorId,
          normalized.businessLocationId,
        );
      const inserted = await client.query<WarehouseRow>(
        `INSERT INTO master_data.warehouses (
           code, name, warehouse_type, business_location_id,
           technician_operator_id, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING id, code, name, warehouse_type, business_location_id,
           technician_operator_id, active, version`,
        [
          normalized.code,
          normalized.name,
          normalized.type,
          normalized.businessLocationId ?? null,
          normalized.technicianOperatorId ?? null,
          auth.accountId,
        ],
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
  async configureStockSettings(
    input: ConfigureStockSettingsRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<StockSettings> {
    const normalized = {
      alertRecipientAccountIds: [...new Set(input.alertRecipientAccountIds ?? [])].sort(),
      minimumQuantity: normalizeQuantity(input.minimumQuantity),
      productId: input.productId,
      targetQuantity: normalizeQuantity(input.targetQuantity),
      warehouseId: input.warehouseId,
    };
    if (fixedDecimal(normalized.targetQuantity) < fixedDecimal(normalized.minimumQuantity))
      throw new ApiErrorException(
        'STOCK_TARGET_BELOW_MINIMUM',
        'Target quantity must be greater than or equal to minimum quantity',
        HttpStatus.BAD_REQUEST,
      );
    return this.command('stock-settings.configure', key, normalized, async (client) => {
      await Promise.all([
        activeProduct(client, normalized.productId),
        requireActiveWarehouse(client, normalized.warehouseId),
      ]);
      if (normalized.alertRecipientAccountIds.length) {
        const recipients = await client.query<{ id: string }>(
          `SELECT id FROM identity.user_accounts
           WHERE id = ANY($1::uuid[]) AND status = 'active' FOR KEY SHARE`,
          [normalized.alertRecipientAccountIds],
        );
        if (recipients.rowCount !== normalized.alertRecipientAccountIds.length)
          throw new ApiErrorException(
            'STOCK_ALERT_RECIPIENT_INVALID',
            'Every low-stock alert recipient must be an active employee account',
            HttpStatus.BAD_REQUEST,
          );
      }
      const configured = await client.query<{
        id: string;
        minimum_quantity: string;
        product_id: string;
        target_quantity: string;
        version: number;
        warehouse_id: string;
      }>(
        `INSERT INTO inventory.stock_settings (
           warehouse_id, product_id, minimum_quantity, target_quantity, updated_by
         ) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (warehouse_id, product_id) DO UPDATE SET
           minimum_quantity = EXCLUDED.minimum_quantity,
           target_quantity = EXCLUDED.target_quantity,
           active = true,
           version = inventory.stock_settings.version + 1,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()
         RETURNING id, warehouse_id, product_id, minimum_quantity::text,
           target_quantity::text, version`,
        [
          normalized.warehouseId,
          normalized.productId,
          normalized.minimumQuantity,
          normalized.targetQuantity,
          auth.accountId,
        ],
      );
      const row = required(configured.rows[0], 'Stock settings upsert failed');
      await client.query(
        `UPDATE inventory.stock_alert_subscriptions SET active = false, configured_at = now()
         WHERE warehouse_id = $1 AND product_id = $2`,
        [normalized.warehouseId, normalized.productId],
      );
      if (normalized.alertRecipientAccountIds.length)
        await client.query(
          `INSERT INTO inventory.stock_alert_subscriptions (
             warehouse_id, product_id, recipient_account_id, configured_by
           ) SELECT $1, $2, unnest($3::uuid[]), $4
           ON CONFLICT (warehouse_id, product_id, recipient_account_id) DO UPDATE SET
             active = true, configured_by = EXCLUDED.configured_by, configured_at = now()`,
          [
            normalized.warehouseId,
            normalized.productId,
            normalized.alertRecipientAccountIds,
            auth.accountId,
          ],
        );
      const result: StockSettings = {
        alertRecipientAccountIds: normalized.alertRecipientAccountIds,
        minimumQuantity: row.minimum_quantity,
        productId: row.product_id,
        targetQuantity: row.target_quantity,
        version: row.version,
        warehouseId: row.warehouse_id,
      };
      await this.sideEffects(
        client,
        'stock_settings',
        row.id,
        'inventory.stock.settings_configured',
        result,
        auth,
        metadata,
        validKey(key),
      );
      await this.reconcileLowStockAlert(
        client,
        result.warehouseId,
        result.productId,
        metadata.correlationId,
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
    return this.command('stock-receipt.create', key, normalized, (client) =>
      this.recordReceipt(client, normalized, 'manual_receipt', validKey(key), auth, metadata),
    );
  }
  receivePurchaseOrderStock(
    client: PoolClient,
    input: ReceiveStockRequest,
    goodsReceiptId: string,
    lineId: string,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<StockReceipt> {
    const normalized = normalizeReceipt({ ...input, referenceId: goodsReceiptId });
    return this.recordReceipt(
      client,
      normalized,
      'purchase_order_receipt',
      `${goodsReceiptId}:${lineId}`,
      auth,
      metadata,
    );
  }
  private async recordReceipt(
    client: PoolClient,
    normalized: ReturnType<typeof normalizeReceipt>,
    referenceType: 'manual_receipt' | 'purchase_order_receipt',
    eventKey: string,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<StockReceipt> {
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
    await ensureWarehousesNotUnderStocktake(client, [normalized.warehouseId]);
    const product = productResult.rows[0];
    if (!product)
      throw new ApiErrorException(
        'PRODUCT_NOT_FOUND',
        'The selected product was not found',
        HttpStatus.NOT_FOUND,
      );
    validateTracking(product, normalized);
    if (normalized.supplierPartnerId)
      await requirePartnerRole(client, normalized.supplierPartnerId, 'supplier');
    const movementId = randomUUID();
    const movement = await client.query<{ total_cost_bgn: string; unit_cost_bgn: string }>(
      `INSERT INTO inventory.stock_movements (
         id, warehouse_id, product_id, movement_type, quantity, reference_type,
         reference_id, actor_account_id, correlation_id, unit_cost_bgn,
         supplier_partner_id
       ) VALUES ($1, $2, $3, 'receipt', $4, $5, $6, $7, $8, $9, $10)
       RETURNING unit_cost_bgn::text, total_cost_bgn::text`,
      [
        movementId,
        normalized.warehouseId,
        normalized.productId,
        normalized.quantity,
        referenceType,
        normalized.referenceId,
        auth.accountId,
        metadata.correlationId,
        normalized.unitCostBgn,
        normalized.supplierPartnerId ?? null,
      ],
    );
    await client.query(
      `INSERT INTO inventory.stock_balances (
         warehouse_id, product_id, quantity, average_unit_cost_bgn
       ) VALUES ($1, $2, $3, $4)
       ON CONFLICT (warehouse_id, product_id) DO UPDATE SET
         average_unit_cost_bgn = round((
           inventory.stock_balances.quantity * inventory.stock_balances.average_unit_cost_bgn
           + EXCLUDED.quantity * EXCLUDED.average_unit_cost_bgn
         ) / (inventory.stock_balances.quantity + EXCLUDED.quantity), 4),
         quantity = inventory.stock_balances.quantity + EXCLUDED.quantity,
         updated_at = now()`,
      [normalized.warehouseId, normalized.productId, normalized.quantity, normalized.unitCostBgn],
    );
    let batchId: string | undefined;
    if (normalized.batchNumber) {
      const batch = await client.query<{ id: string }>(
        'INSERT INTO inventory.batches (product_id, batch_number, expires_at) VALUES ($1, $2, $3) ON CONFLICT (product_id, batch_number) DO UPDATE SET expires_at = COALESCE(inventory.batches.expires_at, EXCLUDED.expires_at) RETURNING id',
        [normalized.productId, normalized.batchNumber, normalized.expiresAt ?? null],
      );
      batchId = required(batch.rows[0], 'Batch insert failed').id;
      await client.query('UPDATE inventory.stock_movements SET batch_id = $2 WHERE id = $1', [
        movementId,
        batchId,
      ]);
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
      totalCostBgn: required(movement.rows[0], 'Receipt valuation insert failed').total_cost_bgn,
      unitCostBgn: required(movement.rows[0], 'Receipt valuation insert failed').unit_cost_bgn,
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
      eventKey,
    );
    await this.reconcileLowStockAlert(
      client,
      result.warehouseId,
      result.productId,
      metadata.correlationId,
    );
    return result;
  }
  async issue(
    input: IssueStockRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<StockIssue> {
    const normalized = normalizeIssue(input);
    return this.command('stock-issue.create', key, normalized, async (client) => {
      const product = await activeProduct(client, normalized.productId);
      await requireActiveWarehouse(client, normalized.warehouseId);
      await ensureWarehousesNotUnderStocktake(client, [normalized.warehouseId]);
      validateIssueTracking(product, normalized);
      if (normalized.customerPartnerId)
        await requirePartnerRole(client, normalized.customerPartnerId, 'customer');
      if (normalized.technicianAccountId)
        await requireActiveTechnician(client, normalized.technicianAccountId);
      if (normalized.reservationId)
        await consumeReservation(
          client,
          { ...normalized, reservationId: normalized.reservationId },
          auth.accountId,
        );
      else
        await ensureUnreservedAvailability(
          client,
          normalized.warehouseId,
          normalized.productId,
          normalized.quantity,
        );
      const movementId = randomUUID();
      const balance = await client.query<{ average_unit_cost_bgn: string; quantity: string }>(
        `UPDATE inventory.stock_balances
         SET quantity = quantity - $3, updated_at = now()
         WHERE warehouse_id = $1 AND product_id = $2 AND quantity >= $3
         RETURNING quantity::text, average_unit_cost_bgn::text`,
        [normalized.warehouseId, normalized.productId, normalized.quantity],
      );
      if (!balance.rowCount)
        throw new ApiErrorException(
          'INSUFFICIENT_STOCK',
          'The warehouse does not have sufficient available stock',
          HttpStatus.CONFLICT,
        );
      const issueCost = required(
        balance.rows[0],
        'Issue balance update failed',
      ).average_unit_cost_bgn;
      const movement = await client.query<{ total_cost_bgn: string }>(
        `INSERT INTO inventory.stock_movements (
           id, warehouse_id, product_id, movement_type, quantity, reference_type,
           reference_id, actor_account_id, correlation_id, unit_cost_bgn,
           customer_partner_id, technician_account_id
         ) VALUES ($1, $2, $3, 'issue', $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING total_cost_bgn::text`,
        [
          movementId,
          normalized.warehouseId,
          normalized.productId,
          normalized.quantity,
          normalized.reason,
          normalized.referenceId,
          auth.accountId,
          metadata.correlationId,
          issueCost,
          normalized.customerPartnerId ?? null,
          normalized.technicianAccountId ?? null,
        ],
      );
      let batchId: { id: string } | undefined;
      if (normalized.batchNumber) {
        const batch = await client.query<{ id: string }>(
          `SELECT id FROM inventory.batches
           WHERE product_id = $1 AND batch_number = $2 FOR KEY SHARE`,
          [normalized.productId, normalized.batchNumber],
        );
        batchId = required(batch.rows[0], 'Batch was not found');
        await client.query('UPDATE inventory.stock_movements SET batch_id = $2 WHERE id = $1', [
          movementId,
          batchId.id,
        ]);
        const batchBalance = await client.query(
          `UPDATE inventory.batch_stock_balances
           SET quantity = quantity - $3, updated_at = now()
           WHERE warehouse_id = $1 AND batch_id = $2 AND quantity >= $3
           RETURNING quantity`,
          [normalized.warehouseId, batchId.id, normalized.quantity],
        );
        if (!batchBalance.rowCount)
          throw new ApiErrorException(
            'INSUFFICIENT_BATCH_STOCK',
            'The selected batch does not have sufficient available stock',
            HttpStatus.CONFLICT,
          );
      }
      const serialItemIds = await issueSerials(client, normalized, movementId);
      const result: StockIssue = {
        id: movementId,
        warehouseId: normalized.warehouseId,
        productId: normalized.productId,
        quantity: normalized.quantity,
        reason: normalized.reason,
        serialItemIds,
        totalCostBgn: required(movement.rows[0], 'Issue valuation insert failed').total_cost_bgn,
        unitCostBgn: issueCost,
        ...(batchId ? { batchId: batchId.id } : {}),
        ...(normalized.reservationId ? { reservationId: normalized.reservationId } : {}),
      };
      await this.sideEffects(
        client,
        'stock_movement',
        movementId,
        'inventory.stock.issued',
        result,
        auth,
        metadata,
        validKey(key),
      );
      await this.reconcileLowStockAlert(
        client,
        result.warehouseId,
        result.productId,
        metadata.correlationId,
      );
      return result;
    });
  }
  async returnStock(
    input: ReturnStockRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<StockReturn> {
    const normalized = normalizeReturn(input);
    return this.command('stock-return.create', key, normalized, async (client) => {
      const originalResult = await client.query<{
        batch_id: string | null;
        customer_partner_id: string | null;
        movement_type: string;
        product_id: string;
        quantity: string;
        unit_cost_bgn: string;
      }>(
        `SELECT movement_type, product_id, quantity::text, unit_cost_bgn::text,
           batch_id, customer_partner_id
         FROM inventory.stock_movements
         WHERE id = $1 FOR UPDATE`,
        [normalized.originalIssueId],
      );
      const original = originalResult.rows[0];
      if (!original || original.movement_type !== 'issue')
        throw new ApiErrorException(
          'ORIGINAL_ISSUE_NOT_FOUND',
          'The original stock issue was not found',
          HttpStatus.NOT_FOUND,
        );
      const [product] = await Promise.all([
        activeProduct(client, original.product_id),
        requireActiveWarehouse(client, normalized.destinationWarehouseId),
      ]);
      await ensureWarehousesNotUnderStocktake(client, [normalized.destinationWarehouseId]);
      const returnedResult = await client.query<{ quantity: string }>(
        `SELECT COALESCE(sum(quantity), 0)::numeric(18, 4)::text AS quantity
         FROM inventory.stock_returns WHERE original_issue_movement_id = $1`,
        [normalized.originalIssueId],
      );
      const returnedQuantity = required(
        returnedResult.rows[0],
        'Returned quantity query failed',
      ).quantity;
      if (
        fixedDecimal(returnedQuantity) + fixedDecimal(normalized.quantity) >
        fixedDecimal(original.quantity)
      )
        throw new ApiErrorException(
          'RETURN_QUANTITY_EXCEEDS_ISSUE',
          'The return exceeds the quantity remaining on the original issue',
          HttpStatus.CONFLICT,
        );
      validateReturnTracking(product, normalized, original.batch_id);
      const serialItems = await returnedSerialItems(client, normalized, original.product_id);
      const movementId = randomUUID();
      const movement = await client.query<{ total_cost_bgn: string }>(
        `INSERT INTO inventory.stock_movements (
           id, warehouse_id, product_id, movement_type, quantity, reference_type,
           reference_id, actor_account_id, correlation_id, unit_cost_bgn,
           customer_partner_id, batch_id
         ) VALUES ($1, $2, $3, 'return_in', $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING total_cost_bgn::text`,
        [
          movementId,
          normalized.destinationWarehouseId,
          original.product_id,
          normalized.quantity,
          `return_${normalized.disposition}`,
          normalized.referenceId,
          auth.accountId,
          metadata.correlationId,
          original.unit_cost_bgn,
          original.customer_partner_id,
          original.batch_id,
        ],
      );
      await client.query(
        `INSERT INTO inventory.stock_balances (
           warehouse_id, product_id, quantity, average_unit_cost_bgn
         ) VALUES ($1, $2, $3, $4)
         ON CONFLICT (warehouse_id, product_id) DO UPDATE SET
           average_unit_cost_bgn = round((
             inventory.stock_balances.quantity * inventory.stock_balances.average_unit_cost_bgn
             + EXCLUDED.quantity * EXCLUDED.average_unit_cost_bgn
           ) / (inventory.stock_balances.quantity + EXCLUDED.quantity), 4),
           quantity = inventory.stock_balances.quantity + EXCLUDED.quantity,
           updated_at = now()`,
        [
          normalized.destinationWarehouseId,
          original.product_id,
          normalized.quantity,
          original.unit_cost_bgn,
        ],
      );
      if (original.batch_id)
        await client.query(
          `INSERT INTO inventory.batch_stock_balances (warehouse_id, batch_id, quantity)
           VALUES ($1, $2, $3)
           ON CONFLICT (warehouse_id, batch_id) DO UPDATE SET
             quantity = inventory.batch_stock_balances.quantity + EXCLUDED.quantity,
             updated_at = now()`,
          [normalized.destinationWarehouseId, original.batch_id, normalized.quantity],
        );
      await client.query(
        `INSERT INTO inventory.stock_returns (
           return_movement_id, original_issue_movement_id, disposition, quantity
         ) VALUES ($1, $2, $3, $4)`,
        [movementId, normalized.originalIssueId, normalized.disposition, normalized.quantity],
      );
      const serialItemIds = serialItems.map((item) => item.id);
      if (serialItemIds.length) {
        await client.query(
          `UPDATE inventory.serialized_items
           SET warehouse_id = $2, status = 'available', issued_movement_id = NULL
           WHERE id = ANY($1::uuid[])`,
          [serialItemIds, normalized.destinationWarehouseId],
        );
        await client.query(
          `INSERT INTO inventory.serial_item_return_events (
             serialized_item_id, original_issue_movement_id,
             return_movement_id, destination_warehouse_id
           ) SELECT unnest($1::uuid[]), $2, $3, $4`,
          [
            serialItemIds,
            normalized.originalIssueId,
            movementId,
            normalized.destinationWarehouseId,
          ],
        );
      }
      const result: StockReturn = {
        ...(original.batch_id ? { batchId: original.batch_id } : {}),
        destinationWarehouseId: normalized.destinationWarehouseId,
        disposition: normalized.disposition,
        id: movementId,
        originalIssueId: normalized.originalIssueId,
        productId: original.product_id,
        quantity: normalized.quantity,
        serialItemIds,
        totalCostBgn: required(movement.rows[0], 'Return valuation insert failed').total_cost_bgn,
        unitCostBgn: original.unit_cost_bgn,
      };
      await this.sideEffects(
        client,
        'stock_return',
        movementId,
        'inventory.stock.returned',
        result,
        auth,
        metadata,
        validKey(key),
      );
      await this.reconcileLowStockAlert(
        client,
        result.destinationWarehouseId,
        result.productId,
        metadata.correlationId,
      );
      return result;
    });
  }
  async transfer(
    input: TransferStockRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<StockTransfer> {
    const normalized = normalizeTransfer(input);
    return this.command('stock-transfer.create', key, normalized, async (client) => {
      const product = await activeProduct(client, normalized.productId);
      validateTransferTracking(product, normalized);
      await requireActiveWarehouses(client, normalized.fromWarehouseId, normalized.toWarehouseId);
      await ensureWarehousesNotUnderStocktake(client, [
        normalized.fromWarehouseId,
        normalized.toWarehouseId,
      ]);
      await lockTransferBalances(
        client,
        normalized.productId,
        normalized.fromWarehouseId,
        normalized.toWarehouseId,
      );
      await ensureUnreservedAvailability(
        client,
        normalized.fromWarehouseId,
        normalized.productId,
        normalized.quantity,
      );
      const fromMovementId = randomUUID();
      const toMovementId = randomUUID();
      const sourceBalance = await client.query<{ average_unit_cost_bgn: string }>(
        `UPDATE inventory.stock_balances
         SET quantity = quantity - $3, updated_at = now()
         WHERE warehouse_id = $1 AND product_id = $2 AND quantity >= $3
         RETURNING average_unit_cost_bgn::text`,
        [normalized.fromWarehouseId, normalized.productId, normalized.quantity],
      );
      if (!sourceBalance.rowCount)
        throw new ApiErrorException(
          'INSUFFICIENT_STOCK',
          'The source warehouse does not have sufficient available stock',
          HttpStatus.CONFLICT,
        );
      const transferCost = required(
        sourceBalance.rows[0],
        'Transfer balance update failed',
      ).average_unit_cost_bgn;
      await client.query(
        `INSERT INTO inventory.stock_balances (
           warehouse_id, product_id, quantity, average_unit_cost_bgn
         ) VALUES ($1, $2, $3, $4)
         ON CONFLICT (warehouse_id, product_id)
         DO UPDATE SET
           average_unit_cost_bgn = round((
             inventory.stock_balances.quantity * inventory.stock_balances.average_unit_cost_bgn
             + EXCLUDED.quantity * EXCLUDED.average_unit_cost_bgn
           ) / (inventory.stock_balances.quantity + EXCLUDED.quantity), 4),
           quantity = inventory.stock_balances.quantity + EXCLUDED.quantity,
           updated_at = now()`,
        [normalized.toWarehouseId, normalized.productId, normalized.quantity, transferCost],
      );
      await client.query(
        `INSERT INTO inventory.stock_movements (
           id, warehouse_id, product_id, movement_type, quantity, reference_type,
           reference_id, actor_account_id, correlation_id, unit_cost_bgn
         ) VALUES
           ($1, $2, $3, 'transfer_out', $4, 'transfer', $5, $6, $7, $10),
           ($8, $9, $3, 'transfer_in', $4, 'transfer', $5, $6, $7, $10)`,
        [
          fromMovementId,
          normalized.fromWarehouseId,
          normalized.productId,
          normalized.quantity,
          normalized.referenceId,
          auth.accountId,
          metadata.correlationId,
          toMovementId,
          normalized.toWarehouseId,
          transferCost,
        ],
      );
      const batchId = await transferBatch(client, normalized);
      const serialItemIds = await transferSerials(client, normalized, fromMovementId, toMovementId);
      const result: StockTransfer = {
        id: fromMovementId,
        fromMovementId,
        toMovementId,
        fromWarehouseId: normalized.fromWarehouseId,
        toWarehouseId: normalized.toWarehouseId,
        productId: normalized.productId,
        quantity: normalized.quantity,
        serialItemIds,
        totalCostBgn: multiplyFixed(normalized.quantity, transferCost),
        unitCostBgn: transferCost,
        ...(batchId ? { batchId } : {}),
      };
      await this.sideEffects(
        client,
        'stock_transfer',
        result.id,
        'inventory.stock.transferred',
        result,
        auth,
        metadata,
        validKey(key),
      );
      await this.reconcileLowStockAlert(
        client,
        result.fromWarehouseId,
        result.productId,
        metadata.correlationId,
      );
      await this.reconcileLowStockAlert(
        client,
        result.toWarehouseId,
        result.productId,
        metadata.correlationId,
      );
      return result;
    });
  }
  async reserve(
    input: CreateStockReservationRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<StockReservation> {
    const normalized = {
      warehouseId: input.warehouseId,
      productId: input.productId,
      quantity: normalizePositiveQuantity(input.quantity),
      referenceType: input.referenceType,
      referenceId: clean(input.referenceId, 'RESERVATION_REFERENCE_REQUIRED'),
      serialNumbers: normalizedSerialNumbers(input.serialNumbers),
    };
    return this.command('stock-reservation.create', key, normalized, async (client) => {
      const product = await activeProduct(client, normalized.productId);
      await requireActiveWarehouse(client, normalized.warehouseId);
      await ensureWarehousesNotUnderStocktake(client, [normalized.warehouseId]);
      validateReservationTracking(product, normalized);
      await ensureUnreservedAvailability(
        client,
        normalized.warehouseId,
        normalized.productId,
        normalized.quantity,
      );
      const inserted = await client.query<ReservationRow>(
        `INSERT INTO inventory.stock_reservations (
           warehouse_id, product_id, reference_type, reference_id,
           initial_quantity, remaining_quantity, created_by
         ) VALUES ($1, $2, $3, $4, $5, $5, $6)
         RETURNING id, warehouse_id, product_id, reference_type, reference_id,
           initial_quantity::text, remaining_quantity::text, status`,
        [
          normalized.warehouseId,
          normalized.productId,
          normalized.referenceType,
          normalized.referenceId,
          normalized.quantity,
          auth.accountId,
        ],
      );
      const row = required(inserted.rows[0], 'Stock reservation insert failed');
      const serialItemIds = await reserveSerials(client, normalized, row.id);
      const result = reservation(row, serialItemIds);
      await this.sideEffects(
        client,
        'stock_reservation',
        result.id,
        'inventory.stock.reserved',
        result,
        auth,
        metadata,
        validKey(key),
      );
      await this.reconcileLowStockAlert(
        client,
        result.warehouseId,
        result.productId,
        metadata.correlationId,
      );
      return result;
    });
  }
  async releaseReservation(
    reservationId: string,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<StockReservation> {
    return this.command('stock-reservation.release', key, { reservationId }, async (client) => {
      const found = await client.query<ReservationRow>(
        `SELECT id, warehouse_id, product_id, reference_type, reference_id,
             initial_quantity::text, remaining_quantity::text, status
           FROM inventory.stock_reservations WHERE id = $1 FOR UPDATE`,
        [reservationId],
      );
      const row = found.rows[0];
      if (!row)
        throw new ApiErrorException(
          'STOCK_RESERVATION_NOT_FOUND',
          'The stock reservation was not found',
          HttpStatus.NOT_FOUND,
        );
      if (row.status !== 'active')
        throw new ApiErrorException(
          'STOCK_RESERVATION_NOT_ACTIVE',
          'Only an active stock reservation can be released',
          HttpStatus.CONFLICT,
        );
      await client.query(
        `UPDATE inventory.stock_reservations
           SET status = 'released', ended_by = $2, ended_at = now(), version = version + 1
           WHERE id = $1`,
        [reservationId, auth.accountId],
      );
      const serials = await client.query<{ serialized_item_id: string }>(
        `UPDATE inventory.stock_reservation_serials
           SET active = false, ended_at = now()
           WHERE reservation_id = $1 AND active
           RETURNING serialized_item_id`,
        [reservationId],
      );
      const result = reservation(
        { ...row, status: 'released' },
        serials.rows.map((serial) => serial.serialized_item_id),
      );
      await this.sideEffects(
        client,
        'stock_reservation',
        result.id,
        'inventory.stock.reservation_released',
        result,
        auth,
        metadata,
        validKey(key),
      );
      await this.reconcileLowStockAlert(
        client,
        result.warehouseId,
        result.productId,
        metadata.correlationId,
      );
      return result;
    });
  }
  async openStocktake(
    input: OpenStocktakeRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<Stocktake> {
    const normalized = {
      warehouseId: input.warehouseId,
      referenceId: clean(input.referenceId, 'STOCKTAKE_REFERENCE_REQUIRED'),
    };
    return this.command('stocktake.open', key, normalized, async (client) => {
      await lockStocktakeWarehouses(client, [normalized.warehouseId]);
      const warehouse = await client.query<{ id: string }>(
        'SELECT id FROM master_data.warehouses WHERE id = $1 AND active FOR KEY SHARE',
        [normalized.warehouseId],
      );
      if (!warehouse.rowCount)
        throw new ApiErrorException(
          'WAREHOUSE_NOT_FOUND',
          'The selected warehouse was not found',
          HttpStatus.NOT_FOUND,
        );
      const existing = await client.query(
        "SELECT id FROM inventory.stocktakes WHERE warehouse_id = $1 AND status = 'open'",
        [normalized.warehouseId],
      );
      if (existing.rowCount)
        throw new ApiErrorException(
          'STOCKTAKE_ALREADY_OPEN',
          'This warehouse already has an open stocktake',
          HttpStatus.CONFLICT,
        );
      const inserted = await client.query<{
        id: string;
        warehouse_id: string;
        reference_id: string;
        status: Stocktake['status'];
      }>(
        `INSERT INTO inventory.stocktakes (warehouse_id, reference_id, opened_by)
         VALUES ($1, $2, $3) RETURNING id, warehouse_id, reference_id, status`,
        [normalized.warehouseId, normalized.referenceId, auth.accountId],
      );
      const row = required(inserted.rows[0], 'Stocktake insert failed');
      const result: Stocktake = {
        id: row.id,
        warehouseId: row.warehouse_id,
        referenceId: row.reference_id,
        status: row.status,
      };
      await this.sideEffects(
        client,
        'stocktake',
        result.id,
        'inventory.stocktake.opened',
        result,
        auth,
        metadata,
        validKey(key),
      );
      return result;
    });
  }
  async recordStocktakeCount(
    stocktakeId: string,
    input: RecordStocktakeCountRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<Stocktake> {
    const normalized = {
      stocktakeId,
      productId: input.productId,
      countedQuantity: normalizeQuantity(input.countedQuantity),
      serialNumbers: normalizedSerialNumbers(input.serialNumbers),
      batches: normalizeStocktakeBatches(input.batches),
    };
    return this.command('stocktake.count', key, normalized, async (client) => {
      const session = await client.query<{
        id: string;
        warehouse_id: string;
        reference_id: string;
        status: Stocktake['status'];
      }>(
        'SELECT id, warehouse_id, reference_id, status FROM inventory.stocktakes WHERE id = $1 FOR UPDATE',
        [stocktakeId],
      );
      const row = session.rows[0];
      if (!row)
        throw new ApiErrorException(
          'STOCKTAKE_NOT_FOUND',
          'The stocktake was not found',
          HttpStatus.NOT_FOUND,
        );
      if (row.status !== 'open')
        throw new ApiErrorException(
          'STOCKTAKE_NOT_OPEN',
          'Counts can be recorded only on an open stocktake',
          HttpStatus.CONFLICT,
        );
      const product = await activeProduct(client, normalized.productId);
      validateStocktakeTracking(product, normalized);
      const balance = await client.query<{ quantity: string }>(
        'SELECT quantity::text FROM inventory.stock_balances WHERE warehouse_id = $1 AND product_id = $2 FOR KEY SHARE',
        [row.warehouse_id, normalized.productId],
      );
      const count = await client.query<{ id: string }>(
        `INSERT INTO inventory.stocktake_counts (stocktake_id, product_id, expected_quantity, counted_quantity, counted_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (stocktake_id, product_id) DO UPDATE SET counted_quantity = EXCLUDED.counted_quantity, counted_by = EXCLUDED.counted_by, counted_at = now()
         RETURNING id`,
        [
          stocktakeId,
          normalized.productId,
          balance.rows[0]?.quantity ?? '0.0000',
          normalized.countedQuantity,
          auth.accountId,
        ],
      );
      const countId = required(count.rows[0], 'Stocktake count insert failed').id;
      await client.query(
        'DELETE FROM inventory.stocktake_serial_counts WHERE stocktake_count_id = $1',
        [countId],
      );
      await client.query(
        'DELETE FROM inventory.stocktake_batch_counts WHERE stocktake_count_id = $1',
        [countId],
      );
      if (product.tracking_mode === 'serial' && normalized.serialNumbers.length) {
        const serials = await client.query<{ id: string }>(
          `SELECT id FROM inventory.serialized_items
           WHERE warehouse_id = $1 AND product_id = $2 AND status = 'available'
             AND upper(serial_number) = ANY($3::text[]) FOR UPDATE`,
          [row.warehouse_id, normalized.productId, normalized.serialNumbers],
        );
        if (serials.rowCount !== normalized.serialNumbers.length)
          throw new ApiErrorException(
            'STOCKTAKE_SERIAL_NOT_AVAILABLE',
            'Every counted serial must be available in the stocktake warehouse',
            HttpStatus.CONFLICT,
          );
        await client.query(
          `INSERT INTO inventory.stocktake_serial_counts (stocktake_count_id, serialized_item_id)
           SELECT $1, unnest($2::uuid[])`,
          [countId, serials.rows.map((serial) => serial.id)],
        );
      }
      for (const batchCount of normalized.batches) {
        const batch = await client.query<{ id: string }>(
          `INSERT INTO inventory.batches (product_id, batch_number, expires_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (product_id, batch_number)
           DO UPDATE SET expires_at = COALESCE(inventory.batches.expires_at, EXCLUDED.expires_at)
           RETURNING id`,
          [normalized.productId, batchCount.batchNumber, batchCount.expiresAt ?? null],
        );
        await client.query(
          `INSERT INTO inventory.stocktake_batch_counts (stocktake_count_id, batch_id, counted_quantity)
           VALUES ($1, $2, $3)`,
          [
            countId,
            required(batch.rows[0], 'Stocktake batch insert failed').id,
            batchCount.countedQuantity,
          ],
        );
      }
      const result: Stocktake = {
        id: row.id,
        warehouseId: row.warehouse_id,
        referenceId: row.reference_id,
        status: row.status,
      };
      await this.sideEffects(
        client,
        'stocktake',
        result.id,
        'inventory.stocktake.count_recorded',
        {
          ...result,
          productId: normalized.productId,
          countedQuantity: normalized.countedQuantity,
          serialNumbers: normalized.serialNumbers,
          batches: normalized.batches,
        },
        auth,
        metadata,
        validKey(key),
      );
      return result;
    });
  }
  async completeStocktake(
    stocktakeId: string,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<Stocktake> {
    return this.command('stocktake.complete', key, { stocktakeId }, async (client) => {
      const session = await client.query<{
        id: string;
        warehouse_id: string;
        reference_id: string;
        status: Stocktake['status'];
      }>(
        'SELECT id, warehouse_id, reference_id, status FROM inventory.stocktakes WHERE id = $1 FOR UPDATE',
        [stocktakeId],
      );
      const row = session.rows[0];
      if (!row)
        throw new ApiErrorException(
          'STOCKTAKE_NOT_FOUND',
          'The stocktake was not found',
          HttpStatus.NOT_FOUND,
        );
      if (row.status !== 'open')
        throw new ApiErrorException(
          'STOCKTAKE_NOT_OPEN',
          'Only an open stocktake can be completed',
          HttpStatus.CONFLICT,
        );
      await lockStocktakeWarehouses(client, [row.warehouse_id]);
      const missing = await client.query<{ product_id: string }>(
        `SELECT balance.product_id FROM inventory.stock_balances balance
         LEFT JOIN inventory.stocktake_counts count ON count.stocktake_id = $1 AND count.product_id = balance.product_id
         WHERE balance.warehouse_id = $2 AND count.id IS NULL LIMIT 1`,
        [stocktakeId, row.warehouse_id],
      );
      if (missing.rowCount)
        throw new ApiErrorException(
          'STOCKTAKE_COUNTS_INCOMPLETE',
          'Every stocked product requires a physical count before completion',
          HttpStatus.CONFLICT,
        );
      const counts = await client.query<{
        average_unit_cost_bgn: string;
        id: string;
        product_id: string;
        expected_quantity: string;
        counted_quantity: string;
        tracking_mode: ProductTrackingMode;
      }>(
        `SELECT count.id, count.product_id, count.expected_quantity::text,
           count.counted_quantity::text, category.tracking_mode,
           COALESCE(balance.average_unit_cost_bgn, 0)::numeric(18, 4)::text AS average_unit_cost_bgn
         FROM inventory.stocktake_counts count JOIN master_data.products product ON product.id = count.product_id
         JOIN master_data.product_categories category ON category.id = product.category_id
         LEFT JOIN inventory.stock_balances balance
           ON balance.warehouse_id = $2 AND balance.product_id = count.product_id
         WHERE count.stocktake_id = $1 FOR UPDATE OF count`,
        [stocktakeId, row.warehouse_id],
      );
      const reservationConflict = await client.query(
        `SELECT reserved.product_id
         FROM inventory.stock_reservations reserved
         LEFT JOIN inventory.stocktake_counts count
           ON count.stocktake_id = $1 AND count.product_id = reserved.product_id
         WHERE reserved.warehouse_id = $2 AND reserved.status = 'active'
         GROUP BY reserved.product_id, count.id, count.counted_quantity
         HAVING count.id IS NULL OR sum(reserved.remaining_quantity) > count.counted_quantity
         LIMIT 1`,
        [stocktakeId, row.warehouse_id],
      );
      if (reservationConflict.rowCount)
        throw new ApiErrorException(
          'STOCKTAKE_BELOW_RESERVED_QUANTITY',
          'A physical count cannot reduce stock below active reservations',
          HttpStatus.CONFLICT,
        );
      for (const count of counts.rows) {
        const changed = count.expected_quantity !== count.counted_quantity;
        const difference = decimalDifference(count.counted_quantity, count.expected_quantity);
        const movementId = changed ? randomUUID() : undefined;
        if (movementId)
          await client.query(
            `INSERT INTO inventory.stock_movements (
               id, warehouse_id, product_id, movement_type, quantity, reference_type,
               reference_id, actor_account_id, correlation_id, unit_cost_bgn
             ) VALUES ($1, $2, $3, $4, $5, 'stocktake', $6, $7, $8, $9)`,
            [
              movementId,
              row.warehouse_id,
              count.product_id,
              difference.positive ? 'stocktake_in' : 'stocktake_out',
              difference.quantity,
              stocktakeId,
              auth.accountId,
              metadata.correlationId,
              count.average_unit_cost_bgn,
            ],
          );
        if (count.tracking_mode === 'serial')
          await completeSerialStocktake(client, count, row.warehouse_id, movementId);
        if (count.tracking_mode === 'batch')
          await completeBatchStocktake(client, count, row.warehouse_id);
        if (changed)
          await client.query(
            `INSERT INTO inventory.stock_balances (warehouse_id, product_id, quantity)
             VALUES ($1, $2, $3)
             ON CONFLICT (warehouse_id, product_id)
             DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
            [row.warehouse_id, count.product_id, count.counted_quantity],
          );
      }
      await client.query(
        "UPDATE inventory.stocktakes SET status = 'completed', completed_by = $2, completed_at = now() WHERE id = $1",
        [stocktakeId, auth.accountId],
      );
      const result: Stocktake = {
        id: row.id,
        warehouseId: row.warehouse_id,
        referenceId: row.reference_id,
        status: 'completed',
      };
      await this.sideEffects(
        client,
        'stocktake',
        result.id,
        'inventory.stocktake.completed',
        result,
        auth,
        metadata,
        validKey(key),
      );
      for (const count of counts.rows)
        await this.reconcileLowStockAlert(
          client,
          result.warehouseId,
          count.product_id,
          metadata.correlationId,
        );
      return result;
    });
  }
  private async reconcileLowStockAlert(
    client: PoolClient,
    warehouseId: string,
    productId: string,
    correlationId: string,
  ): Promise<void> {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('inventory.low-stock:' || $1 || ':' || $2))",
      [warehouseId, productId],
    );
    const statusResult = await client.query<{
      available_quantity: string;
      low_stock: boolean;
      minimum_quantity: string;
      recommended_quantity: string;
      target_quantity: string;
    }>(
      `SELECT available_quantity::text, low_stock, minimum_quantity::text,
         recommended_quantity::text, target_quantity::text
       FROM inventory.stock_replenishment_status
       WHERE warehouse_id = $1 AND product_id = $2`,
      [warehouseId, productId],
    );
    const status = statusResult.rows[0];
    if (!status) return;
    await client.query(
      `INSERT INTO inventory.low_stock_alert_state (warehouse_id, product_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [warehouseId, productId],
    );
    const stateResult = await client.query<{ cycle_number: string; is_low_stock: boolean }>(
      `SELECT cycle_number::text, is_low_stock
       FROM inventory.low_stock_alert_state
       WHERE warehouse_id = $1 AND product_id = $2 FOR UPDATE`,
      [warehouseId, productId],
    );
    const state = required(stateResult.rows[0], 'Low-stock alert state insert failed');
    const cycleNumber =
      status.low_stock && !state.is_low_stock
        ? (BigInt(state.cycle_number) + 1n).toString()
        : state.cycle_number;
    if (status.low_stock) {
      const subscriptions = await client.query<{ recipient_account_id: string }>(
        `SELECT subscription.recipient_account_id
         FROM inventory.stock_alert_subscriptions subscription
         JOIN identity.user_accounts account ON account.id = subscription.recipient_account_id
         WHERE subscription.warehouse_id = $1 AND subscription.product_id = $2
           AND subscription.active AND account.status = 'active'`,
        [warehouseId, productId],
      );
      for (const subscription of subscriptions.rows) {
        const idempotencyKey = `inventory.low-stock:${warehouseId}:${productId}:${cycleNumber}:${subscription.recipient_account_id}`;
        await client.query(
          `INSERT INTO integration.outbox_events (
             id, aggregate_type, aggregate_id, event_type, event_version,
             correlation_id, idempotency_key, payload
           ) VALUES ($1, 'inventory_product', $2, $3, 1, $4, $5, $6)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            randomUUID(),
            productId,
            lowStockEventType,
            correlationId,
            idempotencyKey,
            {
              availableQuantity: status.available_quantity,
              cycleNumber,
              minimumQuantity: status.minimum_quantity,
              productId,
              recipientAccountId: subscription.recipient_account_id,
              recommendedQuantity: status.recommended_quantity,
              targetQuantity: status.target_quantity,
              warehouseId,
            },
          ],
        );
      }
    }
    await client.query(
      `UPDATE inventory.low_stock_alert_state
       SET is_low_stock = $3, cycle_number = $4, evaluated_at = now()
       WHERE warehouse_id = $1 AND product_id = $2`,
      [warehouseId, productId, status.low_stock, cycleNumber],
    );
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
    ...(row.business_location_id ? { businessLocationId: row.business_location_id } : {}),
    id: row.id,
    code: row.code,
    name: row.name,
    ...(row.technician_operator_id ? { technicianOperatorId: row.technician_operator_id } : {}),
    type: row.warehouse_type,
    active: row.active,
    version: row.version,
  };
}
function reservation(row: ReservationRow, serialItemIds: string[]): StockReservation {
  return {
    id: row.id,
    initialQuantity: row.initial_quantity,
    productId: row.product_id,
    referenceId: row.reference_id,
    referenceType: row.reference_type,
    remainingQuantity: row.remaining_quantity,
    serialItemIds,
    status: row.status,
    warehouseId: row.warehouse_id,
  };
}
function traceMovement(row: TraceMovementRow): SerialTraceEvent {
  return {
    actor: { id: row.actor_id, displayName: row.actor_name },
    eventType: row.event_type,
    movementId: row.movement_id,
    occurredAt: row.occurred_at,
    referenceId: row.reference_id,
    referenceType: row.reference_type,
    unitCostBgn: row.unit_cost_bgn,
    warehouse: { id: row.warehouse_id, displayName: row.warehouse_name },
    ...(row.supplier_id && row.supplier_name
      ? { supplier: { id: row.supplier_id, displayName: row.supplier_name } }
      : {}),
    ...(row.customer_id && row.customer_name
      ? { customer: { id: row.customer_id, displayName: row.customer_name } }
      : {}),
    ...(row.technician_id && row.technician_name
      ? { technician: { id: row.technician_id, displayName: row.technician_name } }
      : {}),
  };
}
function traceTransfer(row: TraceTransferRow): SerialTraceEvent {
  return {
    actor: { id: row.actor_id, displayName: row.actor_name },
    eventType: 'transfer',
    fromWarehouse: { id: row.from_warehouse_id, displayName: row.from_warehouse_name },
    movementId: row.movement_id,
    occurredAt: row.occurred_at,
    referenceId: row.reference_id,
    referenceType: row.reference_type,
    toWarehouse: { id: row.to_warehouse_id, displayName: row.to_warehouse_name },
    unitCostBgn: row.unit_cost_bgn,
    warehouse: { id: row.warehouse_id, displayName: row.warehouse_name },
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
): Promise<Record<string, unknown> | undefined> {
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
  if (row.status === 'completed' && isRecord(row.response_body)) return row.response_body;
  throw new ApiErrorException(
    'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    'The original request is still being processed',
    HttpStatus.CONFLICT,
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
    quantity: normalizePositiveQuantity(input.quantity),
    referenceId: clean(input.referenceId, 'RECEIPT_REFERENCE_REQUIRED'),
    serialNumbers,
    unitCostBgn: normalizeMoney(input.unitCostBgn ?? '0'),
    ...(input.supplierPartnerId ? { supplierPartnerId: input.supplierPartnerId } : {}),
    ...(input.batchNumber
      ? { batchNumber: clean(input.batchNumber, 'BATCH_NUMBER_REQUIRED') }
      : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  };
}
function normalizeIssue(input: IssueStockRequest) {
  const serialNumbers = normalizedSerialNumbers(input.serialNumbers);
  return {
    warehouseId: input.warehouseId,
    productId: input.productId,
    quantity: normalizePositiveQuantity(input.quantity),
    reason: input.reason,
    referenceId: clean(input.referenceId, 'ISSUE_REFERENCE_REQUIRED'),
    serialNumbers,
    ...(input.customerPartnerId ? { customerPartnerId: input.customerPartnerId } : {}),
    ...(input.technicianAccountId ? { technicianAccountId: input.technicianAccountId } : {}),
    ...(input.reservationId ? { reservationId: input.reservationId } : {}),
    ...(input.batchNumber
      ? { batchNumber: clean(input.batchNumber, 'BATCH_NUMBER_REQUIRED') }
      : {}),
  };
}
function normalizeReturn(input: ReturnStockRequest) {
  return {
    destinationWarehouseId: input.destinationWarehouseId,
    disposition: input.disposition,
    originalIssueId: input.originalIssueId,
    quantity: normalizePositiveQuantity(input.quantity),
    referenceId: clean(input.referenceId, 'RETURN_REFERENCE_REQUIRED'),
    serialNumbers: normalizedSerialNumbers(input.serialNumbers),
  };
}
function normalizeTransfer(input: TransferStockRequest) {
  if (input.fromWarehouseId === input.toWarehouseId)
    throw new ApiErrorException(
      'TRANSFER_WAREHOUSE_SAME',
      'Source and destination warehouses must differ',
      HttpStatus.BAD_REQUEST,
    );
  return {
    fromWarehouseId: input.fromWarehouseId,
    toWarehouseId: input.toWarehouseId,
    productId: input.productId,
    quantity: normalizePositiveQuantity(input.quantity),
    referenceId: clean(input.referenceId, 'TRANSFER_REFERENCE_REQUIRED'),
    serialNumbers: normalizedSerialNumbers(input.serialNumbers),
    ...(input.batchNumber
      ? { batchNumber: clean(input.batchNumber, 'BATCH_NUMBER_REQUIRED') }
      : {}),
  };
}
function normalizeStocktakeBatches(values: RecordStocktakeCountRequest['batches'] = []) {
  const batches = values.map((value) => ({
    batchNumber: clean(value.batchNumber, 'BATCH_NUMBER_REQUIRED'),
    countedQuantity: normalizeQuantity(value.countedQuantity),
    ...(value.expiresAt ? { expiresAt: value.expiresAt } : {}),
  }));
  const uniqueBatchNumbers = new Set(batches.map((batch) => batch.batchNumber.toUpperCase()));
  if (uniqueBatchNumbers.size !== batches.length)
    throw new ApiErrorException(
      'STOCKTAKE_BATCH_DUPLICATE',
      'Each batch can appear only once in a stocktake count',
      HttpStatus.BAD_REQUEST,
    );
  return batches;
}
function validateStocktakeTracking(
  product: ProductRow,
  input: {
    batches: ReturnType<typeof normalizeStocktakeBatches>;
    countedQuantity: string;
    serialNumbers: string[];
  },
) {
  if (product.tracking_mode === 'none' && (input.serialNumbers.length || input.batches.length))
    throw new ApiErrorException(
      'STOCKTAKE_TRACKING_NOT_ALLOWED',
      'Tracking evidence is not allowed for this product',
      HttpStatus.BAD_REQUEST,
    );
  if (product.tracking_mode === 'serial') {
    if (input.batches.length)
      throw new ApiErrorException(
        'BATCH_TRACKING_NOT_ALLOWED',
        'Serial-tracked products do not allow batch evidence',
        HttpStatus.BAD_REQUEST,
      );
    if (
      !isWholeQuantity(input.countedQuantity) ||
      input.serialNumbers.length !== Number(input.countedQuantity)
    )
      throw new ApiErrorException(
        'STOCKTAKE_SERIAL_COUNT_MISMATCH',
        'Serial-tracked counts require one serial number per counted whole unit',
        HttpStatus.BAD_REQUEST,
      );
  }
  if (product.tracking_mode === 'batch') {
    if (input.serialNumbers.length)
      throw new ApiErrorException(
        'SERIAL_TRACKING_NOT_ALLOWED',
        'Batch-tracked products do not allow serial evidence',
        HttpStatus.BAD_REQUEST,
      );
    if (
      sumQuantities(input.batches.map((batch) => batch.countedQuantity)) !== input.countedQuantity
    )
      throw new ApiErrorException(
        'STOCKTAKE_BATCH_COUNT_MISMATCH',
        'Batch quantities must equal the product counted quantity',
        HttpStatus.BAD_REQUEST,
      );
    if (product.requires_expiry && input.batches.some((batch) => !batch.expiresAt))
      throw new ApiErrorException(
        'EXPIRY_REQUIRED',
        'Every counted batch for this product requires an expiry date',
        HttpStatus.BAD_REQUEST,
      );
  }
}
function validateReservationTracking(
  product: ProductRow,
  input: {
    quantity: string;
    serialNumbers: string[];
  },
) {
  if (
    product.tracking_mode === 'serial' &&
    (!isWholeQuantity(input.quantity) || input.serialNumbers.length !== Number(input.quantity))
  )
    throw new ApiErrorException(
      'RESERVATION_SERIAL_COUNT_MISMATCH',
      'Serial-tracked reservations require one serial number per whole unit',
      HttpStatus.BAD_REQUEST,
    );
  if (product.tracking_mode !== 'serial' && input.serialNumbers.length)
    throw new ApiErrorException(
      'SERIAL_TRACKING_NOT_ALLOWED',
      'This product does not allow serial-specific reservations',
      HttpStatus.BAD_REQUEST,
    );
}
function normalizedSerialNumbers(values: string[] | undefined): string[] {
  const serialNumbers = [
    ...new Set((values ?? []).map((value) => cleanCode(value, 'SERIAL_NUMBER_REQUIRED'))),
  ];
  if (serialNumbers.length !== (values ?? []).length)
    throw new ApiErrorException(
      'SERIAL_NUMBER_DUPLICATE',
      'Each serial number can appear only once in a command',
      HttpStatus.BAD_REQUEST,
    );
  return serialNumbers;
}
async function activeProduct(client: PoolClient, productId: string): Promise<ProductRow> {
  const result = await client.query<ProductRow>(
    `SELECT p.id, c.tracking_mode, c.requires_expiry
     FROM master_data.products p
     JOIN master_data.product_categories c ON c.id = p.category_id
     WHERE p.id = $1 AND p.active AND c.active FOR KEY SHARE`,
    [productId],
  );
  const product = result.rows[0];
  if (!product)
    throw new ApiErrorException(
      'PRODUCT_NOT_FOUND',
      'The selected product was not found',
      HttpStatus.NOT_FOUND,
    );
  return product;
}
async function requirePartnerRole(
  client: PoolClient,
  partnerId: string,
  role: 'customer' | 'supplier',
): Promise<void> {
  const found = await client.query(
    `SELECT partner.id FROM master_data.partners partner
     JOIN master_data.partner_roles role ON role.partner_id = partner.id
     WHERE partner.id = $1 AND partner.active AND role.role = $2 FOR KEY SHARE OF partner`,
    [partnerId, role],
  );
  if (!found.rowCount)
    throw new ApiErrorException(
      role === 'supplier' ? 'SUPPLIER_NOT_FOUND' : 'CUSTOMER_NOT_FOUND',
      `The selected ${role} was not found or does not have the required role`,
      HttpStatus.NOT_FOUND,
    );
}
async function requireActiveTechnician(client: PoolClient, accountId: string): Promise<void> {
  const found = await client.query(
    `SELECT account.id FROM identity.user_accounts account
     JOIN identity.employees employee ON employee.id = account.employee_id
     WHERE account.id = $1 AND account.status = 'active' AND employee.active FOR KEY SHARE OF account`,
    [accountId],
  );
  if (!found.rowCount)
    throw new ApiErrorException(
      'TECHNICIAN_NOT_FOUND',
      'The selected technician account was not found or is inactive',
      HttpStatus.NOT_FOUND,
    );
}
type StocktakeCompletionCount = {
  counted_quantity: string;
  expected_quantity: string;
  id: string;
  product_id: string;
};
async function completeSerialStocktake(
  client: PoolClient,
  count: StocktakeCompletionCount,
  warehouseId: string,
  movementId: string | undefined,
): Promise<void> {
  if (!isWholeQuantity(count.expected_quantity) || !isWholeQuantity(count.counted_quantity))
    throw new ApiErrorException(
      'STOCKTAKE_SERIAL_BALANCE_INVALID',
      'Serial-tracked inventory must use whole-unit balances',
      HttpStatus.CONFLICT,
    );
  const [available, evidence] = await Promise.all([
    client.query<{ id: string }>(
      `SELECT id FROM inventory.serialized_items
       WHERE warehouse_id = $1 AND product_id = $2 AND status = 'available' FOR UPDATE`,
      [warehouseId, count.product_id],
    ),
    client.query<{ serialized_item_id: string }>(
      'SELECT serialized_item_id FROM inventory.stocktake_serial_counts WHERE stocktake_count_id = $1',
      [count.id],
    ),
  ]);
  if (
    available.rowCount !== Number(count.expected_quantity) ||
    evidence.rowCount !== Number(count.counted_quantity)
  )
    throw new ApiErrorException(
      'STOCKTAKE_SERIAL_EVIDENCE_INVALID',
      'Serial evidence does not reconcile with the expected and counted quantities',
      HttpStatus.CONFLICT,
    );
  const countedIds = new Set(evidence.rows.map((item) => item.serialized_item_id));
  const missingIds = available.rows.map((item) => item.id).filter((id) => !countedIds.has(id));
  if (!missingIds.length) return;
  if (!movementId)
    throw new ApiErrorException(
      'STOCKTAKE_SERIAL_EVIDENCE_INVALID',
      'Missing serial evidence requires an inventory adjustment',
      HttpStatus.CONFLICT,
    );
  await client.query(
    `UPDATE inventory.serialized_items
     SET status = 'missing', stocktake_movement_id = $2
     WHERE id = ANY($1::uuid[])`,
    [missingIds, movementId],
  );
}
async function completeBatchStocktake(
  client: PoolClient,
  count: StocktakeCompletionCount,
  warehouseId: string,
): Promise<void> {
  const [current, evidence] = await Promise.all([
    client.query<{ batch_id: string; quantity: string }>(
      `SELECT balance.batch_id, balance.quantity::text
       FROM inventory.batch_stock_balances balance
       JOIN inventory.batches batch ON batch.id = balance.batch_id
       WHERE balance.warehouse_id = $1 AND batch.product_id = $2 AND balance.quantity > 0
       FOR UPDATE OF balance`,
      [warehouseId, count.product_id],
    ),
    client.query<{ batch_id: string; counted_quantity: string }>(
      `SELECT batch_id, counted_quantity::text
       FROM inventory.stocktake_batch_counts WHERE stocktake_count_id = $1`,
      [count.id],
    ),
  ]);
  const evidenceIds = new Set(evidence.rows.map((batch) => batch.batch_id));
  if (current.rows.some((batch) => !evidenceIds.has(batch.batch_id)))
    throw new ApiErrorException(
      'STOCKTAKE_BATCH_EVIDENCE_INCOMPLETE',
      'Every stocked batch requires a physical count before completion',
      HttpStatus.CONFLICT,
    );
  if (
    sumQuantities(current.rows.map((batch) => batch.quantity)) !== count.expected_quantity ||
    sumQuantities(evidence.rows.map((batch) => batch.counted_quantity)) !== count.counted_quantity
  )
    throw new ApiErrorException(
      'STOCKTAKE_BATCH_EVIDENCE_INVALID',
      'Batch evidence does not reconcile with the product quantities',
      HttpStatus.CONFLICT,
    );
  for (const batch of evidence.rows) {
    await client.query(
      `INSERT INTO inventory.batch_stock_balances (warehouse_id, batch_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (warehouse_id, batch_id)
       DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
      [warehouseId, batch.batch_id, batch.counted_quantity],
    );
  }
}
function validateIssueTracking(product: ProductRow, input: ReturnType<typeof normalizeIssue>) {
  if (
    product.tracking_mode === 'serial' &&
    (input.serialNumbers.length === 0 ||
      !isWholeQuantity(input.quantity) ||
      input.serialNumbers.length !== Number(input.quantity))
  )
    throw new ApiErrorException(
      'SERIAL_TRACKING_REQUIRED',
      'Serial-tracked issues need one available serial number per whole unit',
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
      'Batch-tracked issues require a batch number',
      HttpStatus.BAD_REQUEST,
    );
  if (product.tracking_mode !== 'batch' && input.batchNumber)
    throw new ApiErrorException(
      'BATCH_TRACKING_NOT_ALLOWED',
      'This product category does not allow batches',
      HttpStatus.BAD_REQUEST,
    );
}
function validateReturnTracking(
  product: ProductRow,
  input: ReturnType<typeof normalizeReturn>,
  batchId: string | null,
) {
  if (
    product.tracking_mode === 'serial' &&
    (input.serialNumbers.length === 0 ||
      !isWholeQuantity(input.quantity) ||
      input.serialNumbers.length !== Number(input.quantity))
  )
    throw new ApiErrorException(
      'RETURN_SERIAL_TRACKING_REQUIRED',
      'Serial-tracked returns need one serial from the original issue per whole unit',
      HttpStatus.BAD_REQUEST,
    );
  if (product.tracking_mode !== 'serial' && input.serialNumbers.length)
    throw new ApiErrorException(
      'RETURN_SERIAL_TRACKING_NOT_ALLOWED',
      'This returned product does not use serial tracking',
      HttpStatus.BAD_REQUEST,
    );
  if (product.tracking_mode === 'batch' && !batchId)
    throw new ApiErrorException(
      'RETURN_BATCH_EVIDENCE_MISSING',
      'The original issue does not contain batch evidence required for a safe return',
      HttpStatus.CONFLICT,
    );
}
function validateTransferTracking(
  product: ProductRow,
  input: ReturnType<typeof normalizeTransfer>,
) {
  if (
    product.tracking_mode === 'serial' &&
    (input.serialNumbers.length === 0 ||
      !isWholeQuantity(input.quantity) ||
      input.serialNumbers.length !== Number(input.quantity))
  )
    throw new ApiErrorException(
      'SERIAL_TRACKING_REQUIRED',
      'Serial-tracked transfers need one available serial number per whole unit',
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
      'Batch-tracked transfers require a batch number',
      HttpStatus.BAD_REQUEST,
    );
  if (product.tracking_mode !== 'batch' && input.batchNumber)
    throw new ApiErrorException(
      'BATCH_TRACKING_NOT_ALLOWED',
      'This product category does not allow batches',
      HttpStatus.BAD_REQUEST,
    );
}
async function requireActiveWarehouses(
  client: PoolClient,
  fromWarehouseId: string,
  toWarehouseId: string,
): Promise<void> {
  const ids = [fromWarehouseId, toWarehouseId].sort();
  const found = await client.query<{ id: string }>(
    'SELECT id FROM master_data.warehouses WHERE id = ANY($1::uuid[]) AND active FOR KEY SHARE',
    [ids],
  );
  if (found.rowCount !== 2)
    throw new ApiErrorException(
      'WAREHOUSE_NOT_FOUND',
      'A selected warehouse was not found',
      HttpStatus.NOT_FOUND,
    );
}
async function requireActiveWarehouse(client: PoolClient, warehouseId: string): Promise<void> {
  const found = await client.query(
    'SELECT id FROM master_data.warehouses WHERE id = $1 AND active FOR KEY SHARE',
    [warehouseId],
  );
  if (!found.rowCount)
    throw new ApiErrorException(
      'WAREHOUSE_NOT_FOUND',
      'The selected warehouse was not found',
      HttpStatus.NOT_FOUND,
    );
}
async function lockStocktakeWarehouses(client: PoolClient, warehouseIds: string[]): Promise<void> {
  for (const warehouseId of [...new Set(warehouseIds)].sort()) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `warehouse-stocktake:${warehouseId}`,
    ]);
  }
}
async function ensureWarehousesNotUnderStocktake(
  client: PoolClient,
  warehouseIds: string[],
): Promise<void> {
  const ids = [...new Set(warehouseIds)].sort();
  await lockStocktakeWarehouses(client, ids);
  const stocktake = await client.query(
    "SELECT id FROM inventory.stocktakes WHERE warehouse_id = ANY($1::uuid[]) AND status = 'open' LIMIT 1",
    [ids],
  );
  if (stocktake.rowCount)
    throw new ApiErrorException(
      'WAREHOUSE_STOCKTAKE_OPEN',
      'Stock movements are paused while a warehouse stocktake is open',
      HttpStatus.CONFLICT,
    );
}
async function ensureUnreservedAvailability(
  client: PoolClient,
  warehouseId: string,
  productId: string,
  requestedQuantity: string,
): Promise<void> {
  const balance = await client.query<{ quantity: string }>(
    `SELECT quantity::text FROM inventory.stock_balances
     WHERE warehouse_id = $1 AND product_id = $2 FOR UPDATE`,
    [warehouseId, productId],
  );
  const physical = balance.rows[0]?.quantity ?? '0.0000';
  if (fixedDecimal(physical) < fixedDecimal(requestedQuantity))
    throw new ApiErrorException(
      'INSUFFICIENT_STOCK',
      'The warehouse does not have sufficient physical stock',
      HttpStatus.CONFLICT,
    );
  const reserved = await client.query<{ quantity: string }>(
    `SELECT COALESCE(sum(remaining_quantity), 0)::numeric(18, 4)::text AS quantity
     FROM inventory.stock_reservations
     WHERE warehouse_id = $1 AND product_id = $2 AND status = 'active'`,
    [warehouseId, productId],
  );
  const reservedQuantity = required(reserved.rows[0], 'Reserved quantity query failed').quantity;
  if (fixedDecimal(physical) - fixedDecimal(reservedQuantity) < fixedDecimal(requestedQuantity))
    throw new ApiErrorException(
      'INSUFFICIENT_AVAILABLE_STOCK',
      'The requested quantity is committed to active reservations',
      HttpStatus.CONFLICT,
    );
}
async function reserveSerials(
  client: PoolClient,
  input: {
    productId: string;
    serialNumbers: string[];
    warehouseId: string;
  },
  reservationId: string,
): Promise<string[]> {
  if (!input.serialNumbers.length) return [];
  const serials = await client.query<{ id: string }>(
    `SELECT item.id FROM inventory.serialized_items item
     WHERE item.warehouse_id = $1 AND item.product_id = $2 AND item.status = 'available'
       AND upper(item.serial_number) = ANY($3::text[])
       AND NOT EXISTS (
         SELECT 1 FROM inventory.stock_reservation_serials reserved
         WHERE reserved.serialized_item_id = item.id AND reserved.active
       )
     FOR UPDATE`,
    [input.warehouseId, input.productId, input.serialNumbers],
  );
  if (serials.rowCount !== input.serialNumbers.length)
    throw new ApiErrorException(
      'RESERVATION_SERIAL_NOT_AVAILABLE',
      'One or more serial numbers are unavailable or already reserved',
      HttpStatus.CONFLICT,
    );
  const ids = serials.rows.map((serial) => serial.id);
  await client.query(
    `INSERT INTO inventory.stock_reservation_serials (reservation_id, serialized_item_id)
     SELECT $1, unnest($2::uuid[])`,
    [reservationId, ids],
  );
  return ids;
}
async function consumeReservation(
  client: PoolClient,
  input: ReturnType<typeof normalizeIssue> & { reservationId: string },
  accountId: string,
): Promise<void> {
  const found = await client.query<ReservationRow>(
    `SELECT id, warehouse_id, product_id, reference_type, reference_id,
       initial_quantity::text, remaining_quantity::text, status
     FROM inventory.stock_reservations WHERE id = $1 FOR UPDATE`,
    [input.reservationId],
  );
  const row = found.rows[0];
  if (!row)
    throw new ApiErrorException(
      'STOCK_RESERVATION_NOT_FOUND',
      'The stock reservation was not found',
      HttpStatus.NOT_FOUND,
    );
  if (row.status !== 'active')
    throw new ApiErrorException(
      'STOCK_RESERVATION_NOT_ACTIVE',
      'The stock reservation is no longer active',
      HttpStatus.CONFLICT,
    );
  if (row.warehouse_id !== input.warehouseId || row.product_id !== input.productId)
    throw new ApiErrorException(
      'STOCK_RESERVATION_MISMATCH',
      'The reservation does not match the issue warehouse and product',
      HttpStatus.CONFLICT,
    );
  if (fixedDecimal(row.remaining_quantity) < fixedDecimal(input.quantity))
    throw new ApiErrorException(
      'STOCK_RESERVATION_INSUFFICIENT',
      'The reservation does not cover the requested quantity',
      HttpStatus.CONFLICT,
    );
  if (input.serialNumbers.length) {
    const serials = await client.query<{ id: string }>(
      `SELECT reserved.id FROM inventory.stock_reservation_serials reserved
       JOIN inventory.serialized_items item ON item.id = reserved.serialized_item_id
       WHERE reserved.reservation_id = $1 AND reserved.active
         AND upper(item.serial_number) = ANY($2::text[]) FOR UPDATE OF reserved`,
      [input.reservationId, input.serialNumbers],
    );
    if (serials.rowCount !== input.serialNumbers.length)
      throw new ApiErrorException(
        'STOCK_RESERVATION_SERIAL_MISMATCH',
        'Every issued serial must belong to the active reservation',
        HttpStatus.CONFLICT,
      );
    await client.query(
      `UPDATE inventory.stock_reservation_serials
       SET active = false, ended_at = now() WHERE id = ANY($1::uuid[])`,
      [serials.rows.map((serial) => serial.id)],
    );
  }
  const remaining = fromFixedDecimal(
    fixedDecimal(row.remaining_quantity) - fixedDecimal(input.quantity),
  );
  await client.query(
    `UPDATE inventory.stock_reservations SET
       remaining_quantity = $2,
       status = CASE WHEN $2::numeric = 0 THEN 'consumed' ELSE 'active' END,
       ended_by = CASE WHEN $2::numeric = 0 THEN $3::uuid ELSE NULL END,
       ended_at = CASE WHEN $2::numeric = 0 THEN now() ELSE NULL END,
       version = version + 1
     WHERE id = $1`,
    [input.reservationId, remaining, accountId],
  );
}
async function lockTransferBalances(
  client: PoolClient,
  productId: string,
  fromWarehouseId: string,
  toWarehouseId: string,
): Promise<void> {
  for (const warehouseId of [fromWarehouseId, toWarehouseId].sort()) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `stock-transfer:${productId}:${warehouseId}`,
    ]);
  }
}
async function transferBatch(
  client: PoolClient,
  input: ReturnType<typeof normalizeTransfer>,
): Promise<string | undefined> {
  if (!input.batchNumber) return undefined;
  const batch = await client.query<{ id: string }>(
    'SELECT id FROM inventory.batches WHERE product_id = $1 AND batch_number = $2 FOR KEY SHARE',
    [input.productId, input.batchNumber],
  );
  const batchId = required(batch.rows[0], 'Batch was not found').id;
  const source = await client.query(
    `UPDATE inventory.batch_stock_balances SET quantity = quantity - $3, updated_at = now()
     WHERE warehouse_id = $1 AND batch_id = $2 AND quantity >= $3 RETURNING quantity`,
    [input.fromWarehouseId, batchId, input.quantity],
  );
  if (!source.rowCount)
    throw new ApiErrorException(
      'INSUFFICIENT_BATCH_STOCK',
      'The selected batch does not have sufficient available stock',
      HttpStatus.CONFLICT,
    );
  await client.query(
    `INSERT INTO inventory.batch_stock_balances (warehouse_id, batch_id, quantity) VALUES ($1, $2, $3)
     ON CONFLICT (warehouse_id, batch_id) DO UPDATE SET quantity = inventory.batch_stock_balances.quantity + EXCLUDED.quantity, updated_at = now()`,
    [input.toWarehouseId, batchId, input.quantity],
  );
  return batchId;
}
async function transferSerials(
  client: PoolClient,
  input: ReturnType<typeof normalizeTransfer>,
  fromMovementId: string,
  toMovementId: string,
): Promise<string[]> {
  if (!input.serialNumbers.length) return [];
  const items = await client.query<{ id: string }>(
    `SELECT item.id FROM inventory.serialized_items item
     WHERE item.warehouse_id = $1 AND item.product_id = $2
       AND item.status = 'available' AND upper(item.serial_number) = ANY($3::text[])
       AND NOT EXISTS (
         SELECT 1 FROM inventory.stock_reservation_serials reserved
         WHERE reserved.serialized_item_id = item.id AND reserved.active
       )
     FOR UPDATE`,
    [input.fromWarehouseId, input.productId, input.serialNumbers],
  );
  if (items.rowCount !== input.serialNumbers.length)
    throw new ApiErrorException(
      'SERIAL_NOT_AVAILABLE',
      'One or more serial numbers are unavailable in the source warehouse',
      HttpStatus.CONFLICT,
    );
  const ids = items.rows.map((item) => item.id);
  await client.query(
    'UPDATE inventory.serialized_items SET warehouse_id = $2 WHERE id = ANY($1::uuid[])',
    [ids, input.toWarehouseId],
  );
  await client.query(
    `INSERT INTO inventory.serial_item_transfer_events (
       serialized_item_id, transfer_out_movement_id, transfer_in_movement_id, from_warehouse_id, to_warehouse_id
     ) SELECT unnest($1::uuid[]), $2, $3, $4, $5`,
    [ids, fromMovementId, toMovementId, input.fromWarehouseId, input.toWarehouseId],
  );
  return ids;
}
async function issueSerials(
  client: PoolClient,
  input: ReturnType<typeof normalizeIssue>,
  movementId: string,
): Promise<string[]> {
  if (!input.serialNumbers.length) return [];
  const items = await client.query<{ id: string; serial_number: string }>(
    `SELECT item.id, item.serial_number FROM inventory.serialized_items item
     WHERE item.warehouse_id = $1 AND item.product_id = $2 AND item.status = 'available'
       AND upper(item.serial_number) = ANY($3::text[])
       AND NOT EXISTS (
         SELECT 1 FROM inventory.stock_reservation_serials reserved
         WHERE reserved.serialized_item_id = item.id AND reserved.active
       )
     FOR UPDATE`,
    [input.warehouseId, input.productId, input.serialNumbers],
  );
  if (items.rowCount !== input.serialNumbers.length)
    throw new ApiErrorException(
      'SERIAL_NOT_AVAILABLE',
      'One or more serial numbers are unavailable in this warehouse',
      HttpStatus.CONFLICT,
    );
  const ids = items.rows.map((item) => item.id);
  await client.query(
    `UPDATE inventory.serialized_items
     SET status = 'issued', issued_movement_id = $2
     WHERE id = ANY($1::uuid[])`,
    [ids, movementId],
  );
  return ids;
}
async function returnedSerialItems(
  client: PoolClient,
  input: ReturnType<typeof normalizeReturn>,
  productId: string,
): Promise<Array<{ id: string }>> {
  if (!input.serialNumbers.length) return [];
  const items = await client.query<{ id: string }>(
    `SELECT id FROM inventory.serialized_items
     WHERE product_id = $1 AND status = 'issued' AND issued_movement_id = $2
       AND upper(serial_number) = ANY($3::text[])
     FOR UPDATE`,
    [productId, input.originalIssueId, input.serialNumbers],
  );
  if (items.rowCount !== input.serialNumbers.length)
    throw new ApiErrorException(
      'RETURN_SERIAL_NOT_IN_ORIGINAL_ISSUE',
      'One or more serials are not currently issued by the original movement',
      HttpStatus.CONFLICT,
    );
  return items.rows;
}
function validateTracking(product: ProductRow, input: ReturnType<typeof normalizeReceipt>) {
  if (
    product.tracking_mode === 'serial' &&
    (input.serialNumbers.length === 0 ||
      !isWholeQuantity(input.quantity) ||
      input.serialNumbers.length !== Number(input.quantity))
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
function normalizeQuantity(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(4, '0')}`;
}
function normalizePositiveQuantity(value: string): string {
  const quantity = normalizeQuantity(value);
  if (fixedDecimal(quantity) <= 0n)
    throw new ApiErrorException(
      'QUANTITY_INVALID',
      'Quantity must be greater than zero',
      HttpStatus.BAD_REQUEST,
    );
  return quantity;
}
function normalizeMoney(value: string): string {
  const money = normalizeQuantity(value);
  if (fixedDecimal(money) < 0n)
    throw new ApiErrorException(
      'MONEY_INVALID',
      'Money cannot be negative',
      HttpStatus.BAD_REQUEST,
    );
  return money;
}
function sumQuantities(values: string[]): string {
  const total = values.reduce((sum, value) => sum + fixedDecimal(value), 0n);
  return fromFixedDecimal(total);
}
function fixedDecimal(value: string): bigint {
  return BigInt(value.replace('.', ''));
}
function fromFixedDecimal(value: bigint): string {
  const text = value.toString().padStart(5, '0');
  return `${text.slice(0, -4)}.${text.slice(-4)}`;
}
function multiplyFixed(left: string, right: string): string {
  const product = fixedDecimal(left) * fixedDecimal(right);
  return fromFixedDecimal((product + 5000n) / 10_000n);
}
function decimalDifference(
  counted: string,
  expected: string,
): { positive: boolean; quantity: string } {
  const countedValue = fixedDecimal(counted);
  const expectedValue = fixedDecimal(expected);
  const difference = countedValue - expectedValue;
  const absolute = difference < 0n ? -difference : difference;
  return { positive: difference > 0n, quantity: fromFixedDecimal(absolute) };
}
function isWholeQuantity(value: string): boolean {
  return value.endsWith('.0000');
}
function unique(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

async function requireBusinessLocation(client: PoolClient, locationId: string): Promise<void> {
  const result = await client.query(
    'SELECT id FROM organization.business_locations WHERE id = $1 AND active',
    [locationId],
  );
  if (!result.rows[0])
    throw new ApiErrorException(
      'BUSINESS_LOCATION_NOT_FOUND',
      'The active business location was not found',
      HttpStatus.BAD_REQUEST,
    );
}

async function requireTechnicianOperator(
  client: PoolClient,
  operatorId: string,
  locationId: string,
): Promise<void> {
  const result = await client.query(
    `SELECT id FROM organization.operators
     WHERE id = $1 AND business_location_id = $2 AND active`,
    [operatorId, locationId],
  );
  if (!result.rows[0])
    throw new ApiErrorException(
      'TECHNICIAN_OPERATOR_NOT_FOUND',
      'The active technician operator was not found at this business location',
      HttpStatus.BAD_REQUEST,
    );
}
