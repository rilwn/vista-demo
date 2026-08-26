import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { FilesModule } from '../files/files.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { ServiceOperationsController } from './service.controller.js';
import { ServiceCareService } from './service-care.service.js';
import { ServiceOperationsService } from './service.service.js';

@Module({
  controllers: [ServiceOperationsController],
  exports: [ServiceCareService, ServiceOperationsService],
  imports: [AuditModule, DatabaseModule, FilesModule, InventoryModule],
  providers: [ServiceCareService, ServiceOperationsService],
})
export class ServiceOperationsModule {}
