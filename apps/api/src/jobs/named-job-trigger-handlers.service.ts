import { createHash } from 'node:crypto';

import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';

import { DatabaseService } from '../database/database.service.js';
import { StructuredLogger } from '../logging/structured-logger.service.js';
import { type BackgroundJobContext, JobHandlerRegistry } from './job-handler-registry.service.js';
import { namedBackgroundJobs } from './named-background-jobs.js';

interface TriggerResult {
  deduplicated: boolean;
  eventId: string;
}

/**
 * Durable boundary for scheduled responsibilities whose owning domain arrives in
 * later phases. A successful handler means the trigger is transactionally present
 * in the outbox; it does not claim that the later domain workflow has completed.
 */
@Injectable()
export class NamedJobTriggerHandlersService implements OnModuleInit {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(JobHandlerRegistry) private readonly registry: JobHandlerRegistry,
    @Inject(StructuredLogger) private readonly logger: StructuredLogger,
  ) {}

  onModuleInit(): void {
    for (const name of namedBackgroundJobs) {
      this.registry.register(name, { handle: (context) => this.handle(context) });
    }
  }

  async handle(context: BackgroundJobContext): Promise<TriggerResult> {
    const eventId = deterministicUuid(`${context.name}\u0000${context.idempotencyKey}`);
    const outboxIdempotencyKey = `scheduled:${createHash('sha256')
      .update(`${context.name}\u0000${context.idempotencyKey}`)
      .digest('hex')}`;
    const result = await this.database.getPool().query(
      `INSERT INTO integration.outbox_events (
         id, aggregate_type, aggregate_id, event_type, event_version,
         correlation_id, idempotency_key, payload
       ) VALUES ($1, 'scheduled_job', $1, $2, 1, $3, $4, $5)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        eventId,
        `scheduler.${context.name}.requested`,
        context.correlationId,
        outboxIdempotencyKey,
        {
          input: context.payload,
          jobName: context.name,
          queuedAt: context.enqueuedAt,
        },
      ],
    );
    const deduplicated = result.rowCount === 0;
    this.logger.event(
      'info',
      deduplicated ? 'scheduled_job.deduplicated' : 'scheduled_job.queued',
      {
        eventId,
        jobName: context.name,
      },
    );
    return { deduplicated, eventId };
  }
}

function deterministicUuid(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(
    17,
    20,
  )}-${hex.slice(20, 32)}`;
}
