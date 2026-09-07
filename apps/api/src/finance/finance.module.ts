import { Module } from '@nestjs/common';
import { OperationsOverviewController } from './operations-overview.controller.js';
import { OperationsOverviewService } from './operations-overview.service.js';

import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { FinanceBankController } from './finance-bank.controller.js';
import { FinanceBankService } from './finance-bank.service.js';
import { FinanceCashController } from './finance-cash.controller.js';
import { FinanceCashService } from './finance-cash.service.js';
import { FinanceCustomerAccountsController } from './finance-customer-accounts.controller.js';
import { FinanceCustomerAccountsService } from './finance-customer-accounts.service.js';
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
    OperationsOverviewController,
    FinanceBankController,
    FinanceCashController,
    FinanceCustomerAccountsController,
    FinanceController,
    FinancePayablesController,
    FinanceReportsController,
    FinancialDocumentsController,
  ],
  exports: [
    FinanceBankService,
    FinanceCashService,
    FinanceCustomerAccountsService,
    FinancePayablesService,
    FinanceReportsService,
    FinanceService,
    FinancialDocumentsService,
  ],
  imports: [AuditModule, DatabaseModule],
  providers: [
    OperationsOverviewService,
    FinanceBankService,
    FinanceCashService,
    FinanceCustomerAccountsService,
    FinancePayablesService,
    FinanceReportsService,
    FinanceService,
    FinancialDocumentsService,
  ],
})
export class FinanceModule {}
