import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AcceptanceProtocol,
  AcceptanceProtocolLine,
  CreateAcceptanceProtocolRequest,
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
import { APP_ENVIRONMENT } from '../config/config.module.js';
import type { AppEnvironment } from '@vista/config';
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
  cost_baseline_eur: string | null;
  cost_baseline_source: 'latest_product_cost' | 'supplier_invoice' | null;
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
  cost_baseline_eur: string | null;
  cost_baseline_source: 'latest_product_cost' | 'supplier_invoice' | null;
  cost_variance_percent: string | null;
  goods_receipt_id: string;
  id: string;
  order_line_id: string;
  product_id: string;
  quantity: string;
  serial_item_ids: string[];
  stock_movement_id: string;
  total_cost_eur: string;
  unit_cost_eur: string;
};

type AcceptanceProtocolHeaderRow = {
  created_at: string;
  goods_receipt_id: string;
  id: string;
  invoice_date: string | null;
  invoice_number: string | null;
  number_sequence: number;
  number_year: number;
  prepared_by_name: string;
  protocol_number: string;
  purchase_order_id: string;
  received_at: string;
  received_by_name: string;
  supplier_delivery_reference: string | null;
  supplier_invoice_id: string | null;
  supplier_name: string;
  supplier_partner_id: string;
  warehouse_name: string;
};

