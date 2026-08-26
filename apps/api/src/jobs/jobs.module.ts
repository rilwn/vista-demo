import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { ServiceOperationsModule } from '../service/service.module.js';
import { ObjectStorageModule } from '../storage/object-storage.module.js';
import { FinanceReportExportDispatcherService } from './finance-report-export-dispatcher.service.js';
import { FinanceReportExportsController } from './finance-report-exports.controller.js';
import { FinanceReportExportsService } from './finance-report-exports.service.js';
import { JobHandlerRegistry } from './job-handler-registry.service.js';
import { JobsController } from './jobs.controller.js';
import { JobQueueService } from './job-queue.service.js';
import { NamedJobTriggerHandlersService } from './named-job-trigger-handlers.service.js';
import { PlatformJobWorkerService } from './platform-job-worker.service.js';
import { RecurringBillingScheduleService } from './recurring-billing-schedule.service.js';

@Module({
  controllers: [FinanceReportExportsController, JobsController],
  exports: [JobHandlerRegistry, JobQueueService],
  imports: [
    AuditModule,
    DatabaseModule,
    FinanceModule,
    ObjectStorageModule,
    SalesModule,
    ServiceOperationsModule,
  ],
  providers: [
    FinanceReportExportDispatcherService,
    FinanceReportExportsService,
    JobHandlerRegistry,
    JobQueueService,
    NamedJobTriggerHandlersService,
    PlatformJobWorkerService,
    RecurringBillingScheduleService,
  ],
})
export class JobsModule {}
