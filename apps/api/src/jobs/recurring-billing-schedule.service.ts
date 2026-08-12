import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';

import { APP_ENVIRONMENT } from '../config/config.module.js';
import { StructuredLogger } from '../logging/structured-logger.service.js';
import { JobQueueService } from './job-queue.service.js';

export const recurringBillingScheduleId = 'sales.subscription-invoice.daily';

@Injectable()
export class RecurringBillingScheduleService implements OnApplicationBootstrap {
  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(JobQueueService) private readonly jobs: JobQueueService,
    @Inject(StructuredLogger) private readonly logger: StructuredLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.environment.NODE_ENV === 'test') return;
    const schedule = await this.jobs.upsertSchedule({
      id: recurringBillingScheduleId,
      name: 'sales.subscription-invoice.generate',
      pattern: this.environment.SALES_SUBSCRIPTION_INVOICE_CRON,
      payload: { responsibility: 'recurring-service-billing' },
      timezone: this.environment.BUSINESS_TIMEZONE,
    });
    this.logger.event('info', 'sales.subscription-invoice.schedule.ready', {
      nextRunAt: schedule.nextRunAt,
      scheduleId: schedule.id,
    });
  }
}
