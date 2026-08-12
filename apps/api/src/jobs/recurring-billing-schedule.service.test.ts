import type { AppEnvironment } from '@vista/config';
import { describe, expect, it, vi } from 'vitest';

import type { JobQueueService } from './job-queue.service.js';
import {
  RecurringBillingScheduleService,
  recurringBillingScheduleId,
} from './recurring-billing-schedule.service.js';

describe('RecurringBillingScheduleService', () => {
  it('upserts one timezone-aware daily production schedule', async () => {
    const upsertSchedule = vi.fn().mockResolvedValue({
      id: recurringBillingScheduleId,
      name: 'sales.subscription-invoice.generate',
      nextRunAt: '2026-08-13T22:15:00.000Z',
    });
    const jobs = {
      upsertSchedule,
    } as unknown as JobQueueService;
    const logger = { event: vi.fn() };
    const service = new RecurringBillingScheduleService(
      {
        BUSINESS_TIMEZONE: 'Europe/Sofia',
        NODE_ENV: 'production',
        SALES_SUBSCRIPTION_INVOICE_CRON: '0 15 1 * * *',
      } as unknown as AppEnvironment,
      jobs,
      logger as never,
    );

    await service.onApplicationBootstrap();

    expect(upsertSchedule).toHaveBeenCalledWith({
      id: recurringBillingScheduleId,
      name: 'sales.subscription-invoice.generate',
      pattern: '0 15 1 * * *',
      payload: { responsibility: 'recurring-service-billing' },
      timezone: 'Europe/Sofia',
    });
    expect(logger.event).toHaveBeenCalledWith(
      'info',
      'sales.subscription-invoice.schedule.ready',
      expect.objectContaining({ scheduleId: recurringBillingScheduleId }),
    );
  });

  it('does not install production schedules in unit-test applications', async () => {
    const upsertSchedule = vi.fn();
    const jobs = { upsertSchedule } as unknown as JobQueueService;
    const service = new RecurringBillingScheduleService(
      { NODE_ENV: 'test' } as unknown as AppEnvironment,
      jobs,
      { event: vi.fn() } as never,
    );

    await service.onApplicationBootstrap();

    expect(upsertSchedule).not.toHaveBeenCalled();
  });
});
