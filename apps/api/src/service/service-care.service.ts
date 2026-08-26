import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  CompleteServiceInspectionRequest,
  CreateServiceInspectionPlanRequest,
  CreateWarrantyClaimRequest,
  GenerateServicePlanVisitsResult,
  ManagedFile,
  ServiceCareOverview,
  ServiceInspectionPlan,
  TransitionWarrantyClaimRequest,
  WarrantyClaim,
  WarrantyClaimStatus,
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
import { FilesService } from '../files/files.service.js';
import type { BackgroundJobContext } from '../jobs/job-handler-registry.service.js';
import { serviceVisibilityAccountId } from './service.service.js';

interface WarrantyRow {
  active_claim_count: string;
  claim_count: string;
  customer_location_name: string;
  customer_name: string;
  device_name: string;
  equipment_id: string;
  remaining_days: number | null;
  serial_number: string;
  warranty_end_date: string | null;
}

interface ClaimRow {
  customer_equipment_id: string;
  customer_location_id: string;
  customer_location_name: string;
  customer_name: string;
  customer_partner_id: string;
  decision_note: string | null;
  description: string;
  device_name: string;
  id: string;
  claim_number: string;
  received_at: string | Date;
  serial_number: string;
  service_request_id: string | null;
  status: WarrantyClaimStatus;
  updated_at: string | Date;
  version: number;
}

interface ClaimHistoryRow {
  changed_at: string | Date;
  changed_by_name: string | null;
  id: string;
  next_status: WarrantyClaimStatus;
  note: string | null;
  previous_status: WarrantyClaimStatus | null;
}

interface InspectionRow {
  active: boolean;
  customer_location_name: string;
  customer_name: string;
  device_name: string;
  equipment_id: string;
  id: string;
  inspection_type: ServiceInspectionPlan['inspectionType'];
  interval_months: number;
  last_completed_on: string | null;
  next_due_date: string;
  reminder_lead_days: number;
  serial_number: string;
  version: number;
}

interface InspectionRecordRow {
  completed_on: string;
  due_date: string;
  id: string;
  notes: string;
  outcome: 'attention_required' | 'passed';
}

