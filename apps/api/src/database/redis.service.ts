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
      connectTimeout: 2000,
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
    if (['connecting', 'connect', 'reconnecting'].includes(this.client.status)) {
      // Do not immediately reject requests during a short reconnection. Still
      // fail closed, with a bounded wait, if the dependency remains unavailable.
      await this.waitUntilReady();
    }
    if (this.client.status !== 'ready') {
      throw new Error('Redis is not ready');
    }
    return this.client;
  }

  private async waitUntilReady(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        this.client.off('ready', ready);
        this.client.off('end', ended);
      };
      const ready = () => {
        cleanup();
        resolve();
      };
      const ended = () => {
        cleanup();
        reject(new Error('Redis connection ended'));
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Redis readiness timed out'));
      }, 2000);
      this.client.once('ready', ready);
      this.client.once('end', ended);
      // Recheck after subscribing so a readiness transition cannot be missed.
      if (this.client.status === 'ready') ready();
      else if (this.client.status === 'end') ended();
    });
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
