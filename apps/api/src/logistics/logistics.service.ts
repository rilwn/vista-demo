import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  CompleteLogisticsDeliveryRequest,
  CreateLogisticsDeliveryRequest,
  CreateLogisticsReturnRequest,
  CreateLogisticsRouteRequest,
  LogisticsDelivery,
  LogisticsDeliveryHistoryEntry,
  LogisticsDeliveryPage,
  LogisticsReferenceData,
  LogisticsReturn,
  LogisticsReturnLine,
  LogisticsReturnPage,
  LogisticsRoutePlan,
  LogisticsRoutePlanPage,
  LogisticsRouteStop,
  ReceiveLogisticsReturnRequest,
  ReportLogisticsDeliveryExceptionRequest,
  UpdateLogisticsDeliveryStatusRequest,
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
import { InventoryService } from '../inventory/inventory.service.js';
import { SalesService } from '../sales/sales.service.js';
import { ServiceOperationsService } from '../service/service.service.js';
import type {
  ListLogisticsDeliveriesQueryDto,
  ListLogisticsReturnsQueryDto,
  ListLogisticsRoutesQueryDto,
} from './logistics.dto.js';

interface DeliveryRow {
  address_line_1: string;
  address_line_2: string | null;
  city: string;
  country_code: string;
  created_at: string;
  customer_location_id: string;
  customer_location_name: string;
  customer_name: string;
  customer_partner_id: string;
  delivered_at: string | null;
  delivery_method: LogisticsDelivery['deliveryMethod'];
  delivery_number: string;
  exception_reason: string | null;
  handover_certificate_id: string;
  handover_status: LogisticsDelivery['handoverStatus'];
  id: string;
  instructions: string | null;
  postal_code: string | null;
  proof_notes: string | null;
  recipient_name: string | null;
  scheduled_end: string;
  scheduled_start: string;
  shipment_id: string;
  shipment_number: string;
  status: LogisticsDelivery['status'];
  total_count?: string;
  version: number;
}

interface ReturnRow {
  created_at: string;
  customer_location_id: string;
  customer_location_name: string;
  customer_name: string;
  customer_partner_id: string;
  id: string;
  original_shipment_id: string;
  original_shipment_number: string;
  reason: string;
  received_at: string | null;
  return_number: string;
  scheduled_pickup_at: string | null;
  status: LogisticsReturn['status'];
  total_count?: string;
  transport_method: LogisticsReturn['transportMethod'];
  version: number;
}

interface ReturnLineRow {
  customer_equipment_id: string | null;
  customer_equipment_name: string | null;
  destination_warehouse_id: string;
  destination_warehouse_name: string;
  disposition: LogisticsReturnLine['disposition'];
  id: string;
  inventory_return_movement_id: string | null;
  original_issue_movement_id: string;
  product_id: string;
  product_name: string;
  quantity: string;
  serial_numbers: string[];
  service_request_id: string | null;
  service_request_number: string | null;
  service_type: LogisticsReturnLine['serviceType'] | null;
  shipment_line_id: string;
}

interface RouteRow {
  assigned_account_id: string;
  assigned_to: string;
  created_at: string;
  id: string;
  notes: string | null;
  route_date: string;
  route_number: string;
  status: LogisticsRoutePlan['status'];
  title: string;
  total_count?: string;
  version: number;
}

interface RouteStopSourceRow {
  address_line: string;
  assigned_account_id: string | null;
  city: string;
  label: string;
  scheduled_end: string | null;
  scheduled_start: string | null;
}

