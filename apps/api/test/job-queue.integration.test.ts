import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { VistaConfigModule } from '../src/config/config.module.js';
import { JobQueueService } from '../src/jobs/job-queue.service.js';
import { JobsModule } from '../src/jobs/jobs.module.js';
import { LoggingModule } from '../src/logging/logging.module.js';

const runInfrastructureTests = process.env['RUN_INFRASTRUCTURE_TESTS'] === 'true';

describe.skipIf(!runInfrastructureTests)('Redis job queue guarantees', () => {
  let jobId: string | undefined;
  let module: TestingModule;
  let queue: JobQueueService;

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
});
