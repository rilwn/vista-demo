import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { RedisModule } from '../database/redis.module.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Module({
  controllers: [HealthController],
  imports: [DatabaseModule, RedisModule],
  providers: [HealthService],
})
export class HealthModule {}