type AcceptanceProtocolLineRow = {
  accepted_quantity: string;
  batch_number: string | null;
  currency_code: string;
  cumulative_received_quantity: string;
  discrepancies: AcceptanceProtocolLine['discrepancies'] | string;
  expires_at: string | null;
  goods_receipt_line_id: string;
  id: string;
  order_line_id: string;
  ordered_quantity: string;
  outstanding_quantity: string;
  previously_received_quantity: string;
  product_code: string;
  product_id: string;
  product_name: string;
  serial_numbers: string[];
  unit_price: string;
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
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
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
            cost_baseline_eur: string | null;
            cost_baseline_source: 'latest_product_cost' | 'supplier_invoice' | null;
            id: string;
            product_id: string;
            unit_price: string;
          }>(
            `SELECT line.id, line.product_id, line.unit_price::text,
                    COALESCE(invoice_cost.unit_price, movement_cost.unit_cost_eur)::text
                      AS cost_baseline_eur,
                    CASE WHEN invoice_cost.unit_price IS NOT NULL THEN 'supplier_invoice'
                         WHEN movement_cost.unit_cost_eur IS NOT NULL THEN 'latest_product_cost'
                         ELSE NULL END AS cost_baseline_source
             FROM procurement.purchase_order_lines line
             LEFT JOIN LATERAL (
               SELECT invoice_line.unit_price
               FROM procurement.supplier_invoice_lines invoice_line
               JOIN procurement.supplier_invoices invoice ON invoice.id=invoice_line.supplier_invoice_id
               JOIN procurement.purchase_order_lines source_line
                 ON source_line.id=invoice_line.purchase_order_line_id
               WHERE source_line.product_id=line.product_id AND invoice.currency_code='EUR'
               ORDER BY invoice.invoice_date DESC, invoice.recorded_at DESC, invoice.id DESC
               LIMIT 1
             ) invoice_cost ON true
             LEFT JOIN LATERAL (
               SELECT movement.unit_cost_eur
               FROM inventory.stock_movements movement
               WHERE movement.product_id=line.product_id AND movement.unit_cost_eur>0
               ORDER BY movement.occurred_at DESC, movement.id DESC LIMIT 1
             ) movement_cost ON true
             WHERE line.id = $1 AND line.purchase_order_id = $2
             FOR UPDATE OF line`,
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
          const unitCostEur =
            receivedLine.unitCostEur ??
            (orderRow.currency_code === 'EUR' ? normalizeMoney(orderLine.unit_price) : undefined);
          if (!unitCostEur)
            throw new ApiErrorException(
              'RECEIPT_EUR_COST_REQUIRED',
              'A EUR unit cost is required when the purchase order uses another currency',
              HttpStatus.BAD_REQUEST,
              [{ field: 'unitCostEur', message: 'Enter the EUR unit cost used for valuation' }],
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
              unitCostEur,
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
               quantity, unit_cost_eur, cost_baseline_eur, cost_baseline_source
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              randomUUID(),
              goodsReceiptId,
              receivedLine.orderLineId,
              stock.id,
              receivedLine.quantity,
              unitCostEur,
              orderLine.cost_baseline_eur,
              orderLine.cost_baseline_source,
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

  async acceptanceProtocol(receiptId: string): Promise<AcceptanceProtocol> {
    const client = await this.database.getPool().connect();
    try {
      const protocol = await this.loadAcceptanceProtocolByReceipt(client, receiptId);
      if (!protocol)
        throw new ApiErrorException(
          'PROCUREMENT_ACCEPTANCE_PROTOCOL_NOT_FOUND',
          'No acceptance protocol has been created for this delivery.',
          HttpStatus.NOT_FOUND,
        );
      return protocol;
    } finally {
      client.release();
    }
  }

  createAcceptanceProtocol(
    receiptId: string,
    input: CreateAcceptanceProtocolRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<AcceptanceProtocol> {
    const normalized = input.supplierInvoiceId
      ? { supplierInvoiceId: input.supplierInvoiceId }
      : {};
    return this.command(
      'procurement.acceptance-protocol.create',
      key,
      { receiptId, ...normalized },
      async (client, idempotencyKey) => {
        const receiptResult = await client.query<{
          currency_code: string;
          goods_receipt_id: string;
          purchase_order_id: string;
          received_at: string;
          received_by: string;
          supplier_delivery_reference: string | null;
          supplier_partner_id: string;
          warehouse_id: string;
        }>(
          `SELECT receipt.id AS goods_receipt_id, receipt.purchase_order_id,
                  receipt.supplier_partner_id, receipt.warehouse_id,
                  receipt.received_at::text, receipt.supplier_delivery_reference,
                  receipt.received_by, purchase_order.currency_code
           FROM procurement.goods_receipts receipt
           JOIN procurement.purchase_orders purchase_order
             ON purchase_order.id = receipt.purchase_order_id
           WHERE receipt.id = $1
           FOR UPDATE OF receipt`,
          [receiptId],
        );
        const receipt = receiptResult.rows[0];
        if (!receipt)
          throw new ApiErrorException(
            'GOODS_RECEIPT_NOT_FOUND',
            'The supplier delivery could not be found.',
            HttpStatus.NOT_FOUND,
          );

        const existing = await this.loadAcceptanceProtocolByReceipt(client, receiptId);
        if (existing) return existing;

        if (normalized.supplierInvoiceId) {
          const invoice = await client.query(
            `SELECT id FROM procurement.supplier_invoices
             WHERE id = $1 AND purchase_order_id = $2 AND supplier_partner_id = $3
             FOR KEY SHARE`,
            [normalized.supplierInvoiceId, receipt.purchase_order_id, receipt.supplier_partner_id],
          );
          if (!invoice.rowCount)
            throw new ApiErrorException(
              'SUPPLIER_INVOICE_NOT_FOUND',
              'Choose an invoice recorded for this purchase order.',
              HttpStatus.NOT_FOUND,
            );
        }

        const yearResult = await client.query<{ sequence_year: number }>(
          `SELECT EXTRACT(YEAR FROM $1::timestamptz AT TIME ZONE $2)::integer AS sequence_year`,
          [receipt.received_at, this.environment.BUSINESS_TIMEZONE],
        );
        const sequenceYear = yearResult.rows[0]?.sequence_year;
        if (!sequenceYear) throw new Error('Protocol year could not be resolved');
        await client.query(
          `INSERT INTO procurement.acceptance_protocol_sequences (sequence_year, next_value)
           VALUES ($1, 1) ON CONFLICT (sequence_year) DO NOTHING`,
          [sequenceYear],
        );
        const sequenceResult = await client.query<{ sequence_number: number }>(
          `UPDATE procurement.acceptance_protocol_sequences
           SET next_value = next_value + 1
           WHERE sequence_year = $1
           RETURNING next_value - 1 AS sequence_number`,
          [sequenceYear],
        );
        const sequenceNumber = sequenceResult.rows[0]?.sequence_number;
        if (!sequenceNumber) throw new Error('Acceptance protocol number could not be allocated');
        const protocolId = randomUUID();
        const protocolNumber = `GRP-${sequenceYear}-${String(sequenceNumber).padStart(6, '0')}`;
        const linesResult = await client.query<{
          accepted_quantity: string;
          batch_number: string | null;
          cumulative_received_quantity: string;
          discrepancies: AcceptanceProtocolLine['discrepancies'];
          expires_at: string | null;
          goods_receipt_line_id: string;
          order_line_id: string;
          ordered_quantity: string;
          outstanding_quantity: string;
          previously_received_quantity: string;
          product_code: string;
          product_id: string;
          product_name: string;
          serial_numbers: string[];
          unit_price: string;
        }>(
          `SELECT receipt_line.id AS goods_receipt_line_id, order_line.id AS order_line_id,
                  order_line.product_id, product.product_code, product.name AS product_name,
                  purchase_order.currency_code, order_line.ordered_quantity::text,
                  coalesce(previous_receipts.quantity, 0)::text AS previously_received_quantity,
                  receipt_line.quantity::text AS accepted_quantity,
                  (coalesce(previous_receipts.quantity, 0) + receipt_line.quantity)::text
                    AS cumulative_received_quantity,
                  (order_line.ordered_quantity - coalesce(previous_receipts.quantity, 0)
                    - receipt_line.quantity)::text AS outstanding_quantity,
                  order_line.unit_price::text, batch.batch_number, batch.expires_at::text,
                  coalesce(serials.serial_numbers, ARRAY[]::text[]) AS serial_numbers,
                  coalesce(claims.discrepancies, '[]'::jsonb) AS discrepancies
           FROM procurement.goods_receipt_lines receipt_line
           JOIN procurement.purchase_order_lines order_line
             ON order_line.id = receipt_line.purchase_order_line_id
           JOIN procurement.purchase_orders purchase_order
             ON purchase_order.id = order_line.purchase_order_id
           JOIN master_data.products product ON product.id = order_line.product_id
           JOIN inventory.stock_movements movement
             ON movement.id = receipt_line.stock_movement_id
           LEFT JOIN inventory.batches batch ON batch.id = movement.batch_id
           LEFT JOIN LATERAL (
             SELECT sum(prior_line.quantity) AS quantity
             FROM procurement.goods_receipt_lines prior_line
             JOIN procurement.goods_receipts prior_receipt
               ON prior_receipt.id = prior_line.goods_receipt_id
             JOIN procurement.goods_receipts current_receipt
               ON current_receipt.id = receipt_line.goods_receipt_id
             WHERE prior_line.purchase_order_line_id = order_line.id
               AND (prior_receipt.received_at, prior_receipt.id)
                   < (current_receipt.received_at, current_receipt.id)
           ) previous_receipts ON true
           LEFT JOIN LATERAL (
             SELECT array_agg(item.serial_number ORDER BY item.serial_number) AS serial_numbers
             FROM inventory.serialized_items item
             WHERE item.received_movement_id = movement.id
           ) serials ON true
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(jsonb_build_object(
                      'claimId', claim.id::text, 'claimType', claim.claim_type,
                      'description', claim.description, 'quantity', claim.quantity::text,
                      'status', claim.status
                    ) ORDER BY claim.created_at, claim.id) AS discrepancies
             FROM procurement.supplier_claims claim
             WHERE claim.goods_receipt_line_id = receipt_line.id
           ) claims ON true
           WHERE receipt_line.goods_receipt_id = $1
           ORDER BY product.name, product.product_code, receipt_line.id`,
          [receiptId],
        );
        if (linesResult.rowCount === 0)
          throw new ApiErrorException(
            'GOODS_RECEIPT_LINES_NOT_FOUND',
            'The delivery has no recorded product lines.',
            HttpStatus.CONFLICT,
          );

        await client.query(
          `INSERT INTO procurement.acceptance_protocols (
             id, protocol_number, sequence_year, sequence_number, goods_receipt_id,
             purchase_order_id, supplier_partner_id, warehouse_id, supplier_invoice_id,
             received_at, supplier_delivery_reference, received_by, prepared_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            protocolId,
            protocolNumber,
            sequenceYear,
            sequenceNumber,
            receipt.goods_receipt_id,
            receipt.purchase_order_id,
            receipt.supplier_partner_id,
            receipt.warehouse_id,
            normalized.supplierInvoiceId ?? null,
            receipt.received_at,
            receipt.supplier_delivery_reference,
            receipt.received_by,
            auth.accountId,
          ],
        );
        for (const line of linesResult.rows) {
          await client.query(
            `INSERT INTO procurement.acceptance_protocol_lines (
               id, acceptance_protocol_id, goods_receipt_line_id, purchase_order_line_id,
               product_id, product_code, product_name, currency_code, ordered_quantity,
               previously_received_quantity, accepted_quantity, cumulative_received_quantity,
               outstanding_quantity, unit_price, batch_number, expires_at, serial_numbers,
               discrepancies
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
            [
              randomUUID(),
              protocolId,
              line.goods_receipt_line_id,
              line.order_line_id,
              line.product_id,
              line.product_code,
              line.product_name,
              receipt.currency_code,
              line.ordered_quantity,
              line.previously_received_quantity,
              line.accepted_quantity,
              line.cumulative_received_quantity,
              line.outstanding_quantity,
              line.unit_price,
              line.batch_number,
              line.expires_at,
              line.serial_numbers,
              JSON.stringify(line.discrepancies),
            ],
          );
        }
        const result = await this.loadAcceptanceProtocolByReceipt(client, receiptId);
        if (!result) throw new Error('Acceptance protocol could not be loaded after creation');
        await this.sideEffects(
          client,
          'procurement_acceptance_protocol',
          result.id,
          'procurement.acceptance_protocol.created',
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
              line.expected_delivery_date::text,
              COALESCE(invoice_cost.unit_price, movement_cost.unit_cost_eur)::text
                AS cost_baseline_eur,
              CASE WHEN invoice_cost.unit_price IS NOT NULL THEN 'supplier_invoice'
                   WHEN movement_cost.unit_cost_eur IS NOT NULL THEN 'latest_product_cost'
                   ELSE NULL END AS cost_baseline_source
       FROM procurement.purchase_order_lines line
       JOIN master_data.products product ON product.id = line.product_id
       LEFT JOIN LATERAL (
         SELECT invoice_line.unit_price
         FROM procurement.supplier_invoice_lines invoice_line
         JOIN procurement.supplier_invoices invoice ON invoice.id = invoice_line.supplier_invoice_id
         JOIN procurement.purchase_order_lines source_line
           ON source_line.id = invoice_line.purchase_order_line_id
         WHERE source_line.product_id = line.product_id AND invoice.currency_code = 'EUR'
         ORDER BY invoice.invoice_date DESC, invoice.recorded_at DESC, invoice.id DESC
         LIMIT 1
       ) invoice_cost ON true
       LEFT JOIN LATERAL (
         SELECT movement.unit_cost_eur
         FROM inventory.stock_movements movement
         WHERE movement.product_id = line.product_id AND movement.unit_cost_eur > 0
         ORDER BY movement.occurred_at DESC, movement.id DESC
         LIMIT 1
       ) movement_cost ON true
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
    const protocolSummaries = await client.query<{
      goods_receipt_id: string;
      id: string;
      protocol_number: string;
    }>(
      `SELECT goods_receipt_id, id, protocol_number
       FROM procurement.acceptance_protocols
       WHERE goods_receipt_id = ANY($1::uuid[])`,
      [receipts.rows.map((receipt) => receipt.id)],
    );
    const protocolsByReceipt = new Map(
      protocolSummaries.rows.map((protocol) => [protocol.goods_receipt_id, protocol]),
    );
    const receiptLines = await client.query<ReceiptLineRow>(
      `SELECT receipt_line.id, receipt_line.goods_receipt_id,
              receipt_line.purchase_order_line_id AS order_line_id,
              order_line.product_id, receipt_line.stock_movement_id,
              receipt_line.quantity::text, receipt_line.unit_cost_eur::text,
              receipt_line.cost_baseline_eur::text, receipt_line.cost_baseline_source,
              receipt_line.cost_variance_percent::text,
              movement.total_cost_eur::text, movement.batch_id,
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
        ...(protocolsByReceipt.has(receipt.id)
          ? {
              acceptanceProtocol: {
                id: protocolsByReceipt.get(receipt.id)!.id,
                protocolNumber: protocolsByReceipt.get(receipt.id)!.protocol_number,
              },
            }
          : {}),
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

  private async loadAcceptanceProtocolByReceipt(
    client: PoolClient,
    receiptId: string,
  ): Promise<AcceptanceProtocol | undefined> {
    const headerResult = await client.query<AcceptanceProtocolHeaderRow>(
      `SELECT protocol.id, protocol.protocol_number, protocol.sequence_year AS number_year,
              protocol.sequence_number AS number_sequence, protocol.goods_receipt_id,
              protocol.purchase_order_id, protocol.supplier_partner_id,
              protocol.created_at::text, receipt.received_at::text,
              receipt.supplier_delivery_reference, supplier.display_name AS supplier_name,
              warehouse.name AS warehouse_name,
              received_employee.display_name AS received_by_name,
              prepared_employee.display_name AS prepared_by_name,
              invoice.id AS supplier_invoice_id,
              invoice.supplier_invoice_number AS invoice_number,
              invoice.invoice_date::text AS invoice_date
       FROM procurement.acceptance_protocols protocol
       JOIN procurement.goods_receipts receipt ON receipt.id = protocol.goods_receipt_id
       JOIN master_data.partners supplier ON supplier.id = protocol.supplier_partner_id
       JOIN master_data.warehouses warehouse ON warehouse.id = protocol.warehouse_id
       JOIN identity.user_accounts received_by ON received_by.id = protocol.received_by
       JOIN identity.employees received_employee ON received_employee.id = received_by.employee_id
       JOIN identity.user_accounts prepared_by ON prepared_by.id = protocol.prepared_by
       JOIN identity.employees prepared_employee ON prepared_employee.id = prepared_by.employee_id
       LEFT JOIN procurement.supplier_invoices invoice
         ON invoice.id = protocol.supplier_invoice_id
       WHERE protocol.goods_receipt_id = $1`,
      [receiptId],
    );
    const header = headerResult.rows[0];
    if (!header) return undefined;
    const linesResult = await client.query<AcceptanceProtocolLineRow>(
      `SELECT line.id, line.goods_receipt_line_id, line.purchase_order_line_id AS order_line_id,
              line.product_id, line.product_code, line.product_name, line.currency_code,
              line.ordered_quantity::text, line.previously_received_quantity::text,
              line.accepted_quantity::text, line.cumulative_received_quantity::text,
              line.outstanding_quantity::text, line.unit_price::text, line.batch_number,
              line.expires_at::text, line.serial_numbers, line.discrepancies
       FROM procurement.acceptance_protocol_lines line
       WHERE line.acceptance_protocol_id = $1
       ORDER BY line.product_name, line.product_code, line.id`,
      [header.id],
    );
    return {
      createdAt: header.created_at,
      goodsReceiptId: header.goods_receipt_id,
      id: header.id,
      lines: linesResult.rows.map((line) => ({
        acceptedQuantity: line.accepted_quantity,
        ...(line.batch_number ? { batchNumber: line.batch_number } : {}),
        currencyCode: line.currency_code,
        cumulativeReceivedQuantity: line.cumulative_received_quantity,
        discrepancies:
          typeof line.discrepancies === 'string'
            ? (JSON.parse(line.discrepancies) as AcceptanceProtocolLine['discrepancies'])
            : line.discrepancies,
        ...(line.expires_at ? { expiresAt: line.expires_at } : {}),
        goodsReceiptLineId: line.goods_receipt_line_id,
        id: line.id,
        orderLineId: line.order_line_id,
        orderedQuantity: line.ordered_quantity,
        outstandingQuantity: line.outstanding_quantity,
        previouslyReceivedQuantity: line.previously_received_quantity,
        productCode: line.product_code,
        productId: line.product_id,
        productName: line.product_name,
        serialNumbers: line.serial_numbers,
        unitPrice: line.unit_price,
      })),
      numberSequence: header.number_sequence,
      numberYear: header.number_year,
      preparedByName: header.prepared_by_name,
      protocolNumber: header.protocol_number,
      purchaseOrderId: header.purchase_order_id,
      receivedAt: header.received_at,
      receivedByName: header.received_by_name,
      ...(header.supplier_delivery_reference
        ? { supplierDeliveryReference: header.supplier_delivery_reference }
        : {}),
      ...(header.supplier_invoice_id && header.invoice_date && header.invoice_number
        ? {
            supplierInvoice: {
              id: header.supplier_invoice_id,
              invoiceDate: header.invoice_date,
              invoiceNumber: header.invoice_number,
            },
          }
        : {}),
      supplierName: header.supplier_name,
      supplierPartnerId: header.supplier_partner_id,
      warehouseName: header.warehouse_name,
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
    ...(row.cost_baseline_eur ? { costBaselineEur: row.cost_baseline_eur } : {}),
    ...(row.cost_baseline_source ? { costBaselineSource: row.cost_baseline_source } : {}),
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
    ...(row.cost_baseline_eur ? { costBaselineEur: row.cost_baseline_eur } : {}),
    ...(row.cost_baseline_source ? { costBaselineSource: row.cost_baseline_source } : {}),
    ...(row.cost_variance_percent ? { costVariancePercent: row.cost_variance_percent } : {}),
    id: row.id,
    orderLineId: row.order_line_id,
    productId: row.product_id,
    quantity: row.quantity,
    serialItemIds: row.serial_item_ids,
    stockMovementId: row.stock_movement_id,
    totalCostEur: row.total_cost_eur,
    unitCostEur: row.unit_cost_eur,
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
      ...(line.unitCostEur ? { unitCostEur: normalizeMoney(line.unitCostEur) } : {}),
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
