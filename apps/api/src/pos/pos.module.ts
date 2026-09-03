import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PosReportsController } from './pos-reports.controller.js';
import { PosReportsService } from './pos-reports.service.js';
import { PosController } from './pos.controller.js';
import { PosService } from './pos.service.js';

@Module({
  controllers: [PosController, PosReportsController],
  exports: [PosReportsService],
  imports: [AuditModule, AuthModule, DatabaseModule],
  providers: [PosService, PosReportsService],
})
export class PosModule {}
