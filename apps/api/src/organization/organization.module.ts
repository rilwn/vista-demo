import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { OrganizationController } from './organization.controller.js';
import { OrganizationService } from './organization.service.js';

@Module({
  controllers: [OrganizationController],
  imports: [AuditModule, DatabaseModule],
  providers: [OrganizationService],
})
export class OrganizationModule {}
