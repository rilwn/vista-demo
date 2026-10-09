import { describe, expect, it, vi } from 'vitest';
import type { AppEnvironment } from '@vista/config';
import { UnrecoverableError } from 'bullmq';
import type { DatabaseService } from '../database/database.service.js';
import { JobHandlerRegistry } from '../jobs/job-handler-registry.service.js';
import type { JobQueueService } from '../jobs/job-queue.service.js';
import type { StructuredLogger } from '../logging/structured-logger.service.js';
import { NotificationDispatcherService } from './notification-dispatcher.service.js';

describe('NotificationDispatcherService', () => {
  it('records a rolled-back attempt and stops retrying after the final attempt', async () => {
    const { dispatcher, transactionQuery, failureQuery } = subject();
    transactionQuery.mockImplementation((sql: string) => {
      if (sql.includes('RETURNING id, channel'))
        return Promise.resolve({
          rows: [{ channel: 'in_system', recipient_account_id: 'account' }],
        });
      if (sql.includes("SET status = 'delivered'")) throw new Error('Write failed');
      return Promise.resolve({ rows: [] });
    });
    await expect(dispatcher.dispatch('notification', false)).rejects.toThrow('Write failed');
    expect(transactionQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(failureQuery).toHaveBeenCalledWith(expect.stringContaining("status = 'pending'"), [
      'notification',
      'failed',
      'Error',
    ]);
  });

  it('does not turn an unconfigured delivery channel into an endless retry', async () => {
    const { dispatcher, transactionQuery, failureQuery } = subject();
    transactionQuery.mockImplementation((sql: string) =>
      Promise.resolve({
        rows: sql.includes('RETURNING id, channel') ? [{ channel: 'email' }] : [],
      }),
    );
    await expect(dispatcher.dispatch('notification', true)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(transactionQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'processing'"),
      ['notification', 'failed', 'NOTIFICATION_CHANNEL_NOT_CONFIGURED'],
    );
    expect(failureQuery).not.toHaveBeenCalled();
  });

  it('requeues recovered pending notifications behind retained failed jobs', async () => {
    const { dispatcher, jobs } = subject();
    await dispatcher.onApplicationBootstrap();
    dispatcher.onApplicationShutdown();
    expect(jobs.retryFailed).toHaveBeenCalledWith('job');
  });
});

function subject() {
  const transactionQuery = vi.fn().mockResolvedValue({ rows: [] });
  const failureQuery = vi.fn().mockResolvedValue({ rows: [] });
  let connections = 0;
  const pool = {
    connect: () =>
      Promise.resolve({
        query: connections++ === 0 ? transactionQuery : failureQuery,
        release: vi.fn(),
      }),
    query: vi.fn().mockImplementation((sql: string) =>
      Promise.resolve({
        rows: sql.includes('SELECT id, idempotency_key')
          ? [{ id: 'notification', idempotency_key: 'key' }]
          : [],
        rowCount: 0,
      }),
    ),
  };
  const jobs = {
    enqueue: vi.fn().mockResolvedValue({ deduplicated: true, jobId: 'job' }),
    getJobState: vi.fn().mockResolvedValue('failed'),
    retryFailed: vi.fn().mockResolvedValue(true),
  };
  const dispatcher = new NotificationDispatcherService(
    {
      NODE_ENV: 'development',
      NOTIFICATION_DISPATCH_INTERVAL_MS: 5000,
      NOTIFICATION_PROCESSING_TIMEOUT_MS: 300000,
    } as AppEnvironment,
    { getPool: () => pool } as unknown as DatabaseService,
    new JobHandlerRegistry(),
    jobs as unknown as JobQueueService,
    { event: vi.fn() } as unknown as StructuredLogger,
  );
  return { dispatcher, transactionQuery, failureQuery, jobs };
}
