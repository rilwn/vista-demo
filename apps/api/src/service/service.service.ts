import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  AssignServiceWorkOrderRequest,
  CancelServiceRequest,
  CompleteServiceWorkOrderRequest,
  CreateServiceRequest,
  ServiceEquipmentHistory,
  ServiceEquipmentHistoryEvent,
  ServicePartUsageInput,
  ServiceReferenceData,
  ServiceRequest,
  ServiceRequestPage,
  ServiceRequestStatus,
  ServiceTechnicianReference,
  ServiceWorkOrder,
  ServiceWorkOrderHistoryEntry,
  ServiceWorkOrderPage,
  ServiceWorkOrderPhoto,
  ServiceWorkOrderStatus,
  StartServiceWorkOrderRequest,
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

export interface ServicePhotoUpload {
  buffer: Buffer;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
}

export interface ServiceBinaryEvidence {
  content: Buffer;
  fileName: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}

interface RequestRow {
  completed_at: string | Date | null;
  created_at: string | Date;
  customer_equipment_id: string;
  customer_location_id: string;
  customer_location_name: string;
  customer_name: string;
  customer_partner_id: string;
  device_name: string;
  id: string;
  priority: ServiceRequest['priority'];
  problem_description: string;
  request_number: string;
  serial_number: string;
  service_type: ServiceRequest['serviceType'];
  source_channel: ServiceRequest['sourceChannel'];
  status: ServiceRequestStatus;
  subscription_contract_id: string | null;
  updated_at: string | Date;
  version: number;
  work_order_id: string | null;
  work_order_number: string | null;
  work_order_scheduled_end: string | Date | null;
  work_order_scheduled_start: string | Date | null;
  work_order_technician_account_id: string | null;
  work_order_technician_display_name: string | null;
  work_order_technician_email: string | null;
  work_order_technician_warehouse_id: string | null;
  work_order_technician_warehouse_name: string | null;
}

interface WorkOrderRow {
  assigned_technician_account_id: string | null;
  completed_at: string | Date | null;
  completion_notes: string | null;
  created_at: string | Date;
  customer_equipment_id: string;
  customer_location_id: string;
  customer_location_name: string;
  customer_name: string;
  customer_partner_id: string;
  device_name: string;
  id: string;
  labor_cost_bgn: string;
  labor_minutes: number;
  parts_cost_bgn: string;
  priority: ServiceWorkOrder['priority'];
  problem_description: string;
  request_id: string;
  request_number: string;
  scheduled_end: string | Date | null;
  scheduled_start: string | Date | null;
  serial_number: string;
  service_type: ServiceWorkOrder['serviceType'];
  signature_media_type: string | null;
  signed_at: string | Date | null;
  signer_name: string | null;
  started_at: string | Date | null;
  status: ServiceWorkOrderStatus;
  subscription_contract_id: string | null;
  technician_display_name: string | null;
  technician_email: string | null;
  technician_warehouse_id: string | null;
  technician_warehouse_name: string | null;
  total_cost_bgn: string;
  transport_cost_bgn: string;
  updated_at: string | Date;
  version: number;
  work_order_number: string;
}

interface LockedRequestRow {
  customer_equipment_id: string;
  customer_location_id: string;
  customer_partner_id: string;
  id: string;
  status: ServiceRequestStatus;
  subscription_contract_id: string | null;
  version: number;
}

interface LockedWorkOrderRow {
  assigned_technician_account_id: string | null;
  customer_equipment_id: string;
  customer_location_id: string;
  customer_partner_id: string;
  id: string;
  service_request_id: string;
  status: ServiceWorkOrderStatus;
  technician_warehouse_id: string | null;
  version: number;
}

interface WorkOrderTimeRow {
  id: string;
  minutes: number;
  note: string | null;
  recorded_at: string | Date;
  work_date: string;
}

interface WorkOrderPartRow {
  batch_number: string | null;
  id: string;
  product_id: string;
  product_name: string;
  quantity: string;
  serial_numbers: string[];
  stock_issue_movement_id: string;
  total_cost_bgn: string;
  unit_cost_bgn: string;
  warehouse_id: string;
  warehouse_name: string;
}

interface WorkOrderPhotoRow {
  captured_at: string | Date;
  file_name: string;
  id: string;
  media_type: ServiceWorkOrderPhoto['mediaType'];
  size_bytes: number;
}

interface WorkOrderHistoryRow {
  changed_at: string | Date;
  changed_by_name: string | null;
  id: string;
  next_status: ServiceWorkOrderStatus;
  previous_status: ServiceWorkOrderStatus | null;
  reason: string;
}

interface TechnicianRow {
  account_id: string;
  display_name: string;
  email: string;
  warehouse_id: string;
  warehouse_name: string;
}

interface NormalizedCompletion {
  completionNotes: string;
  laborCostBgn: string;
  parts: Array<{
    batchNumber?: string;
    productId: string;
    quantity: string;
    serialNumbers: string[];
  }>;
  signature: {
    data: Buffer;
    sha256: string;
  };
  signerName: string;
  timeEntries: Array<{ minutes: number; note?: string; workDate: string }>;
  transportCostBgn: string;
}

interface ServiceRequestListQuery {
  page?: number;
  pageSize?: number;
  status?: ServiceRequestStatus;
}

interface ServiceWorkOrderListQuery {
  page?: number;
  pageSize?: number;
  status?: ServiceWorkOrderStatus;
}