@Injectable()
export class LogisticsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(ServiceOperationsService) private readonly service: ServiceOperationsService,
    @Inject(SalesService) private readonly sales: SalesService,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {}

  async referenceData(): Promise<LogisticsReferenceData> {
    const pool = this.database.getPool();
    const [shipments, shipmentLines, locations, warehouses, equipment, assignees, serviceStops] =
      await Promise.all([
        pool.query<{
          customer_id: string;
          customer_name: string;
          handover_certificate_id: string;
          handover_status: 'prepared' | 'accepted';
          handover_version: number;
          id: string;
          number: string;
          shipped_at: string;
        }>(
          `SELECT shipment.id, shipment.shipment_number AS number, shipment.shipped_at::text,
                  quotation.customer_partner_id AS customer_id, partner.display_name AS customer_name,
                  handover.id AS handover_certificate_id, handover.status AS handover_status,
                  handover.version AS handover_version
           FROM sales.shipments shipment
           JOIN sales.orders orders ON orders.id = shipment.order_id
           JOIN sales.quotations quotation ON quotation.id = orders.quotation_id
           JOIN master_data.partners partner ON partner.id = quotation.customer_partner_id
           JOIN sales.handover_certificates handover ON handover.shipment_id = shipment.id
           WHERE partner.active
           ORDER BY shipment.shipped_at DESC, shipment.id DESC
           LIMIT 250`,
        ),
        pool.query<{
          id: string;
          original_issue_movement_id: string;
          product_id: string;
          product_name: string;
          quantity: string;
          serial_numbers: string[];
          shipment_id: string;
          tracking_mode: LogisticsReferenceData['shipments'][number]['lines'][number]['trackingMode'];
        }>(
          `SELECT line.id, line.shipment_id, line.product_id, product.name AS product_name,
                  line.quantity::text, line.stock_movement_id AS original_issue_movement_id,
                  category.tracking_mode,
                  COALESCE(handover_line.serial_numbers, ARRAY[]::text[]) AS serial_numbers
           FROM sales.shipment_lines line
           JOIN master_data.products product ON product.id = line.product_id
           JOIN master_data.product_categories category ON category.id = product.category_id
           JOIN sales.handover_certificates handover ON handover.shipment_id = line.shipment_id
           JOIN sales.handover_certificate_lines handover_line
             ON handover_line.certificate_id = handover.id
            AND handover_line.product_id = line.product_id
           ORDER BY line.shipment_id, line.id`,
        ),
        pool.query<{
          address_line_1: string;
          address_line_2: string | null;
          city: string;
          country_code: string;
          customer_id: string;
          id: string;
          name: string;
          postal_code: string | null;
        }>(
          `SELECT location.id, location.partner_id AS customer_id, location.name,
                  location.address_line_1, location.address_line_2, location.city,
                  location.postal_code, location.country_code
           FROM master_data.customer_locations location
           JOIN master_data.partners partner ON partner.id = location.partner_id
           WHERE location.active AND partner.active
           ORDER BY partner.display_name, location.name, location.id
           LIMIT 500`,
        ),
        pool.query<{ id: string; name: string; type: string }>(
          `SELECT id, name, warehouse_type AS type
           FROM master_data.warehouses WHERE active ORDER BY name, id`,
        ),
        pool.query<{
          customer_id: string;
          customer_location_id: string;
          device_name: string;
          id: string;
          serial_number: string;
          warranty_ends_on: string | null;
        }>(
          `SELECT equipment.id, equipment.customer_location_id,
                  location.partner_id AS customer_id, equipment.device_name,
                  equipment.serial_number, equipment.warranty_end_date::text AS warranty_ends_on
           FROM master_data.customer_equipment equipment
           JOIN master_data.customer_locations location ON location.id = equipment.customer_location_id
           WHERE equipment.active AND location.active AND equipment.status <> 'retired'
           ORDER BY equipment.device_name, equipment.serial_number, equipment.id
           LIMIT 500`,
        ),
        pool.query<{ account_id: string; display_name: string; email: string }>(
          `SELECT DISTINCT account.id AS account_id, employee.display_name, employee.email
           FROM identity.user_accounts account
           JOIN identity.employees employee ON employee.id = account.employee_id
           JOIN iam.account_roles assignment ON assignment.account_id = account.id
           JOIN iam.role_permissions role_permission ON role_permission.role_id = assignment.role_id
           JOIN iam.permissions permission ON permission.id = role_permission.permission_id
           WHERE account.status = 'active' AND employee.active
             AND permission.module IN ('erp.logistics', 'erp.service')
             AND permission.action = 'view'
           ORDER BY employee.display_name, account.id`,
        ),
        pool.query<{
          address_line: string;
          assigned_account_id: string;
          assigned_to: string;
          city: string;
          customer_name: string;
          id: string;
          label: string;
          scheduled_end: string;
          scheduled_start: string;
        }>(
          `SELECT work_order.id, partner.display_name AS customer_name,
                  work_order.assigned_technician_account_id AS assigned_account_id,
                  technician.display_name AS assigned_to,
                  concat(request.request_number, ' · ', equipment.device_name) AS label,
                  concat_ws(', ', location.address_line_1, location.address_line_2) AS address_line,
                  location.city, work_order.scheduled_start::text, work_order.scheduled_end::text
           FROM service.work_orders work_order
           JOIN service.requests request ON request.id = work_order.service_request_id
           JOIN master_data.partners partner ON partner.id = request.customer_partner_id
           JOIN master_data.customer_locations location ON location.id = request.customer_location_id
           JOIN master_data.customer_equipment equipment ON equipment.id = request.customer_equipment_id
           JOIN identity.user_accounts account
             ON account.id = work_order.assigned_technician_account_id
           JOIN identity.employees technician ON technician.id = account.employee_id
           WHERE work_order.status IN ('scheduled', 'in_progress')
             AND work_order.scheduled_start IS NOT NULL
           ORDER BY work_order.scheduled_start, work_order.id
           LIMIT 500`,
        ),
      ]);

    const linesByShipment = new Map<string, LogisticsReferenceData['shipments'][number]['lines']>();
    for (const line of shipmentLines.rows) {
      const lines = linesByShipment.get(line.shipment_id) ?? [];
      lines.push({
        id: line.id,
        originalIssueMovementId: line.original_issue_movement_id,
        productId: line.product_id,
        productName: line.product_name,
        quantity: line.quantity,
        serialNumbers: line.serial_numbers,
        trackingMode: line.tracking_mode,
      });
      linesByShipment.set(line.shipment_id, lines);
    }
    return {
      assignees: assignees.rows.map((row) => ({
        accountId: row.account_id,
        displayName: row.display_name,
        email: row.email,
      })),
      businessTimezone: this.environment.BUSINESS_TIMEZONE,
      courierConnections: [
        { connected: false, provider: 'econt' },
        { connected: false, provider: 'speedy' },
      ],
      equipment: equipment.rows.map((row) => ({
        customerId: row.customer_id,
        customerLocationId: row.customer_location_id,
        deviceName: row.device_name,
        id: row.id,
        serialNumber: row.serial_number,
        ...(row.warranty_ends_on ? { warrantyEndsOn: row.warranty_ends_on } : {}),
      })),
      locations: locations.rows.map((row) => ({
        addressLine1: row.address_line_1,
        ...(row.address_line_2 ? { addressLine2: row.address_line_2 } : {}),
        city: row.city,
        countryCode: row.country_code,
        customerId: row.customer_id,
        id: row.id,
        name: row.name,
        ...(row.postal_code ? { postalCode: row.postal_code } : {}),
      })),
      serviceStops: serviceStops.rows.map((row) => ({
        addressLine: row.address_line,
        assignedAccountId: row.assigned_account_id,
        assignedTo: row.assigned_to,
        city: row.city,
        customerName: row.customer_name,
        id: row.id,
        label: row.label,
        scheduledEnd: asIso(row.scheduled_end),
        scheduledStart: asIso(row.scheduled_start),
      })),
      shipments: shipments.rows.map((row) => ({
        customerId: row.customer_id,
        customerName: row.customer_name,
        handoverCertificateId: row.handover_certificate_id,
        handoverStatus: row.handover_status,
        handoverVersion: row.handover_version,
        id: row.id,
        lines: linesByShipment.get(row.id) ?? [],
        number: row.number,
        shippedAt: asIso(row.shipped_at),
      })),
      warehouses: warehouses.rows,
    };
  }

  async deliveries(query: ListLogisticsDeliveriesQueryDto): Promise<LogisticsDeliveryPage> {
    const offset = (query.page - 1) * query.pageSize;
    const result = await this.database.getPool().query<DeliveryRow>(
      `${deliverySelect()}
       WHERE ($1::text IS NULL OR delivery.status = $1)
       ORDER BY delivery.scheduled_start DESC, delivery.id DESC
       LIMIT $2 OFFSET $3`,
      [query.status ?? null, query.pageSize, offset],
    );
    const items = await Promise.all(result.rows.map((row) => this.mapDelivery(row)));
    const total = Number(result.rows[0]?.total_count ?? '0');
    return page(items, query.page, query.pageSize, total);
  }

  async delivery(id: string): Promise<LogisticsDelivery> {
    const result = await this.database
      .getPool()
      .query<DeliveryRow>(`${deliverySelect()} WHERE delivery.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) notFound('LOGISTICS_DELIVERY_NOT_FOUND', 'The delivery could not be found.');
    return this.mapDelivery(required(row, 'Delivery lookup failed'));
  }

  async createDelivery(
    input: CreateLogisticsDeliveryRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<LogisticsDelivery> {
    const normalized = normalizeDelivery(input);
    requireConfiguredTransport(normalized.deliveryMethod);
    return this.command(
      'logistics.delivery.create',
      key,
      normalized,
      async (client, commandKey) => {
        const source = await client.query<{
          address_line_1: string;
          address_line_2: string | null;
          city: string;
          country_code: string;
          customer_partner_id: string;
          handover_certificate_id: string;
          postal_code: string | null;
        }>(
          `SELECT quotation.customer_partner_id, handover.id AS handover_certificate_id,
                location.address_line_1, location.address_line_2, location.city,
                location.postal_code, location.country_code
         FROM sales.shipments shipment
         JOIN sales.orders orders ON orders.id = shipment.order_id
         JOIN sales.quotations quotation ON quotation.id = orders.quotation_id
         JOIN sales.handover_certificates handover ON handover.shipment_id = shipment.id
         JOIN master_data.customer_locations location
           ON location.id = $2 AND location.partner_id = quotation.customer_partner_id
         WHERE shipment.id = $1 AND location.active
         FOR KEY SHARE OF shipment, handover, location`,
          [normalized.shipmentId, normalized.customerLocationId],
        );
        const row = source.rows[0];
        if (!row)
          notFound(
            'LOGISTICS_DELIVERY_SOURCE_NOT_FOUND',
            'Choose a completed shipment and an active location for the same customer.',
          );
        const sourceRow = required(row, 'Delivery source lookup failed');
        const id = randomUUID();
        const number = await this.nextNumber(client, 'delivery', 'DLV');
        await client.query(
          `INSERT INTO logistics.deliveries (
           id, delivery_number, shipment_id, handover_certificate_id,
           customer_partner_id, customer_location_id, delivery_method,
           scheduled_start, scheduled_end, address_line_1, address_line_2,
           city, postal_code, country_code, instructions, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)`,
          [
            id,
            number,
            normalized.shipmentId,
            sourceRow.handover_certificate_id,
            sourceRow.customer_partner_id,
            normalized.customerLocationId,
            normalized.deliveryMethod,
            normalized.scheduledStart,
            normalized.scheduledEnd,
            sourceRow.address_line_1,
            sourceRow.address_line_2,
            sourceRow.city,
            sourceRow.postal_code,
            sourceRow.country_code,
            normalized.instructions ?? null,
            auth.accountId,
          ],
        );
        await this.addDeliveryHistory(
          client,
          id,
          null,
          'planned',
          'Delivery planned',
          auth.accountId,
        );
        const delivery = await this.loadDelivery(client, id);
        await this.sideEffects(
          client,
          'logistics_delivery',
          id,
          'logistics.delivery.planned',
          delivery,
          auth,
          metadata,
          commandKey,
        );
        return delivery;
      },
    );
  }

  dispatchDelivery(
    id: string,
    input: UpdateLogisticsDeliveryStatusRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<LogisticsDelivery> {
    return this.transitionDelivery(
      id,
      input,
      key,
      auth,
      metadata,
      ['planned', 'exception'],
      'in_transit',
      'logistics.delivery.dispatched',
      input.note ?? 'Delivery dispatched',
    );
  }

  async completeDelivery(
    id: string,
    input: CompleteLogisticsDeliveryRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<LogisticsDelivery> {
    const normalized = normalizeDeliveryCompletion(input);
    const commandKey = validKey(key);
    const context = await this.database.getPool().query<{
      handover_certificate_id: string;
      handover_status: 'prepared' | 'accepted';
      handover_version: number;
      status: LogisticsDelivery['status'];
    }>(
      `SELECT delivery.handover_certificate_id, delivery.status,
              handover.status AS handover_status, handover.version AS handover_version
       FROM logistics.deliveries delivery
       JOIN sales.handover_certificates handover ON handover.id = delivery.handover_certificate_id
       WHERE delivery.id = $1`,
      [id],
    );
    const current = context.rows[0];
    if (!current) notFound('LOGISTICS_DELIVERY_NOT_FOUND', 'The delivery could not be found.');
    const currentRow = required(current, 'Delivery completion lookup failed');
    if (currentRow.handover_status === 'prepared') {
      await this.sales.acceptHandover(
        currentRow.handover_certificate_id,
        {
          acceptedByName: normalized.recipientName,
          ...(normalized.proofNotes ? { acceptanceNotes: normalized.proofNotes } : {}),
          expectedVersion: currentRow.handover_version,
        },
        `${commandKey}:handover`,
        auth,
        metadata,
      );
    }
    return this.command(
      `logistics.delivery.complete:${id}`,
      commandKey,
      normalized,
      async (client, idempotencyKey) => {
        const delivery = await this.lockDelivery(client, id, normalized.expectedVersion);
        if (delivery.status !== 'in_transit')
          conflict(
            'LOGISTICS_DELIVERY_NOT_IN_TRANSIT',
            'Dispatch the delivery before recording customer receipt.',
          );
        await client.query(
          `UPDATE logistics.deliveries
           SET status = 'delivered', recipient_name = $2, delivered_at = $3,
               proof_notes = $4, exception_reason = NULL, version = version + 1,
               updated_by = $5, updated_at = now()
           WHERE id = $1`,
          [
            id,
            normalized.recipientName,
            normalized.deliveredAt,
            normalized.proofNotes ?? null,
            auth.accountId,
          ],
        );
        await this.addDeliveryHistory(
          client,
          id,
          delivery.status,
          'delivered',
          normalized.proofNotes ?? 'Received by customer',
          auth.accountId,
        );
        const result = await this.loadDelivery(client, id);
        await this.sideEffects(
          client,
          'logistics_delivery',
          id,
          'logistics.delivery.completed',
          result,
          auth,
          metadata,
          idempotencyKey,
        );
        return result;
      },
    );
  }

  reportDeliveryException(
    id: string,
    input: ReportLogisticsDeliveryExceptionRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<LogisticsDelivery> {
    const reason = requiredText(input.reason, 'Enter what prevented the delivery.');
    return this.transitionDelivery(
      id,
      { expectedVersion: input.expectedVersion, note: reason },
      key,
      auth,
      metadata,
      ['planned', 'in_transit'],
      'exception',
      'logistics.delivery.exception-recorded',
      reason,
    );
  }

  cancelDelivery(
    id: string,
    input: UpdateLogisticsDeliveryStatusRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<LogisticsDelivery> {
    const note = requiredText(input.note, 'Enter why the delivery is being cancelled.');
    return this.transitionDelivery(
      id,
      { expectedVersion: input.expectedVersion, note },
      key,
      auth,
      metadata,
      ['planned', 'exception'],
      'cancelled',
      'logistics.delivery.cancelled',
      note,
    );
  }

  async returns(query: ListLogisticsReturnsQueryDto): Promise<LogisticsReturnPage> {
    const offset = (query.page - 1) * query.pageSize;
    const result = await this.database.getPool().query<ReturnRow>(
      `${returnSelect()}
       WHERE ($1::text IS NULL OR reverse_return.status = $1)
       ORDER BY reverse_return.created_at DESC, reverse_return.id DESC
       LIMIT $2 OFFSET $3`,
      [query.status ?? null, query.pageSize, offset],
    );
    const items = await Promise.all(result.rows.map((row) => this.mapReturn(row)));
    const total = Number(result.rows[0]?.total_count ?? '0');
    return page(items, query.page, query.pageSize, total);
  }

  async returnRecord(id: string): Promise<LogisticsReturn> {
    const result = await this.database
      .getPool()
      .query<ReturnRow>(`${returnSelect()} WHERE reverse_return.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) notFound('LOGISTICS_RETURN_NOT_FOUND', 'The return could not be found.');
    return this.mapReturn(required(row, 'Return lookup failed'));
  }

  async createReturn(
    input: CreateLogisticsReturnRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<LogisticsReturn> {
    const normalized = normalizeReturn(input);
    requireConfiguredTransport(normalized.transportMethod);
    return this.command('logistics.return.create', key, normalized, async (client, commandKey) => {
      const source = await client.query<{ customer_partner_id: string }>(
        `SELECT quotation.customer_partner_id
         FROM sales.shipments shipment
         JOIN sales.orders orders ON orders.id = shipment.order_id
         JOIN sales.quotations quotation ON quotation.id = orders.quotation_id
         JOIN master_data.customer_locations location
           ON location.id = $2 AND location.partner_id = quotation.customer_partner_id
         WHERE shipment.id = $1 AND location.active
         FOR KEY SHARE OF shipment, location`,
        [normalized.originalShipmentId, normalized.customerLocationId],
      );
      const sourceRow = source.rows[0];
      if (!sourceRow)
        notFound(
          'LOGISTICS_RETURN_SOURCE_NOT_FOUND',
          'Choose a completed shipment and an active location for the same customer.',
        );
      const id = randomUUID();
      const number = await this.nextNumber(client, 'reverse_return', 'RTN');
      await client.query(
        `INSERT INTO logistics.reverse_returns (
           id, return_number, original_shipment_id, customer_partner_id,
           customer_location_id, transport_method, scheduled_pickup_at, reason, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id,
          number,
          normalized.originalShipmentId,
          sourceRow.customer_partner_id,
          normalized.customerLocationId,
          normalized.transportMethod,
          normalized.scheduledPickupAt ?? null,
          normalized.reason,
          auth.accountId,
        ],
      );
      for (const line of normalized.lines) {
        const shipmentLine = await this.validateReturnLine(
          client,
          normalized.originalShipmentId,
          normalized.customerLocationId,
          sourceRow.customer_partner_id,
          line,
        );
        await client.query(
          `INSERT INTO logistics.reverse_return_lines (
             id, reverse_return_id, shipment_line_id, product_id, quantity,
             disposition, destination_warehouse_id, customer_equipment_id,
             service_type, serial_numbers
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            randomUUID(),
            id,
            line.shipmentLineId,
            shipmentLine.product_id,
            line.quantity,
            line.disposition,
            line.destinationWarehouseId,
            line.customerEquipmentId ?? null,
            line.serviceType ?? null,
            line.serialNumbers,
          ],
        );
      }
      const result = await this.loadReturn(client, id);
      await this.sideEffects(
        client,
        'logistics_return',
        id,
        'logistics.return.registered',
        result,
        auth,
        metadata,
        commandKey,
      );
      return result;
    });
  }

  async receiveReturn(
    id: string,
    input: ReceiveLogisticsReturnRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<LogisticsReturn> {
    const commandKey = validKey(key);
    const current = await this.returnRecord(id);
    if (current.status === 'received') return current;
    if (current.status !== 'registered')
      conflict('LOGISTICS_RETURN_NOT_OPEN', 'Only a registered return can be received.');
    if (current.version !== input.expectedVersion) changedConflict();

    const processingLines = await this.returnProcessingLines(id);
    for (const line of processingLines) {
      let inventoryReturnMovementId = line.inventory_return_movement_id;
      if (!inventoryReturnMovementId) {
        const stockReturn = await this.inventory.returnStock(
          {
            destinationWarehouseId: line.destination_warehouse_id,
            disposition: line.disposition,
            originalIssueId: line.original_issue_movement_id,
            quantity: line.quantity,
            referenceId: current.number,
            ...(line.serial_numbers.length ? { serialNumbers: line.serial_numbers } : {}),
          },
          `${commandKey}:line:${line.id}:stock`,
          auth,
          metadata,
        );
        inventoryReturnMovementId = stockReturn.id;
        await this.database.getPool().query(
          `UPDATE logistics.reverse_return_lines
           SET inventory_return_movement_id = COALESCE(inventory_return_movement_id, $2)
           WHERE id = $1`,
          [line.id, stockReturn.id],
        );
      }
      if (line.disposition === 'service' && !line.service_request_id) {
        const serviceRequest = await this.service.createRequest(
          {
            customerEquipmentId: required(
              line.customer_equipment_id,
              'Service equipment is missing',
            ),
            customerLocationId: current.customerLocationId,
            customerPartnerId: current.customerId,
            priority: 'normal',
            problemDescription: `${current.number}: ${current.reason}`,
            serviceType: required(line.service_type, 'Service type is missing'),
            sourceChannel: 'on_site',
          },
          `${commandKey}:line:${line.id}:service`,
          auth,
          metadata,
        );
        await this.database.getPool().query(
          `UPDATE logistics.reverse_return_lines
           SET service_request_id = COALESCE(service_request_id, $2)
           WHERE id = $1`,
          [line.id, serviceRequest.id],
        );
      }
    }

    return this.command(
      `logistics.return.receive:${id}`,
      commandKey,
      input,
      async (client, idempotencyKey) => {
        const locked = await client.query<{ status: LogisticsReturn['status']; version: number }>(
          `SELECT status, version FROM logistics.reverse_returns WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const row = locked.rows[0];
        if (!row) notFound('LOGISTICS_RETURN_NOT_FOUND', 'The return could not be found.');
        if (row?.status === 'received') return this.loadReturn(client, id);
        if (row?.status !== 'registered')
          conflict('LOGISTICS_RETURN_NOT_OPEN', 'Only a registered return can be received.');
        if (row.version !== input.expectedVersion) changedConflict();
        const incomplete = await client.query(
          `SELECT 1 FROM logistics.reverse_return_lines
           WHERE reverse_return_id = $1
             AND (
               inventory_return_movement_id IS NULL
               OR (disposition = 'service' AND service_request_id IS NULL)
             )
           LIMIT 1`,
          [id],
        );
        if (incomplete.rowCount)
          throw new ApiErrorException(
            'LOGISTICS_RETURN_PROCESSING_INCOMPLETE',
            'The return could not be fully received. Try again to continue safely.',
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        await client.query(
          `UPDATE logistics.reverse_returns
           SET status = 'received', received_at = now(), received_by = $2,
               version = version + 1, updated_at = now()
           WHERE id = $1`,
          [id, auth.accountId],
        );
        const result = await this.loadReturn(client, id);
        await this.sideEffects(
          client,
          'logistics_return',
          id,
          'logistics.return.received',
          result,
          auth,
          metadata,
          idempotencyKey,
        );
        return result;
      },
    );
  }

  async routes(query: ListLogisticsRoutesQueryDto): Promise<LogisticsRoutePlanPage> {
    const dateFrom = calendarDate(query.dateFrom);
    const dateTo = calendarDate(query.dateTo);
    if (dateTo < dateFrom)
      throw new ApiErrorException(
        'LOGISTICS_ROUTE_DATE_RANGE_INVALID',
        'The end date must be on or after the start date.',
        HttpStatus.BAD_REQUEST,
      );
    const offset = (query.page - 1) * query.pageSize;
    const result = await this.database.getPool().query<RouteRow>(
      `${routeSelect()}
       WHERE route.route_date BETWEEN $1 AND $2
       ORDER BY route.route_date, route.route_number, route.id
       LIMIT $3 OFFSET $4`,
      [dateFrom, dateTo, query.pageSize, offset],
    );
    const items = await Promise.all(result.rows.map((row) => this.mapRoute(row)));
    const total = Number(result.rows[0]?.total_count ?? '0');
    return page(items, query.page, query.pageSize, total);
  }

  async route(id: string): Promise<LogisticsRoutePlan> {
    const result = await this.database
      .getPool()
      .query<RouteRow>(`${routeSelect()} WHERE route.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) notFound('LOGISTICS_ROUTE_NOT_FOUND', 'The route plan could not be found.');
    return this.mapRoute(required(row, 'Route lookup failed'));
  }

  async createRoute(
    input: CreateLogisticsRouteRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<LogisticsRoutePlan> {
    const normalized = normalizeRoute(input);
    return this.command('logistics.route.create', key, normalized, async (client, commandKey) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `service-schedule:${normalized.assignedAccountId}`,
      ]);
      const sourceLockKeys = normalized.stops
        .map((stop) => `logistics-route-stop:${stop.deliveryId ?? stop.serviceWorkOrderId}`)
        .sort();
      for (const sourceLockKey of sourceLockKeys)
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
          sourceLockKey,
        ]);
      const assignee = await client.query(
        `SELECT account.id
         FROM identity.user_accounts account
         JOIN identity.employees employee ON employee.id = account.employee_id
         WHERE account.id = $1 AND account.status = 'active' AND employee.active
         FOR KEY SHARE`,
        [normalized.assignedAccountId],
      );
      if (!assignee.rowCount)
        notFound('LOGISTICS_ASSIGNEE_NOT_FOUND', 'Choose an active employee for this route.');
      const sources: RouteStopSourceRow[] = [];
      for (const stop of normalized.stops) sources.push(await this.routeStopSource(client, stop));
      await this.assertRouteAvailability(client, normalized, sources);
      const id = randomUUID();
      const number = await this.nextNumber(client, 'route_plan', 'RTE');
      await client.query(
        `INSERT INTO logistics.route_plans (
           id, route_number, route_date, title, assigned_account_id, notes, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          id,
          number,
          normalized.routeDate,
          normalized.title,
          normalized.assignedAccountId,
          normalized.notes ?? null,
          auth.accountId,
        ],
      );
      for (const [index, stop] of normalized.stops.entries()) {
        const source = required(sources[index], 'Route stop source was not prepared.');
        await client.query(
          `INSERT INTO logistics.route_stops (
             id, route_plan_id, position, stop_type, delivery_id, service_work_order_id,
             planned_arrival, planned_duration_minutes, label, address_line, city
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            randomUUID(),
            id,
            index + 1,
            stop.stopType,
            stop.deliveryId ?? null,
            stop.serviceWorkOrderId ?? null,
            stop.plannedArrival,
            stop.plannedDurationMinutes,
            source.label,
            source.address_line,
            source.city,
          ],
        );
      }
      const result = await this.loadRoute(client, id);
      await this.sideEffects(
        client,
        'logistics_route_plan',
        id,
        'logistics.route.planned',
        result,
        auth,
        metadata,
        commandKey,
      );
      return result;
    });
  }

  private async transitionDelivery(
    id: string,
    input: UpdateLogisticsDeliveryStatusRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    allowed: LogisticsDelivery['status'][],
    next: LogisticsDelivery['status'],
    eventType: string,
    note: string,
  ): Promise<LogisticsDelivery> {
    return this.command(
      `logistics.delivery.${next}:${id}`,
      key,
      input,
      async (client, commandKey) => {
        const delivery = await this.lockDelivery(client, id, input.expectedVersion);
        if (!allowed.includes(delivery.status))
          conflict(
            'LOGISTICS_DELIVERY_STATUS_INVALID',
            'This delivery cannot move to the selected status from its current state.',
          );
        await client.query(
          `UPDATE logistics.deliveries
           SET status = $2, exception_reason = $3, version = version + 1,
               updated_by = $4, updated_at = now()
           WHERE id = $1`,
          [id, next, next === 'exception' ? note : null, auth.accountId],
        );
        await this.addDeliveryHistory(client, id, delivery.status, next, note, auth.accountId);
        const result = await this.loadDelivery(client, id);
        await this.sideEffects(
          client,
          'logistics_delivery',
          id,
          eventType,
          result,
          auth,
          metadata,
          commandKey,
        );
        return result;
      },
    );
  }

  private async lockDelivery(client: PoolClient, id: string, version: number) {
    const result = await client.query<{ status: LogisticsDelivery['status']; version: number }>(
      `SELECT status, version FROM logistics.deliveries WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = result.rows[0];
    if (!row) notFound('LOGISTICS_DELIVERY_NOT_FOUND', 'The delivery could not be found.');
    if (row?.version !== version) changedConflict();
    return required(row, 'Delivery lock failed');
  }

  private async validateReturnLine(
    client: PoolClient,
    shipmentId: string,
    customerLocationId: string,
    customerId: string,
    line: ReturnType<typeof normalizeReturn>['lines'][number],
  ) {
    const result = await client.query<{
      product_id: string;
      quantity: string;
      serial_numbers: string[];
      tracking_mode: 'batch' | 'none' | 'serial';
    }>(
      `SELECT shipment_line.product_id, shipment_line.quantity::text,
              category.tracking_mode,
              COALESCE(handover_line.serial_numbers, ARRAY[]::text[]) AS serial_numbers
       FROM sales.shipment_lines shipment_line
       JOIN master_data.products product ON product.id = shipment_line.product_id
       JOIN master_data.product_categories category ON category.id = product.category_id
       JOIN sales.handover_certificates handover ON handover.shipment_id = shipment_line.shipment_id
       JOIN sales.handover_certificate_lines handover_line
         ON handover_line.certificate_id = handover.id
        AND handover_line.product_id = shipment_line.product_id
       WHERE shipment_line.id = $1 AND shipment_line.shipment_id = $2
       FOR KEY SHARE OF shipment_line, product`,
      [line.shipmentLineId, shipmentId],
    );
    const shipmentLine = result.rows[0];
    if (!shipmentLine)
      notFound(
        'LOGISTICS_RETURN_LINE_NOT_FOUND',
        'One of the selected shipment items could not be found.',
      );
    const source = required(shipmentLine, 'Shipment return line lookup failed');
    if (decimalUnits(line.quantity) > decimalUnits(source.quantity))
      conflict(
        'LOGISTICS_RETURN_QUANTITY_EXCEEDED',
        'The returned quantity cannot exceed the shipped quantity.',
      );
    const warehouse = await client.query(
      `SELECT id FROM master_data.warehouses WHERE id = $1 AND active FOR KEY SHARE`,
      [line.destinationWarehouseId],
    );
    if (!warehouse.rowCount)
      notFound('LOGISTICS_RETURN_WAREHOUSE_NOT_FOUND', 'Choose an active destination warehouse.');
    if (source.tracking_mode === 'serial') {
      if (decimalUnits(line.quantity) % 10_000n !== 0n)
        conflict(
          'LOGISTICS_RETURN_SERIAL_QUANTITY_INVALID',
          'A serial-tracked return must use a whole-number quantity.',
        );
      if (BigInt(line.serialNumbers.length) !== decimalUnits(line.quantity) / 10_000n)
        conflict(
          'LOGISTICS_RETURN_SERIAL_COUNT_INVALID',
          'Select one shipped serial number for each returned unit.',
        );
      if (line.serialNumbers.some((serial) => !source.serial_numbers.includes(serial)))
        conflict(
          'LOGISTICS_RETURN_SERIAL_NOT_SHIPPED',
          'Every returned serial number must belong to the selected shipment item.',
        );
    } else if (line.serialNumbers.length) {
      conflict(
        'LOGISTICS_RETURN_SERIAL_NOT_ALLOWED',
        'Serial numbers are not used for this shipment item.',
      );
    }
    if (line.disposition === 'service') {
      const equipment = await client.query(
        `SELECT equipment.id
         FROM master_data.customer_equipment equipment
         JOIN master_data.customer_locations location
           ON location.id = equipment.customer_location_id
         WHERE equipment.id = $1 AND equipment.customer_location_id = $2
           AND location.partner_id = $3 AND equipment.active
           AND (equipment.product_id IS NULL OR equipment.product_id = $4)
         FOR KEY SHARE OF equipment`,
        [line.customerEquipmentId, customerLocationId, customerId, source.product_id],
      );
      if (!equipment.rowCount)
        notFound(
          'LOGISTICS_RETURN_EQUIPMENT_NOT_FOUND',
          'Choose active customer equipment matching this returned item.',
        );
    }
    return source;
  }

  private async returnProcessingLines(id: string): Promise<ReturnLineRow[]> {
    const result = await this.database
      .getPool()
      .query<ReturnLineRow>(
        `${returnLineSelect()} WHERE line.reverse_return_id = $1 ORDER BY line.id`,
        [id],
      );
    return result.rows;
  }

  private async assertRouteAvailability(
    client: PoolClient,
    route: ReturnType<typeof normalizeRoute>,
    sources: RouteStopSourceRow[],
  ): Promise<void> {
    const serviceWorkOrderIds = route.stops
      .map((stop) => stop.serviceWorkOrderId)
      .filter((id): id is string => Boolean(id));
    const prepared = route.stops.map((stop, index) => {
      const source = required(sources[index], 'Route stop source was not prepared.');
      const start = new Date(stop.plannedArrival);
      const end = new Date(start.getTime() + stop.plannedDurationMinutes * 60_000);
      if (stop.stopType === 'service') {
        if (source.assigned_account_id !== route.assignedAccountId)
          conflict(
            'LOGISTICS_ROUTE_SERVICE_ASSIGNEE_MISMATCH',
            'Assign the route to the technician responsible for every selected Service visit.',
          );
        const scheduledStart = new Date(
          required(source.scheduled_start, 'Service start is missing.'),
        );
        const scheduledEnd = new Date(required(source.scheduled_end, 'Service end is missing.'));
        if (
          start.getTime() !== scheduledStart.getTime() ||
          end.getTime() !== scheduledEnd.getTime()
        )
          conflict(
            'LOGISTICS_ROUTE_SERVICE_TIME_MISMATCH',
            'Keep each Service stop at its scheduled appointment time and duration.',
          );
      }
      return { end: end.toISOString(), source, start: start.toISOString(), stop };
    });

    const ordered = [...prepared].sort((left, right) => left.start.localeCompare(right.start));
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = required(ordered[index - 1], 'Previous route stop is missing.');
      const current = required(ordered[index], 'Current route stop is missing.');
      if (current.start < previous.end)
        conflict(
          'LOGISTICS_ROUTE_STOPS_OVERLAP',
          'Two route stops overlap. Leave enough time to complete each stop before the next begins.',
        );
    }

    const localStops: Array<
      (typeof prepared)[number] & {
        date: string;
        endTime: string;
        startTime: string;
        weekday: number;
      }
    > = [];
    for (const item of prepared) {
      const local = await client.query<{
        end_date: string;
        end_time: string;
        start_date: string;
        start_time: string;
        weekday: number;
      }>(
        `SELECT to_char($1::timestamptz AT TIME ZONE $3, 'YYYY-MM-DD') AS start_date,
                to_char($2::timestamptz AT TIME ZONE $3, 'YYYY-MM-DD') AS end_date,
                to_char($1::timestamptz AT TIME ZONE $3, 'HH24:MI') AS start_time,
                to_char($2::timestamptz AT TIME ZONE $3, 'HH24:MI') AS end_time,
                extract(isodow FROM ($1::timestamptz AT TIME ZONE $3))::int AS weekday`,
        [item.start, item.end, this.environment.BUSINESS_TIMEZONE],
      );
      const row = required(local.rows[0], 'Route time conversion failed.');
      if (row.start_date !== route.routeDate || row.end_date !== route.routeDate)
        conflict(
          'LOGISTICS_ROUTE_STOP_DATE_MISMATCH',
          'Every stop must start and finish on the selected route date.',
        );
      localStops.push({
        ...item,
        date: row.start_date,
        endTime: row.end_time,
        startTime: row.start_time,
        weekday: row.weekday,
      });
    }

    for (const item of prepared) {
      const existingRoute = await client.query<{ number: string }>(
        `SELECT route.route_number AS number
         FROM logistics.route_stops stop
         JOIN logistics.route_plans route ON route.id = stop.route_plan_id
         WHERE route.assigned_account_id = $1
           AND route.status IN ('planned', 'in_progress')
           AND tstzrange(
                 stop.planned_arrival,
                 stop.planned_arrival + stop.planned_duration_minutes * INTERVAL '1 minute',
                 '[)'
               ) && tstzrange($2::timestamptz, $3::timestamptz, '[)')
         ORDER BY stop.planned_arrival, stop.id LIMIT 1`,
        [route.assignedAccountId, item.start, item.end],
      );
      if (existingRoute.rows[0])
        conflict(
          'LOGISTICS_ROUTE_ASSIGNEE_OVERLAP',
          `${existingRoute.rows[0].number} already uses part of this time. Choose another time or employee.`,
        );

      const existingService = await client.query<{ number: string }>(
        `SELECT work_order.work_order_number AS number
         FROM service.work_orders work_order
         WHERE work_order.assigned_technician_account_id = $1
           AND work_order.status IN ('scheduled', 'in_progress')
           AND NOT (work_order.id = ANY($4::uuid[]))
           AND tstzrange(work_order.scheduled_start, work_order.scheduled_end, '[)')
               && tstzrange($2::timestamptz, $3::timestamptz, '[)')
         ORDER BY work_order.scheduled_start, work_order.id LIMIT 1`,
        [route.assignedAccountId, item.start, item.end, serviceWorkOrderIds],
      );
      if (existingService.rows[0])
        conflict(
          'LOGISTICS_ROUTE_SERVICE_OVERLAP',
          `${existingService.rows[0].number} already occupies part of this time. Choose another time or employee.`,
        );
    }

    const policy = await client.query<{ version: number }>(
      `SELECT version FROM service.technician_schedule_policies
       WHERE technician_account_id = $1`,
      [route.assignedAccountId],
    );
    if (!policy.rows[0]) {
      if (serviceWorkOrderIds.length)
        conflict(
          'LOGISTICS_ROUTE_TECHNICIAN_SCHEDULE_REQUIRED',
          'Set the technician’s working hours in Service before planning this route.',
        );
      return;
    }
    const windows = await client.query<{
      capacity_minutes: number;
      ends_at: string;
      max_visits: number;
      starts_at: string;
      weekday: number;
    }>(
      `SELECT weekday, to_char(starts_at, 'HH24:MI') AS starts_at,
              to_char(ends_at, 'HH24:MI') AS ends_at, capacity_minutes, max_visits
       FROM service.technician_schedule_windows
       WHERE technician_account_id = $1`,
      [route.assignedAccountId],
    );
    const windowByDay = new Map(windows.rows.map((window) => [window.weekday, window]));
    for (const item of localStops) {
      const window = windowByDay.get(item.weekday);
      if (!window || item.startTime < window.starts_at || item.endTime > window.ends_at)
        conflict(
          'LOGISTICS_ROUTE_OUTSIDE_AVAILABILITY',
          'Keep every route stop within the assigned technician’s working hours.',
        );
    }

    const workload = await client.query<{ booked_minutes: string; visit_count: string }>(
      `SELECT
         (
           COALESCE((
             SELECT sum(ceil(extract(epoch FROM (work_order.scheduled_end - work_order.scheduled_start)) / 60))
             FROM service.work_orders work_order
             WHERE work_order.assigned_technician_account_id = $1
               AND work_order.status IN ('scheduled', 'in_progress')
               AND (work_order.scheduled_start AT TIME ZONE $3)::date = $2::date
           ), 0)
           + COALESCE((
             SELECT sum(stop.planned_duration_minutes)
             FROM logistics.route_stops stop
             JOIN logistics.route_plans route ON route.id = stop.route_plan_id
             WHERE route.assigned_account_id = $1
               AND route.status IN ('planned', 'in_progress')
               AND stop.stop_type = 'delivery'
               AND (stop.planned_arrival AT TIME ZONE $3)::date = $2::date
           ), 0)
         )::text AS booked_minutes,
         (
           (SELECT count(*) FROM service.work_orders work_order
            WHERE work_order.assigned_technician_account_id = $1
              AND work_order.status IN ('scheduled', 'in_progress')
              AND (work_order.scheduled_start AT TIME ZONE $3)::date = $2::date)
           +
           (SELECT count(*) FROM logistics.route_stops stop
            JOIN logistics.route_plans route ON route.id = stop.route_plan_id
            WHERE route.assigned_account_id = $1
              AND route.status IN ('planned', 'in_progress')
              AND stop.stop_type = 'delivery'
              AND (stop.planned_arrival AT TIME ZONE $3)::date = $2::date)
         )::text AS visit_count`,
      [route.assignedAccountId, route.routeDate, this.environment.BUSINESS_TIMEZONE],
    );
    const proposedDeliveries = localStops.filter((item) => item.stop.stopType === 'delivery');
    const addedMinutes = proposedDeliveries.reduce(
      (total, item) => total + item.stop.plannedDurationMinutes,
      0,
    );
    const bookedMinutes = Number(workload.rows[0]?.booked_minutes ?? 0);
    const visitCount = Number(workload.rows[0]?.visit_count ?? 0);
    const routeWindow = windowByDay.get(localStops[0]?.weekday ?? 0);
    if (
      routeWindow &&
      (bookedMinutes + addedMinutes > routeWindow.capacity_minutes ||
        visitCount + proposedDeliveries.length > routeWindow.max_visits)
    )
      conflict(
        'LOGISTICS_ROUTE_CAPACITY_EXCEEDED',
        'This route exceeds the technician’s available workload for the selected day.',
      );
  }

  private async routeStopSource(
    client: PoolClient,
    stop: ReturnType<typeof normalizeRoute>['stops'][number],
  ): Promise<RouteStopSourceRow> {
    if (stop.stopType === 'delivery') {
      const result = await client.query<RouteStopSourceRow>(
        `SELECT concat(delivery.delivery_number, ' · ', partner.display_name) AS label,
                concat_ws(', ', delivery.address_line_1, delivery.address_line_2) AS address_line,
                delivery.city, NULL::uuid AS assigned_account_id,
                NULL::text AS scheduled_start, NULL::text AS scheduled_end
         FROM logistics.deliveries delivery
         JOIN master_data.partners partner ON partner.id = delivery.customer_partner_id
         WHERE delivery.id = $1 AND delivery.status IN ('planned', 'in_transit', 'exception')
           AND NOT EXISTS (
             SELECT 1 FROM logistics.route_stops existing_stop
             JOIN logistics.route_plans existing_route
               ON existing_route.id = existing_stop.route_plan_id
             WHERE existing_stop.delivery_id = delivery.id
               AND existing_route.status <> 'cancelled'
           )
         FOR KEY SHARE OF delivery`,
        [stop.deliveryId],
      );
      const row = result.rows[0];
      if (!row)
        conflict(
          'LOGISTICS_ROUTE_DELIVERY_UNAVAILABLE',
          'The selected delivery is unavailable or already belongs to another active route.',
        );
      return required(row, 'Delivery route stop lookup failed');
    }
    const result = await client.query<RouteStopSourceRow>(
      `SELECT concat(request.request_number, ' · ', equipment.device_name) AS label,
              concat_ws(', ', location.address_line_1, location.address_line_2) AS address_line,
              location.city, work_order.assigned_technician_account_id AS assigned_account_id,
              work_order.scheduled_start::text, work_order.scheduled_end::text
       FROM service.work_orders work_order
       JOIN service.requests request ON request.id = work_order.service_request_id
       JOIN master_data.customer_locations location ON location.id = request.customer_location_id
       JOIN master_data.customer_equipment equipment ON equipment.id = request.customer_equipment_id
       WHERE work_order.id = $1 AND work_order.status IN ('scheduled', 'in_progress')
         AND NOT EXISTS (
           SELECT 1 FROM logistics.route_stops existing_stop
           JOIN logistics.route_plans existing_route ON existing_route.id = existing_stop.route_plan_id
           WHERE existing_stop.service_work_order_id = work_order.id
             AND existing_route.status <> 'cancelled'
         )
       FOR KEY SHARE OF work_order`,
      [stop.serviceWorkOrderId],
    );
    const row = result.rows[0];
    if (!row)
      conflict(
        'LOGISTICS_ROUTE_SERVICE_UNAVAILABLE',
        'The selected Service visit is unavailable or already belongs to another active route.',
      );
    return required(row, 'Service route stop lookup failed');
  }

  private async mapDelivery(row: DeliveryRow): Promise<LogisticsDelivery> {
    const history = await this.database.getPool().query<{
      changed_at: string;
      changed_by: string;
      next_status: LogisticsDelivery['status'];
      note: string | null;
      previous_status: LogisticsDelivery['status'] | null;
    }>(
      `SELECT history.previous_status, history.next_status, history.note,
              history.changed_at::text, employee.display_name AS changed_by
       FROM logistics.delivery_status_history history
       JOIN identity.user_accounts account ON account.id = history.changed_by
       JOIN identity.employees employee ON employee.id = account.employee_id
       WHERE history.delivery_id = $1 ORDER BY history.changed_at, history.id`,
      [row.id],
    );
    return mapDelivery(row, history.rows);
  }

  private async loadDelivery(client: PoolClient, id: string): Promise<LogisticsDelivery> {
    const result = await client.query<DeliveryRow>(`${deliverySelect()} WHERE delivery.id = $1`, [
      id,
    ]);
    const row = required(result.rows[0], 'Delivery could not be loaded');
    const history = await client.query<{
      changed_at: string;
      changed_by: string;
      next_status: LogisticsDelivery['status'];
      note: string | null;
      previous_status: LogisticsDelivery['status'] | null;
    }>(
      `SELECT history.previous_status, history.next_status, history.note,
              history.changed_at::text, employee.display_name AS changed_by
       FROM logistics.delivery_status_history history
       JOIN identity.user_accounts account ON account.id = history.changed_by
       JOIN identity.employees employee ON employee.id = account.employee_id
       WHERE history.delivery_id = $1 ORDER BY history.changed_at, history.id`,
      [id],
    );
    return mapDelivery(row, history.rows);
  }

  private async mapReturn(row: ReturnRow): Promise<LogisticsReturn> {
    const lines = await this.database
      .getPool()
      .query<ReturnLineRow>(
        `${returnLineSelect()} WHERE line.reverse_return_id = $1 ORDER BY line.id`,
        [row.id],
      );
    return mapReturn(row, lines.rows);
  }

  private async loadReturn(client: PoolClient, id: string): Promise<LogisticsReturn> {
    const result = await client.query<ReturnRow>(`${returnSelect()} WHERE reverse_return.id = $1`, [
      id,
    ]);
    const row = required(result.rows[0], 'Return could not be loaded');
    const lines = await client.query<ReturnLineRow>(
      `${returnLineSelect()} WHERE line.reverse_return_id = $1 ORDER BY line.id`,
      [id],
    );
    return mapReturn(row, lines.rows);
  }

  private async mapRoute(row: RouteRow): Promise<LogisticsRoutePlan> {
    const stops = await this.database.getPool().query<{
      address_line: string;
      city: string;
      delivery_id: string | null;
      id: string;
      label: string;
      planned_arrival: string;
      planned_duration_minutes: number;
      position: number;
      service_work_order_id: string | null;
      stop_type: LogisticsRouteStop['stopType'];
    }>(`SELECT * FROM logistics.route_stops WHERE route_plan_id = $1 ORDER BY position, id`, [row.id]);
    return mapRoute(row, stops.rows);
  }

  private async loadRoute(client: PoolClient, id: string): Promise<LogisticsRoutePlan> {
    const result = await client.query<RouteRow>(`${routeSelect()} WHERE route.id = $1`, [id]);
    const row = required(result.rows[0], 'Route could not be loaded');
    const stops = await client.query<{
      address_line: string;
      city: string;
      delivery_id: string | null;
      id: string;
      label: string;
      planned_arrival: string;
      planned_duration_minutes: number;
      position: number;
      service_work_order_id: string | null;
      stop_type: LogisticsRouteStop['stopType'];
    }>(`SELECT * FROM logistics.route_stops WHERE route_plan_id = $1 ORDER BY position, id`, [id]);
    return mapRoute(row, stops.rows);
  }

  private addDeliveryHistory(
    client: PoolClient,
    deliveryId: string,
    previous: LogisticsDelivery['status'] | null,
    next: LogisticsDelivery['status'],
    note: string,
    actorId: string,
  ) {
    return client.query(
      `INSERT INTO logistics.delivery_status_history (
         id, delivery_id, previous_status, next_status, note, changed_by
       ) VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), deliveryId, previous, next, note, actorId],
    );
  }

  private async nextNumber(client: PoolClient, type: string, prefix: string): Promise<string> {
    await client.query(
      `INSERT INTO logistics.internal_document_sequences (document_type)
       VALUES ($1) ON CONFLICT (document_type) DO NOTHING`,
      [type],
    );
    const result = await client.query<{ allocated: string }>(
      `UPDATE logistics.internal_document_sequences
       SET next_value = next_value + 1, updated_at = now()
       WHERE document_type = $1
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
        conflict(
          'LOGISTICS_RECORD_CONFLICT',
          'This record already exists or conflicts with another active operation.',
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
       ) VALUES ($1,$2,$3,$4,1,$5,$6,$7)`,
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

function deliverySelect() {
  return `SELECT delivery.id, delivery.delivery_number, delivery.shipment_id,
                 shipment.shipment_number, delivery.handover_certificate_id,
                 handover.status AS handover_status,
                 delivery.customer_partner_id, partner.display_name AS customer_name,
                 delivery.customer_location_id, location.name AS customer_location_name,
                 delivery.delivery_method, delivery.status, delivery.scheduled_start::text,
                 delivery.scheduled_end::text, delivery.address_line_1, delivery.address_line_2,
                 delivery.city, delivery.postal_code, delivery.country_code,
                 delivery.instructions, delivery.recipient_name, delivery.delivered_at::text,
                 delivery.proof_notes, delivery.exception_reason, delivery.version,
                 delivery.created_at::text, count(*) OVER ()::text AS total_count
          FROM logistics.deliveries delivery
          JOIN sales.shipments shipment ON shipment.id = delivery.shipment_id
          JOIN sales.handover_certificates handover ON handover.id = delivery.handover_certificate_id
          JOIN master_data.partners partner ON partner.id = delivery.customer_partner_id
          JOIN master_data.customer_locations location ON location.id = delivery.customer_location_id`;
}

function returnSelect() {
  return `SELECT reverse_return.id, reverse_return.return_number,
                 reverse_return.original_shipment_id,
                 shipment.shipment_number AS original_shipment_number,
                 reverse_return.customer_partner_id, partner.display_name AS customer_name,
                 reverse_return.customer_location_id, location.name AS customer_location_name,
                 reverse_return.transport_method, reverse_return.status,
                 reverse_return.scheduled_pickup_at::text, reverse_return.reason,
                 reverse_return.received_at::text, reverse_return.version,
                 reverse_return.created_at::text, count(*) OVER ()::text AS total_count
          FROM logistics.reverse_returns reverse_return
          JOIN sales.shipments shipment ON shipment.id = reverse_return.original_shipment_id
          JOIN master_data.partners partner ON partner.id = reverse_return.customer_partner_id
          JOIN master_data.customer_locations location ON location.id = reverse_return.customer_location_id`;
}

function returnLineSelect() {
  return `SELECT line.id, line.shipment_line_id,
                 shipment_line.stock_movement_id AS original_issue_movement_id,
                 line.product_id, product.name AS product_name, line.quantity::text,
                 line.disposition, line.destination_warehouse_id,
                 warehouse.name AS destination_warehouse_name,
                 line.customer_equipment_id, equipment.device_name AS customer_equipment_name,
                 line.service_type, line.serial_numbers,
                 line.inventory_return_movement_id, line.service_request_id,
                 service_request.request_number AS service_request_number
          FROM logistics.reverse_return_lines line
          JOIN sales.shipment_lines shipment_line ON shipment_line.id = line.shipment_line_id
          JOIN master_data.products product ON product.id = line.product_id
          JOIN master_data.warehouses warehouse ON warehouse.id = line.destination_warehouse_id
          LEFT JOIN master_data.customer_equipment equipment ON equipment.id = line.customer_equipment_id
          LEFT JOIN service.requests service_request ON service_request.id = line.service_request_id`;
}

function routeSelect() {
  return `SELECT route.id, route.route_number, route.route_date::text,
                 route.title, route.assigned_account_id,
                 employee.display_name AS assigned_to, route.status, route.notes,
                 route.version, route.created_at::text,
                 count(*) OVER ()::text AS total_count
          FROM logistics.route_plans route
          JOIN identity.user_accounts account ON account.id = route.assigned_account_id
          JOIN identity.employees employee ON employee.id = account.employee_id`;
}

function mapDelivery(
  row: DeliveryRow,
  historyRows: Array<{
    changed_at: string;
    changed_by: string;
    next_status: LogisticsDelivery['status'];
    note: string | null;
    previous_status: LogisticsDelivery['status'] | null;
  }>,
): LogisticsDelivery {
  const history: LogisticsDeliveryHistoryEntry[] = historyRows.map((item) => ({
    changedAt: asIso(item.changed_at),
    changedBy: item.changed_by,
    nextStatus: item.next_status,
    ...(item.note ? { note: item.note } : {}),
    ...(item.previous_status ? { previousStatus: item.previous_status } : {}),
  }));
  return {
    addressLine1: row.address_line_1,
    ...(row.address_line_2 ? { addressLine2: row.address_line_2 } : {}),
    city: row.city,
    countryCode: row.country_code,
    createdAt: asIso(row.created_at),
    customerId: row.customer_partner_id,
    customerLocationId: row.customer_location_id,
    customerLocationName: row.customer_location_name,
    customerName: row.customer_name,
    ...(row.delivered_at ? { deliveredAt: asIso(row.delivered_at) } : {}),
    deliveryMethod: row.delivery_method,
    ...(row.exception_reason ? { exceptionReason: row.exception_reason } : {}),
    handoverCertificateId: row.handover_certificate_id,
    handoverStatus: row.handover_status,
    history,
    id: row.id,
    ...(row.instructions ? { instructions: row.instructions } : {}),
    number: row.delivery_number,
    ...(row.postal_code ? { postalCode: row.postal_code } : {}),
    ...(row.proof_notes ? { proofNotes: row.proof_notes } : {}),
    ...(row.recipient_name ? { recipientName: row.recipient_name } : {}),
    scheduledEnd: asIso(row.scheduled_end),
    scheduledStart: asIso(row.scheduled_start),
    shipmentId: row.shipment_id,
    shipmentNumber: row.shipment_number,
    status: row.status,
    version: row.version,
  };
}

function mapReturn(row: ReturnRow, lines: ReturnLineRow[]): LogisticsReturn {
  return {
    createdAt: asIso(row.created_at),
    customerId: row.customer_partner_id,
    customerLocationId: row.customer_location_id,
    customerLocationName: row.customer_location_name,
    customerName: row.customer_name,
    id: row.id,
    lines: lines.map((line) => ({
      ...(line.customer_equipment_id ? { customerEquipmentId: line.customer_equipment_id } : {}),
      ...(line.customer_equipment_name
        ? { customerEquipmentName: line.customer_equipment_name }
        : {}),
      destinationWarehouseId: line.destination_warehouse_id,
      destinationWarehouseName: line.destination_warehouse_name,
      disposition: line.disposition,
      id: line.id,
      ...(line.inventory_return_movement_id
        ? { inventoryReturnMovementId: line.inventory_return_movement_id }
        : {}),
      productId: line.product_id,
      productName: line.product_name,
      quantity: line.quantity,
      serialNumbers: line.serial_numbers,
      ...(line.service_request_id ? { serviceRequestId: line.service_request_id } : {}),
      ...(line.service_request_number ? { serviceRequestNumber: line.service_request_number } : {}),
      ...(line.service_type ? { serviceType: line.service_type } : {}),
      shipmentLineId: line.shipment_line_id,
    })),
    number: row.return_number,
    originalShipmentId: row.original_shipment_id,
    originalShipmentNumber: row.original_shipment_number,
    reason: row.reason,
    ...(row.received_at ? { receivedAt: asIso(row.received_at) } : {}),
    ...(row.scheduled_pickup_at ? { scheduledPickupAt: asIso(row.scheduled_pickup_at) } : {}),
    status: row.status,
    transportMethod: row.transport_method,
    version: row.version,
  };
}

function mapRoute(
  row: RouteRow,
  stops: Array<{
    address_line: string;
    city: string;
    delivery_id: string | null;
    id: string;
    label: string;
    planned_arrival: string;
    planned_duration_minutes: number;
    position: number;
    service_work_order_id: string | null;
    stop_type: LogisticsRouteStop['stopType'];
  }>,
): LogisticsRoutePlan {
  return {
    assignedAccountId: row.assigned_account_id,
    assignedTo: row.assigned_to,
    createdAt: asIso(row.created_at),
    id: row.id,
    ...(row.notes ? { notes: row.notes } : {}),
    number: row.route_number,
    routeDate: row.route_date,
    status: row.status,
    stops: stops.map((stop) => ({
      addressLine: stop.address_line,
      city: stop.city,
      ...(stop.delivery_id ? { deliveryId: stop.delivery_id } : {}),
      id: stop.id,
      label: stop.label,
      plannedArrival: asIso(stop.planned_arrival),
      plannedDurationMinutes: stop.planned_duration_minutes,
      position: stop.position,
      ...(stop.service_work_order_id ? { serviceWorkOrderId: stop.service_work_order_id } : {}),
      stopType: stop.stop_type,
    })),
    title: row.title,
    version: row.version,
  };
}

function normalizeDelivery(input: CreateLogisticsDeliveryRequest) {
  const scheduledStart = timestamp(input.scheduledStart, 'Enter a valid delivery start time.');
  const scheduledEnd = timestamp(input.scheduledEnd, 'Enter a valid delivery end time.');
  if (new Date(scheduledEnd).getTime() <= new Date(scheduledStart).getTime())
    throw new ApiErrorException(
      'LOGISTICS_DELIVERY_SCHEDULE_INVALID',
      'The delivery end time must be after its start time.',
      HttpStatus.BAD_REQUEST,
    );
  const instructions = input.instructions?.trim();
  return {
    customerLocationId: input.customerLocationId,
    deliveryMethod: input.deliveryMethod,
    ...(instructions ? { instructions } : {}),
    scheduledEnd,
    scheduledStart,
    shipmentId: input.shipmentId,
  };
}

function normalizeDeliveryCompletion(input: CompleteLogisticsDeliveryRequest) {
  const proofNotes = input.proofNotes?.trim();
  return {
    deliveredAt: timestamp(input.deliveredAt, 'Enter a valid delivery time.'),
    expectedVersion: positiveVersion(input.expectedVersion),
    ...(proofNotes ? { proofNotes } : {}),
    recipientName: requiredText(input.recipientName, 'Enter the recipient name.'),
  };
}

function normalizeReturn(input: CreateLogisticsReturnRequest) {
  const ids = input.lines.map((line) => line.shipmentLineId);
  if (new Set(ids).size !== ids.length)
    throw new ApiErrorException(
      'LOGISTICS_RETURN_LINE_DUPLICATE',
      'Each shipment item can appear only once on a return.',
      HttpStatus.BAD_REQUEST,
    );
  return {
    customerLocationId: input.customerLocationId,
    lines: input.lines.map((line) => {
      const serialNumbers = [
        ...new Set((line.serialNumbers ?? []).map((value) => value.trim())),
      ].filter(Boolean);
      if (line.disposition === 'service' && (!line.customerEquipmentId || !line.serviceType))
        throw new ApiErrorException(
          'LOGISTICS_RETURN_SERVICE_DETAILS_REQUIRED',
          'Choose the customer equipment and service type for a repair return.',
          HttpStatus.BAD_REQUEST,
        );
      if (line.disposition === 'restock' && (line.customerEquipmentId || line.serviceType))
        throw new ApiErrorException(
          'LOGISTICS_RETURN_RESTOCK_DETAILS_INVALID',
          'Customer equipment and service type apply only to repair returns.',
          HttpStatus.BAD_REQUEST,
        );
      return {
        ...(line.customerEquipmentId ? { customerEquipmentId: line.customerEquipmentId } : {}),
        destinationWarehouseId: line.destinationWarehouseId,
        disposition: line.disposition,
        quantity: positiveDecimal(line.quantity),
        serialNumbers,
        ...(line.serviceType ? { serviceType: line.serviceType } : {}),
        shipmentLineId: line.shipmentLineId,
      };
    }),
    originalShipmentId: input.originalShipmentId,
    reason: requiredText(input.reason, 'Enter why the item is being returned.'),
    ...(input.scheduledPickupAt
      ? {
          scheduledPickupAt: timestamp(input.scheduledPickupAt, 'Enter a valid collection time.'),
        }
      : {}),
    transportMethod: input.transportMethod,
  };
}

function normalizeRoute(input: CreateLogisticsRouteRequest) {
  const routeDate = calendarDate(input.routeDate);
  const sourceKeys = input.stops.map((stop) =>
    stop.stopType === 'delivery'
      ? `delivery:${stop.deliveryId}`
      : `service:${stop.serviceWorkOrderId}`,
  );
  if (new Set(sourceKeys).size !== sourceKeys.length)
    throw new ApiErrorException(
      'LOGISTICS_ROUTE_STOP_DUPLICATE',
      'Each delivery or Service visit can appear only once on a route.',
      HttpStatus.BAD_REQUEST,
    );
  return {
    assignedAccountId: input.assignedAccountId,
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    routeDate,
    stops: input.stops.map((stop) => {
      if (
        (stop.stopType === 'delivery' && (!stop.deliveryId || stop.serviceWorkOrderId)) ||
        (stop.stopType === 'service' && (!stop.serviceWorkOrderId || stop.deliveryId))
      )
        throw new ApiErrorException(
          'LOGISTICS_ROUTE_STOP_SOURCE_INVALID',
          'Choose exactly one delivery or Service visit for each stop.',
          HttpStatus.BAD_REQUEST,
        );
      return {
        ...(stop.deliveryId ? { deliveryId: stop.deliveryId } : {}),
        plannedArrival: timestamp(stop.plannedArrival, 'Enter a valid arrival time.'),
        plannedDurationMinutes: stop.plannedDurationMinutes,
        ...(stop.serviceWorkOrderId ? { serviceWorkOrderId: stop.serviceWorkOrderId } : {}),
        stopType: stop.stopType,
      };
    }),
    title: requiredText(input.title, 'Enter a route title.'),
  };
}

function requireConfiguredTransport(method: string) {
  if (method === 'econt' || method === 'speedy')
    throw new ApiErrorException(
      'COURIER_CONNECTION_NOT_CONFIGURED',
      'This courier is not connected yet. Choose company transport or customer drop-off.',
      HttpStatus.CONFLICT,
    );
}

function timestamp(value: string, message: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new ApiErrorException('LOGISTICS_TIME_INVALID', message, HttpStatus.BAD_REQUEST);
  return date.toISOString();
}

function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
    throw new ApiErrorException(
      'LOGISTICS_DATE_INVALID',
      'Enter a valid calendar date.',
      HttpStatus.BAD_REQUEST,
    );
  return value;
}

function positiveVersion(value: number) {
  if (!Number.isInteger(value) || value < 1) changedConflict();
  return value;
}

function requiredText(value: string | undefined, message: string) {
  const normalized = value?.trim();
  if (!normalized)
    throw new ApiErrorException('LOGISTICS_TEXT_REQUIRED', message, HttpStatus.BAD_REQUEST);
  return normalized;
}

function positiveDecimal(value: string) {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,4})?$/u.test(normalized) || decimalUnits(normalized) <= 0n)
    throw new ApiErrorException(
      'LOGISTICS_QUANTITY_INVALID',
      'Enter a quantity greater than zero with up to four decimal places.',
      HttpStatus.BAD_REQUEST,
    );
  const [whole = '0', fraction = ''] = normalized.split('.');
  return `${BigInt(whole).toString()}.${fraction.padEnd(4, '0')}`;
}

