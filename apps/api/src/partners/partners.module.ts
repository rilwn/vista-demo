import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { CustomerAssetsController } from './customer-assets.controller.js';
import { CustomerAssetsService } from './customer-assets.service.js';
import { PartnersController } from './partners.controller.js';
import { PartnersService } from './partners.service.js';

@Module({
  controllers: [PartnersController, CustomerAssetsController],
  imports: [AuditModule, DatabaseModule],
  providers: [PartnersService, CustomerAssetsService],
})
export class PartnersModule {}
