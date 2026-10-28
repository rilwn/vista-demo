import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';

import { APP_ENVIRONMENT } from '../config/config.module.js';
import { StructuredLogger } from '../logging/structured-logger.service.js';
import { JobQueueService } from './job-queue.service.js';

export const recurringBillingScheduleId = 'sales.subscription-invoice.daily';
export const financePaymentStatusScheduleId = 'finance.payment-status.daily';
export const financeCurrencyRatesScheduleId = 'finance.currency-rates.weekdays';
export const serviceInspectionReminderScheduleId = 'service.inspection-reminder.daily';
export const serviceWarrantyReminderScheduleId = 'service.warranty-reminder.daily';
export const servicePlanVisitScheduleId = 'service.plan-visit.daily';
export const crmSlaScheduleId = 'crm.sla.frequent';
export const backupDispatchScheduleId = 'backup.schedule.frequent';
export const backupRestoreDispatchScheduleId = 'backup.restore.frequent';
export const backupRetentionScheduleId = 'backup.retention.daily';
export const backupMissedDetectionScheduleId = 'backup.missed-detection.frequent';
export const backupDrTestReminderScheduleId = 'backup.dr-test.daily';
export const backupPlanReviewReminderScheduleId = 'backup.plan-review.daily';

@Injectable()
export class RecurringBillingScheduleService implements OnApplicationBootstrap {
  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(JobQueueService) private readonly jobs: JobQueueService,
    @Inject(StructuredLogger) private readonly logger: StructuredLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.environment.NODE_ENV === 'test') return;
    const billingSchedule = await this.jobs.upsertSchedule({
      id: recurringBillingScheduleId,
      name: 'sales.subscription-invoice.generate',
      pattern: this.environment.SALES_SUBSCRIPTION_INVOICE_CRON,
      payload: { responsibility: 'recurring-service-billing' },
      timezone: this.environment.BUSINESS_TIMEZONE,
    });
    this.logger.event('info', 'sales.subscription-invoice.schedule.ready', {
      nextRunAt: billingSchedule.nextRunAt,
      scheduleId: billingSchedule.id,
    });
    const paymentStatusSchedule = await this.jobs.upsertSchedule({
      id: financePaymentStatusScheduleId,
      name: 'finance.payment-status.detect',
      pattern: this.environment.FINANCE_PAYMENT_STATUS_CRON,
      payload: { responsibility: 'finance-payment-status' },
      timezone: this.environment.BUSINESS_TIMEZONE,
    });
    this.logger.event('info', 'finance.payment-status.schedule.ready', {
      nextRunAt: paymentStatusSchedule.nextRunAt,
      scheduleId: paymentStatusSchedule.id,
    });
    const currencyRatesSchedule = await this.jobs.upsertSchedule({
      id: financeCurrencyRatesScheduleId,
      name: 'finance.currency-rates.refresh',
      pattern: '0 18 * * 1-5',
      payload: { responsibility: 'daily-bnb-currency-rates' },
      timezone: this.environment.BUSINESS_TIMEZONE,
    });
    this.logger.event('info', 'finance.currency-rates.schedule.ready', {
      nextRunAt: currencyRatesSchedule.nextRunAt,
      scheduleId: currencyRatesSchedule.id,
    });
    const businessDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.environment.BUSINESS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const rateRefresh = await this.jobs.enqueue({
      name: 'finance.currency-rates.refresh',
      correlationId: randomUUID(),
      idempotencyKey: `bnb-startup:${businessDate}`,
      payload: { responsibility: 'startup-bnb-currency-rates' },
    });
    this.logger.event(
      'info',
      rateRefresh.deduplicated
        ? 'finance.bnb-rates.startup-refresh.deduplicated'
        : 'finance.bnb-rates.startup-refresh.queued',
      {
        jobId: rateRefresh.jobId,
        deduplicated: rateRefresh.deduplicated,
      },
    );
    const serviceSchedules = [
      {
        id: serviceInspectionReminderScheduleId,
        name: 'service.inspection-reminder.prepare',
        pattern: this.environment.SERVICE_INSPECTION_REMINDER_CRON,
        responsibility: 'inspection-reminders',
      },
      {
        id: serviceWarrantyReminderScheduleId,
        name: 'crm.warranty-expiration.prepare',
        pattern: this.environment.SERVICE_WARRANTY_REMINDER_CRON,
        responsibility: 'warranty-reminders',
      },
      {
        id: servicePlanVisitScheduleId,
        name: 'service.plan-visit.generate',
        pattern: this.environment.SERVICE_PLAN_VISIT_CRON,
        responsibility: 'subscription-service-visits',
      },
    ];
    for (const definition of serviceSchedules) {
      const schedule = await this.jobs.upsertSchedule({
        id: definition.id,
        name: definition.name,
        pattern: definition.pattern,
        payload: { responsibility: definition.responsibility },
        timezone: this.environment.BUSINESS_TIMEZONE,
      });
      this.logger.event('info', `${definition.name}.schedule.ready`, {
        nextRunAt: schedule.nextRunAt,
        scheduleId: schedule.id,
      });
    }
    const crmSlaSchedule = await this.jobs.upsertSchedule({
      id: crmSlaScheduleId,
      name: 'crm.sla.evaluate',
      pattern: this.environment.CRM_SLA_EVALUATION_CRON,
      payload: { responsibility: 'ticket-sla-monitoring' },
      timezone: this.environment.BUSINESS_TIMEZONE,
    });
    this.logger.event('info', 'crm.sla.schedule.ready', {
      nextRunAt: crmSlaSchedule.nextRunAt,
      scheduleId: crmSlaSchedule.id,
    });
    const backupSchedule = await this.jobs.upsertSchedule({
      id: backupDispatchScheduleId,
      name: 'backup.schedule.dispatch',
      pattern: this.environment.BACKUP_DISPATCH_CRON,
      payload: { responsibility: 'dispatch-due-protection-schedules' },
      timezone: this.environment.BUSINESS_TIMEZONE,
    });
    this.logger.event('info', 'backup.schedule.dispatch.ready', {
      nextRunAt: backupSchedule.nextRunAt,
      scheduleId: backupSchedule.id,
    });
    const restoreSchedule = await this.jobs.upsertSchedule({
      id: backupRestoreDispatchScheduleId,
      name: 'backup.restore.dispatch',
      pattern: this.environment.BACKUP_DISPATCH_CRON,
      payload: { responsibility: 'dispatch-approved-backup-restores' },
      timezone: this.environment.BUSINESS_TIMEZONE,
    });
    this.logger.event('info', 'backup.restore.dispatch.ready', {
      nextRunAt: restoreSchedule.nextRunAt,
      scheduleId: restoreSchedule.id,
    });
    const retentionSchedule = await this.jobs.upsertSchedule({
      id: backupRetentionScheduleId,
      name: 'backup.retention.enforce',
      pattern: '0 30 3 * * *',
      payload: { responsibility: 'enforce-approved-backup-retention' },
      timezone: this.environment.BUSINESS_TIMEZONE,
    });
    this.logger.event('info', 'backup.retention.enforce.schedule.ready', {
      nextRunAt: retentionSchedule.nextRunAt,
      scheduleId: retentionSchedule.id,
    });
    const missedDetectionSchedule = await this.jobs.upsertSchedule({
      id: backupMissedDetectionScheduleId,
      name: 'backup.missed-detect',
      pattern: '0 */15 * * * *',
      payload: { responsibility: 'detect-overdue-backup-schedules' },
      timezone: this.environment.BUSINESS_TIMEZONE,
    });
    this.logger.event('info', 'backup.missed-detect.schedule.ready', {
      nextRunAt: missedDetectionSchedule.nextRunAt,
      scheduleId: missedDetectionSchedule.id,
    });
    const drTestReminderSchedule = await this.jobs.upsertSchedule({
      id: backupDrTestReminderScheduleId,
      name: 'backup.dr-test.remind',
      pattern: '0 0 9 * * *',
      payload: { responsibility: 'annual-disaster-recovery-test-reminder' },
      timezone: this.environment.BUSINESS_TIMEZONE,
    });
    this.logger.event('info', 'backup.dr-test.remind.schedule.ready', {
      nextRunAt: drTestReminderSchedule.nextRunAt,
      scheduleId: drTestReminderSchedule.id,
    });
    const backupPlanReviewSchedule = await this.jobs.upsertSchedule({
      id: backupPlanReviewReminderScheduleId,
      name: 'backup.plan-review.remind',
      pattern: '0 15 9 * * *',
      payload: { responsibility: 'annual-backup-plan-review-reminder' },
      timezone: this.environment.BUSINESS_TIMEZONE,
    });
    this.logger.event('info', 'backup.plan-review.remind.schedule.ready', {
      nextRunAt: backupPlanReviewSchedule.nextRunAt,
      scheduleId: backupPlanReviewSchedule.id,
    });
  }
}
