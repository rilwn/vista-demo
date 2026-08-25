import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { SalesController } from './sales.controller.js';
import { SalesPricingService } from './sales-pricing.service.js';
import { SalesSubscriptionsService } from './sales-subscriptions.service.js';
import { SalesService } from './sales.service.js';

@Module({
  controllers: [SalesController],
  imports: [AuditModule, DatabaseModule],
  exports: [SalesService, SalesSubscriptionsService],
  providers: [SalesPricingService, SalesService, SalesSubscriptionsService],
})
export class SalesModule {}
