import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  CreateCrmInteractionRequest,
  CreateCrmTaskRequest,
  CrmInteraction,
  CrmInteractionType,
  CrmTask,
  CrmTaskPriority,
  CrmTaskStatus,
  CrmTimelineItem,
  CrmTimelinePage,
  CrmTimelineReferenceData,
  TransitionCrmTaskRequest,
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
import type { ListCrmTimelineQueryDto } from './crm-timeline.dto.js';

interface InteractionRow {
  contact_name: string | null;
  contact_person_id: string | null;
  created_at: Date | string;
  created_by_name: string;
  customer_location_id: string | null;
  customer_name: string;
  customer_partner_id: string;
  id: string;
  interaction_type: CrmInteractionType;
  location_name: string | null;
  notes: string;
  occurred_at: Date | string;
  subject: string;
}

interface TaskRow {
  assigned_to_account_id: string;
  assignee_name: string;
  cancelled_at: Date | string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  customer_location_id: string | null;
  customer_name: string;
  customer_partner_id: string;
  due_at: Date | string;
  id: string;
  location_name: string | null;
  notes: string | null;
  priority: CrmTaskPriority;
  reminder_at: Date | string | null;
  status: CrmTaskStatus;
  title: string;
  updated_at: Date | string;
  version: number;
}

interface TaskHistoryRow {
  changed_at: Date | string;
  changed_by_name: string;
  event_type: CrmTask['history'][number]['type'];
  id: string;
  note: string | null;
  status: CrmTaskStatus;
}

interface TimelineEventRow {
  event_id: string;
  kind: 'interaction' | 'task_event';
  occurred_at: Date | string;
  source_id: string;
}

type Queryable = Pool | PoolClient;

