import { describe, expect, it } from 'vitest';

import type { DatabaseService } from '../database/database.service.js';
import type { RedisService } from '../database/redis.service.js';
import type { ObjectStorageService } from '../storage/object-storage.service.js';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  it('reports readiness only when all dependencies respond', async () => {
    const health = new HealthService(
      { ping: () => Promise.resolve(3) } as DatabaseService,
      { ping: () => Promise.resolve(2) } as RedisService,
      { ping: () => Promise.resolve(4) } as ObjectStorageService,
    );

    await expect(health.readiness()).resolves.toMatchObject({
      checks: {
        database: { latencyMs: 3, status: 'up' },
        objectStorage: { latencyMs: 4, status: 'up' },
        redis: { latencyMs: 2, status: 'up' },
      },
      status: 'ok',
    });
  });

  it('does not expose dependency errors in a degraded response', async () => {
    const health = new HealthService(
      { ping: () => Promise.reject(new Error('password=secret')) } as DatabaseService,
      { ping: () => Promise.resolve(2) } as RedisService,
      { ping: () => Promise.resolve(4) } as ObjectStorageService,
    );

    const response = await health.readiness();

    expect(response.status).toBe('degraded');
    expect(response.checks['database']).toEqual({
      detail: 'Dependency probe failed',
      status: 'down',
    });
    expect(JSON.stringify(response)).not.toContain('secret');
  });
});
