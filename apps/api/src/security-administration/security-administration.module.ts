import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { SecurityAdministrationController } from './security-administration.controller.js';
import { SecurityAdministrationService } from './security-administration.service.js';

@Module({
  controllers: [SecurityAdministrationController],
  imports: [AuditModule, AuthModule, DatabaseModule],
  providers: [SecurityAdministrationService],
})
export class SecurityAdministrationModule {}
