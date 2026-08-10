import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { AppEnvironment } from '@vista/config';

import { APP_ENVIRONMENT, VistaConfigModule } from '../config/config.module.js';
import { RedisModule } from '../database/redis.module.js';
import { RedisService } from '../database/redis.service.js';
import { rateLimitForContext } from './rate-limit.policy.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [VistaConfigModule, RedisModule],
      inject: [APP_ENVIRONMENT, RedisService],
      useFactory: (environment: AppEnvironment, redis: RedisService): ThrottlerModuleOptions => ({
        ...(environment.API_RATE_LIMIT_STORE === 'redis'
          ? {
              storage: new RedisThrottlerStorage(redis, environment.API_RATE_LIMIT_REDIS_PREFIX),
            }
          : {}),
        throttlers: [
          {
            blockDuration: environment.API_RATE_LIMIT_TTL_MS,
            limit: (context) => rateLimitForContext(environment, context),
            setHeaders: true,
            ttl: environment.API_RATE_LIMIT_TTL_MS,
          },
        ],
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class RateLimitModule {}
