import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import { Worker, type Job } from 'bullmq';

import { APP_ENVIRONMENT } from '../config/config.module.js';
import { StructuredLogger } from '../logging/structured-logger.service.js';
import { JobHandlerRegistry } from './job-handler-registry.service.js';
import type { PlatformJobData } from './job-queue.service.js';

@Injectable()
export class PlatformJobWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private worker: Worker<PlatformJobData, unknown, string> | undefined;

  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(JobHandlerRegistry) private readonly handlers: JobHandlerRegistry,
    @Inject(StructuredLogger) private readonly logger: StructuredLogger,
  ) {}

  onApplicationBootstrap(): void {
    if (this.environment.NODE_ENV === 'test') return;

    this.worker = new Worker<PlatformJobData, unknown, string>(
      this.environment.JOB_QUEUE_NAME,
      (job) => this.process(job),
      {
        connection: { url: this.environment.REDIS_URL },
        prefix: this.environment.JOB_QUEUE_PREFIX,
      },
    );
    this.worker.on('completed', (job) => {
      this.logger.event('info', 'job.completed', {
        attemptsMade: job.attemptsMade,
        jobId: job.id,
        jobName: job.name,
      });
    });
    this.worker.on('error', (error) => {
      this.logger.event('error', 'job.worker.error', {
        errorType: error.constructor.name,
      });
    });
    this.worker.on('failed', (job, error) => {
      const maxAttempts = job?.opts.attempts ?? this.environment.JOB_DEFAULT_ATTEMPTS;
      this.logger.event('error', 'job.attempt.failed', {
        attemptsMade: job?.attemptsMade,
        errorType: error.constructor.name,
        final: error.name === 'UnrecoverableError' || (job?.attemptsMade ?? 0) >= maxAttempts,
        jobId: job?.id,
        jobName: job?.name,
      });
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  async process(job: Job<PlatformJobData, unknown, string>): Promise<unknown> {
    const maxAttempts = job.opts.attempts ?? this.environment.JOB_DEFAULT_ATTEMPTS;
    const attemptNumber = job.attemptsMade + 1;
    return this.handlers.execute({
      attemptNumber,
      correlationId: job.data.correlationId,
      enqueuedAt: job.data.enqueuedAt,
      idempotencyKey: job.data.idempotencyKey,
      jobId: job.id ?? job.data.idempotencyKey,
      maxAttempts,
      name: job.name,
      payload: job.data.payload,
      retryAllowed: attemptNumber < maxAttempts,
    });
  }
}
