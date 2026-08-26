import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  CreateCrmTicketFromServiceRequestRequest,
  CreateCrmTicketRequest,
  CreateServiceRequestFromCrmTicketRequest,
  CrmSlaPolicyReference,
  CrmSlaTimerState,
  CrmTicket,
  CrmTicketChannel,
  CrmTicketPage,
  CrmTicketPriority,
  CrmTicketReferenceData,
  CrmTicketStatus,
  RecordCrmTicketResponseRequest,
  TransitionCrmTicketRequest,
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
import type { BackgroundJobContext } from '../jobs/job-handler-registry.service.js';
import { ServiceOperationsService } from '../service/service.service.js';
import type { ListCrmTicketsQueryDto } from './crm-tickets.dto.js';

interface TicketRow {
  assigned_to_account_id: string | null;
  assignee_name: string | null;
  category_code: string;
  category_id: string;
  category_name: string;
  channel: CrmTicketChannel;
  created_at: Date | string;
  created_by: string;
  customer_equipment_id: string | null;
  customer_location_id: string | null;
  customer_name: string;
  customer_partner_id: string;
  description: string;
  equipment_name: string | null;
  id: string;
  location_name: string | null;
  priority: CrmTicketPriority;
  responded_at: Date | string | null;
  response_due_at: Date | string;
  resolution_due_at: Date | string;
  resolved_at: Date | string | null;
  service_subscription_contract_id: string | null;
  sla_policy_id: string;
  sla_policy_name: string;
  sla_response_minutes: number;
  sla_resolution_minutes: number;
  status: CrmTicketStatus;
  subject: string;
  ticket_number: string;
  updated_at: Date | string;
  version: number;
}

interface PolicyRow {
  customer_partner_id: string | null;
  escalation_account_id: string | null;
  id: string;
  name: string;
  priority: CrmTicketPriority | null;
  resolution_minutes: number;
  response_minutes: number;
  risk_threshold_percent: number;
  service_subscription_contract_id: string | null;
}

type Queryable = Pool | PoolClient;

