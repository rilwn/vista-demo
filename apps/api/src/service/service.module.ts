import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { ServiceOperationsController } from './service.controller.js';
import { ServiceOperationsService } from './service.service.js';

@Module({
  controllers: [ServiceOperationsController],
  exports: [ServiceOperationsService],
  imports: [AuditModule, DatabaseModule, InventoryModule],
  providers: [ServiceOperationsService],
})
export class ServiceOperationsModule {}
