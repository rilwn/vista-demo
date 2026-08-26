import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { FilesModule } from '../files/files.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { ServiceOperationsController } from './service.controller.js';
import { ServiceCareService } from './service-care.service.js';
import { ServiceReportsController } from './service-reports.controller.js';
import { ServiceReportsService } from './service-reports.service.js';
import { ServiceOperationsService } from './service.service.js';

@Module({
  controllers: [ServiceOperationsController, ServiceReportsController],
  exports: [ServiceCareService, ServiceOperationsService, ServiceReportsService],
  imports: [AuditModule, DatabaseModule, FilesModule, InventoryModule],
  providers: [ServiceCareService, ServiceOperationsService, ServiceReportsService],
})
export class ServiceOperationsModule {}
