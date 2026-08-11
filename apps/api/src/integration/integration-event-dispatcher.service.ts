import { createHash } from 'node:crypto';

import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';

import { DatabaseService } from '../database/database.service.js';
import {
  type BackgroundJobContext,
  JobHandlerRegistry,
} from '../jobs/job-handler-registry.service.js';
import { StructuredLogger } from '../logging/structured-logger.service.js';
import {
  type IntegrationEventConsumerBinding,
  type IntegrationEventEnvelope,
  IntegrationEventConsumerRegistry,
} from './integration-event-consumer.registry.js';

export const integrationEventJobName = 'integration.event.consume';

interface EventRow {
  aggregate_id: string;
  aggregate_type: string;
  correlation_id: string;
  event_type: string;
  event_version: number;
  id: string;
  occurred_at: Date | string;
  payload: Record<string, unknown>;
  sequence_number: string;
}

@Injectable()
export class IntegrationEventDispatcherService implements OnModuleInit {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(IntegrationEventConsumerRegistry)
    private readonly consumers: IntegrationEventConsumerRegistry,
    @Inject(JobHandlerRegistry) private readonly handlers: JobHandlerRegistry,
    @Inject(StructuredLogger) private readonly logger: StructuredLogger,
  ) {}

  onModuleInit(): void {
    this.handlers.register(integrationEventJobName, {
      handle: (context) => this.handleJob(context),
    });
  }

  async dispatch(eventId: string, retryAllowed: boolean): Promise<void> {
    const event = await this.loadEvent(eventId);
    const deliveries = await this.database.getPool().query<{ consumer: string }>(
      `SELECT consumer FROM integration.outbox_deliveries
       WHERE event_id = $1 ORDER BY consumer`,
      [eventId],
    );
    if (deliveries.rowCount === 0) {
      await this.markEventDead(eventId, 'INTEGRATION_CONSUMER_REQUIRED');
      throw new UnrecoverableError('Published integration event has no consumer delivery');
    }

    for (const delivery of deliveries.rows) {
      const binding = this.consumers.binding(event.eventType, delivery.consumer);
      if (!binding) {
        await this.recordFailure(
          event,
          delivery.consumer,
          payloadHash(event.payload),
          'INTEGRATION_CONSUMER_NOT_REGISTERED',
          true,
        );
        throw new UnrecoverableError('Integration consumer is not registered');
      }
      await this.consume(event, binding, retryAllowed);
    }

    await this.database.getPool().query(
      `UPDATE integration.outbox_events event
       SET status = 'completed', completed_at = COALESCE(completed_at, now()),
           processing_started_at = NULL, dead_lettered_at = NULL, last_error_code = NULL
       WHERE event.id = $1
         AND NOT EXISTS (
           SELECT 1 FROM integration.outbox_deliveries delivery
           WHERE delivery.event_id = event.id AND delivery.status <> 'completed'
         )`,
      [eventId],
    );
    this.logger.event('info', 'integration.event.completed', {
      eventId,
      eventType: event.eventType,
    });
  }

  private async handleJob(context: BackgroundJobContext): Promise<void> {
    const eventId = context.payload['eventId'];
    if (typeof eventId !== 'string' || !uuid(eventId)) {
      throw new UnrecoverableError('Integration event job requires an event identifier');
    }
    await this.dispatch(eventId, context.retryAllowed);
  }

  private async consume(
    event: IntegrationEventEnvelope,
    binding: IntegrationEventConsumerBinding,
    retryAllowed: boolean,
  ): Promise<void> {
    const hash = payloadHash(event.payload);
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('integration.consume:' || $1 || ':' || $2 || ':' || $3))",
        [binding.consumer, event.aggregateType, event.aggregateId],
      );
      const receipt = await client.query<{ payload_hash: string; status: string }>(
        `SELECT payload_hash, status FROM integration.inbox_receipts
         WHERE consumer = $1 AND message_id = $2 FOR UPDATE`,
        [binding.consumer, event.id],
      );
      const existing = receipt.rows[0];
      if (existing?.payload_hash !== undefined && existing.payload_hash !== hash) {
        throw new UnrecoverableError('Integration message replay payload does not match');
      }
      if (existing?.status === 'completed') {
        await client.query(
          `UPDATE integration.outbox_deliveries
           SET status = 'completed', completed_at = COALESCE(completed_at, now()),
               processing_started_at = NULL, failed_at = NULL, dead_lettered_at = NULL,
               last_error_code = NULL
           WHERE event_id = $1 AND consumer = $2`,
          [event.id, binding.consumer],
        );
        await client.query('COMMIT');
        return;
      }

      const earlier = await client.query(
        `SELECT 1
         FROM integration.outbox_deliveries delivery
         JOIN integration.outbox_events prior ON prior.id = delivery.event_id
         WHERE delivery.consumer = $1
           AND prior.aggregate_type = $2 AND prior.aggregate_id = $3
           AND prior.event_type = $4 AND prior.sequence_number < $5
           AND delivery.status <> 'completed'
         LIMIT 1`,
        [
          binding.consumer,
          event.aggregateType,
          event.aggregateId,
          event.eventType,
          event.sequenceNumber,
        ],
      );
      if (earlier.rowCount) throw new Error('INTEGRATION_EVENT_ORDER_BLOCKED');

      await client.query(
        `UPDATE integration.outbox_deliveries
         SET status = 'processing', processing_started_at = now(),
             failed_at = NULL, dead_lettered_at = NULL, last_error_code = NULL
         WHERE event_id = $1 AND consumer = $2`,
        [event.id, binding.consumer],
      );
      await client.query(
        `INSERT INTO integration.inbox_receipts (
           consumer, message_id, event_id, payload_hash, status,
           attempt_count, cycle_attempt_count, processing_started_at
         ) VALUES ($1, $2::text, $2::uuid, $3, 'processing', 0, 0, now())
         ON CONFLICT (consumer, message_id) DO UPDATE
         SET status = 'processing', processing_started_at = now(),
             failed_at = NULL, dead_lettered_at = NULL, last_error_code = NULL`,
        [binding.consumer, event.id, hash],
      );
      const result = await binding.handle(event, client);
      await client.query(
        `UPDATE integration.inbox_receipts
         SET status = 'completed', processed_at = now(), processing_started_at = NULL,
             attempt_count = attempt_count + 1, cycle_attempt_count = cycle_attempt_count + 1,
             result = $3, failed_at = NULL, dead_lettered_at = NULL, last_error_code = NULL
         WHERE consumer = $1 AND message_id = $2`,
        [binding.consumer, event.id, result ?? null],
      );
      await client.query(
        `UPDATE integration.outbox_deliveries
         SET status = 'completed', completed_at = now(), processing_started_at = NULL,
             attempt_count = attempt_count + 1, cycle_attempt_count = cycle_attempt_count + 1,
             result = $3, failed_at = NULL, dead_lettered_at = NULL, last_error_code = NULL
         WHERE event_id = $1 AND consumer = $2`,
        [event.id, binding.consumer, result ?? null],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      const terminal = error instanceof UnrecoverableError || !retryAllowed;
      const errorCode = safeErrorCode(error);
      await this.recordFailure(event, binding.consumer, hash, errorCode, terminal);
      if (terminal) {
        throw error instanceof UnrecoverableError
          ? error
          : new UnrecoverableError('Integration event reached its final delivery attempt');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async recordFailure(
    event: IntegrationEventEnvelope,
    consumer: string,
    hash: string,
    errorCode: string,
    terminal: boolean,
  ): Promise<void> {
    const status = terminal ? 'dead_letter' : 'failed';
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE integration.outbox_deliveries
         SET status = $3::varchar, processing_started_at = NULL, failed_at = now(),
             dead_lettered_at = CASE WHEN $3::varchar = 'dead_letter' THEN now() ELSE NULL END,
             attempt_count = attempt_count + 1, cycle_attempt_count = cycle_attempt_count + 1,
             last_error_code = $4::varchar
         WHERE event_id = $1 AND consumer = $2`,
        [event.id, consumer, status, errorCode],
      );
      await client.query(
        `INSERT INTO integration.inbox_receipts (
           consumer, message_id, event_id, payload_hash, status, attempt_count,
           cycle_attempt_count, failed_at, dead_lettered_at, last_error_code
         ) VALUES ($1, $2::text, $2::uuid, $3::char(64), $4::varchar, 1, 1, now(),
                   CASE WHEN $4::varchar = 'dead_letter' THEN now() ELSE NULL END, $5::varchar)
         ON CONFLICT (consumer, message_id) DO UPDATE
         SET status = EXCLUDED.status, processing_started_at = NULL,
             attempt_count = integration.inbox_receipts.attempt_count + 1,
             cycle_attempt_count = integration.inbox_receipts.cycle_attempt_count + 1,
             failed_at = now(), dead_lettered_at = EXCLUDED.dead_lettered_at,
             last_error_code = EXCLUDED.last_error_code`,
        [consumer, event.id, hash, status, errorCode],
      );
      if (terminal) {
        await client.query(
          `UPDATE integration.outbox_events
           SET status = 'dead_letter', dead_lettered_at = now(), last_error_code = $2
           WHERE id = $1`,
          [event.id, errorCode],
        );
      }
      await client.query('COMMIT');
    } catch (failure) {
      await client.query('ROLLBACK');
      this.logger.event('error', 'integration.failure.recording_failed', {
        consumer,
        databaseCode: databaseErrorCode(failure),
        errorType: failure instanceof Error ? failure.constructor.name : 'UnknownError',
        eventId: event.id,
      });
    } finally {
      client.release();
    }
  }

  private async loadEvent(eventId: string): Promise<IntegrationEventEnvelope> {
    const result = await this.database.getPool().query<EventRow>(
      `SELECT id, aggregate_type, aggregate_id, event_type, event_version,
         correlation_id, payload, occurred_at, sequence_number::text
       FROM integration.outbox_events WHERE id = $1`,
      [eventId],
    );
    const row = result.rows[0];
    if (!row) throw new UnrecoverableError('Integration event does not exist');
    return {
      aggregateId: row.aggregate_id,
      aggregateType: row.aggregate_type,
      correlationId: row.correlation_id,
      eventType: row.event_type,
      eventVersion: row.event_version,
      id: row.id,
      occurredAt: new Date(row.occurred_at).toISOString(),
      payload: row.payload,
      sequenceNumber: row.sequence_number,
    };
  }

  private async markEventDead(eventId: string, errorCode: string): Promise<void> {
    await this.database.getPool().query(
      `UPDATE integration.outbox_events
       SET status = 'dead_letter', dead_lettered_at = now(), last_error_code = $2
       WHERE id = $1`,
      [eventId, errorCode],
    );
  }
}

function payloadHash(value: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{1,99}$/u.test(error.message)) {
    return error.message;
  }
  return error instanceof UnrecoverableError
    ? 'INTEGRATION_MESSAGE_REJECTED'
    : 'INTEGRATION_DELIVERY_FAILED';
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function databaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

export const integrationEventInternals = { canonicalJson, payloadHash, safeErrorCode };
