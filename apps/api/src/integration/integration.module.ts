import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { IntegrationEventConsumerRegistry } from './integration-event-consumer.registry.js';
import { IntegrationEventDispatcherService } from './integration-event-dispatcher.service.js';
import { IntegrationOperationsController } from './integration-operations.controller.js';
import { IntegrationOperationsService } from './integration-operations.service.js';
import { LowStockNotificationConsumer } from './low-stock-notification.consumer.js';
import { OutboxPublisherService } from './outbox-publisher.service.js';

@Module({
  controllers: [IntegrationOperationsController],
  exports: [IntegrationEventDispatcherService, OutboxPublisherService],
  imports: [AuditModule, DatabaseModule, JobsModule],
  providers: [
    IntegrationEventConsumerRegistry,
    IntegrationEventDispatcherService,
    IntegrationOperationsService,
    LowStockNotificationConsumer,
    OutboxPublisherService,
  ],
})
export class IntegrationModule {}
