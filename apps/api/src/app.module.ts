import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module.js';
import { VistaConfigModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { LoggingModule } from './logging/logging.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OrganizationModule } from './organization/organization.module.js';
import { PartnersModule } from './partners/partners.module.js';
import { ProductCategoriesModule } from './product-categories/product-categories.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { ProcurementModule } from './procurement/procurement.module.js';
import { IntegrationModule } from './integration/integration.module.js';
import { RootController } from './root.controller.js';
import { RateLimitModule } from './security/rate-limit.module.js';
import { SecurityAdministrationModule } from './security-administration/security-administration.module.js';
import { SalesModule } from './sales/sales.module.js';
import { FinanceModule } from './finance/finance.module.js';
import { ServiceOperationsModule } from './service/service.module.js';
import { FilesModule } from './files/files.module.js';

@Module({
  controllers: [RootController],
  imports: [
    VistaConfigModule,
    LoggingModule,
    NotificationsModule,
    RateLimitModule,
    HealthModule,
    JobsModule,
    IntegrationModule,
    AuthModule,
    SecurityAdministrationModule,
    OrganizationModule,
    PartnersModule,
    ProductCategoriesModule,
    CatalogModule,
    InventoryModule,
    ProcurementModule,
    SalesModule,
    FinanceModule,
    ServiceOperationsModule,
    FilesModule,
  ],
})
export class AppModule {}