@Injectable()
export class ServiceOperationsService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}

  async referenceData(auth: AuthenticationContext): Promise<ServiceReferenceData> {
    const pool = this.database.getPool();
    const visibilityAccountId = serviceVisibilityAccountId(auth);
    const [customers, locations, equipment, technicians, parts, subscriptions] = await Promise.all([
      pool.query<{ id: string; name: string }>(
        `SELECT DISTINCT partner.id, partner.display_name AS name
         FROM master_data.partners partner
         JOIN master_data.partner_roles role ON role.partner_id = partner.id
         WHERE partner.active AND role.role = 'customer'
           AND ($1::uuid IS NULL OR EXISTS (
             SELECT 1
             FROM service.work_orders scope_work_order
             JOIN service.requests scope_request ON scope_request.id = scope_work_order.service_request_id
             WHERE scope_request.customer_partner_id = partner.id
               AND scope_work_order.assigned_technician_account_id = $1
           ))
         ORDER BY partner.display_name, partner.id`,
        [visibilityAccountId],
      ),
      pool.query<{ customer_partner_id: string; id: string; name: string }>(
        `SELECT location.id, location.partner_id AS customer_partner_id, location.name
         FROM master_data.customer_locations location
         JOIN master_data.partners partner ON partner.id = location.partner_id
         JOIN master_data.partner_roles role ON role.partner_id = partner.id AND role.role = 'customer'
         WHERE location.active AND partner.active
           AND ($1::uuid IS NULL OR EXISTS (
             SELECT 1
             FROM service.work_orders scope_work_order
             JOIN service.requests scope_request ON scope_request.id = scope_work_order.service_request_id
             WHERE scope_request.customer_location_id = location.id
               AND scope_work_order.assigned_technician_account_id = $1
           ))
         ORDER BY location.name, location.id`,
        [visibilityAccountId],
      ),
      pool.query<{
        active: boolean;
        customer_location_id: string;
        customer_partner_id: string;
        device_name: string;
        id: string;
        serial_number: string;
        status: ServiceReferenceData['equipment'][number]['status'];
        warranty_end_date: string | null;
      }>(
        `SELECT equipment.id, equipment.active, location.partner_id AS customer_partner_id,
                equipment.customer_location_id, equipment.device_name, equipment.serial_number,
                equipment.status, equipment.warranty_end_date::text
         FROM master_data.customer_equipment equipment
         JOIN master_data.customer_locations location ON location.id = equipment.customer_location_id
         JOIN master_data.partners partner ON partner.id = location.partner_id
         JOIN master_data.partner_roles role ON role.partner_id = partner.id AND role.role = 'customer'
         WHERE role.role = 'customer'
           AND ($1::uuid IS NULL OR EXISTS (
             SELECT 1
             FROM service.work_orders scope_work_order
             JOIN service.requests scope_request ON scope_request.id = scope_work_order.service_request_id
             WHERE scope_request.customer_equipment_id = equipment.id
               AND scope_work_order.assigned_technician_account_id = $1
           ))
         ORDER BY equipment.device_name, equipment.serial_number, equipment.id`,
        [visibilityAccountId],
      ),
      pool.query<TechnicianRow>(`${technicianQuery()} AND ($1::uuid IS NULL OR account.id = $1)`, [
        visibilityAccountId,
      ]),
      pool.query<{
        available_quantity: string;
        product_code: string;
        product_id: string;
        product_name: string;
        tracking_mode: ServiceReferenceData['parts'][number]['trackingMode'];
        warehouse_id: string;
      }>(
        `SELECT balance.warehouse_id, product.id AS product_id, product.name AS product_name,
                product.product_code, category.tracking_mode,
                balance.quantity::text AS available_quantity
         FROM inventory.stock_balances balance
         JOIN master_data.warehouses warehouse ON warehouse.id = balance.warehouse_id
         JOIN organization.operators operator ON operator.id = warehouse.technician_operator_id
         JOIN identity.user_accounts account ON account.id = operator.account_id
         JOIN master_data.products product ON product.id = balance.product_id
         JOIN master_data.product_categories category ON category.id = product.category_id
         WHERE warehouse.active AND warehouse.warehouse_type = 'technician'
           AND operator.active AND account.status = 'active' AND product.active AND category.active
           AND balance.quantity > 0
           AND ($1::uuid IS NULL OR account.id = $1)
         ORDER BY product.name, product.id, warehouse.id`,
        [visibilityAccountId],
      ),
      pool.query<{
        customer_equipment_ids: string[];
        customer_location_id: string;
        customer_partner_id: string;
        id: string;
        number: string;
      }>(
        `SELECT contract.id, contract.contract_number AS number, contract.customer_partner_id,
                contract.customer_location_id,
                array_agg(device.customer_equipment_id ORDER BY device.customer_equipment_id)
                  AS customer_equipment_ids
         FROM sales.service_subscription_contracts contract
         JOIN sales.service_subscription_devices device ON device.contract_id = contract.id
         WHERE contract.active
           AND contract.valid_from <= (now() AT TIME ZONE $1)::date
           AND (contract.valid_to IS NULL OR contract.valid_to >= (now() AT TIME ZONE $1)::date)
           AND $2::uuid IS NULL
         GROUP BY contract.id
         ORDER BY contract.contract_number, contract.id`,
        [this.environment.BUSINESS_TIMEZONE, visibilityAccountId],
      ),
    ]);
    return {
      businessTimezone: this.environment.BUSINESS_TIMEZONE,
      customers: customers.rows,
      equipment: equipment.rows.map((row) => ({
        active: row.active,
        customerLocationId: row.customer_location_id,
        customerPartnerId: row.customer_partner_id,
        deviceName: row.device_name,
        id: row.id,
        serialNumber: row.serial_number,
        status: row.status,
        ...(row.warranty_end_date ? { warrantyEndsOn: row.warranty_end_date } : {}),
      })),
      locations: locations.rows.map((row) => ({
        customerPartnerId: row.customer_partner_id,
        id: row.id,
        name: row.name,
      })),
      parts: parts.rows.map((row) => ({
        availableQuantity: row.available_quantity,
        productCode: row.product_code,
        productId: row.product_id,
        productName: row.product_name,
        trackingMode: row.tracking_mode,
        warehouseId: row.warehouse_id,
      })),
      subscriptions: subscriptions.rows.map((row) => ({
        customerEquipmentIds: row.customer_equipment_ids,
        customerLocationId: row.customer_location_id,
        customerPartnerId: row.customer_partner_id,
        id: row.id,
        number: row.number,
      })),
      technicians: technicians.rows.map(mapTechnician),
    };
  }

  async requests(
    query: ServiceRequestListQuery,
    auth: AuthenticationContext,
  ): Promise<ServiceRequestPage> {
    const client = await this.database.getPool().connect();
    try {
      // Query values are validated by Nest, but explicitly coerce them here as
      // well. This keeps the public response contract numeric when a caller
      // reaches the service through a transport that preserves query values as
      // strings.
      const page = Number(query.page ?? 1);
      const pageSize = Number(query.pageSize ?? 25);
      const visibilityAccountId = serviceVisibilityAccountId(auth);
      const aggregate = await client.query<{
        completed: string;
        in_progress: string;
        new: string;
        scheduled: string;
        total: string;
      }>(
        `SELECT count(*)::text AS total,
                count(*) FILTER (WHERE status = 'new')::text AS new,
                count(*) FILTER (WHERE status = 'scheduled')::text AS scheduled,
                count(*) FILTER (WHERE status = 'in_progress')::text AS in_progress,
                count(*) FILTER (WHERE status = 'completed')::text AS completed
         FROM service.requests request
         WHERE ($1::text IS NULL OR request.status = $1)
           AND ($2::uuid IS NULL OR EXISTS (
             SELECT 1 FROM service.work_orders scope_work_order
             WHERE scope_work_order.service_request_id = request.id
               AND scope_work_order.assigned_technician_account_id = $2
           ))`,
        [query.status ?? null, visibilityAccountId],
      );
      const total = Number(aggregate.rows[0]?.total ?? 0);
      const ids = await client.query<{ id: string }>(
        `SELECT request.id FROM service.requests request
         WHERE ($1::text IS NULL OR request.status = $1)
           AND ($2::uuid IS NULL OR EXISTS (
             SELECT 1 FROM service.work_orders scope_work_order
             WHERE scope_work_order.service_request_id = request.id
               AND scope_work_order.assigned_technician_account_id = $2
           ))
         ORDER BY request.created_at DESC, request.id DESC
         LIMIT $3 OFFSET $4`,
        [query.status ?? null, visibilityAccountId, pageSize, (page - 1) * pageSize],
      );
      const items: ServiceRequest[] = [];
      for (const row of ids.rows) items.push(await this.loadRequest(client, row.id));
      return {
        items,
        page,
        pageSize,
        summary: {
          completed: Number(aggregate.rows[0]?.completed ?? 0),
          inProgress: Number(aggregate.rows[0]?.in_progress ?? 0),
          new: Number(aggregate.rows[0]?.new ?? 0),
          scheduled: Number(aggregate.rows[0]?.scheduled ?? 0),
        },
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      };
    } finally {
      client.release();
    }
  }

  async request(id: string, auth: AuthenticationContext): Promise<ServiceRequest> {
    const client = await this.database.getPool().connect();
    try {
      await this.assertRequestAccess(client, id, auth);
      return await this.loadRequest(client, id);
    } finally {
      client.release();
    }
  }

  async workOrders(
    query: ServiceWorkOrderListQuery,
    auth: AuthenticationContext,
    ownWorkOnly = false,
  ): Promise<ServiceWorkOrderPage> {
    const client = await this.database.getPool().connect();
    try {
      // See the matching request-list coercion above. PostgreSQL accepts string
      // limit/offset values, so without this the API could echo strings back in
      // a response declared to contain numbers.
      const page = Number(query.page ?? 1);
      const pageSize = Number(query.pageSize ?? 25);
      const filters = [
        query.status ?? null,
        ownWorkOnly ? auth.accountId : serviceVisibilityAccountId(auth),
      ];
      const count = await client.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM service.work_orders
         WHERE ($1::text IS NULL OR status = $1)
           AND ($2::uuid IS NULL OR assigned_technician_account_id = $2)`,
        filters,
      );
      const total = Number(count.rows[0]?.total ?? 0);
      const ids = await client.query<{ id: string }>(
        `SELECT id FROM service.work_orders
         WHERE ($1::text IS NULL OR status = $1)
           AND ($2::uuid IS NULL OR assigned_technician_account_id = $2)
         ORDER BY COALESCE(scheduled_start, created_at) DESC, id DESC
         LIMIT $3 OFFSET $4`,
        [...filters, pageSize, (page - 1) * pageSize],
      );
      const items: ServiceWorkOrder[] = [];
      for (const row of ids.rows) items.push(await this.loadWorkOrder(client, row.id));
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

  async workOrder(id: string, auth: AuthenticationContext): Promise<ServiceWorkOrder> {
    const client = await this.database.getPool().connect();
    try {
      await this.assertWorkOrderAccess(client, id, auth);
      return await this.loadWorkOrder(client, id);
    } finally {
      client.release();
    }
  }

  async photoEvidence(
    workOrderId: string,
    photoId: string,
    auth: AuthenticationContext,
  ): Promise<ServiceBinaryEvidence> {
    const client = await this.database.getPool().connect();
    try {
      await this.assertWorkOrderAccess(client, workOrderId, auth);
      const result = await client.query<{
        content: Buffer;
        file_name: string;
        media_type: ServiceBinaryEvidence['mediaType'];
      }>(
        `SELECT photo.file_name, photo.media_type, photo.content
         FROM service.work_order_photos photo
         JOIN service.work_orders work_order ON work_order.id = photo.work_order_id
         WHERE work_order.id = $1 AND photo.id = $2`,
        [workOrderId, photoId],
      );
      const row = result.rows[0];
      if (!row)
        throw new ApiErrorException(
          'SERVICE_PHOTO_NOT_FOUND',
          'The service photo was not found for this work order.',
          HttpStatus.NOT_FOUND,
        );
      return { content: row.content, fileName: row.file_name, mediaType: row.media_type };
    } finally {
      client.release();
    }
  }

  async signatureEvidence(
    workOrderId: string,
    auth: AuthenticationContext,
  ): Promise<ServiceBinaryEvidence> {
    const client = await this.database.getPool().connect();
    try {
      await this.assertWorkOrderAccess(client, workOrderId, auth);
      const result = await client.query<{
        signature_data: Buffer | null;
        signer_name: string | null;
      }>(`SELECT signature_data, signer_name FROM service.work_orders WHERE id = $1`, [
        workOrderId,
      ]);
      const row = result.rows[0];
      if (!row) throw workOrderNotFound();
      if (!row.signature_data)
        throw new ApiErrorException(
          'SERVICE_SIGNATURE_NOT_FOUND',
          'No customer signature has been captured for this work order.',
          HttpStatus.NOT_FOUND,
        );
      return {
        content: row.signature_data,
        fileName: `${safeFileStem(row.signer_name ?? 'customer-signature')}.png`,
        mediaType: 'image/png',
      };
    } finally {
      client.release();
    }
  }

  async equipmentHistory(
    id: string,
    auth: AuthenticationContext,
  ): Promise<ServiceEquipmentHistory> {
    const client = await this.database.getPool().connect();
    try {
      await this.assertEquipmentHistoryAccess(client, id, auth);
      const equipment = await client.query<{
        device_name: string;
        id: string;
        serial_number: string;
        warranty_end_date: string | null;
      }>(
        `SELECT id, device_name, serial_number, warranty_end_date::text
         FROM master_data.customer_equipment WHERE id = $1`,
        [id],
      );
      const row = equipment.rows[0];
      if (!row) throw equipmentNotFound();
      const workOrders = await client.query<{ id: string }>(
        `SELECT work_order.id
         FROM service.work_orders work_order
         JOIN service.requests request ON request.id = work_order.service_request_id
         WHERE request.customer_equipment_id = $1
           AND ($2::uuid IS NULL OR work_order.assigned_technician_account_id = $2)
         ORDER BY COALESCE(work_order.completed_at, work_order.started_at, work_order.created_at) DESC,
                  work_order.id DESC`,
        [id, serviceVisibilityAccountId(auth)],
      );
      const events: ServiceEquipmentHistoryEvent[] = [];
      for (const workOrder of workOrders.rows) {
        const detail = await this.loadWorkOrder(client, workOrder.id);
        events.push({
          ...(detail.completedAt ? { completedAt: detail.completedAt } : {}),
          description: detail.completionNotes ?? detail.problemDescription,
          id: detail.id,
          occurredAt: detail.completedAt ?? detail.startedAt ?? detail.createdAt,
          parts: detail.parts,
          serviceType: detail.serviceType,
          status: detail.status,
          ...(detail.assignedTechnician
            ? { technicianName: detail.assignedTechnician.displayName }
            : {}),
          workOrderNumber: detail.number,
        });
      }
      return {
        deviceName: row.device_name,
        equipmentId: row.id,
        events,
        serialNumber: row.serial_number,
        ...(row.warranty_end_date ? { warrantyEndsOn: row.warranty_end_date } : {}),
      };
    } finally {
      client.release();
    }
  }

  async createRequest(
    input: CreateServiceRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<ServiceRequest> {
    const normalized = normalizeCreateRequest(input);
    return this.command(
      'service.request.create',
      key,
      normalized,
      201,
      async (client, commandKey) => {
        await this.requireRequestReferences(client, normalized);
        const id = randomUUID();
        const number = await this.nextNumber(client, 'request', 'SRV');
        await client.query(
          `INSERT INTO service.requests (
           id, request_number, customer_partner_id, customer_location_id, customer_equipment_id,
           subscription_contract_id, source_channel, service_type, priority, problem_description,
           created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
          [
            id,
            number,
            normalized.customerPartnerId,
            normalized.customerLocationId,
            normalized.customerEquipmentId,
            normalized.subscriptionContractId ?? null,
            normalized.sourceChannel,
            normalized.serviceType,
            normalized.priority,
            normalized.problemDescription,
            auth.accountId,
          ],
        );
        const request = await this.loadRequest(client, id);
        await this.sideEffects(
          client,
          'service_request',
          id,
          'service.request.created',
          request,
          auth,
          metadata,
          commandKey,
        );
        return request;
      },
    );
  }

  async assignWorkOrder(
    id: string,
    input: AssignServiceWorkOrderRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<ServiceRequest> {
    this.assertServiceDispatchAccess(auth);
    const normalized = normalizeAssignment(input);
    return this.command(
      `service.request.assign:${id}`,
      key,
      normalized,
      201,
      async (client, commandKey) => {
        const request = await this.lockRequest(client, id);
        if (request.version !== normalized.expectedVersion)
          throw versionConflict('This service request');
        if (request.status === 'cancelled' || request.status === 'completed')
          throw new ApiErrorException(
            'SERVICE_REQUEST_NOT_ASSIGNABLE',
            'Completed or cancelled service requests cannot be assigned.',
            HttpStatus.CONFLICT,
          );
        const technician = await this.requireTechnician(
          client,
          normalized.technicianAccountId,
          normalized.technicianWarehouseId,
        );
        const existing = await client.query<{
          id: string;
          status: ServiceWorkOrderStatus;
          version: number;
        }>(
          `SELECT id, status, version FROM service.work_orders
           WHERE service_request_id = $1 FOR UPDATE`,
          [id],
        );
        let workOrderId: string;
        let workOrderVersion: number;
        if (existing.rows[0]) {
          const workOrder = existing.rows[0];
          if (workOrder.status !== 'scheduled')
            throw new ApiErrorException(
              'SERVICE_WORK_ORDER_NOT_RESCHEDULABLE',
              'Only a scheduled work order can be reassigned.',
              HttpStatus.CONFLICT,
            );
          workOrderId = workOrder.id;
          workOrderVersion = workOrder.version + 1;
          await client.query(
            `UPDATE service.work_orders
             SET assigned_technician_account_id = $2, technician_warehouse_id = $3,
                 scheduled_start = $4, scheduled_end = $5, updated_by = $6,
                 version = version + 1, updated_at = now()
             WHERE id = $1`,
            [
              workOrderId,
              technician.accountId,
              technician.warehouseId,
              normalized.scheduledStart,
              normalized.scheduledEnd,
              auth.accountId,
            ],
          );
          await this.appendHistory(
            client,
            workOrderId,
            'scheduled',
            'scheduled',
            'technician_reassigned',
            auth.accountId,
          );
        } else {
          workOrderId = randomUUID();
          workOrderVersion = 1;
          const number = await this.nextNumber(client, 'work_order', 'WO');
          await client.query(
            `INSERT INTO service.work_orders (
               id, work_order_number, service_request_id, assigned_technician_account_id,
               technician_warehouse_id, scheduled_start, scheduled_end, created_by, updated_by
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
            [
              workOrderId,
              number,
              id,
              technician.accountId,
              technician.warehouseId,
              normalized.scheduledStart,
              normalized.scheduledEnd,
              auth.accountId,
            ],
          );
          await this.appendHistory(
            client,
            workOrderId,
            undefined,
            'scheduled',
            'technician_assigned',
            auth.accountId,
          );
        }
        await client.query(
          `UPDATE service.requests
           SET status = 'scheduled', updated_by = $2, version = version + 1, updated_at = now()
           WHERE id = $1`,
          [id, auth.accountId],
        );
        const result = await this.loadRequest(client, id);
        await this.sideEffects(
          client,
          'service_work_order',
          workOrderId,
          existing.rows[0] ? 'service.work_order.reassigned' : 'service.work_order.assigned',
          {
            request: result,
            workOrderVersion,
          },
          auth,
          metadata,
          commandKey,
        );
        return result;
      },
    );
  }

  async startWorkOrder(
    id: string,
    input: StartServiceWorkOrderRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<ServiceWorkOrder> {
    const expectedVersion = positiveVersion(input.expectedVersion);
    return this.command(
      `service.work-order.start:${id}`,
      key,
      { expectedVersion },
      200,
      async (client, commandKey) => {
        const workOrder = await this.lockWorkOrder(client, id);
        this.assertTechnicianAccess(workOrder, auth);
        if (workOrder.version !== expectedVersion) throw versionConflict('This work order');
        if (workOrder.status !== 'scheduled')
          throw new ApiErrorException(
            'SERVICE_WORK_ORDER_NOT_STARTABLE',
            'Only a scheduled work order can be started.',
            HttpStatus.CONFLICT,
          );
        await client.query(
          `UPDATE service.work_orders
           SET status = 'in_progress', started_at = now(), updated_by = $2,
               version = version + 1, updated_at = now()
           WHERE id = $1`,
          [id, auth.accountId],
        );
        await client.query(
          `UPDATE service.requests
           SET status = 'in_progress', updated_by = $2, version = version + 1, updated_at = now()
           WHERE id = $1`,
          [workOrder.service_request_id, auth.accountId],
        );
        const equipmentTransition = await client.query(
          `UPDATE master_data.customer_equipment
           SET status = 'under_repair', updated_by = $2, version = version + 1, updated_at = now()
           WHERE id = $1 AND active AND status = 'active'`,
          [workOrder.customer_equipment_id, auth.accountId],
        );
        if (equipmentTransition.rowCount !== 1)
          throw new ApiErrorException(
            'SERVICE_EQUIPMENT_ALREADY_IN_SERVICE',
            'This device is already under repair in another active work order.',
            HttpStatus.CONFLICT,
          );
        await this.appendHistory(
          client,
          id,
          'scheduled',
          'in_progress',
          'technician_started_work',
          auth.accountId,
        );
        const result = await this.loadWorkOrder(client, id);
        await this.sideEffects(
          client,
          'service_work_order',
          id,
          'service.work_order.started',
          result,
          auth,
          metadata,
          commandKey,
          { status: workOrder.status, version: workOrder.version },
        );
        return result;
      },
    );
  }

  async addPhoto(
    id: string,
    input: ServicePhotoUpload,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<ServiceWorkOrderPhoto> {
    const normalized = normalizePhoto(input);
    return this.command(
      `service.work-order.photo:${id}`,
      key,
      {
        fileName: normalized.fileName,
        mediaType: normalized.mediaType,
        sha256: normalized.sha256,
        sizeBytes: normalized.sizeBytes,
      },
      201,
      async (client, commandKey) => {
        const workOrder = await this.lockWorkOrder(client, id);
        this.assertTechnicianAccess(workOrder, auth);
        if (workOrder.status !== 'in_progress')
          throw new ApiErrorException(
            'SERVICE_WORK_ORDER_PHOTO_NOT_ALLOWED',
            'Photos can be added while the work order is in progress.',
            HttpStatus.CONFLICT,
          );
        const photoId = randomUUID();
        await client.query(
          `INSERT INTO service.work_order_photos (
             id, work_order_id, file_name, media_type, size_bytes, content_sha256, content, captured_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            photoId,
            id,
            normalized.fileName,
            normalized.mediaType,
            normalized.sizeBytes,
            normalized.sha256,
            normalized.buffer,
            auth.accountId,
          ],
        );
        await client.query(
          `UPDATE service.work_orders
           SET updated_by = $2, version = version + 1, updated_at = now()
           WHERE id = $1`,
          [id, auth.accountId],
        );
        const photo = await this.loadPhoto(client, photoId);
        await this.sideEffects(
          client,
          'service_work_order_photo',
          photoId,
          'service.work_order.photo_added',
          { photo, workOrderId: id },
          auth,
          metadata,
          commandKey,
        );
        return photo;
      },
    );
  }

  async completeWorkOrder(
    id: string,
    input: CompleteServiceWorkOrderRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<ServiceWorkOrder> {
    const normalized = normalizeCompletion(input);
    const idempotencyPayload = {
      completionNotes: normalized.completionNotes,
      expectedVersion: positiveVersion(input.expectedVersion),
      laborCostBgn: normalized.laborCostBgn,
      parts: normalized.parts,
      signatureSha256: normalized.signature.sha256,
      signerName: normalized.signerName,
      timeEntries: normalized.timeEntries,
      transportCostBgn: normalized.transportCostBgn,
    };
    return this.command(
      `service.work-order.complete:${id}`,
      key,
      idempotencyPayload,
      200,
      async (client, commandKey) => {
        const workOrder = await this.lockWorkOrder(client, id);
        this.assertTechnicianAccess(workOrder, auth);
        if (workOrder.version !== idempotencyPayload.expectedVersion)
          throw versionConflict('This work order');
        if (workOrder.status !== 'in_progress')
          throw new ApiErrorException(
            'SERVICE_WORK_ORDER_NOT_COMPLETABLE',
            'Start this work order before completing it.',
            HttpStatus.CONFLICT,
          );
        if (!workOrder.assigned_technician_account_id || !workOrder.technician_warehouse_id)
          throw new ApiErrorException(
            'SERVICE_TECHNICIAN_ASSIGNMENT_REQUIRED',
            'A technician and technician warehouse are required before completion.',
            HttpStatus.CONFLICT,
          );

        let partsCost = 0n;
        for (const part of normalized.parts) {
          const issue = await this.inventory.issueServicePart(
            client,
            {
              ...(part.batchNumber ? { batchNumber: part.batchNumber } : {}),
              customerPartnerId: workOrder.customer_partner_id,
              productId: part.productId,
              quantity: part.quantity,
              serialNumbers: part.serialNumbers,
              technicianAccountId: workOrder.assigned_technician_account_id,
              warehouseId: workOrder.technician_warehouse_id,
            },
            id,
            internalEventKey('service.part', commandKey, part.productId),
            auth,
            metadata,
          );
          const partUsageId = randomUUID();
          await client.query(
            `INSERT INTO service.work_order_part_usages (
               id, work_order_id, stock_issue_movement_id, warehouse_id, product_id, batch_id,
               quantity, unit_cost_bgn, total_cost_bgn, recorded_by
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              partUsageId,
              id,
              issue.id,
              issue.warehouseId,
              issue.productId,
              issue.batchId ?? null,
              issue.quantity,
              issue.unitCostBgn,
              issue.totalCostBgn,
              auth.accountId,
            ],
          );
          if (issue.serialItemIds.length)
            await client.query(
              `INSERT INTO service.work_order_part_serials (part_usage_id, serialized_item_id)
               SELECT $1, unnest($2::uuid[])`,
              [partUsageId, issue.serialItemIds],
            );
          partsCost += decimalUnits(issue.totalCostBgn);
        }

        for (const entry of normalized.timeEntries)
          await client.query(
            `INSERT INTO service.work_order_time_entries (
               id, work_order_id, work_date, minutes, note, recorded_by
             ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [randomUUID(), id, entry.workDate, entry.minutes, entry.note ?? null, auth.accountId],
          );
        const laborMinutes = normalized.timeEntries.reduce(
          (total, entry) => total + entry.minutes,
          0,
        );
        const partsCostBgn = decimalString(partsCost);
        const totalCostBgn = decimalString(
          decimalUnits(normalized.laborCostBgn) +
            partsCost +
            decimalUnits(normalized.transportCostBgn),
        );
        await client.query(
          `UPDATE service.work_orders
           SET status = 'completed', completed_at = now(), completion_notes = $2,
               labor_minutes = $3, labor_cost_bgn = $4, parts_cost_bgn = $5,
               transport_cost_bgn = $6, total_cost_bgn = $7, signer_name = $8,
               signature_media_type = 'image/png', signature_data = $9,
               signature_sha256 = $10, signed_at = now(), updated_by = $11,
               version = version + 1, updated_at = now()
           WHERE id = $1`,
          [
            id,
            normalized.completionNotes,
            laborMinutes,
            normalized.laborCostBgn,
            partsCostBgn,
            normalized.transportCostBgn,
            totalCostBgn,
            normalized.signerName,
            normalized.signature.data,
            normalized.signature.sha256,
            auth.accountId,
          ],
        );
        await client.query(
          `UPDATE service.requests
           SET status = 'completed', completed_at = now(), updated_by = $2,
               version = version + 1, updated_at = now()
           WHERE id = $1`,
          [workOrder.service_request_id, auth.accountId],
        );
        const equipmentTransition = await client.query(
          `UPDATE master_data.customer_equipment
           SET status = 'active', updated_by = $2, version = version + 1, updated_at = now()
           WHERE id = $1 AND status = 'under_repair'`,
          [workOrder.customer_equipment_id, auth.accountId],
        );
        if (equipmentTransition.rowCount !== 1)
          throw new ApiErrorException(
            'SERVICE_EQUIPMENT_STATUS_CONFLICT',
            'The device status changed while this work order was being completed. Refresh and try again.',
            HttpStatus.CONFLICT,
          );
        await this.appendHistory(
          client,
          id,
          'in_progress',
          'completed',
          'technician_completed_work',
          auth.accountId,
        );
        const result = await this.loadWorkOrder(client, id);
        await this.sideEffects(
          client,
          'service_work_order',
          id,
          'service.work_order.completed',
          result,
          auth,
          metadata,
          commandKey,
          { status: workOrder.status, version: workOrder.version },
        );
        return result;
      },
    );
  }

  async cancelRequest(
    id: string,
    input: CancelServiceRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<ServiceRequest> {
    this.assertServiceDispatchAccess(auth);
    const cancellationReason = text(
      input.cancellationReason,
      'SERVICE_CANCELLATION_REASON_REQUIRED',
      1000,
    );
    const expectedVersion = positiveVersion(input.expectedVersion);
    return this.command(
      `service.request.cancel:${id}`,
      key,
      { cancellationReason, expectedVersion },
      200,
      async (client, commandKey) => {
        const request = await this.lockRequest(client, id);
        if (request.version !== expectedVersion) throw versionConflict('This service request');
        if (request.status === 'completed')
          throw new ApiErrorException(
            'SERVICE_REQUEST_COMPLETED',
            'A completed service request cannot be cancelled.',
            HttpStatus.CONFLICT,
          );
        if (request.status === 'cancelled') return this.loadRequest(client, id);
        const workOrder = await client.query<{ id: string; status: ServiceWorkOrderStatus }>(
          `SELECT id, status FROM service.work_orders WHERE service_request_id = $1 FOR UPDATE`,
          [id],
        );
        if (workOrder.rows[0]?.status === 'in_progress')
          throw new ApiErrorException(
            'SERVICE_REQUEST_IN_PROGRESS',
            'An in-progress work order must be completed through its service workflow.',
            HttpStatus.CONFLICT,
          );
        if (workOrder.rows[0]) {
          await client.query(
            `UPDATE service.work_orders
             SET status = 'cancelled', updated_by = $2, version = version + 1, updated_at = now()
             WHERE id = $1`,
            [workOrder.rows[0].id, auth.accountId],
          );
          await this.appendHistory(
            client,
            workOrder.rows[0].id,
            workOrder.rows[0].status,
            'cancelled',
            'request_cancelled',
            auth.accountId,
          );
        }
        await client.query(
          `UPDATE service.requests
           SET status = 'cancelled', cancellation_reason = $2, cancelled_at = now(),
               cancelled_by = $3, updated_by = $3, version = version + 1, updated_at = now()
           WHERE id = $1`,
          [id, cancellationReason, auth.accountId],
        );
        const result = await this.loadRequest(client, id);
        await this.sideEffects(
          client,
          'service_request',
          id,
          'service.request.cancelled',
          result,
          auth,
          metadata,
          commandKey,
          { status: request.status, version: request.version },
        );
        return result;
      },
    );
  }

  private async loadRequest(client: PoolClient, id: string): Promise<ServiceRequest> {
    const result = await client.query<RequestRow>(`${requestQuery()} WHERE request.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw requestNotFound();
    return mapRequest(row);
  }

  private async loadWorkOrder(client: PoolClient, id: string): Promise<ServiceWorkOrder> {
    const result = await client.query<WorkOrderRow>(
      `${workOrderQuery()} WHERE work_order.id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw workOrderNotFound();
    const timeEntries = await client.query<WorkOrderTimeRow>(
      `SELECT id, work_date::text, minutes, note, recorded_at
       FROM service.work_order_time_entries
       WHERE work_order_id = $1 ORDER BY work_date, recorded_at, id`,
      [id],
    );
    const parts = await client.query<WorkOrderPartRow>(
      `SELECT usage.id, usage.stock_issue_movement_id, usage.warehouse_id, warehouse.name AS warehouse_name,
              usage.product_id, product.name AS product_name, usage.batch_id,
              batch.batch_number, usage.quantity::text, usage.unit_cost_bgn::text,
              usage.total_cost_bgn::text,
              COALESCE(array_agg(serial.serial_number ORDER BY serial.serial_number)
                FILTER (WHERE serial.id IS NOT NULL), '{}'::text[]) AS serial_numbers
       FROM service.work_order_part_usages usage
       JOIN master_data.warehouses warehouse ON warehouse.id = usage.warehouse_id
       JOIN master_data.products product ON product.id = usage.product_id
       LEFT JOIN inventory.batches batch ON batch.id = usage.batch_id
       LEFT JOIN service.work_order_part_serials part_serial ON part_serial.part_usage_id = usage.id
       LEFT JOIN inventory.serialized_items serial ON serial.id = part_serial.serialized_item_id
       WHERE usage.work_order_id = $1
       GROUP BY usage.id, warehouse.name, product.name, batch.batch_number
       ORDER BY usage.recorded_at, usage.id`,
      [id],
    );
    const photos = await client.query<WorkOrderPhotoRow>(
      `SELECT id, file_name, media_type, size_bytes, captured_at
       FROM service.work_order_photos WHERE work_order_id = $1
       ORDER BY captured_at, id`,
      [id],
    );
    const history = await client.query<WorkOrderHistoryRow>(
      `SELECT history.id, history.previous_status, history.next_status, history.reason,
              history.changed_at, employee.display_name AS changed_by_name
       FROM service.work_order_status_history history
       LEFT JOIN identity.user_accounts account ON account.id = history.changed_by
       LEFT JOIN identity.employees employee ON employee.id = account.employee_id
       WHERE history.work_order_id = $1
       ORDER BY history.changed_at DESC, history.id DESC`,
      [id],
    );
    return mapWorkOrder(row, timeEntries.rows, parts.rows, photos.rows, history.rows);
  }

  private async loadPhoto(client: PoolClient, id: string): Promise<ServiceWorkOrderPhoto> {
    const result = await client.query<WorkOrderPhotoRow>(
      `SELECT id, file_name, media_type, size_bytes, captured_at
       FROM service.work_order_photos WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Service photo insert could not be reconciled.');
    return mapPhoto(row);
  }

  private async lockRequest(client: PoolClient, id: string): Promise<LockedRequestRow> {
    const result = await client.query<LockedRequestRow>(
      `SELECT id, customer_partner_id, customer_location_id, customer_equipment_id,
              subscription_contract_id, status, version
       FROM service.requests WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw requestNotFound();
    return row;
  }

  private async lockWorkOrder(client: PoolClient, id: string): Promise<LockedWorkOrderRow> {
    const result = await client.query<LockedWorkOrderRow>(
      `SELECT work_order.id, work_order.service_request_id, work_order.assigned_technician_account_id,
              work_order.technician_warehouse_id, work_order.status, work_order.version,
              request.customer_partner_id, request.customer_location_id, request.customer_equipment_id
       FROM service.work_orders work_order
       JOIN service.requests request ON request.id = work_order.service_request_id
       WHERE work_order.id = $1 FOR UPDATE OF work_order, request`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw workOrderNotFound();
    return row;
  }

  private async assertRequestAccess(
    client: PoolClient,
    id: string,
    auth: AuthenticationContext,
  ): Promise<void> {
    const visibilityAccountId = serviceVisibilityAccountId(auth);
    if (!visibilityAccountId) return;
    const result = await client.query<{
      assigned_technician_account_id: string | null;
      id: string;
    }>(
      `SELECT request.id, work_order.assigned_technician_account_id
       FROM service.requests request
       LEFT JOIN service.work_orders work_order ON work_order.service_request_id = request.id
       WHERE request.id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw requestNotFound();
    if (row.assigned_technician_account_id !== visibilityAccountId)
      throw serviceRequestAccessDenied();
  }

  private async assertWorkOrderAccess(
    client: PoolClient,
    id: string,
    auth: AuthenticationContext,
  ): Promise<void> {
    const visibilityAccountId = serviceVisibilityAccountId(auth);
    if (!visibilityAccountId) return;
    const result = await client.query<{ assigned_technician_account_id: string | null }>(
      `SELECT assigned_technician_account_id FROM service.work_orders WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw workOrderNotFound();
    if (row.assigned_technician_account_id !== visibilityAccountId)
      throw serviceWorkOrderAccessDenied();
  }

  private async assertEquipmentHistoryAccess(
    client: PoolClient,
    equipmentId: string,
    auth: AuthenticationContext,
  ): Promise<void> {
    const visibilityAccountId = serviceVisibilityAccountId(auth);
    if (!visibilityAccountId) return;
    const result = await client.query<{ id: string }>(
      `SELECT work_order.id
       FROM service.work_orders work_order
       JOIN service.requests request ON request.id = work_order.service_request_id
       WHERE request.customer_equipment_id = $1
         AND work_order.assigned_technician_account_id = $2
       LIMIT 1`,
      [equipmentId, visibilityAccountId],
    );
    if (!result.rows[0]) throw serviceEquipmentAccessDenied();
  }

  private assertServiceDispatchAccess(auth: AuthenticationContext): void {
    if (serviceVisibilityAccountId(auth) === undefined) return;
    throw new ApiErrorException(
      'SERVICE_DISPATCH_APPROVAL_REQUIRED',
      'Only a service dispatcher or supervisor can assign, reschedule, or cancel service work.',
      HttpStatus.FORBIDDEN,
    );
  }

  private async requireRequestReferences(
    client: PoolClient,
    input: ReturnType<typeof normalizeCreateRequest>,
  ): Promise<void> {
    const equipment = await client.query<{
      status: 'active' | 'under_repair' | 'retired';
      warranty_end_date: string | null;
    }>(
      `SELECT equipment.status, equipment.warranty_end_date::text
       FROM master_data.customer_equipment equipment
       JOIN master_data.customer_locations location ON location.id = equipment.customer_location_id
       JOIN master_data.partners partner ON partner.id = location.partner_id
       JOIN master_data.partner_roles role ON role.partner_id = partner.id AND role.role = 'customer'
       WHERE equipment.id = $1 AND equipment.customer_location_id = $2 AND location.partner_id = $3
         AND equipment.active AND equipment.status <> 'retired' AND location.active AND partner.active
       FOR KEY SHARE`,
      [input.customerEquipmentId, input.customerLocationId, input.customerPartnerId],
    );
    const row = equipment.rows[0];
    if (!row)
      throw new ApiErrorException(
        'SERVICE_EQUIPMENT_REFERENCE_INVALID',
        'Choose an active device that belongs to the selected customer location.',
        HttpStatus.BAD_REQUEST,
      );
    const businessDate = await this.businessDate(client);
    if (input.serviceType === 'warranty') {
      if (!row.warranty_end_date || row.warranty_end_date < businessDate)
        throw new ApiErrorException(
          'SERVICE_WARRANTY_NOT_ACTIVE',
          'The selected device does not have an active warranty for this service request.',
          HttpStatus.CONFLICT,
        );
    }
    if (input.serviceType === 'subscription') {
      const contract = await client.query<{ id: string }>(
        `SELECT contract.id
         FROM sales.service_subscription_contracts contract
         JOIN sales.service_subscription_devices device ON device.contract_id = contract.id
         WHERE contract.id = $1 AND contract.active
           AND contract.customer_partner_id = $2 AND contract.customer_location_id = $3
           AND device.customer_equipment_id = $4
           AND contract.valid_from <= $5
           AND (contract.valid_to IS NULL OR contract.valid_to >= $5)
         FOR KEY SHARE`,
        [
          input.subscriptionContractId,
          input.customerPartnerId,
          input.customerLocationId,
          input.customerEquipmentId,
          businessDate,
        ],
      );
      if (!contract.rows[0])
        throw new ApiErrorException(
          'SERVICE_SUBSCRIPTION_REFERENCE_INVALID',
          'Choose an active service subscription that covers the selected device.',
          HttpStatus.BAD_REQUEST,
        );
    }
  }

  private async requireTechnician(
    client: PoolClient,
    accountId: string,
    warehouseId: string,
  ): Promise<ServiceTechnicianReference> {
    const result = await client.query<TechnicianRow>(
      `${technicianQuery()} AND account.id = $1 AND warehouse.id = $2 FOR KEY SHARE`,
      [accountId, warehouseId],
    );
    const row = result.rows[0];
    if (!row)
      throw new ApiErrorException(
        'SERVICE_TECHNICIAN_WAREHOUSE_INVALID',
        'Choose an active technician and the warehouse assigned to that technician.',
        HttpStatus.BAD_REQUEST,
      );
    return mapTechnician(row);
  }

  private assertTechnicianAccess(workOrder: LockedWorkOrderRow, auth: AuthenticationContext): void {
    if (workOrder.assigned_technician_account_id === auth.accountId) return;
    if (serviceVisibilityAccountId(auth) !== undefined)
      throw new ApiErrorException(
        'SERVICE_TECHNICIAN_ASSIGNMENT_REQUIRED',
        'Only the assigned technician can update this work order.',
        HttpStatus.FORBIDDEN,
      );
  }

  private async appendHistory(
    client: PoolClient,
    workOrderId: string,
    previousStatus: ServiceWorkOrderStatus | undefined,
    nextStatus: ServiceWorkOrderStatus,
    reason: string,
    changedBy?: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO service.work_order_status_history (
         id, work_order_id, previous_status, next_status, reason, changed_by
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), workOrderId, previousStatus ?? null, nextStatus, reason, changedBy ?? null],
    );
  }

  private async nextNumber(client: PoolClient, type: string, prefix: string): Promise<string> {
    const businessDate = await this.businessDate(client);
    await client.query(
      `INSERT INTO service.internal_document_sequences (document_type)
       VALUES ($1) ON CONFLICT (document_type) DO NOTHING`,
      [type],
    );
    const result = await client.query<{ allocated: string }>(
      `UPDATE service.internal_document_sequences SET next_value = next_value + 1, updated_at = now()
       WHERE document_type = $1 RETURNING (next_value - 1)::text AS allocated`,
      [type],
    );
    return `${prefix}-${businessDate.slice(0, 4)}-${required(result.rows[0], 'Service sequence allocation failed.').allocated.padStart(6, '0')}`;
  }

  private async businessDate(client: PoolClient): Promise<string> {
    const result = await client.query<{ date: string }>(
      `SELECT (now() AT TIME ZONE $1)::date::text AS date`,
      [this.environment.BUSINESS_TIMEZONE],
    );
    return required(result.rows[0], 'Business date calculation failed.').date;
  }

  private async command<T>(
    scope: string,
    key: string | undefined,
    payload: object,
    responseStatus: number,
    action: (client: PoolClient, commandKey: string) => Promise<T>,
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
         SET status = 'completed', response_status = $3, response_body = $4
         WHERE scope = $1 AND idempotency_key = $2`,
        [scope, idempotencyKey, responseStatus, result],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error))
        throw new ApiErrorException(
          'SERVICE_RECORD_CONFLICT',
          'This service operation conflicts with an existing record.',
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
    commandKey: string,
    before?: object,
  ): Promise<void> {
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
        `${eventType}:${commandKey}`,
        payload,
      ],
    );
    await this.audit.append(
      {
        action: eventType,
        actorAccountId: auth.accountId,
        after: payload as Record<string, unknown>,
        ...(before ? { before: before as Record<string, unknown> } : {}),
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

function requestQuery(): string {
  return `SELECT request.id, request.request_number, request.customer_partner_id,
                 request.customer_location_id, request.customer_equipment_id,
                 request.subscription_contract_id, request.source_channel, request.service_type,
                 request.priority, request.problem_description, request.status, request.completed_at,
                 request.created_at, request.updated_at, request.version,
                 partner.display_name AS customer_name, location.name AS customer_location_name,
                 equipment.device_name, equipment.serial_number,
                 work_order.id AS work_order_id, work_order.work_order_number,
                 work_order.scheduled_start AS work_order_scheduled_start,
                 work_order.scheduled_end AS work_order_scheduled_end,
                 work_order.assigned_technician_account_id AS work_order_technician_account_id,
                 technician_employee.display_name AS work_order_technician_display_name,
                 technician_employee.email AS work_order_technician_email,
                 technician_warehouse.id AS work_order_technician_warehouse_id,
                 technician_warehouse.name AS work_order_technician_warehouse_name
          FROM service.requests request
          JOIN master_data.partners partner ON partner.id = request.customer_partner_id
          JOIN master_data.customer_locations location ON location.id = request.customer_location_id
          JOIN master_data.customer_equipment equipment ON equipment.id = request.customer_equipment_id
          LEFT JOIN service.work_orders work_order ON work_order.service_request_id = request.id
          LEFT JOIN identity.user_accounts technician_account
            ON technician_account.id = work_order.assigned_technician_account_id
          LEFT JOIN identity.employees technician_employee
            ON technician_employee.id = technician_account.employee_id
          LEFT JOIN master_data.warehouses technician_warehouse
            ON technician_warehouse.id = work_order.technician_warehouse_id`;
}

function workOrderQuery(): string {
  return `SELECT work_order.id, work_order.work_order_number, work_order.service_request_id AS request_id,
                 work_order.assigned_technician_account_id, work_order.technician_warehouse_id,
                 work_order.scheduled_start, work_order.scheduled_end, work_order.started_at,
                 work_order.completed_at, work_order.status, work_order.completion_notes,
                 work_order.labor_minutes, work_order.labor_cost_bgn::text, work_order.parts_cost_bgn::text,
                 work_order.transport_cost_bgn::text, work_order.total_cost_bgn::text,
                 work_order.signer_name, work_order.signature_media_type, work_order.signed_at,
                 work_order.created_at, work_order.updated_at, work_order.version,
                 request.request_number, request.customer_partner_id, request.customer_location_id,
                 request.customer_equipment_id, request.subscription_contract_id, request.problem_description,
                 request.service_type, request.priority,
                 partner.display_name AS customer_name, location.name AS customer_location_name,
                 equipment.device_name, equipment.serial_number,
                 technician_employee.display_name AS technician_display_name,
                 technician_employee.email AS technician_email,
                 technician_warehouse.name AS technician_warehouse_name
          FROM service.work_orders work_order
          JOIN service.requests request ON request.id = work_order.service_request_id
          JOIN master_data.partners partner ON partner.id = request.customer_partner_id
          JOIN master_data.customer_locations location ON location.id = request.customer_location_id
          JOIN master_data.customer_equipment equipment ON equipment.id = request.customer_equipment_id
          LEFT JOIN identity.user_accounts technician_account
            ON technician_account.id = work_order.assigned_technician_account_id
          LEFT JOIN identity.employees technician_employee
            ON technician_employee.id = technician_account.employee_id
          LEFT JOIN master_data.warehouses technician_warehouse
            ON technician_warehouse.id = work_order.technician_warehouse_id`;
}

function technicianQuery(): string {
  return `SELECT account.id AS account_id, employee.display_name, employee.email,
                 warehouse.id AS warehouse_id, warehouse.name AS warehouse_name
          FROM master_data.warehouses warehouse
          JOIN organization.operators operator ON operator.id = warehouse.technician_operator_id
          JOIN identity.user_accounts account ON account.id = operator.account_id
          JOIN identity.employees employee ON employee.id = account.employee_id
          WHERE warehouse.active AND warehouse.warehouse_type = 'technician'
            AND operator.active AND account.status = 'active' AND employee.active`;
}

export function serviceVisibilityAccountId(auth: AuthenticationContext): string | undefined {
  const canApprove = auth.permissions.some(
    (permission) =>
      (permission.module === 'erp.service' || permission.module === '*') &&
      (permission.action === 'approve' || permission.action === '*'),
  );
  return canApprove ? undefined : auth.accountId;
}

function mapTechnician(row: TechnicianRow): ServiceTechnicianReference {
  return {
    accountId: row.account_id,
    displayName: row.display_name,
    email: row.email,
    warehouseId: row.warehouse_id,
    warehouseName: row.warehouse_name,
  };
}

function mapRequest(row: RequestRow): ServiceRequest {
  const assignedTechnician = technicianFromRequest(row);
  return {
    ...(assignedTechnician ? { assignedTechnician } : {}),
    ...(row.completed_at ? { completedAt: asIso(row.completed_at) } : {}),
    createdAt: asIso(row.created_at),
    customerEquipmentId: row.customer_equipment_id,
    customerLocationId: row.customer_location_id,
    customerLocationName: row.customer_location_name,
    customerName: row.customer_name,
    customerPartnerId: row.customer_partner_id,
    deviceName: row.device_name,
    id: row.id,
    number: row.request_number,
    priority: row.priority,
    problemDescription: row.problem_description,
    ...(row.work_order_scheduled_end ? { scheduledEnd: asIso(row.work_order_scheduled_end) } : {}),
    ...(row.work_order_scheduled_start
      ? { scheduledStart: asIso(row.work_order_scheduled_start) }
      : {}),
    serialNumber: row.serial_number,
    serviceType: row.service_type,
    sourceChannel: row.source_channel,
    status: row.status,
    ...(row.subscription_contract_id
      ? { subscriptionContractId: row.subscription_contract_id }
      : {}),
    updatedAt: asIso(row.updated_at),
    version: row.version,
    ...(row.work_order_id ? { workOrderId: row.work_order_id } : {}),
    ...(row.work_order_number ? { workOrderNumber: row.work_order_number } : {}),
  };
}

function technicianFromRequest(row: RequestRow): ServiceTechnicianReference | undefined {
  if (
    !row.work_order_technician_account_id ||
    !row.work_order_technician_display_name ||
    !row.work_order_technician_email ||
    !row.work_order_technician_warehouse_id ||
    !row.work_order_technician_warehouse_name
  )
    return undefined;
  return {
    accountId: row.work_order_technician_account_id,
    displayName: row.work_order_technician_display_name,
    email: row.work_order_technician_email,
    warehouseId: row.work_order_technician_warehouse_id,
    warehouseName: row.work_order_technician_warehouse_name,
  };
}

function mapWorkOrder(
  row: WorkOrderRow,
  timeEntries: WorkOrderTimeRow[],
  parts: WorkOrderPartRow[],
  photos: WorkOrderPhotoRow[],
  history: WorkOrderHistoryRow[],
): ServiceWorkOrder {
  const assignedTechnician = technicianFromWorkOrder(row);
  return {
    ...(assignedTechnician ? { assignedTechnician } : {}),
    ...(row.completed_at ? { completedAt: asIso(row.completed_at) } : {}),
    ...(row.completion_notes ? { completionNotes: row.completion_notes } : {}),
    createdAt: asIso(row.created_at),
    customerEquipmentId: row.customer_equipment_id,
    customerLocationId: row.customer_location_id,
    customerLocationName: row.customer_location_name,
    customerName: row.customer_name,
    customerPartnerId: row.customer_partner_id,
    deviceName: row.device_name,
    history: history.map(mapHistory),
    id: row.id,
    laborCostBgn: row.labor_cost_bgn,
    laborMinutes: row.labor_minutes,
    number: row.work_order_number,
    parts: parts.map(mapPart),
    partsCostBgn: row.parts_cost_bgn,
    photos: photos.map(mapPhoto),
    priority: row.priority,
    problemDescription: row.problem_description,
    requestId: row.request_id,
    requestNumber: row.request_number,
    ...(row.scheduled_end ? { scheduledEnd: asIso(row.scheduled_end) } : {}),
    ...(row.scheduled_start ? { scheduledStart: asIso(row.scheduled_start) } : {}),
    serialNumber: row.serial_number,
    serviceType: row.service_type,
    ...(row.signer_name && row.signed_at
      ? { signature: { signedAt: asIso(row.signed_at), signerName: row.signer_name } }
      : {}),
    ...(row.started_at ? { startedAt: asIso(row.started_at) } : {}),
    status: row.status,
    ...(row.subscription_contract_id
      ? { subscriptionContractId: row.subscription_contract_id }
      : {}),
    timeEntries: timeEntries.map((entry) => ({
      id: entry.id,
      minutes: entry.minutes,
      ...(entry.note ? { note: entry.note } : {}),
      recordedAt: asIso(entry.recorded_at),
      workDate: entry.work_date,
    })),
    totalCostBgn: row.total_cost_bgn,
    transportCostBgn: row.transport_cost_bgn,
    updatedAt: asIso(row.updated_at),
    version: row.version,
  };
}

function technicianFromWorkOrder(row: WorkOrderRow): ServiceTechnicianReference | undefined {
  if (
    !row.assigned_technician_account_id ||
    !row.technician_display_name ||
    !row.technician_email ||
    !row.technician_warehouse_id ||
    !row.technician_warehouse_name
  )
    return undefined;
  return {
    accountId: row.assigned_technician_account_id,
    displayName: row.technician_display_name,
    email: row.technician_email,
    warehouseId: row.technician_warehouse_id,
    warehouseName: row.technician_warehouse_name,
  };
}

function mapPart(row: WorkOrderPartRow): ServiceWorkOrder['parts'][number] {
  return {
    ...(row.batch_number ? { batchNumber: row.batch_number } : {}),
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    quantity: row.quantity,
    serialNumbers: row.serial_numbers,
    stockIssueId: row.stock_issue_movement_id,
    totalCostBgn: row.total_cost_bgn,
    unitCostBgn: row.unit_cost_bgn,
    warehouseId: row.warehouse_id,
    warehouseName: row.warehouse_name,
  };
}

function mapPhoto(row: WorkOrderPhotoRow): ServiceWorkOrderPhoto {
  return {
    capturedAt: asIso(row.captured_at),
    fileName: row.file_name,
    id: row.id,
    mediaType: row.media_type,
    sizeBytes: row.size_bytes,
  };
}

function mapHistory(row: WorkOrderHistoryRow): ServiceWorkOrderHistoryEntry {
  return {
    changedAt: asIso(row.changed_at),
    ...(row.changed_by_name ? { changedByName: row.changed_by_name } : {}),
    id: row.id,
    nextStatus: row.next_status,
    ...(row.previous_status ? { previousStatus: row.previous_status } : {}),
    reason: row.reason,
  };
}

function normalizeCreateRequest(input: CreateServiceRequest) {
  const serviceType = input.serviceType;
  const subscriptionContractId = input.subscriptionContractId?.trim();
  if (serviceType === 'subscription' && !subscriptionContractId)
    throw new ApiErrorException(
      'SERVICE_SUBSCRIPTION_REQUIRED',
      'Choose the active service subscription that covers this request.',
      HttpStatus.BAD_REQUEST,
    );
  if (serviceType !== 'subscription' && subscriptionContractId)
    throw new ApiErrorException(
      'SERVICE_SUBSCRIPTION_NOT_ALLOWED',
      'A subscription can only be linked to subscription service work.',
      HttpStatus.BAD_REQUEST,
    );
  if (!['warranty', 'out_of_warranty', 'subscription'].includes(serviceType))
    throw new ApiErrorException(
      'SERVICE_TYPE_INVALID',
      'Choose a valid service type.',
      HttpStatus.BAD_REQUEST,
    );
  if (!['telephone', 'email', 'customer_portal', 'on_site'].includes(input.sourceChannel))
    throw new ApiErrorException(
      'SERVICE_SOURCE_CHANNEL_INVALID',
      'Choose a valid service request source.',
      HttpStatus.BAD_REQUEST,
    );
  if (!['low', 'normal', 'high', 'critical'].includes(input.priority))
    throw new ApiErrorException(
      'SERVICE_PRIORITY_INVALID',
      'Choose a valid priority.',
      HttpStatus.BAD_REQUEST,
    );
  return {
    customerEquipmentId: input.customerEquipmentId,
    customerLocationId: input.customerLocationId,
    customerPartnerId: input.customerPartnerId,
    priority: input.priority,
    problemDescription: text(input.problemDescription, 'SERVICE_PROBLEM_REQUIRED', 4000),
    sourceChannel: input.sourceChannel,
    ...(subscriptionContractId ? { subscriptionContractId } : {}),
    serviceType,
  };
}

function normalizeAssignment(input: AssignServiceWorkOrderRequest) {
  const scheduledStart = dateTime(input.scheduledStart, 'SERVICE_SCHEDULE_START_INVALID');
  const scheduledEnd = dateTime(input.scheduledEnd, 'SERVICE_SCHEDULE_END_INVALID');
  if (scheduledEnd <= scheduledStart)
    throw new ApiErrorException(
      'SERVICE_SCHEDULE_RANGE_INVALID',
      'The scheduled end must be after the scheduled start.',
      HttpStatus.BAD_REQUEST,
    );
  return {
    expectedVersion: positiveVersion(input.expectedVersion),
    scheduledEnd,
    scheduledStart,
    technicianAccountId: input.technicianAccountId,
    technicianWarehouseId: input.technicianWarehouseId,
  };
}

function normalizeCompletion(input: CompleteServiceWorkOrderRequest): NormalizedCompletion {
  const parts = normalizeParts(input.parts);
  const timeEntries = input.timeEntries.map((entry) => ({
    minutes: entry.minutes,
    ...(entry.note ? { note: text(entry.note, 'SERVICE_TIME_NOTE_INVALID', 1000) } : {}),
    workDate: date(entry.workDate, 'SERVICE_WORK_DATE_INVALID'),
  }));
  if (!timeEntries.length)
    throw new ApiErrorException(
      'SERVICE_WORKING_TIME_REQUIRED',
      'Record at least one working-time entry before completing the work order.',
      HttpStatus.BAD_REQUEST,
    );
  for (const entry of timeEntries)
    if (!Number.isInteger(entry.minutes) || entry.minutes < 1 || entry.minutes > 1440)
      throw new ApiErrorException(
        'SERVICE_WORKING_TIME_INVALID',
        'Each time entry must be between one minute and one day.',
        HttpStatus.BAD_REQUEST,
      );
  return {
    completionNotes: text(input.completionNotes, 'SERVICE_COMPLETION_NOTES_REQUIRED', 4000),
    laborCostBgn: nonNegativeMoney(input.laborCostBgn, 'SERVICE_LABOR_COST_INVALID'),
    parts,
    signature: signature(input.signatureImageDataUrl),
    signerName: text(input.signerName, 'SERVICE_SIGNER_NAME_REQUIRED', 255),
    timeEntries,
    transportCostBgn: nonNegativeMoney(input.transportCostBgn, 'SERVICE_TRANSPORT_COST_INVALID'),
  };
}

function normalizeParts(input: ServicePartUsageInput[]) {
  const productIds = new Set<string>();
  return input.map((part) => {
    if (productIds.has(part.productId))
      throw new ApiErrorException(
        'SERVICE_PART_DUPLICATE',
        'Each product can be recorded once per completed work order.',
        HttpStatus.BAD_REQUEST,
      );
    productIds.add(part.productId);
    const serialNumbers = normalizedSerialNumbers(part.serialNumbers);
    return {
      ...(part.batchNumber
        ? { batchNumber: text(part.batchNumber, 'SERVICE_BATCH_NUMBER_INVALID', 100) }
        : {}),
      productId: part.productId,
      quantity: positiveQuantity(part.quantity, 'SERVICE_PART_QUANTITY_INVALID'),
      serialNumbers,
    };
  });
}

function normalizePhoto(input: ServicePhotoUpload) {
  const mediaType = input.mediaType.toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mediaType))
    throw new ApiErrorException(
      'SERVICE_PHOTO_TYPE_INVALID',
      'Only JPEG, PNG, and WebP photos can be uploaded.',
      HttpStatus.BAD_REQUEST,
    );
  if (
    !Buffer.isBuffer(input.buffer) ||
    input.buffer.length < 1 ||
    input.buffer.length > 5 * 1024 * 1024
  )
    throw new ApiErrorException(
      'SERVICE_PHOTO_SIZE_INVALID',
      'A service photo must be between 1 byte and 5 MB.',
      HttpStatus.BAD_REQUEST,
    );
  if (input.sizeBytes !== input.buffer.length || !isImage(mediaType, input.buffer))
    throw new ApiErrorException(
      'SERVICE_PHOTO_CONTENT_INVALID',
      'The uploaded file does not match its declared image type.',
      HttpStatus.BAD_REQUEST,
    );
  return {
    buffer: input.buffer,
    fileName: text(input.fileName, 'SERVICE_PHOTO_NAME_INVALID', 255),
    mediaType: mediaType as ServiceWorkOrderPhoto['mediaType'],
    sha256: createHash('sha256').update(input.buffer).digest('hex'),
    sizeBytes: input.sizeBytes,
  };
}

function signature(value: string) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value.trim());
  if (!match?.[1])
    throw new ApiErrorException(
      'SERVICE_SIGNATURE_INVALID',
      'Draw the customer signature before completing the work order.',
      HttpStatus.BAD_REQUEST,
    );
  const data = Buffer.from(match[1], 'base64');
  if (data.length < 8 || data.length > 100_000 || !isImage('image/png', data))
    throw new ApiErrorException(
      'SERVICE_SIGNATURE_INVALID',
      'The customer signature could not be verified.',
      HttpStatus.BAD_REQUEST,
    );
  return { data, sha256: createHash('sha256').update(data).digest('hex') };
}

function isImage(mediaType: string, data: Buffer): boolean {
  if (mediaType === 'image/png')
    return data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mediaType === 'image/jpeg') return data[0] === 255 && data[1] === 216 && data[2] === 255;
  if (mediaType === 'image/webp')
    return (
      data.subarray(0, 4).toString('ascii') === 'RIFF' &&
      data.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  return false;
}

function normalizedSerialNumbers(value: string[] | undefined): string[] {
  const serialNumbers = (value ?? []).map((item) =>
    text(item, 'SERVICE_SERIAL_NUMBER_INVALID', 120),
  );
  if (new Set(serialNumbers.map((item) => item.toUpperCase())).size !== serialNumbers.length)
    throw new ApiErrorException(
      'SERVICE_SERIAL_NUMBER_DUPLICATE',
      'Each serial number can be selected only once.',
      HttpStatus.BAD_REQUEST,
    );
  return serialNumbers;
}

function positiveQuantity(value: string, code: string): string {
  if (!/^\d+(\.\d{1,4})?$/u.test(value))
    throw new ApiErrorException(
      code,
      'Enter a positive quantity with up to four decimal places.',
      HttpStatus.BAD_REQUEST,
    );
  const normalized = decimalString(decimalUnits(value));
  if (decimalUnits(normalized) <= 0n)
    throw new ApiErrorException(
      code,
      'Enter a quantity greater than zero.',
      HttpStatus.BAD_REQUEST,
    );
  return normalized;
}

function nonNegativeMoney(value: string, code: string): string {
  if (!/^\d+(\.\d{1,4})?$/u.test(value))
    throw new ApiErrorException(
      code,
      'Enter an amount with up to four decimal places.',
      HttpStatus.BAD_REQUEST,
    );
  const normalized = decimalString(decimalUnits(value));
  if (decimalUnits(normalized) < 0n)
    throw new ApiErrorException(code, 'The amount cannot be negative.', HttpStatus.BAD_REQUEST);
  return normalized;
}

function decimalUnits(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(`${whole}${fraction.padEnd(4, '0').slice(0, 4)}`);
}

function decimalString(units: bigint): string {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const whole = absolute / 10_000n;
  const fraction = (absolute % 10_000n).toString().padStart(4, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function text(value: string, code: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength)
    throw new ApiErrorException(code, 'Enter a valid value.', HttpStatus.BAD_REQUEST);
  return normalized;
}

function safeFileStem(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/gu, '_').slice(0, 120) || 'service-evidence';
}

function date(value: string, code: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
    throw new ApiErrorException(code, 'Enter a valid date.', HttpStatus.BAD_REQUEST);
  return value;
}

function dateTime(value: string, code: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed))
    throw new ApiErrorException(code, 'Enter a valid date and time.', HttpStatus.BAD_REQUEST);
  return new Date(parsed).toISOString();
}

function positiveVersion(value: number): number {
  if (!Number.isInteger(value) || value < 1)
    throw new ApiErrorException(
      'SERVICE_VERSION_INVALID',
      'Refresh the record before making this change.',
      HttpStatus.BAD_REQUEST,
    );
  return value;
}

function validKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length > 200)
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_REQUIRED',
      'A valid Idempotency-Key header is required.',
      HttpStatus.BAD_REQUEST,
    );
  return key;
}

function internalEventKey(scope: string, commandKey: string, discriminator: string): string {
  return `${scope}:${createHash('sha256').update(`${commandKey}:${discriminator}`).digest('hex')}`;
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
    response_body: unknown;
    status: string;
  }>(
    `SELECT request_hash, status, response_body FROM platform.idempotency_keys
     WHERE scope = $1 AND idempotency_key = $2 FOR UPDATE`,
    [scope, key],
  );
  const row = existing.rows[0];
  if (row?.request_hash !== hash || row.status !== 'completed')
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_CONFLICT',
      'The idempotency key was already used for another request.',
      HttpStatus.CONFLICT,
    );
  return row.response_body;
}

function requestNotFound() {
  return new ApiErrorException(
    'SERVICE_REQUEST_NOT_FOUND',
    'The service request was not found.',
    HttpStatus.NOT_FOUND,
  );
}

function serviceRequestAccessDenied() {
  return new ApiErrorException(
    'SERVICE_REQUEST_ACCESS_DENIED',
    'This account can only access service requests assigned to it.',
    HttpStatus.FORBIDDEN,
  );
}

function workOrderNotFound() {
  return new ApiErrorException(
    'SERVICE_WORK_ORDER_NOT_FOUND',
    'The service work order was not found.',
    HttpStatus.NOT_FOUND,
  );
}

function serviceWorkOrderAccessDenied() {
  return new ApiErrorException(
    'SERVICE_WORK_ORDER_ACCESS_DENIED',
    'This account can only access work orders assigned to it.',
    HttpStatus.FORBIDDEN,
  );
}

function equipmentNotFound() {
  return new ApiErrorException(
    'SERVICE_EQUIPMENT_NOT_FOUND',
    'The selected equipment was not found.',
    HttpStatus.NOT_FOUND,
  );
}

function serviceEquipmentAccessDenied() {
  return new ApiErrorException(
    'SERVICE_EQUIPMENT_ACCESS_DENIED',
    'This account can only access equipment linked to its assigned service work.',
    HttpStatus.FORBIDDEN,
  );
}

function versionConflict(label: string) {
  return new ApiErrorException(
    'SERVICE_VERSION_CONFLICT',
    `${label} changed after it was opened. Refresh and try again.`,
    HttpStatus.CONFLICT,
  );
}

function required<T>(value: T | null | undefined, message: string): T {
  if (value === undefined || value === null) throw new Error(message);
  return value;
}

function asIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