@Injectable()
export class CrmTimelineService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {}

  async referenceData(): Promise<CrmTimelineReferenceData> {
    const pool = this.database.getPool();
    const [customers, locations, contacts, assignees] = await Promise.all([
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
         WHERE location.active AND partner.active
         ORDER BY location.name, location.id`,
      ),
      pool.query<{ customer_partner_id: string; display_name: string; id: string }>(
        `SELECT contact.id, contact.partner_id AS customer_partner_id, contact.display_name
         FROM master_data.partner_contacts contact
         JOIN master_data.partners partner ON partner.id = contact.partner_id
         JOIN master_data.partner_roles role
           ON role.partner_id = partner.id AND role.role = 'customer'
         WHERE contact.active AND partner.active
         ORDER BY contact.display_name, contact.id`,
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
      contacts: contacts.rows.map((row) => ({
        customerPartnerId: row.customer_partner_id,
        displayName: row.display_name,
        id: row.id,
      })),
      customers: customers.rows,
      locations: locations.rows.map((row) => ({
        customerPartnerId: row.customer_partner_id,
        id: row.id,
        name: row.name,
      })),
    };
  }

  async list(query: ListCrmTimelineQueryDto): Promise<CrmTimelinePage> {
    validateDateRange(query.dateFrom, query.dateTo);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const parameters = [
      query.customerPartnerId,
      query.customerLocationId ?? null,
      query.dateFrom ?? null,
      query.dateTo ?? null,
    ];
    const pool = this.database.getPool();
    await this.requireCustomerLocation(pool, query.customerPartnerId, query.customerLocationId);
    const eventsSql = timelineEventsSql();
    const [count, events, interactionCount, openTaskRows, taskSummary] = await Promise.all([
      pool.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM (${eventsSql}) event`,
        parameters,
      ),
      pool.query<TimelineEventRow>(
        `SELECT * FROM (${eventsSql}) event
         ORDER BY occurred_at DESC, event_id DESC LIMIT $5 OFFSET $6`,
        [...parameters, pageSize, (page - 1) * pageSize],
      ),
      pool.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM crm.interactions interaction
         WHERE interaction.customer_partner_id = $1
           AND ($2::uuid IS NULL OR interaction.customer_location_id = $2)
           AND ($3::timestamptz IS NULL OR interaction.occurred_at >= $3)
           AND ($4::timestamptz IS NULL OR interaction.occurred_at <= $4)`,
        parameters,
      ),
      pool.query<TaskRow>(
        `${taskQuery()}
         WHERE task.customer_partner_id = $1
           AND ($2::uuid IS NULL OR task.customer_location_id = $2)
           AND task.status = 'open'
         ORDER BY task.due_at, task.id LIMIT 100`,
        parameters.slice(0, 2),
      ),
      pool.query<{ open_tasks: string; overdue_tasks: string }>(
        `SELECT count(*) FILTER (WHERE status = 'open')::text AS open_tasks,
                count(*) FILTER (WHERE status = 'open' AND due_at < now())::text AS overdue_tasks
         FROM crm.tasks task
         WHERE task.customer_partner_id = $1
           AND ($2::uuid IS NULL OR task.customer_location_id = $2)`,
        parameters.slice(0, 2),
      ),
    ]);

    const taskCache = new Map<string, CrmTask>();
    const items: CrmTimelineItem[] = [];
    for (const event of events.rows) {
      if (event.kind === 'interaction') {
        const interaction = await this.loadInteraction(pool, event.source_id);
        items.push({ interaction, kind: 'interaction', occurredAt: iso(event.occurred_at) });
        continue;
      }
      let task = taskCache.get(event.source_id);
      if (!task) {
        task = await this.loadTask(pool, event.source_id);
        taskCache.set(event.source_id, task);
      }
      const taskEvent = task.history.find((entry) => entry.id === event.event_id);
      if (taskEvent)
        items.push({ kind: 'task_event', occurredAt: iso(event.occurred_at), task, taskEvent });
    }
    const openTasks = await Promise.all(openTaskRows.rows.map((row) => this.mapTask(pool, row)));
    const total = Number(count.rows[0]?.total ?? '0');
    return {
      items,
      openTasks,
      page,
      pageSize,
      summary: {
        interactions: Number(interactionCount.rows[0]?.total ?? '0'),
        openTasks: Number(taskSummary.rows[0]?.open_tasks ?? '0'),
        overdueTasks: Number(taskSummary.rows[0]?.overdue_tasks ?? '0'),
      },
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }

  createInteraction(
    input: CreateCrmInteractionRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CrmInteraction> {
    const normalized = normalizeInteraction(input);
    return this.command(
      'crm.interaction.create',
      key,
      normalized,
      201,
      async (client, commandKey) => {
        await this.requireCustomerLocation(
          client,
          normalized.customerPartnerId,
          normalized.customerLocationId,
        );
        if (normalized.contactPersonId)
          await this.requireContact(
            client,
            normalized.customerPartnerId,
            normalized.contactPersonId,
          );
        const id = randomUUID();
        await client.query(
          `INSERT INTO crm.interactions (
             id, customer_partner_id, customer_location_id, contact_person_id,
             interaction_type, subject, notes, occurred_at, created_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id,
            normalized.customerPartnerId,
            normalized.customerLocationId ?? null,
            normalized.contactPersonId ?? null,
            normalized.interactionType,
            normalized.subject,
            normalized.notes,
            normalized.occurredAt,
            auth.accountId,
          ],
        );
        const interaction = await this.loadInteraction(client, id);
        await this.sideEffects(
          client,
          'crm_interaction',
          id,
          'crm.interaction.created',
          interaction,
          commandKey,
          auth,
          metadata,
        );
        return interaction;
      },
    );
  }

  createTask(
    input: CreateCrmTaskRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CrmTask> {
    const normalized = normalizeTask(input);
    return this.command('crm.task.create', key, normalized, 201, async (client, commandKey) => {
      await this.requireCustomerLocation(
        client,
        normalized.customerPartnerId,
        normalized.customerLocationId,
      );
      await this.requireAssignee(client, normalized.assignedToAccountId);
      const id = randomUUID();
      await client.query(
        `INSERT INTO crm.tasks (
           id, customer_partner_id, customer_location_id, title, notes, priority,
           assigned_to_account_id, due_at, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
        [
          id,
          normalized.customerPartnerId,
          normalized.customerLocationId ?? null,
          normalized.title,
          normalized.notes ?? null,
          normalized.priority,
          normalized.assignedToAccountId,
          normalized.dueAt,
          auth.accountId,
        ],
      );
      await client.query(
        `INSERT INTO crm.task_history (id, task_id, event_type, status, note, changed_by)
         VALUES ($1,$2,'created','open',$3,$4)`,
        [randomUUID(), id, normalized.notes ?? null, auth.accountId],
      );
      if (normalized.reminderAt) {
        const notificationId = randomUUID();
        const reminderId = randomUUID();
        await client.query(
          `INSERT INTO notifications.messages (
             id, recipient_account_id, channel, template_key, template_version,
             payload, idempotency_key, available_at
           ) VALUES ($1,$2,'in_system','crm.task.reminder',1,$3,$4,$5)`,
          [
            notificationId,
            normalized.assignedToAccountId,
            {
              customerName: await this.customerName(client, normalized.customerPartnerId),
              dueAt: normalized.dueAt,
              taskId: id,
              title: normalized.title,
            },
            `crm.task.reminder:${id}:${normalized.assignedToAccountId}:${normalized.reminderAt}`,
            normalized.reminderAt,
          ],
        );
        await client.query(
          `INSERT INTO crm.task_reminders (
             id, task_id, recipient_account_id, remind_at, notification_id
           ) VALUES ($1,$2,$3,$4,$5)`,
          [reminderId, id, normalized.assignedToAccountId, normalized.reminderAt, notificationId],
        );
      }
      const task = await this.loadTask(client, id);
      await this.sideEffects(
        client,
        'crm_task',
        id,
        'crm.task.created',
        task,
        commandKey,
        auth,
        metadata,
      );
      return task;
    });
  }

  transitionTask(
    id: string,
    input: TransitionCrmTaskRequest,
    key: string | undefined,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<CrmTask> {
    const normalized = normalizeTransition(input);
    return this.command(
      `crm.task.transition:${id}`,
      key,
      normalized,
      200,
      async (client, commandKey) => {
        const before = await this.lockTask(client, id);
        if (before.version !== normalized.expectedVersion)
          throw conflict(
            'CRM_TASK_VERSION_CONFLICT',
            'This task changed. Refresh it before continuing.',
          );
        if (before.status !== 'open')
          throw conflict('CRM_TASK_ALREADY_CLOSED', 'This task is already closed.');
        const completedAt = normalized.status === 'completed' ? new Date().toISOString() : null;
        const cancelledAt = normalized.status === 'cancelled' ? new Date().toISOString() : null;
        await client.query(
          `UPDATE crm.tasks SET status = $2, completed_at = $3, cancelled_at = $4,
             updated_by = $5, updated_at = now(), version = version + 1 WHERE id = $1`,
          [id, normalized.status, completedAt, cancelledAt, auth.accountId],
        );
        await client.query(
          `INSERT INTO crm.task_history (id, task_id, event_type, status, note, changed_by)
           VALUES ($1,$2,$3,$3,$4,$5)`,
          [randomUUID(), id, normalized.status, normalized.note ?? null, auth.accountId],
        );
        await client.query(
          `UPDATE notifications.messages message
           SET status = 'cancelled'
           FROM crm.task_reminders reminder
           WHERE reminder.task_id = $1 AND reminder.notification_id = message.id
             AND message.status IN ('pending','failed')`,
          [id],
        );
        await client.query(
          `UPDATE crm.task_reminders SET cancelled_at = now()
           WHERE task_id = $1 AND cancelled_at IS NULL
             AND EXISTS (
               SELECT 1 FROM notifications.messages message
               WHERE message.id = notification_id AND message.status = 'cancelled'
             )`,
          [id],
        );
        const task = await this.loadTask(client, id);
        await this.sideEffects(
          client,
          'crm_task',
          id,
          `crm.task.${normalized.status}`,
          task,
          commandKey,
          auth,
          metadata,
          mapTaskBase(before),
        );
        return task;
      },
    );
  }

  private async requireCustomerLocation(
    queryable: Queryable,
    customerPartnerId: string,
    customerLocationId?: string,
  ) {
    const customer = await queryable.query(
      `SELECT partner.id FROM master_data.partners partner
       JOIN master_data.partner_roles role
         ON role.partner_id = partner.id AND role.role = 'customer'
       WHERE partner.id = $1 AND partner.active`,
      [customerPartnerId],
    );
    if (!customer.rowCount)
      throw badRequest('CRM_TIMELINE_CUSTOMER_INVALID', 'Choose an active customer.');
    if (!customerLocationId) return;
    const location = await queryable.query(
      `SELECT id FROM master_data.customer_locations
       WHERE id = $1 AND partner_id = $2 AND active`,
      [customerLocationId, customerPartnerId],
    );
    if (!location.rowCount)
      throw badRequest(
        'CRM_TIMELINE_LOCATION_INVALID',
        'Choose an active location belonging to this customer.',
      );
  }

  private async requireContact(queryable: Queryable, customerId: string, contactId: string) {
    const contact = await queryable.query(
      `SELECT id FROM master_data.partner_contacts
       WHERE id = $1 AND partner_id = $2 AND active`,
      [contactId, customerId],
    );
    if (!contact.rowCount)
      throw badRequest(
        'CRM_INTERACTION_CONTACT_INVALID',
        'Choose an active contact belonging to this customer.',
      );
  }

  private async requireAssignee(queryable: Queryable, accountId: string) {
    const assignee = await queryable.query(
      `SELECT account.id FROM identity.user_accounts account
       WHERE account.id = $1 AND account.status = 'active' AND EXISTS (
         SELECT 1 FROM iam.account_roles assignment
         JOIN iam.role_permissions role_permission ON role_permission.role_id = assignment.role_id
         JOIN iam.permissions permission ON permission.id = role_permission.permission_id
         WHERE assignment.account_id = account.id AND permission.module IN ('crm','*')
           AND permission.action IN ('edit','*')
       )`,
      [accountId],
    );
    if (!assignee.rowCount)
      throw badRequest('CRM_TASK_ASSIGNEE_INVALID', 'Choose an active CRM team member.');
  }

  private async customerName(queryable: Queryable, id: string): Promise<string> {
    const result = await queryable.query<{ display_name: string }>(
      'SELECT display_name FROM master_data.partners WHERE id = $1',
      [id],
    );
    return result.rows[0]?.display_name ?? 'Customer';
  }

  private async loadInteraction(queryable: Queryable, id: string): Promise<CrmInteraction> {
    const result = await queryable.query<InteractionRow>(
      `${interactionQuery()} WHERE interaction.id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw notFound('CRM_INTERACTION_NOT_FOUND', 'The interaction was not found.');
    return mapInteraction(row);
  }

  private async loadTask(queryable: Queryable, id: string): Promise<CrmTask> {
    const result = await queryable.query<TaskRow>(`${taskQuery()} WHERE task.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw notFound('CRM_TASK_NOT_FOUND', 'The task was not found.');
    return this.mapTask(queryable, row);
  }

  private async lockTask(client: PoolClient, id: string): Promise<TaskRow> {
    const result = await client.query<TaskRow>(
      `${taskQuery()} WHERE task.id = $1 FOR UPDATE OF task`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw notFound('CRM_TASK_NOT_FOUND', 'The task was not found.');
    return row;
  }

  private async mapTask(queryable: Queryable, row: TaskRow): Promise<CrmTask> {
    const history = await queryable.query<TaskHistoryRow>(
      `SELECT history.id, history.event_type, history.status, history.note,
              history.changed_at, employee.display_name AS changed_by_name
       FROM crm.task_history history
       JOIN identity.user_accounts account ON account.id = history.changed_by
       JOIN identity.employees employee ON employee.id = account.employee_id
       WHERE history.task_id = $1 ORDER BY history.changed_at, history.id`,
      [row.id],
    );
    return {
      assignedTo: { displayName: row.assignee_name, id: row.assigned_to_account_id },
      ...(row.cancelled_at ? { cancelledAt: iso(row.cancelled_at) } : {}),
      ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
      createdAt: iso(row.created_at),
      ...(row.customer_location_id ? { customerLocationId: row.customer_location_id } : {}),
      customerName: row.customer_name,
      customerPartnerId: row.customer_partner_id,
      dueAt: iso(row.due_at),
      history: history.rows.map((entry) => ({
        changedAt: iso(entry.changed_at),
        changedByName: entry.changed_by_name,
        id: entry.id,
        ...(entry.note ? { note: entry.note } : {}),
        status: entry.status,
        type: entry.event_type,
      })),
      id: row.id,
      ...(row.location_name ? { locationName: row.location_name } : {}),
      ...(row.notes ? { notes: row.notes } : {}),
      priority: row.priority,
      ...(row.reminder_at ? { reminderAt: iso(row.reminder_at) } : {}),
      status: row.status,
      title: row.title,
      updatedAt: iso(row.updated_at),
      version: row.version,
    };
  }

  private async sideEffects(
    client: PoolClient,
    targetType: 'crm_interaction' | 'crm_task',
    targetId: string,
    eventType: string,
    after: CrmInteraction | CrmTask,
    commandKey: string,
    auth: AuthenticationContext,
    metadata: RequestSecurityMetadata,
    before?: Record<string, unknown>,
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
        `${eventType}:${commandKey}`,
        after,
      ],
    );
    await this.audit.append(
      {
        action: eventType,
        actorAccountId: auth.accountId,
        after: after as unknown as Record<string, unknown>,
        ...(before ? { before } : {}),
        correlationId: metadata.correlationId,
        ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
        targetId,
        targetType,
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

function interactionQuery(): string {
  return `SELECT interaction.id, interaction.customer_partner_id,
    interaction.customer_location_id, interaction.contact_person_id,
    interaction.interaction_type, interaction.subject, interaction.notes,
    interaction.occurred_at, interaction.created_at,
    partner.display_name AS customer_name, location.name AS location_name,
    contact.display_name AS contact_name, employee.display_name AS created_by_name
  FROM crm.interactions interaction
  JOIN master_data.partners partner ON partner.id = interaction.customer_partner_id
  LEFT JOIN master_data.customer_locations location ON location.id = interaction.customer_location_id
  LEFT JOIN master_data.partner_contacts contact ON contact.id = interaction.contact_person_id
  JOIN identity.user_accounts account ON account.id = interaction.created_by
  JOIN identity.employees employee ON employee.id = account.employee_id`;
}

function taskQuery(): string {
  return `SELECT task.id, task.customer_partner_id, task.customer_location_id,
    task.title, task.notes, task.priority, task.status, task.assigned_to_account_id,
    task.due_at, task.completed_at, task.cancelled_at, task.version,
    task.created_at, task.updated_at, partner.display_name AS customer_name,
    location.name AS location_name, employee.display_name AS assignee_name,
    reminder.remind_at AS reminder_at
  FROM crm.tasks task
  JOIN master_data.partners partner ON partner.id = task.customer_partner_id
  LEFT JOIN master_data.customer_locations location ON location.id = task.customer_location_id
  JOIN identity.user_accounts assignee ON assignee.id = task.assigned_to_account_id
  JOIN identity.employees employee ON employee.id = assignee.employee_id
  LEFT JOIN LATERAL (
    SELECT min(task_reminder.remind_at) AS remind_at
    FROM crm.task_reminders task_reminder
    WHERE task_reminder.task_id = task.id
  ) reminder ON true`;
}

function timelineEventsSql(): string {
  return `SELECT 'interaction'::text AS kind, interaction.id AS source_id,
      interaction.id AS event_id, interaction.occurred_at
    FROM crm.interactions interaction
    WHERE interaction.customer_partner_id = $1
      AND ($2::uuid IS NULL OR interaction.customer_location_id = $2)
      AND ($3::timestamptz IS NULL OR interaction.occurred_at >= $3)
      AND ($4::timestamptz IS NULL OR interaction.occurred_at <= $4)
    UNION ALL
    SELECT 'task_event'::text AS kind, task.id AS source_id,
      history.id AS event_id, history.changed_at AS occurred_at
    FROM crm.task_history history
    JOIN crm.tasks task ON task.id = history.task_id
    WHERE task.customer_partner_id = $1
      AND ($2::uuid IS NULL OR task.customer_location_id = $2)
      AND ($3::timestamptz IS NULL OR history.changed_at >= $3)
      AND ($4::timestamptz IS NULL OR history.changed_at <= $4)`;
}

function mapInteraction(row: InteractionRow): CrmInteraction {
  return {
    ...(row.contact_name ? { contactName: row.contact_name } : {}),
    ...(row.contact_person_id ? { contactPersonId: row.contact_person_id } : {}),
    createdAt: iso(row.created_at),
    createdByName: row.created_by_name,
    ...(row.customer_location_id ? { customerLocationId: row.customer_location_id } : {}),
    customerName: row.customer_name,
    customerPartnerId: row.customer_partner_id,
    id: row.id,
    interactionType: row.interaction_type,
    ...(row.location_name ? { locationName: row.location_name } : {}),
    notes: row.notes,
    occurredAt: iso(row.occurred_at),
    subject: row.subject,
  };
}

function mapTaskBase(row: TaskRow): Record<string, unknown> {
  return {
    assignedToAccountId: row.assigned_to_account_id,
    dueAt: iso(row.due_at),
    id: row.id,
    priority: row.priority,
    status: row.status,
    title: row.title,
    version: row.version,
  };
}

function normalizeInteraction(input: CreateCrmInteractionRequest) {
  const occurredAt = dateTime(input.occurredAt, 'CRM_INTERACTION_TIME_INVALID');
  if (occurredAt.getTime() > Date.now() + 5 * 60_000)
    throw badRequest(
      'CRM_INTERACTION_TIME_IN_FUTURE',
      'Choose the time when the interaction happened.',
    );
  return {
    ...(input.contactPersonId?.trim() ? { contactPersonId: input.contactPersonId.trim() } : {}),
    ...(input.customerLocationId?.trim()
      ? { customerLocationId: input.customerLocationId.trim() }
      : {}),
    customerPartnerId: input.customerPartnerId.trim(),
    interactionType: input.interactionType,
    notes: text(input.notes, 4000),
    occurredAt: occurredAt.toISOString(),
    subject: text(input.subject, 255),
  };
}

function normalizeTask(input: CreateCrmTaskRequest) {
  const dueAt = dateTime(input.dueAt, 'CRM_TASK_DUE_TIME_INVALID');
  if (dueAt.getTime() <= Date.now())
    throw badRequest('CRM_TASK_DUE_TIME_PAST', 'Choose a due time in the future.');
  const reminderAt = input.reminderAt
    ? dateTime(input.reminderAt, 'CRM_TASK_REMINDER_TIME_INVALID')
    : undefined;
  if (reminderAt && reminderAt > dueAt)
    throw badRequest(
      'CRM_TASK_REMINDER_AFTER_DUE',
      'Choose a reminder time before the task is due.',
    );
  return {
    assignedToAccountId: input.assignedToAccountId.trim(),
    ...(input.customerLocationId?.trim()
      ? { customerLocationId: input.customerLocationId.trim() }
      : {}),
    customerPartnerId: input.customerPartnerId.trim(),
    dueAt: dueAt.toISOString(),
    ...(input.notes?.trim() ? { notes: text(input.notes, 4000) } : {}),
    priority: input.priority,
    ...(reminderAt ? { reminderAt: reminderAt.toISOString() } : {}),
    title: text(input.title, 255),
  };
}

function normalizeTransition(input: TransitionCrmTaskRequest) {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)
    throw badRequest('CRM_TASK_VERSION_INVALID', 'Refresh the task before continuing.');
  return {
    expectedVersion: input.expectedVersion,
    ...(input.note?.trim() ? { note: text(input.note, 2000) } : {}),
    status: input.status,
  };
}

function validateDateRange(from?: string, to?: string) {
  if (!from || !to) return;
  if (new Date(from) > new Date(to))
    throw badRequest('CRM_TIMELINE_DATE_RANGE_INVALID', 'The end date must follow the start date.');
}

function dateTime(value: string, code: string): Date {
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) throw badRequest(code, 'Enter a valid date and time.');
  return result;
}

function text(value: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max)
    throw badRequest('CRM_TIMELINE_TEXT_INVALID', `Enter between 1 and ${max} characters.`);
  return normalized;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
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
