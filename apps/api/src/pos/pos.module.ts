import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PosController } from './pos.controller.js';
import { PosService } from './pos.service.js';

@Module({
  controllers: [PosController],
  imports: [AuditModule, DatabaseModule],
  providers: [PosService],
})
export class PosModule {}
