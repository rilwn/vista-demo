import { createHash } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  IntegrationDeliveryStatus,
  IntegrationDeliverySummary,
  IntegrationEventDetail,
  IntegrationEventPage,
  IntegrationEventStatus,
  IntegrationEventSummary,
  IntegrationEventTelemetry,
  ReplayIntegrationEventRequest,
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
import type { IntegrationEventListQueryDto } from './integration-operations.dto.js';
import { OutboxPublisherService } from './outbox-publisher.service.js';

interface EventRow {
  aggregate_id: string;
  aggregate_type: string;
  attempt_count: number;
  available_at: Date | string;
  completed_at: Date | string | null;
  correlation_id: string;
  dead_lettered_at: Date | string | null;
  event_type: string;
  id: string;
  last_error_code: string | null;
  occurred_at: Date | string;
  publication_attempt_count: number;
  published_at: Date | string | null;
  replay_count: number;
  sequence_number: string;
  status: IntegrationEventStatus;
}

interface DeliveryRow {
  attempt_count: number;
  completed_at: Date | string | null;
  consumer: string;
  cycle_attempt_count: number;
  dead_lettered_at: Date | string | null;
  failed_at: Date | string | null;
  last_error_code: string | null;
  replay_count: number;
  status: IntegrationDeliveryStatus;
}

interface IdempotencyRow {
  request_hash: string;
  response_body: unknown;
  status: string;
}

const eventSelect = `SELECT id, aggregate_type, aggregate_id, event_type,
  correlation_id, occurred_at, available_at, published_at, completed_at,
  dead_lettered_at, status, sequence_number::text, attempt_count,
  publication_attempt_count, replay_count, last_error_code
  FROM integration.outbox_events`;

