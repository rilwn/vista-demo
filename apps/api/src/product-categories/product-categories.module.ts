import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { ProductCategoriesController } from './product-categories.controller.js';
import { ProductCategoriesService } from './product-categories.service.js';

@Module({
  controllers: [ProductCategoriesController],
  imports: [AuditModule, DatabaseModule],
  providers: [ProductCategoriesService],
})
export class ProductCategoriesModule {}
