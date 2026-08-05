import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import Redis from 'ioredis';

import { APP_ENVIRONMENT } from '../config/config.module.js';

@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly client: Redis;

  constructor(@Inject(APP_ENVIRONMENT) environment: AppEnvironment) {
    this.client = new Redis(environment.REDIS_URL, {
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    this.client.on('error', () => undefined);
  }

  async ping(): Promise<number> {
    const start = performance.now();
    if (this.client.status === 'wait') {
      await this.client.connect();
    }
    await this.client.ping();
    return Math.round(performance.now() - start);
  }

  getClient(): Redis {
    return this.client;
  }

  onApplicationShutdown(): void {
    if (this.client.status !== 'end') {
      this.client.disconnect(false);
    }
  }
}
