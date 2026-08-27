import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AcceptSalesHandoverRequest,
  ConfirmSalesQuotationRequest,
  CreateSalesQuotationRequest,
  CreateSalesShipmentRequest,
  SalesInvoice,
  SalesHandoverCertificate,
  SalesOrder,
  SalesQuotationLine,
  SalesReferenceData,
  SalesShipment,
  SalesWorkflow,
  VatTreatment,
} from '@vista/contracts';
import type { PoolClient } from 'pg';

import { AuditService } from '../audit/audit.service.js';
import type {
  AuthenticationContext,
  RequestSecurityMetadata,
} from '../auth/authentication.types.js';
import { ApiErrorException } from '../common/api-error.exception.js';
import { DatabaseService } from '../database/database.service.js';

type QuotationRow = {
  created_at: string;
  currency_code: string;
  customer_name: string;
  customer_partner_id: string;
  id: string;
  overall_discount_percent: string;
  quotation_number: string;
  status: SalesWorkflow['status'];
  subtotal: string;
  total: string;
  valid_until: string;
  vat_total: string;
  warehouse_id: string;
  warehouse_name: string;
};

type QuotationLineRow = {
  discount_percent: string;
  id: string;
  line_total: string;
  product_id: string;
  product_name: string;
  quantity: string;
  tracking_mode: SalesQuotationLine['trackingMode'];
  unit_price: string;
  vat_treatment: VatTreatment;
};

