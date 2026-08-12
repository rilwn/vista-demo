import type { AppEnvironment } from '@vista/config';
import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import { type BackgroundJobContext, JobHandlerRegistry } from './job-handler-registry.service.js';
import type { PlatformJobData } from './job-queue.service.js';
import { PlatformJobWorkerService } from './platform-job-worker.service.js';

const environment = {
  JOB_DEFAULT_ATTEMPTS: 5,
  JOB_QUEUE_NAME: 'platform',
  JOB_QUEUE_PREFIX: 'vista',
  NODE_ENV: 'test',
  REDIS_URL: 'redis://localhost:6379/0',
} as AppEnvironment;

describe('PlatformJobWorkerService', () => {
  it('unwraps queue data and exposes retry lifecycle to the handler', async () => {
    const registry = new JobHandlerRegistry();
    const handle = vi.fn().mockResolvedValue({ delivered: true });
    registry.register('notification.dispatch', { handle });
    const worker = new PlatformJobWorkerService(environment, registry, loggerStub());
    const data: PlatformJobData = {
      correlationId: 'correlation-1',
      enqueuedAt: '2026-08-10T08:00:00.000Z',
      idempotencyKey: 'notification-1',
      payload: { notificationId: 'notification-1' },
    };

    const result = await worker.process({
      attemptsMade: 3,
      data,
      id: 'queue-job-1',
      name: 'notification.dispatch',
      opts: { attempts: 5 },
    } as unknown as Job<PlatformJobData, unknown, string>);

    expect(result).toEqual({ delivered: true });
    expect(handle).toHaveBeenCalledWith({
      attemptNumber: 4,
      correlationId: 'correlation-1',
      enqueuedAt: '2026-08-10T08:00:00.000Z',
      idempotencyKey: 'notification-1',
      jobId: 'queue-job-1',
      maxAttempts: 5,
      name: 'notification.dispatch',
      payload: { notificationId: 'notification-1' },
      retryAllowed: true,
    });
  });

  it('marks the last configured attempt as terminal', async () => {
    const registry = new JobHandlerRegistry();
    const handle = vi.fn().mockResolvedValue(undefined);
    registry.register('report.generate', { handle });
    const worker = new PlatformJobWorkerService(environment, registry, loggerStub());

    await worker.process({
      attemptsMade: 4,
      data: {
        correlationId: 'correlation-2',
        enqueuedAt: '2026-08-10T08:00:00.000Z',
        idempotencyKey: 'report-1',
        payload: {},
      },
      id: 'queue-job-2',
      name: 'report.generate',
      opts: { attempts: 5 },
    } as unknown as Job<PlatformJobData, unknown, string>);

    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptNumber: 5,
        retryAllowed: false,
      }),
    );
  });

  it('derives a distinct retry-stable command scope for each scheduled occurrence', async () => {
    const registry = new JobHandlerRegistry();
    const handle = vi
      .fn<(context: BackgroundJobContext) => Promise<{ generatedCount: number }>>()
      .mockResolvedValue({ generatedCount: 1 });
    registry.register('sales.subscription-invoice.generate', { handle });
    const worker = new PlatformJobWorkerService(environment, registry, loggerStub());
    const scheduledAt = Date.parse('2026-08-13T01:15:00.000Z');

    await worker.process({
      attemptsMade: 0,
      data: {
        correlationId: 'scheduler:sales.subscription-invoice.daily',
        enqueuedAt: '2026-08-12T10:00:00.000Z',
        idempotencyKey: 'scheduler:sales.subscription-invoice.daily',
        payload: { scheduleId: 'sales.subscription-invoice.daily' },
      },
      id: `repeat:sales.subscription-invoice.daily:${scheduledAt}`,
      name: 'sales.subscription-invoice.generate',
      opts: { attempts: 5 },
      timestamp: Date.parse('2026-08-12T10:00:00.000Z'),
    } as unknown as Job<PlatformJobData, unknown, string>);

    const context = handle.mock.calls[0]?.[0];
    expect(context?.correlationId).toMatch(/^scheduled-[a-f0-9]{32}$/);
    expect(context?.enqueuedAt).toBe('2026-08-13T01:15:00.000Z');
    expect(context?.idempotencyKey).toMatch(/^scheduler:[a-f0-9]{64}$/);
    expect(context?.payload).toEqual({
      scheduleId: 'sales.subscription-invoice.daily',
      scheduledFor: '2026-08-13T01:15:00.000Z',
    });
  });
});

function loggerStub() {
  return { event: vi.fn() } as never;
}
