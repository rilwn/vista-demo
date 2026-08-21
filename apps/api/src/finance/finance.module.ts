import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { FinanceBankController } from './finance-bank.controller.js';
import { FinanceBankService } from './finance-bank.service.js';
import { FinanceCashController } from './finance-cash.controller.js';
import { FinanceCashService } from './finance-cash.service.js';
import { FinanceController } from './finance.controller.js';
import { FinancePayablesController } from './finance-payables.controller.js';
import { FinancePayablesService } from './finance-payables.service.js';
import { FinanceReportsController } from './finance-reports.controller.js';
import { FinanceReportsService } from './finance-reports.service.js';
import { FinanceService } from './finance.service.js';
import { FinancialDocumentsController } from './financial-documents.controller.js';
import { FinancialDocumentsService } from './financial-documents.service.js';

@Module({
  controllers: [
    FinanceBankController,
    FinanceCashController,
    FinanceController,
    FinancePayablesController,
    FinanceReportsController,
    FinancialDocumentsController,
  ],
  exports: [
    FinanceBankService,
    FinanceCashService,
    FinancePayablesService,
    FinanceReportsService,
    FinanceService,
    FinancialDocumentsService,
  ],
  imports: [AuditModule, DatabaseModule],
  providers: [
    FinanceBankService,
    FinanceCashService,
    FinancePayablesService,
    FinanceReportsService,
    FinanceService,
    FinancialDocumentsService,
  ],
})
export class FinanceModule {}
