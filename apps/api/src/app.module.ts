import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module.js';
import { VistaConfigModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { LoggingModule } from './logging/logging.module.js';
import { PartnersModule } from './partners/partners.module.js';
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
  ],
})
export class AppModule {}
