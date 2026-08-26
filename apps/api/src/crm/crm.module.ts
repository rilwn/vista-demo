import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { ServiceOperationsModule } from '../service/service.module.js';
import { CrmTicketsController } from './crm-tickets.controller.js';
import { CrmTicketsService } from './crm-tickets.service.js';

@Module({
  controllers: [CrmTicketsController],
  exports: [CrmTicketsService],
  imports: [AuditModule, DatabaseModule, ServiceOperationsModule],
  providers: [CrmTicketsService],
})
export class CrmModule {}
