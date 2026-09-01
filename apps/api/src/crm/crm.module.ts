import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { ServiceOperationsModule } from '../service/service.module.js';
import { CrmPipelineController } from './crm-pipeline.controller.js';
import { CrmPipelineService } from './crm-pipeline.service.js';
import { CrmTimelineController } from './crm-timeline.controller.js';
import { CrmTimelineService } from './crm-timeline.service.js';
import { CrmTicketsController } from './crm-tickets.controller.js';
import { CrmTicketsService } from './crm-tickets.service.js';

@Module({
  controllers: [CrmPipelineController, CrmTicketsController, CrmTimelineController],
  exports: [CrmPipelineService, CrmTicketsService, CrmTimelineService],
  imports: [AuditModule, DatabaseModule, ServiceOperationsModule],
  providers: [CrmPipelineService, CrmTicketsService, CrmTimelineService],
})
export class CrmModule {}
