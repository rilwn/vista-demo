import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PartnersController } from './partners.controller.js';
import { PartnersService } from './partners.service.js';

@Module({
  controllers: [PartnersController],
  imports: [AuditModule, DatabaseModule],
  providers: [PartnersService],
})
export class PartnersModule {}
