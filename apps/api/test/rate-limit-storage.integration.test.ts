import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { VistaConfigModule } from '../src/config/config.module.js';
import { RedisModule } from '../src/database/redis.module.js';
import { RedisService } from '../src/database/redis.service.js';
import { RedisThrottlerStorage } from '../src/security/redis-throttler.storage.js';

const runInfrastructureTests = process.env['RUN_INFRASTRUCTURE_TESTS'] === 'true';

describe.skipIf(!runInfrastructureTests)('distributed Redis request throttling', () => {
  let firstModule: TestingModule;
  let secondModule: TestingModule;
  let firstRedis: RedisService;
  let prefix: string;

  beforeAll(async () => {
    if (!process.env['REDIS_URL']) {
      throw new Error('REDIS_URL is required when RUN_INFRASTRUCTURE_TESTS=true');
    }
    Object.assign(process.env, {
      BUSINESS_TIMEZONE: process.env['BUSINESS_TIMEZONE'] ?? 'Europe/Sofia',
      CORS_ORIGINS: process.env['CORS_ORIGINS'] ?? 'http://localhost:5173',
      DATABASE_URL:
        process.env['DATABASE_URL'] ?? 'postgresql://vista:password@localhost:55432/vista',
      NODE_ENV: 'test',
      S3_ACCESS_KEY_ID: process.env['S3_ACCESS_KEY_ID'] ?? 'test',
      S3_BUCKET: process.env['S3_BUCKET'] ?? 'vista-test',
      S3_ENDPOINT: process.env['S3_ENDPOINT'] ?? 'http://localhost:9000',
      S3_REGION: process.env['S3_REGION'] ?? 'us-east-1',
      S3_SECRET_ACCESS_KEY: process.env['S3_SECRET_ACCESS_KEY'] ?? 'test-secret',
      SESSION_SECRET:
        process.env['SESSION_SECRET'] ?? 'a-test-session-secret-at-least-32-characters',
      SMTP_FROM: process.env['SMTP_FROM'] ?? 'test@example.invalid',
      SMTP_HOST: process.env['SMTP_HOST'] ?? 'localhost',
      SMTP_PORT: process.env['SMTP_PORT'] ?? '1025',
      TOTP_ENCRYPTION_KEY:
        process.env['TOTP_ENCRYPTION_KEY'] ?? 'a-test-totp-key-with-at-least-32-characters',
    });
    firstModule = await Test.createTestingModule({
      imports: [VistaConfigModule, RedisModule],
    }).compile();
    secondModule = await Test.createTestingModule({
      imports: [VistaConfigModule, RedisModule],
    }).compile();
    firstRedis = firstModule.get(RedisService);
    prefix = `vista:rate-limit-test:${randomUUID()}`;
  });

  afterAll(async () => {
    if (firstRedis && prefix) {
      const redis = await firstRedis.ensureConnected();
      await redis.del(
        `${prefix}:default:shared-route:hits`,
        `${prefix}:default:shared-route:block`,
        `${prefix}:default:expiry-route:hits`,
        `${prefix}:default:expiry-route:block`,
      );
    }
    await firstModule?.close();
    await secondModule?.close();
  });

  it('shares counters across API instances and resets after the configured window', async () => {
    const first = new RedisThrottlerStorage(firstRedis, prefix);
    const second = new RedisThrottlerStorage(secondModule.get(RedisService), prefix);

    await expect(
      first.increment('shared-route', 1_000, 2, 1_000, 'default'),
    ).resolves.toMatchObject({
      isBlocked: false,
      totalHits: 1,
    });
    await expect(
      second.increment('shared-route', 1_000, 2, 1_000, 'default'),
    ).resolves.toMatchObject({
      isBlocked: false,
      totalHits: 2,
    });
    await expect(
      first.increment('shared-route', 1_000, 2, 1_000, 'default'),
    ).resolves.toMatchObject({
      isBlocked: true,
      totalHits: 3,
    });

    await first.increment('expiry-route', 50, 1, 50, 'default');
    await expect(second.increment('expiry-route', 50, 1, 50, 'default')).resolves.toMatchObject({
      isBlocked: true,
      totalHits: 2,
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    await expect(first.increment('expiry-route', 50, 1, 50, 'default')).resolves.toMatchObject({
      isBlocked: false,
      totalHits: 1,
    });
  });
});
