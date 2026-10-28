import { describe, expect, it, vi } from 'vitest';
import type { AppEnvironment } from '@vista/config';
import { UnrecoverableError } from 'bullmq';
import type { DatabaseService } from '../database/database.service.js';
import { JobHandlerRegistry } from '../jobs/job-handler-registry.service.js';
import type { JobQueueService } from '../jobs/job-queue.service.js';
import type { StructuredLogger } from '../logging/structured-logger.service.js';
import { NotificationDispatcherService } from './notification-dispatcher.service.js';
import type { SmsGatewayService } from './sms-gateway.service.js';

describe('NotificationDispatcherService', () => {
  it('records a rolled-back attempt and stops retrying after the final attempt', async () => {
    const { dispatcher, transactionQuery, poolQuery } = subject();
    transactionQuery.mockImplementation((sql: string) => {
      if (sql.includes('RETURNING id, channel'))
        return Promise.resolve({
          rows: [
            {
              channel: 'in_system',
              id: 'notification',
              payload: {},
              recipient_account_id: 'account',
              template_key: 'test',
            },
          ],
        });
      return Promise.resolve({ rows: [] });
    });
    poolQuery.mockRejectedValueOnce(new Error('Write failed'));
    await expect(dispatcher.dispatch('notification', false)).rejects.toThrow(
      'Notification delivery failed after the final attempt',
    );
    expect(transactionQuery).toHaveBeenCalledWith('COMMIT');
    expect(poolQuery).toHaveBeenCalledWith(expect.stringContaining('SET status = $2'), [
      'notification',
      'failed',
      'Error',
    ]);
  });

  it('does not turn an unconfigured delivery channel into an endless retry', async () => {
    const { dispatcher, transactionQuery, poolQuery } = subject();
    transactionQuery.mockImplementation((sql: string) =>
      Promise.resolve({
        rows: sql.includes('RETURNING id, channel')
          ? [
              {
                channel: 'sms',
                id: 'notification',
                payload: {},
                recipient_account_id: null,
                template_key: 'test',
              },
            ]
          : [],
      }),
    );
    await expect(dispatcher.dispatch('notification', true)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(transactionQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'processing'"),
      ['notification'],
    );
    expect(poolQuery).toHaveBeenCalledWith(expect.stringContaining('SET status = $2'), [
      'notification',
      'failed',
      'NOTIFICATION_CHANNEL_NOT_CONFIGURED',
    ]);
  });

  it('requeues recovered pending notifications behind retained failed jobs', async () => {
    const { dispatcher, jobs } = subject();
    await dispatcher.onApplicationBootstrap();
    dispatcher.onApplicationShutdown();
    expect(jobs.retryFailed).toHaveBeenCalledWith('job');
  });

  it('dispatches SMS notifications through the configured gateway', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { dispatcher, transactionQuery } = subject({ send });
    transactionQuery.mockImplementation((sql: string) =>
      Promise.resolve({
        rows: sql.includes('RETURNING id, channel')
          ? [
              {
                channel: 'sms',
                id: 'notification',
                payload: { body: 'Backup verified', to: '+359888123456' },
                recipient_account_id: null,
                template_key: 'backup.alert.sms',
              },
            ]
          : [],
      }),
    );

    await dispatcher.dispatch('notification', true);

    expect(send).toHaveBeenCalledWith({ body: 'Backup verified', to: '+359888123456' });
  });
});

function subject(
  sms: { send: ReturnType<typeof vi.fn> } = {
    send: vi.fn().mockRejectedValue(new UnrecoverableError('SMS is disabled')),
  },
) {
  const transactionQuery = vi.fn().mockResolvedValue({ rows: [] });
  const poolQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
  const pool = {
    connect: () =>
      Promise.resolve({
        query: transactionQuery,
        release: vi.fn(),
      }),
    query: poolQuery.mockImplementation((sql: string) =>
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
    { send: vi.fn().mockResolvedValue(undefined) } as never,
    sms as unknown as SmsGatewayService,
  );
  return { dispatcher, transactionQuery, poolQuery, jobs, sms };
}