function decimalUnits(value: string) {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0').slice(0, 4));
}

function page<T>(items: T[], current: number, pageSize: number, total: number) {
  return {
    items,
    page: current,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

function asIso(value: string | Date) {
  return new Date(value).toISOString();
}

function changedConflict(): never {
  throw new ApiErrorException(
    'LOGISTICS_RECORD_CHANGED',
    'This record changed after it was opened. Refresh and try again.',
    HttpStatus.CONFLICT,
  );
}

function conflict(code: string, message: string): never {
  throw new ApiErrorException(code, message, HttpStatus.CONFLICT);
}

function notFound(code: string, message: string): never {
  throw new ApiErrorException(code, message, HttpStatus.NOT_FOUND);
}

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

function validKey(value: string | undefined) {
  if (!value || value.length > 255)
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_REQUIRED',
      'This action requires a valid Idempotency-Key header.',
      HttpStatus.BAD_REQUEST,
    );
  return value;
}

async function claim(client: PoolClient, scope: string, key: string, hash: string) {
  const inserted = await client.query(
    `INSERT INTO platform.idempotency_keys (
       scope, idempotency_key, request_hash, status, expires_at
     ) VALUES ($1,$2,$3,'processing',now() + interval '24 hours')
     ON CONFLICT DO NOTHING RETURNING idempotency_key`,
    [scope, key, hash],
  );
  if (inserted.rowCount) return undefined;
  const existing = await client.query<{
    request_hash: string;
    response_body: unknown;
    status: string;
  }>(
    `SELECT request_hash, status, response_body FROM platform.idempotency_keys
     WHERE scope = $1 AND idempotency_key = $2 FOR UPDATE`,
    [scope, key],
  );
  const row = required(existing.rows[0], 'Idempotency record disappeared');
  if (row.request_hash !== hash)
    conflict(
      'IDEMPOTENCY_KEY_REUSED',
      'This action key was already used for different information.',
    );
  if (row.status === 'completed') return row.response_body;
  conflict('COMMAND_IN_PROGRESS', 'This action is already being processed.');
}

function isUniqueViolation(error: unknown): error is { code: '23505' } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