@Injectable()
export class IntegrationOperationsService {
  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxPublisherService) private readonly publisher: OutboxPublisherService,
  ) {}

  async telemetry(): Promise<IntegrationEventTelemetry> {
    const result = await this.database.getPool().query<{
      completed: string;
      dead_letter: string;
      failed_deliveries: string;
      oldest_pending_at: Date | string | null;
      pending: string;
      published: string;
      publishing: string;
    }>(
      `SELECT
         count(*) FILTER (WHERE event.status = 'pending')::text AS pending,
         count(*) FILTER (WHERE event.status = 'publishing')::text AS publishing,
         count(*) FILTER (WHERE event.status = 'published')::text AS published,
         count(*) FILTER (WHERE event.status = 'completed')::text AS completed,
         count(*) FILTER (WHERE event.status = 'dead_letter')::text AS dead_letter,
         min(event.occurred_at) FILTER (
           WHERE event.status IN ('pending', 'publishing', 'published')
         ) AS oldest_pending_at,
         (SELECT count(*)::text FROM integration.outbox_deliveries
          WHERE status IN ('failed', 'dead_letter')) AS failed_deliveries
       FROM integration.outbox_events event`,
    );
    const row = required(result.rows[0], 'Integration telemetry query failed');
    return {
      completed: Number(row.completed),
      deadLetter: Number(row.dead_letter),
      failedDeliveries: Number(row.failed_deliveries),
      ...(row.oldest_pending_at ? { oldestPendingAt: iso(row.oldest_pending_at) } : {}),
      pending: Number(row.pending),
      published: Number(row.published),
      publishing: Number(row.publishing),
      timestamp: new Date().toISOString(),
    };
  }

  async list(query: IntegrationEventListQueryDto): Promise<IntegrationEventPage> {
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 25);
    const parameters: unknown[] = [];
    const predicates: string[] = [];
    if (query.status) {
      parameters.push(query.status);
      predicates.push(`status = $${parameters.length}`);
    }
    if (query.eventType) {
      parameters.push(query.eventType);
      predicates.push(`event_type = $${parameters.length}`);
    }
    const where = predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';
    const count = await this.database
      .getPool()
      .query<{ total: string }>(
        `SELECT count(*)::text AS total FROM integration.outbox_events ${where}`,
        parameters,
      );
    parameters.push(pageSize, (page - 1) * pageSize);
    const rows = await this.database.getPool().query<EventRow>(
      `${eventSelect} ${where}
       ORDER BY occurred_at DESC, id DESC
       LIMIT $${parameters.length - 1} OFFSET $${parameters.length}`,
      parameters,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return {
      items: rows.rows.map(mapEvent),
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }

  async detail(id: string): Promise<IntegrationEventDetail> {
    const [event, deliveries] = await Promise.all([
      this.database.getPool().query<EventRow>(`${eventSelect} WHERE id = $1`, [id]),
      this.database.getPool().query<DeliveryRow>(
        `SELECT consumer, status, attempt_count, cycle_attempt_count, replay_count,
           completed_at, failed_at, dead_lettered_at, last_error_code
         FROM integration.outbox_deliveries WHERE event_id = $1 ORDER BY consumer`,
        [id],
      ),
    ]);
    const row = event.rows[0];
    if (!row) {
      throw new ApiErrorException(
        'INTEGRATION_EVENT_NOT_FOUND',
        'The integration event was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return { ...mapEvent(row), deliveries: deliveries.rows.map(mapDelivery) };
  }

  async replay(
    id: string,
    input: ReplayIntegrationEventRequest,
    keyValue: string | undefined,
    actor: AuthenticationContext,
    metadata: RequestSecurityMetadata,
  ): Promise<IntegrationEventDetail> {
    const key = validIdempotencyKey(keyValue);
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ eventId: id, expectedReplayCount: input.expectedReplayCount }))
      .digest('hex');
    const scope = `integration.event.replay:${id}`;
    const client = await this.database.getPool().connect();
    let response: IntegrationEventDetail;
    try {
      await client.query('BEGIN');
      const claimed = await client.query(
        `INSERT INTO platform.idempotency_keys (
           scope, idempotency_key, request_hash, status, expires_at
         ) VALUES ($1, $2, $3, 'processing', now() + ($4::bigint * interval '1 second'))
         ON CONFLICT DO NOTHING RETURNING idempotency_key`,
        [scope, key, requestHash, this.environment.IDEMPOTENCY_TTL_SECONDS],
      );
      if (!claimed.rowCount) {
        const replay = await client.query<IdempotencyRow>(
          `SELECT request_hash, status, response_body FROM platform.idempotency_keys
           WHERE scope = $1 AND idempotency_key = $2 FOR UPDATE`,
          [scope, key],
        );
        const existing = replay.rows[0];
        if (!existing || existing.request_hash !== requestHash || existing.status !== 'completed') {
          throw new ApiErrorException(
            'IDEMPOTENCY_KEY_CONFLICT',
            'The idempotency key was already used for a different or incomplete request',
            HttpStatus.CONFLICT,
          );
        }
        await client.query('COMMIT');
        return existing.response_body as IntegrationEventDetail;
      }

      const locked = await client.query<EventRow>(`${eventSelect} WHERE id = $1 FOR UPDATE`, [id]);
      const event = locked.rows[0];
      if (!event) {
        throw new ApiErrorException(
          'INTEGRATION_EVENT_NOT_FOUND',
          'The integration event was not found',
          HttpStatus.NOT_FOUND,
        );
      }
      if (event.replay_count !== input.expectedReplayCount) {
        throw new ApiErrorException(
          'INTEGRATION_EVENT_VERSION_CONFLICT',
          'The event changed after it was opened. Refresh and try again.',
          HttpStatus.CONFLICT,
        );
      }
      const retryable = await client.query(
        `SELECT 1 FROM integration.outbox_deliveries
         WHERE event_id = $1 AND status IN ('failed', 'dead_letter') LIMIT 1`,
        [id],
      );
      if (event.status !== 'dead_letter' && !retryable.rowCount) {
        throw new ApiErrorException(
          'INTEGRATION_EVENT_NOT_RETRYABLE',
          'Only a failed event can be retried',
          HttpStatus.CONFLICT,
        );
      }

      await client.query(
        `UPDATE integration.outbox_events
         SET status = 'pending', available_at = now(), published_at = NULL,
             processing_started_at = NULL, completed_at = NULL, dead_lettered_at = NULL,
             publication_attempt_count = 0, replay_count = replay_count + 1,
             last_replayed_at = now(), last_error_code = NULL
         WHERE id = $1`,
        [id],
      );
      await client.query(
        `UPDATE integration.outbox_deliveries
         SET status = 'pending', cycle_attempt_count = 0, replay_count = replay_count + 1,
             processing_started_at = NULL, completed_at = NULL, failed_at = NULL,
             dead_lettered_at = NULL, last_error_code = NULL, result = NULL
         WHERE event_id = $1 AND status <> 'completed'`,
        [id],
      );
      await client.query(
        `UPDATE integration.inbox_receipts
         SET status = 'failed', cycle_attempt_count = 0, replay_count = replay_count + 1,
             processed_at = NULL, processing_started_at = NULL, failed_at = NULL,
             dead_lettered_at = NULL, last_error_code = NULL, result = NULL
         WHERE event_id = $1 AND status <> 'completed'`,
        [id],
      );
      await this.audit.append(
        {
          action: 'integration.event.replayed',
          actorAccountId: actor.accountId,
          after: { replayCount: event.replay_count + 1, status: 'pending' },
          before: { replayCount: event.replay_count, status: event.status },
          correlationId: metadata.correlationId,
          ...(metadata.sourceIp ? { sourceIp: metadata.sourceIp } : {}),
          targetId: id,
          targetType: 'integration_event',
          ...(metadata.userAgent ? { userAgent: metadata.userAgent } : {}),
        },
        client,
      );
      response = await detailInTransaction(client, id);
      await client.query(
        `UPDATE platform.idempotency_keys
         SET status = 'completed', response_status = 200, response_body = $3
         WHERE scope = $1 AND idempotency_key = $2`,
        [scope, key, response],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await this.publisher.publishAvailable().catch(() => undefined);
    return response;
  }
}

async function detailInTransaction(
  client: PoolClient,
  id: string,
): Promise<IntegrationEventDetail> {
  const [event, deliveries] = await Promise.all([
    client.query<EventRow>(`${eventSelect} WHERE id = $1`, [id]),
    client.query<DeliveryRow>(
      `SELECT consumer, status, attempt_count, cycle_attempt_count, replay_count,
         completed_at, failed_at, dead_lettered_at, last_error_code
       FROM integration.outbox_deliveries WHERE event_id = $1 ORDER BY consumer`,
      [id],
    ),
  ]);
  return {
    ...mapEvent(required(event.rows[0], 'Integration replay reconciliation failed')),
    deliveries: deliveries.rows.map(mapDelivery),
  };
}

function mapEvent(row: EventRow): IntegrationEventSummary {
  return {
    aggregateId: row.aggregate_id,
    aggregateType: row.aggregate_type,
    attemptCount: row.attempt_count,
    availableAt: iso(row.available_at),
    ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
    correlationId: row.correlation_id,
    ...(row.dead_lettered_at ? { deadLetteredAt: iso(row.dead_lettered_at) } : {}),
    eventType: row.event_type,
    id: row.id,
    ...(row.last_error_code ? { lastErrorCode: row.last_error_code } : {}),
    occurredAt: iso(row.occurred_at),
    publicationAttemptCount: row.publication_attempt_count,
    ...(row.published_at ? { publishedAt: iso(row.published_at) } : {}),
    replayCount: row.replay_count,
    sequenceNumber: row.sequence_number,
    status: row.status,
  };
}

function mapDelivery(row: DeliveryRow): IntegrationDeliverySummary {
  return {
    attemptCount: row.attempt_count,
    ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
    consumer: row.consumer,
    cycleAttemptCount: row.cycle_attempt_count,
    ...(row.dead_lettered_at ? { deadLetteredAt: iso(row.dead_lettered_at) } : {}),
    ...(row.failed_at ? { failedAt: iso(row.failed_at) } : {}),
    ...(row.last_error_code ? { lastErrorCode: row.last_error_code } : {}),
    replayCount: row.replay_count,
    status: row.status,
  };
}

function validIdempotencyKey(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9._:-]{8,128}$/u.test(value)) {
    throw new ApiErrorException(
      'IDEMPOTENCY_KEY_REQUIRED',
      'Provide an Idempotency-Key with 8 to 128 safe characters',
      HttpStatus.BAD_REQUEST,
    );
  }
  return value;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
