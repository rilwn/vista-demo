import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { FinanceController } from './finance.controller.js';
import { FinanceService } from './finance.service.js';

@Module({
  controllers: [FinanceController],
  exports: [FinanceService],
  imports: [AuditModule, DatabaseModule],
  providers: [FinanceService],
})
export class FinanceModule {}
