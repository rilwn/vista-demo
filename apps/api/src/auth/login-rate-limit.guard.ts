import { createHash } from 'node:crypto';

import { CanActivate, type ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import type { Request, Response } from 'express';

import { ApiErrorException } from '../common/api-error.exception.js';
import { APP_ENVIRONMENT } from '../config/config.module.js';
import { RedisService } from '../database/redis.service.js';

const incrementScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return {count, redis.call('PTTL', KEYS[1])}
`;

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const email = extractEmail(request.body);
    const tracker = createHash('sha256').update(`${request.ip}|${email}`).digest('hex');
    try {
      const redis = await this.redis.ensureConnected();
      const result = (await redis.eval(
        incrementScript,
        1,
        `vista:rate-limit:login:${tracker}`,
        this.environment.AUTH_LOGIN_RATE_LIMIT_TTL_MS,
      )) as [number, number];
      const [count, ttl] = result;
      response.setHeader('x-ratelimit-limit', this.environment.AUTH_LOGIN_RATE_LIMIT_MAX);
      response.setHeader(
        'x-ratelimit-remaining',
        Math.max(0, this.environment.AUTH_LOGIN_RATE_LIMIT_MAX - count),
      );
      response.setHeader('x-ratelimit-reset', Math.max(0, Math.ceil(ttl / 1_000)));
      if (count > this.environment.AUTH_LOGIN_RATE_LIMIT_MAX) {
        throw new ApiErrorException(
          'RATE_LIMITED',
          'Too many authentication attempts',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return true;
    } catch (error) {
      if (error instanceof ApiErrorException) {
        throw error;
      }
      throw new ApiErrorException(
        'AUTH_RATE_LIMIT_UNAVAILABLE',
        'Authentication is temporarily unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}

function extractEmail(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    return 'invalid';
  }
  const email = (body as Record<string, unknown>)['email'];
  return typeof email === 'string' ? email.trim().toLowerCase() : 'invalid';
}
