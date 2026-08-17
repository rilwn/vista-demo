import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import Redis from 'ioredis';

import { APP_ENVIRONMENT } from '../config/config.module.js';

@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly client: Redis;
  private connectionPromise: Promise<void> | undefined;

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
    await this.ensureConnected();
    await this.client.ping();
    return Math.round(performance.now() - start);
  }

  async ensureConnected(): Promise<Redis> {
    if (this.client.status === 'wait') {
      this.connectionPromise ??= this.client.connect().finally(() => {
        this.connectionPromise = undefined;
      });
    }
    if (this.connectionPromise) await this.connectionPromise;
    if (this.client.status !== 'ready') {
      throw new Error('Redis is not ready');
    }
    return this.client;
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
