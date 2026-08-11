import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { ProcurementController } from './procurement.controller.js';
import { ProcurementService } from './procurement.service.js';
import { SupplierProcurementService } from './supplier-procurement.service.js';

@Module({
  controllers: [ProcurementController],
  imports: [AuditModule, DatabaseModule, InventoryModule],
  providers: [ProcurementService, SupplierProcurementService],
})
export class ProcurementModule {}
