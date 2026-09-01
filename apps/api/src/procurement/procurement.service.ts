import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  CreatePurchaseOrderRequest,
  GoodsReceipt,
  GoodsReceiptLine,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderPage,
  PurchaseOrderStatus,
  ProcurementReferenceData,
  ReceivePurchaseOrderRequest,
} from '@vista/contracts';
import type { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service.js';
import type {
  AuthenticationContext,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { DatabaseService } from '../database/database.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import type { ListPurchaseOrdersQueryDto } from './procurement.dto.js';
import { SupplierProcurementService } from './supplier-procurement.service.js';

type OrderRow = {
  created_at: string;
  currency_code: string;
  id: string;
  status: PurchaseOrderStatus;
  supplier_name: string;
  supplier_partner_id: string;
  updated_at: string;
  version: number;
  warehouse_id: string;
  warehouse_name: string;
};

type OrderLineRow = {
  delivered_quantity: string;
  expected_delivery_date: string;
  id: string;
  invoiced_quantity: string;
  ordered_quantity: string;
  product_id: string;
  product_name: string;
  unit_price: string;
};

type ReceiptRow = {
  id: string;
  received_at: string;
  supplier_delivery_reference: string | null;
};

type ReceiptLineRow = {
  batch_id: string | null;
  goods_receipt_id: string;
  id: string;
  order_line_id: string;
  product_id: string;
  quantity: string;
  serial_item_ids: string[];
  stock_movement_id: string;
  total_cost_bgn: string;
  unit_cost_bgn: string;
};

type ClaimedCommand = { request_hash: string; response_body: unknown; status: string };

@Injectable()
export class ProcurementService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(SupplierProcurementService)
    private readonly supplierProcurement: SupplierProcurementService,
  ) {}

  async referenceData(): Promise<ProcurementReferenceData> {
    const [suppliers, products, warehouses] = await Promise.all([
      this.database.getPool().query<{ id: string; name: string }>(
        `SELECT partner.id, partner.display_name AS name
         FROM master_data.partners partner
         JOIN master_data.partner_roles role ON role.partner_id = partner.id
         WHERE partner.active AND role.role = 'supplier'
         ORDER BY partner.normalized_name, partner.id`,
      ),
      this.database.getPool().query<{
        id: string;
        name: string;
        product_code: string;
        requires_expiry: boolean;
        tracking_mode: ProcurementReferenceData['products'][number]['trackingMode'];
      }>(
        `SELECT product.id, product.name, product.product_code, category.tracking_mode,
                category.requires_expiry
         FROM master_data.products product
         JOIN master_data.product_categories category ON category.id = product.category_id
         WHERE product.active AND category.active
         ORDER BY upper(product.name), product.id`,
      ),
      this.database.getPool().query<{ id: string; name: string }>(
        `SELECT id, name FROM master_data.warehouses
         WHERE active ORDER BY upper(name), id`,
      ),
    ]);
    return {
      products: products.rows.map((product) => ({
        id: product.id,
        name: product.name,
        productCode: product.product_code,
        requiresExpiry: product.requires_expiry,
        trackingMode: product.tracking_mode,
      })),
      suppliers: suppliers.rows,
      warehouses: warehouses.rows,
    };
  }

  async purchaseOrders(query: ListPurchaseOrdersQueryDto): Promise<PurchaseOrderPage> {
    const client = await this.database.getPool().connect();
    try {
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 25;
      const filters = [query.status ?? null, query.supplierPartnerId ?? null];
      const count = await client.query<{ total: string }>(
        `SELECT count(*)::text AS total
         FROM procurement.purchase_orders
         WHERE ($1::text IS NULL OR status = $1)
           AND ($2::uuid IS NULL OR supplier_partner_id = $2)`,
        filters,
      );
      const total = Number(count.rows[0]?.total ?? 0);
      const ids = await client.query<{ id: string }>(
        `SELECT id
         FROM procurement.purchase_orders
         WHERE ($1::text IS NULL OR status = $1)
           AND ($2::uuid IS NULL OR supplier_partner_id = $2)
         ORDER BY created_at DESC, id DESC
         LIMIT $3 OFFSET $4`,
        [...filters, pageSize, (page - 1) * pageSize],
      );
      const items: PurchaseOrder[] = [];
      for (const row of ids.rows) items.push(await this.loadPurchaseOrder(client, row.id));
      return {
        items,
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      };
    } finally {
      client.release();
    }
  }

  async purchaseOrder(id: string): Promise<PurchaseOrder> {
    const client = await this.database.getPool().connect();
    try {
      return await this.loadPurchaseOrder(client, id);
    } finally {
      client.release();
    }
  }

  async createPurchaseOrder(
    input: CreatePurchaseOrderRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<PurchaseOrder> {
    const normalized = normalizeOrder(input);
    return this.command(
      'purchase-order.create',
      key,
      normalized,
      async (client, idempotencyKey) => {
        await this.requireSupplier(client, normalized.supplierPartnerId);
        await this.requireWarehouse(client, normalized.warehouseId);
        const products = await client.query<{ id: string }>(
          `SELECT product.id
         FROM master_data.products product
         JOIN master_data.product_categories category ON category.id = product.category_id
         WHERE product.id = ANY($1::uuid[]) AND product.active AND category.active
         FOR KEY SHARE OF product`,
          [normalized.lines.map((line) => line.productId)],
        );
        if (products.rowCount !== normalized.lines.length)
          throw new ApiErrorException(
            'PROCUREMENT_PRODUCT_NOT_FOUND',
            'One or more selected products are unavailable',
            HttpStatus.NOT_FOUND,
          );

        const orderId = randomUUID();
        await client.query(
          `INSERT INTO procurement.purchase_orders (
           id, supplier_partner_id, warehouse_id, currency_code, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $5)`,
          [
            orderId,
            normalized.supplierPartnerId,
            normalized.warehouseId,
            normalized.currencyCode,
            auth.accountId,
          ],
        );
        for (const line of normalized.lines) {
          await client.query(
            `INSERT INTO procurement.purchase_order_lines (
             id, purchase_order_id, product_id, ordered_quantity, unit_price,
             expected_delivery_date
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              randomUUID(),
              orderId,
              line.productId,
              line.quantity,
              line.unitPrice,
              line.expectedDeliveryDate,
            ],
          );
        }
        const result = await this.loadPurchaseOrder(client, orderId);
        await this.sideEffects(
          client,
          'purchase_order',
          orderId,
          'procurement.purchase_order.created',
          result,
          auth,
          metadata,
          idempotencyKey,
        );
        return result;
      },
    );
  }

  async receivePurchaseOrder(
    orderId: string,
    input: ReceivePurchaseOrderRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<GoodsReceipt> {
    const normalized = normalizeReceipt(input);
    return this.command(
      'purchase-order.receive',
      key,
      { orderId, ...normalized },
      async (client, idempotencyKey) => {
        const order = await client.query<{
          currency_code: string;
          status: PurchaseOrderStatus;
          supplier_partner_id: string;
          warehouse_id: string;
        }>(
          `SELECT currency_code, status, supplier_partner_id, warehouse_id
           FROM procurement.purchase_orders WHERE id = $1 FOR UPDATE`,
          [orderId],
        );
        const orderRow = order.rows[0];
        if (!orderRow)
          throw new ApiErrorException(
            'PURCHASE_ORDER_NOT_FOUND',
            'The purchase order was not found',
            HttpStatus.NOT_FOUND,
          );
        if (orderRow.status === 'received')
          throw new ApiErrorException(
            'PURCHASE_ORDER_ALREADY_RECEIVED',
            'The purchase order is already fully received',
            HttpStatus.CONFLICT,
          );

        const goodsReceiptId = randomUUID();
        await client.query(
          `INSERT INTO procurement.goods_receipts (
             id, purchase_order_id, warehouse_id, supplier_partner_id,
             supplier_delivery_reference, received_by, correlation_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            goodsReceiptId,
            orderId,
            orderRow.warehouse_id,
            orderRow.supplier_partner_id,
            normalized.supplierDeliveryReference ?? null,
            auth.accountId,
            metadata.correlationId,
          ],
        );

        for (const receivedLine of normalized.lines) {
          const line = await client.query<{
            id: string;
            product_id: string;
            unit_price: string;
          }>(
            `SELECT id, product_id, unit_price::text
             FROM procurement.purchase_order_lines
             WHERE id = $1 AND purchase_order_id = $2
             FOR UPDATE`,
            [receivedLine.orderLineId, orderId],
          );
          const orderLine = line.rows[0];
          if (!orderLine)
            throw new ApiErrorException(
              'PURCHASE_ORDER_LINE_NOT_FOUND',
              'A selected line does not belong to this purchase order',
              HttpStatus.NOT_FOUND,
            );
          const delivered = await client.query(
            `UPDATE procurement.purchase_order_lines
             SET delivered_quantity = delivered_quantity + $2
             WHERE id = $1 AND delivered_quantity + $2 <= ordered_quantity
             RETURNING id`,
            [receivedLine.orderLineId, receivedLine.quantity],
          );
          if (!delivered.rowCount)
            throw new ApiErrorException(
              'PURCHASE_ORDER_OVER_RECEIPT',
              'The received quantity exceeds the quantity still due',
              HttpStatus.CONFLICT,
            );
          const unitCostBgn =
            receivedLine.unitCostBgn ??
            (orderRow.currency_code === 'BGN' ? normalizeMoney(orderLine.unit_price) : undefined);
          if (!unitCostBgn)
            throw new ApiErrorException(
              'RECEIPT_BGN_COST_REQUIRED',
              'A BGN unit cost is required when the purchase order uses another currency',
              HttpStatus.BAD_REQUEST,
              [{ field: 'unitCostBgn', message: 'Enter the BGN unit cost used for valuation' }],
            );
          const stock = await this.inventory.receivePurchaseOrderStock(
            client,
            {
              ...(receivedLine.batchNumber ? { batchNumber: receivedLine.batchNumber } : {}),
              ...(receivedLine.expiresAt ? { expiresAt: receivedLine.expiresAt } : {}),
              productId: orderLine.product_id,
              quantity: receivedLine.quantity,
              referenceId: goodsReceiptId,
              ...(receivedLine.serialNumbers ? { serialNumbers: receivedLine.serialNumbers } : {}),
              supplierPartnerId: orderRow.supplier_partner_id,
              unitCostBgn,
              warehouseId: orderRow.warehouse_id,
            },
            goodsReceiptId,
            orderLine.id,
            auth,
            metadata,
          );
          await client.query(
            `INSERT INTO procurement.goods_receipt_lines (
               id, goods_receipt_id, purchase_order_line_id, stock_movement_id,
               quantity, unit_cost_bgn
             ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              randomUUID(),
              goodsReceiptId,
              receivedLine.orderLineId,
              stock.id,
              receivedLine.quantity,
              unitCostBgn,
            ],
          );
        }

        const progress = await client.query<{ any_received: boolean; complete: boolean }>(
          `SELECT bool_and(delivered_quantity = ordered_quantity) AS complete,
                  bool_or(delivered_quantity > 0) AS any_received
           FROM procurement.purchase_order_lines WHERE purchase_order_id = $1`,
          [orderId],
        );
        const state = progress.rows[0];
        const status: PurchaseOrderStatus = state?.complete
          ? 'received'
          : state?.any_received
            ? 'partially_received'
            : 'open';
        await client.query(
          `UPDATE procurement.purchase_orders
           SET status = $2, version = version + 1, updated_by = $3, updated_at = now()
           WHERE id = $1`,
          [orderId, status, auth.accountId],
        );
        const purchaseOrder = await this.loadPurchaseOrder(client, orderId);
        const result = purchaseOrder.receipts.find((receipt) => receipt.id === goodsReceiptId);
        if (!result) throw new Error('Goods receipt could not be loaded after creation');
        await this.sideEffects(
          client,
          'goods_receipt',
          goodsReceiptId,
          'procurement.goods.received',
          result,
          auth,
          metadata,
          idempotencyKey,
        );
        return result;
      },
    );
  }

  private async loadPurchaseOrder(client: PoolClient, id: string): Promise<PurchaseOrder> {
    const header = await client.query<OrderRow>(
      `SELECT orders.id, orders.supplier_partner_id, supplier.display_name AS supplier_name,
              orders.warehouse_id, warehouse.name AS warehouse_name, orders.currency_code,
              orders.status, orders.version, orders.created_at::text, orders.updated_at::text
       FROM procurement.purchase_orders orders
       JOIN master_data.partners supplier ON supplier.id = orders.supplier_partner_id
       JOIN master_data.warehouses warehouse ON warehouse.id = orders.warehouse_id
       WHERE orders.id = $1`,
      [id],
    );
    const row = header.rows[0];
    if (!row)
      throw new ApiErrorException(
        'PURCHASE_ORDER_NOT_FOUND',
        'The purchase order was not found',
        HttpStatus.NOT_FOUND,
      );
    const lines = await client.query<OrderLineRow>(
      `SELECT line.id, line.product_id, product.name AS product_name,
              line.ordered_quantity::text, line.delivered_quantity::text,
              line.invoiced_quantity::text, line.unit_price::text,
              line.expected_delivery_date::text
       FROM procurement.purchase_order_lines line
       JOIN master_data.products product ON product.id = line.product_id
       WHERE line.purchase_order_id = $1
       ORDER BY line.expected_delivery_date, product.name, line.id`,
      [id],
    );
    const receipts = await client.query<ReceiptRow>(
      `SELECT id, supplier_delivery_reference, received_at::text
       FROM procurement.goods_receipts
       WHERE purchase_order_id = $1 ORDER BY received_at, id`,
      [id],
    );
    const receiptLines = await client.query<ReceiptLineRow>(
      `SELECT receipt_line.id, receipt_line.goods_receipt_id,
              receipt_line.purchase_order_line_id AS order_line_id,
              order_line.product_id, receipt_line.stock_movement_id,
              receipt_line.quantity::text, receipt_line.unit_cost_bgn::text,
              movement.total_cost_bgn::text, movement.batch_id,
              COALESCE((
                SELECT array_agg(item.id::text ORDER BY item.id)
                FROM inventory.serialized_items item
                WHERE item.received_movement_id = movement.id
              ), ARRAY[]::text[]) AS serial_item_ids
       FROM procurement.goods_receipt_lines receipt_line
       JOIN procurement.purchase_order_lines order_line
         ON order_line.id = receipt_line.purchase_order_line_id
       JOIN inventory.stock_movements movement ON movement.id = receipt_line.stock_movement_id
       JOIN procurement.goods_receipts receipt ON receipt.id = receipt_line.goods_receipt_id
       WHERE receipt.purchase_order_id = $1
       ORDER BY receipt.received_at, receipt_line.id`,
      [id],
    );
    return {
      createdAt: row.created_at,
      currencyCode: row.currency_code,
      id: row.id,
      lines: lines.rows.map(orderLine),
      receipts: receipts.rows.map((receipt) => ({
        id: receipt.id,
        lines: receiptLines.rows
          .filter((line) => line.goods_receipt_id === receipt.id)
          .map(goodsReceiptLine),
        purchaseOrderId: row.id,
        receivedAt: receipt.received_at,
        ...(receipt.supplier_delivery_reference
          ? { supplierDeliveryReference: receipt.supplier_delivery_reference }
          : {}),
        warehouseId: row.warehouse_id,
      })),
      supplierInvoices: await this.supplierProcurement.invoicesForOrder(client, id),
      status: row.status,
      supplierName: row.supplier_name,
      supplierPartnerId: row.supplier_partner_id,
      updatedAt: row.updated_at,
      version: row.version,
      warehouseId: row.warehouse_id,
      warehouseName: row.warehouse_name,
    };
  }

  private async command<T>(
    scope: string,
    key: string | undefined,
    payload: object,
    action: (client: PoolClient, idempotencyKey: string) => Promise<T>,
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
      const result = await action(client, idempotencyKey);
      await client.query(
        `UPDATE platform.idempotency_keys
         SET status = 'completed', response_status = 201, response_body = $3
         WHERE scope = $1 AND idempotency_key = $2`,
        [scope, idempotencyKey, result],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (uniqueConstraint(error) === 'serialized_items_serial_unique')
        throw new ApiErrorException(
          'SERIAL_NUMBER_ALREADY_REGISTERED',
          'One or more serial numbers are already registered. Enter the serial number printed on each device being received.',
          HttpStatus.CONFLICT,
        );
      if (isUniqueViolation(error))
        throw new ApiErrorException(
          'PROCUREMENT_CONFLICT',
          'The purchase order or receipt conflicts with an existing record',
          HttpStatus.CONFLICT,
        );
      throw error;
    } finally {
      client.release();
    }
  }

  private async requireSupplier(client: PoolClient, supplierPartnerId: string) {
    const supplier = await client.query(
      `SELECT partner.id
       FROM master_data.partners partner
       JOIN master_data.partner_roles role ON role.partner_id = partner.id
       WHERE partner.id = $1 AND partner.active AND role.role = 'supplier'
       FOR KEY SHARE OF partner`,
      [supplierPartnerId],
    );
    if (!supplier.rowCount)
      throw new ApiErrorException(
        'SUPPLIER_NOT_FOUND',
        'The selected supplier was not found or is inactive',
        HttpStatus.NOT_FOUND,
      );
  }

  private async requireWarehouse(client: PoolClient, warehouseId: string) {
    const warehouse = await client.query(
      'SELECT id FROM master_data.warehouses WHERE id = $1 AND active FOR KEY SHARE',
      [warehouseId],
    );
    if (!warehouse.rowCount)
      throw new ApiErrorException(
        'WAREHOUSE_NOT_FOUND',
        'The selected warehouse was not found',
        HttpStatus.NOT_FOUND,
      );
  }

  private async sideEffects(
    client: PoolClient,
    targetType: string,
    targetId: string,
    eventType: string,
    payload: object,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    idempotencyKey: string,
  ) {
    await client.query(
      `INSERT INTO integration.outbox_events (
         id, aggregate_type, aggregate_id, event_type, event_version,
         correlation_id, idempotency_key, payload
       ) VALUES ($1, $2, $3, $4, 1, $5, $6, $7)`,
      [
        randomUUID(),
        targetType,
        targetId,
        eventType,
        metadata.correlationId,
        `${eventType}:${idempotencyKey}`,
        payload,
      ],
    );
    await this.audit.append(
      {
        action: eventType,
        actorAccountId: auth.accountId,
        after: payload as Record<string, unknown>,
        correlationId: metadata.correlationId,
        ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
        targetId,
        targetType,
        ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
      },
      client,
    );
  }
}

function orderLine(row: OrderLineRow): PurchaseOrderLine {
  return {
    deliveredQuantity: row.delivered_quantity,
    expectedDeliveryDate: row.expected_delivery_date,
    id: row.id,
    invoicedQuantity: row.invoiced_quantity,
    orderedQuantity: row.ordered_quantity,
    productId: row.product_id,
    productName: row.product_name,
    unitPrice: row.unit_price,
  };
}

function goodsReceiptLine(row: ReceiptLineRow): GoodsReceiptLine {
  return {
    ...(row.batch_id ? { batchId: row.batch_id } : {}),
    id: row.id,
    orderLineId: row.order_line_id,
    productId: row.product_id,
    quantity: row.quantity,
    serialItemIds: row.serial_item_ids,
    stockMovementId: row.stock_movement_id,
    totalCostBgn: row.total_cost_bgn,
    unitCostBgn: row.unit_cost_bgn,
  };
}

function normalizeOrder(input: CreatePurchaseOrderRequest) {
  const productIds = input.lines.map((line) => line.productId);
  if (new Set(productIds).size !== productIds.length)
    throw new ApiErrorException(
      'PURCHASE_ORDER_PRODUCT_DUPLICATE',
      'Each product can appear only once on a purchase order',
      HttpStatus.BAD_REQUEST,
    );
  return {
    currencyCode: normalizeCurrency(input.currencyCode),
    lines: input.lines.map((line) => ({
      expectedDeliveryDate: normalizeDate(line.expectedDeliveryDate),
      productId: line.productId,
      quantity: normalizePositiveQuantity(line.quantity),
      unitPrice: normalizeMoney(line.unitPrice),
    })),
    supplierPartnerId: input.supplierPartnerId,
    warehouseId: input.warehouseId,
  };
}

function normalizeReceipt(input: ReceivePurchaseOrderRequest) {
  const lineIds = input.lines.map((line) => line.orderLineId);
  if (new Set(lineIds).size !== lineIds.length)
    throw new ApiErrorException(
      'GOODS_RECEIPT_LINE_DUPLICATE',
      'Each purchase-order line can appear only once on a receipt',
      HttpStatus.BAD_REQUEST,
    );
  const supplierDeliveryReference = input.supplierDeliveryReference?.trim();
  if (input.supplierDeliveryReference !== undefined && !supplierDeliveryReference)
    throw new ApiErrorException(
      'DELIVERY_REFERENCE_EMPTY',
      'The supplier delivery reference cannot be empty',
      HttpStatus.BAD_REQUEST,
    );
  return {
    lines: input.lines.map((line) => ({
      ...(line.batchNumber ? { batchNumber: line.batchNumber.trim() } : {}),
      ...(line.expiresAt ? { expiresAt: normalizeDate(line.expiresAt) } : {}),
      orderLineId: line.orderLineId,
      quantity: normalizePositiveQuantity(line.quantity),
      ...(line.serialNumbers ? { serialNumbers: line.serialNumbers } : {}),
      ...(line.unitCostBgn ? { unitCostBgn: normalizeMoney(line.unitCostBgn) } : {}),
    })),
    ...(supplierDeliveryReference ? { supplierDeliveryReference } : {}),
  };
}

function normalizeCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/u.test(currency))
    throw new ApiErrorException(
      'CURRENCY_CODE_INVALID',
      'Currency code must contain three letters',
      HttpStatus.BAD_REQUEST,
    );
  return currency;
}

function normalizeDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new ApiErrorException(
      'DATE_INVALID',
      'Enter a valid calendar date',
      HttpStatus.BAD_REQUEST,
    );
  return value;
}

function normalizePositiveQuantity(value: string): string {
  const quantity = normalizeDecimal(value);
  if (decimalUnits(quantity) <= 0n)
    throw new ApiErrorException(
      'QUANTITY_INVALID',
      'Quantity must be greater than zero',
      HttpStatus.BAD_REQUEST,
    );
  return quantity;
}

function normalizeMoney(value: string): string {
  const money = normalizeDecimal(value);
  if (decimalUnits(money) < 0n)
    throw new ApiErrorException(
      'MONEY_INVALID',
      'Amount cannot be negative',
      HttpStatus.BAD_REQUEST,
    );
  return money;
}

function normalizeDecimal(value: string): string {
  if (!/^\d+(\.\d{1,4})?$/u.test(value))
    throw new ApiErrorException(
      'DECIMAL_INVALID',
      'Enter a number with no more than four decimal places',
      HttpStatus.BAD_REQUEST,
    );
  const [whole, fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(4, '0')}`;
}

function decimalUnits(value: string): bigint {
  return BigInt(value.replace('.', ''));
}

function validKey(key: string | undefined): string {
  const normalized = key?.trim();
  if (!normalized || normalized.length > 200)
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_REQUIRED',
      'A valid Idempotency-Key header is required',
      HttpStatus.BAD_REQUEST,
    );
  return normalized;
}

async function claim(
  client: PoolClient,
  scope: string,
  key: string,
  hash: string,
): Promise<Record<string, unknown> | undefined> {
  const inserted = await client.query(
    `INSERT INTO platform.idempotency_keys (
       scope, idempotency_key, request_hash, status, expires_at
     ) VALUES ($1, $2, $3, 'processing', now() + interval '24 hours')
     ON CONFLICT DO NOTHING RETURNING idempotency_key`,
    [scope, key, hash],
  );
  if (inserted.rowCount) return undefined;
  const existing = await client.query<ClaimedCommand>(
    `SELECT request_hash, status, response_body
     FROM platform.idempotency_keys
     WHERE scope = $1 AND idempotency_key = $2 FOR UPDATE`,
    [scope, key],
  );
  const row = existing.rows[0];
  if (!row || row.request_hash !== hash)
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_CONFLICT',
      'The idempotency key was already used for another request',
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

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

function uniqueConstraint(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'constraint' in error
    ? String(error.constraint)
    : undefined;
}
