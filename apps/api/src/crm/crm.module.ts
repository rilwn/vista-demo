import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { ServiceOperationsModule } from '../service/service.module.js';
import { CrmAnalyticsController } from './crm-analytics.controller.js';
import { CrmAnalyticsService } from './crm-analytics.service.js';
import { CrmPipelineController } from './crm-pipeline.controller.js';
import { CrmAfterSalesController } from './crm-after-sales.controller.js';
import { CrmAfterSalesService } from './crm-after-sales.service.js';
import { CrmPipelineService } from './crm-pipeline.service.js';
import { CrmTimelineController } from './crm-timeline.controller.js';
import { CrmTimelineService } from './crm-timeline.service.js';
import { CrmTicketsController } from './crm-tickets.controller.js';
import { CrmTicketsService } from './crm-tickets.service.js';

@Module({
  controllers: [
    CrmAnalyticsController,
    CrmAfterSalesController,
    CrmPipelineController,
    CrmTicketsController,
    CrmTimelineController,
  ],
  exports: [
    CrmAfterSalesService,
    CrmAnalyticsService,
    CrmPipelineService,
    CrmTicketsService,
    CrmTimelineService,
  ],
  imports: [AuditModule, DatabaseModule, ServiceOperationsModule],
  providers: [
    CrmAfterSalesService,
    CrmAnalyticsService,
    CrmPipelineService,
    CrmTicketsService,
    CrmTimelineService,
  ],
})
export class CrmModule {}
