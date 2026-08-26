import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';

import { APP_ENVIRONMENT } from '../config/config.module.js';
import { StructuredLogger } from '../logging/structured-logger.service.js';
import { JobQueueService } from './job-queue.service.js';

export const recurringBillingScheduleId = 'sales.subscription-invoice.daily';
export const financePaymentStatusScheduleId = 'finance.payment-status.daily';
export const serviceInspectionReminderScheduleId = 'service.inspection-reminder.daily';
export const serviceWarrantyReminderScheduleId = 'service.warranty-reminder.daily';
export const servicePlanVisitScheduleId = 'service.plan-visit.daily';
export const crmSlaScheduleId = 'crm.sla.frequent';

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
  }
}
