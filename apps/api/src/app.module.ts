import { Module } from '@nestjs/common';

import { VistaConfigModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';
import { RootController } from './root.controller.js';

@Module({
  controllers: [RootController],
  imports: [VistaConfigModule, HealthModule],
})
export class AppModule {}
