import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { JobHandlerRegistry } from './job-handler-registry.service.js';
import { JobsController } from './jobs.controller.js';
import { JobQueueService } from './job-queue.service.js';
import { NamedJobTriggerHandlersService } from './named-job-trigger-handlers.service.js';
import { PlatformJobWorkerService } from './platform-job-worker.service.js';
import { RecurringBillingScheduleService } from './recurring-billing-schedule.service.js';

@Module({
  controllers: [JobsController],
  exports: [JobHandlerRegistry, JobQueueService],
  imports: [DatabaseModule, FinanceModule, SalesModule],
  providers: [
    JobHandlerRegistry,
    JobQueueService,
    NamedJobTriggerHandlersService,
    PlatformJobWorkerService,
    RecurringBillingScheduleService,
  ],
})
export class JobsModule {}
