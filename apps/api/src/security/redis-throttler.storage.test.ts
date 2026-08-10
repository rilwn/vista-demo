import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ApiErrorException } from '../common/api-error.exception.js';
import type { RedisService } from '../database/redis.service.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

describe('RedisThrottlerStorage', () => {
  it('maps the atomic Redis result to the throttler lifecycle record', async () => {
    const evalCommand = vi.fn().mockResolvedValue([3, 42, 1, 30]);
    const storage = new RedisThrottlerStorage(redisStub(evalCommand), 'vista:test');

    await expect(storage.increment('route-key', 60_000, 2, 30_000, 'default')).resolves.toEqual({
      isBlocked: true,
      timeToBlockExpire: 30,
      timeToExpire: 42,
      totalHits: 3,
    });
    expect(evalCommand).toHaveBeenCalledWith(
      expect.any(String),
      2,
      'vista:test:default:route-key:hits',
      'vista:test:default:route-key:block',
      60_000,
      2,
      30_000,
    );
  });

  it('fails closed with a stable service-unavailable error', async () => {
    const storage = new RedisThrottlerStorage(
      {
        ensureConnected: vi.fn().mockRejectedValue(new Error('connection unavailable')),
      } as unknown as RedisService,
      'vista:test',
    );

    const failure = storage.increment('route-key', 60_000, 2, 60_000, 'default');
    await expect(failure).rejects.toBeInstanceOf(ApiErrorException);
    await expect(failure).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  });

  it('rejects an invalid Redis script result without leaking dependency details', async () => {
    const storage = new RedisThrottlerStorage(
      redisStub(vi.fn().mockResolvedValue(['unexpected'])),
      'vista:test',
    );

    await expect(
      storage.increment('route-key', 60_000, 2, 60_000, 'default'),
    ).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  });
});

function redisStub(evalCommand: ReturnType<typeof vi.fn>): RedisService {
  return {
    ensureConnected: vi.fn().mockResolvedValue({ eval: evalCommand }),
  } as unknown as RedisService;
}
