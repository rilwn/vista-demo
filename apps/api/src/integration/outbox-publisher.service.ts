import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';

import { APP_ENVIRONMENT } from '../config/config.module.js';
import { DatabaseService } from '../database/database.service.js';
import { JobQueueService } from '../jobs/job-queue.service.js';
import { StructuredLogger } from '../logging/structured-logger.service.js';
import { IntegrationEventConsumerRegistry } from './integration-event-consumer.registry.js';
import { integrationEventJobName } from './integration-event-dispatcher.service.js';

interface ClaimedOutboxEvent {
  attempt_count: number;
  correlation_id: string;
  event_type: string;
  id: string;
  publication_attempt_count: number;
  replay_count: number;
}

export interface OutboxPublishResult {
  claimed: number;
  failed: number;
  published: number;
}

@Injectable()
export class OutboxPublisherService implements OnApplicationBootstrap, OnApplicationShutdown {
  private interval: ReturnType<typeof setInterval> | undefined;
  private polling = false;

  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(IntegrationEventConsumerRegistry)
    private readonly consumers: IntegrationEventConsumerRegistry,
    @Inject(JobQueueService) private readonly jobs: JobQueueService,
    @Inject(StructuredLogger) private readonly logger: StructuredLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.environment.NODE_ENV === 'test') return;
    await this.publishAvailable();
    this.interval = setInterval(
      () => void this.publishAvailable().catch(() => undefined),
      this.environment.INTEGRATION_OUTBOX_INTERVAL_MS,
    );
  }

  onApplicationShutdown(): void {
    if (this.interval) clearInterval(this.interval);
  }

  async publishAvailable(): Promise<OutboxPublishResult> {
    if (this.polling) return { claimed: 0, failed: 0, published: 0 };
    this.polling = true;
    try {
      await this.recoverStaleClaims();
      const claimed = await this.claimAvailable();
      let failed = 0;
      let published = 0;
      for (const event of claimed) {
        try {
          const queued = await this.jobs.enqueue({
            correlationId: event.correlation_id,
            idempotencyKey: `${event.id}.${event.replay_count}`,
            name: integrationEventJobName,
            payload: { eventId: event.id },
          });
          if (queued.deduplicated) await this.jobs.retryFailed(queued.jobId);
          await this.markPublished(event.id);
          published += 1;
        } catch (error) {
          failed += 1;
          await this.recordFailure(event, error);
        }
      }
      if (claimed.length) {
        this.logger.event('info', 'integration.outbox.cycle', {
          claimed: claimed.length,
          failed,
          published,
        });
      }
      return { claimed: claimed.length, failed, published };
    } catch (error) {
      this.logger.event('error', 'integration.outbox.poll_failed', {
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      });
      throw error;
    } finally {
      this.polling = false;
    }
  }

  private async claimAvailable(): Promise<ClaimedOutboxEvent[]> {
    const eventTypes = this.consumers.eventTypes();
    if (!eventTypes.length) return [];
    const client = await this.database.getPool().connect();
    try {
      await client.query('BEGIN');
      const claimed = await client.query<ClaimedOutboxEvent>(
        `WITH candidate AS (
           SELECT event.id
           FROM integration.outbox_events event
           WHERE event.status = 'pending' AND event.available_at <= now()
             AND event.event_type = ANY($1::varchar[])
             AND NOT EXISTS (
               SELECT 1 FROM integration.outbox_events prior
               WHERE prior.aggregate_type = event.aggregate_type
                 AND prior.aggregate_id = event.aggregate_id
                 AND prior.event_type = event.event_type
                 AND prior.sequence_number < event.sequence_number
                 AND prior.status <> 'completed'
             )
           ORDER BY event.available_at, event.occurred_at, event.id
           FOR UPDATE SKIP LOCKED
           LIMIT $2
         )
         UPDATE integration.outbox_events event
         SET status = 'publishing', processing_started_at = now(),
             attempt_count = attempt_count + 1,
             publication_attempt_count = publication_attempt_count + 1,
             last_error_code = NULL
         FROM candidate
         WHERE event.id = candidate.id
         RETURNING event.id, event.event_type, event.correlation_id,
           event.attempt_count, event.publication_attempt_count, event.replay_count`,
        [eventTypes, this.environment.INTEGRATION_OUTBOX_BATCH_SIZE],
      );
      for (const event of claimed.rows) {
        const bindings = this.consumers.bindingsFor(event.event_type);
        for (const binding of bindings) {
          await client.query(
            `INSERT INTO integration.outbox_deliveries (event_id, consumer)
             VALUES ($1, $2) ON CONFLICT (event_id, consumer) DO NOTHING`,
            [event.id, binding.consumer],
          );
        }
      }
      await client.query('COMMIT');
      return claimed.rows;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async markPublished(eventId: string): Promise<void> {
    await this.database.getPool().query(
      `UPDATE integration.outbox_events
       SET status = CASE WHEN status = 'publishing' THEN 'published' ELSE status END,
           published_at = COALESCE(published_at, now()), processing_started_at = NULL,
           last_error_code = NULL
       WHERE id = $1`,
      [eventId],
    );
  }

  private async recordFailure(event: ClaimedOutboxEvent, error: unknown): Promise<void> {
    const terminal = event.publication_attempt_count >= this.environment.JOB_DEFAULT_ATTEMPTS;
    const delayMs = Math.min(
      this.environment.JOB_BACKOFF_DELAY_MS * 2 ** (event.publication_attempt_count - 1),
      3_600_000,
    );
    await this.database.getPool().query(
      `UPDATE integration.outbox_events
       SET status = $2, processing_started_at = NULL, last_error_code = $3,
           dead_lettered_at = CASE WHEN $2 = 'dead_letter' THEN now() ELSE NULL END,
           available_at = CASE
             WHEN $2 = 'pending' THEN now() + ($4::bigint * interval '1 millisecond')
             ELSE available_at
           END
       WHERE id = $1 AND status = 'publishing'`,
      [
        event.id,
        terminal ? 'dead_letter' : 'pending',
        error instanceof Error ? 'INTEGRATION_PUBLISH_FAILED' : 'INTEGRATION_PUBLISH_UNKNOWN',
        delayMs,
      ],
    );
  }

  private async recoverStaleClaims(): Promise<void> {
    const result = await this.database.getPool().query(
      `UPDATE integration.outbox_events
       SET status = 'pending', processing_started_at = NULL,
           last_error_code = 'INTEGRATION_PUBLISH_TIMEOUT', available_at = now()
       WHERE status = 'publishing'
         AND processing_started_at < now() - ($1::bigint * interval '1 millisecond')`,
      [this.environment.INTEGRATION_OUTBOX_PROCESSING_TIMEOUT_MS],
    );
    if (result.rowCount) {
      this.logger.event('warn', 'integration.outbox.claims_recovered', { count: result.rowCount });
    }
  }
}
