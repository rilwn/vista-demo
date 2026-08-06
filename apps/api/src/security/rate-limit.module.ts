import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { AppEnvironment } from '@vista/config';

import { APP_ENVIRONMENT, VistaConfigModule } from '../config/config.module.js';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [VistaConfigModule],
      inject: [APP_ENVIRONMENT],
      useFactory: (environment: AppEnvironment) => [
        {
          limit: environment.API_RATE_LIMIT_MAX,
          setHeaders: true,
          ttl: environment.API_RATE_LIMIT_TTL_MS,
        },
      ],
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class RateLimitModule {}
