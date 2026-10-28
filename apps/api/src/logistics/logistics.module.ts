import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { CourierAdapterService } from './courier-adapters.js';
import { SalesModule } from '../sales/sales.module.js';
import { ServiceOperationsModule } from '../service/service.module.js';
import { LogisticsController } from './logistics.controller.js';
import { LogisticsService } from './logistics.service.js';

@Module({
  controllers: [LogisticsController],
  imports: [AuditModule, DatabaseModule, InventoryModule, SalesModule, ServiceOperationsModule],
  providers: [CourierAdapterService, LogisticsService],
})
export class LogisticsModule {}
