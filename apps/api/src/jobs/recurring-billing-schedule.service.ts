import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';

import { APP_ENVIRONMENT } from '../config/config.module.js';
import { StructuredLogger } from '../logging/structured-logger.service.js';
import { JobQueueService } from './job-queue.service.js';

export const recurringBillingScheduleId = 'sales.subscription-invoice.daily';
export const financePaymentStatusScheduleId = 'finance.payment-status.daily';

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
  }
}
