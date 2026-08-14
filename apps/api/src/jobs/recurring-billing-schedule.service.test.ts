import type { AppEnvironment } from '@vista/config';
import { describe, expect, it, vi } from 'vitest';

import type { JobQueueService } from './job-queue.service.js';
import {
  financePaymentStatusScheduleId,
  RecurringBillingScheduleService,
  recurringBillingScheduleId,
} from './recurring-billing-schedule.service.js';

describe('RecurringBillingScheduleService', () => {
  it('upserts the timezone-aware daily schedules for recurring invoices and payment statuses', async () => {
    const upsertSchedule = vi
      .fn()
      .mockResolvedValueOnce({
        id: recurringBillingScheduleId,
        name: 'sales.subscription-invoice.generate',
        nextRunAt: '2026-08-13T22:15:00.000Z',
      })
      .mockResolvedValueOnce({
        id: financePaymentStatusScheduleId,
        name: 'finance.payment-status.detect',
        nextRunAt: '2026-08-13T22:25:00.000Z',
      });
    const jobs = {
      upsertSchedule,
    } as unknown as JobQueueService;
    const logger = { event: vi.fn() };
    const service = new RecurringBillingScheduleService(
      {
        BUSINESS_TIMEZONE: 'Europe/Sofia',
        FINANCE_PAYMENT_STATUS_CRON: '0 25 1 * * *',
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
    expect(upsertSchedule).toHaveBeenCalledWith({
      id: financePaymentStatusScheduleId,
      name: 'finance.payment-status.detect',
      pattern: '0 25 1 * * *',
      payload: { responsibility: 'finance-payment-status' },
      timezone: 'Europe/Sofia',
    });
    expect(logger.event).toHaveBeenCalledWith(
      'info',
      'finance.payment-status.schedule.ready',
      expect.objectContaining({ scheduleId: financePaymentStatusScheduleId }),
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