@Injectable()
export class CrmTicketsService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(ServiceOperationsService) private readonly service: ServiceOperationsService,
  ) {}

  async referenceData(): Promise<CrmTicketReferenceData> {
    const pool = this.database.getPool();
    const [customers, locations, equipment, subscriptions, categories, policies, assignees] =
      await Promise.all([
        pool.query<{ id: string; name: string }>(
          `SELECT DISTINCT partner.id, partner.display_name AS name
           FROM master_data.partners partner
           JOIN master_data.partner_roles role ON role.partner_id = partner.id
           WHERE partner.active AND role.role = 'customer'
           ORDER BY partner.display_name, partner.id`,
        ),
        pool.query<{ customer_partner_id: string; id: string; name: string }>(
          `SELECT location.id, location.partner_id AS customer_partner_id, location.name
           FROM master_data.customer_locations location
           JOIN master_data.partners partner ON partner.id = location.partner_id
           JOIN master_data.partner_roles role ON role.partner_id = partner.id AND role.role = 'customer'
           WHERE location.active AND partner.active
           ORDER BY location.name, location.id`,
        ),
        pool.query<{
          active: boolean;
          customer_location_id: string;
          customer_partner_id: string;
          device_name: string;
          id: string;
          serial_number: string;
          status: CrmTicketReferenceData['equipment'][number]['status'];
          warranty_end_date: string | null;
        }>(
          `SELECT equipment.id, equipment.active, location.partner_id AS customer_partner_id,
                  equipment.customer_location_id, equipment.device_name, equipment.serial_number,
                  equipment.status, equipment.warranty_end_date::text
           FROM master_data.customer_equipment equipment
           JOIN master_data.customer_locations location ON location.id = equipment.customer_location_id
           JOIN master_data.partners partner ON partner.id = location.partner_id
           JOIN master_data.partner_roles role ON role.partner_id = partner.id AND role.role = 'customer'
           WHERE partner.active
           ORDER BY equipment.device_name, equipment.serial_number, equipment.id`,
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
           GROUP BY contract.id
           ORDER BY contract.contract_number, contract.id`,
          [this.environment.BUSINESS_TIMEZONE],
        ),
        pool.query<{ code: string; id: string; name: string }>(
          `SELECT id, code, name FROM crm.ticket_categories WHERE active ORDER BY name, id`,
        ),
        pool.query<PolicyRow>(
          `SELECT id, name, customer_partner_id, service_subscription_contract_id, priority,
                response_minutes, resolution_minutes, risk_threshold_percent,
                escalation_account_id
         FROM crm.sla_policies WHERE active
         ORDER BY (service_subscription_contract_id IS NOT NULL) DESC,
                  (customer_partner_id IS NOT NULL) DESC, priority NULLS LAST, name, id`,
        ),
        pool.query<{ display_name: string; id: string }>(
          `SELECT DISTINCT account.id, employee.display_name
         FROM identity.user_accounts account
         JOIN identity.employees employee ON employee.id = account.employee_id
         JOIN iam.account_roles assignment ON assignment.account_id = account.id
         JOIN iam.role_permissions role_permission ON role_permission.role_id = assignment.role_id
         JOIN iam.permissions permission ON permission.id = role_permission.permission_id
         WHERE account.status = 'active' AND permission.module IN ('crm', '*')
           AND permission.action IN ('edit', '*')
         ORDER BY employee.display_name, account.id`,
        ),
      ]);
    return {
      assignees: assignees.rows.map((row) => ({ displayName: row.display_name, id: row.id })),
      businessTimezone: this.environment.BUSINESS_TIMEZONE,
      categories: categories.rows,
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
      slaPolicies: policies.rows.map(mapPolicy),
      subscriptions: subscriptions.rows.map((row) => ({
        customerEquipmentIds: row.customer_equipment_ids,
        customerLocationId: row.customer_location_id,
        customerPartnerId: row.customer_partner_id,
        id: row.id,
        number: row.number,
      })),
    };
  }

  async list(query: ListCrmTicketsQueryDto): Promise<CrmTicketPage> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const search = query.search?.trim() ?? '';
    const parameters: unknown[] = [query.status ?? null, query.priority ?? null, search];
    const where = `WHERE ($1::text IS NULL OR ticket.status = $1)
      AND ($2::text IS NULL OR ticket.priority = $2)
      AND ($3 = '' OR ticket.ticket_number ILIKE '%' || $3 || '%'
        OR ticket.subject ILIKE '%' || $3 || '%'
        OR partner.display_name ILIKE '%' || $3 || '%')`;
    const pool = this.database.getPool();
    const [count, rows, summary] = await Promise.all([
      pool.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM crm.tickets ticket
         JOIN master_data.partners partner ON partner.id = ticket.customer_partner_id ${where}`,
        parameters,
      ),
      pool.query<TicketRow>(
        `${ticketQuery()} ${where}
         ORDER BY CASE ticket.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2
                    WHEN 'normal' THEN 3 ELSE 4 END,
                  ticket.resolution_due_at, ticket.created_at DESC, ticket.id DESC
         LIMIT $4 OFFSET $5`,
        [...parameters, pageSize, (page - 1) * pageSize],
      ),
      pool.query<{
        at_risk: string;
        breached: string;
        open: string;
        unassigned: string;
      }>(
        `SELECT
           count(*) FILTER (WHERE status NOT IN ('resolved','closed','cancelled'))::text AS open,
           count(*) FILTER (WHERE assigned_to_account_id IS NULL
             AND status NOT IN ('resolved','closed','cancelled'))::text AS unassigned,
           count(*) FILTER (WHERE status NOT IN ('resolved','closed','cancelled')
             AND now() > resolution_due_at)::text AS breached,
           count(*) FILTER (WHERE status NOT IN ('resolved','closed','cancelled')
             AND now() <= resolution_due_at
             AND now() >= created_at + make_interval(mins =>
               floor(sla_resolution_minutes * sla_risk_threshold_percent / 100.0)::integer)
           )::text AS at_risk
         FROM crm.tickets`,
      ),
    ]);
    const total = Number(count.rows[0]?.total ?? '0');
    const summaryRow = summary.rows[0];
    return {
      items: await Promise.all(rows.rows.map((row) => this.mapTicket(pool, row))),
      page,
      pageSize,
      summary: {
        atRisk: Number(summaryRow?.at_risk ?? '0'),
        breached: Number(summaryRow?.breached ?? '0'),
        open: Number(summaryRow?.open ?? '0'),
        unassigned: Number(summaryRow?.unassigned ?? '0'),
      },
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async get(id: string): Promise<CrmTicket> {
    return this.loadTicket(this.database.getPool(), id);
  }

  async create(
    input: CreateCrmTicketRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CrmTicket> {
    const normalized = normalizeCreate(input);
    return this.command('crm.ticket.create', key, normalized, 201, async (client, commandKey) => {
      const policy = await this.requireReferences(client, normalized);
      const id = randomUUID();
      const number = await this.nextNumber(client);
      await client.query(
        `INSERT INTO crm.tickets (
           id, ticket_number, customer_partner_id, customer_location_id,
           customer_equipment_id, service_subscription_contract_id, category_id,
           channel, priority, subject, description, assigned_to_account_id,
           sla_policy_id, sla_policy_name, sla_response_minutes,
           sla_resolution_minutes, sla_risk_threshold_percent,
           response_due_at, resolution_due_at, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
           now() + make_interval(mins => $15),
           now() + make_interval(mins => $16),$18,$18)`,
        [
          id,
          number,
          normalized.customerPartnerId,
          normalized.customerLocationId ?? null,
          normalized.customerEquipmentId ?? null,
          normalized.serviceSubscriptionContractId ?? null,
          normalized.categoryId,
          normalized.channel,
          normalized.priority,
          normalized.subject,
          normalized.description,
          normalized.assignedToAccountId ?? null,
          policy.id,
          policy.name,
          policy.response_minutes,
          policy.resolution_minutes,
          policy.risk_threshold_percent,
          auth.accountId,
        ],
      );
      await this.appendHistory(client, id, 'created', 'new', 'Ticket created.', auth.accountId);
      const ticket = await this.loadTicket(client, id);
      await this.sideEffects(client, id, 'crm.ticket.created', ticket, auth, metadata, commandKey);
      return ticket;
    });
  }

  async respond(
    id: string,
    input: RecordCrmTicketResponseRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CrmTicket> {
    const normalized = {
      expectedVersion: version(input.expectedVersion),
      note: text(input.note, 2000),
    };
    return this.command(
      `crm.ticket.respond:${id}`,
      key,
      normalized,
      200,
      async (client, commandKey) => {
        const before = await this.lockTicket(client, id);
        assertVersion(before, normalized.expectedVersion);
        if (before.responded_at)
          throw conflict('CRM_TICKET_ALREADY_RESPONDED', 'The first response is already recorded.');
        if (['resolved', 'closed', 'cancelled'].includes(before.status))
          throw conflict(
            'CRM_TICKET_NOT_RESPONDABLE',
            'This ticket is no longer open for a first response.',
          );
        const nextStatus = before.status === 'new' ? 'in_progress' : before.status;
        await client.query(
          `UPDATE crm.tickets SET responded_at = now(), status = $2, updated_by = $3,
           version = version + 1, updated_at = now() WHERE id = $1`,
          [id, nextStatus, auth.accountId],
        );
        await this.appendHistory(
          client,
          id,
          'response',
          nextStatus,
          normalized.note,
          auth.accountId,
        );
        const ticket = await this.loadTicket(client, id);
        await this.sideEffects(
          client,
          id,
          'crm.ticket.responded',
          ticket,
          auth,
          metadata,
          commandKey,
          before,
        );
        return ticket;
      },
    );
  }

  async transition(
    id: string,
    input: TransitionCrmTicketRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CrmTicket> {
    const normalized = {
      expectedVersion: version(input.expectedVersion),
      note: text(input.note, 2000),
      status: input.status,
    };
    return this.command(
      `crm.ticket.transition:${id}`,
      key,
      normalized,
      200,
      async (client, commandKey) => {
        const before = await this.lockTicket(client, id);
        assertVersion(before, normalized.expectedVersion);
        if (!allowedTransitions[before.status].includes(normalized.status))
          throw conflict(
            'CRM_TICKET_TRANSITION_INVALID',
            `The ticket cannot move from ${statusLabel(before.status)} to ${statusLabel(normalized.status)}.`,
          );
        await client.query(
          `UPDATE crm.tickets SET status = $2,
           resolved_at = CASE WHEN $2 IN ('resolved','closed') THEN COALESCE(resolved_at, now()) ELSE NULL END,
           updated_by = $3, version = version + 1, updated_at = now() WHERE id = $1`,
          [id, normalized.status, auth.accountId],
        );
        await this.appendHistory(
          client,
          id,
          'status_change',
          normalized.status,
          normalized.note,
          auth.accountId,
        );
        const ticket = await this.loadTicket(client, id);
        await this.sideEffects(
          client,
          id,
          'crm.ticket.status-changed',
          ticket,
          auth,
          metadata,
          commandKey,
          before,
        );
        return ticket;
      },
    );
  }

  async createServiceRequest(
    id: string,
    input: CreateServiceRequestFromCrmTicketRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CrmTicket> {
    const normalized = {
      expectedVersion: version(input.expectedVersion),
      serviceType: input.serviceType,
      ...(input.subscriptionContractId?.trim()
        ? { subscriptionContractId: input.subscriptionContractId.trim() }
        : {}),
    };
    if (normalized.serviceType === 'subscription' && !normalized.subscriptionContractId)
      throw badRequest(
        'CRM_SERVICE_SUBSCRIPTION_REQUIRED',
        'Choose the service subscription for this request.',
      );
    if (normalized.serviceType !== 'subscription' && normalized.subscriptionContractId)
      throw badRequest(
        'CRM_SERVICE_SUBSCRIPTION_NOT_ALLOWED',
        'A service subscription can only be used for subscription work.',
      );
    return this.command(
      `crm.ticket.service-request:${id}`,
      key,
      normalized,
      201,
      async (client, commandKey) => {
        const before = await this.lockTicket(client, id);
        assertVersion(before, normalized.expectedVersion);
        if (!before.customer_location_id || !before.customer_equipment_id)
          throw badRequest(
            'CRM_TICKET_SERVICE_DETAILS_REQUIRED',
            'Add a customer location and device before creating a Service request.',
          );
        const existing = await client.query(
          `SELECT ticket_id FROM crm.ticket_service_links WHERE ticket_id = $1`,
          [id],
        );
        if (existing.rowCount)
          throw conflict(
            'CRM_TICKET_SERVICE_ALREADY_LINKED',
            'This ticket already has a linked Service request.',
          );
        if (normalized.subscriptionContractId) {
          await this.requireSubscription(
            client,
            normalized.subscriptionContractId,
            before.customer_partner_id,
            before.customer_location_id,
            before.customer_equipment_id,
          );
        }
        const requestId = randomUUID();
        const requestNumber = await this.nextServiceNumber(client);
        await client.query(
          `INSERT INTO service.requests (
           id, request_number, customer_partner_id, customer_location_id,
           customer_equipment_id, subscription_contract_id, source_channel,
           service_type, priority, problem_description, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
          [
            requestId,
            requestNumber,
            before.customer_partner_id,
            before.customer_location_id,
            before.customer_equipment_id,
            normalized.subscriptionContractId ?? null,
            serviceSource(before.channel),
            normalized.serviceType,
            servicePriority(before.priority),
            `${before.subject}\n\n${before.description}`,
            auth.accountId,
          ],
        );
        const correlationId = randomUUID();
        await client.query(
          `INSERT INTO crm.ticket_service_links (
           ticket_id, service_request_id, correlation_id, created_by
         ) VALUES ($1,$2,$3,$4)`,
          [id, requestId, correlationId, auth.accountId],
        );
        await client.query(
          `UPDATE crm.tickets SET version = version + 1, updated_by = $2,
           updated_at = now() WHERE id = $1`,
          [id, auth.accountId],
        );
        await this.appendHistory(
          client,
          id,
          'service_link',
          before.status,
          `Linked Service request ${requestNumber}.`,
          auth.accountId,
        );
        const ticket = await this.loadTicket(client, id);
        await this.sideEffects(
          client,
          id,
          'crm.ticket.service-request-linked',
          ticket,
          auth,
          metadata,
          commandKey,
          before,
          correlationId,
        );
        return ticket;
      },
    );
  }

  async createFromServiceRequest(
    serviceRequestId: string,
    input: CreateCrmTicketFromServiceRequestRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CrmTicket> {
    const normalized = {
      ...(input.assignedToAccountId ? { assignedToAccountId: input.assignedToAccountId } : {}),
      categoryId: input.categoryId,
      priority: input.priority,
      slaPolicyId: input.slaPolicyId,
    };
    return this.command(
      `crm.ticket.from-service:${serviceRequestId}`,
      key,
      normalized,
      201,
      async (client, commandKey) => {
        const linked = await client.query<{ ticket_id: string }>(
          `SELECT ticket_id FROM crm.ticket_service_links WHERE service_request_id = $1`,
          [serviceRequestId],
        );
        if (linked.rows[0]) return this.loadTicket(client, linked.rows[0].ticket_id);
        const request = await client.query<{
          customer_equipment_id: string;
          customer_location_id: string;
          customer_partner_id: string;
          problem_description: string;
          request_number: string;
          source_channel: string;
          subscription_contract_id: string | null;
        }>(
          `SELECT request_number, customer_partner_id, customer_location_id,
                customer_equipment_id, subscription_contract_id, source_channel,
                problem_description
         FROM service.requests WHERE id = $1 FOR UPDATE`,
          [serviceRequestId],
        );
        const source = request.rows[0];
        if (!source)
          throw notFound('CRM_SERVICE_REQUEST_NOT_FOUND', 'The Service request was not found.');
        const createInput = normalizeCreate({
          ...normalized,
          channel: crmSource(source.source_channel),
          customerEquipmentId: source.customer_equipment_id,
          customerLocationId: source.customer_location_id,
          customerPartnerId: source.customer_partner_id,
          description: source.problem_description,
          ...(source.subscription_contract_id
            ? { serviceSubscriptionContractId: source.subscription_contract_id }
            : {}),
          subject: `Service request ${source.request_number}`,
        });
        const policy = await this.requireReferences(client, createInput);
        const id = randomUUID();
        const number = await this.nextNumber(client);
        await client.query(
          `INSERT INTO crm.tickets (
           id, ticket_number, customer_partner_id, customer_location_id,
           customer_equipment_id, service_subscription_contract_id, category_id,
           channel, priority, subject, description, assigned_to_account_id,
           sla_policy_id, sla_policy_name, sla_response_minutes,
           sla_resolution_minutes, sla_risk_threshold_percent,
           response_due_at, resolution_due_at, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
           now() + make_interval(mins => $15),
           now() + make_interval(mins => $16),$18,$18)`,
          [
            id,
            number,
            createInput.customerPartnerId,
            createInput.customerLocationId,
            createInput.customerEquipmentId,
            createInput.serviceSubscriptionContractId ?? null,
            createInput.categoryId,
            createInput.channel,
            createInput.priority,
            createInput.subject,
            createInput.description,
            createInput.assignedToAccountId ?? null,
            policy.id,
            policy.name,
            policy.response_minutes,
            policy.resolution_minutes,
            policy.risk_threshold_percent,
            auth.accountId,
          ],
        );
        const correlationId = randomUUID();
        await client.query(
          `INSERT INTO crm.ticket_service_links (ticket_id, service_request_id, correlation_id, created_by)
         VALUES ($1,$2,$3,$4)`,
          [id, serviceRequestId, correlationId, auth.accountId],
        );
        await this.appendHistory(
          client,
          id,
          'created',
          'new',
          `Created from Service request ${source.request_number}.`,
          auth.accountId,
        );
        await this.appendHistory(
          client,
          id,
          'service_link',
          'new',
          `Linked Service request ${source.request_number}.`,
          auth.accountId,
        );
        const ticket = await this.loadTicket(client, id);
        await this.sideEffects(
          client,
          id,
          'crm.ticket.created-from-service',
          ticket,
          auth,
          metadata,
          commandKey,
          undefined,
          correlationId,
        );
        return ticket;
      },
    );
  }

  async evaluateSla(context: BackgroundJobContext) {
    const asOf = jobTime(context.payload['asOf']);
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const tickets = await client.query<TicketRow>(
        `${ticketQuery()}
         WHERE ticket.status NOT IN ('resolved','closed','cancelled')
         ORDER BY ticket.id FOR UPDATE OF ticket`,
      );
      const notificationIds: string[] = [];
      for (const ticket of tickets.rows) {
        const policy = await client.query<{ escalation_account_id: string | null }>(
          `SELECT escalation_account_id FROM crm.sla_policies WHERE id = $1`,
          [ticket.sla_policy_id],
        );
        const fallbackRecipients = await this.slaFallbackRecipients(client);
        const primaryRecipients = ticket.assigned_to_account_id
          ? [ticket.assigned_to_account_id]
          : [ticket.created_by];
        const timers = [
          ...(ticket.responded_at
            ? []
            : [
                {
                  dueAt: ticket.response_due_at,
                  minutes: ticket.sla_response_minutes,
                  type: 'response' as const,
                },
              ]),
          {
            dueAt: ticket.resolution_due_at,
            minutes: ticket.sla_resolution_minutes,
            type: 'resolution' as const,
          },
        ];
        for (const timer of timers) {
          const dueAt = new Date(timer.dueAt);
          const atRiskAt = new Date(
            new Date(ticket.created_at).getTime() +
              (timer.minutes * 60_000 * (await this.riskThreshold(client, ticket.id))) / 100,
          );
          const eventType = asOf > dueAt ? 'breached' : asOf >= atRiskAt ? 'at_risk' : null;
          if (!eventType) continue;
          const recipients = new Set(primaryRecipients);
          if (eventType === 'breached') {
            const escalationId = policy.rows[0]?.escalation_account_id;
            if (escalationId) recipients.add(escalationId);
            else fallbackRecipients.forEach((recipient) => recipients.add(recipient));
          }
          for (const recipient of recipients) {
            const notificationId = randomUUID();
            const key = `crm.sla:${ticket.id}:${timer.type}:${eventType}:${recipient}`;
            const notification = await client.query<{ id: string }>(
              `INSERT INTO notifications.messages (
                 id, recipient_account_id, channel, template_key, template_version,
                 payload, idempotency_key
               ) VALUES ($1,$2,'in_system',$3,1,$4,$5)
               ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
              [
                notificationId,
                recipient,
                `crm.ticket.sla.${eventType}`,
                {
                  customerName: ticket.customer_name,
                  dueAt: dueAt.toISOString(),
                  subject: ticket.subject,
                  ticketId: ticket.id,
                  ticketNumber: ticket.ticket_number,
                  timerType: timer.type,
                },
                key,
              ],
            );
            if (!notification.rows[0]) continue;
            await client.query(
              `INSERT INTO crm.sla_events (
                 id, ticket_id, timer_type, event_type, recipient_account_id, notification_id
               ) VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (ticket_id, timer_type, event_type, recipient_account_id) DO NOTHING`,
              [randomUUID(), ticket.id, timer.type, eventType, recipient, notificationId],
            );
            notificationIds.push(notificationId);
          }
        }
      }
      await client.query('COMMIT');
      return {
        asOf: asOf.toISOString(),
        notificationCount: notificationIds.length,
        notificationIds,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async requireReferences(
    client: PoolClient,
    input: ReturnType<typeof normalizeCreate>,
  ): Promise<PolicyRow> {
    const category = await client.query(
      `SELECT id FROM crm.ticket_categories WHERE id = $1 AND active FOR KEY SHARE`,
      [input.categoryId],
    );
    if (!category.rowCount)
      throw badRequest('CRM_TICKET_CATEGORY_INVALID', 'Choose an active ticket category.');
    const customer = await client.query(
      `SELECT id FROM master_data.partners WHERE id = $1 AND active FOR KEY SHARE`,
      [input.customerPartnerId],
    );
    if (!customer.rowCount)
      throw badRequest('CRM_TICKET_CUSTOMER_INVALID', 'Choose an active customer.');
    if (input.customerLocationId) {
      const location = await client.query(
        `SELECT id FROM master_data.customer_locations WHERE id = $1 AND partner_id = $2 AND active FOR KEY SHARE`,
        [input.customerLocationId, input.customerPartnerId],
      );
      if (!location.rowCount)
        throw badRequest(
          'CRM_TICKET_LOCATION_INVALID',
          'Choose a location belonging to this customer.',
        );
    }
    if (input.customerEquipmentId) {
      const equipment = await client.query(
        `SELECT id FROM master_data.customer_equipment WHERE id = $1 AND customer_location_id = $2 AND active FOR KEY SHARE`,
        [input.customerEquipmentId, input.customerLocationId],
      );
      if (!equipment.rowCount)
        throw badRequest(
          'CRM_TICKET_EQUIPMENT_INVALID',
          'Choose an active device registered at this location.',
        );
    }
    if (input.serviceSubscriptionContractId) {
      if (!input.customerLocationId || !input.customerEquipmentId)
        throw badRequest(
          'CRM_TICKET_SUBSCRIPTION_DETAILS_REQUIRED',
          'Choose the covered location and device before selecting a service subscription.',
        );
      await this.requireSubscription(
        client,
        input.serviceSubscriptionContractId,
        input.customerPartnerId,
        input.customerLocationId,
        input.customerEquipmentId,
      );
    }
    if (input.assignedToAccountId) await this.requireAssignee(client, input.assignedToAccountId);
    const policy = await client.query<PolicyRow>(
      `SELECT id, name, customer_partner_id, service_subscription_contract_id, priority,
              response_minutes, resolution_minutes, risk_threshold_percent,
              escalation_account_id
       FROM crm.sla_policies
       WHERE id = $1 AND active
         AND (customer_partner_id IS NULL OR customer_partner_id = $2)
         AND (service_subscription_contract_id IS NULL OR service_subscription_contract_id = $3)
         AND (priority IS NULL OR priority = $4)
       FOR KEY SHARE`,
      [
        input.slaPolicyId,
        input.customerPartnerId,
        input.serviceSubscriptionContractId ?? null,
        input.priority,
      ],
    );
    if (!policy.rows[0])
      throw badRequest(
        'CRM_SLA_POLICY_INVALID',
        'Choose an SLA policy that applies to this customer, contract, and priority.',
      );
    return policy.rows[0];
  }

  private async requireSubscription(
    client: PoolClient,
    id: string,
    customerId: string,
    locationId: string,
    equipmentId: string,
  ) {
    const result = await client.query(
      `SELECT contract.id FROM sales.service_subscription_contracts contract
       JOIN sales.service_subscription_devices device ON device.contract_id = contract.id
       WHERE contract.id = $1 AND contract.customer_partner_id = $2
         AND contract.customer_location_id = $3 AND device.customer_equipment_id = $4
         AND contract.status = 'active' FOR KEY SHARE OF contract, device`,
      [id, customerId, locationId, equipmentId],
    );
    if (!result.rowCount)
      throw badRequest(
        'CRM_TICKET_SUBSCRIPTION_INVALID',
        'Choose an active service subscription covering this device.',
      );
  }

  private async requireAssignee(client: PoolClient, id: string) {
    const result = await client.query(
      `SELECT account.id FROM identity.user_accounts account
       WHERE account.id = $1 AND account.status = 'active' AND EXISTS (
         SELECT 1 FROM iam.account_roles assignment
         JOIN iam.role_permissions role_permission ON role_permission.role_id = assignment.role_id
         JOIN iam.permissions permission ON permission.id = role_permission.permission_id
         WHERE assignment.account_id = account.id AND permission.module IN ('crm','*')
           AND permission.action IN ('edit','*')
       ) FOR KEY SHARE OF account`,
      [id],
    );
    if (!result.rowCount)
      throw badRequest('CRM_TICKET_ASSIGNEE_INVALID', 'Choose an active CRM team member.');
  }

  private async loadTicket(queryable: Queryable, id: string): Promise<CrmTicket> {
    const result = await queryable.query<TicketRow>(`${ticketQuery()} WHERE ticket.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw notFound('CRM_TICKET_NOT_FOUND', 'The ticket was not found.');
    return this.mapTicket(queryable, row);
  }

  private async lockTicket(client: PoolClient, id: string): Promise<TicketRow> {
    const result = await client.query<TicketRow>(
      `${ticketQuery()} WHERE ticket.id = $1 FOR UPDATE OF ticket`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw notFound('CRM_TICKET_NOT_FOUND', 'The ticket was not found.');
    return row;
  }

  private async mapTicket(queryable: Queryable, row: TicketRow): Promise<CrmTicket> {
    const [history, link] = await Promise.all([
      queryable.query<{
        changed_at: Date | string;
        changed_by_name: string | null;
        event_type: CrmTicket['history'][number]['type'];
        id: string;
        note: string | null;
        status: CrmTicketStatus;
      }>(
        `SELECT history.id, history.event_type, history.status, history.note,
                history.changed_at, employee.display_name AS changed_by_name
         FROM crm.ticket_history history
         LEFT JOIN identity.user_accounts account ON account.id = history.changed_by
         LEFT JOIN identity.employees employee ON employee.id = account.employee_id
         WHERE history.ticket_id = $1 ORDER BY history.changed_at, history.id`,
        [row.id],
      ),
      queryable.query<{
        correlation_id: string;
        service_request_id: string;
        service_request_number: string;
      }>(
        `SELECT link.correlation_id, link.service_request_id,
                request.request_number AS service_request_number
         FROM crm.ticket_service_links link
         JOIN service.requests request ON request.id = link.service_request_id
         WHERE link.ticket_id = $1`,
        [row.id],
      ),
    ]);
    const now = new Date();
    return {
      ...(row.assigned_to_account_id && row.assignee_name
        ? { assignedTo: { displayName: row.assignee_name, id: row.assigned_to_account_id } }
        : {}),
      category: { code: row.category_code, id: row.category_id, name: row.category_name },
      channel: row.channel,
      createdAt: iso(row.created_at),
      ...(row.customer_equipment_id ? { customerEquipmentId: row.customer_equipment_id } : {}),
      ...(row.customer_location_id ? { customerLocationId: row.customer_location_id } : {}),
      customerName: row.customer_name,
      customerPartnerId: row.customer_partner_id,
      description: row.description,
      ...(row.equipment_name ? { equipmentName: row.equipment_name } : {}),
      history: history.rows.map((item) => ({
        changedAt: iso(item.changed_at),
        ...(item.changed_by_name ? { changedByName: item.changed_by_name } : {}),
        id: item.id,
        ...(item.note ? { note: item.note } : {}),
        status: item.status,
        type: item.event_type,
      })),
      id: row.id,
      ...(row.location_name ? { locationName: row.location_name } : {}),
      number: row.ticket_number,
      priority: row.priority,
      ...(row.responded_at ? { respondedAt: iso(row.responded_at) } : {}),
      responseDueAt: iso(row.response_due_at),
      responseState: timerState(
        now,
        row.created_at,
        row.response_due_at,
        row.responded_at,
        row.sla_response_minutes,
        await this.riskThreshold(queryable, row.id),
      ),
      resolutionDueAt: iso(row.resolution_due_at),
      resolutionState: timerState(
        now,
        row.created_at,
        row.resolution_due_at,
        row.resolved_at,
        row.sla_resolution_minutes,
        await this.riskThreshold(queryable, row.id),
      ),
      ...(row.resolved_at ? { resolvedAt: iso(row.resolved_at) } : {}),
      ...(link.rows[0]
        ? {
            serviceLink: {
              correlationId: link.rows[0].correlation_id,
              serviceRequestId: link.rows[0].service_request_id,
              serviceRequestNumber: link.rows[0].service_request_number,
            },
          }
        : {}),
      ...(row.service_subscription_contract_id
        ? { serviceSubscriptionContractId: row.service_subscription_contract_id }
        : {}),
      slaPolicy: {
        id: row.sla_policy_id,
        name: row.sla_policy_name,
        responseMinutes: row.sla_response_minutes,
        resolutionMinutes: row.sla_resolution_minutes,
      },
      status: row.status,
      subject: row.subject,
      updatedAt: iso(row.updated_at),
      version: row.version,
    };
  }

  private async riskThreshold(queryable: Queryable, id: string): Promise<number> {
    const result = await queryable.query<{ value: number }>(
      `SELECT sla_risk_threshold_percent AS value FROM crm.tickets WHERE id = $1`,
      [id],
    );
    return result.rows[0]?.value ?? 80;
  }

  private async slaFallbackRecipients(client: PoolClient): Promise<string[]> {
    const result = await client.query<{ id: string }>(
      `SELECT DISTINCT account.id FROM identity.user_accounts account
       JOIN iam.account_roles assignment ON assignment.account_id = account.id
       JOIN iam.role_permissions role_permission ON role_permission.role_id = assignment.role_id
       JOIN iam.permissions permission ON permission.id = role_permission.permission_id
       WHERE account.status = 'active' AND permission.module IN ('crm','*')
         AND permission.action IN ('edit','approve','*') ORDER BY account.id`,
    );
    return result.rows.map((row) => row.id);
  }

  private async nextNumber(client: PoolClient): Promise<string> {
    const year = await this.businessYear(client);
    await client.query(
      `INSERT INTO crm.internal_document_sequences (document_type) VALUES ('ticket') ON CONFLICT DO NOTHING`,
    );
    const result = await client.query<{ value: string }>(
      `UPDATE crm.internal_document_sequences SET next_value = next_value + 1,
         updated_at = now() WHERE document_type = 'ticket'
       RETURNING (next_value - 1)::text AS value`,
    );
    return `TKT-${year}-${(result.rows[0]?.value ?? '0').padStart(6, '0')}`;
  }

  private async nextServiceNumber(client: PoolClient): Promise<string> {
    const year = await this.businessYear(client);
    await client.query(
      `INSERT INTO service.internal_document_sequences (document_type) VALUES ('request') ON CONFLICT DO NOTHING`,
    );
    const result = await client.query<{ value: string }>(
      `UPDATE service.internal_document_sequences SET next_value = next_value + 1,
         updated_at = now() WHERE document_type = 'request'
       RETURNING (next_value - 1)::text AS value`,
    );
    return `SRV-${year}-${(result.rows[0]?.value ?? '0').padStart(6, '0')}`;
  }

  private async businessYear(client: PoolClient): Promise<string> {
    const result = await client.query<{ year: string }>(
      `SELECT to_char(now() AT TIME ZONE $1, 'YYYY') AS year`,
      [this.environment.BUSINESS_TIMEZONE],
    );
    return result.rows[0]?.year ?? String(new Date().getUTCFullYear());
  }

  private appendHistory(
    client: PoolClient,
    ticketId: string,
    type: CrmTicket['history'][number]['type'],
    status: CrmTicketStatus,
    note: string,
    actorId: string,
  ) {
    return client.query(
      `INSERT INTO crm.ticket_history (id, ticket_id, event_type, status, note, changed_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), ticketId, type, status, note, actorId],
    );
  }

  private async sideEffects(
    client: PoolClient,
    id: string,
    eventType: string,
    after: CrmTicket,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    commandKey: string,
    before?: TicketRow,
    correlationId = metadata.correlationId,
  ) {
    await client.query(
      `INSERT INTO integration.outbox_events (
         id, aggregate_type, aggregate_id, event_type, event_version,
         correlation_id, idempotency_key, payload
       ) VALUES ($1,'crm_ticket',$2,$3,1,$4,$5,$6)`,
      [randomUUID(), id, eventType, correlationId, `${eventType}:${commandKey}`, after],
    );
    await this.audit.append(
      {
        action: eventType,
        actorAccountId: auth.accountId,
        after: after as unknown as Record<string, unknown>,
        ...(before ? { before: before as unknown as Record<string, unknown> } : {}),
        correlationId,
        ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
        targetId: id,
        targetType: 'crm_ticket',
        ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
      },
      client,
    );
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
      const replay = await claim(client, scope, commandKey, requestHash);
      if (replay !== undefined) {
        await client.query('COMMIT');
        return replay as T;
      }
      const result = await action(client, commandKey);
      await client.query(
        `UPDATE platform.idempotency_keys SET status = 'completed', response_status = $3,
           response_body = $4 WHERE scope = $1 AND idempotency_key = $2`,
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
}

function ticketQuery(): string {
  return `SELECT ticket.id, ticket.ticket_number, ticket.customer_partner_id,
    ticket.customer_location_id, ticket.customer_equipment_id,
    ticket.service_subscription_contract_id, ticket.channel, ticket.priority,
    ticket.subject, ticket.description, ticket.status, ticket.assigned_to_account_id,
    ticket.sla_policy_id, ticket.sla_policy_name, ticket.sla_response_minutes,
    ticket.sla_resolution_minutes, ticket.response_due_at, ticket.resolution_due_at,
    ticket.responded_at, ticket.resolved_at, ticket.created_by, ticket.version,
    ticket.created_at, ticket.updated_at, category.id AS category_id,
    category.code AS category_code, category.name AS category_name,
    partner.display_name AS customer_name, location.name AS location_name,
    equipment.device_name AS equipment_name, employee.display_name AS assignee_name
   FROM crm.tickets ticket
   JOIN crm.ticket_categories category ON category.id = ticket.category_id
   JOIN master_data.partners partner ON partner.id = ticket.customer_partner_id
   LEFT JOIN master_data.customer_locations location ON location.id = ticket.customer_location_id
   LEFT JOIN master_data.customer_equipment equipment ON equipment.id = ticket.customer_equipment_id
   LEFT JOIN identity.user_accounts assignee ON assignee.id = ticket.assigned_to_account_id
   LEFT JOIN identity.employees employee ON employee.id = assignee.employee_id`;
}

const allowedTransitions: Record<CrmTicketStatus, CrmTicketStatus[]> = {
  cancelled: [],
  closed: [],
  in_progress: ['waiting_customer', 'resolved', 'cancelled'],
  new: ['in_progress', 'waiting_customer', 'resolved', 'cancelled'],
  resolved: ['in_progress', 'closed'],
  waiting_customer: ['in_progress', 'resolved', 'cancelled'],
};

function normalizeCreate(input: CreateCrmTicketRequest) {
  if (input.customerEquipmentId && !input.customerLocationId)
    throw badRequest('CRM_TICKET_LOCATION_REQUIRED', 'Choose the device location first.');
  return {
    ...(input.assignedToAccountId?.trim()
      ? { assignedToAccountId: input.assignedToAccountId.trim() }
      : {}),
    categoryId: input.categoryId,
    channel: input.channel,
    ...(input.customerEquipmentId?.trim()
      ? { customerEquipmentId: input.customerEquipmentId.trim() }
      : {}),
    ...(input.customerLocationId?.trim()
      ? { customerLocationId: input.customerLocationId.trim() }
      : {}),
    customerPartnerId: input.customerPartnerId,
    description: text(input.description, 4000),
    priority: input.priority,
    ...(input.serviceSubscriptionContractId?.trim()
      ? { serviceSubscriptionContractId: input.serviceSubscriptionContractId.trim() }
      : {}),
    slaPolicyId: input.slaPolicyId,
    subject: text(input.subject, 255),
  };
}

function mapPolicy(row: PolicyRow): CrmSlaPolicyReference {
  return {
    ...(row.customer_partner_id ? { customerPartnerId: row.customer_partner_id } : {}),
    id: row.id,
    name: row.name,
    ...(row.priority ? { priority: row.priority } : {}),
    responseMinutes: row.response_minutes,
    resolutionMinutes: row.resolution_minutes,
    ...(row.service_subscription_contract_id
      ? { serviceSubscriptionContractId: row.service_subscription_contract_id }
      : {}),
  };
}

function timerState(
  now: Date,
  createdAt: Date | string,
  dueAt: Date | string,
  completedAt: Date | string | null,
  minutes: number,
  threshold: number,
): CrmSlaTimerState {
  const due = new Date(dueAt);
  if (completedAt) return new Date(completedAt) <= due ? 'met' : 'breached';
  if (now > due) return 'breached';
  const risk = new Date(createdAt).getTime() + (minutes * 60_000 * threshold) / 100;
  return now.getTime() >= risk ? 'at_risk' : 'on_track';
}

function serviceSource(
  channel: CrmTicketChannel,
): 'customer_portal' | 'email' | 'on_site' | 'telephone' {
  if (channel === 'email') return 'email';
  if (channel === 'customer_portal') return 'customer_portal';
  if (channel === 'on_site') return 'on_site';
  return 'telephone';
}

function crmSource(channel: string): CrmTicketChannel {
  if (channel === 'email' || channel === 'customer_portal' || channel === 'on_site') return channel;
  return 'telephone';
}

function servicePriority(priority: CrmTicketPriority): 'critical' | 'high' | 'low' | 'normal' {
  return priority === 'urgent' ? 'critical' : priority;
}

function statusLabel(status: CrmTicketStatus): string {
  return status.replaceAll('_', ' ');
}

function assertVersion(row: TicketRow, expectedVersion: number) {
  if (row.version !== expectedVersion)
    throw conflict(
      'CRM_TICKET_VERSION_CONFLICT',
      'The ticket changed. Refresh it before continuing.',
    );
}

function version(value: number): number {
  if (!Number.isInteger(value) || value < 1)
    throw badRequest('CRM_TICKET_VERSION_INVALID', 'Refresh the ticket before continuing.');
  return value;
}

function text(value: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max)
    throw badRequest('CRM_TICKET_TEXT_INVALID', `Enter between 1 and ${max} characters.`);
  return normalized;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function jobTime(value: unknown): Date {
  if (typeof value !== 'string') return new Date();
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw badRequest('CRM_SLA_TIME_INVALID', 'The SLA evaluation time is invalid.');
  return date;
}

function validKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length > 255)
    throw badRequest('IDEMPOTENCY_KEY_REQUIRED', 'An idempotency key is required.');
  return key;
}

async function claim(
  client: PoolClient,
  scope: string,
  key: string,
  hash: string,
): Promise<unknown> {
  const inserted = await client.query(
    `INSERT INTO platform.idempotency_keys (
       scope, idempotency_key, request_hash, status, expires_at
     ) VALUES ($1,$2,$3,'processing',now() + INTERVAL '24 hours')
     ON CONFLICT DO NOTHING RETURNING idempotency_key`,
    [scope, key, hash],
  );
  if (inserted.rowCount) return undefined;
  const existing = await client.query<{
    request_hash: string;
    response_body: unknown;
    status: string;
  }>(
    `SELECT request_hash, response_body, status FROM platform.idempotency_keys
     WHERE scope = $1 AND idempotency_key = $2 FOR UPDATE`,
    [scope, key],
  );
  const row = existing.rows[0];
  if (!row || row.request_hash !== hash)
    throw conflict(
      'IDEMPOTENCY_KEY_REUSED',
      'This request key was already used for another change.',
    );
  if (row.status === 'completed') return row.response_body;
  throw conflict('IDEMPOTENCY_REQUEST_IN_PROGRESS', 'This change is already being processed.');
}

function badRequest(code: string, message: string) {
  return new ApiErrorException(code, message, HttpStatus.BAD_REQUEST);
}
function conflict(code: string, message: string) {
  return new ApiErrorException(code, message, HttpStatus.CONFLICT);
}
function notFound(code: string, message: string) {
  return new ApiErrorException(code, message, HttpStatus.NOT_FOUND);
}
