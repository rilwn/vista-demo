import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
@Module({
  controllers: [CatalogController],
  imports: [AuditModule, DatabaseModule],
  providers: [CatalogService],
})
export class CatalogModule {}
