import { describe, expect, it, vi } from 'vitest';

import type { DatabaseService } from '../database/database.service.js';
import type { StructuredLogger } from '../logging/structured-logger.service.js';
import { JobHandlerRegistry } from './job-handler-registry.service.js';
import { namedBackgroundJobs } from './named-background-jobs.js';
import { NamedJobTriggerHandlersService } from './named-job-trigger-handlers.service.js';

describe('NamedJobTriggerHandlersService', () => {
  it('registers every scheduled responsibility named by the specification', () => {
    const { registry, service } = createSubject();
    service.onModuleInit();

    expect(registry.registeredNames()).toEqual([...namedBackgroundJobs].sort());
  });

  it('publishes a stable outbox trigger and safely deduplicates a replay', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 0 });
    const { registry, service } = createSubject(query);
    service.onModuleInit();
    const context = {
      attemptNumber: 1,
      correlationId: 'correlation-1',
      enqueuedAt: '2026-08-10T08:00:00.000Z',
      idempotencyKey: '2026-08-10',
      jobId: 'job-1',
      maxAttempts: 5,
      name: 'backup.verify',
      payload: { scheduledFor: '2026-08-10T08:00:00.000Z' },
      retryAllowed: true,
    } as const;

    await expect(registry.execute(context)).resolves.toMatchObject({ deduplicated: false });
    await expect(registry.execute(context)).resolves.toMatchObject({ deduplicated: true });

    expect(query).toHaveBeenCalledTimes(2);
    const firstParameters = query.mock.calls[0]?.[1] as unknown[];
    const replayParameters = query.mock.calls[1]?.[1] as unknown[];
    expect(firstParameters[0]).toBe(replayParameters[0]);
    expect(firstParameters[1]).toBe('scheduler.backup.verify.requested');
    expect(firstParameters[3]).toBe(replayParameters[3]);
    expect(firstParameters[4]).toEqual({
      input: { scheduledFor: '2026-08-10T08:00:00.000Z' },
      jobName: 'backup.verify',
      queuedAt: '2026-08-10T08:00:00.000Z',
    });
  });
});

function createSubject(query = vi.fn().mockResolvedValue({ rowCount: 1 })) {
  const registry = new JobHandlerRegistry();
  const database = { getPool: () => ({ query }) } as unknown as DatabaseService;
  const logger = { event: vi.fn() } as unknown as StructuredLogger;
  return {
    registry,
    service: new NamedJobTriggerHandlersService(database, registry, logger),
  };
}
