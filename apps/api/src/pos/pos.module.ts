import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { PosReportsController } from './pos-reports.controller.js';
import { PosReportsService } from './pos-reports.service.js';
import { CardAuthorizationService } from './card-authorization.service.js';
import { PosController } from './pos.controller.js';
import {
  DevelopmentCardTerminalSimulator,
  POS_CARD_TERMINAL_ADAPTER,
} from './card-terminal-adapter.js';
import { PosService } from './pos.service.js';

@Module({
  controllers: [PosController, PosReportsController],
  exports: [PosReportsService],
  imports: [AuditModule, AuthModule, DatabaseModule, FinanceModule],
  providers: [
    DevelopmentCardTerminalSimulator,
    { provide: POS_CARD_TERMINAL_ADAPTER, useExisting: DevelopmentCardTerminalSimulator },
    CardAuthorizationService,
    PosService,
    PosReportsService,
  ],
})
export class PosModule {}