@Injectable()
export class SalesService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async referenceData(): Promise<SalesReferenceData> {
    const [customers, customerLocations, products, warehouses, serials, batches] =
      await Promise.all([
        this.database.getPool().query<{ id: string; name: string }>(
          `SELECT partner.id, partner.display_name AS name
         FROM master_data.partners partner
         JOIN master_data.partner_roles role ON role.partner_id = partner.id
         WHERE partner.active AND role.role = 'customer'
         ORDER BY partner.display_name, partner.id`,
        ),
        this.database.getPool().query<{
          customer_partner_id: string;
          id: string;
          name: string;
        }>(
          `SELECT location.id, location.partner_id AS customer_partner_id, location.name
         FROM master_data.customer_locations location
         JOIN master_data.partners partner ON partner.id = location.partner_id
         WHERE location.active AND partner.active
         ORDER BY partner.display_name, location.name, location.id`,
        ),
        this.database.getPool().query<{
          id: string;
          name: string;
          product_code: string;
          tracking_mode: SalesReferenceData['products'][number]['trackingMode'];
        }>(
          `SELECT product.id, product.name, product.product_code, category.tracking_mode
         FROM master_data.products product
         JOIN master_data.product_categories category ON category.id = product.category_id
         WHERE product.active AND category.active
         ORDER BY product.name, product.id`,
        ),
        this.database
          .getPool()
          .query<{ id: string; name: string }>(
            `SELECT id, name FROM master_data.warehouses WHERE active ORDER BY name, id`,
          ),
        this.database.getPool().query<{
          product_id: string;
          serial_number: string;
          warehouse_id: string;
        }>(
          `SELECT item.product_id, item.serial_number, item.warehouse_id
         FROM inventory.serialized_items item
         WHERE item.status = 'available' AND NOT EXISTS (
           SELECT 1 FROM inventory.stock_reservation_serials reserved
           WHERE reserved.serialized_item_id = item.id AND reserved.active
         ) ORDER BY item.serial_number`,
        ),
        this.database.getPool().query<{
          batch_number: string;
          product_id: string;
          quantity: string;
          warehouse_id: string;
        }>(
          `SELECT batch.product_id, batch.batch_number, balance.warehouse_id,
                balance.quantity::text
         FROM inventory.batch_stock_balances balance
         JOIN inventory.batches batch ON batch.id = balance.batch_id
         WHERE balance.quantity > 0 ORDER BY batch.batch_number`,
        ),
      ]);
    return {
      batches: batches.rows.map((row) => ({
        batchNumber: row.batch_number,
        productId: row.product_id,
        quantity: row.quantity,
        warehouseId: row.warehouse_id,
      })),
      customers: customers.rows,
      customerLocations: customerLocations.rows.map((row) => ({
        customerPartnerId: row.customer_partner_id,
        id: row.id,
        name: row.name,
      })),
      products: products.rows.map((row) => ({
        id: row.id,
        name: row.name,
        productCode: row.product_code,
        trackingMode: row.tracking_mode,
      })),
      serials: serials.rows.map((row) => ({
        productId: row.product_id,
        serialNumber: row.serial_number,
        warehouseId: row.warehouse_id,
      })),
      warehouses: warehouses.rows,
    };
  }

  async workflows(): Promise<SalesWorkflow[]> {
    const result = await this.database
      .getPool()
      .query<{ id: string }>('SELECT id FROM sales.quotations ORDER BY created_at DESC, id DESC');
    return Promise.all(result.rows.map((row) => this.workflow(row.id)));
  }

  async workflow(id: string): Promise<SalesWorkflow> {
    const client = await this.database.getPool().connect();
    try {
      return await this.loadWorkflow(client, id);
    } finally {
      client.release();
    }
  }

  async createQuotation(
    input: CreateSalesQuotationRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<SalesWorkflow> {
    const normalized = normalizeQuotation(input);
    return this.command('sales.quotation.create', key, normalized, async (client, commandKey) => {
      await this.requireCustomer(client, normalized.customerPartnerId);
      await this.requireWarehouse(client, normalized.warehouseId);
      const productIds = normalized.lines.map((line) => line.productId);
      const products = await client.query<{ id: string }>(
        `SELECT product.id FROM master_data.products product
         JOIN master_data.product_categories category ON category.id = product.category_id
         WHERE product.id = ANY($1::uuid[]) AND product.active AND category.active
         FOR KEY SHARE OF product`,
        [productIds],
      );
      if (products.rowCount !== productIds.length)
        throw new ApiErrorException(
          'SALES_PRODUCT_NOT_FOUND',
          'One or more selected products are unavailable',
          HttpStatus.NOT_FOUND,
        );

      const id = randomUUID();
      const number = await this.nextNumber(client, 'quotation', 'Q');
      await client.query(
        `INSERT INTO sales.quotations (
           id, quotation_number, customer_partner_id, warehouse_id, valid_until,
           currency_code, overall_discount_percent, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          number,
          normalized.customerPartnerId,
          normalized.warehouseId,
          normalized.validUntil,
          normalized.currencyCode,
          normalized.overallDiscountPercent,
          auth.accountId,
        ],
      );
      for (const line of normalized.lines) {
        await client.query(
          `INSERT INTO sales.quotation_lines (
             id, quotation_id, product_id, quantity, unit_price, discount_percent,
             vat_treatment, line_total
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7,
             round($4::numeric * $5::numeric * (1 - $6::numeric / 100), 4)
           )`,
          [
            randomUUID(),
            id,
            line.productId,
            line.quantity,
            line.unitPrice,
            line.discountPercent,
            line.vatTreatment,
          ],
        );
      }
      await client.query(
        `UPDATE sales.quotations quotation
         SET subtotal = totals.subtotal,
             vat_total = totals.vat_total,
             total = totals.subtotal + totals.vat_total,
             updated_at = now()
         FROM (
           SELECT quotation_id,
             round(sum(line_total) * (1 - $2::numeric / 100), 4) AS subtotal,
             round(sum(line_total * CASE vat_treatment
               WHEN 'standard_20' THEN 0.20
               WHEN 'reduced_9' THEN 0.09
               ELSE 0 END) * (1 - $2::numeric / 100), 4) AS vat_total
           FROM sales.quotation_lines WHERE quotation_id = $1 GROUP BY quotation_id
         ) totals
         WHERE quotation.id = totals.quotation_id`,
        [id, normalized.overallDiscountPercent],
      );
      const workflow = await this.loadWorkflow(client, id);
      await this.sideEffects(
        client,
        'sales_quotation',
        id,
        'sales.quotation.created',
        workflow,
        auth,
        metadata,
        commandKey,
      );
      return workflow;
    });
  }

  async confirmQuotation(
    quotationId: string,
    input: ConfirmSalesQuotationRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<SalesWorkflow> {
    const normalized = normalizeConfirmation(input);
    return this.command(
      `sales.quotation.confirm:${quotationId}`,
      key,
      normalized,
      async (client, commandKey) => {
        const quotation = await client.query<{
          customer_partner_id: string;
          status: string;
          valid_until: string;
          warehouse_id: string;
        }>(
          `SELECT customer_partner_id, warehouse_id, valid_until::text, status
           FROM sales.quotations WHERE id = $1 FOR UPDATE`,
          [quotationId],
        );
        const header = quotation.rows[0];
        if (!header)
          throw new ApiErrorException(
            'SALES_QUOTATION_NOT_FOUND',
            'The quotation was not found',
            HttpStatus.NOT_FOUND,
          );
        if (header.status !== 'draft')
          throw new ApiErrorException(
            'SALES_QUOTATION_NOT_DRAFT',
            'Only a draft quotation can be confirmed',
            HttpStatus.CONFLICT,
          );
        if (header.valid_until < new Date().toISOString().slice(0, 10))
          throw new ApiErrorException(
            'SALES_QUOTATION_EXPIRED',
            'The quotation validity period has ended',
            HttpStatus.CONFLICT,
          );
        const lines = await client.query<{
          id: string;
          product_id: string;
          quantity: string;
          tracking_mode: 'batch' | 'none' | 'serial';
        }>(
          `SELECT line.id, line.product_id, line.quantity::text, category.tracking_mode
           FROM sales.quotation_lines line
           JOIN master_data.products product ON product.id = line.product_id
           JOIN master_data.product_categories category ON category.id = product.category_id
           WHERE line.quotation_id = $1 ORDER BY line.id FOR KEY SHARE OF line`,
          [quotationId],
        );
        if (
          !sameIds(
            lines.rows.map((line) => line.id),
            normalized.lines.map((line) => line.quotationLineId),
          )
        )
          throw new ApiErrorException(
            'SALES_CONFIRMATION_LINES_INVALID',
            'Confirmation must include every quotation line exactly once',
            HttpStatus.BAD_REQUEST,
          );

        const orderId = randomUUID();
        const number = await this.nextNumber(client, 'order', 'SO');
        await client.query(
          `INSERT INTO sales.orders (
             id, order_number, quotation_id, customer_partner_id, warehouse_id, confirmed_by
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            orderId,
            number,
            quotationId,
            header.customer_partner_id,
            header.warehouse_id,
            auth.accountId,
          ],
        );
        for (const line of lines.rows) {
          const selection = required(
            normalized.lines.find((item) => item.quotationLineId === line.id),
            'Confirmation line is missing',
          );
          const serialNumbers = selection.serialNumbers ?? [];
          if (line.tracking_mode === 'serial') {
            if (!isWholeQuantity(line.quantity) || serialNumbers.length !== Number(line.quantity))
              throw new ApiErrorException(
                'SALES_SERIAL_SELECTION_REQUIRED',
                'Select one available serial number for every serialised unit',
                HttpStatus.CONFLICT,
              );
          } else if (serialNumbers.length) {
            throw new ApiErrorException(
              'SALES_SERIAL_SELECTION_NOT_ALLOWED',
              'Serial numbers can only be selected for serialised products',
              HttpStatus.BAD_REQUEST,
            );
          }
          await this.requireAvailableQuantity(
            client,
            header.warehouse_id,
            line.product_id,
            line.quantity,
          );
          const reservationId = randomUUID();
          await client.query(
            `INSERT INTO inventory.stock_reservations (
               id, warehouse_id, product_id, reference_type, reference_id,
               initial_quantity, remaining_quantity, created_by
             ) VALUES ($1, $2, $3, 'sales_order', $4, $5, $5, $6)`,
            [
              reservationId,
              header.warehouse_id,
              line.product_id,
              orderId,
              line.quantity,
              auth.accountId,
            ],
          );
          if (serialNumbers.length) {
            const serials = await client.query<{ id: string }>(
              `SELECT item.id FROM inventory.serialized_items item
               WHERE item.product_id = $1 AND item.warehouse_id = $2
                 AND item.status = 'available' AND item.serial_number = ANY($3::text[])
                 AND NOT EXISTS (
                   SELECT 1 FROM inventory.stock_reservation_serials reserved
                   WHERE reserved.serialized_item_id = item.id AND reserved.active
                 )
               FOR UPDATE OF item`,
              [line.product_id, header.warehouse_id, serialNumbers],
            );
            if (serials.rowCount !== serialNumbers.length)
              throw new ApiErrorException(
                'SALES_SERIAL_UNAVAILABLE',
                'One or more selected serial numbers are unavailable',
                HttpStatus.CONFLICT,
              );
            for (const serial of serials.rows)
              await client.query(
                `INSERT INTO inventory.stock_reservation_serials (
                   reservation_id, serialized_item_id
                 ) VALUES ($1, $2)`,
                [reservationId, serial.id],
              );
          }
          await client.query(
            `INSERT INTO sales.order_lines (
               id, order_id, quotation_line_id, product_id, quantity, reservation_id
             ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [randomUUID(), orderId, line.id, line.product_id, line.quantity, reservationId],
          );
        }
        await client.query(
          "UPDATE sales.quotations SET status = 'confirmed', updated_at = now() WHERE id = $1",
          [quotationId],
        );
        const workflow = await this.loadWorkflow(client, quotationId);
        await this.sideEffects(
          client,
          'sales_order',
          orderId,
          'sales.order.confirmed',
          workflow,
          auth,
          metadata,
          commandKey,
        );
        return workflow;
      },
    );
  }

  async createShipment(
    orderId: string,
    input: CreateSalesShipmentRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<SalesWorkflow> {
    const normalized = normalizeShipment(input);
    return this.command(
      `sales.shipment.create:${orderId}`,
      key,
      normalized,
      async (client, commandKey) => {
        const orderResult = await client.query<{
          customer_partner_id: string;
          quotation_id: string;
          status: string;
          warehouse_id: string;
        }>(
          `SELECT quotation_id, customer_partner_id, warehouse_id, status
           FROM sales.orders WHERE id = $1 FOR UPDATE`,
          [orderId],
        );
        const order = orderResult.rows[0];
        if (!order)
          throw new ApiErrorException(
            'SALES_ORDER_NOT_FOUND',
            'The sales order was not found',
            HttpStatus.NOT_FOUND,
          );
        if (order.status !== 'confirmed')
          throw new ApiErrorException(
            'SALES_ORDER_NOT_CONFIRMABLE',
            'Only a confirmed, unshipped order can be shipped',
            HttpStatus.CONFLICT,
          );
        const lines = await client.query<{
          id: string;
          product_id: string;
          quantity: string;
          reservation_id: string;
          tracking_mode: 'batch' | 'none' | 'serial';
        }>(
          `SELECT line.id, line.product_id, line.quantity::text, line.reservation_id,
                  category.tracking_mode
           FROM sales.order_lines line
           JOIN master_data.products product ON product.id = line.product_id
           JOIN master_data.product_categories category ON category.id = product.category_id
           WHERE line.order_id = $1 ORDER BY line.id FOR KEY SHARE OF line`,
          [orderId],
        );
        if (
          !sameIds(
            lines.rows.map((line) => line.id),
            normalized.lines.map((line) => line.orderLineId),
          )
        )
          throw new ApiErrorException(
            'SALES_SHIPMENT_LINES_INVALID',
            'Shipment must include every sales-order line exactly once',
            HttpStatus.BAD_REQUEST,
          );
        const shipmentId = randomUUID();
        const number = await this.nextNumber(client, 'shipment', 'SH');
        await client.query(
          `INSERT INTO sales.shipments (id, shipment_number, order_id, shipped_by)
           VALUES ($1, $2, $3, $4)`,
          [shipmentId, number, orderId, auth.accountId],
        );
        for (const line of lines.rows) {
          const inputLine = required(
            normalized.lines.find((item) => item.orderLineId === line.id),
            'Shipment line is missing',
          );
          if (line.tracking_mode === 'batch' && !inputLine.batchNumber)
            throw new ApiErrorException(
              'SALES_BATCH_REQUIRED',
              'Select a batch for every batch-tracked product',
              HttpStatus.CONFLICT,
            );
          const reservation = await client.query<{ remaining_quantity: string; status: string }>(
            `SELECT remaining_quantity::text, status FROM inventory.stock_reservations
             WHERE id = $1 FOR UPDATE`,
            [line.reservation_id],
          );
          if (
            reservation.rows[0]?.status !== 'active' ||
            reservation.rows[0]?.remaining_quantity !== line.quantity
          )
            throw new ApiErrorException(
              'SALES_RESERVATION_INVALID',
              'Reserved stock no longer matches the sales order',
              HttpStatus.CONFLICT,
            );
          const balance = await client.query<{ average_unit_cost_bgn: string }>(
            `UPDATE inventory.stock_balances
             SET quantity = quantity - $3, updated_at = now()
             WHERE warehouse_id = $1 AND product_id = $2 AND quantity >= $3
             RETURNING average_unit_cost_bgn::text`,
            [order.warehouse_id, line.product_id, line.quantity],
          );
          if (!balance.rowCount)
            throw new ApiErrorException(
              'SALES_STOCK_UNAVAILABLE',
              'Reserved stock is no longer physically available',
              HttpStatus.CONFLICT,
            );
          let batchId: string | null = null;
          if (inputLine.batchNumber) {
            const batch = await client.query<{ id: string }>(
              `SELECT id FROM inventory.batches
               WHERE product_id = $1 AND batch_number = $2 FOR KEY SHARE`,
              [line.product_id, inputLine.batchNumber],
            );
            batchId = batch.rows[0]?.id ?? null;
            if (!batchId)
              throw new ApiErrorException(
                'SALES_BATCH_NOT_FOUND',
                'The selected batch was not found',
                HttpStatus.CONFLICT,
              );
            const batchBalance = await client.query(
              `UPDATE inventory.batch_stock_balances
               SET quantity = quantity - $3, updated_at = now()
               WHERE warehouse_id = $1 AND batch_id = $2 AND quantity >= $3 RETURNING quantity`,
              [order.warehouse_id, batchId, line.quantity],
            );
            if (!batchBalance.rowCount)
              throw new ApiErrorException(
                'SALES_BATCH_STOCK_UNAVAILABLE',
                'The selected batch does not contain the reserved quantity',
                HttpStatus.CONFLICT,
              );
          }
          const shipmentLineId = randomUUID();
          const movementId = randomUUID();
          await client.query(
            `INSERT INTO inventory.stock_movements (
               id, warehouse_id, product_id, movement_type, quantity, reference_type,
               reference_id, actor_account_id, correlation_id, unit_cost_bgn,
               customer_partner_id, batch_id
             ) VALUES ($1, $2, $3, 'issue', $4, 'sales_shipment', $5, $6, $7, $8, $9, $10)`,
            [
              movementId,
              order.warehouse_id,
              line.product_id,
              line.quantity,
              shipmentLineId,
              auth.accountId,
              metadata.correlationId,
              required(balance.rows[0], 'Stock valuation is missing').average_unit_cost_bgn,
              order.customer_partner_id,
              batchId,
            ],
          );
          const reservedSerials = await client.query<{ id: string }>(
            `SELECT item.id
             FROM inventory.stock_reservation_serials reserved
             JOIN inventory.serialized_items item ON item.id = reserved.serialized_item_id
             WHERE reserved.reservation_id = $1 AND reserved.active
             FOR UPDATE OF item, reserved`,
            [line.reservation_id],
          );
          if (line.tracking_mode === 'serial') {
            if (reservedSerials.rowCount !== Number(line.quantity))
              throw new ApiErrorException(
                'SALES_SERIAL_RESERVATION_INVALID',
                'Reserved serial numbers no longer match the order quantity',
                HttpStatus.CONFLICT,
              );
            await client.query(
              `UPDATE inventory.serialized_items SET status = 'issued', issued_movement_id = $2
               WHERE id = ANY($1::uuid[])`,
              [reservedSerials.rows.map((serial) => serial.id), movementId],
            );
          }
          await client.query(
            `UPDATE inventory.stock_reservation_serials
             SET active = false, ended_at = now()
             WHERE reservation_id = $1 AND active`,
            [line.reservation_id],
          );
          await client.query(
            `UPDATE inventory.stock_reservations
             SET remaining_quantity = 0, status = 'consumed', ended_by = $2,
                 ended_at = now(), version = version + 1
             WHERE id = $1`,
            [line.reservation_id, auth.accountId],
          );
          await client.query(
            `INSERT INTO sales.shipment_lines (
               id, shipment_id, order_line_id, product_id, quantity,
               stock_movement_id, batch_number
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              shipmentLineId,
              shipmentId,
              line.id,
              line.product_id,
              line.quantity,
              movementId,
              inputLine.batchNumber ?? null,
            ],
          );
        }
        await client.query(
          "UPDATE sales.orders SET status = 'shipped', updated_at = now() WHERE id = $1",
          [orderId],
        );
        await client.query(
          "UPDATE sales.quotations SET status = 'shipped', updated_at = now() WHERE id = $1",
          [order.quotation_id],
        );
        const certificateId = randomUUID();
        const certificateNumber = await this.nextNumber(client, 'handover', 'HO');
        await client.query(
          `INSERT INTO sales.handover_certificates (
             id, certificate_number, order_id, shipment_id, customer_partner_id, prepared_by
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            certificateId,
            certificateNumber,
            orderId,
            shipmentId,
            order.customer_partner_id,
            auth.accountId,
          ],
        );
        await client.query(
          `INSERT INTO sales.handover_certificate_lines (
             id, certificate_id, product_id, product_name, quantity, serial_numbers
           )
           SELECT gen_random_uuid(), $1, line.product_id, product.name, line.quantity,
                  coalesce(
                    array_agg(item.serial_number ORDER BY item.serial_number)
                      FILTER (WHERE item.id IS NOT NULL),
                    '{}'::text[]
                  )
           FROM sales.shipment_lines line
           JOIN master_data.products product ON product.id = line.product_id
           LEFT JOIN inventory.serialized_items item
             ON item.issued_movement_id = line.stock_movement_id
           WHERE line.shipment_id = $2
           GROUP BY line.id, product.name`,
          [certificateId, shipmentId],
        );
        const workflow = await this.loadWorkflow(client, order.quotation_id);
        await this.sideEffects(
          client,
          'sales_handover_certificate',
          certificateId,
          'sales.handover-certificate.prepared',
          required(workflow.handover, 'Handover certificate is missing'),
          auth,
          metadata,
          `${commandKey}:handover`,
        );
        await this.sideEffects(
          client,
          'sales_shipment',
          shipmentId,
          'sales.shipment.completed',
          workflow,
          auth,
          metadata,
          commandKey,
        );
        return workflow;
      },
    );
  }

  async acceptHandover(
    certificateId: string,
    input: AcceptSalesHandoverRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<SalesWorkflow> {
    const normalized = normalizeHandoverAcceptance(input);
    return this.command(
      `sales.handover.accept:${certificateId}`,
      key,
      normalized,
      async (client, commandKey) => {
        const current = await client.query<{
          customer_partner_id: string;
          quotation_id: string;
          shipped_on: string;
          status: SalesHandoverCertificate['status'];
          version: number;
        }>(
          `SELECT orders.quotation_id, certificate.customer_partner_id,
                  shipment.shipped_at::date::text AS shipped_on,
                  certificate.status, certificate.version
           FROM sales.handover_certificates certificate
           JOIN sales.orders orders ON orders.id = certificate.order_id
           JOIN sales.shipments shipment ON shipment.id = certificate.shipment_id
           WHERE certificate.id = $1 FOR UPDATE OF certificate`,
          [certificateId],
        );
        const row = current.rows[0];
        if (!row)
          throw new ApiErrorException(
            'SALES_HANDOVER_NOT_FOUND',
            'The handover certificate was not found',
            HttpStatus.NOT_FOUND,
          );
        if (row.status !== 'prepared')
          throw new ApiErrorException(
            'SALES_HANDOVER_ALREADY_ACCEPTED',
            'The handover certificate has already been accepted',
            HttpStatus.CONFLICT,
          );
        if (row.version !== normalized.expectedVersion)
          throw new ApiErrorException(
            'SALES_HANDOVER_VERSION_CONFLICT',
            'The handover certificate changed after it was opened. Refresh and try again.',
            HttpStatus.CONFLICT,
          );
        const location = await client.query<{ id: string; name: string }>(
          `SELECT location.id, location.name
           FROM master_data.customer_locations location
           WHERE location.id = $1 AND location.partner_id = $2 AND location.active
           FOR KEY SHARE`,
          [normalized.customerLocationId, row.customer_partner_id],
        );
        if (!location.rowCount)
          throw new ApiErrorException(
            'SALES_HANDOVER_LOCATION_NOT_FOUND',
            'Choose an active location belonging to this customer.',
            HttpStatus.BAD_REQUEST,
          );
        const equipmentChanges = await this.registerHandoverEquipment(
          client,
          certificateId,
          normalized.customerLocationId,
          row.shipped_on,
          auth.accountId,
        );
        await client.query(
          `UPDATE sales.handover_certificates
           SET status = 'accepted', accepted_by_name = $2, acceptance_notes = $3,
               customer_location_id = $4, accepted_at = now(), version = version + 1,
               updated_at = now()
           WHERE id = $1`,
          [
            certificateId,
            normalized.acceptedByName,
            normalized.acceptanceNotes ?? null,
            normalized.customerLocationId,
          ],
        );
        const workflow = await this.loadWorkflow(client, row.quotation_id);
        for (const equipment of equipmentChanges)
          await this.sideEffects(
            client,
            'customer_equipment',
            equipment.id,
            equipment.eventType,
            {
              customerLocationId: normalized.customerLocationId,
              handoverCertificateId: certificateId,
              serialNumber: equipment.serialNumber,
            },
            auth,
            metadata,
            `${commandKey}:${equipment.id}`,
          );
        await this.sideEffects(
          client,
          'sales_handover_certificate',
          certificateId,
          'sales.handover-certificate.accepted',
          required(workflow.handover, 'Handover certificate is missing'),
          auth,
          metadata,
          commandKey,
        );
        return workflow;
      },
    );
  }

  private async registerHandoverEquipment(
    client: PoolClient,
    certificateId: string,
    customerLocationId: string,
    purchaseDate: string,
    actorAccountId: string,
  ): Promise<
    Array<{
      eventType:
        | 'master_data.customer_equipment.linked-to-stock-item'
        | 'master_data.customer_equipment.registered-from-sale';
      id: string;
      serialNumber: string;
    }>
  > {
    const changes: Array<{
      eventType:
        | 'master_data.customer_equipment.linked-to-stock-item'
        | 'master_data.customer_equipment.registered-from-sale';
      id: string;
      serialNumber: string;
    }> = [];
    const soldItems = await client.query<{
      product_id: string;
      product_name: string;
      serial_item_id: string | null;
      serial_number: string;
    }>(
      `SELECT line.product_id, line.product_name, item.id AS serial_item_id,
              selected.serial_number
       FROM sales.handover_certificate_lines line
       CROSS JOIN LATERAL unnest(line.serial_numbers) selected(serial_number)
       LEFT JOIN inventory.serialized_items item
         ON item.product_id = line.product_id
        AND upper(item.serial_number) = upper(selected.serial_number)
       WHERE line.certificate_id = $1
       ORDER BY line.id, selected.serial_number`,
      [certificateId],
    );
    for (const item of soldItems.rows) {
      if (!item.serial_item_id)
        throw new ApiErrorException(
          'SALES_HANDOVER_SERIAL_NOT_FOUND',
          `Serial ${item.serial_number} is no longer linked to its shipped inventory item. Review the shipment before accepting this handover.`,
          HttpStatus.CONFLICT,
        );
      const existing = await client.query<{
        customer_location_id: string;
        id: string;
        product_id: string | null;
        serialized_item_id: string | null;
      }>(
        `SELECT id, customer_location_id, product_id, serialized_item_id
         FROM master_data.customer_equipment
         WHERE serialized_item_id = $1 OR upper(serial_number) = upper($2)
         FOR UPDATE`,
        [item.serial_item_id, item.serial_number],
      );
      const equipment = existing.rows[0];
      if (equipment) {
        if (
          equipment.customer_location_id !== customerLocationId ||
          (equipment.product_id !== null && equipment.product_id !== item.product_id)
        )
          throw new ApiErrorException(
            'SALES_HANDOVER_SERIAL_ALREADY_REGISTERED',
            `Serial ${item.serial_number} is already registered to another customer location. Review the equipment record before accepting this handover.`,
            HttpStatus.CONFLICT,
          );
        if (!equipment.serialized_item_id)
          await client.query(
            `UPDATE master_data.customer_equipment
             SET serialized_item_id = $2, updated_by = $3, version = version + 1,
                 updated_at = now()
             WHERE id = $1`,
            [equipment.id, item.serial_item_id, actorAccountId],
          );
        if (!equipment.serialized_item_id)
          changes.push({
            eventType: 'master_data.customer_equipment.linked-to-stock-item',
            id: equipment.id,
            serialNumber: item.serial_number,
          });
        continue;
      }
      const equipmentId = randomUUID();
      await client.query(
        `INSERT INTO master_data.customer_equipment (
           id, customer_location_id, product_id, serialized_item_id, device_name,
           serial_number, purchase_date, warranty_start_date, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$8)`,
        [
          equipmentId,
          customerLocationId,
          item.product_id,
          item.serial_item_id,
          item.product_name,
          item.serial_number,
          purchaseDate,
          actorAccountId,
        ],
      );
      changes.push({
        eventType: 'master_data.customer_equipment.registered-from-sale',
        id: equipmentId,
        serialNumber: item.serial_number,
      });
    }
    return changes;
  }

  async createDraftInvoice(
    orderId: string,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<SalesWorkflow> {
    return this.command(
      `sales.invoice-draft.create:${orderId}`,
      key,
      {},
      async (client, commandKey) => {
        const orderResult = await client.query<{
          currency_code: string;
          customer_partner_id: string;
          quotation_id: string;
          shipment_id: string;
          status: string;
          subtotal: string;
          total: string;
          vat_total: string;
        }>(
          `SELECT orders.quotation_id, orders.customer_partner_id, orders.status,
                quotation.currency_code, quotation.subtotal::text, quotation.vat_total::text,
                quotation.total::text, shipment.id AS shipment_id
         FROM sales.orders orders
         JOIN sales.quotations quotation ON quotation.id = orders.quotation_id
         JOIN sales.shipments shipment ON shipment.order_id = orders.id
         WHERE orders.id = $1 FOR UPDATE OF orders`,
          [orderId],
        );
        const order = orderResult.rows[0];
        if (!order)
          throw new ApiErrorException(
            'SALES_SHIPPED_ORDER_NOT_FOUND',
            'A completed shipment is required before preparing the invoice',
            HttpStatus.NOT_FOUND,
          );
        if (order.status !== 'shipped')
          throw new ApiErrorException(
            'SALES_ORDER_NOT_SHIPPED',
            'Only a shipped order can be invoiced',
            HttpStatus.CONFLICT,
          );
        const invoiceId = randomUUID();
        const number = await this.nextNumber(client, 'invoice_draft', 'INV-DRAFT');
        await client.query(
          `INSERT INTO sales.invoices (
           id, invoice_number, order_id, shipment_id, customer_partner_id,
           currency_code, subtotal, vat_total, total, recorded_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            invoiceId,
            number,
            orderId,
            order.shipment_id,
            order.customer_partner_id,
            order.currency_code,
            order.subtotal,
            order.vat_total,
            order.total,
            auth.accountId,
          ],
        );
        await client.query(
          `INSERT INTO sales.invoice_lines (
           id, invoice_id, quotation_line_id, product_id, quantity,
           unit_price, vat_treatment, line_total
         )
         SELECT gen_random_uuid(), $1, line.id, line.product_id, line.quantity,
                line.unit_price, line.vat_treatment,
                round(line.line_total * (1 - quotation.overall_discount_percent / 100), 4)
         FROM sales.quotation_lines line
         JOIN sales.quotations quotation ON quotation.id = line.quotation_id
         WHERE line.quotation_id = $2`,
          [invoiceId, order.quotation_id],
        );
        await client.query(
          "UPDATE sales.orders SET status = 'invoiced', updated_at = now() WHERE id = $1",
          [orderId],
        );
        await client.query(
          "UPDATE sales.quotations SET status = 'invoiced', updated_at = now() WHERE id = $1",
          [order.quotation_id],
        );
        const workflow = await this.loadWorkflow(client, order.quotation_id);
        await this.sideEffects(
          client,
          'sales_invoice',
          invoiceId,
          'sales.invoice-draft.created',
          workflow,
          auth,
          metadata,
          commandKey,
        );
        return workflow;
      },
    );
  }

  private async loadWorkflow(client: PoolClient, id: string): Promise<SalesWorkflow> {
    const headerResult = await client.query<QuotationRow>(
      `SELECT quotation.id, quotation.quotation_number, quotation.customer_partner_id,
              customer.display_name AS customer_name, quotation.warehouse_id,
              warehouse.name AS warehouse_name, quotation.valid_until::text,
              quotation.currency_code, quotation.overall_discount_percent::text,
              quotation.subtotal::text, quotation.vat_total::text, quotation.total::text,
              quotation.status, quotation.created_at::text
       FROM sales.quotations quotation
       JOIN master_data.partners customer ON customer.id = quotation.customer_partner_id
       JOIN master_data.warehouses warehouse ON warehouse.id = quotation.warehouse_id
       WHERE quotation.id = $1`,
      [id],
    );
    const header = headerResult.rows[0];
    if (!header)
      throw new ApiErrorException(
        'SALES_QUOTATION_NOT_FOUND',
        'The quotation was not found',
        HttpStatus.NOT_FOUND,
      );
    const linesResult = await client.query<QuotationLineRow>(
      `SELECT line.id, line.product_id, product.name AS product_name, line.quantity::text,
              line.unit_price::text, line.discount_percent::text, line.vat_treatment,
              line.line_total::text, category.tracking_mode
       FROM sales.quotation_lines line
       JOIN master_data.products product ON product.id = line.product_id
       JOIN master_data.product_categories category ON category.id = product.category_id
       WHERE line.quotation_id = $1 ORDER BY line.id`,
      [id],
    );
    const order = await this.loadOrder(client, id);
    const workflow: SalesWorkflow = {
      createdAt: asIso(header.created_at),
      currencyCode: header.currency_code,
      customerName: header.customer_name,
      customerPartnerId: header.customer_partner_id,
      id: header.id,
      lines: linesResult.rows.map(mapQuotationLine),
      number: header.quotation_number,
      overallDiscountPercent: header.overall_discount_percent,
      status: header.status,
      subtotal: header.subtotal,
      total: header.total,
      validUntil: header.valid_until,
      vatTotal: header.vat_total,
      warehouseId: header.warehouse_id,
      warehouseName: header.warehouse_name,
      ...(order ? { order } : {}),
    };
    if (order) {
      const shipment = await this.loadShipment(client, order.id);
      if (shipment) workflow.shipment = shipment;
      const handover = await this.loadHandover(client, order.id);
      if (handover) workflow.handover = handover;
      const invoice = await this.loadInvoice(client, order.id);
      if (invoice) workflow.invoice = invoice;
    }
    return workflow;
  }

  private async loadHandover(
    client: PoolClient,
    orderId: string,
  ): Promise<SalesHandoverCertificate | undefined> {
    const result = await client.query<{
      acceptance_notes: string | null;
      accepted_at: string | null;
      accepted_by_name: string | null;
      certificate_number: string;
      customer_location_id: string | null;
      customer_location_name: string | null;
      id: string;
      prepared_at: string;
      status: SalesHandoverCertificate['status'];
      version: number;
    }>(
      `SELECT certificate.id, certificate.certificate_number, certificate.status,
              certificate.accepted_by_name, certificate.accepted_at::text,
              certificate.acceptance_notes, certificate.version, certificate.prepared_at::text,
              certificate.customer_location_id, location.name AS customer_location_name
       FROM sales.handover_certificates certificate
       LEFT JOIN master_data.customer_locations location
         ON location.id = certificate.customer_location_id
       WHERE certificate.order_id = $1`,
      [orderId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const lines = await client.query<{
      id: string;
      product_id: string;
      product_name: string;
      quantity: string;
      serial_numbers: string[];
    }>(
      `SELECT id, product_id, product_name, quantity::text, serial_numbers
       FROM sales.handover_certificate_lines WHERE certificate_id = $1 ORDER BY id`,
      [row.id],
    );
    return {
      ...(row.acceptance_notes ? { acceptanceNotes: row.acceptance_notes } : {}),
      ...(row.accepted_at ? { acceptedAt: asIso(row.accepted_at) } : {}),
      ...(row.accepted_by_name ? { acceptedByName: row.accepted_by_name } : {}),
      ...(row.customer_location_id && row.customer_location_name
        ? {
            customerLocationId: row.customer_location_id,
            customerLocationName: row.customer_location_name,
          }
        : {}),
      id: row.id,
      lines: lines.rows.map((line) => ({
        id: line.id,
        productId: line.product_id,
        productName: line.product_name,
        quantity: line.quantity,
        serialNumbers: line.serial_numbers,
      })),
      number: row.certificate_number,
      preparedAt: asIso(row.prepared_at),
      status: row.status,
      version: row.version,
    };
  }

  private async loadOrder(
    client: PoolClient,
    quotationId: string,
  ): Promise<SalesOrder | undefined> {
    const result = await client.query<{
      confirmed_at: string;
      id: string;
      order_number: string;
      status: SalesOrder['status'];
    }>(
      `SELECT id, order_number, status, confirmed_at::text
       FROM sales.orders WHERE quotation_id = $1`,
      [quotationId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const lines = await client.query<{
      id: string;
      product_id: string;
      product_name: string;
      quantity: string;
      reservation_id: string;
      serial_numbers: string[];
      tracking_mode: SalesOrder['lines'][number]['trackingMode'];
    }>(
      `SELECT line.id, line.product_id, product.name AS product_name, line.quantity::text,
              line.reservation_id, category.tracking_mode,
              coalesce(array_agg(item.serial_number ORDER BY item.serial_number)
                FILTER (WHERE item.id IS NOT NULL), ARRAY[]::text[]) AS serial_numbers
       FROM sales.order_lines line
       JOIN master_data.products product ON product.id = line.product_id
       JOIN master_data.product_categories category ON category.id = product.category_id
       LEFT JOIN inventory.stock_reservation_serials reserved
         ON reserved.reservation_id = line.reservation_id
       LEFT JOIN inventory.serialized_items item ON item.id = reserved.serialized_item_id
       WHERE line.order_id = $1
       GROUP BY line.id, product.name, category.tracking_mode ORDER BY line.id`,
      [row.id],
    );
    return {
      confirmedAt: asIso(row.confirmed_at),
      id: row.id,
      lines: lines.rows.map((line) => ({
        id: line.id,
        productId: line.product_id,
        productName: line.product_name,
        quantity: line.quantity,
        reservationId: line.reservation_id,
        reservedSerialNumbers: line.serial_numbers,
        trackingMode: line.tracking_mode,
      })),
      number: row.order_number,
      status: row.status,
    };
  }

  private async loadShipment(
    client: PoolClient,
    orderId: string,
  ): Promise<SalesShipment | undefined> {
    const result = await client.query<{ id: string; shipped_at: string; shipment_number: string }>(
      `SELECT id, shipment_number, shipped_at::text FROM sales.shipments WHERE order_id = $1`,
      [orderId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const lines = await client.query<{
      batch_number: string | null;
      id: string;
      order_line_id: string;
      product_id: string;
      product_name: string;
      quantity: string;
      serial_numbers: string[];
      stock_movement_id: string;
    }>(
      `SELECT line.id, line.order_line_id, line.product_id, product.name AS product_name,
              line.quantity::text, line.stock_movement_id, line.batch_number,
              coalesce(array_agg(item.serial_number ORDER BY item.serial_number)
                FILTER (WHERE item.id IS NOT NULL), ARRAY[]::text[]) AS serial_numbers
       FROM sales.shipment_lines line
       JOIN master_data.products product ON product.id = line.product_id
       LEFT JOIN inventory.serialized_items item ON item.issued_movement_id = line.stock_movement_id
       WHERE line.shipment_id = $1
       GROUP BY line.id, product.name ORDER BY line.id`,
      [row.id],
    );
    return {
      id: row.id,
      lines: lines.rows.map((line) => ({
        ...(line.batch_number ? { batchNumber: line.batch_number } : {}),
        id: line.id,
        orderLineId: line.order_line_id,
        productId: line.product_id,
        productName: line.product_name,
        quantity: line.quantity,
        serialNumbers: line.serial_numbers,
        stockMovementId: line.stock_movement_id,
      })),
      number: row.shipment_number,
      shippedAt: asIso(row.shipped_at),
    };
  }

  private async loadInvoice(
    client: PoolClient,
    orderId: string,
  ): Promise<SalesInvoice | undefined> {
    const result = await client.query<{
      currency_code: string;
      customer_name: string;
      customer_partner_id: string;
      id: string;
      invoice_number: string;
      recorded_at: string;
      status: 'draft';
      subtotal: string;
      total: string;
      vat_total: string;
    }>(
      `SELECT invoice.id, invoice.invoice_number, invoice.customer_partner_id,
              customer.display_name AS customer_name, invoice.currency_code,
              invoice.subtotal::text, invoice.vat_total::text, invoice.total::text,
              invoice.status, invoice.recorded_at::text
       FROM sales.invoices invoice
       JOIN master_data.partners customer ON customer.id = invoice.customer_partner_id
       WHERE invoice.order_id = $1`,
      [orderId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const lines = await client.query<{
      id: string;
      line_total: string;
      product_id: string;
      product_name: string;
      quantity: string;
      unit_price: string;
      vat_treatment: VatTreatment;
    }>(
      `SELECT line.id, line.product_id, product.name AS product_name, line.quantity::text,
              line.unit_price::text, line.vat_treatment, line.line_total::text
       FROM sales.invoice_lines line
       JOIN master_data.products product ON product.id = line.product_id
       WHERE line.invoice_id = $1 ORDER BY line.id`,
      [row.id],
    );
    return {
      currencyCode: row.currency_code,
      customerName: row.customer_name,
      customerPartnerId: row.customer_partner_id,
      id: row.id,
      lines: lines.rows.map((line) => ({
        id: line.id,
        lineTotal: line.line_total,
        productId: line.product_id,
        productName: line.product_name,
        quantity: line.quantity,
        unitPrice: line.unit_price,
        vatTreatment: line.vat_treatment,
      })),
      number: row.invoice_number,
      recordedAt: asIso(row.recorded_at),
      status: row.status,
      subtotal: row.subtotal,
      total: row.total,
      vatTotal: row.vat_total,
    };
  }

  private async requireAvailableQuantity(
    client: PoolClient,
    warehouseId: string,
    productId: string,
    quantity: string,
  ) {
    const balance = await client.query<{ quantity: string }>(
      `SELECT quantity::text FROM inventory.stock_balances
       WHERE warehouse_id = $1 AND product_id = $2 FOR UPDATE`,
      [warehouseId, productId],
    );
    const reserved = await client.query<{ quantity: string }>(
      `SELECT coalesce(sum(remaining_quantity), 0)::text AS quantity
       FROM inventory.stock_reservations
       WHERE warehouse_id = $1 AND product_id = $2 AND status = 'active'`,
      [warehouseId, productId],
    );
    const available =
      decimalUnits(balance.rows[0]?.quantity ?? '0') -
      decimalUnits(reserved.rows[0]?.quantity ?? '0');
    if (!balance.rows[0] || available < decimalUnits(quantity))
      throw new ApiErrorException(
        'SALES_STOCK_UNAVAILABLE',
        'There is not enough available stock to confirm this quotation',
        HttpStatus.CONFLICT,
      );
  }

  private async requireCustomer(client: PoolClient, id: string) {
    const result = await client.query(
      `SELECT partner.id FROM master_data.partners partner
       JOIN master_data.partner_roles role ON role.partner_id = partner.id
       WHERE partner.id = $1 AND partner.active AND role.role = 'customer'
       FOR KEY SHARE OF partner`,
      [id],
    );
    if (!result.rowCount)
      throw new ApiErrorException(
        'SALES_CUSTOMER_NOT_FOUND',
        'The selected customer was not found or is inactive',
        HttpStatus.NOT_FOUND,
      );
  }

  private async requireWarehouse(client: PoolClient, id: string) {
    const result = await client.query(
      'SELECT id FROM master_data.warehouses WHERE id = $1 AND active FOR KEY SHARE',
      [id],
    );
    if (!result.rowCount)
      throw new ApiErrorException(
        'SALES_WAREHOUSE_NOT_FOUND',
        'The selected warehouse was not found or is inactive',
        HttpStatus.NOT_FOUND,
      );
  }

  private async nextNumber(client: PoolClient, type: string, prefix: string): Promise<string> {
    await client.query(
      `INSERT INTO sales.internal_document_sequences (document_type)
       VALUES ($1) ON CONFLICT (document_type) DO NOTHING`,
      [type],
    );
    const result = await client.query<{ allocated: string }>(
      `UPDATE sales.internal_document_sequences
       SET next_value = next_value + 1 WHERE document_type = $1
       RETURNING (next_value - 1)::text AS allocated`,
      [type],
    );
    return `${prefix}-${new Date().getUTCFullYear()}-${required(result.rows[0], 'Sequence allocation failed').allocated.padStart(6, '0')}`;
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
      if (isUniqueViolation(error))
        throw new ApiErrorException(
          'SALES_WORKFLOW_CONFLICT',
          'This sales operation conflicts with an existing record',
          HttpStatus.CONFLICT,
        );
      throw error;
    } finally {
      client.release();
    }
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

function mapQuotationLine(row: QuotationLineRow): SalesQuotationLine {
  return {
    discountPercent: row.discount_percent,
    id: row.id,
    lineTotal: row.line_total,
    productId: row.product_id,
    productName: row.product_name,
    quantity: row.quantity,
    trackingMode: row.tracking_mode,
    unitPrice: row.unit_price,
    vatTreatment: row.vat_treatment,
  };
}

function normalizeQuotation(input: CreateSalesQuotationRequest) {
  const productIds = input.lines.map((line) => line.productId);
  if (new Set(productIds).size !== productIds.length)
    throw new ApiErrorException(
      'SALES_PRODUCT_DUPLICATE',
      'Each product can appear only once on a quotation',
      HttpStatus.BAD_REQUEST,
    );
  return {
    currencyCode: normalizeCurrency(input.currencyCode),
    customerPartnerId: input.customerPartnerId,
    lines: input.lines.map((line) => ({
      discountPercent: normalizePercent(line.discountPercent),
      productId: line.productId,
      quantity: normalizePositiveDecimal(line.quantity),
      unitPrice: normalizeDecimal(line.unitPrice),
      vatTreatment: line.vatTreatment,
    })),
    overallDiscountPercent: normalizePercent(input.overallDiscountPercent),
    validUntil: normalizeDate(input.validUntil),
    warehouseId: input.warehouseId,
  };
}

function normalizeConfirmation(input: ConfirmSalesQuotationRequest) {
  const ids = input.lines.map((line) => line.quotationLineId);
  if (new Set(ids).size !== ids.length)
    throw new ApiErrorException(
      'SALES_CONFIRMATION_LINE_DUPLICATE',
      'Each quotation line can appear only once',
      HttpStatus.BAD_REQUEST,
    );
  return {
    lines: input.lines.map((line) => ({
      quotationLineId: line.quotationLineId,
      ...(line.serialNumbers
        ? { serialNumbers: [...new Set(line.serialNumbers.map((serial) => serial.trim()))] }
        : {}),
    })),
  };
}

function normalizeShipment(input: CreateSalesShipmentRequest) {
  const ids = input.lines.map((line) => line.orderLineId);
  if (new Set(ids).size !== ids.length)
    throw new ApiErrorException(
      'SALES_SHIPMENT_LINE_DUPLICATE',
      'Each order line can appear only once',
      HttpStatus.BAD_REQUEST,
    );
  return {
    lines: input.lines.map((line) => ({
      ...(line.batchNumber?.trim() ? { batchNumber: line.batchNumber.trim() } : {}),
      orderLineId: line.orderLineId,
    })),
  };
}

function normalizeHandoverAcceptance(input: AcceptSalesHandoverRequest) {
  const acceptedByName = input.acceptedByName.trim();
  const acceptanceNotes = input.acceptanceNotes?.trim();
  if (!acceptedByName)
    throw new ApiErrorException(
      'SALES_HANDOVER_ACCEPTOR_REQUIRED',
      'Enter the name of the customer representative accepting the equipment',
      HttpStatus.BAD_REQUEST,
    );
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)
    throw new ApiErrorException(
      'SALES_HANDOVER_VERSION_INVALID',
      'Refresh the handover certificate and try again',
      HttpStatus.CONFLICT,
    );
  return {
    acceptedByName,
    ...(acceptanceNotes ? { acceptanceNotes } : {}),
    customerLocationId: input.customerLocationId,
    expectedVersion: input.expectedVersion,
  };
}

function normalizeCurrency(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/u.test(normalized))
    throw new ApiErrorException(
      'SALES_CURRENCY_INVALID',
      'Currency code must contain three letters',
      HttpStatus.BAD_REQUEST,
    );
  return normalized;
}

function normalizeDate(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(parsed.getTime()))
    throw new ApiErrorException(
      'SALES_DATE_INVALID',
      'Enter a valid calendar date',
      HttpStatus.BAD_REQUEST,
    );
  return value;
}

function normalizePercent(value: string) {
  const normalized = normalizeDecimal(value);
  const units = decimalUnits(normalized);
  if (units < 0n || units > 1_000_000n)
    throw new ApiErrorException(
      'SALES_DISCOUNT_INVALID',
      'Discount must be between 0 and 100 percent',
      HttpStatus.BAD_REQUEST,
    );
  return normalized;
}

function normalizePositiveDecimal(value: string) {
  const normalized = normalizeDecimal(value);
  if (decimalUnits(normalized) <= 0n)
    throw new ApiErrorException(
      'SALES_QUANTITY_INVALID',
      'Quantity must be greater than zero',
      HttpStatus.BAD_REQUEST,
    );
  return normalized;
}

function normalizeDecimal(value: string) {
  if (!/^\d+(\.\d{1,4})?$/u.test(value))
    throw new ApiErrorException(
      'SALES_DECIMAL_INVALID',
      'Enter a number with no more than four decimal places',
      HttpStatus.BAD_REQUEST,
    );
  const [whole, fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(4, '0')}`;
}

function decimalUnits(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(`${whole}${fraction.padEnd(4, '0').slice(0, 4)}`);
}

function isWholeQuantity(value: string) {
  return /^\d+(\.0+)?$/u.test(value);
}

function sameIds(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    [...left].sort().every((id, index) => id === [...right].sort()[index])
  );
}

function validKey(key: string | undefined) {
  const normalized = key?.trim();
  if (!normalized || normalized.length > 200)
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_REQUIRED',
      'A valid Idempotency-Key header is required',
      HttpStatus.BAD_REQUEST,
    );
  return normalized;
}

async function claim(client: PoolClient, scope: string, key: string, hash: string) {
  const inserted = await client.query(
    `INSERT INTO platform.idempotency_keys (
       scope, idempotency_key, request_hash, status, expires_at
     ) VALUES ($1, $2, $3, 'processing', now() + interval '24 hours')
     ON CONFLICT DO NOTHING RETURNING idempotency_key`,
    [scope, key, hash],
  );
  if (inserted.rowCount) return undefined;
  const existing = await client.query<{
    request_hash: string;
    response_body: Record<string, unknown> | null;
    status: string;
  }>(
    `SELECT request_hash, status, response_body FROM platform.idempotency_keys
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
  if (row.status === 'completed' && row.response_body) return row.response_body;
  throw new ApiErrorException(
    'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    'The original request is still being processed',
    HttpStatus.CONFLICT,
  );
}

function asIso(value: string) {
  return new Date(value).toISOString();
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
