import { HttpStatus } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';

import { ApiErrorException } from '../common/api-error.exception.js';
import type { RedisService } from '../database/redis.service.js';

const incrementScript = `
local blocked_ttl = redis.call('PTTL', KEYS[2])
if blocked_ttl > 0 then
  local current = tonumber(redis.call('GET', KEYS[1])) or tonumber(ARGV[2]) + 1
  local counter_ttl = redis.call('PTTL', KEYS[1])
  return {current, math.max(0, math.ceil(counter_ttl / 1000)), 1, math.ceil(blocked_ttl / 1000)}
end

local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local counter_ttl = redis.call('PTTL', KEYS[1])
if count > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return {count, math.max(0, math.ceil(counter_ttl / 1000)), 1, math.ceil(tonumber(ARGV[3]) / 1000)}
end
return {count, math.max(0, math.ceil(counter_ttl / 1000)), 0, 0}
`;

interface ThrottlerRecord {
  isBlocked: boolean;
  timeToBlockExpire: number;
  timeToExpire: number;
  totalHits: number;
}

export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly redis: RedisService,
    private readonly prefix: string,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerRecord> {
    const baseKey = `${this.prefix}:${throttlerName}:${key}`;
    try {
      const redis = await this.redis.ensureConnected();
      const raw = await redis.eval(
        incrementScript,
        2,
        `${baseKey}:hits`,
        `${baseKey}:block`,
        ttl,
        limit,
        blockDuration,
      );
      return parseRecord(raw);
    } catch (error) {
      if (error instanceof ApiErrorException) throw error;
      throw new ApiErrorException(
        'RATE_LIMIT_UNAVAILABLE',
        'Request protection is temporarily unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}

function parseRecord(value: unknown): ThrottlerRecord {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error('Redis returned an invalid rate-limit result');
  }
  const values = value.map(Number);
  if (values.some((entry) => !Number.isFinite(entry) || entry < 0)) {
    throw new Error('Redis returned an invalid rate-limit value');
  }
  return {
    isBlocked: values[2] === 1,
    timeToBlockExpire: values[3] ?? 0,
    timeToExpire: values[1] ?? 0,
    totalHits: values[0] ?? 0,
  };
}
