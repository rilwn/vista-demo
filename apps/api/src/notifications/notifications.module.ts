import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { NotificationDispatcherService } from './notification-dispatcher.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  controllers: [NotificationsController],
  exports: [NotificationDispatcherService, NotificationsService],
  imports: [DatabaseModule, JobsModule],
  providers: [NotificationDispatcherService, NotificationsService],
})
export class NotificationsModule {}
