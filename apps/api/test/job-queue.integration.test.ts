import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { APP_ENVIRONMENT, VistaConfigModule } from '../src/config/config.module.js';
import type { AppEnvironment } from '@vista/config';
import { StructuredLogger } from '../src/logging/structured-logger.service.js';
import { JobHandlerRegistry } from '../src/jobs/job-handler-registry.service.js';
import { PlatformJobWorkerService } from '../src/jobs/platform-job-worker.service.js';
import { JobQueueService } from '../src/jobs/job-queue.service.js';
import { JobsModule } from '../src/jobs/jobs.module.js';
import { LoggingModule } from '../src/logging/logging.module.js';

const runInfrastructureTests = process.env['RUN_INFRASTRUCTURE_TESTS'] === 'true';

describe.skipIf(!runInfrastructureTests)('Redis job queue guarantees', () => {
  let jobId: string | undefined;
  let module: TestingModule;
  let queue: JobQueueService;
  const scheduleId = 'sales.subscription-invoice.integration';

  beforeAll(async () => {
    if (!process.env['REDIS_URL']) {
      throw new Error('REDIS_URL is required when RUN_INFRASTRUCTURE_TESTS=true');
    }

    Object.assign(process.env, {
      BUSINESS_TIMEZONE: process.env['BUSINESS_TIMEZONE'] ?? 'Europe/Sofia',
      CORS_ORIGINS: process.env['CORS_ORIGINS'] ?? 'http://localhost:5173',
      DATABASE_URL:
        process.env['DATABASE_URL'] ?? 'postgresql://vista:password@localhost:55432/vista',
      JOB_QUEUE_NAME: `platform-integration-${randomUUID()}`,
      JOB_QUEUE_PREFIX: 'vista-integration',
      NODE_ENV: 'test',
      S3_ACCESS_KEY_ID: process.env['S3_ACCESS_KEY_ID'] ?? 'test',
      S3_BUCKET: process.env['S3_BUCKET'] ?? 'vista-test',
      S3_ENDPOINT: process.env['S3_ENDPOINT'] ?? 'http://localhost:9000',
      S3_REGION: process.env['S3_REGION'] ?? 'us-east-1',
      S3_SECRET_ACCESS_KEY: process.env['S3_SECRET_ACCESS_KEY'] ?? 'test-secret',
      SESSION_SECRET:
        process.env['SESSION_SECRET'] ?? 'a-test-session-secret-at-least-32-characters',
      SMTP_FROM: process.env['SMTP_FROM'] ?? 'test@example.invalid',
      SMTP_HOST: process.env['SMTP_HOST'] ?? 'localhost',
      SMTP_PORT: process.env['SMTP_PORT'] ?? '1025',
      TOTP_ENCRYPTION_KEY:
        process.env['TOTP_ENCRYPTION_KEY'] ?? 'a-test-totp-key-with-at-least-32-characters',
    });

    module = await Test.createTestingModule({
      imports: [VistaConfigModule, LoggingModule, JobsModule],
    }).compile();
    queue = module.get(JobQueueService);
  });

  afterAll(async () => {
    await queue.removeJobSchedule(scheduleId);
    if (jobId) {
      await queue.remove(jobId);
    }
    await module.close();
  });

  it('deduplicates replayed commands with a stable job identifier', async () => {
    const input = {
      correlationId: randomUUID(),
      idempotencyKey: randomUUID(),
      name: 'notification.dispatch',
      payload: { notificationId: randomUUID() },
    };

    const first = await queue.enqueue(input);
    jobId = first.jobId;
    const replay = await queue.enqueue(input);

    expect(first.deduplicated).toBe(false);
    expect(replay).toEqual({ deduplicated: true, jobId: first.jobId });
    expect(await queue.getJobState(first.jobId)).toBe('waiting');
    await expect(queue.getTelemetry()).resolves.toMatchObject({ waiting: 1 });
  });

  it('executes a real Redis worker, retries once and deduplicates a completed replay', async () => {
    const environment = {
      ...module.get<AppEnvironment>(APP_ENVIRONMENT),
      NODE_ENV: 'development' as const,
      JOB_QUEUE_NAME: `qa-worker-${randomUUID()}`,
      JOB_BACKOFF_DELAY_MS: 10,
    };
    const logger = module.get(StructuredLogger);
    const subject = new JobQueueService(environment, logger);
    const handlers = new JobHandlerRegistry();
    let attempts = 0;
    let effects = 0;
    handlers.register('qa.retry-safe', {
      handle: () => {
        attempts += 1;
        if (attempts === 1) throw new Error('Transient test failure');
        effects += 1;
        return Promise.resolve({ completed: true });
      },
    });
    const worker = new PlatformJobWorkerService(environment, handlers, logger);
    let id: string | undefined;
    try {
      worker.onApplicationBootstrap();
      const input = {
        correlationId: randomUUID(),
        idempotencyKey: randomUUID(),
        name: 'qa.retry-safe',
        payload: {},
      };
      const queued = await subject.enqueue(input);
      id = queued.jobId;
      const deadline = Date.now() + 8000;
      while ((await subject.getJobState(id)) !== 'completed' && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 25));
      expect(await subject.getJobState(id)).toBe('completed');
      expect(attempts).toBe(2);
      expect(effects).toBe(1);
      expect(await subject.enqueue(input)).toEqual({ deduplicated: true, jobId: id });
      expect(effects).toBe(1);
    } finally {
      await worker.onApplicationShutdown();
      if (id) await subject.remove(id);
      await subject.onApplicationShutdown();
    }
  });

  it('upserts a recurring schedule without duplicating it across application restarts', async () => {
    const input = {
      id: scheduleId,
      name: 'sales.subscription-invoice.generate',
      pattern: '0 15 1 * * *',
      payload: { responsibility: 'recurring-service-billing' },
      timezone: 'Europe/Sofia',
    };

    const first = await queue.upsertSchedule(input);
    const replay = await queue.upsertSchedule(input);

    expect(replay).toEqual(first);
    await expect(queue.getJobSchedule(scheduleId)).resolves.toEqual(first);
    expect(first).toMatchObject({
      id: scheduleId,
      name: 'sales.subscription-invoice.generate',
      pattern: input.pattern,
      timezone: input.timezone,
    });
    expect(first.nextRunAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });
});
