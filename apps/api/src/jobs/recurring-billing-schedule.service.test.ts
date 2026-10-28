import type { AppEnvironment } from '@vista/config';
import { describe, expect, it, vi } from 'vitest';

import type { EnqueueJobInput, JobQueueService } from './job-queue.service.js';
import {
  crmSlaScheduleId,
  financePaymentStatusScheduleId,
  RecurringBillingScheduleService,
  backupRestoreDispatchScheduleId,
  backupRetentionScheduleId,
  backupMissedDetectionScheduleId,
  backupDrTestReminderScheduleId,
  backupPlanReviewReminderScheduleId,
  recurringBillingScheduleId,
  serviceInspectionReminderScheduleId,
  servicePlanVisitScheduleId,
  serviceWarrantyReminderScheduleId,
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
      })
      .mockImplementation((input: { id: string; name: string }) => ({
        id: input.id,
        name: input.name,
      }));
    const enqueue = vi
      .fn<(input: EnqueueJobInput) => Promise<{ jobId: string; deduplicated: boolean }>>()
      .mockResolvedValue({ jobId: 'bnb-startup-job', deduplicated: false });
    const jobs = {
      upsertSchedule,
      enqueue,
    } as unknown as JobQueueService;
    const logger = { event: vi.fn() };
    const service = new RecurringBillingScheduleService(
      {
        BUSINESS_TIMEZONE: 'Europe/Sofia',
        BACKUP_DISPATCH_CRON: '0 * * * * *',
        CRM_SLA_EVALUATION_CRON: '0 */5 * * * *',
        FINANCE_PAYMENT_STATUS_CRON: '0 25 1 * * *',
        NODE_ENV: 'production',
        SALES_SUBSCRIPTION_INVOICE_CRON: '0 15 1 * * *',
        SERVICE_INSPECTION_REMINDER_CRON: '0 35 1 * * *',
        SERVICE_PLAN_VISIT_CRON: '0 45 1 * * *',
        SERVICE_WARRANTY_REMINDER_CRON: '0 40 1 * * *',
      } as unknown as AppEnvironment,
      jobs,
      logger as never,
    );

    await service.onApplicationBootstrap();

    expect(enqueue).toHaveBeenCalledOnce();
    const startup = enqueue.mock.calls[0]![0];
    expect(startup.name).toBe('finance.currency-rates.refresh');
    expect(startup.idempotencyKey).toMatch(/^bnb-startup:\d{4}-\d{2}-\d{2}$/u);
    expect(startup.payload).toEqual({ responsibility: 'startup-bnb-currency-rates' });

    expect(upsertSchedule).toHaveBeenCalledWith({
      id: recurringBillingScheduleId,
      name: 'sales.subscription-invoice.generate',
      pattern: '0 15 1 * * *',
      payload: { responsibility: 'recurring-service-billing' },
      timezone: 'Europe/Sofia',
    });
    expect(upsertSchedule).toHaveBeenCalledWith({
      id: crmSlaScheduleId,
      name: 'crm.sla.evaluate',
      pattern: '0 */5 * * * *',
      payload: { responsibility: 'ticket-sla-monitoring' },
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
    expect(upsertSchedule).toHaveBeenCalledWith({
      id: serviceInspectionReminderScheduleId,
      name: 'service.inspection-reminder.prepare',
      pattern: '0 35 1 * * *',
      payload: { responsibility: 'inspection-reminders' },
      timezone: 'Europe/Sofia',
    });
    expect(upsertSchedule).toHaveBeenCalledWith({
      id: serviceWarrantyReminderScheduleId,
      name: 'crm.warranty-expiration.prepare',
      pattern: '0 40 1 * * *',
      payload: { responsibility: 'warranty-reminders' },
      timezone: 'Europe/Sofia',
    });
    expect(upsertSchedule).toHaveBeenCalledWith({
      id: servicePlanVisitScheduleId,
      name: 'service.plan-visit.generate',
      pattern: '0 45 1 * * *',
      payload: { responsibility: 'subscription-service-visits' },
      timezone: 'Europe/Sofia',
    });
    expect(upsertSchedule).toHaveBeenCalledWith({
      id: backupRestoreDispatchScheduleId,
      name: 'backup.restore.dispatch',
      pattern: '0 * * * * *',
      payload: { responsibility: 'dispatch-approved-backup-restores' },
      timezone: 'Europe/Sofia',
    });
    expect(upsertSchedule).toHaveBeenCalledWith({
      id: backupRetentionScheduleId,
      name: 'backup.retention.enforce',
      pattern: '0 30 3 * * *',
      payload: { responsibility: 'enforce-approved-backup-retention' },
      timezone: 'Europe/Sofia',
    });
    expect(upsertSchedule).toHaveBeenCalledWith({
      id: backupMissedDetectionScheduleId,
      name: 'backup.missed-detect',
      pattern: '0 */15 * * * *',
      payload: { responsibility: 'detect-overdue-backup-schedules' },
      timezone: 'Europe/Sofia',
    });
    expect(upsertSchedule).toHaveBeenCalledWith({
      id: backupDrTestReminderScheduleId,
      name: 'backup.dr-test.remind',
      pattern: '0 0 9 * * *',
      payload: { responsibility: 'annual-disaster-recovery-test-reminder' },
      timezone: 'Europe/Sofia',
    });
    expect(upsertSchedule).toHaveBeenCalledWith({
      id: backupPlanReviewReminderScheduleId,
      name: 'backup.plan-review.remind',
      pattern: '0 15 9 * * *',
      payload: { responsibility: 'annual-backup-plan-review-reminder' },
      timezone: 'Europe/Sofia',
    });
  });

  it('does not install production schedules in unit-test applications', async () => {
    const upsertSchedule = vi.fn();
    const enqueue = vi.fn();
    const jobs = { upsertSchedule, enqueue } as unknown as JobQueueService;
    const service = new RecurringBillingScheduleService(
      { NODE_ENV: 'test' } as unknown as AppEnvironment,
      jobs,
      { event: vi.fn() } as never,
    );

    await service.onApplicationBootstrap();

    expect(upsertSchedule).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
