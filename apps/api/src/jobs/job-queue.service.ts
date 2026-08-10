import { createHash } from 'node:crypto';

import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type {
  BackgroundJobState,
  BackgroundJobSummary,
  BackgroundJobTelemetry,
} from '@vista/contracts';
import { Queue, type JobState } from 'bullmq';

import { APP_ENVIRONMENT } from '../config/config.module.js';
import { StructuredLogger } from '../logging/structured-logger.service.js';

export interface EnqueueJobInput {
  correlationId: string;
  delayMs?: number;
  idempotencyKey: string;
  name: string;
  payload: Record<string, unknown>;
}

export interface EnqueueJobResult {
  deduplicated: boolean;
  jobId: string;
}

export interface PlatformJobData {
  correlationId: string;
  enqueuedAt: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class JobQueueService implements OnApplicationShutdown {
  private queue: Queue<PlatformJobData, unknown, string> | undefined;

  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(StructuredLogger) private readonly logger: StructuredLogger,
  ) {}

  async enqueue(input: EnqueueJobInput): Promise<EnqueueJobResult> {
    validateInput(input);
    const queue = this.getQueue();
    const jobId = createJobId(input.name, input.idempotencyKey);
    const existing = await queue.getJob(jobId);
    if (existing) {
      this.logger.event('info', 'job.enqueue.deduplicated', {
        correlationId: input.correlationId,
        jobId,
        jobName: input.name,
      });
      return { deduplicated: true, jobId };
    }

    const job = await queue.add(
      input.name,
      {
        correlationId: input.correlationId,
        enqueuedAt: new Date().toISOString(),
        idempotencyKey: input.idempotencyKey,
        payload: input.payload,
      },
      {
        attempts: this.environment.JOB_DEFAULT_ATTEMPTS,
        backoff: {
          delay: this.environment.JOB_BACKOFF_DELAY_MS,
          type: 'exponential',
        },
        ...(input.delayMs === undefined ? {} : { delay: input.delayMs }),
        jobId,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    this.logger.event('info', 'job.enqueued', {
      correlationId: input.correlationId,
      jobId: job.id,
      jobName: input.name,
    });
    return { deduplicated: false, jobId };
  }

  async getJobState(jobId: string): Promise<JobState | 'unknown'> {
    return this.getQueue().getJobState(jobId);
  }

  async getTelemetry(): Promise<BackgroundJobTelemetry> {
    const queue = this.getQueue();
    const [counts, paused] = await Promise.all([
      queue.getJobCounts('active', 'completed', 'delayed', 'failed', 'waiting'),
      queue.isPaused(),
    ]);
    return {
      active: counts['active'] ?? 0,
      completed: counts['completed'] ?? 0,
      delayed: counts['delayed'] ?? 0,
      failed: counts['failed'] ?? 0,
      paused,
      timestamp: new Date().toISOString(),
      waiting: counts['waiting'] ?? 0,
    };
  }

  async remove(jobId: string): Promise<boolean> {
    const job = await this.getQueue().getJob(jobId);
    if (!job) {
      return false;
    }
    await job.remove();
    return true;
  }

  async getSummary(jobId: string): Promise<BackgroundJobSummary | undefined> {
    const job = await this.getQueue().getJob(jobId);
    if (!job) return undefined;
    const state = await job.getState();
    return {
      attemptsMade: job.attemptsMade,
      createdAt: new Date(job.timestamp).toISOString(),
      ...(job.failedReason && job.finishedOn
        ? { failedAt: new Date(job.finishedOn).toISOString() }
        : {}),
      ...(job.finishedOn ? { finishedAt: new Date(job.finishedOn).toISOString() } : {}),
      id: job.id ?? jobId,
      name: job.name,
      ...(job.processedOn ? { processedAt: new Date(job.processedOn).toISOString() } : {}),
      state: toBackgroundJobState(state),
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue?.close();
  }

  private getQueue(): Queue<PlatformJobData, unknown, string> {
    if (!this.queue) {
      this.queue = new Queue<PlatformJobData, unknown, string>(this.environment.JOB_QUEUE_NAME, {
        connection: { url: this.environment.REDIS_URL },
        defaultJobOptions: {
          removeOnComplete: false,
          removeOnFail: false,
        },
        prefix: this.environment.JOB_QUEUE_PREFIX,
      });
      this.queue.on('error', (error) => {
        this.logger.event('error', 'job.queue.error', { errorType: error.constructor.name });
      });
    }
    return this.queue;
  }
}

function toBackgroundJobState(value: JobState | 'unknown'): BackgroundJobState {
  switch (value) {
    case 'active':
    case 'completed':
    case 'delayed':
    case 'failed':
    case 'prioritized':
    case 'waiting':
    case 'waiting-children':
      return value;
    default:
      return 'unknown';
  }
}

export function createJobId(name: string, idempotencyKey: string): string {
  return createHash('sha256').update(`${name}\u0000${idempotencyKey}`).digest('hex');
}

function validateInput(input: EnqueueJobInput): void {
  if (!/^[a-z][a-z0-9.-]{1,127}$/.test(input.name)) {
    throw new Error('Job name must be a stable lowercase dotted identifier');
  }
  if (input.idempotencyKey.length < 1 || input.idempotencyKey.length > 256) {
    throw new Error('Job idempotency key must contain between 1 and 256 characters');
  }
  if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(input.correlationId)) {
    throw new Error('Job correlation identifier is invalid');
  }
  if (input.delayMs !== undefined && (!Number.isSafeInteger(input.delayMs) || input.delayMs < 0)) {
    throw new Error('Job delay must be a non-negative integer');
  }
  try {
    JSON.stringify(input.payload);
  } catch {
    throw new Error('Job payload must be JSON serializable');
  }
}
