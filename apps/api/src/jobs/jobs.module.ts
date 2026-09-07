import { Module } from '@nestjs/common';
import { SavedFinanceReportsController } from './saved-finance-reports.controller.js';
import { SavedFinanceReportsService } from './saved-finance-reports.service.js';

import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { CrmModule } from '../crm/crm.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { ServiceOperationsModule } from '../service/service.module.js';
import { ObjectStorageModule } from '../storage/object-storage.module.js';
import { PosModule } from '../pos/pos.module.js';
import { CrmReportExportsController } from './crm-report-exports.controller.js';
import { FinanceReportExportDispatcherService } from './finance-report-export-dispatcher.service.js';
import { FinanceReportExportsController } from './finance-report-exports.controller.js';
import { FinanceReportExportsService } from './finance-report-exports.service.js';
import { JobHandlerRegistry } from './job-handler-registry.service.js';
import { JobsController } from './jobs.controller.js';
import { JobQueueService } from './job-queue.service.js';
import { NamedJobTriggerHandlersService } from './named-job-trigger-handlers.service.js';
import { PlatformJobWorkerService } from './platform-job-worker.service.js';
import { PosReportExportsController } from './pos-report-exports.controller.js';
import { RecurringBillingScheduleService } from './recurring-billing-schedule.service.js';
import { ServiceReportExportsController } from './service-report-exports.controller.js';

@Module({
  controllers: [
    SavedFinanceReportsController,
    CrmReportExportsController,
    FinanceReportExportsController,
    JobsController,
    PosReportExportsController,
    ServiceReportExportsController,
  ],
  exports: [JobHandlerRegistry, JobQueueService],
  imports: [
    AuditModule,
    CrmModule,
    DatabaseModule,
    FinanceModule,
    ObjectStorageModule,
    PosModule,
    SalesModule,
    ServiceOperationsModule,
  ],
  providers: [
    SavedFinanceReportsService,
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
