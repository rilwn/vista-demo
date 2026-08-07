import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module.js';
import { VistaConfigModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { LoggingModule } from './logging/logging.module.js';
import { PartnersModule } from './partners/partners.module.js';
import { ProductCategoriesModule } from './product-categories/product-categories.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { RootController } from './root.controller.js';
import { RateLimitModule } from './security/rate-limit.module.js';

@Module({
  controllers: [RootController],
  imports: [
    VistaConfigModule,
    LoggingModule,
    RateLimitModule,
    HealthModule,
    JobsModule,
    AuthModule,
    PartnersModule,
    ProductCategoriesModule,
    CatalogModule,
    InventoryModule,
  ],
})
export class AppModule {}
