import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { FinanceBankController } from './finance-bank.controller.js';
import { FinanceBankService } from './finance-bank.service.js';
import { FinanceController } from './finance.controller.js';
import { FinanceService } from './finance.service.js';
import { FinancialDocumentsController } from './financial-documents.controller.js';
import { FinancialDocumentsService } from './financial-documents.service.js';

@Module({
  controllers: [FinanceBankController, FinanceController, FinancialDocumentsController],
  exports: [FinanceBankService, FinanceService, FinancialDocumentsService],
  imports: [AuditModule, DatabaseModule],
  providers: [FinanceBankService, FinanceService, FinancialDocumentsService],
})
export class FinanceModule {}