@Injectable()
export class ServiceCareService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(FilesService) private readonly files: FilesService,
  ) {}

  async overview(auth: AuthenticationContext): Promise<ServiceCareOverview> {
    const pool = this.database.getPool();
    const visibilityAccountId = serviceVisibilityAccountId(auth);
    const [warranties, claims, inspections] = await Promise.all([
      pool.query<WarrantyRow>(
        `SELECT equipment.id AS equipment_id, equipment.device_name, equipment.serial_number,
                equipment.warranty_end_date::text, partner.display_name AS customer_name,
                location.name AS customer_location_name,
                CASE WHEN equipment.warranty_end_date IS NULL THEN NULL
                     ELSE equipment.warranty_end_date - (now() AT TIME ZONE $1)::date END
                  AS remaining_days,
                count(claim.id)::text AS claim_count,
                count(claim.id) FILTER (WHERE claim.status <> 'closed')::text AS active_claim_count
         FROM master_data.customer_equipment equipment
         JOIN master_data.customer_locations location ON location.id = equipment.customer_location_id
         JOIN master_data.partners partner ON partner.id = location.partner_id
         LEFT JOIN service.warranty_claims claim ON claim.customer_equipment_id = equipment.id
         WHERE equipment.active
           AND ($2::uuid IS NULL OR EXISTS (
             SELECT 1 FROM service.requests scope_request
             JOIN service.work_orders scope_work_order
               ON scope_work_order.service_request_id = scope_request.id
             WHERE scope_request.customer_equipment_id = equipment.id
               AND scope_work_order.assigned_technician_account_id = $2
           ))
         GROUP BY equipment.id, partner.display_name, location.name
         ORDER BY equipment.warranty_end_date NULLS LAST, partner.display_name,
                  equipment.device_name, equipment.id`,
        [this.environment.BUSINESS_TIMEZONE, visibilityAccountId],
      ),
      pool.query<ClaimRow>(
        `${claimQuery()}
         WHERE ($1::uuid IS NULL OR work_order.assigned_technician_account_id = $1)
         ORDER BY claim.received_at DESC, claim.id DESC`,
        [visibilityAccountId],
      ),
      pool.query<InspectionRow>(
        `${inspectionQuery()}
         WHERE ($1::uuid IS NULL OR EXISTS (
           SELECT 1 FROM service.requests scope_request
           JOIN service.work_orders scope_work_order
             ON scope_work_order.service_request_id = scope_request.id
           WHERE scope_request.customer_equipment_id = equipment.id
             AND scope_work_order.assigned_technician_account_id = $1
         ))
         ORDER BY plan.next_due_date, partner.display_name, equipment.device_name, plan.id`,
        [visibilityAccountId],
      ),
    ]);
    return {
      businessTimezone: this.environment.BUSINESS_TIMEZONE,
      claims: await Promise.all(claims.rows.map((row) => this.mapClaim(pool, row, auth))),
      inspections: await Promise.all(inspections.rows.map((row) => this.mapInspection(pool, row))),
      warranties: warranties.rows.map((row) => ({
        activeClaimCount: Number(row.active_claim_count),
        claimCount: Number(row.claim_count),
        customerLocationName: row.customer_location_name,
        customerName: row.customer_name,
        deviceName: row.device_name,
        equipmentId: row.equipment_id,
        ...(row.remaining_days === null ? {} : { remainingDays: row.remaining_days }),
        serialNumber: row.serial_number,
        status:
          row.warranty_end_date === null
            ? 'not_recorded'
            : (row.remaining_days ?? -1) >= 0
              ? 'active'
              : 'expired',
        ...(row.warranty_end_date ? { warrantyEndsOn: row.warranty_end_date } : {}),
      })),
    };
  }

  async createClaim(
    input: CreateWarrantyClaimRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<WarrantyClaim> {
    const normalized = {
      customerEquipmentId: input.customerEquipmentId,
      customerLocationId: input.customerLocationId,
      customerPartnerId: input.customerPartnerId,
      description: requiredText(input.description, 4000),
      ...(input.serviceRequestId ? { serviceRequestId: input.serviceRequestId } : {}),
    };
    return this.command(
      'service.warranty-claim.create',
      key,
      normalized,
      201,
      async (client, commandKey) => {
        await this.requireClaimReferences(client, normalized);
        const id = randomUUID();
        const number = await this.nextNumber(client, 'warranty_claim', 'WCL');
        await client.query(
          `INSERT INTO service.warranty_claims (
           id, claim_number, customer_partner_id, customer_location_id,
           customer_equipment_id, service_request_id, description, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
          [
            id,
            number,
            normalized.customerPartnerId,
            normalized.customerLocationId,
            normalized.customerEquipmentId,
            normalized.serviceRequestId ?? null,
            normalized.description,
            auth.accountId,
          ],
        );
        await client.query(
          `INSERT INTO service.warranty_claim_status_history (
           id, warranty_claim_id, previous_status, next_status, changed_by
         ) VALUES ($1,$2,NULL,'received',$3)`,
          [randomUUID(), id, auth.accountId],
        );
        const claim = await this.loadClaim(client, id, auth);
        await this.sideEffects(
          client,
          'warranty_claim',
          id,
          'service.warranty-claim.created',
          claim,
          auth,
          metadata,
          commandKey,
        );
        return claim;
      },
    );
  }

  async transitionClaim(
    id: string,
    input: TransitionWarrantyClaimRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<WarrantyClaim> {
    const normalized = {
      expectedVersion: positiveVersion(input.expectedVersion),
      nextStatus: input.nextStatus,
      ...(input.note ? { note: requiredText(input.note, 2000) } : {}),
    };
    return this.command(
      `service.warranty-claim.transition:${id}`,
      key,
      normalized,
      200,
      async (client, commandKey) => {
        const current = await client.query<{ status: WarrantyClaimStatus; version: number }>(
          'SELECT status, version FROM service.warranty_claims WHERE id = $1 FOR UPDATE',
          [id],
        );
        const row = current.rows[0];
        if (!row) throw claimNotFound();
        if (row.version !== normalized.expectedVersion) throw staleRecord('warranty claim');
        if (!(allowedClaimTransitions[row.status] ?? []).includes(normalized.nextStatus))
          throw new ApiErrorException(
            'SERVICE_WARRANTY_CLAIM_TRANSITION_INVALID',
            'Choose the next available step in the warranty claim.',
            HttpStatus.CONFLICT,
          );
        if (['approved', 'rejected'].includes(normalized.nextStatus) && !normalized.note)
          throw new ApiErrorException(
            'SERVICE_WARRANTY_CLAIM_NOTE_REQUIRED',
            'Add the decision note before approving or rejecting the claim.',
            HttpStatus.BAD_REQUEST,
          );
        await client.query(
          `UPDATE service.warranty_claims
         SET status = $2::varchar(30), decision_note = COALESCE($3, decision_note),
             closed_at = CASE WHEN $2::varchar(30) = 'closed' THEN now() ELSE NULL END,
             updated_by = $4, version = version + 1, updated_at = now()
         WHERE id = $1`,
          [id, normalized.nextStatus, normalized.note ?? null, auth.accountId],
        );
        await client.query(
          `INSERT INTO service.warranty_claim_status_history (
           id, warranty_claim_id, previous_status, next_status, note, changed_by
         ) VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            randomUUID(),
            id,
            row.status,
            normalized.nextStatus,
            normalized.note ?? null,
            auth.accountId,
          ],
        );
        const claim = await this.loadClaim(client, id, auth);
        await this.sideEffects(
          client,
          'warranty_claim',
          id,
          'service.warranty-claim.status-changed',
          claim,
          auth,
          metadata,
          commandKey,
          { status: row.status, version: row.version },
        );
        return claim;
      },
    );
  }

  async createInspectionPlan(
    input: CreateServiceInspectionPlanRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<ServiceInspectionPlan> {
    const normalized = normalizeInspectionPlan(input);
    return this.command(
      'service.inspection-plan.create',
      key,
      normalized,
      201,
      async (client, commandKey) => {
        const equipment = await client.query(
          `SELECT id FROM master_data.customer_equipment
         WHERE id = $1 AND active AND status <> 'retired' FOR KEY SHARE`,
          [normalized.customerEquipmentId],
        );
        if (!equipment.rowCount)
          throw new ApiErrorException(
            'SERVICE_INSPECTION_EQUIPMENT_NOT_FOUND',
            'Choose an active registered device.',
            HttpStatus.NOT_FOUND,
          );
        const id = randomUUID();
        try {
          await client.query(
            `INSERT INTO service.equipment_inspection_plans (
             id, customer_equipment_id, inspection_type, interval_months,
             next_due_date, reminder_lead_days, created_by, updated_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
            [
              id,
              normalized.customerEquipmentId,
              normalized.inspectionType,
              normalized.intervalMonths,
              normalized.nextDueDate,
              normalized.reminderLeadDays,
              auth.accountId,
            ],
          );
        } catch (error) {
          if (isUniqueViolation(error))
            throw new ApiErrorException(
              'SERVICE_INSPECTION_PLAN_EXISTS',
              'This device already has that inspection plan.',
              HttpStatus.CONFLICT,
            );
          throw error;
        }
        const plan = await this.loadInspection(client, id);
        await this.sideEffects(
          client,
          'service_inspection_plan',
          id,
          'service.inspection-plan.created',
          plan,
          auth,
          metadata,
          commandKey,
        );
        return plan;
      },
    );
  }

  async completeInspection(
    id: string,
    input: CompleteServiceInspectionRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<ServiceInspectionPlan> {
    const normalized = {
      completedOn: calendarDate(input.completedOn),
      expectedVersion: positiveVersion(input.expectedVersion),
      notes: requiredText(input.notes, 2000),
      outcome: input.outcome,
    };
    if (!['passed', 'attention_required'].includes(normalized.outcome))
      throw new ApiErrorException(
        'SERVICE_INSPECTION_OUTCOME_INVALID',
        'Choose a valid inspection result.',
        HttpStatus.BAD_REQUEST,
      );
    return this.command(
      `service.inspection-plan.complete:${id}`,
      key,
      normalized,
      200,
      async (client, commandKey) => {
        const current = await client.query<{
          active: boolean;
          interval_months: number;
          next_due_date: string;
          version: number;
        }>(
          `SELECT active, interval_months, next_due_date::text, version
         FROM service.equipment_inspection_plans WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const row = current.rows[0];
        if (!row) throw inspectionNotFound();
        if (!row.active)
          throw new ApiErrorException(
            'SERVICE_INSPECTION_PLAN_INACTIVE',
            'This inspection plan is inactive.',
            HttpStatus.CONFLICT,
          );
        if (row.version !== normalized.expectedVersion) throw staleRecord('inspection plan');
        await client.query(
          `INSERT INTO service.equipment_inspection_records (
           id, inspection_plan_id, due_date, completed_on, outcome, notes, completed_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            randomUUID(),
            id,
            row.next_due_date,
            normalized.completedOn,
            normalized.outcome,
            normalized.notes,
            auth.accountId,
          ],
        );
        await client.query(
          `UPDATE service.equipment_inspection_plans
         SET last_completed_on = $2,
             next_due_date = ($2::date + make_interval(months => interval_months))::date,
             updated_by = $3, version = version + 1, updated_at = now()
         WHERE id = $1`,
          [id, normalized.completedOn, auth.accountId],
        );
        const plan = await this.loadInspection(client, id);
        await this.sideEffects(
          client,
          'service_inspection_plan',
          id,
          'service.inspection.completed',
          plan,
          auth,
          metadata,
          commandKey,
          { nextDueDate: row.next_due_date, version: row.version },
        );
        return plan;
      },
    );
  }

  async prepareWarrantyReminders(context: BackgroundJobContext) {
    return this.prepareCareReminders(context, 'warranty');
  }

  async prepareInspectionReminders(context: BackgroundJobContext) {
    return this.prepareCareReminders(context, 'inspection');
  }

  async generateServicePlanVisits(
    context: BackgroundJobContext,
  ): Promise<GenerateServicePlanVisitsResult> {
    const asOf = payloadDate(context.payload['asOf']);
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const horizon = await client.query<{ date: string }>(
        `SELECT ($1::date + $2::integer)::date::text AS date`,
        [asOf, this.environment.SERVICE_PLAN_VISIT_HORIZON_DAYS],
      );
      const due = await client.query<{
        contract_id: string;
        contract_number: string;
        customer_equipment_id: string;
        customer_location_id: string;
        customer_partner_id: string;
        planned_date: string;
        service_description: string;
      }>(
        `SELECT contract.id AS contract_id, contract.contract_number,
                contract.customer_partner_id, contract.customer_location_id,
                device.customer_equipment_id, occurrence::date::text AS planned_date,
                string_agg(service.description, '; ' ORDER BY service.position) AS service_description
         FROM sales.service_subscription_contracts contract
         JOIN sales.service_subscription_devices device ON device.contract_id = contract.id
         JOIN sales.service_subscription_services service ON service.contract_id = contract.id
         CROSS JOIN LATERAL generate_series(
           contract.valid_from::timestamp,
           LEAST(COALESCE(contract.valid_to, $2::date), $2::date)::timestamp,
           make_interval(months => contract.visit_frequency_months)
         ) occurrence
         WHERE contract.active AND occurrence::date BETWEEN $1::date AND $2::date
         GROUP BY contract.id, device.customer_equipment_id, occurrence
         ORDER BY occurrence, contract.id, device.customer_equipment_id`,
        [asOf, horizon.rows[0]?.date ?? asOf],
      );
      const creator = await client.query<{ id: string }>(
        `SELECT DISTINCT account.id
         FROM identity.user_accounts account
         JOIN iam.account_roles assignment ON assignment.account_id = account.id
         JOIN iam.role_permissions role_permission ON role_permission.role_id = assignment.role_id
         JOIN iam.permissions permission ON permission.id = role_permission.permission_id
         WHERE account.status = 'active' AND permission.module = 'erp.service'
           AND permission.action IN ('approve', '*')
         ORDER BY account.id LIMIT 1`,
      );
      const creatorId = creator.rows[0]?.id;
      if (due.rowCount && !creatorId)
        throw new Error('An active Service manager is required for planned visits');
      const requestIds: string[] = [];
      for (const visit of due.rows) {
        const occurrenceKey = `${visit.contract_id}:${visit.customer_equipment_id}:${visit.planned_date}`;
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          occurrenceKey,
        ]);
        const existing = await client.query(
          `SELECT id FROM service.subscription_visit_generations
           WHERE subscription_contract_id = $1 AND customer_equipment_id = $2 AND planned_date = $3`,
          [visit.contract_id, visit.customer_equipment_id, visit.planned_date],
        );
        if (existing.rowCount) continue;
        const requestId = randomUUID();
        const number = await this.nextNumber(client, 'request', 'SRV');
        await client.query(
          `INSERT INTO service.requests (
             id, request_number, customer_partner_id, customer_location_id,
             customer_equipment_id, subscription_contract_id, source_channel,
             service_type, priority, problem_description, created_by, updated_by
           ) VALUES ($1,$2,$3,$4,$5,$6,'service_plan','subscription','normal',$7,$8,$8)`,
          [
            requestId,
            number,
            visit.customer_partner_id,
            visit.customer_location_id,
            visit.customer_equipment_id,
            visit.contract_id,
            `Planned visit under ${visit.contract_number}: ${visit.service_description}`,
            creatorId,
          ],
        );
        await client.query(
          `INSERT INTO service.subscription_visit_generations (
             id, subscription_contract_id, customer_equipment_id,
             planned_date, service_request_id, source_job_id
           ) VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            randomUUID(),
            visit.contract_id,
            visit.customer_equipment_id,
            visit.planned_date,
            requestId,
            context.jobId,
          ],
        );
        const payload = {
          contractId: visit.contract_id,
          plannedDate: visit.planned_date,
          requestId,
          requestNumber: number,
        };
        await client.query(
          `INSERT INTO integration.outbox_events (
             id, aggregate_type, aggregate_id, event_type, event_version,
             correlation_id, idempotency_key, payload
           ) VALUES ($1,'service_request',$2,'service.plan-visit.generated',1,$3,$4,$5)`,
          [
            randomUUID(),
            requestId,
            context.correlationId,
            `service.plan-visit.generated:${occurrenceKey}`,
            payload,
          ],
        );
        await this.audit.append(
          {
            action: 'service.plan-visit.generated',
            after: payload,
            correlationId: context.correlationId,
            metadata: { jobId: context.jobId },
            targetId: requestId,
            targetType: 'service_request',
          },
          client,
        );
        requestIds.push(requestId);
      }
      await client.query('COMMIT');
      return { asOf, generatedCount: requestIds.length, requestIds };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async prepareCareReminders(
    context: BackgroundJobContext,
    kind: 'inspection' | 'warranty',
  ) {
    const asOf = payloadDate(context.payload['asOf']);
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const recipients = await client.query<{ id: string }>(
        `SELECT DISTINCT account.id
         FROM identity.user_accounts account
         JOIN iam.account_roles assignment ON assignment.account_id = account.id
         JOIN iam.role_permissions role_permission ON role_permission.role_id = assignment.role_id
         JOIN iam.permissions permission ON permission.id = role_permission.permission_id
         WHERE account.status = 'active' AND permission.module = 'erp.service'
           AND permission.action IN ('approve', '*') ORDER BY account.id`,
      );
      const records =
        kind === 'warranty'
          ? await client.query<{
              customer_name: string;
              device_name: string;
              due_date: string;
              id: string;
              serial_number: string;
            }>(
              `SELECT equipment.id, equipment.device_name, equipment.serial_number,
                    equipment.warranty_end_date::text AS due_date,
                    partner.display_name AS customer_name
             FROM master_data.customer_equipment equipment
             JOIN master_data.customer_locations location ON location.id = equipment.customer_location_id
             JOIN master_data.partners partner ON partner.id = location.partner_id
             WHERE equipment.active
               AND equipment.warranty_end_date BETWEEN $1::date AND $1::date + $2::integer
             ORDER BY equipment.warranty_end_date, equipment.id`,
              [asOf, this.environment.SERVICE_WARRANTY_REMINDER_LEAD_DAYS],
            )
          : await client.query<{
              customer_name: string;
              device_name: string;
              due_date: string;
              id: string;
              serial_number: string;
            }>(
              `SELECT plan.id, equipment.device_name, equipment.serial_number,
                    plan.next_due_date::text AS due_date, partner.display_name AS customer_name
             FROM service.equipment_inspection_plans plan
             JOIN master_data.customer_equipment equipment ON equipment.id = plan.customer_equipment_id
             JOIN master_data.customer_locations location ON location.id = equipment.customer_location_id
             JOIN master_data.partners partner ON partner.id = location.partner_id
             WHERE plan.active AND plan.next_due_date <= $1::date + plan.reminder_lead_days
             ORDER BY plan.next_due_date, plan.id`,
              [asOf],
            );
      const notificationIds: string[] = [];
      for (const recipient of recipients.rows) {
        for (const record of records.rows) {
          const notificationId = randomUUID();
          const idempotencyKey = `service.${kind}-reminder:${record.id}:${record.due_date}:${recipient.id}`;
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO notifications.messages (
               id, recipient_account_id, channel, template_key, template_version,
               payload, idempotency_key
             ) VALUES ($1,$2,'in_system',$3,1,$4,$5)
             ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
            [
              notificationId,
              recipient.id,
              `service.${kind}.due`,
              {
                customerName: record.customer_name,
                deviceName: record.device_name,
                dueDate: record.due_date,
                recordId: record.id,
                serialNumber: record.serial_number,
              },
              idempotencyKey,
            ],
          );
          if (inserted.rows[0]?.id) notificationIds.push(inserted.rows[0].id);
        }
      }
      await client.query('COMMIT');
      return { asOf, notificationCount: notificationIds.length, notificationIds };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async requireClaimReferences(client: PoolClient, input: CreateWarrantyClaimRequest) {
    const equipment = await client.query(
      `SELECT equipment.id
       FROM master_data.customer_equipment equipment
       JOIN master_data.customer_locations location ON location.id = equipment.customer_location_id
       WHERE equipment.id = $1 AND equipment.customer_location_id = $2
         AND location.partner_id = $3 AND equipment.active FOR KEY SHARE OF equipment, location`,
      [input.customerEquipmentId, input.customerLocationId, input.customerPartnerId],
    );
    if (!equipment.rowCount)
      throw new ApiErrorException(
        'SERVICE_WARRANTY_EQUIPMENT_NOT_FOUND',
        'Choose an active device registered at that customer location.',
        HttpStatus.NOT_FOUND,
      );
    if (input.serviceRequestId) {
      const request = await client.query(
        `SELECT id FROM service.requests
         WHERE id = $1 AND customer_equipment_id = $2 AND customer_location_id = $3
           AND customer_partner_id = $4 AND service_type = 'warranty' FOR KEY SHARE`,
        [
          input.serviceRequestId,
          input.customerEquipmentId,
          input.customerLocationId,
          input.customerPartnerId,
        ],
      );
      if (!request.rowCount)
        throw new ApiErrorException(
          'SERVICE_WARRANTY_REQUEST_NOT_FOUND',
          'Choose a warranty service request for this device.',
          HttpStatus.NOT_FOUND,
        );
    }
  }

  private async loadClaim(
    client: PoolClient,
    id: string,
    auth: AuthenticationContext,
  ): Promise<WarrantyClaim> {
    const result = await client.query<ClaimRow>(`${claimQuery()} WHERE claim.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw claimNotFound();
    return this.mapClaim(client, row, auth);
  }

  private async mapClaim(
    queryable: Pick<PoolClient, 'query'>,
    row: ClaimRow,
    auth: AuthenticationContext,
  ): Promise<WarrantyClaim> {
    const history = await queryable.query<ClaimHistoryRow>(
      `SELECT history.id, history.previous_status, history.next_status, history.note,
              history.changed_at, employee.display_name AS changed_by_name
       FROM service.warranty_claim_status_history history
       LEFT JOIN identity.user_accounts account ON account.id = history.changed_by
       LEFT JOIN identity.employees employee ON employee.id = account.employee_id
       WHERE history.warranty_claim_id = $1 ORDER BY history.changed_at, history.id`,
      [row.id],
    );
    let attachments: ManagedFile[] = [];
    try {
      attachments = (
        await this.files.list(
          { page: 1, pageSize: 100, parentId: row.id, parentType: 'warranty_claim' },
          auth,
        )
      ).items;
    } catch (error) {
      if (!(error instanceof ApiErrorException)) throw error;
    }
    return {
      attachments,
      customerEquipmentId: row.customer_equipment_id,
      customerLocationId: row.customer_location_id,
      customerLocationName: row.customer_location_name,
      customerName: row.customer_name,
      customerPartnerId: row.customer_partner_id,
      ...(row.decision_note ? { decisionNote: row.decision_note } : {}),
      description: row.description,
      deviceName: row.device_name,
      history: history.rows.map((item) => ({
        changedAt: asIso(item.changed_at),
        ...(item.changed_by_name ? { changedByName: item.changed_by_name } : {}),
        id: item.id,
        nextStatus: item.next_status,
        ...(item.note ? { note: item.note } : {}),
        ...(item.previous_status ? { previousStatus: item.previous_status } : {}),
      })),
      id: row.id,
      number: row.claim_number,
      receivedAt: asIso(row.received_at),
      serialNumber: row.serial_number,
      ...(row.service_request_id ? { serviceRequestId: row.service_request_id } : {}),
      status: row.status,
      updatedAt: asIso(row.updated_at),
      version: row.version,
    };
  }

  private async loadInspection(client: PoolClient, id: string): Promise<ServiceInspectionPlan> {
    const result = await client.query<InspectionRow>(`${inspectionQuery()} WHERE plan.id = $1`, [
      id,
    ]);
    const row = result.rows[0];
    if (!row) throw inspectionNotFound();
    return this.mapInspection(client, row);
  }

  private async mapInspection(
    queryable: Pick<PoolClient, 'query'>,
    row: InspectionRow,
  ): Promise<ServiceInspectionPlan> {
    const records = await queryable.query<InspectionRecordRow>(
      `SELECT id, due_date::text, completed_on::text, outcome, notes
       FROM service.equipment_inspection_records WHERE inspection_plan_id = $1
       ORDER BY completed_on DESC, id DESC`,
      [row.id],
    );
    return {
      active: row.active,
      customerLocationName: row.customer_location_name,
      customerName: row.customer_name,
      deviceName: row.device_name,
      equipmentId: row.equipment_id,
      id: row.id,
      inspectionType: row.inspection_type,
      intervalMonths: row.interval_months,
      ...(row.last_completed_on ? { lastCompletedOn: row.last_completed_on } : {}),
      nextDueDate: row.next_due_date,
      records: records.rows.map((record) => ({
        completedOn: record.completed_on,
        dueDate: record.due_date,
        id: record.id,
        notes: record.notes,
        outcome: record.outcome,
      })),
      reminderLeadDays: row.reminder_lead_days,
      serialNumber: row.serial_number,
      version: row.version,
    };
  }

  private async nextNumber(client: PoolClient, type: string, prefix: string) {
    const year = await client.query<{ year: string }>(
      `SELECT to_char(now() AT TIME ZONE $1, 'YYYY') AS year`,
      [this.environment.BUSINESS_TIMEZONE],
    );
    await client.query(
      `INSERT INTO service.internal_document_sequences (document_type) VALUES ($1) ON CONFLICT DO NOTHING`,
      [type],
    );
    const result = await client.query<{ value: string }>(
      `UPDATE service.internal_document_sequences SET next_value = next_value + 1, updated_at = now() WHERE document_type = $1 RETURNING (next_value - 1)::text AS value`,
      [type],
    );
    return `${prefix}-${year.rows[0]?.year ?? new Date().getUTCFullYear()}-${(result.rows[0]?.value ?? '0').padStart(6, '0')}`;
  }

  private async command<T>(
    scope: string,
    key: string | undefined,
    payload: object,
    responseStatus: number,
    action: (client: PoolClient, commandKey: string) => Promise<T>,
  ): Promise<T> {
    const commandKey = validKey(key);
    const requestHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const replay = await claimIdempotency(client, scope, commandKey, requestHash);
      if (replay !== undefined) {
        await client.query('COMMIT');
        return replay as T;
      }
      const result = await action(client, commandKey);
      await client.query(
        `UPDATE platform.idempotency_keys SET status = 'completed', response_status = $3, response_body = $4 WHERE scope = $1 AND idempotency_key = $2`,
        [scope, commandKey, responseStatus, result],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
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
  ) {
    await client.query(
      `INSERT INTO integration.outbox_events (id, aggregate_type, aggregate_id, event_type, event_version, correlation_id, idempotency_key, payload) VALUES ($1,$2,$3,$4,1,$5,$6,$7)`,
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

const allowedClaimTransitions: Record<WarrantyClaimStatus, WarrantyClaimStatus[]> = {
  approved: ['closed'],
  closed: [],
  received: ['under_review'],
  rejected: ['closed'],
  under_review: ['approved', 'rejected'],
};

function claimQuery() {
  return `SELECT claim.id, claim.claim_number, claim.customer_partner_id,
                 claim.customer_location_id, claim.customer_equipment_id,
                 claim.service_request_id, claim.description, claim.status,
                 claim.decision_note, claim.received_at, claim.updated_at, claim.version,
                 partner.display_name AS customer_name, location.name AS customer_location_name,
                 equipment.device_name, equipment.serial_number
          FROM service.warranty_claims claim
          JOIN master_data.partners partner ON partner.id = claim.customer_partner_id
          JOIN master_data.customer_locations location ON location.id = claim.customer_location_id
          JOIN master_data.customer_equipment equipment ON equipment.id = claim.customer_equipment_id
          LEFT JOIN service.requests request ON request.id = claim.service_request_id
          LEFT JOIN service.work_orders work_order ON work_order.service_request_id = request.id`;
}

function inspectionQuery() {
  return `SELECT plan.id, plan.customer_equipment_id AS equipment_id, plan.inspection_type,
                 plan.interval_months, plan.next_due_date::text, plan.reminder_lead_days,
                 plan.last_completed_on::text, plan.active, plan.version,
                 equipment.device_name, equipment.serial_number,
                 partner.display_name AS customer_name, location.name AS customer_location_name
          FROM service.equipment_inspection_plans plan
          JOIN master_data.customer_equipment equipment ON equipment.id = plan.customer_equipment_id
          JOIN master_data.customer_locations location ON location.id = equipment.customer_location_id
          JOIN master_data.partners partner ON partner.id = location.partner_id`;
}

function normalizeInspectionPlan(input: CreateServiceInspectionPlanRequest) {
  if (!['technical', 'metrological'].includes(input.inspectionType))
    throw new ApiErrorException(
      'SERVICE_INSPECTION_TYPE_INVALID',
      'Choose technical or metrological inspection.',
      HttpStatus.BAD_REQUEST,
    );
  if (
    !Number.isInteger(input.intervalMonths) ||
    input.intervalMonths < 1 ||
    input.intervalMonths > 120
  )
    throw new ApiErrorException(
      'SERVICE_INSPECTION_INTERVAL_INVALID',
      'Inspection frequency must be between 1 and 120 months.',
      HttpStatus.BAD_REQUEST,
    );
  if (
    !Number.isInteger(input.reminderLeadDays) ||
    input.reminderLeadDays < 0 ||
    input.reminderLeadDays > 365
  )
    throw new ApiErrorException(
      'SERVICE_INSPECTION_REMINDER_INVALID',
      'Reminder lead time must be between 0 and 365 days.',
      HttpStatus.BAD_REQUEST,
    );
  return {
    customerEquipmentId: input.customerEquipmentId,
    inspectionType: input.inspectionType,
    intervalMonths: input.intervalMonths,
    nextDueDate: calendarDate(input.nextDueDate),
    reminderLeadDays: input.reminderLeadDays,
  };
}

function payloadDate(value: unknown): string {
  return typeof value === 'string' ? calendarDate(value) : new Date().toISOString().slice(0, 10);
}

function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
    throw new ApiErrorException(
      'SERVICE_DATE_INVALID',
      'Enter a valid date.',
      HttpStatus.BAD_REQUEST,
    );
  return value;
}

function requiredText(value: string, maxLength: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength)
    throw new ApiErrorException(
      'SERVICE_TEXT_INVALID',
      'Enter a valid value.',
      HttpStatus.BAD_REQUEST,
    );
  return normalized;
}

function positiveVersion(value: number) {
  if (!Number.isInteger(value) || value < 1)
    throw new ApiErrorException(
      'SERVICE_VERSION_INVALID',
      'Refresh this record and try again.',
      HttpStatus.BAD_REQUEST,
    );
  return value;
}

function validKey(value: string | undefined) {
  if (!value || value.length > 255)
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_REQUIRED',
      'A valid Idempotency-Key header is required.',
      HttpStatus.BAD_REQUEST,
    );
  return value;
}

async function claimIdempotency(client: PoolClient, scope: string, key: string, hash: string) {
  const inserted = await client.query(
    `INSERT INTO platform.idempotency_keys (scope, idempotency_key, request_hash, status, expires_at) VALUES ($1,$2,$3,'processing',now() + INTERVAL '24 hours') ON CONFLICT DO NOTHING RETURNING idempotency_key`,
    [scope, key, hash],
  );
  if (inserted.rowCount) return undefined;
  const existing = await client.query<{
    request_hash: string;
    response_body: unknown;
    status: string;
  }>(
    `SELECT request_hash, response_body, status FROM platform.idempotency_keys WHERE scope = $1 AND idempotency_key = $2 FOR UPDATE`,
    [scope, key],
  );
  const row = existing.rows[0];
  if (!row || row.request_hash !== hash)
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_REUSED',
      'This request key was already used for different information.',
      HttpStatus.CONFLICT,
    );
  if (row.status === 'completed') return row.response_body;
  throw new ApiErrorException(
    'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    'This request is already being processed.',
    HttpStatus.CONFLICT,
  );
}

function asIso(value: string | Date) {
  return new Date(value).toISOString();
}
function claimNotFound() {
  return new ApiErrorException(
    'SERVICE_WARRANTY_CLAIM_NOT_FOUND',
    'The warranty claim was not found.',
    HttpStatus.NOT_FOUND,
  );
}
function inspectionNotFound() {
  return new ApiErrorException(
    'SERVICE_INSPECTION_PLAN_NOT_FOUND',
    'The inspection plan was not found.',
    HttpStatus.NOT_FOUND,
  );
}
function staleRecord(label: string) {
  return new ApiErrorException(
    'SERVICE_RECORD_CHANGED',
    `This ${label} changed. Refresh it and try again.`,
    HttpStatus.CONFLICT,
  );
}
function isUniqueViolation(error: unknown): error is { code: string } {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505',
  );
}
